import { resolve } from 'node:path';

const tails = new Map<string, Promise<void>>();

/** Serialize traffic rows and their shared blob files for one persisted store. */
export async function withTrafficMutation<T>(storagePath: string, operation: () => Promise<T>): Promise<T> {
  const absolute = resolve(storagePath);
  const key = process.platform === 'win32' ? absolute.toLowerCase() : absolute;
  const preceding = tails.get(key) ?? Promise.resolve();
  const result = preceding.then(operation);
  const settled = result.then(() => undefined, () => undefined);
  tails.set(key, settled);
  try { return await result; }
  finally { if (tails.get(key) === settled) tails.delete(key); }
}
