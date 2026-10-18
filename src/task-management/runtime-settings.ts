import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import type { Context } from '@deepseek-ai/cordis';
import { defineTool } from '@deepseek-ai/dsh-tools';
import type { RedTeamStore } from '../store.js';
import type { TaskLifecycleRuntime } from './integration.js';

export interface TaskAdmissionSettings { enabled: boolean; limit: number }
type Runtime = Pick<TaskLifecycleRuntime, 'setAdmission'>;
const locks = new Map<string, Promise<void>>();
const listeners = new Map<string, Set<Runtime>>();
const defaults: TaskAdmissionSettings = { enabled: false, limit: 5 };
function validate(value: unknown): TaskAdmissionSettings {
  if (!value || typeof value !== 'object' || !('enabled' in value) || typeof value.enabled !== 'boolean'
    || !('limit' in value) || typeof value.limit !== 'number' || !Number.isSafeInteger(value.limit) || value.limit < 1) throw new Error('task admission requires enabled boolean and positive integer limit');
  return { enabled: value.enabled, limit: value.limit };
}

/** Persists settings before notifying every attached agent scope sharing this store directory. */
export class TaskAdmissionRegistry {
  readonly storagePath: string;
  private readonly key: string;
  private readonly fallback: TaskAdmissionSettings;
  constructor(store: Pick<RedTeamStore, 'storagePath'>, fallback: TaskAdmissionSettings = defaults) {
    this.storagePath = resolve(join(dirname(store.storagePath), 'task-admission.json'));
    this.key = process.platform === 'win32' ? this.storagePath.toLowerCase() : this.storagePath;
    this.fallback = validate(fallback);
  }
  private async serial<T>(operation: () => Promise<T>): Promise<T> {
    const operationPromise = (locks.get(this.key) ?? Promise.resolve()).then(operation);
    const settled = operationPromise.then(() => {}, () => {}); locks.set(this.key, settled);
    try { return await operationPromise; } finally { if (locks.get(this.key) === settled) locks.delete(this.key); }
  }
  private async read(): Promise<TaskAdmissionSettings> {
    try {
      const input = JSON.parse(await readFile(this.storagePath, 'utf8'));
      if (input.version !== 1) throw new Error('unsupported task admission configuration version');
      return validate(input);
    } catch (error) { if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return { ...this.fallback }; throw error; }
  }
  get(): Promise<TaskAdmissionSettings> { return this.serial(() => this.read()); }
  attach(runtime: Runtime): Promise<() => void> {
    return this.serial(async () => {
      await runtime.setAdmission(await this.read());
      const subscribers = listeners.get(this.key) ?? new Set<Runtime>(); subscribers.add(runtime); listeners.set(this.key, subscribers);
      return () => { subscribers.delete(runtime); if (!subscribers.size) listeners.delete(this.key); };
    });
  }
  update(patch: Partial<TaskAdmissionSettings>): Promise<TaskAdmissionSettings> {
    return this.serial(async () => {
      const current = await this.read(); const next = validate({ ...current, ...patch });
      const temp = `${this.storagePath}.${randomUUID()}.tmp`;
      await mkdir(dirname(this.storagePath), { recursive: true });
      try { await writeFile(temp, JSON.stringify({ version: 1, ...next }, null, 2), { encoding: 'utf8', mode: 0o600 }); await rename(temp, this.storagePath); }
      finally { await unlink(temp).catch((error: NodeJS.ErrnoException) => { if (error.code !== 'ENOENT') throw error; }); }
      const applied = await Promise.allSettled([...listeners.get(this.key) ?? []].map(runtime => runtime.setAdmission(next)));
      const errors = applied.filter((row): row is PromiseRejectedResult => row.status === 'rejected');
      if (errors.length) throw new AggregateError(errors.map(row => row.reason), 'Task admission settings saved, but runtime reconciliation failed');
      return next;
    });
  }
}

export async function installTaskAdmissionSettings(ctx: Context, store: RedTeamStore, lifecycle: Runtime, fallback?: TaskAdmissionSettings) {
  const registry = new TaskAdmissionRegistry(store, fallback); const detach = await registry.attach(lifecycle);
  const output = { schema: { type: 'json' as const }, render: (_args: unknown, value: unknown) => [{ type: 'text' as const, text: JSON.stringify(value) }] };
  const disposers = [detach,
    ctx.tools.register(defineTool({ name: 'redteam_get_task_concurrency', description: 'Read persisted task admission settings. Disabled by default, with a stored limit of five.', parameters: {}, output,
      execute: async () => ({ ...await registry.get() }) })),
    ctx.tools.register(defineTool({ name: 'redteam_set_task_concurrency', description: 'Persist task concurrency settings and immediately reconcile the FIFO queue in every active scope. Lowering the limit does not cancel running tasks.',
      parameters: { enabled: { type: 'boolean' }, limit: { type: 'number' } }, output,
      execute: async (args: Partial<TaskAdmissionSettings>) => {
        if (args.enabled === undefined && args.limit === undefined) throw new Error('specify enabled or limit');
        return { ...await registry.update({ ...(args.enabled === undefined ? {} : { enabled: args.enabled }), ...(args.limit === undefined ? {} : { limit: args.limit }) }) };
      } })),
  ];
  const dispose = () => { for (const release of disposers.splice(0).reverse()) release(); };
  ctx.effect(() => dispose);
  return { registry, dispose };
}
