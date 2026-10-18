import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { defineTool } from '@deepseek-ai/dsh-tools';
const locks = new Map();
const listeners = new Map();
const defaults = { enabled: false, limit: 5 };
function validate(value) {
    if (!value || typeof value !== 'object' || !('enabled' in value) || typeof value.enabled !== 'boolean'
        || !('limit' in value) || typeof value.limit !== 'number' || !Number.isSafeInteger(value.limit) || value.limit < 1)
        throw new Error('task admission requires enabled boolean and positive integer limit');
    return { enabled: value.enabled, limit: value.limit };
}
/** Persists settings before notifying every attached agent scope sharing this store directory. */
export class TaskAdmissionRegistry {
    storagePath;
    key;
    fallback;
    constructor(store, fallback = defaults) {
        this.storagePath = resolve(join(dirname(store.storagePath), 'task-admission.json'));
        this.key = process.platform === 'win32' ? this.storagePath.toLowerCase() : this.storagePath;
        this.fallback = validate(fallback);
    }
    async serial(operation) {
        const operationPromise = (locks.get(this.key) ?? Promise.resolve()).then(operation);
        const settled = operationPromise.then(() => { }, () => { });
        locks.set(this.key, settled);
        try {
            return await operationPromise;
        }
        finally {
            if (locks.get(this.key) === settled)
                locks.delete(this.key);
        }
    }
    async read() {
        try {
            const input = JSON.parse(await readFile(this.storagePath, 'utf8'));
            if (input.version !== 1)
                throw new Error('unsupported task admission configuration version');
            return validate(input);
        }
        catch (error) {
            if (error instanceof Error && 'code' in error && error.code === 'ENOENT')
                return { ...this.fallback };
            throw error;
        }
    }
    get() { return this.serial(() => this.read()); }
    attach(runtime) {
        return this.serial(async () => {
            await runtime.setAdmission(await this.read());
            const subscribers = listeners.get(this.key) ?? new Set();
            subscribers.add(runtime);
            listeners.set(this.key, subscribers);
            return () => { subscribers.delete(runtime); if (!subscribers.size)
                listeners.delete(this.key); };
        });
    }
    update(patch) {
        return this.serial(async () => {
            const current = await this.read();
            const next = validate({ ...current, ...patch });
            const temp = `${this.storagePath}.${randomUUID()}.tmp`;
            await mkdir(dirname(this.storagePath), { recursive: true });
            try {
                await writeFile(temp, JSON.stringify({ version: 1, ...next }, null, 2), { encoding: 'utf8', mode: 0o600 });
                await rename(temp, this.storagePath);
            }
            finally {
                await unlink(temp).catch((error) => { if (error.code !== 'ENOENT')
                    throw error; });
            }
            const applied = await Promise.allSettled([...listeners.get(this.key) ?? []].map(runtime => runtime.setAdmission(next)));
            const errors = applied.filter((row) => row.status === 'rejected');
            if (errors.length)
                throw new AggregateError(errors.map(row => row.reason), 'Task admission settings saved, but runtime reconciliation failed');
            return next;
        });
    }
}
export async function installTaskAdmissionSettings(ctx, store, lifecycle, fallback) {
    const registry = new TaskAdmissionRegistry(store, fallback);
    const detach = await registry.attach(lifecycle);
    const output = { schema: { type: 'json' }, render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }] };
    const disposers = [detach,
        ctx.tools.register(defineTool({ name: 'redteam_get_task_concurrency', description: 'Read persisted task admission settings. Disabled by default, with a stored limit of five.', parameters: {}, output,
            execute: async () => ({ ...await registry.get() }) })),
        ctx.tools.register(defineTool({ name: 'redteam_set_task_concurrency', description: 'Persist task concurrency settings and immediately reconcile the FIFO queue in every active scope. Lowering the limit does not cancel running tasks.',
            parameters: { enabled: { type: 'boolean' }, limit: { type: 'number' } }, output,
            execute: async (args) => {
                if (args.enabled === undefined && args.limit === undefined)
                    throw new Error('specify enabled or limit');
                return { ...await registry.update({ ...(args.enabled === undefined ? {} : { enabled: args.enabled }), ...(args.limit === undefined ? {} : { limit: args.limit }) }) };
            } })),
    ];
    const dispose = () => { for (const release of disposers.splice(0).reverse())
        release(); };
    ctx.effect(() => dispose);
    return { registry, dispose };
}
