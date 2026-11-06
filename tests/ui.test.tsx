// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { IDBFactory } from 'fake-indexeddb';
import axe from 'axe-core';
import App from '../src/App';
import { initialState, type NetworkSnapshot, type TestResult } from '../src/domain';
import { saveSnapshot, loadSnapshot } from '../src/storage';
import * as adapter from '../src/adapter';
vi.mock('../src/adapter', () => ({ readNetwork: vi.fn(), scanNetwork: vi.fn(), diagnose: vi.fn() }));
const snapshot: NetworkSnapshot = {
  timestamp: '2026-11-03T12:00:00Z',
  source: 'UNIT TEST FIXTURE',
  connection: 'Wi-Fi',
  ssid: 'Fixture access point',
  bssid: 'aa:bb:cc:dd:ee:ff',
  rssi: -55,
  signal: null,
  linkSpeed: 866,
  frequency: 5180,
  channel: 36,
  ip: ['192.0.2.1'],
  dns: ['192.0.2.53'],
  vpn: false,
  captive: false,
  validated: true,
  explanation: 'Fixture data only.',
  networks: [
    {
      ssid: 'Fixture access point',
      bssid: 'aa:bb:cc:dd:ee:ff',
      rssi: -55,
      signal: null,
      channel: 36,
      frequency: 5180,
      security: 'WPA2',
      timestamp: '2026-11-03T12:00:00Z',
    },
  ],
};
const result: TestResult = {
  id: 'fixture-test',
  kind: 'icmp',
  host: '127.0.0.1',
  started: '2026-11-03T12:00:00Z',
  source: 'UNIT TEST FIXTURE',
  samples: [10, null, 20, 15],
  intervalMs: 1000,
  addresses: [],
  httpStatus: null,
  detail: 'Fixture probes.',
};
beforeEach(() => {
  globalThis.indexedDB = new IDBFactory();
  location.hash = '';
  vi.clearAllMocks();
  vi.mocked(adapter.readNetwork).mockResolvedValue(snapshot);
  vi.mocked(adapter.scanNetwork).mockResolvedValue(snapshot);
  vi.mocked(adapter.diagnose).mockResolvedValue(result);
  HTMLDialogElement.prototype.showModal = function () {
    this.open = true;
  };
  HTMLDialogElement.prototype.close = function () {
    this.open = false;
  };
});
afterEach(cleanup);
async function navigate(page: string) {
  location.hash = page;
  fireEvent(window, new Event('hashchange'));
}
describe('WaveScope user journeys (DOM with explicit adapter fixtures)', () => {
  it('handles connection failures, permission denial, foreground monitoring and alternate diagnostics', async () => {
    const user = userEvent.setup();
    vi.mocked(adapter.readNetwork).mockRejectedValueOnce(new Error('OS adapter unavailable'));
    render(<App />);
    await screen.findByText('OS adapter unavailable');
    await user.click(screen.getByRole('button', { name: 'Refresh connection' }));
    await screen.findByRole('heading', { name: 'Fixture access point' });
    fireEvent(window, new Event('online'));
    await waitFor(() => expect(adapter.readNetwork).toHaveBeenCalledTimes(3));
    await user.click(screen.getByRole('button', { name: 'Read nearby Wi-Fi' }));
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    await user.click(screen.getByRole('button', { name: 'Read nearby Wi-Fi' }));
    await user.click(screen.getByRole('button', { name: 'Close dialog' }));
    vi.mocked(adapter.scanNetwork).mockRejectedValueOnce(new Error('Location denied'));
    await user.click(screen.getByRole('button', { name: 'Read nearby Wi-Fi' }));
    await user.click(screen.getByRole('button', { name: 'Continue & read Wi-Fi' }));
    await screen.findByText('Location denied');
    await navigate('history');
    await screen.findByText('Your test notebook');
    await user.click(screen.getByRole('button', { name: 'Clear history' }));
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    await user.click(screen.getByRole('button', { name: 'Clear history' }));
    await user.click(screen.getByRole('button', { name: 'Close dialog' }));
    await navigate('settings');
    await screen.findByText('Measurement settings');
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' });
    fireEvent.click(screen.getByLabelText('Refresh local OS status every 15 seconds'));
    const before = vi.mocked(adapter.readNetwork).mock.calls.length;
    await act(async () => {
      await vi.advanceTimersByTimeAsync(15000);
    });
    expect(vi.mocked(adapter.readNetwork).mock.calls.length).toBeGreaterThan(before);
    fireEvent.click(screen.getByLabelText('Refresh local OS status every 15 seconds'));
    vi.useRealTimers();
    Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: vi.fn(() => 'blob:test') });
    Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: vi.fn() });
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);
    await user.click(screen.getByRole('button', { name: 'Export history' }));
    expect(click).toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'Dark appearance' }));
    await waitFor(() => expect(document.documentElement.dataset.theme).toBe('dark'));
    await navigate('diagnostics');
    await screen.findByLabelText('Hostname or IPv4 address');
    vi.mocked(adapter.diagnose).mockRejectedValueOnce(new Error('Probe adapter unavailable'));
    await user.click(screen.getByRole('button', { name: 'Run diagnostic' }));
    await screen.findByText('Probe adapter unavailable');
    await user.click(screen.getByRole('button', { name: /DNS lookup/ }));
    vi.mocked(adapter.diagnose).mockResolvedValueOnce({
      ...result,
      kind: 'dns',
      id: 'dns-test',
      samples: [3],
      addresses: ['192.0.2.2'],
    });
    await user.click(screen.getByRole('button', { name: 'Run diagnostic' }));
    await screen.findByText('DNS lookup duration');
    await user.click(screen.getByRole('button', { name: 'Export this result as text' }));
    await user.click(screen.getByRole('button', { name: /HTTPS reachability/ }));
    vi.mocked(adapter.diagnose).mockResolvedValueOnce({
      ...result,
      kind: 'http',
      id: 'http-test',
      samples: [6],
      httpStatus: 200,
    });
    await user.click(screen.getByRole('button', { name: 'Run diagnostic' }));
    await screen.findByText('HTTP 200');
    click.mockRestore();
  });
  it('requires user action to diagnose and persists the measured result', async () => {
    const user = userEvent.setup();
    render(<App />);
    await screen.findByRole('heading', { name: 'Fixture access point' });
    expect(adapter.diagnose).not.toHaveBeenCalled();
    await navigate('diagnostics');
    await screen.findByLabelText('Hostname or IPv4 address');
    await user.clear(screen.getByLabelText('Hostname or IPv4 address'));
    await user.type(screen.getByLabelText('Hostname or IPv4 address'), 'x;bad');
    await user.click(screen.getByRole('button', { name: 'Run diagnostic' }));
    expect(adapter.diagnose).not.toHaveBeenCalled();
    await user.clear(screen.getByLabelText('Hostname or IPv4 address'));
    await user.type(screen.getByLabelText('Hostname or IPv4 address'), '127.0.0.1');
    await user.click(screen.getByRole('button', { name: 'Run diagnostic' }));
    await screen.findByText('Round-trip latency');
    expect(adapter.diagnose).toHaveBeenCalledWith('icmp', '127.0.0.1', 4, 1);
    await waitFor(async () => expect(JSON.stringify((await loadSnapshot())?.value)).toContain('fixture-test'));
    await navigate('history');
    await screen.findByText('Your test notebook');
    await user.click(screen.getByRole('button', { name: 'View results' }));
    await screen.findByText('Round-trip latency');
    await user.click(screen.getByRole('button', { name: /DNS lookup/ }));
    await user.click(screen.getByRole('button', { name: /HTTPS reachability/ }));
  });
  it('supports permission disclosure, filtering, settings and destructive-history confirmation', async () => {
    await saveSnapshot({ ...initialState, history: [result] }, 0);
    const user = userEvent.setup();
    render(<App />);
    await screen.findByRole('heading', { name: 'Fixture access point' });
    const accessibility = await axe.run(document.body, {
      rules: { 'color-contrast': { enabled: false }, 'label-content-name-mismatch': { enabled: false } },
    });
    expect(accessibility.violations.map((item) => item.id)).toEqual([]);
    await navigate('networks');
    await screen.findByText('Access points & channels');
    await user.click(screen.getByRole('button', { name: 'Read nearby Wi-Fi' }));
    expect(adapter.scanNetwork).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'Continue & read Wi-Fi' }));
    await waitFor(() => expect(adapter.scanNetwork).toHaveBeenCalled());
    await user.type(screen.getByRole('textbox', { name: 'Search networks' }), 'absent');
    await screen.findByText('No visible access points');
    await navigate('privacy');
    await screen.findByText('Read locally, kept locally');
    await navigate('settings');
    await screen.findByText('Measurement settings');
    await user.selectOptions(screen.getByLabelText('ICMP probe count'), '8');
    await user.selectOptions(screen.getByLabelText('Requested ICMP sampling interval'), '2');
    await user.selectOptions(screen.getByLabelText('Retain most recent tests'), '500');
    await user.selectOptions(screen.getByLabelText('Appearance'), 'dark');
    await waitFor(() => expect(document.documentElement.dataset.theme).toBe('dark'));
    await user.click(screen.getByRole('button', { name: 'Clear diagnostic history' }));
    await user.click(screen.getByRole('button', { name: 'Clear history' }));
    await waitFor(async () => {
      const saved = await loadSnapshot();
      expect(JSON.stringify(saved?.value)).not.toContain('fixture-test');
    });
  });
});
