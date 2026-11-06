import { useEffect, useState } from 'react';
import {
  Activity,
  Download,
  History as HistoryIcon,
  LayoutDashboard,
  LockKeyhole,
  Radio,
  RefreshCw,
  Settings,
  Wifi,
} from 'lucide-react';
import { readNetwork, scanNetwork } from './adapter';
import {
  exportDiagnostics,
  initialState,
  parseState,
  type NetworkSnapshot,
  type State,
  type TestResult,
} from './domain';
import { useStore } from './useStore';
import { download, errorText } from './storage';
import { Empty, Field, Heading, Modal, SectionTitle, Shell } from './ui';
import { NetworkTable, Overview } from './Views';
import { History } from './History';
import { Privacy } from './Privacy';
import { Diagnostics } from './Diagnostics';
import { SpeedTest } from './SpeedTest';
import { SpeedHistory } from './SpeedResult';

const items = [
  { id: 'overview', label: 'Overview', icon: <LayoutDashboard /> },
  { id: 'networks', label: 'Nearby networks', icon: <Wifi /> },
  { id: 'diagnostics', label: 'Diagnostics', icon: <Activity /> },
  { id: 'history', label: 'Test history', icon: <HistoryIcon /> },
  { id: 'privacy', label: 'Privacy & permissions', icon: <LockKeyhole /> },
  { id: 'settings', label: 'Settings', icon: <Settings /> },
];
const titles: Record<string, [string, string]> = {
  overview: ['A little clarity in the air.', 'Understand your connection. One real measurement at a time.'],
  networks: ['Know your neighborhood.', 'Nearby access points, as reported by your operating system.'],
  diagnostics: ['Find the signal in the noise.', 'Choose a destination. Run a test. Get a clearer answer.'],
  history: ['Every test tells a story.', 'A private notebook of the checks you’ve chosen to run.'],
  privacy: ['Your network. Your business.', 'Exactly what this app reads, keeps, and sends.'],
  settings: ['Tune your toolkit.', 'A few thoughtful settings for the way you troubleshoot.'],
};
export default function App() {
  const { state, save, ready, error, setError } = useStore(initialState, parseState);
  const [page, setPage] = useState(location.hash.slice(1) || 'overview');
  const [network, setNetwork] = useState<NetworkSnapshot>();
  const [refreshing, setRefreshing] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [scanPrompt, setScanPrompt] = useState(false);
  const [clearPrompt, setClearPrompt] = useState(false);
  const [selected, setSelected] = useState<TestResult>();
  const [diagnosticHost, setDiagnosticHost] = useState('1.1.1.1');
  const [monitor, setMonitor] = useState(false);
  useEffect(() => {
    const change = () =>
      setPage(items.some((i) => i.id === location.hash.slice(1)) ? location.hash.slice(1) : 'overview');
    window.addEventListener('hashchange', change);
    return () => window.removeEventListener('hashchange', change);
  }, []);
  const refresh = async () => {
    setRefreshing(true);
    try {
      const result = await readNetwork();
      setNetwork((current) => ({ ...result, networks: current?.networks ?? result.networks }));
      setError('');
    } catch (cause) {
      setError(errorText(cause));
    } finally {
      setRefreshing(false);
    }
  };
  useEffect(() => {
    void refresh();
    const handler = () => {
      void refresh();
    };
    window.addEventListener('online', handler);
    window.addEventListener('offline', handler);
    return () => {
      window.removeEventListener('online', handler);
      window.removeEventListener('offline', handler);
    };
  }, []);
  useEffect(() => {
    if (!monitor) return;
    const timer = setInterval(() => {
      if (document.visibilityState === 'visible') void refresh();
    }, 15000);
    return () => clearInterval(timer);
  }, [monitor]);
  const persist = async (next: State) => {
    await save(next);
  };
  const update = (next: State) => {
    void persist(next).catch((cause) => setError(errorText(cause)));
  };
  const scan = async () => {
    setScanPrompt(false);
    setScanning(true);
    try {
      setNetwork(await scanNetwork());
      setError('');
    } catch (cause) {
      setError(errorText(cause));
    } finally {
      setScanning(false);
    }
  };
  return (
    <Shell
      name="WaveScope"
      subtitle="Connection, understood"
      logo={<Radio size={23} />}
      items={items}
      page={page}
      theme={state.settings.theme}
      onTheme={() =>
        update({
          ...state,
          settings: { ...state.settings, theme: state.settings.theme === 'light' ? 'dark' : 'light' },
        })
      }
      footer={
        <span>
          <span className="status-dot" /> Real measurements. Local history. No analytics.
        </span>
      }
    >
      <Heading
        eyebrow="A SMALL TOOL. A CLEARER CONNECTION."
        title={(titles[page] ?? titles.overview)[0]}
        description={(titles[page] ?? titles.overview)[1]}
        action={
          <>
            <button
              className="button secondary"
              disabled={refreshing}
              onClick={() => {
                void refresh();
              }}
            >
              <RefreshCw size={14} />
              {refreshing ? 'Reading OS…' : 'Refresh connection'}
            </button>
            <a className="button primary" href="#diagnostics">
              <Activity size={15} />
              Run diagnostic
            </a>
          </>
        }
      />
      {error && (
        <div className="notice error" role="alert">
          {error}
          <button className="button secondary" onClick={() => location.reload()}>
            Reload & retry
          </button>
        </div>
      )}
      {!ready && !error ? (
        <Empty title="Opening your toolkit…" text="Loading local preferences and history." />
      ) : (
        <>
          {page === 'overview' && (
            <>
              <SpeedTest state={state} save={persist} onNetwork={setNetwork} />
              <Overview
                network={network}
                history={state.history}
                scanning={scanning}
                scan={() => setScanPrompt(true)}
                router={() => {
                  setDiagnosticHost(network?.gateway ?? '1.1.1.1');
                  setSelected(undefined);
                  location.hash = 'diagnostics';
                }}
              />
            </>
          )}
          {page === 'networks' && (
            <>
              <section className="panel">
                <SectionTitle
                  title="Access points & channels"
                  detail="Results are OS-cached. Frequencies, RSSI and scan availability depend on hardware and permission."
                  action={
                    <button className="button primary" disabled={scanning} onClick={() => setScanPrompt(true)}>
                      <Wifi size={15} />
                      {scanning ? 'Reading…' : 'Read nearby Wi-Fi'}
                    </button>
                  }
                />
                {network ? (
                  <NetworkTable network={network} />
                ) : (
                  <Empty title="Adapter unavailable" text="Refresh the connection or start the local companion." />
                )}
              </section>
              <div className="notice network-explanation">
                {network?.explanation ?? 'No OS data has been received.'}
              </div>
              {network && (
                <section className="panel">
                  <SectionTitle
                    title="Channel occupancy"
                    detail="Count of visible access points per reported channel; not a spectrum analyzer."
                  />
                  <div className="channels">
                    {[...new Set(network.networks.map((ap) => ap.channel).filter((n): n is number => n !== null))]
                      .sort((a, b) => a - b)
                      .map((channel) => {
                        const count = network.networks.filter((ap) => ap.channel === channel).length;
                        return (
                          <div key={channel}>
                            <span>Ch {channel}</span>
                            <div>
                              <span style={{ width: `${Math.min(100, count * 15)}%` }} />
                            </div>
                            <strong>{count} AP</strong>
                          </div>
                        );
                      })}
                    {!network.networks.length && <p className="subtle">No channel data exposed by the OS.</p>}
                  </div>
                </section>
              )}
            </>
          )}
          {page === 'diagnostics' && (
            <Diagnostics state={state} save={persist} selected={selected} defaultHost={diagnosticHost} />
          )}
          {page === 'history' && (
            <>
              <SpeedHistory history={state.speedHistory} />
              <History
                history={state.history}
                clear={() => setClearPrompt(true)}
                select={(item) => {
                  setSelected(item);
                  location.hash = 'diagnostics';
                }}
              />
            </>
          )}
          {page === 'privacy' && <Privacy network={network} />}
          {page === 'settings' && (
            <div className="settings-grid">
              <section className="panel">
                <h2>Measurement settings</h2>
                <Field label="ICMP probe count">
                  <select
                    value={state.settings.count}
                    onChange={(e) =>
                      update(parseState({ ...state, settings: { ...state.settings, count: Number(e.target.value) } }))
                    }
                  >
                    {[4, 8, 12].map((n) => (
                      <option key={n} value={n}>
                        {n} probes
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label="Requested ICMP sampling interval">
                  <select
                    value={state.settings.interval}
                    onChange={(e) =>
                      update(
                        parseState({ ...state, settings: { ...state.settings, interval: Number(e.target.value) } }),
                      )
                    }
                  >
                    {[1, 2, 5].map((n) => (
                      <option key={n} value={n}>
                        {n} second{n > 1 ? 's' : ''}
                      </option>
                    ))}
                  </select>
                  <small>Timeouts can extend the actual interval. No background probes.</small>
                </Field>
                <Field label="Retain most recent tests">
                  <select
                    value={state.settings.retention}
                    onChange={(e) =>
                      update(
                        parseState({
                          ...state,
                          history: state.history.slice(0, Number(e.target.value)),
                          speedHistory: state.speedHistory.slice(0, Number(e.target.value)),
                          settings: { ...state.settings, retention: Number(e.target.value) },
                        }),
                      )
                    }
                  >
                    {[100, 500, 1000].map((n) => (
                      <option key={n} value={n}>
                        {n} tests
                      </option>
                    ))}
                  </select>
                </Field>
              </section>
              <section className="panel">
                <h2>Workspace & monitoring</h2>
                <Field label="Appearance">
                  <select
                    value={state.settings.theme}
                    onChange={(e) =>
                      update(parseState({ ...state, settings: { ...state.settings, theme: e.target.value } }))
                    }
                  >
                    <option value="light">Daylight</option>
                    <option value="dark">Night shift</option>
                  </select>
                </Field>
                <label className="check">
                  <input type="checkbox" checked={monitor} onChange={(e) => setMonitor(e.target.checked)} />
                  Refresh local OS status every 15 seconds
                </label>
                <p>
                  Monitoring runs only while the app is visible. It reads connection status locally and does not start
                  outbound tests or nearby scans. This toggle resets when you relaunch.
                </p>
                <button
                  className="button secondary"
                  onClick={() => download('WaveScope-diagnostics.csv', exportDiagnostics(state.history), 'text/csv')}
                >
                  <Download size={15} />
                  Export history
                </button>
                <button className="button danger" onClick={() => setClearPrompt(true)}>
                  Clear diagnostic history
                </button>
              </section>
            </div>
          )}
        </>
      )}
      {scanPrompt && (
        <Modal title="Read the networks around you?" close={() => setScanPrompt(false)}>
          <p>
            Android may ask for precise location permission because Wi-Fi scan results can reveal your location.
            Location services must also be enabled. Denial keeps the rest of the app usable.
          </p>
          <p>
            Windows returns its cached Wi-Fi list when hardware and Location settings allow it. Nothing is uploaded.
            Scans can be throttled by the operating system.
          </p>
          <div className="actions">
            <button className="button secondary" onClick={() => setScanPrompt(false)}>
              Cancel
            </button>
            <button
              className="button primary"
              onClick={() => {
                void scan();
              }}
            >
              Continue & read Wi-Fi
            </button>
          </div>
        </Modal>
      )}
      {clearPrompt && (
        <Modal title="Clear this notebook?" close={() => setClearPrompt(false)}>
          <p>
            All {state.history.length + state.speedHistory.length} test results will be removed from this device. Export
            a copy first if you need it.
          </p>
          <div className="actions">
            <button className="button secondary" onClick={() => setClearPrompt(false)}>
              Cancel
            </button>
            <button
              className="button primary"
              onClick={() => {
                void persist({ ...state, history: [], speedHistory: [] })
                  .then(() => {
                    setClearPrompt(false);
                    setSelected(undefined);
                  })
                  .catch((cause) => setError(errorText(cause)));
              }}
            >
              Clear history
            </button>
          </div>
        </Modal>
      )}
    </Shell>
  );
}
