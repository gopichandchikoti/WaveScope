import { useState } from 'react';
import { Globe, Play, Radio, Search } from 'lucide-react';
import { diagnose } from './adapter';
import { appendResult, validateHost, type State, type TestResult } from './domain';
import { download, errorText } from './storage';
import { Field, SectionTitle } from './ui';
import { Result } from './Result';

export function Diagnostics({
  state,
  save,
  selected,
  defaultHost = '1.1.1.1',
}: {
  state: State;
  save: (state: State) => Promise<void>;
  selected?: TestResult;
  defaultHost?: string;
}) {
  const [kind, setKind] = useState<TestResult['kind']>('icmp');
  const [host, setHost] = useState(defaultHost);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState<TestResult>();
  const active = result ?? selected;
  const start = async () => {
    const invalid = validateHost(host, kind);
    if (invalid) {
      setError(invalid);
      return;
    }
    setBusy(true);
    setError('');
    setResult(undefined);
    try {
      const measured = await diagnose(kind, host, state.settings.count, state.settings.interval);
      setResult(measured);
      try {
        await save(appendResult(state, measured));
      } catch {
        setError('Test completed, but history could not be saved. Export this result before leaving.');
      }
    } catch (cause) {
      setError(errorText(cause));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="stack">
      <section className="panel">
        <SectionTitle
          title="Ask your connection a question"
          detail="Three different tools. Clear destinations. Real measurements."
        />
        <div className="test-modes" role="group" aria-label="Diagnostic type">
          {[
            {
              id: 'icmp' as const,
              label: 'ICMP ping',
              description: 'Latency, loss & jitter',
              icon: <Radio size={19} />,
            },
            { id: 'dns' as const, label: 'DNS lookup', description: 'Resolve a hostname', icon: <Search size={19} /> },
            {
              id: 'http' as const,
              label: 'HTTPS reachability',
              description: 'Check a web endpoint',
              icon: <Globe size={19} />,
            },
          ].map((mode) => (
            <button
              key={mode.id}
              disabled={busy}
              aria-pressed={kind === mode.id}
              className={kind === mode.id ? 'selected' : ''}
              onClick={() => {
                setKind(mode.id);
                setHost(mode.id === 'http' ? 'https://example.com' : mode.id === 'dns' ? 'example.com' : '1.1.1.1');
              }}
            >
              {mode.icon}
              <span>
                <strong>{mode.label}</strong>
                <small>{mode.description}</small>
              </span>
            </button>
          ))}
        </div>
        <form
          className="diagnostic-form"
          onSubmit={(e) => {
            e.preventDefault();
            void start();
          }}
        >
          <Field label={kind === 'http' ? 'HTTPS destination' : 'Hostname or IPv4 address'}>
            <input
              name="destination"
              autoComplete="off"
              value={host}
              onChange={(e) => setHost(e.target.value)}
              required
              maxLength={2000}
              disabled={busy}
            />
          </Field>
          <button type="submit" className="button primary" disabled={busy}>
            <Play size={15} />
            {busy ? 'Measuring…' : 'Run diagnostic'}
          </button>
        </form>
        <div className="destination-notice">
          <Globe size={15} />
          <p>
            Starting this test contacts <strong>{host || 'your chosen destination'}</strong>.
            {kind === 'icmp'
              ? ` ${state.settings.count} ICMP probes at a requested ${state.settings.interval}s interval.`
              : kind === 'dns'
                ? ' Your configured DNS resolver receives this hostname.'
                : ' Sends one HTTPS HEAD request. Redirects are not followed.'}{' '}
            No tests run automatically.
          </p>
        </div>
        {busy && (
          <div role="status" className="notice">
            The OS is collecting real responses. Timeouts may take several seconds.
          </div>
        )}
        {error && (
          <div role="alert" className="notice error">
            {error}
          </div>
        )}
      </section>
      {active && (
        <>
          <Result result={active} />
          <button
            className="button secondary"
            onClick={() => {
              download('WaveScope-result.txt', JSON.stringify(active, null, 2), 'text/plain');
            }}
          >
            Export this result as text
          </button>
        </>
      )}
      <section className="panel prose">
        <h3>A reading is a clue, not a verdict.</h3>
        <p>
          Some hosts block ICMP even when the internet works. DNS duration includes resolver behavior. HTTPS duration
          includes connection and TLS setup. Link speed describes your connection to the access point; it does not
          measure download speed.
        </p>
      </section>
    </div>
  );
}
