import { readFileSync } from 'node:fs';
import { defineConfig } from 'vitest/config';

const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')) as { version: string };
// package.json is the single source of truth. CI sets WAVESCOPE_VERSION_NAME for build-stamped preview builds.
const appVersion = process.env.WAVESCOPE_VERSION_NAME || pkg.version;

export default defineConfig({
  define: { __APP_VERSION__: JSON.stringify(appVersion) },
  test: {
    testTimeout: 15000,
    maxWorkers: 2,
    include: ['tests/**/*.test.{ts,tsx}'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json-summary', 'html'],
      include: ['src/**/*.{ts,tsx}'],
      thresholds: { lines: 90, functions: 90, branches: 90, statements: 90 },
    },
  },
  build: { target: 'es2022' },
});
