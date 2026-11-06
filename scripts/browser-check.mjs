import { chromium } from 'playwright-core';
import { mkdirSync, writeFileSync } from 'node:fs';
import assert from 'node:assert/strict';

const base = 'http://127.0.0.1:5182';
const wcag = { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa'] } };
const browser = await chromium.launch({
  executablePath: process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  headless: true,
});
const context = await browser.newContext({ viewport: { width: 1440, height: 1050 } });
await context.addInitScript({ path: 'node_modules/axe-core/axe.min.js' });
const page = await context.newPage();
const evidence = [];
const errors = [];
page.on('pageerror', (error) => errors.push(error.message));
mkdirSync('qa', { recursive: true });
async function check(name, work) {
  await work();
  evidence.push({ name, result: 'pass' });
}
try {
  await page.goto(base, { waitUntil: 'networkidle' });
  await check('actual companion status', async () => {
    await page.getByText('Connection details', { exact: true }).waitFor();
  });
  await check('real ICMP test and persisted history', async () => {
    await page.getByRole('link', { name: 'Diagnostics', exact: true }).click();
    await page.getByLabel('Hostname or IPv4 address', { exact: true }).fill('127.0.0.1');
    await page.getByRole('button', { name: 'Run diagnostic', exact: true }).click();
    await page.getByText('Round-trip latency', { exact: true }).waitFor({ timeout: 30000 });
    await page.getByRole('link', { name: 'Test history', exact: true }).click();
    await page.getByRole('button', { name: 'View results', exact: false }).waitFor();
    await page.reload({ waitUntil: 'networkidle' });
    await page.getByRole('button', { name: 'View results', exact: false }).waitFor();
  });
  await page.getByRole('link', { name: 'Overview', exact: true }).click();
  await page.getByRole('heading', { name: 'A little clarity in the air.', exact: true }).waitFor();
  await check('desktop screenshot and semantic accessibility', async () => {
    await page.screenshot({ path: 'qa/desktop.png', fullPage: true });
    const result = await page.evaluate(async (options) => globalThis.axe.run(document, options), wcag);
    writeFileSync('qa/accessibility.json', JSON.stringify(result.violations, null, 2));
    assert.equal(
      result.violations.length,
      0,
      JSON.stringify(result.violations.map((v) => ({ id: v.id, nodes: v.nodes.map((n) => n.target) }))),
    );
  });
  await check('320px responsive layout', async () => {
    await page.setViewportSize({ width: 320, height: 900 });
    await page.screenshot({ path: 'qa/mobile-320.png', fullPage: true });
    const size = await page.evaluate(() => ({
      width: document.documentElement.clientWidth,
      scroll: document.documentElement.scrollWidth,
    }));
    assert.ok(size.scroll <= size.width, JSON.stringify(size));
  });
  await check('dark theme', async () => {
    await page.setViewportSize({ width: 1440, height: 1050 });
    await page.getByRole('button', { name: 'Dark appearance', exact: true }).click();
    await page.waitForFunction(() => document.documentElement.dataset.theme === 'dark');
    await page.screenshot({ path: 'qa/dark.png', fullPage: true });
    const dark = await page.evaluate(async (options) => globalThis.axe.run(document, options), wcag);
    writeFileSync('qa/accessibility-dark.json', JSON.stringify(dark.violations, null, 2));
    assert.equal(dark.violations.length, 0, JSON.stringify(dark.violations.map((v) => v.id)));
  });
  assert.deepEqual(errors, []);
} finally {
  writeFileSync(
    'qa/browser-check.json',
    JSON.stringify({ at: new Date().toISOString(), evidence, pageErrors: errors }, null, 2),
  );
  await browser.close();
}
process.stdout.write(JSON.stringify(evidence, null, 2) + '\n');
