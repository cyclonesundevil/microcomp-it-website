const { chromium } = require(process.env.PLAYWRIGHT_CORE_PATH);
const fs = require('fs');
const path = require('path');

(async () => {
  const browser = await chromium.launch({
    executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    headless: true
  });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  await page.goto('http://localhost:8080/demo-lab/cybersecurity-simulation.html', { waitUntil: 'networkidle' });
  await page.locator('#start').click();
  await page.locator('#pause').click();
  for (let i = 0; i < 25; i++) await page.locator('#step').click();

  const count = () => page.locator('#flow-table tr[data-event]').count();
  const first = await page.locator('#flow-table tr[data-event]').first().locator('td').allTextContents();
  const result = { baseline: await count(), sample: first };
  const sourceValue = first[1].replace(/\d{1,3}(?:\.\d{1,3}){3}$/, '');
  const destinationValue = first[2].replace(/\d{1,3}(?:\.\d{1,3}){3}$/, '');
  await page.locator('#filter-source').fill(sourceValue);
  result.source = { value: sourceValue, count: await count() };
  await page.locator('#filter-destination').fill(destinationValue);
  result.sourceDestination = { destination: destinationValue, count: await count() };
  await page.locator('#filter-time').selectOption('5');
  result.combinedWithTime = await count();
  await page.locator('#filter-source').fill('no matching fictional host');
  result.empty = {
    count: await count(),
    text: (await page.locator('#flow-table').innerText()).trim()
  };
  await page.locator('#filter-source').fill('');
  await page.locator('#filter-destination').fill('');
  await page.locator('#filter-time').selectOption('');
  result.restored = await count();

  await browser.close();

  const artifactDir = __dirname;
  const exported = fs.readdirSync(artifactDir).filter(name => /^export-.+\.(json|csv)$/.test(name));
  result.exports = exported.map(name => {
    const content = fs.readFileSync(path.join(artifactDir, name), 'utf8');
    const privateAddress = /\b(?:10\.\d{1,3}\.\d{1,3}\.\d{1,3}|192\.168\.\d{1,3}\.\d{1,3}|172\.(?:1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3})\b/.test(content);
    const dangerousText = /<script|javascript:|password\s*=|authorization:|bearer\s+/i.test(content);
    let csvConsistent = null;
    if (name.endsWith('.csv')) {
      const rows = content.trim().split(/\r?\n/);
      const commas = row => (row.match(/,(?=(?:[^"]*"[^"]*")*[^"]*$)/g) || []).length;
      csvConsistent = rows.every(row => commas(row) === commas(rows[0]));
    }
    let identity;
    if (name.endsWith('.json')) {
      const parsed = JSON.parse(content);
      identity = { scenario: parsed.scenario, seed: parsed.seed, difficulty: parsed.difficulty, synthetic: parsed.synthetic };
    }
    return { name, bytes: Buffer.byteLength(content), privateAddress, dangerousText, csvConsistent, identity };
  });
  fs.writeFileSync(path.join(artifactDir, 'filter-export-validation.json'), JSON.stringify(result, null, 2));
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
