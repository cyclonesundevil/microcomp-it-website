const { chromium } = require(process.env.PLAYWRIGHT_CORE_PATH);
const fs = require('fs');
const path = require('path');

const artifactDir = __dirname;
const url = 'http://localhost:8080/demo-lab/cybersecurity-simulation.html';
const axePath = process.env.AXE_CORE_PATH;
const configurations = [
  ['desktop-dark', 1440, 1000, 'dark'],
  ['desktop-light', 1440, 1000, 'light'],
  ['mobile-dark', 390, 844, 'dark'],
  ['mobile-light', 390, 844, 'light']
];
const results = { configurations: [], startedAt: new Date().toISOString() };

function channel(value) {
  value /= 255;
  return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
}

function luminance(cssColor) {
  const values = cssColor.match(/[\d.]+/g).slice(0, 3).map(Number);
  return (0.2126 * channel(values[0])) + (0.7152 * channel(values[1])) + (0.0722 * channel(values[2]));
}

function contrast(foreground, background) {
  const values = [luminance(foreground), luminance(background)].sort((a, b) => b - a);
  return (values[0] + 0.05) / (values[1] + 0.05);
}

(async () => {
  fs.mkdirSync(artifactDir, { recursive: true });
  const browser = await chromium.launch({
    executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    headless: true
  });

  for (const [name, width, height, theme] of configurations) {
    const context = await browser.newContext({ viewport: { width, height } });
    await context.addInitScript(selectedTheme => localStorage.setItem('microcomp-theme', selectedTheme), theme);
    const page = await context.newPage();
    const consoleMessages = [];
    const pageErrors = [];
    const requests = [];
    const httpErrors = [];
    page.on('console', message => {
      if (['error', 'warning'].includes(message.type())) consoleMessages.push({ type: message.type(), text: message.text() });
    });
    page.on('pageerror', error => pageErrors.push(error.message));
    page.on('request', request => requests.push({ method: request.method(), url: request.url() }));
    const cdp = await context.newCDPSession(page);
    await cdp.send('Network.enable');
    cdp.on('Network.responseReceived', event => {
      if (event.response.status >= 400) httpErrors.push({ status: event.response.status, url: event.response.url });
    });

    await page.goto(url, { waitUntil: 'networkidle' });
    await page.addScriptTag({ path: axePath });
    const axe = await page.evaluate(async () => {
      const scan = await axe.run(document);
      return scan.violations.map(item => ({
        id: item.id,
        impact: item.impact,
        targets: item.nodes.map(node => node.target)
      }));
    });

    const contact = page.locator('.btn-primary').first();
    const buttonStates = {};
    buttonStates.normal = await contact.evaluate(element => {
      const style = getComputedStyle(element);
      return { foreground: style.color, background: style.backgroundColor };
    });
    await contact.hover();
    buttonStates.hover = await contact.evaluate(element => {
      const style = getComputedStyle(element);
      return { foreground: style.color, background: style.backgroundColor };
    });
    await contact.focus();
    buttonStates.focus = await contact.evaluate(element => {
      const style = getComputedStyle(element);
      return { foreground: style.color, background: style.backgroundColor, outline: style.outline, outlineOffset: style.outlineOffset };
    });
    await contact.dispatchEvent('mousedown');
    buttonStates.active = await contact.evaluate(element => {
      const style = getComputedStyle(element);
      return { foreground: style.color, background: style.backgroundColor };
    });
    await contact.dispatchEvent('mouseup');
    for (const state of Object.values(buttonStates)) {
      state.contrast = contrast(state.foreground, state.background);
    }

    await page.locator('#start').click();
    await page.locator('#pause').click();
    const hosts = page.locator('[data-host]');
    const keyboardHosts = [];
    for (let index = 0; index < await hosts.count(); index++) {
      const host = hosts.nth(index);
      await host.focus();
      await page.keyboard.press('Enter');
      keyboardHosts.push({
        label: await host.getAttribute('aria-label'),
        inspectorUpdated: !(await page.locator('#inspector-copy').innerText()).startsWith('Select a host or flow')
      });
    }

    const semantics = await page.evaluate(() => ({
      topologyRole: document.querySelector('#topology').getAttribute('role'),
      topologyLabelledBy: document.querySelector('#topology').getAttribute('aria-labelledby'),
      topologyDescribedBy: document.querySelector('#topology').getAttribute('aria-describedby'),
      topologyButtons: document.querySelectorAll('#topology button[data-host]').length,
      metricTag: document.querySelector('.metric-grid').tagName,
      metricLabelledBy: document.querySelector('.metric-grid').getAttribute('aria-labelledby'),
      filterTag: document.querySelector('.filters').tagName,
      filterLegend: document.querySelector('.filters legend')?.textContent.trim(),
      bodyOverflow: document.documentElement.scrollWidth > innerWidth + 2,
      theme: document.documentElement.dataset.theme
    }));

    await page.evaluate(() => {
      document.activeElement?.blur();
      window.scrollTo(0, 0);
    });
    await page.screenshot({ path: path.join(artifactDir, `${name}.png`), fullPage: true });
    results.configurations.push({
      name, width, height, theme, axe, buttonStates, keyboardHosts, semantics,
      consoleMessages, pageErrors, httpErrors,
      analyticsRequests: requests.filter(request => request.url.includes('/api/track')),
      faviconRequests: requests.filter(request => /favicon/.test(request.url))
    });
    await context.close();
  }

  results.finishedAt = new Date().toISOString();
  fs.writeFileSync(path.join(artifactDir, 'focused-regression-results.json'), JSON.stringify(results, null, 2));
  await browser.close();
})().catch(error => {
  results.fatal = { message: error.message, stack: error.stack };
  fs.writeFileSync(path.join(artifactDir, 'focused-regression-results.json'), JSON.stringify(results, null, 2));
  console.error(error);
  process.exitCode = 1;
});
