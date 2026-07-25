const { chromium } = require(process.env.PLAYWRIGHT_CORE_PATH);
const fs = require('fs');
const path = require('path');

const outputDir = __dirname;
const url = 'http://localhost:8080/demo-lab/cybersecurity-simulation.html';
const chrome = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const scenarios = [
  ['dos', ['rateLimiting', 'trafficFiltering', 'caching', 'autoscaling', 'upstreamProtection'], 24],
  ['mitm', ['encryption', 'ids', 'mfa'], 20],
  ['phishing', ['emailFiltering', 'mfa', 'endpointProtection'], 20],
  ['malware', ['endpointProtection', 'segmentation', 'patchManagement'], 20],
  ['sqli', ['waf', 'leastPrivilege', 'ids'], 20],
  ['zeroday', ['anomalyDetection', 'segmentation', 'leastPrivilege'], 20],
  ['xss', ['waf', 'ids', 'patchManagement'], 20],
  ['password', ['mfa', 'accountLockout', 'rateLimiting'], 20],
  ['apt', ['segmentation', 'leastPrivilege', 'dlp'], 28],
  ['eavesdropping', ['encryption', 'segmentation', 'ids'], 20],
  ['insider', ['leastPrivilege', 'dlp', 'anomalyDetection'], 20]
];
const exportIds = new Set(['dos', 'phishing', 'sqli', 'malware', 'apt']);
const result = { defenses: [], replay: [], exports: [], network: [], console: [], controls: {} };

async function selectScenario(page, id) {
  await page.locator(`[data-scenario="${id}"]`).click();
  await page.waitForTimeout(30);
}

async function complete(page, ticks) {
  await page.locator('#start').click();
  await page.waitForTimeout(20);
  if (await page.locator('#pause').getAttribute('aria-pressed') !== 'true') await page.locator('#pause').click();
  for (let i = 0; i < ticks + 1; i++) await page.locator('#step').click();
  await page.waitForFunction(() => !document.querySelector('#report-content').hidden);
}

async function stableReportFacts(page) {
  return page.evaluate(() => ({
    score: document.querySelector('.report-score')?.innerText,
    findings: [...document.querySelectorAll('.report-findings > div')]
      .filter(el => !/Same-seed comparison|Previous peak risk/i.test(el.innerText))
      .map(el => el.innerText)
  }));
}

(async () => {
  const browser = await chromium.launch({ executablePath: chrome, headless: true });
  const context = await browser.newContext({ acceptDownloads: true, viewport: { width: 1440, height: 1000 } });
  const page = await context.newPage();
  page.on('request', request => result.network.push({ method: request.method(), url: request.url(), resourceType: request.resourceType() }));
  page.on('console', message => {
    if (['error', 'warning'].includes(message.type())) result.console.push({ type: message.type(), text: message.text() });
  });
  await page.goto(url, { waitUntil: 'networkidle' });

  for (const [id, defenses, ticks] of scenarios) {
    await selectScenario(page, id);
    for (const defense of defenses) {
      const toggle = page.locator(`[data-defense="${defense}"]`);
      await toggle.setChecked(true);
      result.defenses.push({ scenario: id, defense, interactive: await toggle.isChecked() });
    }
    await complete(page, ticks);
    const report = await page.locator('#report-content').innerText();
    for (const defense of defenses) {
      const label = (await page.locator(`[data-defense="${defense}"]`).locator('xpath=ancestor::label').innerText()).split('\n')[0];
      const item = result.defenses.find(x => x.scenario === id && x.defense === defense);
      item.reportContainsDefense = report.toLowerCase().includes(label.toLowerCase());
      item.reportExcerpt = report.split('\n').filter(line => line.toLowerCase().includes(label.toLowerCase())).slice(0, 2);
    }

    const first = await stableReportFacts(page);
    await page.locator('#replay').click();
    await page.waitForTimeout(20);
    if (await page.locator('#pause').getAttribute('aria-pressed') !== 'true') await page.locator('#pause').click();
    for (let i = 0; i < ticks + 1; i++) await page.locator('#step').click();
    const second = await stableReportFacts(page);
    result.replay.push({ scenario: id, stableOutcomeIdentical: JSON.stringify(first) === JSON.stringify(second), first, second });

    if (exportIds.has(id)) {
      for (const kind of ['json', 'csv']) {
        const pending = page.waitForEvent('download');
        await page.locator(`#export-${kind}`).click();
        const download = await pending;
        const filename = download.suggestedFilename();
        const saved = `export-${id}-${kind}-${filename}`;
        await download.saveAs(path.join(outputDir, saved));
        result.exports.push({ scenario: id, kind, filename, saved, failure: await download.failure() });
      }
    }

    for (const defense of defenses) await page.locator(`[data-defense="${defense}"]`).setChecked(false);
    await page.locator('#reset').click();
  }

  await selectScenario(page, 'dos');
  await page.locator('#difficulty').selectOption('Advanced');
  await page.locator('#seed').fill('98765');
  await page.locator('#seed').press('Tab');
  await complete(page, 24);
  const slowFacts = await stableReportFacts(page);
  await page.locator('#reset').click();
  await page.locator('#speed').selectOption('250');
  await complete(page, 24);
  const fastFacts = await stableReportFacts(page);
  result.controls.speedDeterministic = JSON.stringify(slowFacts) === JSON.stringify(fastFacts);
  result.controls.difficulty = await page.locator('#difficulty').inputValue();
  result.controls.seed = await page.locator('#seed').inputValue();
  result.controls.activeScenarioAriaCurrent = await page.locator('[data-scenario="dos"]').getAttribute('aria-current');
  result.controls.uniqueIds = await page.evaluate(() => {
    const ids = [...document.querySelectorAll('[id]')].map(el => el.id);
    return ids.filter((id, i) => ids.indexOf(id) !== i);
  });
  result.controls.headingOutline = await page.locator('h1,h2,h3').evaluateAll(elements => elements.map(e => ({ level: Number(e.tagName[1]), text: e.innerText.trim() })));

  await browser.close();
  fs.writeFileSync(path.join(outputDir, 'ui-test-supplement.json'), JSON.stringify(result, null, 2));
})().catch(error => {
  result.fatal = { message: error.message, stack: error.stack };
  fs.writeFileSync(path.join(outputDir, 'ui-test-supplement.json'), JSON.stringify(result, null, 2));
  console.error(error);
  process.exitCode = 1;
});
