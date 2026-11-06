import { useState } from 'react';
import {
  ArrowDownUp,
  ArrowUpRight,
  Check,
  Globe,
  LockKeyhole,
  Radio,
  Search,
  ShieldCheck,
  Signal,
  Timer,
  Wifi,
} from 'lucide-react';
import { Empty, LineChart, LinkButton, Metric, SectionTitle } from './ui';
import { frequencyBand, signalLabel, summarize, type NetworkSnapshot, type TestResult } from './domain';
import { ms, clock } from './format';

export function Overview({
  network,
  history,
  scanning,
  scan,
  router,
}: {
  network?: NetworkSnapshot;
  history: TestResult[];
  scanning: boolean;
  scan: () => void;
  router?: () => void;
}) {
  const latest = history.find((item) => item.kind === 'icmp');
  const summary = summarize(latest?.samples ?? []);
  return (
    <>
      <section className="connection-hero">
        <div>
          <div className="hero-caption">
            <span className="status-dot" />
            {network ? `OS REPORT · ${network.connection.toUpperCase()}` : 'WAITING FOR LOCAL ADAPTER'}
          </div>
          <h2>
            {network?.ssid ??
              (network
                ? network.connection === 'Offline'
                  ? 'A moment offline.'
                  : 'Your connection, in focus.'
                : 'Let’s get connected.')}
          </h2>
          <p>
            {network?.ssid
              ? 'A clearer view of the network you’re on.'
              : 'SSID is unavailable until the operating system permits access.'}
          </p>
          <div className="connection-meta">
            <span>
              <ShieldCheck size={14} />
              No background traffic inspection
            </span>
            <span>
              <LockKeyhole size={14} />
              Private on this device
            </span>
          </div>
        </div>
        <div className="connection-visual" aria-hidden="true">
          <div className="orbit orbit-one" />
          <div className="orbit orbit-two" />
          <div className="orbit orbit-three" />
          <div className="wifi-center">
            <Wifi size={45} strokeWidth={1.5} />
          </div>
          <span className="visual-label">YOUR NETWORK. A LITTLE CLEARER.</span>
        </div>
      </section>
      <div className="metrics">
        <Metric
          label="Signal strength"
          value={network?.rssi ?? network?.signal ?? '—'}
          unit={
            network?.rssi !== null && network?.rssi !== undefined
              ? 'dBm'
              : network?.signal !== null && network?.signal !== undefined
                ? '%'
                : ''
          }
          detail={signalLabel(network?.rssi ?? null, network?.signal ?? null)}
          icon={<Signal />}
        />
        <Metric
          label="Link speed"
          value={network?.linkSpeed ?? '—'}
          unit="Mbps"
          detail="OS-reported link rate, not internet speed"
          icon={<ArrowDownUp />}
        />
        <Metric
          label="Latest ICMP latency"
          value={ms(summary.average)}
          unit="ms"
          detail={latest ? `To ${latest.host} · ${clock(latest.started)}` : 'Run a diagnostic to measure'}
          icon={<Timer />}
        />
        <Metric
          label="Frequency band"
          value={network?.frequency ? frequencyBand(network.frequency) : '—'}
          detail={network?.channel ? `Channel ${network.channel} · reported by OS` : 'Band / channel unavailable'}
          icon={<Radio />}
        />
      </div>
      <div className="two-columns">
        <section className="panel">
          <SectionTitle
            title="A pulse on your connection"
            detail={
              latest ? `Actual ICMP samples to ${latest.host} · milliseconds` : 'Your most recent ICMP measurement'
            }
            action={<LinkButton to="diagnostics">Run a test</LinkButton>}
          />
          <LineChart
            values={latest?.samples ?? []}
            labels={latest?.samples.map((_, i) => `#${i + 1}`) ?? []}
            unit="ms"
          />
        </section>
        <section className="panel">
          <SectionTitle title="Connection details" action={<Globe size={16} />} />
          <div className="split-list">
            <div>
              <span className="muted">Router / default gateway</span>
              <code>{network?.gateway ?? 'Unavailable'}</code>
            </div>
            <div>
              <span className="muted">Local IP</span>
              <code>{network?.ip[0] ?? 'Unavailable'}</code>
            </div>
            <div>
              <span className="muted">DNS servers</span>
              <code>{network?.dns[0] ?? 'Unavailable'}</code>
            </div>
            <div>
              <span className="muted">BSSID</span>
              <code>{network?.bssid ?? 'Unavailable'}</code>
            </div>
            <div>
              <span className="muted">VPN detected</span>
              <span>{network ? (network.vpn ? 'Yes' : 'Not reported') : 'Unavailable'}</span>
            </div>
            <div>
              <span className="muted">Captive portal</span>
              <span>
                {network?.captive === null || !network ? 'Unavailable' : network.captive ? 'Detected' : 'Not detected'}
              </span>
            </div>
          </div>
          {network?.gateway && router && (
            <button className="button secondary" onClick={router}>
              <Wifi size={14} />
              Check router latency
            </button>
          )}
        </section>
      </div>
      <section className="panel">
        <SectionTitle
          title="Nearby, at a glance"
          detail="Wi-Fi access points exposed by your device’s operating system"
          action={
            <button className="button secondary" disabled={scanning} onClick={scan}>
              <Search size={14} />
              {scanning ? 'Reading…' : 'Read nearby Wi-Fi'}
            </button>
          }
        />
        {network?.networks.length ? (
          <NetworkTable network={network} />
        ) : (
          <div className="nearby-empty">
            <span className="nearby-icon">
              <Wifi size={23} />
            </span>
            <div>
              <h3>The airwaves, with your permission.</h3>
              <p>Request nearby Wi-Fi data when you need it. Location access or OS restrictions may limit results.</p>
            </div>
            <a href="#networks" className="text-link">
              Explore networks
              <ArrowUpRight size={15} />
            </a>
          </div>
        )}
      </section>
      <div className="source-note">
        <Check size={13} />
        {network ? `Source: ${network.source}. Refreshed ${clock(network.timestamp)}.` : 'No measurements yet.'}
        <span>External tests run only when you start them.</span>
      </div>
    </>
  );
}

export function NetworkTable({ network }: { network: NetworkSnapshot }) {
  const [search, setSearch] = useState('');
  const [band, setBand] = useState('all');
  const points = network.networks
    .filter(
      (point) =>
        point.ssid.toLowerCase().includes(search.toLowerCase()) &&
        (band === 'all' || frequencyBand(point.frequency) === band),
    )
    .sort((a, b) => (b.rssi ?? b.signal ?? -999) - (a.rssi ?? a.signal ?? -999));
  return (
    <>
      <div className="toolbar">
        <input
          placeholder="Find an access point…"
          aria-label="Search networks"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <select aria-label="Filter band" value={band} onChange={(e) => setBand(e.target.value)}>
          <option value="all">All bands</option>
          {['2.4 GHz', '5 GHz', '6 GHz', 'Unavailable'].map((b) => (
            <option key={b}>{b}</option>
          ))}
        </select>
      </div>
      {points.length ? (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Network / BSSID</th>
                <th>Signal</th>
                <th>Channel / band</th>
                <th>Security</th>
                <th>Observed</th>
              </tr>
            </thead>
            <tbody>
              {points.map((point, index) => (
                <tr key={`${point.bssid}-${index}`}>
                  <td>
                    <strong>{point.ssid}</strong>
                    <small>{point.bssid ?? 'BSSID unavailable'}</small>
                  </td>
                  <td>
                    <span className="signal-meter">
                      <span
                        style={{
                          width: `${point.signal ?? (point.rssi === null ? 0 : Math.max(0, Math.min(100, 2 * (point.rssi + 100))))}%`,
                        }}
                      />
                    </span>
                    <small>
                      {point.rssi === null
                        ? point.signal === null
                          ? 'Unavailable'
                          : `${point.signal}% · OS-reported`
                        : `${point.rssi} dBm`}{' '}
                      · {signalLabel(point.rssi, point.signal)}
                    </small>
                  </td>
                  <td>
                    {point.channel ?? 'Unavailable'}
                    <small>{frequencyBand(point.frequency)}</small>
                  </td>
                  <td>{point.security}</td>
                  <td>{clock(point.timestamp)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <Empty
          title="No visible access points"
          text="The operating system returned no matching Wi-Fi results. Check permission, Location services, and Wi-Fi hardware."
        />
      )}
    </>
  );
}
