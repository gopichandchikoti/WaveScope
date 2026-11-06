import { ArrowDown, ArrowUp, Download, Timer } from 'lucide-react';
import { useState } from 'react';
import { summarize } from './domain';
import { exportSpeed, speedAdvice, type SpeedResult as SpeedMeasurement } from './speed-domain';
import { ms } from './format';
import { download } from './storage';
import { LineChart, Metric, SectionTitle } from './ui';

export function SpeedResult({ result }: { result: SpeedMeasurement }) {
  const idle = summarize(result.latency);
  const loaded = summarize([...result.download.loadedLatency, ...result.upload.loadedLatency]);
  return (
    <div className="speed-results">
      <div className="metrics">
        <Metric
          label="Download"
          value={ms(result.download.mbps)}
          unit="Mbps"
          detail="Single-stream HTTPS throughput"
          icon={<ArrowDown />}
        />
        <Metric
          label="Upload"
          value={ms(result.upload.mbps)}
          unit="Mbps"
          detail="Includes server acknowledgement"
          icon={<ArrowUp />}
        />
        <Metric
          label="HTTPS latency"
          value={ms(idle.average)}
          unit="ms"
          detail="Six header round trips · not ICMP"
          icon={<Timer />}
        />
        <Metric
          label="HTTPS jitter"
          value={ms(idle.jitter)}
          unit="ms"
          detail="Successive successful HTTPS probes"
          icon={<Timer />}
        />
      </div>
      <div className="split-list">
        <div>
          <span>HTTPS reachability</span>
          <strong>
            {idle.received} / {idle.sent} probes
          </strong>
        </div>
        <div>
          <span>Loaded latency · download</span>
          <strong>{ms(summarize(result.download.loadedLatency).average)} ms</strong>
        </div>
        <div>
          <span>Loaded latency · upload</span>
          <strong>{ms(summarize(result.upload.loadedLatency).average)} ms</strong>
        </div>
        <div>
          <span>Latency increase under load</span>
          <strong>
            {ms(loaded.average === null || idle.average === null ? null : loaded.average - idle.average)} ms
          </strong>
        </div>
        <div>
          <span>Measured transfer payload</span>
          <strong>{((result.download.bytes + result.upload.bytes) / 1e6).toFixed(2)} MB</strong>
        </div>
      </div>
      <LineChart values={result.latency} labels={result.latency.map((_, index) => `#${index + 1}`)} unit="ms HTTPS" />
      <p className="notice">{speedAdvice(result)}</p>
      {result.issues.length > 0 && <p role="status">Partial result: {result.issues.join(' ')}</p>}
      <p className="subtle">
        {new Date(result.started).toLocaleString()} · {result.profile} · {result.destination}. HTTPS includes
        browser/TLS/server overhead. Loaded samples are taken only during a transfer; short transfers may produce no
        loaded sample. Failed HTTPS probes are not packet loss. Transferred payload excludes protocol overhead and
        failed transfers.
      </p>
    </div>
  );
}

export function SpeedHistory({ history }: { history: SpeedMeasurement[] }) {
  const [profile, setProfile] = useState('quick');
  const series = history
    .filter((item) => item.profile === profile)
    .slice(0, 10)
    .reverse();
  return (
    <section className="panel">
      <SectionTitle
        title="Speed test notebook"
        detail="Local results, newest first. Compare the same profile."
        action={
          <button
            className="button secondary"
            onClick={() => download('WaveScope-speed-tests.csv', exportSpeed(history), 'text/csv')}
          >
            <Download size={15} />
            Export speed CSV
          </button>
        }
      />
      {history.length ? (
        <>
          <label className="field">
            Compare speed profile
            <select value={profile} onChange={(event) => setProfile(event.target.value)}>
              <option value="quick">Quick</option>
              <option value="standard">Extended</option>
            </select>
          </label>
          <LineChart
            values={series.map((item) => item.download.mbps)}
            labels={series.map((item) => new Date(item.started).toLocaleTimeString())}
            unit={`Mbps download · ${profile}`}
          />
          {history.map((item) => (
            <details className="speed-history-item" key={item.id}>
              <summary>
                {new Date(item.started).toLocaleString()} · {item.profile} · ↓ {ms(item.download.mbps)} / ↑{' '}
                {ms(item.upload.mbps)} Mbps
              </summary>
              <SpeedResult result={item} />
            </details>
          ))}
        </>
      ) : (
        <p className="subtle">Run a speed test from Overview to start comparing your connection.</p>
      )}
    </section>
  );
}
