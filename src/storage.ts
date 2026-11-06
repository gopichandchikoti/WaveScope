import { Capacitor, registerPlugin } from '@capacitor/core';

interface Snapshot {
  revision: number;
  value: unknown;
}
interface NativeStore {
  load(): Promise<{ json: string | null }>;
  save(options: { json: string; expected: number }): Promise<void>;
  exportFile(options: { name: string; content: string; type: string }): Promise<void>;
}
const native = registerPlugin<NativeStore>('LocalVault');
const database = 'private-workspace-v1';

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(database, 1);
    request.onupgradeneeded = () => request.result.createObjectStore('snapshots');
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(new Error('Local storage could not open. Check storage permissions.'));
  });
}

export async function loadSnapshot(): Promise<Snapshot | null> {
  if (Capacitor.isNativePlatform()) {
    const result = await native.load();
    return result.json ? JSON.parse(result.json) : null;
  }
  const db = await open();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('snapshots', 'readonly');
    const request = tx.objectStore('snapshots').get('state');
    request.onsuccess = () => resolve(request.result ?? null);
    request.onerror = () => reject(new Error('Could not read your records. Your data has not been replaced.'));
    tx.oncomplete = () => db.close();
  });
}

export async function saveSnapshot(value: unknown, expected: number): Promise<number> {
  const next = { revision: expected + 1, value };
  if (Capacitor.isNativePlatform()) {
    await native.save({ json: JSON.stringify(next), expected });
    return next.revision;
  }
  const db = await open();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('snapshots', 'readwrite');
    const store = tx.objectStore('snapshots');
    const read = store.get('state');
    let conflict = false;
    read.onsuccess = () => {
      if ((read.result?.revision ?? 0) !== expected) {
        conflict = true;
        tx.abort();
        return;
      }
      store.put(next, 'state');
    };
    tx.oncomplete = () => {
      db.close();
      resolve(next.revision);
    };
    tx.onabort = () => {
      db.close();
      reject(
        new Error(
          conflict
            ? 'Another tab changed your records. Reload before saving again.'
            : 'Could not save. Storage may be full. Your previous records are safe.',
        ),
      );
    };
    tx.onerror = () => undefined;
  });
}

export function download(name: string, content: string, type = 'application/json') {
  if (Capacitor.isNativePlatform()) {
    void native.exportFile({ name, content, type }).catch((error) => {
      window.dispatchEvent(new CustomEvent('export-error', { detail: errorText(error) }));
    });
    return;
  }
  const url = URL.createObjectURL(new Blob([content], { type }));
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = name;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function errorText(error: unknown) {
  return error instanceof Error ? error.message : 'Something went wrong. Please try again.';
}
