// Verifies a built APK before it is published or installed. Usage:
//   node scripts/verify-apk.mjs <apk> [--version-name 1.2.3] [--version-code 45]
// Needs ANDROID_HOME (for aapt2 and apksigner). Exits non-zero with a clear reason on any mismatch.
import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const windows = process.platform === 'win32';
const args = process.argv.slice(2);
const apk = args[0];
const option = (name) => (args.includes(name) ? args[args.indexOf(name) + 1] : undefined);
const expected = { versionName: option('--version-name'), versionCode: option('--version-code') };
const failures = [];
const fail = (message) => failures.push(message);

if (!apk) throw new Error('Usage: node scripts/verify-apk.mjs <apk> [--version-name X] [--version-code N]');
const sdk = process.env.ANDROID_HOME || process.env.ANDROID_SDK_ROOT;
if (!sdk) throw new Error('Set ANDROID_HOME to the Android SDK directory.');
const tools = join(sdk, 'build-tools');
const newest = readdirSync(tools)
  .filter((name) => /^\d+(\.\d+)*$/.test(name))
  .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))
  .at(-1);
if (!newest) throw new Error(`No Android build-tools found in ${tools}.`);
const tool = (name) => join(tools, newest, windows ? (name === 'apksigner' ? 'apksigner.bat' : `${name}.exe`) : name);
const run = (name, toolArgs) =>
  spawnSync(tool(name), toolArgs, { encoding: 'utf8', shell: windows && name === 'apksigner', timeout: 120000 });

if (!existsSync(apk) || statSync(apk).size < 100000) fail(`${apk} is missing or implausibly small.`);
else {
  const badging = run('aapt2', ['dump', 'badging', apk]);
  const text = badging.stdout ?? '';
  const field = (pattern) => pattern.exec(text)?.[1];
  const found = {
    package: field(/package: name='([^']+)'/),
    versionCode: field(/versionCode='(\d+)'/),
    versionName: field(/versionName='([^']+)'/),
    minSdk: field(/minSdkVersion:'(\d+)'/),
    targetSdk: field(/targetSdkVersion:'(\d+)'/),
    launchable: Boolean(field(/launchable-activity: name='([^']+)'/)),
  };
  if (found.package !== 'com.portfolio.wavescope')
    fail(`Package is ${found.package}, expected com.portfolio.wavescope.`);
  if (!found.launchable) fail('APK has no launchable activity.');
  if (expected.versionName && found.versionName !== expected.versionName) {
    fail(`versionName is ${found.versionName}, expected ${expected.versionName}.`);
  }
  if (expected.versionCode && found.versionCode !== expected.versionCode) {
    fail(`versionCode is ${found.versionCode}, expected ${expected.versionCode}.`);
  }
  const signature = run('apksigner', ['verify', '--verbose', apk]);
  if (!/Verified using v2 scheme \(APK Signature Scheme v2\): true/.test(signature.stdout ?? '')) {
    fail(`APK signature (v2) did not verify: ${(signature.stderr || signature.stdout || '').trim().slice(0, 200)}`);
  }
  process.stdout.write(`${JSON.stringify({ apk, buildTools: newest, ...found, bytes: statSync(apk).size })}\n`);
}
if (failures.length) {
  process.stderr.write(`APK verification failed:\n- ${failures.join('\n- ')}\n`);
  process.exit(1);
}
process.stdout.write('APK verification passed.\n');
