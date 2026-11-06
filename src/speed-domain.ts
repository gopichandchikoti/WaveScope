import { z } from 'zod';

export const SPEED_ORIGIN = 'https://speed.cloudflare.com';
export const speedProfiles = {
  quick: { label: 'Quick · up to 17 MB', download: [1e6, 4e6, 8e6], upload: [250000, 1e6, 2e6] },
  standard: { label: 'Extended · up to 39 MB', download: [2e6, 8e6, 16e6], upload: [1e6, 4e6, 8e6] },
};
export type SpeedProfile = keyof typeof speedProfiles;
const duration = z.number().finite().nonnegative();
export const transferSchema = z.object({
  mbps: duration.nullable(),
  bytes: duration,
  elapsedMs: duration,
  loadedLatency: z.array(duration.nullable()).max(100),
});
export const speedResultSchema = z.object({
  id: z.string().min(1),
  started: z.string(),
  profile: z.enum(['quick', 'standard']),
  destination: z.literal(SPEED_ORIGIN),
  latency: z.array(duration.nullable()).length(6),
  download: transferSchema,
  upload: transferSchema,
  issues: z.array(z.string()),
});
export type SpeedResult = z.infer<typeof speedResultSchema>;
export type TransferResult = z.infer<typeof transferSchema>;

export function throughput(bytes: number, elapsedMs: number) {
  return elapsedMs > 0 ? (bytes * 8) / (elapsedMs * 1000) : null;
}

export function speedAdvice(result: SpeedResult) {
  const valid = result.latency.filter((value): value is number => value !== null);
  if (!valid.length) return 'The test endpoint was unreachable. Check internet access, VPN, or a sign-in portal.';
  if (result.issues.length) {
    return 'Some measurements did not finish, so results use only what completed. Retry or compare with another connection.';
  }
  const idle = valid.reduce((sum, value) => sum + value, 0) / valid.length;
  const loaded = [...result.download.loadedLatency, ...result.upload.loadedLatency].filter(
    (value): value is number => value !== null,
  );
  if (loaded.length && loaded.reduce((sum, value) => sum + value, 0) / loaded.length - idle > 50) {
    return 'Latency rose by over 50 ms under load. Pause heavy transfers or review router queue management.';
  }
  if (idle > 100) return 'HTTPS latency exceeds 100 ms. Compare Ethernet, another Wi-Fi band, or a nearer network.';
  return 'Use repeated tests on Wi-Fi and Ethernet to compare. A single endpoint cannot certify every service.';
}

export function exportSpeed(history: SpeedResult[]) {
  const header = [
    'timestamp',
    'profile',
    'destination',
    'download_mbps',
    'upload_mbps',
    'https_samples_ms',
    'download_loaded_samples_ms',
    'upload_loaded_samples_ms',
    'issues',
  ];
  const rows = history.map((item) => [
    item.started,
    item.profile,
    item.destination,
    String(item.download.mbps ?? ''),
    String(item.upload.mbps ?? ''),
    JSON.stringify(item.latency),
    JSON.stringify(item.download.loadedLatency),
    JSON.stringify(item.upload.loadedLatency),
    item.issues.join('; '),
  ]);
  return [header, ...rows].map((row) => row.map((cell) => `"${cell.replaceAll('"', '""')}"`).join(',')).join('\r\n');
}
