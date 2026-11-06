// @vitest-environment jsdom
import { act, cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SpeedTest } from '../src/SpeedTest';
import { SpeedHistory, SpeedResult } from '../src/SpeedResult';
import { initialState, type NetworkSnapshot, type TestResult } from '../src/domain';
import { SPEED_ORIGIN, type SpeedResult as SpeedMeasurement } from '../src/speed-domain';
import * as speed from '../src/speed';
import * as adapter from '../src/adapter';
vi.mock('../src/speed', () => ({ runSpeedTest: vi.fn() }));
vi.mock('../src/adapter', () => ({ readNetwork: vi.fn(), diagnose: vi.fn() }));
const measured: SpeedMeasurement = {
  id: 'speed-fixture',
  started: '2026-11-05T18:00:00Z',
  profile: 'quick',
  destination: SPEED_ORIGIN,
  latency: [20, 30, 20, 30, 20, 30],
  download: { mbps: 50, bytes: 1e6, elapsedMs: 160, loadedLatency: [100] },
  upload: { mbps: 20, bytes: 1e6, elapsedMs: 400, loadedLatency: [120] },
  issues: [],
};
const probe: TestResult = {
  id: 'probe',
  started: measured.started,
  kind: 'icmp',
  host: '1.1.1.1',
  samples: [10, 20, null, 10],
  intervalMs: 1000,
  addresses: [],
  httpStatus: null,
  detail: 'UNIT TEST',
  source: 'FIXTURE',
};
const network: NetworkSnapshot = {
  timestamp: measured.started,
  connection: 'Ethernet',
  source: 'FIXTURE',
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
  explanation: '',
  networks: [],
};
beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(adapter.readNetwork).mockResolvedValue(network);
  vi.mocked(adapter.diagnose).mockImplementation(async (kind) => ({ ...probe, id: kind, kind }));
  vi.mocked(speed.runSpeedTest).mockResolvedValue(measured);
});
afterEach(cleanup);

describe('speed test user flow', () => {
  it('starts only on click, shows results and atomically saves all three checks', async () => {
    const user = userEvent.setup();
    const save = vi.fn().mockResolvedValue(undefined);
    const onNetwork = vi.fn();
    render(<SpeedTest state={initialState} save={save} onNetwork={onNetwork} />);
    expect(adapter.diagnose).not.toHaveBeenCalled();
    expect(speed.runSpeedTest).not.toHaveBeenCalled();
    await user.selectOptions(screen.getByLabelText('Speed test size'), 'standard');
    await user.click(screen.getByRole('button', { name: 'Run speed test' }));
    await screen.findByText('HTTPS reachability');
    expect(onNetwork).toHaveBeenCalledWith(network);
    expect(save.mock.calls[0][0].speedHistory).toEqual([measured]);
    expect(save.mock.calls[0][0].history).toHaveLength(2);
    expect(speed.runSpeedTest).toHaveBeenCalledWith(expect.objectContaining({ profile: 'standard' }));
    await user.selectOptions(screen.getByLabelText('Speed test size'), 'quick');
  });
  it('keeps completed results visible and retries a failed save', async () => {
    const user = userEvent.setup();
    const save = vi.fn().mockRejectedValueOnce(new Error('Storage full')).mockResolvedValue(undefined);
    render(<SpeedTest state={initialState} save={save} onNetwork={vi.fn()} />);
    await user.click(screen.getByRole('button', { name: 'Run speed test' }));
    await screen.findByText('Storage full');
    await user.click(screen.getByRole('button', { name: 'Retry saving results' }));
    expect(save).toHaveBeenCalledTimes(2);
    expect(screen.queryByRole('alert')).toBeNull();
  });
  it('reports companion failure and permits a fresh run', async () => {
    const user = userEvent.setup();
    vi.mocked(adapter.readNetwork).mockRejectedValueOnce(new Error('Companion unavailable'));
    render(<SpeedTest state={initialState} save={vi.fn()} onNetwork={vi.fn()} />);
    await user.click(screen.getByRole('button', { name: 'Run speed test' }));
    await screen.findByText('Companion unavailable');
    expect(speed.runSpeedTest).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'Run speed test' }));
    await screen.findByText('HTTPS reachability');
  });
  it('cancels an active test without saving and aborts on unmount', async () => {
    const user = userEvent.setup();
    const save = vi.fn();
    let signal: AbortSignal | undefined;
    vi.mocked(speed.runSpeedTest).mockImplementation(({ signal: action, onStage }) => {
      signal = action;
      onStage('Download');
      return new Promise((_, reject) => action.addEventListener('abort', () => reject(new Error('Aborted'))));
    });
    const view = render(<SpeedTest state={initialState} save={save} onNetwork={vi.fn()} />);
    await user.click(screen.getByRole('button', { name: 'Run speed test' }));
    await screen.findByText('Download…');
    await user.click(screen.getByRole('button', { name: 'Cancel test' }));
    expect(signal?.aborted).toBe(true);
    expect(save).not.toHaveBeenCalled();
    await screen.findByText(/Test cancelled/);
    await user.click(screen.getByRole('button', { name: 'Run speed test' }));
    await screen.findByText('Download…');
    await act(async () => view.unmount());
    expect(signal?.aborted).toBe(true);
  });
  it('reports another failed save retry without hiding the result', async () => {
    const user = userEvent.setup();
    render(
      <SpeedTest state={initialState} save={vi.fn().mockRejectedValue(new Error('Still full'))} onNetwork={vi.fn()} />,
    );
    await user.click(screen.getByRole('button', { name: 'Run speed test' }));
    await screen.findByText('Still full');
    await user.click(screen.getByRole('button', { name: 'Retry saving results' }));
    expect(screen.getByRole('alert').textContent).toBe('Still full');
  });
});

describe('saved speed results', () => {
  it('shows empty, unavailable and partial readings truthfully', () => {
    const view = render(<SpeedHistory history={[]} />);
    expect(screen.getByText(/Run a speed test from Overview/)).toBeTruthy();
    view.unmount();
    render(
      <SpeedResult
        result={{
          ...measured,
          latency: Array(6).fill(null),
          download: { ...measured.download, loadedLatency: [] },
          issues: ['DNS unavailable'],
        }}
      />,
    );
    expect(screen.getByText(/Partial result/)).toBeTruthy();
    expect(screen.getByText('0 / 6 probes')).toBeTruthy();
  });
  it('compares matching profiles and exports local CSV', async () => {
    const user = userEvent.setup();
    URL.createObjectURL = vi.fn(() => 'blob:test');
    URL.revokeObjectURL = vi.fn();
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);
    render(<SpeedHistory history={[measured, { ...measured, id: 'extended', profile: 'standard' }]} />);
    await user.selectOptions(screen.getByLabelText('Compare speed profile'), 'standard');
    await user.click(screen.getByRole('button', { name: 'Export speed CSV' }));
    expect(click).toHaveBeenCalledOnce();
    click.mockRestore();
  });
});
