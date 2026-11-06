import { useEffect, useRef, useState } from 'react';
import { Gauge, Square } from 'lucide-react';
import { diagnose, readNetwork } from './adapter';
import { appendResult, type NetworkSnapshot, type State, type TestResult } from './domain';
import { speedProfiles, type SpeedProfile, type SpeedResult as SpeedMeasurement } from './speed-domain';
import { runSpeedTest } from './speed';
import { errorText } from './storage';
import { Field, SectionTitle } from './ui';
import { Result } from './Result';
import { SpeedResult } from './SpeedResult';

interface SpeedTestProps {
  state: State;
  save: (next: State) => Promise<void>;
  onNetwork: (network: NetworkSnapshot) => void;
}
export function SpeedTest({ state, save, onNetwork }: SpeedTestProps) {
  const [profile, setProfile] = useState<SpeedProfile>('quick');
  const [stage, setStage] = useState('');
  const [error, setError] = useState('');
  const [result, setResult] = useState<SpeedMeasurement>();
  const [ping, setPing] = useState<TestResult>();
  const [unsaved, setUnsaved] = useState<State>();
  const controller = useRef<AbortController | null>(null);
  const latest = useRef(state);
  latest.current = state;
  useEffect(() => () => controller.current?.abort(), []);

  const run = async () => {
    if (controller.current) return;
    const action = new AbortController();
    controller.current = action;
    setError('');
    setResult(undefined);
    setPing(undefined);
    setUnsaved(undefined);
    setStage('Checking connection');
    try {
      const network = await readNetwork();
      action.signal.throwIfAborted();
      onNetwork(network);
      setStage('DNS resolution');
      const dns = await diagnose('dns', 'speed.cloudflare.com', 4, 1);
      action.signal.throwIfAborted();
      setStage('ICMP ping');
      const echo = await diagnose('icmp', '1.1.1.1', 4, 1);
      action.signal.throwIfAborted();
      setPing(echo);
      const measured = await runSpeedTest({ profile, signal: action.signal, onStage: setStage });
      action.signal.throwIfAborted();
      setResult(measured);
      const next = appendResult(appendResult(latest.current, dns), echo);
      next.speedHistory = [measured, ...next.speedHistory].slice(0, next.settings.retention);
      setUnsaved(next);
      await save(next);
      setUnsaved(undefined);
    } catch (cause) {
      if (!action.signal.aborted) setError(errorText(cause));
    } finally {
      if (controller.current === action) {
        controller.current = null;
        setStage('');
      }
    }
  };

  const cancel = () => {
    controller.current?.abort();
    setError('Test cancelled. No partial results were saved. Any in-flight OS ping finishes within its timeout.');
  };
  const retrySave = async () => {
    if (!unsaved) return;
    const next = { ...unsaved, settings: latest.current.settings };
    try {
      await save(next);
      setUnsaved(undefined);
      setError('');
    } catch (cause) {
      setError(errorText(cause));
    }
  };
  return (
    <section className="panel speed-test" aria-label="Internet speed test" aria-busy={Boolean(stage)}>
      <SectionTitle
        title="Put your connection to the test."
        detail="Download, upload, ICMP ping, HTTPS latency, jitter, DNS and loaded latency."
        action={<Gauge size={22} />}
      />
      <div className="speed-controls">
        <Field label="Speed test size">
          <select
            value={profile}
            disabled={Boolean(stage)}
            onChange={(event) => setProfile(event.target.value === 'standard' ? 'standard' : 'quick')}
          >
            {Object.entries(speedProfiles).map(([value, option]) => (
              <option key={value} value={value}>
                {option.label}
              </option>
            ))}
          </select>
        </Field>
        {stage ? (
          <button className="button danger" onClick={cancel}>
            <Square size={14} />
            Cancel test
          </button>
        ) : (
          <button
            className="button primary"
            onClick={() => {
              void run();
            }}
          >
            <Gauge size={16} />
            Run speed test
          </button>
        )}
      </div>
      <p className="subtle">
        Starting sends test traffic directly to speed.cloudflare.com, four ICMP probes to 1.1.1.1, and a DNS lookup
        through your configured resolver. Cloudflare sees your public IP. Payload limit excludes protocol overhead. May
        use mobile data; pause other downloads for a cleaner comparison.
      </p>
      <p className="speed-stage" role="status" aria-live="polite">
        {stage ? `${stage}…` : 'Ready when you are.'}
      </p>
      {error && (
        <p className="notice error" role="alert">
          {error}
        </p>
      )}
      {unsaved && !stage && (
        <button
          className="button secondary"
          onClick={() => {
            void retrySave();
          }}
        >
          Retry saving results
        </button>
      )}
      {result && <SpeedResult result={result} />}
      {ping && <Result result={ping} />}
    </section>
  );
}
