import { Capacitor, registerPlugin } from '@capacitor/core';
import { networkSchema, resultSchema, type TestResult } from './domain';

interface NativeNetwork {
  snapshot(): Promise<unknown>;
  scan(): Promise<unknown>;
  diagnose(options: { kind: string; host: string; count: number; interval: number }): Promise<unknown>;
}
const native = registerPlugin<NativeNetwork>('NetworkTools');
async function request(path: string, body?: unknown) {
  const response = await fetch(`/api/${path}`, {
    method: body ? 'POST' : 'GET',
    headers: body ? { 'Content-Type': 'application/json', 'X-WaveScope': 'local-action' } : {},
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(90000),
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error?.message ?? 'The local companion is unavailable. Start npm run dev.');
  return data;
}
export async function readNetwork() {
  return networkSchema.parse(await (Capacitor.isNativePlatform() ? native.snapshot() : request('network')));
}
export async function scanNetwork() {
  return networkSchema.parse(await (Capacitor.isNativePlatform() ? native.scan() : request('scan', {})));
}
export async function diagnose(kind: TestResult['kind'], host: string, count: number, interval: number) {
  const options = { kind, host, count, interval };
  return resultSchema.parse(await (Capacitor.isNativePlatform() ? native.diagnose(options) : request('test', options)));
}
