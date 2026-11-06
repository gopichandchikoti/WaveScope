import {
  SPEED_ORIGIN,
  speedProfiles,
  speedResultSchema,
  throughput,
  type SpeedProfile,
  type SpeedResult,
  type TransferResult,
} from './speed-domain';

export type SpeedStage = 'HTTPS latency' | 'Download' | 'Upload';
interface SpeedOptions {
  profile: SpeedProfile;
  signal: AbortSignal;
  onStage: (stage: SpeedStage) => void;
}
const requestOptions = {
  cache: 'no-store',
  credentials: 'omit',
  redirect: 'error',
  referrerPolicy: 'no-referrer',
} satisfies RequestInit;

async function latency(signal: AbortSignal): Promise<number | null> {
  const started = performance.now();
  try {
    const response = await fetch(`${SPEED_ORIGIN}/__down?bytes=0&nonce=${crypto.randomUUID()}`, {
      ...requestOptions,
      signal: AbortSignal.any([signal, AbortSignal.timeout(3000)]),
    });
    const elapsed = performance.now() - started;
    await response.arrayBuffer();
    return response.ok ? elapsed : null;
  } catch {
    signal.throwIfAborted();
    return null;
  }
}

async function consume(response: Response, limit: number) {
  if (!response.ok || !response.body) throw new Error(`Test server rejected the transfer (HTTP ${response.status}).`);
  const reader = response.body.getReader();
  let bytes = 0;
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) return bytes;
      bytes += chunk.value.byteLength;
      if (bytes > limit) throw new Error('Test server exceeded the transfer limit.');
    }
  } finally {
    await reader.cancel();
  }
}

const TRANSFER_TIMEOUT_MS = 8000;

async function sendOne(direction: 'download' | 'upload', size: number, result: TransferResult, signal: AbortSignal) {
  const isUpload = direction === 'upload';
  const body = isUpload ? new Uint8Array(size) : undefined;
  if (body) {
    for (let offset = 0; offset < size; offset += 65536) crypto.getRandomValues(body.subarray(offset, offset + 65536));
  }
  const started = performance.now();
  const requestSignal = AbortSignal.any([signal, AbortSignal.timeout(TRANSFER_TIMEOUT_MS)]);
  const url = `${SPEED_ORIGIN}/${isUpload ? '__up' : `__down?bytes=${size}&nonce=${crypto.randomUUID()}`}`;
  const request = fetch(url, {
    ...requestOptions,
    method: isUpload ? 'POST' : 'GET',
    body,
    signal: requestSignal,
  }).then((response) => consume(response, isUpload ? 65536 : size));
  let active = true;
  const probe = latency(requestSignal).then(
    (value) => {
      if (active) result.loadedLatency.push(value);
    },
    () => undefined,
  );
  try {
    const received = await request;
    if (!isUpload && received !== size) throw new Error('Test download was incomplete.');
    result.bytes += isUpload ? size : received;
    result.elapsedMs += performance.now() - started;
  } finally {
    active = false;
    await probe;
  }
}

function fitsTimeLimit(nextSize: number, done: TransferResult) {
  if (done.elapsedMs <= 0) return true;
  return nextSize / (done.bytes / done.elapsedMs) <= TRANSFER_TIMEOUT_MS * 0.85;
}

async function transfer(direction: 'download' | 'upload', sizes: number[], signal: AbortSignal) {
  const label = direction === 'download' ? 'Download' : 'Upload';
  const result: TransferResult = { mbps: null, bytes: 0, elapsedMs: 0, loadedLatency: [] };
  const notes: string[] = [];
  let completed = 0;
  for (const size of sizes) {
    signal.throwIfAborted();
    if (completed > 0 && !fitsTimeLimit(size, result)) {
      notes.push(
        `${label}: stopped after ${completed} of ${sizes.length} transfers because the link is too slow to finish larger ones in time.`,
      );
      break;
    }
    try {
      await sendOne(direction, size, result, signal);
      completed++;
    } catch (cause) {
      signal.throwIfAborted();
      if (!completed) throw cause;
      const reason = cause instanceof Error ? cause.message : 'Request failed.';
      notes.push(`${label}: stopped after ${completed} of ${sizes.length} transfers (${reason})`);
      break;
    }
  }
  result.mbps = throughput(result.bytes, result.elapsedMs);
  return { result, notes };
}

export async function runSpeedTest({ profile, signal, onStage }: SpeedOptions): Promise<SpeedResult> {
  const bounded = AbortSignal.any([signal, AbortSignal.timeout(80000)]);
  const result: SpeedResult = {
    id: crypto.randomUUID(),
    started: new Date().toISOString(),
    profile,
    destination: SPEED_ORIGIN,
    latency: [],
    download: { mbps: null, bytes: 0, elapsedMs: 0, loadedLatency: [] },
    upload: { mbps: null, bytes: 0, elapsedMs: 0, loadedLatency: [] },
    issues: [],
  };
  onStage('HTTPS latency');
  for (let index = 0; index < 6; index++) result.latency.push(await latency(bounded));
  if (result.latency.some((value) => value === null)) result.issues.push('One or more HTTPS probes failed.');
  for (const direction of ['download', 'upload'] as const) {
    onStage(direction === 'download' ? 'Download' : 'Upload');
    try {
      const measured = await transfer(direction, speedProfiles[profile][direction], bounded);
      result[direction] = measured.result;
      result.issues.push(...measured.notes);
    } catch (cause) {
      bounded.throwIfAborted();
      const reason = cause instanceof Error ? cause.message : 'Request failed.';
      result.issues.push(`${direction === 'download' ? 'Download' : 'Upload'}: ${reason}`);
    }
  }
  bounded.throwIfAborted();
  return speedResultSchema.parse(result);
}
