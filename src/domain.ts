import { z } from 'zod';
import { speedResultSchema } from './speed-domain';

export const accessPointSchema = z.object({
  ssid: z.string(),
  bssid: z.string().nullable(),
  signal: z.number().nullable(),
  rssi: z.number().nullable(),
  channel: z.number().nullable(),
  frequency: z.number().nullable(),
  security: z.string(),
  timestamp: z.string(),
});
export const networkSchema = z.object({
  timestamp: z.string(),
  source: z.string(),
  connection: z.string(),
  ssid: z.string().nullable(),
  bssid: z.string().nullable(),
  rssi: z.number().nullable(),
  signal: z.number().nullable(),
  linkSpeed: z.number().nullable(),
  frequency: z.number().nullable(),
  channel: z.number().nullable(),
  ip: z.array(z.string()),
  dns: z.array(z.string()),
  gateway: z.string().nullable().optional(),
  vpn: z.boolean(),
  captive: z.boolean().nullable(),
  validated: z.boolean().nullable(),
  explanation: z.string(),
  networks: z.array(accessPointSchema),
});
export const resultSchema = z.object({
  id: z.string().min(1),
  kind: z.enum(['icmp', 'dns', 'http']),
  host: z.string().min(1),
  started: z.string(),
  samples: z.array(z.number().finite().min(0).nullable()).min(1).max(20),
  intervalMs: z.number().min(0),
  addresses: z.array(z.string()),
  httpStatus: z.number().nullable(),
  detail: z.string(),
  source: z.string(),
});
export const stateSchema = z.object({
  version: z.literal(1),
  history: z.array(resultSchema).max(1000),
  speedHistory: z.array(speedResultSchema).max(1000).default([]),
  settings: z.object({
    theme: z.enum(['light', 'dark']),
    interval: z.union([z.literal(1), z.literal(2), z.literal(5)]),
    count: z.union([z.literal(4), z.literal(8), z.literal(12)]),
    retention: z.union([z.literal(100), z.literal(500), z.literal(1000)]),
  }),
});
export type AccessPoint = z.infer<typeof accessPointSchema>;
export type NetworkSnapshot = z.infer<typeof networkSchema>;
export type TestResult = z.infer<typeof resultSchema>;
export type State = z.infer<typeof stateSchema>;
export const initialState: State = {
  version: 1,
  history: [],
  speedHistory: [],
  settings: { theme: 'light', interval: 1, count: 4, retention: 100 },
};
export const parseState = (value: unknown): State => stateSchema.parse(value);

export function validateHost(value: string, kind: TestResult['kind']): string | null {
  if (kind === 'http') {
    try {
      const url = new URL(value);
      if (url.protocol !== 'https:' || url.username || url.password || url.hash || url.port) {
        return 'Use an HTTPS URL without credentials, a port, or a fragment.';
      }
      return validateHost(url.hostname, 'dns');
    } catch {
      return 'Enter a complete HTTPS URL, for example https://example.com.';
    }
  }
  if (value.length > 253 || !/^[a-zA-Z0-9](?:[a-zA-Z0-9.-]*[a-zA-Z0-9])?$/.test(value)) {
    return 'Use a hostname or IPv4 address. Spaces, options and shell characters are not accepted.';
  }
  if (
    value.includes('..') ||
    value.split('.').some((label) => label.length > 63 || label.startsWith('-') || label.endsWith('-'))
  ) {
    return 'Check the hostname labels.';
  }
  if (/^[0-9.]+$/.test(value) && (value.split('.').length !== 4 || value.split('.').some((n) => Number(n) > 255))) {
    return 'Enter a valid IPv4 address.';
  }
  return null;
}

export function summarize(samples: (number | null)[]) {
  const valid = samples.filter((sample): sample is number => sample !== null);
  const changes = valid.slice(1).map((value, index) => Math.abs(value - valid[index]));
  return {
    sent: samples.length,
    received: valid.length,
    lost: samples.length - valid.length,
    loss: samples.length ? ((samples.length - valid.length) / samples.length) * 100 : 0,
    average: valid.length ? valid.reduce((sum, value) => sum + value, 0) / valid.length : null,
    minimum: valid.length ? Math.min(...valid) : null,
    maximum: valid.length ? Math.max(...valid) : null,
    jitter: changes.length ? changes.reduce((sum, value) => sum + value, 0) / changes.length : null,
  };
}
export function signalLabel(rssi: number | null, percent: number | null) {
  if (rssi === null && percent === null) return 'Unavailable';
  const value = rssi === null ? (percent ?? 0) : Math.max(0, Math.min(100, 2 * (rssi + 100)));
  if (value >= 80) return 'Excellent';
  if (value >= 60) return 'Good';
  if (value >= 40) return 'Fair';
  return 'Weak';
}
export function frequencyBand(frequency: number | null) {
  if (frequency === null) return 'Unavailable';
  if (frequency >= 5925) return '6 GHz';
  if (frequency >= 4900) return '5 GHz';
  if (frequency >= 2400) return '2.4 GHz';
  return `${frequency} MHz`;
}
export function appendResult(state: State, result: TestResult): State {
  return { ...state, history: [result, ...state.history].slice(0, state.settings.retention) };
}
export function exportDiagnostics(history: TestResult[]) {
  const rows = [
    ['timestamp', 'type', 'destination', 'average_ms', 'jitter_ms', 'failed_percent', 'samples_ms', 'source'],
  ];
  for (const item of history) {
    const summary = summarize(item.samples);
    rows.push([
      item.started,
      item.kind,
      item.host,
      String(summary.average ?? ''),
      String(summary.jitter ?? ''),
      String(summary.loss),
      item.samples.map((s) => (s === null ? 'timeout' : s.toFixed(2))).join('|'),
      item.source,
    ]);
  }
  return rows.map((row) => row.map((cell) => `"${cell.replaceAll('"', '""')}"`).join(',')).join('\r\n');
}
