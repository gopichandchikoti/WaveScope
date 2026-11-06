import { chromium } from 'playwright-core';
import { mkdirSync, writeFileSync } from 'node:fs';
import assert from 'node:assert/strict';

const base = 'http://127.0.0.1:5182';
const browser = await chromium.launch({
  executablePath: process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  headless: true,
});
const context = await browser.newContext({ viewport: { width: 1440, height: 1050 } });
await context.addInitScript({ path: 'node_modules/axe-core/axe.min.js' });
const page = await context.newPage();
const evidence = [];
const errors = [];
let outbound = 0;
let failure;
page.on('pageerror', (error) => errors.push(error.message));
page.on('request', (request) => {
  if (request.url().startsWith('https://speed.cloudflare.com/')) outbound++;
});
async function check(name, work) {
  await work();
  evidence.push({ name, result: 'pass' });
}
async function stored() {
  return page.evaluate(
    () =>
      new Promise((resolve, reject) => {
        const open = indexedDB.open('private-workspace-v1', 1);
        open.onerror = () => reject(new Error('Cannot read history'));
        open.onsuccess = () => {
          const db = open.result;
          const request = db.transaction('snapshots').objectStore('snapshots').get('state');
          request.onsuccess = () => {
            resolve(request.result?.value);
            db.close();
          };
        };
      }),
  );
}
mkdirSync('qa', { recursive: true });
try {
  await page.goto(base, { waitUntil: 'networkidle' });
  await page.getByRole('button', { name: 'Run speed test', exact: true }).waitFor();
  assert.equal(outbound, 0, 'Opening Overview must not start external tests');
  await check('live speed test through Chrome, including actual ICMP and DNS', async () => {
    await page.getByRole('button', { name: 'Run speed test', exact: true }).focus();
    await page.keyboard.press('Enter');
    await page.getByText('HTTPS reachability', { exact: true }).waitFor({ timeout: 110000 });
    await page.getByRole('button', { name: 'Run speed test', exact: true }).waitFor({ timeout: 10000 });
    const state = await stored();
    const result = state.speedHistory[0];
    assert.ok(result.download.mbps > 0, JSON.stringify(result.issues));
    assert.ok(result.upload.mbps > 0, JSON.stringify(result.issues));
    assert.equal(result.download.bytes, 13000000);
    assert.equal(result.upload.bytes, 3250000);
    assert.equal(result.latency.filter((value) => value !== null).length, 6);
    assert.equal(result.issues.length, 0);
    assert.equal(state.history[0].kind, 'icmp');
    assert.equal(state.history[1].kind, 'dns');
    evidence.push({
      name: 'live measured values',
      downloadMbps: result.download.mbps,
      uploadMbps: result.upload.mbps,
      httpsSamples: result.latency,
      loadedDownload: result.download.loadedLatency,
      loadedUpload: result.upload.loadedLatency,
      icmpReplies: state.history[0].samples.filter((value) => value !== null).length,
    });
    await page.screenshot({ path: 'qa/speed-results.png', fullPage: true });
    const accessibility = await page.evaluate(async () =>
      globalThis.axe.run(document, {
        runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa'] },
      }),
    );
    assert.equal(accessibility.violations.length, 0, JSON.stringify(accessibility.violations.map((item) => item.id)));
  });
  await check('speed history persists across reload and exports CSV', async () => {
    await page.reload({ waitUntil: 'networkidle' });
    await page.getByRole('link', { name: 'Test history', exact: true }).click();
    await page.locator('.speed-history-item summary').waitFor();
    const event = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Export speed CSV', exact: true }).click();
    assert.equal((await event).suggestedFilename(), 'WaveScope-speed-tests.csv');
    await page.setViewportSize({ width: 320, height: 900 });
    await page.locator('.speed-history-item summary').click();
    const dimensions = await page.evaluate(() => ({
      width: document.documentElement.clientWidth,
      scroll: document.documentElement.scrollWidth,
    }));
    assert.ok(dimensions.scroll <= dimensions.width, JSON.stringify(dimensions));
    await page.screenshot({ path: 'qa/speed-history-320.png', fullPage: true });
    await page.setViewportSize({ width: 1440, height: 1050 });
  });
  await check('cancellation preserves saved history', async () => {
    await page.getByRole('link', { name: 'Overview', exact: true }).click();
    const count = (await stored()).speedHistory.length;
    await page.getByRole('button', { name: 'Run speed test', exact: true }).click();
    await page.getByRole('button', { name: 'Cancel test', exact: true }).click();
    await page.getByText(/Test cancelled/).waitFor();
    await page.getByRole('button', { name: 'Run speed test', exact: true }).waitFor({ timeout: 15000 });
    assert.equal((await stored()).speedHistory.length, count);
  });
  await check('router shortcut preselects the OS gateway when available', async () => {
    const response = await fetch(`${base}/api/network`);
    const network = await response.json();
    if (!network.gateway) {
      evidence.push({ name: 'gateway', availability: 'OS did not provide IPv4 gateway' });
      return;
    }
    await page.getByRole('button', { name: 'Check router latency', exact: true }).click();
    assert.equal(await page.getByLabel('Hostname or IPv4 address', { exact: true }).inputValue(), network.gateway);
  });
  assert.deepEqual(errors, []);
} catch (error) {
  failure = String(error);
  await page.screenshot({ path: 'qa/speed-failure.png', fullPage: true });
  throw error;
} finally {
  writeFileSync(
    'qa/speed-check.json',
    JSON.stringify(
      { at: new Date().toISOString(), evidence, pageErrors: errors, outboundRequests: outbound, failure },
      null,
      2,
    ),
  );
  await browser.close();
}
process.stdout.write(JSON.stringify(evidence, null, 2) + '\n');
