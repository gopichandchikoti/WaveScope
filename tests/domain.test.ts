import { describe, expect, it } from 'vitest';
import {
  appendResult,
  exportDiagnostics,
  frequencyBand,
  initialState,
  parseState,
  signalLabel,
  summarize,
  validateHost,
  type TestResult,
} from '../src/domain';
const result: TestResult = {
  id: 'one',
  kind: 'icmp',
  host: '1.1.1.1',
  started: '2026-11-03T12:00:00Z',
  samples: [10, 20, null, 30],
  intervalMs: 1000,
  addresses: [],
  httpStatus: null,
  detail: 'Actual measurements',
  source: 'test fixture',
};
describe('network measurements', () => {
  it('derives latency, loss and mean absolute successive jitter', () => {
    expect(summarize(result.samples)).toEqual({
      sent: 4,
      received: 3,
      lost: 1,
      loss: 25,
      average: 20,
      minimum: 10,
      maximum: 30,
      jitter: 10,
    });
    expect(summarize([])).toEqual({
      sent: 0,
      received: 0,
      lost: 0,
      loss: 0,
      average: null,
      minimum: null,
      maximum: null,
      jitter: null,
    });
    expect(summarize([null]).average).toBeNull();
    expect(summarize([10]).jitter).toBeNull();
  });
  it('validates all destinations before any OS or network call', () => {
    for (const host of ['1.1.1.1', 'example.com', 'localhost', 'a']) expect(validateHost(host, 'icmp')).toBeNull();
    for (const host of [
      '',
      '-x',
      'x;echo',
      'a b',
      'a..b',
      '256.1.1.1',
      '1.2',
      'a'.repeat(254),
      'a'.repeat(64) + '.com',
      'a-.com',
    ]) {
      expect(validateHost(host, 'dns')).not.toBeNull();
    }
    expect(validateHost('https://example.com/', 'http')).toBeNull();
    for (const host of [
      'https://user:pass@example.com',
      'http://example.com',
      'https://example.com:444',
      'https://example.com/#test',
      'garbage',
      'https://256.1.1.1',
    ])
      expect(validateHost(host, 'http')).not.toBeNull();
  });
  it('never invents unavailable signal or frequency', () => {
    expect(signalLabel(null, null)).toBe('Unavailable');
    expect(signalLabel(-50, null)).toBe('Excellent');
    expect(signalLabel(null, 70)).toBe('Good');
    expect(signalLabel(-75, null)).toBe('Fair');
    expect(signalLabel(-90, null)).toBe('Weak');
    expect(frequencyBand(null)).toBe('Unavailable');
    expect(frequencyBand(2412)).toBe('2.4 GHz');
    expect(frequencyBand(5180)).toBe('5 GHz');
    expect(frequencyBand(6000)).toBe('6 GHz');
    expect(frequencyBand(900)).toBe('900 MHz');
  });
  it('caps retained history, validates storage and escapes diagnostics export', () => {
    const full = { ...initialState, history: Array.from({ length: 100 }, (_, i) => ({ ...result, id: String(i) })) };
    expect(appendResult(full, result).history).toHaveLength(100);
    expect(appendResult(initialState, result).history[0]).toEqual(result);
    expect(parseState(initialState)).toEqual(initialState);
    expect(() => parseState({ ...initialState, history: [{ ...result, samples: [-10] }] })).toThrow();
    const csv = exportDiagnostics([result, { ...result, host: 'a"b', samples: [null] }]);
    expect(csv).toContain('a""b');
    expect(csv).toContain('timeout');
    expect(exportDiagnostics([])).toContain('timestamp');
  });
});
