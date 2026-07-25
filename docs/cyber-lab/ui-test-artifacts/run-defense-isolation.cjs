const { chromium } = require(process.env.PLAYWRIGHT_CORE_PATH);
const fs = require('fs');
const path = require('path');

const cases = [
  ['dos', 'rateLimiting', 24], ['dos', 'trafficFiltering', 24], ['dos', 'caching', 24],
  ['dos', 'autoscaling', 24], ['dos', 'upstreamProtection', 24], ['sqli', 'waf', 20],
  ['mitm', 'mfa', 20], ['password', 'accountLockout', 20], ['malware', 'segmentation', 20],
  ['mitm', 'encryption', 20], ['malware', 'endpointProtection', 20],
  ['phishing', 'emailFiltering', 20], ['sqli', 'leastPrivilege', 20],
  ['zeroday', 'anomalyDetection', 20], ['mitm', 'ids', 20],
  ['malware', 'patchManagement', 20], ['insider', 'dlp', 20]
];

async function finish(page, ticks) {
  await page.locator('#start').click();
  await page.locator('#pause').click();
  for (let i = 0; i < ticks + 1; i++) await page.locator('#step').click();
}

(async () => {
  const browser = await chromium.launch({
    executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    headless: true
  });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  await page.goto('http://localhost:8080/demo-lab/cybersecurity-simulation.html', { waitUntil: 'networkidle' });
  const results = [];

  for (const [scenario, defense, ticks] of cases) {
    await page.locator(`[data-scenario="${scenario}"]`).click();
    for (const toggle of await page.locator('[data-defense]').all()) await toggle.setChecked(false);
    const selected = page.locator(`[data-defense="${defense}"]`);
    const label = (await selected.locator('xpath=ancestor::label').innerText()).split('\n')[0];
    await selected.setChecked(true);
    await finish(page, ticks);
    const enabledReport = await page.locator('#report-content').innerText();
    const enabledScore = await page.locator('.report-score').innerText();
    await page.locator('#reset').click();
    await selected.setChecked(false);
    await finish(page, ticks);
    const disabledReport = await page.locator('#report-content').innerText();
    const disabledScore = await page.locator('.report-score').innerText();
    results.push({
      scenario, defense, label,
      enabledReportContainsControl: enabledReport.toLowerCase().includes(label.toLowerCase()),
      disabledReportContainsTriggeredControl: disabledReport
        .split(/MISSED DETECTIONS|COVERAGE GAPS|RECOMMENDED/i)[0]
        .toLowerCase().includes(label.toLowerCase()),
      measurableChange: enabledScore !== disabledScore,
      enabledScore, disabledScore
    });
    await page.locator('#reset').click();
  }

  await browser.close();
  fs.writeFileSync(path.join(__dirname, 'defense-isolation-results.json'), JSON.stringify(results, null, 2));
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
