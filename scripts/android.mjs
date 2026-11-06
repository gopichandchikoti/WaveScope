import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync, mkdirSync, copyFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';

const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
const windows = process.platform === 'win32';
// package.json is the single source of truth. CI overrides these to stamp each preview build.
const versionName = process.env.WAVESCOPE_VERSION_NAME || pkg.version;
const versionCode = process.env.WAVESCOPE_VERSION_CODE || '1';
if (!/^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/.test(versionName)) {
  throw new Error(`WAVESCOPE_VERSION_NAME "${versionName}" must look like 1.2.3 or 1.2.3-build.45.`);
}
if (!/^[1-9]\d{0,8}$/.test(versionCode)) {
  throw new Error(`WAVESCOPE_VERSION_CODE "${versionCode}" must be a positive integer below 2,000,000,000.`);
}
process.env.WAVESCOPE_VERSION_NAME = versionName;
process.env.WAVESCOPE_VERSION_CODE = versionCode;

function run(command, args, cwd = process.cwd()) {
  const result = spawnSync(command, args, { cwd, stdio: 'inherit', shell: windows, env: process.env });
  if (result.status !== 0) process.exit(result.status ?? 1);
}
const jdk = process.env.JAVA_HOME;
const sdk = process.env.ANDROID_HOME;
if (!jdk || !sdk) throw new Error('Set JAVA_HOME to JDK 21 and ANDROID_HOME to the Android SDK.');
writeFileSync('android/local.properties', `sdk.dir=${sdk.replaceAll('\\', '\\\\')}\n`);
copyFileSync(
  'native/NetworkToolsPlugin.java',
  'android/app/src/main/java/com/portfolio/wavescope/NetworkToolsPlugin.java',
);
run(windows ? 'npm.cmd' : 'npm', ['run', 'build']);
run(windows ? 'npx.cmd' : 'npx', ['cap', 'sync', 'android']);
run(windows ? '.\\gradlew.bat' : './gradlew', ['assembleDebug', '--console=plain'], join(process.cwd(), 'android'));

const apk = 'android/app/build/outputs/apk/debug/app-debug.apk';
if (!existsSync(apk) || readFileSync(apk).length < 100000) throw new Error('APK missing or too small.');
mkdirSync('artifacts', { recursive: true });
// The file name is version-agnostic on purpose: the version lives in the APK and in build-evidence.json.
const target = 'artifacts/wavescope-debug.apk';
copyFileSync(apk, target);
const sha256 = createHash('sha256').update(readFileSync(target)).digest('hex');
writeFileSync(`${target}.sha256`, `${sha256}  wavescope-debug.apk\n`);
writeFileSync(
  'artifacts/build-evidence.json',
  JSON.stringify(
    {
      app: pkg.name,
      versionName,
      versionCode: Number(versionCode),
      path: target,
      sha256,
      size: readFileSync(target).length,
      builtAt: new Date().toISOString(),
      commit: process.env.GITHUB_SHA ?? null,
      signing: process.env.WAVESCOPE_KEYSTORE_FILE ? 'stable preview key' : 'per-machine debug key',
      deviceInstall:
        'Build does not install. Run npm run test:android for emulator evidence; physical-phone acceptance is separate.',
    },
    null,
    2,
  ),
);
process.stdout.write(JSON.stringify({ path: target, versionName, versionCode, sha256 }) + '\n');
