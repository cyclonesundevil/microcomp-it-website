const { chromium } = require(process.env.PLAYWRIGHT_CORE_PATH);
const fs = require('fs');
const path = require('path');

const baseUrl = 'http://localhost:8080/demo-lab/cybersecurity-simulation.html';
const artifactDir = __dirname;
const chromePath = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const axePath = process.env.AXE_CORE_PATH;
const viewports = [
  { name: 'desktop', width: 1440, height: 1000 },
  { name: 'laptop', width: 1280, height: 720 },
  { name: 'tablet', width: 768, height: 1024 },
  { name: 'mobile', width: 390, height: 844 }
];
const scenarios = [
  { id: 'dos', defense: 'rateLimiting', ticks: 24 },
  { id: 'mitm', defense: 'encryption', ticks: 20 },
  { id: 'phishing', defense: 'emailFiltering', ticks: 20 },
  { id: 'malware', defense: 'endpointProtection', ticks: 20 },
  { id: 'sqli', defense: 'waf', ticks: 20 },
  { id: 'zeroday', defense: 'anomalyDetection', ticks: 20 },
  { id: 'xss', defense: 'patchManagement', ticks: 20 },
  { id: 'password', defense: 'accountLockout', ticks: 20 },
  { id: 'apt', defense: 'segmentation', ticks: 28 },
  { id: 'eavesdropping', defense: 'encryption', ticks: 20 },
  { id: 'insider', defense: 'dlp', ticks: 20 }
];

const results = {
  startedAt: new Date().toISOString(),
  browsers: ['Chromium (system Google Chrome)'],
  unavailableBrowsers: ['Firefox (binary unavailable)', 'WebKit (binary unavailable)'],
  viewports,
  initial: [],
  scenarios: [],
  controls: {},
  accessibility: {},
  stress: {},
  console: { errors: [], warnings: [] },
  network: { failed: [], external: [], requests: [] },
  downloads: [],
  defects: []
};

function safeName(value) {
  return value.replace(/[^a-z0-9_-]+/gi, '-').toLowerCase();
}

async function screenshot(page, name) {
  const filename = `${safeName(name)}.png`;
  await page.screenshot({ path: path.join(artifactDir, filename), fullPage: true });
  return filename;
}

async function pageFacts(page) {
  return page.evaluate(() => {
    const all = [...document.querySelectorAll('body *')];
    const visible = all.filter(el => {
      const style = getComputedStyle(el);
      const rect = el.getBoundingClientRect();
      return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0;
    });
    const overflow = visible
      .filter(el => {
        const r = el.getBoundingClientRect();
        return r.right > innerWidth + 2 || r.left < -2;
      })
      .slice(0, 20)
      .map(el => ({ tag: el.tagName, id: el.id, className: String(el.className).slice(0, 100), rect: el.getBoundingClientRect().toJSON() }));
    const ids = [...document.querySelectorAll('[id]')].map(el => el.id);
    return {
      title: document.title,
      h1: document.querySelector('h1')?.textContent.trim(),
      headings: document.querySelectorAll('h1,h2,h3').length,
      buttons: document.querySelectorAll('button').length,
      bodyHorizontalOverflow: document.documentElement.scrollWidth > innerWidth + 2,
      documentWidth: document.documentElement.scrollWidth,
      viewportWidth: innerWidth,
      overflowingElements: overflow,
      duplicateIds: ids.filter((id, index) => ids.indexOf(id) !== index),
      reportHidden: document.querySelector('#report-content')?.hidden,
      topologyPresent: Boolean(document.querySelector('#topology')),
      chartsPresent: document.querySelectorAll('[role="img"], svg').length,
      logsPresent: Boolean(document.querySelector('#flow-table') && document.querySelector('#alert-list'))
    };
  });
}

async function selectScenario(page, id) {
  await page.locator(`[data-scenario="${id}"]`).click();
  await page.waitForTimeout(80);
}

async function finishWithSteps(page, ticks) {
  const pause = page.locator('#pause');
  if (await pause.getAttribute('aria-pressed') !== 'true') await pause.click();
  for (let i = 0; i < ticks + 1; i++) await page.locator('#step').click();
  await page.waitForFunction(() => !document.querySelector('#report-content').hidden, null, { timeout: 5000 });
}

(async () => {
  fs.mkdirSync(artifactDir, { recursive: true });
  const browser = await chromium.launch({ executablePath: chromePath, headless: true });
  const context = await browser.newContext({ acceptDownloads: true });
  const page = await context.newPage();

  page.on('console', message => {
    if (message.type() === 'error') results.console.errors.push(message.text());
    if (message.type() === 'warning') results.console.warnings.push(message.text());
  });
  page.on('pageerror', error => results.console.errors.push(`PAGEERROR: ${error.message}`));
  page.on('requestfailed', request => results.network.failed.push({ url: request.url(), failure: request.failure()?.errorText }));
  page.on('request', request => {
    const url = request.url();
    results.network.requests.push(url);
    if (!url.startsWith('http://localhost:8080/') && !url.startsWith('data:') && !url.startsWith('blob:')) {
      results.network.external.push(url);
    }
  });

  for (const viewport of viewports) {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await page.emulateMedia({ reducedMotion: 'no-preference', colorScheme: 'dark' });
    await page.goto(baseUrl, { waitUntil: 'networkidle' });
    const facts = await pageFacts(page);
    const darkShot = await screenshot(page, `initial-${viewport.name}-dark`);
    await page.locator('[data-theme-toggle]').click();
    const lightShot = await screenshot(page, `initial-${viewport.name}-light`);
    results.initial.push({ viewport: viewport.name, facts, screenshots: [darkShot, lightShot] });
  }

  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(baseUrl, { waitUntil: 'networkidle' });
  await page.locator('#speed').selectOption('250');

  const focusChecks = [];
  for (let i = 0; i < 24; i++) {
    await page.keyboard.press('Tab');
    focusChecks.push(await page.evaluate(() => {
      const el = document.activeElement;
      const style = getComputedStyle(el);
      return {
        tag: el?.tagName,
        id: el?.id,
        label: el?.getAttribute('aria-label') || el?.textContent?.trim().slice(0, 60),
        outline: style.outlineStyle,
        outlineWidth: style.outlineWidth,
        boxShadow: style.boxShadow
      };
    }));
  }
  results.accessibility.keyboardFocusSample = focusChecks;

  if (axePath) {
    await page.addScriptTag({ path: axePath });
    results.accessibility.axe = await page.evaluate(async () => {
      const scan = await axe.run(document, { resultTypes: ['violations', 'incomplete'] });
      return {
        violations: scan.violations.map(v => ({ id: v.id, impact: v.impact, description: v.description, nodes: v.nodes.length, targets: v.nodes.map(n => n.target) })),
        incomplete: scan.incomplete.map(v => ({ id: v.id, impact: v.impact, nodes: v.nodes.length }))
      };
    });
  }

  for (let index = 0; index < scenarios.length; index++) {
    const scenario = scenarios[index];
    await page.locator('#reset').click();
    await selectScenario(page, scenario.id);
    await page.locator('#mode').selectOption(index % 2 ? 'free-play' : 'guided');
    await page.locator('#reduced-motion').setChecked(index % 3 === 0);
    await page.locator('#seed').fill(String(4242 + index));
    await page.locator('#seed').press('Tab');
    await page.locator('#speed').selectOption('250');

    const title = (await page.locator('#brief-title').textContent()).trim();
    const briefing = await screenshot(page, `${scenario.id}-01-briefing`);
    const relevantDefense = page.locator(`[data-defense="${scenario.defense}"]`);
    const defenseVisible = await relevantDefense.isVisible();
    const reportBefore = await page.locator('#report-content').isHidden();

    await page.locator('#start').click();
    await page.waitForTimeout(700);
    const activeStatus = (await page.locator('#run-status').textContent()).trim();
    const active = await screenshot(page, `${scenario.id}-02-active-attack`);

    await relevantDefense.check();
    await page.waitForTimeout(900);
    const defenseText = (await page.locator('#defense-effect-strip').textContent()).trim();
    const defended = await screenshot(page, `${scenario.id}-03-active-defense`);

    await finishWithSteps(page, scenario.ticks);
    const reportText = (await page.locator('#report-content').innerText()).trim();
    const completed = await screenshot(page, `${scenario.id}-04-completed-report`);
    const metricSnapshot = await page.locator('.metric-grid').innerText();
    const outcomeSnapshot = await page.locator('#scenario-outcome-strip').innerText();
    const eventRows = await page.locator('#flow-table tr[data-event]').count();
    const alertCount = await page.locator('#alert-list li').count();

    const firstFinal = reportText;
    await page.locator('#replay').click();
    await page.waitForTimeout(120);
    await finishWithSteps(page, scenario.ticks);
    const replayText = (await page.locator('#report-content').innerText()).trim();

    await page.locator('#reset').click();
    const resetFacts = {
      reportHidden: await page.locator('#report-content').isHidden(),
      events: await page.locator('#flow-table tr[data-event]').count(),
      alertsText: (await page.locator('#alert-count').textContent()).trim(),
      inspector: (await page.locator('#inspector-copy').textContent()).trim(),
      status: (await page.locator('#run-status').textContent()).trim()
    };

    const responsive = {};
    for (const viewport of viewports) {
      await page.setViewportSize({ width: viewport.width, height: viewport.height });
      await selectScenario(page, scenario.id);
      responsive[viewport.name] = await pageFacts(page);
    }
    await page.setViewportSize({ width: 1440, height: 1000 });

    results.scenarios.push({
      id: scenario.id,
      title,
      defense: scenario.defense,
      mode: index % 2 ? 'free-play' : 'guided',
      reducedMotion: index % 3 === 0,
      defenseVisible,
      reportInitiallyHidden: reportBefore,
      activeStatus,
      defenseText,
      reportSpecificity: reportText.slice(0, 1000),
      replayIdentical: firstFinal === replayText,
      metrics: metricSnapshot,
      outcomes: outcomeSnapshot,
      eventRows,
      alertCount,
      reset: resetFacts,
      responsive,
      screenshots: [briefing, active, defended, completed]
    });
  }

  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(baseUrl, { waitUntil: 'networkidle' });
  await page.locator('#speed').selectOption('250');
  await page.locator('#start').click();
  await page.waitForTimeout(800);
  const tickBeforePause = (await page.locator('#run-status').textContent()).trim();
  await page.locator('#pause').click();
  const pauseAria = await page.locator('#pause').getAttribute('aria-pressed');
  const pauseLabel = await page.locator('#pause').getAttribute('aria-label');
  await page.waitForTimeout(700);
  const tickAfterWait = (await page.locator('#run-status').textContent()).trim();
  await page.locator('#step').click();
  const tickAfterStep = (await page.locator('#run-status').textContent()).trim();
  const stillPaused = await page.locator('#pause').getAttribute('aria-pressed');
  await page.locator('#pause').click();
  await page.waitForTimeout(400);
  const tickAfterResume = (await page.locator('#run-status').textContent()).trim();
  results.controls.pauseResumeStep = { tickBeforePause, pauseAria, pauseLabel, tickAfterWait, tickAfterStep, stillPaused, tickAfterResume };

  await finishWithSteps(page, 24);
  const allEvents = await page.locator('#flow-table tr[data-event]').count();
  const protocolOptions = await page.locator('#filter-protocol option').allTextContents();
  if (protocolOptions.length > 1) await page.locator('#filter-protocol').selectOption({ index: 1 });
  const protocolEvents = await page.locator('#flow-table tr[data-event]').count();
  await page.locator('#filter-severity').selectOption('critical');
  const combinedEvents = await page.locator('#flow-table tr[data-event]').count();
  await page.locator('#filter-protocol').selectOption('');
  await page.locator('#filter-severity').selectOption('');
  const restoredEvents = await page.locator('#flow-table tr[data-event]').count();
  results.controls.filters = { allEvents, protocolOptions, protocolEvents, combinedEvents, restoredEvents };

  const host = page.locator('[data-host]').first();
  await host.focus();
  await page.keyboard.press('Enter');
  const hostInspector = (await page.locator('#inspector-copy').innerText()).trim();
  const eventRow = page.locator('#flow-table tr[data-event]').first();
  if (await eventRow.count()) {
    await eventRow.focus();
    await page.keyboard.press('Enter');
  }
  const flowInspector = (await page.locator('#inspector-copy').innerText()).trim();
  results.controls.inspectors = { hostInspector, flowInspector };

  for (const kind of ['json', 'csv']) {
    const downloadPromise = page.waitForEvent('download');
    await page.locator(`#export-${kind}`).click();
    const download = await downloadPromise;
    const target = path.join(artifactDir, download.suggestedFilename());
    await download.saveAs(target);
    results.downloads.push({ kind, filename: download.suggestedFilename(), path: path.basename(target), failure: await download.failure() });
  }

  await page.locator('#mode').selectOption('free-play');
  await page.locator('#reduced-motion').check();
  results.controls.modes = {
    freePlayGuideHidden: await page.locator('#guide-card').isHidden(),
    reducedMotionChecked: await page.locator('#reduced-motion').isChecked(),
    motionStatus: (await page.locator('#motion-status').innerText()).trim()
  };

  const stressStart = Date.now();
  const domCounts = [];
  for (let run = 0; run < 20; run++) {
    const scenario = scenarios[run % scenarios.length];
    await page.locator('#reset').click();
    await selectScenario(page, scenario.id);
    await page.locator('#start').click();
    await page.waitForTimeout(20);
    await finishWithSteps(page, scenario.ticks);
    domCounts.push(await page.locator('body *').count());
  }
  results.stress = {
    runs: 20,
    elapsedMs: Date.now() - stressStart,
    domCounts,
    minDomCount: Math.min(...domCounts),
    maxDomCount: Math.max(...domCounts),
    finalStatus: (await page.locator('#run-status').textContent()).trim()
  };

  results.finishedAt = new Date().toISOString();
  results.network.requests = [...new Set(results.network.requests)];
  results.network.external = [...new Set(results.network.external)];
  fs.writeFileSync(path.join(artifactDir, 'ui-test-results.json'), JSON.stringify(results, null, 2));
  await browser.close();
})().catch(error => {
  results.fatalError = { message: error.message, stack: error.stack };
  fs.writeFileSync(path.join(artifactDir, 'ui-test-results.json'), JSON.stringify(results, null, 2));
  console.error(error);
  process.exitCode = 1;
});
