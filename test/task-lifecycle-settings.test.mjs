import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { build } from 'esbuild';
import { Context } from '@deepseek-ai/cordis';
import ToolRuntime from '@deepseek-ai/dsh-tools';
import SystemPrompt from '@deepseek-ai/dsh-system-prompt';
const built = await build({ stdin: { contents: "export * from './src/task-management/runtime-settings.ts'; export * from './src/task-management/integration.ts'; export * from './src/task-management/runtime-model.ts'; export {RedTeamStore} from './src/store.ts';", resolveDir: process.cwd(), loader: 'ts' }, bundle: true, write: false, platform: 'node', format: 'esm', packages: 'external' });
const code = built.outputFiles[0].text.replace(/from\s+(["'])([^"']+)\1/g, (_m, _q, specifier) => `from ${JSON.stringify(import.meta.resolve(specifier))}`);
const { TaskAdmissionRegistry, installTaskAdmissionSettings, TaskLifecycleRuntime, TaskModelRouter, RedTeamStore } = await import(`data:text/javascript;base64,${Buffer.from(code + '\n//# sourceURL=task-settings.bundle.mjs').toString('base64')}`);
async function fixture(t) {
  const dir = await mkdtemp(join(tmpdir(), 'task-settings-')), store = new RedTeamStore(join(dir, 'state.json'));
  await store.load(); const starts = [], runtimes = [], detach = [];
  const registry = new TaskAdmissionRegistry(store);
  function runtime() {
    const planner = { status: id => ({ taskId: id }), start: async id => { starts.push(id); return { taskId: id }; }, pause: async id => ({ taskId: id }), park: async () => {}, beginSettling: async () => {}, finalize: async () => ({ met: false }) };
    const router = new TaskModelRouter(store, { listProviders: () => [{ id: 'fixture' }] }, { resolveProfile: () => null, resolveBinding: () => null });
    const result = new TaskLifecycleRuntime(store, planner, router, { concurrency: 1, enabled: true, autoPoll: false }); runtimes.push(result); return result;
  }
  t.after(async () => { detach.forEach(fn => fn()); for (const instance of runtimes) await instance.dispose(); await rm(dir, { recursive: true, force: true }); });
  const create = () => store.createManagedTask({ title: 'settings fixture', goal: 'FIFO' });
  const parent = id => ({ id, options: { provider: 'fixture', model: 'model' } });
  return { dir, store, starts, runtime, registry, create, parent, attach: async r => { detach.push(await registry.attach(r)); } };
}
test('settings load ARTEX defaults and broadcast saved updates to every scope', async t => {
  const f = await fixture(t), a = f.runtime(), b = f.runtime(); await f.attach(a); await f.attach(b);
  assert.deepEqual(a.admission(), { enabled: false, limit: 5 });
  await f.registry.update({ enabled: true, limit: 2 });
  assert.deepEqual(a.admission(), { enabled: true, limit: 2 }); assert.deepEqual(b.admission(), a.admission());
  assert.deepEqual(await new TaskAdmissionRegistry(f.store).get(), a.admission());
});
test('explicit host defaults apply only before persistent settings exist', async t => {
  const f = await fixture(t), runtime = f.runtime();
  const configured = new TaskAdmissionRegistry(f.store, { enabled: true, limit: 9 });
  const detach = await configured.attach(runtime); t.after(detach);
  assert.deepEqual(runtime.admission(), { enabled: true, limit: 9 });
  await configured.update({ limit: 4 });
  assert.deepEqual(await new TaskAdmissionRegistry(f.store, { enabled: false, limit: 99 }).get(), { enabled: true, limit: 4 });
});
test('raising limit immediately admits FIFO; lowering retains active tasks; disabling releases waiting tasks', async t => {
  const f = await fixture(t), a = f.runtime(), b = f.runtime(); await f.attach(a); await f.attach(b); await f.registry.update({ enabled: true, limit: 1 });
  const tasks = await Promise.all([f.create(), f.create(), f.create()]);
  await a.start(tasks[0].id, f.parent('a')); await b.start(tasks[1].id, f.parent('b')); await b.start(tasks[2].id, f.parent('b'));
  assert.deepEqual(f.starts, [tasks[0].id]);
  await f.registry.update({ limit: 2 }); await a.flush(); await b.flush(); assert.deepEqual(f.starts, tasks.slice(0, 2).map(t => t.id));
  await f.registry.update({ limit: 1 }); assert.equal(f.store.snapshot().tasks.filter(t => t.status === 'running' && !t.queued).length, 2);
  await f.registry.update({ enabled: false }); await b.flush(); assert.deepEqual(f.starts, tasks.map(t => t.id));
});
test('shared configuration updates serialize partial changes and reject invalid input without writes', async t => {
  const f = await fixture(t), other = new TaskAdmissionRegistry(f.store);
  await Promise.all([f.registry.update({ enabled: true }), other.update({ limit: 7 })]); assert.deepEqual(await f.registry.get(), { enabled: true, limit: 7 });
  const before = await readFile(f.registry.storagePath, 'utf8');
  await assert.rejects(f.registry.update({ limit: 0 }), /positive integer/); assert.equal(await readFile(f.registry.storagePath, 'utf8'), before);
  await writeFile(f.registry.storagePath, '{invalid'); await assert.rejects(f.registry.get(), SyntaxError);
});
test('runtime reconciliation failure is explicit after durable save and all subscribers are attempted', async t => {
  const f = await fixture(t); let failure = false, applied;
  const detach1 = await f.registry.attach({ setAdmission: async () => { if (failure) throw new Error('provider metadata unavailable'); } });
  const detach2 = await f.registry.attach({ setAdmission: async value => { applied = value; } }); t.after(() => { detach1(); detach2(); }); failure = true;
  await assert.rejects(f.registry.update({ enabled: true }), /saved, but runtime reconciliation failed/);
  assert.equal((await f.registry.get()).enabled, true); assert.equal(applied.enabled, true);
});
test('native tools persist settings, apply FIFO and dispose cleanly', async t => {
  const f = await fixture(t), runtime = f.runtime(), app = new Context(), fibers = [], ready = Promise.withResolvers(); let installation;
  t.after(async () => { installation?.dispose(); for (const fiber of fibers.reverse()) await fiber.dispose(); });
  fibers.push(await app.plugin(SystemPrompt, {})); fibers.push(await app.plugin(ToolRuntime, { mode: 'native' }));
  fibers.push(await app.plugin(ctx => { ctx.inject(['tools'], inner => { void installTaskAdmissionSettings(inner, f.store, runtime).then(value => { installation = value; ready.resolve(); }, ready.reject); }); }));
  await ready.promise;
  const call = (name, args) => app.get('tools').execute({ callId: randomUUID(), name, arguments: args, signal: AbortSignal.timeout(5000) });
  const result = await call('redteam_set_task_concurrency', { enabled: true, limit: 3 }); assert.equal(result.isError, false, JSON.stringify(result));
  assert.deepEqual(runtime.admission(), { enabled: true, limit: 3 });
  const read = await call('redteam_get_task_concurrency', {}); assert.deepEqual(read.value, { enabled: true, limit: 3 });
  installation.dispose(); assert.equal(app.get('tools').get('redteam_set_task_concurrency'), undefined);
});
