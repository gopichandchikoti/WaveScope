import { chromium } from 'playwright-core';
import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';

const name = 'wavescope';
const appId = `com.portfolio.${name}`;
const serial = process.env.ANDROID_SERIAL;
if (!serial?.startsWith('emulator-')) throw new Error('Set ANDROID_SERIAL to a dedicated test emulator.');
const sdk = process.env.ANDROID_HOME || process.env.ANDROID_SDK_ROOT;
if (!sdk) throw new Error('Set ANDROID_HOME to the Android SDK directory.');
const adb = join(sdk, 'platform-tools', process.platform === 'win32' ? 'adb.exe' : 'adb');
const port = 19582;
const evidence = [];
const cleanupErrors = [];
let forwarded = false;
let failure;
mkdirSync('qa', { recursive: true });
function android(args, binary = false) {
  const result = spawnSync(adb, ['-s', serial, ...args], {
    encoding: binary ? undefined : 'utf8',
    timeout: 60000,
    windowsHide: true,
  });
  if (result.status !== 0) throw new Error(`adb ${args[0]} failed: ${String(result.stderr)}`);
  return result.stdout;
}
async function until(work, timeout = 20000) {
  const start = Date.now();
  let last;
  while (Date.now() - start < timeout) {
    try {
      const value = await work();
      if (value) return value;
    } catch (error) {
      last = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`Android did not become ready: ${String(last ?? 'timed out')}`);
}
async function launch() {
  android(['shell', 'am', 'start', '-W', '-n', `${appId}/.MainActivity`]);
  await until(() =>
    String(android(['shell', 'dumpsys', 'window']))
      .split('\n')
      .find((line) => line.includes('mCurrentFocus='))
      ?.includes(appId),
  );
  const pid = await until(() => String(android(['shell', 'pidof', appId])).trim());
  android(['forward', `tcp:${port}`, `localabstract:webview_devtools_remote_${pid.split(' ')[0]}`]);
  forwarded = true;
  await until(async () => {
    const r = await fetch(`http://127.0.0.1:${port}/json/version`, { signal: AbortSignal.timeout(1000) });
    return r.ok;
  });
  const browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`, { noDefaults: true });
  const page = await until(() => browser.contexts()[0]?.pages()[0]);
  await page.waitForURL(/https?:\/\/localhost/, { timeout: 20000 });
  assert.equal(await page.evaluate(() => window.Capacitor.isNativePlatform()), true);
  return { browser, page };
}
async function check(title, work) {
  await work();
  evidence.push({ title, result: 'pass' });
}
async function database() {
  const bytes = android(['exec-out', 'run-as', appId, 'cat', 'databases/workspace.db'], true);
  const path = resolve('qa/android-workspace.sqlite');
  writeFileSync(path, bytes);
  const db = new DatabaseSync(path, { readOnly: true });
  try {
    const row = db.prepare('SELECT revision,json FROM snapshot WHERE id=1').get();
    assert.ok(row);
    return { revision: row.revision, ...JSON.parse(row.json) };
  } finally {
    db.close();
  }
}
let browser;
let page;
try {
  await check('install actual debug APK on dedicated Android API 35 emulator', async () => {
    const result = android(['install', '-r', resolve(`artifacts/wavescope-debug.apk`)]);
    assert.match(String(result), /Success/);
  });
  ({ browser, page } = await launch());
  await check('native app launch and real SQLite adapter initialization', async () => {
    await page.getByRole('heading', { name: 'A little clarity in the air.' }).waitFor();
    await page.waitForFunction(() => !document.body.textContent.includes('Opening your'));
    assert.equal(await page.getByRole('alert').count(), 0);
  });
  let record;
  await check('Android connection capabilities remain usable without location grant', async () => {
    await page.getByText('Connection details', { exact: true }).waitFor();
    await page.getByText(/Source: Android ConnectivityManager/).waitFor();
    assert.equal(await page.getByRole('alert').count(), 0);
  });
  await check('actual Android ICMP probes and native history save', async () => {
    await page.getByRole('link', { name: 'Diagnostics', exact: true }).click();
    await page.getByLabel('Hostname or IPv4 address', { exact: true }).fill('127.0.0.1');
    await page.getByRole('button', { name: 'Run diagnostic', exact: true }).click();
    await page.getByText('Round-trip latency', { exact: true }).waitFor({ timeout: 30000 });
    record = await database();
    const item = record.value.history[0];
    assert.equal(item.host, '127.0.0.1');
    assert.equal(item.source, 'Android OS');
    assert.equal(item.samples.length, 4);
    assert.ok(item.samples.every((value) => typeof value === 'number'));
  });
  await browser.close();
  browser = undefined;
  android(['shell', 'am', 'force-stop', appId]);
  ({ browser, page } = await launch());
  await check('force-stop/relaunch preserves real SQLite records', async () => {
    await page.getByRole('link', { name: 'Test history', exact: true }).click();
    await page.getByRole('button', { name: 'View results', exact: false }).first().waitFor();
    const saved = await database();
    assert.equal(saved.value.history[0].id, record.value.history[0].id);
  });
  await check('capture actual emulator screenshot and confirm responsive document', async () => {
    const dimensions = await page.evaluate(() => ({
      width: document.documentElement.clientWidth,
      scroll: document.documentElement.scrollWidth,
    }));
    assert.ok(dimensions.scroll <= dimensions.width, JSON.stringify(dimensions));
    await page.waitForFunction(() => !document.body.textContent.includes('Opening your'));
    await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    await page.screenshot({ path: 'qa/android-webview.png' });
    android(['shell', 'input', 'keyevent', '3']);
    android(['shell', 'am', 'start', '-W', '-n', `${appId}/.MainActivity`]);
    await until(() =>
      String(android(['shell', 'dumpsys', 'window']))
        .split('\n')
        .find((line) => line.includes('mCurrentFocus='))
        ?.includes(appId),
    );
    await page.waitForFunction(() => !document.body.textContent.includes('Opening your'));
    await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    writeFileSync('qa/android-api35.png', android(['exec-out', 'screencap', '-p'], true));
  });
} catch (error) {
  failure = String(error);
  throw error;
} finally {
  if (browser) await browser.close().catch((error) => cleanupErrors.push(String(error)));
  try {
    android(['shell', 'am', 'force-stop', appId]);
  } catch (error) {
    cleanupErrors.push(String(error));
  }
  if (forwarded) {
    try {
      android(['forward', '--remove', `tcp:${port}`]);
    } catch (error) {
      cleanupErrors.push(String(error));
    }
  }
  writeFileSync(
    'qa/android-check.json',
    JSON.stringify(
      {
        at: new Date().toISOString(),
        serial,
        sdk: String(android(['shell', 'getprop', 'ro.build.version.sdk'])).trim(),
        model: String(android(['shell', 'getprop', 'ro.product.model'])).trim(),
        physicalDevice: false,
        apkSha256: createHash('sha256').update(readFileSync(`artifacts/wavescope-debug.apk`)).digest('hex'),
        evidence,
        failure,
        cleanupErrors,
      },
      null,
      2,
    ),
  );
}
process.stdout.write(JSON.stringify(evidence, null, 2) + '\n');
