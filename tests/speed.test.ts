import { afterEach, describe, expect, it, vi } from 'vitest';
import { runSpeedTest } from '../src/speed';
import {
  exportSpeed,
  SPEED_ORIGIN,
  speedAdvice,
  speedResultSchema,
  throughput,
  type SpeedResult,
} from '../src/speed-domain';
import { initialState, parseState } from '../src/domain';

const fixture: SpeedResult = {
  id: 'fixture',
  started: '2026-11-05T18:00:00Z',
  profile: 'quick',
  destination: SPEED_ORIGIN,
  latency: [20, 25, 30, 25, null, 20],
  download: { mbps: 50, bytes: 1e6, elapsedMs: 160, loadedLatency: [25, 30] },
  upload: { mbps: 20, bytes: 1e6, elapsedMs: 400, loadedLatency: [30, 35] },
  issues: [],
};

function server(input: string | URL | Request) {
  const url = new URL(String(input));
  const size = Number(url.searchParams.get('bytes'));
  return Promise.resolve(new Response(new Uint8Array(size)));
}
afterEach(() => vi.unstubAllGlobals());

describe('bounded network measurement engine', () => {
  it.each(['quick', 'standard'] as const)('measures actual bytes for %s and sends no credentials', async (profile) => {
    const fetcher = vi.fn(server);
    vi.stubGlobal('fetch', fetcher);
    const stages: string[] = [];
    const result = await runSpeedTest({
      profile,
      signal: new AbortController().signal,
      onStage: (stage) => stages.push(stage),
    });
    expect(stages).toEqual(['HTTPS latency', 'Download', 'Upload']);
    expect(result.latency).toHaveLength(6);
    expect(result.download.bytes).toBe(profile === 'quick' ? 13e6 : 26e6);
    expect(result.upload.bytes).toBe(profile === 'quick' ? 3250000 : 13e6);
    expect(result.download.mbps).toBeGreaterThan(0);
    expect(result.upload.mbps).toBeGreaterThan(0);
    expect(result.issues).toEqual([]);
    for (const args of fetcher.mock.calls) {
      expect(String(args[0])).toMatch(/^https:\/\/speed\.cloudflare\.com\/__(down|up)/);
    }
  });
  it('records unreachable probes and transfer errors as unavailable', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Offline')));
    const result = await runSpeedTest({ profile: 'quick', signal: new AbortController().signal, onStage: vi.fn() });
    expect(result.latency).toEqual(Array(6).fill(null));
    expect(result.download.mbps).toBeNull();
    expect(result.upload.mbps).toBeNull();
    expect(result.issues).toHaveLength(3);
  });
  it('keeps completed download transfers when a larger transfer fails', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn((input: string | URL | Request) =>
        String(input).includes('bytes=8000000') ? Promise.reject(new TypeError('Connection reset')) : server(input),
      ),
    );
    const result = await runSpeedTest({ profile: 'quick', signal: new AbortController().signal, onStage: vi.fn() });
    expect(result.download.bytes).toBe(5e6);
    expect(result.download.mbps).toBeGreaterThan(0);
    expect(result.upload.bytes).toBe(3250000);
    expect(result.issues).toHaveLength(1);
    expect(result.issues[0]).toMatch(/Download.*2 of 3/);
  });
  it('skips larger transfers that a slow link cannot finish within the time limit', async () => {
    let clock = 0;
    const now = vi.spyOn(performance, 'now').mockImplementation(() => clock);
    const fetcher = vi.fn((input: string | URL | Request) => {
      clock += (Number(new URL(String(input)).searchParams.get('bytes')) * 8) / 2000;
      return server(input);
    });
    vi.stubGlobal('fetch', fetcher);
    try {
      const result = await runSpeedTest({ profile: 'quick', signal: new AbortController().signal, onStage: vi.fn() });
      const sizes = fetcher.mock.calls
        .map(([input]) => Number(new URL(String(input)).searchParams.get('bytes')))
        .filter((size) => size > 0);
      expect(sizes).toEqual([1e6]);
      expect(result.download.bytes).toBe(1e6);
      expect(result.download.mbps).toBeCloseTo(2, 1);
      expect(result.upload.bytes).toBe(3250000);
      expect(result.issues).toHaveLength(1);
      expect(result.issues[0]).toMatch(/Download.*1 of 3.*slow/);
    } finally {
      now.mockRestore();
    }
  });
  it('still reports cancellation, not a partial result, when the user stops a later transfer', async () => {
    const action = new AbortController();
    vi.stubGlobal(
      'fetch',
      vi.fn((input: string | URL | Request) => {
        if (String(input).includes('bytes=4000000')) {
          action.abort();
          return Promise.reject(new DOMException('Aborted', 'AbortError'));
        }
        return server(input);
      }),
    );
    await expect(runSpeedTest({ profile: 'quick', signal: action.signal, onStage: vi.fn() })).rejects.toThrow();
  });
  it.each(['http', 'missing', 'oversized', 'short'])('rejects %s transfer responses', async (failure) => {
    vi.stubGlobal(
      'fetch',
      vi.fn((input: string) => {
        if (input.includes('bytes=0')) return Promise.resolve(new Response('', { status: 503 }));
        if (failure === 'http') return Promise.resolve(new Response('', { status: 503 }));
        if (failure === 'missing') return Promise.resolve(new Response(null));
        const size = Number(new URL(input).searchParams.get('bytes'));
        return Promise.resolve(new Response(new Uint8Array(failure === 'oversized' ? size + 100000 : 1)));
      }),
    );
    const result = await runSpeedTest({ profile: 'quick', signal: new AbortController().signal, onStage: vi.fn() });
    expect(result.download.mbps).toBeNull();
    expect(result.issues.length).toBeGreaterThan(1);
  });
  it('honors cancellation during latency and transfers, and never returns a saved result', async () => {
    const action = new AbortController();
    action.abort();
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new DOMException('Aborted', 'AbortError')));
    await expect(runSpeedTest({ profile: 'quick', signal: action.signal, onStage: vi.fn() })).rejects.toThrow();
    const transferAction = new AbortController();
    vi.stubGlobal('fetch', vi.fn(server));
    await expect(
      runSpeedTest({
        profile: 'quick',
        signal: transferAction.signal,
        onStage: (stage) => {
          if (stage === 'Download') transferAction.abort();
        },
      }),
    ).rejects.toThrow();
  });
  it('discards loaded-latency replies that finish after their transfer', async () => {
    let probes = 0;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: string) => {
        if (input.includes('bytes=0') && ++probes > 6) {
          await new Promise((resolve) => setTimeout(resolve, 10));
        }
        return server(input);
      }),
    );
    const result = await runSpeedTest({ profile: 'quick', signal: new AbortController().signal, onStage: vi.fn() });
    expect(result.download.loadedLatency).toEqual([]);
    expect(result.upload.loadedLatency).toEqual([]);
  });
});

describe('speed contracts, advice, migration and export', () => {
  it('validates measured values and reads existing snapshots without losing diagnostics', () => {
    expect(throughput(1e6, 1000)).toBe(8);
    expect(throughput(1, 0)).toBeNull();
    const { speedHistory, ...legacy } = initialState;
    expect(speedHistory).toEqual([]);
    expect(parseState(legacy)).toEqual(initialState);
    expect(() => speedResultSchema.parse({ ...fixture, latency: [NaN] })).toThrow();
    expect(() => speedResultSchema.parse({ ...fixture, download: { ...fixture.download, mbps: -1 } })).toThrow();
  });
  it('explains failed, partial, slow, loaded, and normal measurements without certifying a network', () => {
    expect(speedAdvice({ ...fixture, latency: Array(6).fill(null) })).toContain('unreachable');
    expect(speedAdvice({ ...fixture, issues: ['upload failed'] })).toContain('did not finish');
    expect(speedAdvice({ ...fixture, latency: Array(6).fill(200) })).toContain('exceeds 100');
    expect(speedAdvice({ ...fixture, download: { ...fixture.download, loadedLatency: [200] } })).toContain(
      'over 50 ms',
    );
    expect(
      speedAdvice({
        ...fixture,
        download: { ...fixture.download, loadedLatency: [] },
        upload: { ...fixture.upload, loadedLatency: [null] },
      }),
    ).toContain('repeated tests');
    expect(speedAdvice(fixture)).toContain('repeated tests');
    expect(exportSpeed([{ ...fixture, issues: ['server says "no"'] }])).toContain('""no""');
    expect(
      exportSpeed([
        { ...fixture, download: { ...fixture.download, mbps: null }, upload: { ...fixture.upload, mbps: null } },
      ]),
    ).toContain('"",""');
  });
});
