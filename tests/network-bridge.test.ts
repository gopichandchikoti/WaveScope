import { beforeEach, describe, expect, it, vi } from 'vitest';
const device = vi.hoisted(() => ({ native: false, snapshot: vi.fn(), scan: vi.fn(), diagnose: vi.fn() }));
vi.mock('@capacitor/core', () => ({
  Capacitor: { isNativePlatform: () => device.native },
  registerPlugin: () => device,
}));
import { diagnose, readNetwork, scanNetwork } from '../src/adapter';
const snapshot = {
  timestamp: '2026-11-04T12:00:00Z',
  source: 'boundary fixture',
  connection: 'Offline',
  ssid: null,
  bssid: null,
  rssi: null,
  signal: null,
  linkSpeed: null,
  frequency: null,
  channel: null,
  ip: [],
  dns: [],
  vpn: false,
  captive: null,
  validated: null,
  explanation: 'Fixture',
  networks: [],
};
const result = {
  id: 'test',
  kind: 'icmp',
  host: '127.0.0.1',
  started: '2026-11-04T12:00:00Z',
  samples: [1, null],
  intervalMs: 1000,
  addresses: [],
  httpStatus: null,
  detail: 'Fixture',
  source: 'boundary fixture',
};
beforeEach(() => {
  vi.clearAllMocks();
  device.native = false;
});
describe('platform diagnostic boundary', () => {
  it('validates native responses and preserves native errors', async () => {
    device.native = true;
    device.snapshot.mockResolvedValue(snapshot);
    device.scan.mockResolvedValue(snapshot);
    device.diagnose.mockResolvedValue(result);
    expect(await readNetwork()).toEqual(snapshot);
    expect(await scanNetwork()).toEqual(snapshot);
    expect(await diagnose('icmp', '127.0.0.1', 4, 1)).toEqual(result);
    expect(device.diagnose).toHaveBeenCalledWith({ kind: 'icmp', host: '127.0.0.1', count: 4, interval: 1 });
    device.scan.mockRejectedValue(new Error('Permission denied'));
    await expect(scanNetwork()).rejects.toThrow('Permission denied');
    device.snapshot.mockResolvedValue({ fake: true });
    await expect(readNetwork()).rejects.toThrow();
  });
  it('uses same-origin actions and reports deliberate HTTP or connection failures', async () => {
    const fetcher = vi.fn().mockImplementation(async () => new Response(JSON.stringify(snapshot), { status: 200 }));
    vi.stubGlobal('fetch', fetcher);
    expect(await readNetwork()).toEqual(snapshot);
    expect(await scanNetwork()).toEqual(snapshot);
    fetcher.mockResolvedValue(new Response(JSON.stringify(result), { status: 200 }));
    expect(await diagnose('icmp', '127.0.0.1', 4, 1)).toEqual(result);
    expect(fetcher.mock.calls[1][1].headers['X-WaveScope']).toBe('local-action');
    fetcher.mockResolvedValue(new Response(JSON.stringify({ error: { message: 'Busy' } }), { status: 429 }));
    await expect(readNetwork()).rejects.toThrow('Busy');
    fetcher.mockResolvedValue(new Response('{}', { status: 503 }));
    await expect(readNetwork()).rejects.toThrow(/companion/);
    fetcher.mockRejectedValue(new Error('Connection closed'));
    await expect(readNetwork()).rejects.toThrow('Connection closed');
    vi.unstubAllGlobals();
  });
});
