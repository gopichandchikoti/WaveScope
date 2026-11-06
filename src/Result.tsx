import { LineChart, SectionTitle } from './ui';
import { summarize, type TestResult } from './domain';
import { ms } from './format';
export function Result({ result }: { result: TestResult }) {
  const stats = summarize(result.samples);
  const metric =
    result.kind === 'icmp'
      ? 'Round-trip latency'
      : result.kind === 'dns'
        ? 'DNS lookup duration'
        : 'HTTPS response duration';
  return (
    <section className="panel">
      <SectionTitle
        title={metric}
        detail={`${result.host} · ${new Date(result.started).toLocaleString()} · ${result.source}`}
        action={
          <span className={`tag ${stats.received ? '' : 'warning'}`}>
            {stats.received ? 'Measured' : 'No response'}
          </span>
        }
      />
      <div className="result-stats">
        <div>
          <small>AVERAGE</small>
          <strong>
            {ms(stats.average)} <span>ms</span>
          </strong>
        </div>
        <div>
          <small>{result.kind === 'icmp' ? 'PACKET LOSS' : 'FAILED ATTEMPTS'}</small>
          <strong>
            {stats.loss.toFixed(0)} <span>%</span>
          </strong>
        </div>
        <div>
          <small>JITTER</small>
          <strong>
            {ms(stats.jitter)} <span>ms</span>
          </strong>
        </div>
        <div>
          <small>RESPONSES</small>
          <strong>
            {stats.received}
            <span> / {stats.sent}</span>
          </strong>
        </div>
      </div>
      <LineChart values={result.samples} labels={result.samples.map((_, index) => `#${index + 1}`)} unit="ms" />
      <p className="subtle result-detail">
        {result.detail}{' '}
        {result.kind === 'icmp'
          ? `Requested interval ${result.intervalMs / 1000}s; timeouts can extend cadence. Jitter is the mean absolute difference between successive successful probes.`
          : 'A single request; jitter is unavailable.'}
      </p>
      {result.addresses.length > 0 && (
        <div className="address-results">
          {result.addresses.map((ip) => (
            <code key={ip}>{ip}</code>
          ))}
        </div>
      )}
      {result.httpStatus !== null && <span className="tag">HTTP {result.httpStatus}</span>}
    </section>
  );
}
