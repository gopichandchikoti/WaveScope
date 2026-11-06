// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Overview, NetworkTable } from '../src/Views';
import { History } from '../src/History';
import { Privacy } from '../src/Privacy';
import { Result } from '../src/Result';
import type { NetworkSnapshot, TestResult } from '../src/domain';
const offline: NetworkSnapshot = {
  timestamp: '2026-11-04T12:00:00Z',
  source: 'UNIT TEST FIXTURE',
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
  explanation: 'Unavailable by fixture policy.',
  networks: [],
};
const base: TestResult = {
  id: 'fixture',
  kind: 'icmp',
  host: '127.0.0.1',
  started: '2026-11-04T12:00:00Z',
  samples: [null],
  intervalMs: 1000,
  addresses: [],
  httpStatus: null,
  detail: 'Fixture timeout',
  source: 'UNIT TEST FIXTURE',
};
afterEach(cleanup);
describe('truthful metric and history states', () => {
  it('keeps comparative charts scoped to one test type and destination',async()=>{
    const user=userEvent.setup();render(<History history={[
      {...base,id:'ping-a',host:'a.example',samples:[1]},
      {...base,id:'dns-a',kind:'dns',host:'a.example',samples:[100]},
      {...base,id:'ping-b',host:'b.example',samples:[99]},
      {...base,id:'ping-a-old',host:'a.example',samples:[3]},
    ]} select={()=>undefined} clear={()=>undefined}/>);
    expect(screen.getByRole('img').getAttribute('aria-label')).toContain(': 1.0 ms');
    expect(screen.getByRole('img').getAttribute('aria-label')).not.toContain(': 100.0 ms');
    await user.selectOptions(screen.getByLabelText('Compare measurement series'),'dns:a.example');
    expect(screen.getByRole('img').getAttribute('aria-label')).toContain(': 100.0 ms');
    await user.selectOptions(screen.getByLabelText('Compare measurement series'),'icmp:b.example');
    expect(screen.getByRole('img').getAttribute('aria-label')).toContain(': 99.0 ms');
  });
  it('shows unavailable/offline/VPN/percent and denied capability states without fabricating data', () => {
    const scan = vi.fn();
    const missing = render(<Overview history={[]} scanning={false} scan={scan} />);
    expect(screen.getByText('Let’s get connected.')).toBeTruthy();
    missing.unmount();
    const empty = render(<Overview network={offline} history={[]} scanning={true} scan={scan} />);
    expect(screen.getByText('A moment offline.')).toBeTruthy();
    empty.unmount();
    const vpn = render(
      <Overview
        network={{ ...offline, connection: 'VPN', vpn: true, captive: true, signal: 50 }}
        history={[base]}
        scanning={false}
        scan={scan}
      />,
    );
    expect(screen.getByText('Detected')).toBeTruthy();
    vpn.unmount();
    render(
      <Overview
        network={{ ...offline, connection: 'Ethernet', captive: false, signal: 80, frequency: 2412, channel: 6 }}
        history={[{ ...base, samples: [1, 2] }]}
        scanning={false}
        scan={scan}
      />,
    );
    expect(screen.getByText('Excellent')).toBeTruthy();
  });
  it('filters scans and supports both measured RSSI and OS percent without estimating missing RSSI', async () => {
    const user = userEvent.setup();
    const networks = [
      {
        ssid: 'Fixture percent',
        bssid: null,
        rssi: null,
        signal: 80,
        channel: null,
        frequency: null,
        security: 'Unavailable',
        timestamp: offline.timestamp,
      },
      {
        ssid: 'Fixture missing',
        bssid: 'fixture-missing',
        rssi: null,
        signal: null,
        channel: 6,
        frequency: 2412,
        security: 'WPA2',
        timestamp: offline.timestamp,
      },
      {
        ssid: 'Fixture RSSI',
        bssid: 'fixture-rssi',
        rssi: -80,
        signal: null,
        channel: 36,
        frequency: 5180,
        security: 'WPA2',
        timestamp: offline.timestamp,
      },
    ];
    render(<NetworkTable network={{ ...offline, networks }} />);
    expect(screen.getByText('80% · OS-reported · Excellent')).toBeTruthy();
    await user.selectOptions(screen.getByLabelText('Filter band'), '5 GHz');
    expect(screen.queryByText('Fixture percent')).toBeNull();
    await user.selectOptions(screen.getByLabelText('Filter band'), 'Unavailable');
    expect(screen.getByText('Fixture percent')).toBeTruthy();
    await user.type(screen.getByLabelText('Search networks'), 'nothing matches');
    expect(screen.getByText('No visible access points')).toBeTruthy();
  });
  it('renders DNS/HTTP failures and successful address/status results distinctly from ICMP', () => {
    const dns = render(<Result result={{ ...base, kind: 'dns' }} />);
    expect(screen.getByText('DNS lookup duration')).toBeTruthy();
    expect(screen.getByText('No response')).toBeTruthy();
    dns.unmount();
    const http = render(<Result result={{ ...base, kind: 'http', samples: [20], httpStatus: 200 }} />);
    expect(screen.getByText('HTTP 200')).toBeTruthy();
    http.unmount();
    render(<Result result={{ ...base, kind: 'dns', samples: [4], addresses: ['192.0.2.1', '2001:db8::1'] }} />);
    expect(screen.getByText('2001:db8::1')).toBeTruthy();
  });
  it('exports, filters and opens history without mixing response types implicitly', async () => {
    const user = userEvent.setup();
    const select = vi.fn();
    const clear = vi.fn();
    Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: vi.fn(() => 'blob:test') });
    Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: vi.fn() });
    const anchor = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);
    render(
      <History history={[base, { ...base, id: 'dns', kind: 'dns', samples: [4] }]} select={select} clear={clear} />,
    );
    await user.selectOptions(screen.getByLabelText('Filter history type'), 'dns');
    await user.click(screen.getByRole('button', { name: 'Export CSV' }));
    expect(anchor).toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'View results' }));
    expect(select).toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'Clear history' }));
    expect(clear).toHaveBeenCalled();
    await user.selectOptions(screen.getByLabelText('Filter history type'), 'http');
    expect(screen.getByText('A fresh notebook')).toBeTruthy();
    anchor.mockRestore();
    cleanup();
    render(<Privacy />);
    expect(screen.getByText('Refresh connection status to read adapter capabilities.')).toBeTruthy();
  });
});
