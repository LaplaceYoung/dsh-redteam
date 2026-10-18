import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { build } from 'esbuild';

const built = await build({ stdin: { contents: "export * from './src/task-management/integration.ts'; export * from './src/task-management/runtime-model.ts'; export * from './src/task-management/index.ts'; export {RedTeamStore} from './src/store.ts';", resolveDir: process.cwd(), loader: 'ts' }, bundle: true, platform: 'node', format: 'esm', write: false, packages: 'external' });
const code = built.outputFiles[0].text.replace(/from\s+(["'])([^"']+)\1/g, (_m, _q, specifier) => `from ${JSON.stringify(import.meta.resolve(specifier))}`);
const { TaskLifecycleRuntime, TaskModelRouter, RedTeamStore, finishManagedTask, replaceTaskLLMProfiles } = await import(`data:text/javascript;base64,${Buffer.from(code + '\n//# sourceURL=task-lifecycle-runtime.bundle.mjs').toString('base64')}`);
const noAbort = new AbortController().signal;
async function collect(stream) { const rows = []; for await (const row of stream) rows.push(row); return rows; }
function gate() { return Promise.withResolvers(); }

async function fixture(t, options = {}) {
  const dir = await mkdtemp(join(tmpdir(), 'task-lifecycle-')); const store = new RedTeamStore(join(dir, 'state.json'));
  await store.load(); let time = new Date('2026-10-18T00:00:00Z');
  const parent = { id: 'parent', options: { provider: 'fixture', model: 'parent-model' } };
  const requests = [], starts = [], parks = [], freezes = [], finals = [];
  let providers = ['fixture'];
  const service = { listProviders: () => providers.map(id => ({ id })), async *stream(request) { requests.push(request); yield { type: 'text-delta', index: 0, text: request.model }; yield { type: 'finish', reason: { kind: 'stop' } }; } };
  const resolver = { resolveProfile: id => ({ provider: 'fixture', model: id }), resolveBinding: () => null, ...options.resolver };
  const router = new TaskModelRouter(store, service, resolver);
  const planner = {
    status(id) { return { taskId: id, taskStatus: store.snapshot().tasks.find(t => t.id === id).status }; },
    async start(id) { starts.push(id); return this.status(id); },
    async pause(id) { return this.status(id); },
    async park(id) { parks.push(id); },
    async beginSettling(id) { freezes.push(id); },
    async finalize(id, _parent, signal) { finals.push(id); if (options.finalize) return options.finalize(id, signal); return { met: false }; },
  };
  const runtime = new TaskLifecycleRuntime(store, planner, router, { concurrency: 1, autoPoll: false, now: () => time, ...options.runtime });
  t.after(async () => { await runtime.dispose(); await rm(dir, { recursive: true, force: true }); });
  async function task(timeoutSeconds = 0) { return store.createManagedTask({ title: 'fixture', goal: 'goal', timeoutSeconds }); }
  return { store, parent, runtime, planner, router, requests, starts, parks, freezes, finals, task, advance: ms => { time = new Date(time.getTime() + ms); }, providers: values => { providers = values; } };
}

test('actual Planner start is gated by persisted FIFO and queued model dispatch is rejected', async t => {
  const f = await fixture(t); const a = await f.task(), b = await f.task();
  await Promise.all([f.runtime.start(a.id, f.parent), f.runtime.start(b.id, f.parent)]);
  assert.deepEqual(f.starts, [a.id]); assert.equal(f.store.snapshot().tasks.find(t => t.id === b.id).queued, true);
  await assert.rejects(collect(f.runtime.modelStream({ taskId: b.id, parent: f.parent, request: { provider: 'fixture', model: 'parent-model', messages: [] }, signal: noAbort })), /not admitted/);
  assert.equal(f.requests.length, 0);
  await f.store.transaction(s => finishManagedTask(s, a.id, 'done'));
  await f.runtime.step(); await f.runtime.flush(); assert.deepEqual(f.starts, [a.id, b.id]);
});

test('actual provider request starts the clock, while admission and main-chat calls do not', async t => {
  const f = await fixture(t); const a = await f.task(60); await f.runtime.start(a.id, f.parent);
  assert.equal(f.store.snapshot().tasks[0].firstRunAt, undefined);
  await collect(f.runtime.trackStream(a.id, 'mainagent', async function* () { yield { type: 'finish', reason: { kind: 'stop' } }; }));
  assert.equal(f.store.snapshot().tasks[0].firstRunAt, undefined);
  f.advance(20000);
  await collect(f.runtime.modelStream({ taskId: a.id, parent: f.parent, request: { provider: 'fixture', model: 'old', messages: [] }, signal: noAbort }));
  assert.equal(f.requests[0].model, 'parent-model');
  assert.equal(f.store.snapshot().tasks[0].firstRunAt, '2026-10-18T00:00:20.000Z');
  assert.equal(f.store.snapshot().tasks[0].deadlineAt, '2026-10-18T00:01:20.000Z');
});

test('route lost between admission and dispatch cannot start the wall clock', async t => {
  const f = await fixture(t), task = await f.task(60); await f.runtime.start(task.id, f.parent); f.providers([]);
  await assert.rejects(collect(f.runtime.modelStream({ taskId: task.id, parent: f.parent, request: { provider: 'fixture', model: 'parent-model', messages: [] }, signal: noAbort })), /not registered/);
  assert.equal(f.requests.length, 0); assert.equal(f.store.snapshot().tasks[0].firstRunAt, undefined);
});

test('goals bridge selects the independent bound route and starts the task clock on dispatch', async t => {
  const f = await fixture(t, { resolver: { resolveBinding: (_id, role) => role === 'goals' ? { provider: 'fixture', model: 'goal-splitter' } : null } });
  const task = await f.task(60); await f.runtime.start(task.id, f.parent);
  await collect(f.runtime.modelStream({ taskId: task.id, parent: f.parent, role: 'goals', request: { provider: 'fixture', model: 'parent-model', messages: [] }, signal: noAbort }));
  assert.equal(f.requests[0].model, 'goal-splitter'); assert.equal(f.store.snapshot().tasks[0].firstRunAt, '2026-10-18T00:00:00.000Z');
});

test('deadline freezes once, waits for real model availability and permits exactly one FINAL call', async t => {
  const f = await fixture(t); const a = await f.task(1); await f.runtime.start(a.id, f.parent);
  await f.runtime.beforeModelCall(a.id, 'worker'); f.advance(1000); f.providers([]);
  await f.runtime.step(); assert.deepEqual(f.freezes, [a.id]); assert.deepEqual(f.finals, []);
  assert.equal(f.store.snapshot().tasks[0].status, 'running');
  await assert.rejects(f.runtime.beforeModelCall(a.id, 'planner'), /not admitted/);
  f.providers(['fixture']); await f.runtime.step(); await f.runtime.flush(); await f.runtime.step();
  assert.deepEqual(f.finals, [a.id]); assert.deepEqual(f.freezes, [a.id]); assert.equal(f.store.snapshot().tasks[0].status, 'timeout');
});

test('FINAL proven outcome commits done, and concurrent normal completion cannot be overwritten by timeout', async t => {
  const outcome = gate(); const entered = gate();
  const f = await fixture(t, { finalize: async () => { entered.resolve(); return outcome.promise; } });
  const a = await f.task(1); await f.runtime.start(a.id, f.parent); await f.runtime.beforeModelCall(a.id, 'planner'); f.advance(1000);
  await f.runtime.step(); await entered.promise;
  await f.store.transaction(s => finishManagedTask(s, a.id, 'done'));
  outcome.resolve({ met: false }); await f.runtime.flush(); assert.equal(f.store.snapshot().tasks[0].status, 'done');
  const b = await f.task(1); await f.runtime.start(b.id, f.parent); await f.runtime.beforeModelCall(b.id, 'planner');
  f.planner.finalize = async id => { f.finals.push(id); return { met: true }; };
  f.advance(1000); await f.runtime.step(); await f.runtime.flush(); assert.equal(f.store.snapshot().tasks.find(t => t.id === b.id).status, 'done');
});

test('paused task keeps absolute deadline and independent FINAL still runs', async t => {
  const f = await fixture(t); const a = await f.task(2); await f.runtime.start(a.id, f.parent); await f.runtime.beforeModelCall(a.id, 'worker');
  await f.runtime.pause(a.id, f.parent); f.advance(2000); await f.runtime.step(); await f.runtime.flush();
  assert.equal(f.store.snapshot().tasks[0].status, 'timeout'); assert.deepEqual(f.finals, [a.id]);
});

test('provider loss parks actual Planner only after model stream exits, then promotes next ready task', async t => {
  const f = await fixture(t); const a = await f.task(), b = await f.task();
  await f.runtime.start(a.id, f.parent); await f.runtime.start(b.id, f.parent);
  const entered = gate(), release = gate();
  const stream = collect(f.runtime.trackStream(a.id, 'worker', async function* () { entered.resolve(); await release.promise; yield { type: 'finish', reason: { kind: 'stop' } }; }));
  await entered.promise; f.providers([]); await f.runtime.step(); assert.deepEqual(f.parks, []);
  release.resolve(); await stream; f.advance(1000); await f.runtime.step(); assert.deepEqual(f.parks, [a.id]);
  assert.equal(f.store.snapshot().tasks.find(t => t.id === a.id).queued, true);
  f.providers(['fixture']); await f.runtime.step(); await f.runtime.flush(); assert.deepEqual(f.starts, [a.id, b.id]);
});

test('restored deadline requires actual parent resolution and never invents an Agent', async t => {
  const f = await fixture(t); const a = await f.task(1), b = await f.task(1);
  await f.store.transaction(s => { for (const task of s.tasks) { task.status = 'paused'; task.firstRunAt = '2026-10-17T23:00:00Z'; task.deadlineAt = '2026-10-17T23:00:01Z'; } });
  const missing = await f.runtime.recover(async id => id === a.id ? f.parent : undefined); await f.runtime.flush();
  assert.deepEqual(missing, [b.id]); assert.deepEqual(f.finals, [a.id]); assert.equal(f.store.snapshot().tasks.find(t => t.id === b.id).status, 'paused');
});

test('lifecycle refuses foreign parents and maps worker sessions independently of active main task', async t => {
  const f = await fixture(t); const a = await f.task(), b = await f.task(); await f.runtime.start(a.id, f.parent);
  await assert.rejects(f.runtime.start(a.id, { ...f.parent, id: 'foreign' }), /another parent/);
  await f.store.addIntent({ taskId: a.id, summary: 'worker', input: {}, execution: { childSessionId: 'child', parentSessionId: f.parent.id, provider: 'spawn' } });
  f.runtime.bindParent(b.id, f.parent);
  assert.equal(f.runtime.taskForAgent(f.parent.id).binding.taskId, b.id);
  assert.equal(f.runtime.taskForAgent('child').binding.taskId, a.id);
});

test('explicit timeout rerun clears old settlement and starts a fresh clock', async t => {
  const f = await fixture(t); const a = await f.task(1); await f.runtime.start(a.id, f.parent); await f.runtime.beforeModelCall(a.id, 'worker');
  f.advance(1000); await f.runtime.step(); await f.runtime.flush(); assert.equal(f.store.snapshot().tasks[0].status, 'timeout');
  await f.runtime.start(a.id, f.parent, 'rerun'); assert.equal(f.store.snapshot().tasks[0].firstRunAt, undefined);
  await f.runtime.beforeModelCall(a.id, 'worker'); assert.equal(f.store.snapshot().tasks[0].deadlineAt, '2026-10-18T00:00:02.000Z');
});

test('task chain selection is used by the dispatched Planner request', async t => {
  const f = await fixture(t); const a = await f.task();
  await f.store.transaction(s => { const task = s.tasks[0]; task.llmChain = replaceTaskLLMProfiles(task.llmChain, ['specific-model'], new Set(['specific-model'])); });
  await f.runtime.start(a.id, f.parent);
  const result = await collect(f.runtime.modelStream({ taskId: a.id, parent: f.parent, request: { provider: 'fixture', model: 'ignored', messages: [] }, signal: noAbort }));
  assert.equal(f.requests[0].model, 'specific-model'); assert.equal(result[0].text, 'specific-model');
});
