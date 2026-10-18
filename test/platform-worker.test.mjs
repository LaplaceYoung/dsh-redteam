import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { build } from 'esbuild';
import { Context } from '@deepseek-ai/cordis';
import { SessionStore, SessionId } from '@deepseek-ai/dsh-session';
import AgentRegistry from '@deepseek-ai/dsh-agent';
import AgentLoop from '@deepseek-ai/dsh-agent-loop';
import LlmRuntime, { LlmAdapter, createUserMessage } from '@deepseek-ai/dsh-llm';
import SystemPrompt from '@deepseek-ai/dsh-system-prompt';
import ToolRuntime, { defineTool } from '@deepseek-ai/dsh-tools';
import SessionProjections from '@deepseek-ai/dsh-session-projection';
import LocalFileSystem from '@deepseek-ai/dsh-fs-local';
import WorkingDirectory from '@deepseek-ai/dsh-working-directory';
import * as JsonlPersistence from '@deepseek-ai/dsh-session-persistence-jsonl';
import SessionQuery from '@deepseek-ai/dsh-session-query-sqlite';
import Subagents from '@deepseek-ai/dsh-subagent';
import * as spawnProvider from '@deepseek-ai/dsh-subagent-spawn-in-process';
import * as forkProvider from '@deepseek-ai/dsh-subagent-fork-in-process';

// Current source is bundled in memory; this test never races another scope's lib build.
const bundle = await build({ stdin: { contents: "export { RedTeamStore } from './src/store.ts'; export { WorkerRuntime } from './src/workers.ts'; export { installPlatform } from './src/platform/index.ts';", resolveDir: process.cwd(), loader: 'ts' }, bundle: true, write: false, platform: 'node', format: 'esm', packages: 'external', define: { 'import.meta.url': JSON.stringify(import.meta.url) } });
const code = bundle.outputFiles[0].text.replace(/from\s+(["'])([^"']+)\1/g, (_match, _quote, specifier) => `from ${JSON.stringify(import.meta.resolve(specifier))}`);
const { RedTeamStore, WorkerRuntime, installPlatform } = await import(`data:text/javascript;base64,${Buffer.from(`${code}\n//# sourceURL=platform-worker-tests.bundle.mjs`).toString('base64')}`);
const requestSystem = request => request.messages.filter(message => message.role === 'system').map(message => typeof message.content === 'string' ? message.content : message.content.map(block => block.text ?? '').join('\n')).join('\n');

class WorkerModel extends LlmAdapter {
  requests = [];
  mode = 'normal';
  entered = Promise.withResolvers();
  beforeResponse;
  forceTool;
  systemPromptUpdate;
  async resolveModel(provider, model) { return { provider, id: model, name: model, ...(this.systemPromptUpdate ? { systemPromptUpdate: this.systemPromptUpdate } : {}) }; }
  async *stream(request) {
    this.requests.push(request);
    await this.beforeResponse?.(request);
    const worker = requestSystem(request).includes('MANAGED_WORKER_');
    if (worker && this.mode === 'fail') throw new Error('fixture model failure');
    if (worker && this.mode === 'hold') {
      this.entered.resolve();
      await new Promise(resolve => { if (request.signal.aborted) resolve(); else request.signal.addEventListener('abort', resolve, { once: true }); });
      request.signal.throwIfAborted();
    }
    const lastTaskMessage = request.messages.findLast(message => message.role !== 'user' || message.source?.kind !== 'artex-wrapup');
    if (worker && (this.forceTool?.(request) || lastTaskMessage?.role !== 'tool')) {
      const id = randomUUID();
      yield { type: 'tool-call-delta', index: 0, id, name: 'platform_fixture_echo', argumentsDelta: '{}' };
      yield { type: 'finish', reason: { kind: 'tool-calls' } };
    } else {
      yield { type: 'text-delta', index: 0, text: worker ? 'Worker fixture finished' : 'Unmodified parent acknowledged' };
      yield { type: 'finish', reason: { kind: 'stop' } };
    }
  }
}

async function fixture(t, options = {}) {
  const dir = await mkdtemp(join(tmpdir(), 'platform-worker-'));
  const app = new Context(); const fibers = []; const handles = []; const attachments = [];
  const store = new RedTeamStore(join(dir, 'state.json')); await store.load();
  const adapter = new WorkerModel(); const prepared = []; const disposed = []; const actualCalls = []; const observed = [];
  const waiters = []; const settledTurns = [];
  let platform, workers;
  t.after(async () => {
    await workers?.dispose(); for (const attachment of attachments.reverse()) { attachment.detach(); await attachment.run.dispose(); } await platform?.dispose();
    for (const handle of handles.reverse()) await handle.dispose();
    for (const fiber of fibers.reverse()) await fiber.dispose();
    await rm(dir, { recursive: true, force: true });
  });
  const mount = async (plugin, config) => { const fiber = await app.plugin(plugin, config); fibers.push(fiber); return fiber; };
  await mount(SessionStore); await mount(AgentRegistry); await mount(LlmRuntime); await mount(SystemPrompt, {});
  await mount(ToolRuntime, { mode: 'native' }); await mount(SessionProjections);
  await mount(LocalFileSystem, { cwd: dir }); await mount(WorkingDirectory, { defaultDirectory: dir });
  await mount(JsonlPersistence, { root: join(dir, 'sessions') }); await mount(SessionQuery, { path: ':memory:', openAt: 'never' });
  await mount(AgentLoop, {}); await mount(Subagents, {}); await mount(spawnProvider, {}); await mount(forkProvider, {});
  const echo = defineTool({ name: 'platform_fixture_echo', description: 'Original host echo', parameters: { count: { type: 'number' } }, output: { schema: { type: 'json' }, render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }] }, execute: async (args, exec) => { const result = { count: args.count ?? null, sessionId: exec.agent.id }; actualCalls.push(result); return result; } });
  const parentOnly = defineTool({ name: 'platform_parent_only', description: 'Parent visible tool', parameters: {}, output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: value }] }, execute: async () => 'parent available' });
  await mount(ctx => {
    ctx.inject(['llm', 'tools'], inner => { inner.llm.registerAdapter(['platform-fixture'], adapter); inner.tools.register(echo); inner.tools.register(parentOnly); });
  });
  const ready = Promise.withResolvers();
  await mount(ctx => { ctx.inject(['tools', 'agents', 'systemPrompt'], async inner => { try { platform = await installPlatform(inner, store, { schedulerIntervalMs: 0, ...options.platform }); ready.resolve(); } catch (error) { ready.reject(error); throw error; } }); });
  await ready.promise;
  await platform.agents.savePrompt('worker', { template: 'MANAGED_WORKER_V1 {{.WorkerName}}' });
  await platform.agents.seedTools([echo, parentOnly], { platform_fixture_echo: ['worker'], platform_parent_only: ['auto'] });
  const schema = structuredClone(echo.parameters); schema.properties.count.default = 17;
  await platform.agents.updateTool(echo.name, { description: 'Managed worker echo', schema });
  await mount(ctx => { ctx.inject(['subagents', 'agents', 'sessionQuery', 'sessionPersistence'], inner => {
    workers = new WorkerRuntime(inner, store, 2, { constraints: options.constraints, intentRetry: options.intentRetry, prepareRun: async input => {
      const run = await platform.prepareRun(input); prepared.push({ input, run });
      let closed = false;
      return { ...run, dispose: async () => { await run.dispose(); if (!closed) { closed = true; disposed.push(input.sessionId); } } };
    } });
  }); });
  await mount(ctx => { ctx.on('session/event', (session, event) => {
    observed.push({ sessionId: session.id, event });
    void workers.observe(session, event).then(() => {
      if (event.type !== 'turn/end') return;
      settledTurns.push({ sessionId: session.id, event });
      for (const waiter of [...waiters]) if (waiter.id === session.id && event.data.turn >= waiter.turn) { waiters.splice(waiters.indexOf(waiter), 1); waiter.resolve(event); }
    }, error => { for (const waiter of waiters.splice(0)) waiter.reject(error); });
  }); });
  async function agent() {
    const handle = await app.get('agents').create({ sessionId: SessionId(randomUUID()), meta: { cwd: dir }, agentOptions: { provider: 'platform-fixture', model: 'local-model' } });
    handles.push(handle); return handle.agent;
  }
  const parent = await agent(); const unrelated = await agent();
  async function newIntent(label) {
    const task = await store.createManagedTask({ title: label, goal: `Verify ${label}`, seedFirstIntent: false });
    const intent = await store.addIntent({ taskId: task.id, summary: label, input: {} }); return { task, intent };
  }
  function turn(id, number = 1) {
    const existing = settledTurns.find(row => row.sessionId === id && row.event.data.turn >= number);
    if (existing) return Promise.resolve(existing.event);
    const waiter = { ...Promise.withResolvers(), id, turn: number }; waiters.push(waiter); return waiter.promise;
  }
  const execute = (name, caller = parent) => app.get('tools').execute({ name, arguments: {}, callId: randomUUID(), agent: caller, signal: AbortSignal.timeout(10000) });
  async function attachParent() {
    const run = await platform.prepareRun({ agentKey: 'mainagent', sessionId: parent.id, parent });
    const detach = run.attach(parent.ctx, parent); attachments.push({ run, detach }); return run;
  }
  return { app, store, platform, workers, parent, unrelated, adapter, actualCalls, observed, prepared, disposed, newIntent, turn, execute, attachParent };
}

test('intent model-error retries preserve the durable child, default to two extra attempts and obey current policy', { timeout: 40000 }, async t => {
  let policy = { attempts: 0, interval_ms: 1 };
  const f = await fixture(t, { intentRetry: () => policy });
  const own = await f.newIntent('intent retry fixture'); await f.store.setTaskStatus(own.task.id, 'running');
  let requests = 0;
  f.adapter.beforeResponse = request => { if (requestSystem(request).includes('MANAGED_WORKER_')) { requests++; f.adapter.mode = requests <= 2 ? 'fail' : 'normal'; } };
  const started = await f.workers.start(own.task.id, f.parent, AbortSignal.timeout(20000));
  const id = started.execution.childSessionId;
  const end = await f.turn(id, 3); assert.equal(end.data.reason.kind, 'completed');
  await f.app.get('subagents').drainChildren(f.parent, [SessionId(id)]);
  const stored = f.store.snapshot().intents.find(row => row.id === own.intent.id);
  assert.equal(stored.state, 'done'); assert.equal(stored.execution.childSessionId, id);
  assert.equal(requests, 4, 'two failed attempts then one tool step and successful completion');
  assert.equal(f.prepared.filter(row => row.input.sessionId === id).length, 3, 'each whole-intent retry gets a fresh role assembly over the same durable session');
  assert.deepEqual(f.store.snapshot().traces.filter(row => row.intentId === own.intent.id && row.kind === 'error' && row.data?.intentRetry).map(row => row.data.intentRetry.attempt), [1, 2]);
  assert.ok(f.observed.some(row => row.sessionId === id && row.event.type === 'user/message' && JSON.stringify(row.event.data).includes('不要重复已有副作用')));

  policy = { attempts: 2, interval_ms: 1 };
  const dynamic = await f.newIntent('dynamic retry policy'); await f.store.setTaskStatus(dynamic.task.id, 'running');
  let dynamicRequests = 0;
  f.adapter.beforeResponse = request => { if (requestSystem(request).includes('MANAGED_WORKER_')) { dynamicRequests++; f.adapter.mode = 'fail'; if (dynamicRequests === 2) policy = { attempts: -1, interval_ms: 1 }; } };
  const dynamicStart = await f.workers.start(dynamic.task.id, f.parent, AbortSignal.timeout(15000));
  assert.equal((await f.turn(dynamicStart.execution.childSessionId, 2)).data.reason.kind, 'error');
  await f.app.get('subagents').drainChildren(f.parent, [SessionId(dynamicStart.execution.childSessionId)]);
  assert.equal(dynamicRequests, 2); assert.equal(f.store.snapshot().intents.find(row => row.id === dynamic.intent.id).state, 'blocked');
});

test('intent retry excludes router-handled failures and cancels its default backoff on task control', { timeout: 30000 }, async t => {
  const f = await fixture(t);
  f.adapter.mode = 'fail';
  const handled = await f.newIntent('router handled failure'); await f.store.setTaskStatus(handled.task.id, 'running');
  const remove = f.app.on('agent/request-error', async () => undefined);
  const first = await f.workers.start(handled.task.id, f.parent, AbortSignal.timeout(15000));
  assert.equal((await f.turn(first.execution.childSessionId)).data.reason.kind, 'error');
  await f.app.get('subagents').drainChildren(f.parent, [SessionId(first.execution.childSessionId)]); remove();
  assert.equal(f.store.snapshot().intents.find(row => row.id === handled.intent.id).state, 'blocked');
  assert.ok(!f.store.snapshot().traces.some(row => row.intentId === handled.intent.id && row.data?.intentRetry));
  for (const control of ['pause', 'timeout']) {
    const own = await f.newIntent(`retry ${control}`); await f.store.setTaskStatus(own.task.id, 'running');
    const started = await f.workers.start(own.task.id, f.parent, AbortSignal.timeout(15000));
    const id = started.execution.childSessionId;
    await f.turn(id);
    const trace = f.store.snapshot().traces.find(row => row.intentId === own.intent.id && row.data?.intentRetry);
    assert.deepEqual(trace.data.intentRetry, { attempt: 1, limit: 2, intervalMs: 3000 });
    assert.equal(f.store.snapshot().intents.find(row => row.id === own.intent.id).state, 'running', 'backoff reserves the intent capacity');
    if (control === 'pause') await f.workers.stop(own.intent.id, f.parent);
    else { await f.workers.beginTaskTimeout(own.task.id); await f.app.get('subagents').drainChildren(f.parent, [SessionId(id)]); }
    assert.equal(f.store.snapshot().intents.find(row => row.id === own.intent.id).state, control === 'pause' ? 'paused' : 'blocked');
    assert.equal(f.adapter.requests.filter(request => requestSystem(request).includes(id)).length, 1, 'task control must cancel delayed replay');
  }
});

test('Worker constraint injection defaults to enabled and rereads the live store without a resolver', { timeout: 25000 }, async t => {
  const f = await fixture(t), own = await f.newIntent('default constraint fixture');
  const constraint = await f.store.addConstraint({ taskId: own.task.id, text: 'DEFAULT_BOUNDARY_V1', kind: 'deny', origin: 'human' });
  let steps = 0;
  f.adapter.beforeResponse = async request => {
    if (!requestSystem(request).includes('MANAGED_WORKER_')) return;
    steps++;
    if (steps === 1) {
      assert.match(requestSystem(request), /DEFAULT_BOUNDARY_V1/);
      await f.store.transaction(state => { state.constraints.find(row => row.id === constraint.id).text = 'DEFAULT_BOUNDARY_V2'; });
    } else { assert.match(requestSystem(request), /DEFAULT_BOUNDARY_V2/); assert.doesNotMatch(JSON.stringify(request.messages), /DEFAULT_BOUNDARY_V1/); }
  };
  const started = await f.workers.start(own.task.id, f.parent, AbortSignal.timeout(15000));
  assert.equal((await f.turn(started.execution.childSessionId)).data.reason.kind, 'completed');
  await f.app.get('subagents').drainChildren(f.parent, [SessionId(started.execution.childSessionId)]);
  assert.equal(steps, 2);
});

test('native Worker reads constraint toggles per request and cold recovery without retaining old injected boundaries', { timeout: 60000 }, async t => {
  let enabled = true, f;
  f = await fixture(t, { constraints: taskId => enabled ? f.store.snapshot().constraints.filter(row => row.taskId === taskId) : [] });
  f.adapter.systemPromptUpdate = 'in-history';
  const a = await f.newIntent('constraint task A'), b = await f.newIntent('constraint task B');
  const boundary = await f.store.addConstraint({ taskId: a.task.id, text: 'BOUNDARY_A_V1', kind: 'deny', origin: 'human' });
  await f.store.addConstraint({ taskId: b.task.id, text: 'BOUNDARY_B_ONLY', kind: 'allow', origin: 'human' });
  let aSteps = 0;
  const isA = request => requestSystem(request).includes('MANAGED_WORKER_') && JSON.stringify(request.messages).includes('constraint task A');
  f.adapter.beforeResponse = async request => {
    if (!isA(request)) return;
    const body = JSON.stringify(request.messages);
    aSteps++;
    assert.doesNotMatch(body, /BOUNDARY_B_ONLY/);
    if (aSteps === 1) { assert.match(requestSystem(request), /BOUNDARY_A_V1/); enabled = false; }
    else if (aSteps === 2) {
      assert.doesNotMatch(body, /BOUNDARY_A_V1/);
      await f.store.transaction(state => { state.constraints.find(row => row.id === boundary.id).text = 'BOUNDARY_A_V2'; });
      enabled = true;
    } else if (aSteps === 3) { assert.match(requestSystem(request), /BOUNDARY_A_V2/); assert.doesNotMatch(body, /BOUNDARY_A_V1/); }
    else assert.doesNotMatch(body, /BOUNDARY_A_V[12]/);
  };
  f.adapter.forceTool = request => isA(request) && aSteps < 3;
  const started = await f.workers.start(a.task.id, f.parent, AbortSignal.timeout(20000));
  const childId = started.execution.childSessionId;
  const firstEnd = await f.turn(childId); assert.equal(firstEnd.data.reason.kind, 'completed'); assert.equal(aSteps, 3);
  await f.app.get('subagents').drainChildren(f.parent, [SessionId(childId)]);
  const original = f.observed.find(row => row.sessionId === childId && row.event.type === 'user/message' && row.event.data.source?.kind !== 'runtime-context');
  assert.doesNotMatch(JSON.stringify(original.event), /BOUNDARY_A_V[12]/, 'initial work instruction must not persist the injected boundary');
  enabled = false;
  await f.workers.recover(f.store.snapshot().intents.find(row => row.id === a.intent.id), f.parent, AbortSignal.timeout(10000));
  await f.workers.steer(a.intent.id, 'Recheck the saved local result', f.parent, AbortSignal.timeout(10000));
  assert.equal((await f.turn(childId, firstEnd.data.turn + 1)).data.reason.kind, 'completed');
  await f.app.get('subagents').drainChildren(f.parent, [SessionId(childId)]);
  enabled = true;
  const other = await f.workers.start(b.task.id, f.parent, AbortSignal.timeout(20000));
  assert.equal((await f.turn(other.execution.childSessionId)).data.reason.kind, 'completed');
  await f.app.get('subagents').drainChildren(f.parent, [SessionId(other.execution.childSessionId)]);
  const bRequests = f.adapter.requests.filter(request => requestSystem(request).includes(other.execution.childSessionId));
  assert.ok(bRequests.length); assert.ok(bRequests.every(request => requestSystem(request).includes('BOUNDARY_B_ONLY')));
  assert.ok(bRequests.every(request => !JSON.stringify(request.messages).includes('BOUNDARY_A_V')));
  assert.ok(f.adapter.requests.filter(request => !requestSystem(request).includes('MANAGED_WORKER_')).every(request => !requestSystem(request).includes('BOUNDARY_')));
});

test('native Worker spawn/fork apply managed prompts and tool defaults; cold recovery rebuilds latest config without touching parent scopes', { timeout: 60000 }, async t => {
  const f = await fixture(t);
  assert.equal((await f.execute('platform_fixture_echo')).value.count, null);
  assert.equal((await f.execute('platform_parent_only', f.unrelated)).value, 'parent available');
  for (const provider of ['spawn', 'fork']) {
    const { task, intent } = await f.newIntent(`${provider} platform worker`);
    const started = await f.workers.start(task.id, f.parent, AbortSignal.timeout(15000), provider);
    const id = started.execution.childSessionId;
    const firstEnd = await f.turn(id);
    assert.equal(firstEnd.data.reason.kind, 'completed', JSON.stringify(f.observed.filter(row => row.sessionId === id)));
    await f.app.get('subagents').drainChildren(f.parent, [SessionId(id)]);
    assert.equal(f.store.snapshot().intents.find(i => i.id === intent.id).state, 'done');
    assert.ok(f.disposed.includes(id), 'disposing native child releases prepared platform run');
    assert.deepEqual(f.actualCalls.find(call => call.sessionId === id), { count: 17, sessionId: id });
    const requests = f.adapter.requests.filter(request => requestSystem(request).includes(id));
    assert.ok(requests.length >= 2);
    assert.ok(requests.every(request => requestSystem(request).includes('MANAGED_WORKER_V1')));
    assert.ok(requests.every(request => request.tools.some(tool => tool.name === 'platform_fixture_echo' && tool.description === 'Managed worker echo')));
    assert.ok(requests.every(request => !request.tools.some(tool => tool.name === 'platform_parent_only')));
    assert.equal(f.app.get('agents').get(SessionId(id)), undefined);
    assert.ok(await f.app.get('sessionPersistence').stat(SessionId(id)));
    await f.workers.recover(f.store.snapshot().intents.find(i => i.id === intent.id), f.parent, AbortSignal.timeout(10000));
    assert.equal(f.store.snapshot().intents.find(i => i.id === intent.id).output.recovery.reason, 'settled-log');
    await f.platform.agents.savePrompt('worker', { template: 'MANAGED_WORKER_V2 {{.WorkerName}}' });
    const schema = structuredClone(f.platform.agents.listTools().find(tool => tool.key === 'platform_fixture_echo').schema); schema.properties.count.default = 29;
    await f.platform.agents.updateTool('platform_fixture_echo', { schema });
    const beforeRequests = f.adapter.requests.length;
    await f.workers.steer(intent.id, 'Continue the same persisted child', f.parent, AbortSignal.timeout(15000));
    assert.equal((await f.turn(id, firstEnd.data.turn + 1)).data.reason.kind, 'completed');
    await f.app.get('subagents').drainChildren(f.parent, [SessionId(id)]);
    assert.equal(f.actualCalls.filter(call => call.sessionId === id).at(-1).count, 29);
    assert.ok(f.adapter.requests.slice(beforeRequests).some(request => requestSystem(request).includes(`MANAGED_WORKER_V2 ${id}`)));
    assert.equal(f.store.snapshot().intents.find(i => i.id === intent.id).state, 'done');
    await f.platform.agents.savePrompt('worker', { template: 'MANAGED_WORKER_V1 {{.WorkerName}}' }); schema.properties.count.default = 17; await f.platform.agents.updateTool('platform_fixture_echo', { schema });
  }
  assert.equal((await f.execute('platform_fixture_echo')).value.count, null, 'worker defaults never mutate parent tool implementation');
  assert.equal((await f.execute('platform_parent_only')).value, 'parent available', 'worker binding never restricts parent');
  f.unrelated.followup(createUserMessage({ content: [{ type: 'text', text: 'Unrelated agent fixture' }], source: { kind: 'user' } }));
  await f.unrelated.whenIdle(); await f.parent.whenIdle();
  const ordinary = f.adapter.requests.filter(request => !requestSystem(request).includes('MANAGED_WORKER_'));
  assert.ok(ordinary.length >= 1); assert.ok(ordinary.every(request => request.tools.some(tool => tool.name === 'platform_parent_only')));
  assert.ok(f.prepared.every(entry => entry.input.agentKey === 'worker' && entry.input.parent === f.parent));
});

test('native Worker failure and cancellation release platform attachment and preserve paused/blocked outcomes', { timeout: 45000 }, async t => {
  const f = await fixture(t);
  f.adapter.mode = 'fail';
  const failed = await f.newIntent('failed model fixture');
  const accepted = await f.workers.start(failed.task.id, f.parent, AbortSignal.timeout(15000));
  await f.turn(accepted.execution.childSessionId);
  await f.app.get('subagents').drainChildren(f.parent, [SessionId(accepted.execution.childSessionId)]);
  assert.equal(f.store.snapshot().intents.find(i => i.id === failed.intent.id).state, 'blocked');
  assert.ok(f.disposed.includes(accepted.execution.childSessionId));
  f.adapter.mode = 'hold';
  const held = await f.newIntent('cancelled model fixture');
  const running = await f.workers.start(held.task.id, f.parent, AbortSignal.timeout(15000));
  await f.adapter.entered.promise;
  const stopped = await f.workers.stop(held.intent.id, f.parent);
  assert.equal(stopped.state, 'paused');
  assert.ok(f.disposed.includes(running.execution.childSessionId));
  assert.equal(f.app.get('agents').get(SessionId(running.execution.childSessionId)), undefined);
  assert.ok(await f.app.get('sessionPersistence').stat(SessionId(running.execution.childSessionId)));
  assert.equal((await f.execute('platform_parent_only')).value, 'parent available');
});

test('attached main Agent and spawned Worker retain independent prompts, profiles, tool bindings and turn budgets', { timeout: 60000 }, async t => {
  const f = await fixture(t, { platform: {
    profileExists: id => id === 'main-route' || id === 'worker-route',
    resolveProfile: id => ({ provider: 'platform-fixture', model: id === 'main-route' ? 'main-profile-model' : 'worker-profile-model' }),
  } });
  await f.platform.agents.savePrompt('mainagent', { template: 'MANAGED_MAIN_ISOLATED' });
  await f.platform.agents.saveWrapup('mainagent', { prompt: 'MAIN_BUDGET_WRAPUP', maxTurns: 1 });
  await f.platform.agents.update('mainagent', { llmProfileId: 'main-route', maxTurns: 2, runSeconds: 0 });
  await f.platform.agents.saveWrapup('worker', { prompt: 'WORKER_BUDGET_WRAPUP', maxTurns: 1 });
  await f.platform.agents.update('worker', { llmProfileId: 'worker-route', maxTurns: 2, runSeconds: 0 });
  await f.platform.agents.updateTool('platform_parent_only', { agents: ['mainagent'] });
  await f.attachParent();
  const { task, intent } = await f.newIntent('main-scope child isolation');
  const started = await f.workers.start(task.id, f.parent, AbortSignal.timeout(15000));
  const childId = started.execution.childSessionId;
  assert.equal((await f.turn(childId)).data.reason.kind, 'completed', JSON.stringify(f.observed.filter(row => row.sessionId === childId)));
  await f.app.get('subagents').drainChildren(f.parent, [SessionId(childId)]);
  await f.parent.whenIdle();
  const childRequests = f.adapter.requests.filter(request => requestSystem(request).includes(`MANAGED_WORKER_V1 ${childId}`));
  assert.equal(childRequests.length, 2, 'real Worker tool call and final response both reach its own model');
  assert.ok(childRequests.every(request => request.model === 'worker-profile-model'));
  assert.ok(childRequests.every(request => !requestSystem(request).includes('MANAGED_MAIN_ISOLATED') && !requestSystem(request).includes('MAIN_BUDGET_WRAPUP')));
  assert.ok(childRequests.every(request => request.tools.some(tool => tool.name === 'platform_fixture_echo') && !request.tools.some(tool => tool.name === 'platform_parent_only')));
  assert.equal(f.actualCalls.find(call => call.sessionId === childId).count, 17);
  assert.equal(f.store.snapshot().intents.find(row => row.id === intent.id).state, 'done');
  const mainRequests = () => f.adapter.requests.filter(request => requestSystem(request).includes('MANAGED_MAIN_ISOLATED'));
  assert.equal(mainRequests().length, 1, 'native child delivery wakes its actual parent once');
  assert.ok(!requestSystem(mainRequests()[0]).includes('MAIN_BUDGET_WRAPUP'), 'two child model steps must not consume either parent normal step');
  for (let index = 0; index < 2; index++) {
    f.parent.followup(createUserMessage({ content: [{ type: 'text', text: `Parent budget step ${index + 2}` }], source: { kind: 'user' } }));
    await f.parent.whenIdle();
    const end = [...f.parent.session.snapshotEvents()].reverse().find(event => event.type === 'turn/end');
    assert.equal(end.data.reason.kind, 'completed', JSON.stringify(end));
  }
  assert.equal(mainRequests().length, 3, 'main receives its two normal steps and one wrapup step');
  assert.ok(mainRequests().every(request => request.model === 'main-profile-model' && !requestSystem(request).includes('MANAGED_WORKER_V1')));
  assert.ok(mainRequests().every(request => request.tools.some(tool => tool.name === 'platform_parent_only') && !request.tools.some(tool => tool.name === 'platform_fixture_echo')));
  assert.ok(requestSystem(mainRequests().at(-1)).includes('MAIN_BUDGET_WRAPUP'));
  f.parent.followup(createUserMessage({ content: [{ type: 'text', text: 'Beyond the parent budget' }], source: { kind: 'user' } }));
  await f.parent.whenIdle();
  const lastEnd = [...f.parent.session.snapshotEvents()].reverse().find(event => event.type === 'turn/end');
  assert.equal(lastEnd.data.reason.kind, 'error');
  assert.match(JSON.stringify(lastEnd.data.reason), /exhausted model turn and wrapup budget/);
  assert.equal(mainRequests().length, 3, 'exhausted parent cannot reach the model again');
  assert.equal((await f.execute('platform_fixture_echo', f.unrelated)).value.count, null, 'unrelated scope retains original tool behavior');
});

test('task timeout switches only its active Worker after the current step and enforces an independent idempotent wrapup budget', { timeout: 60000 }, async t => {
  const f = await fixture(t);
  await f.platform.agents.update('worker', { maxTurns: 1, runSeconds: 0 });
  await f.platform.agents.saveWrapup('worker', { prompt: 'ORDINARY_WRAPUP_ONLY', maxTurns: 1 });
  await f.platform.agents.saveWrapup('worker', { prompt: 'TASK_DEADLINE_WRAPUP_ONLY', maxTurns: 2 }, 'task_timeout');
  const entered = Promise.withResolvers(); const release = Promise.withResolvers();
  t.after(() => release.resolve());
  const isTarget = request => requestSystem(request).includes('MANAGED_WORKER_') && JSON.stringify(request.messages).includes('deadline target fixture');
  let targetRequestCount = 0;
  f.adapter.beforeResponse = async request => {
    if (!isTarget(request)) return;
    targetRequestCount++;
    if (targetRequestCount === 1) {
      entered.resolve();
      await Promise.race([release.promise, new Promise(resolve => request.signal.addEventListener('abort', resolve, { once: true }))]);
      request.signal.throwIfAborted();
    }
  };
  f.adapter.forceTool = isTarget;
  const target = await f.newIntent('deadline target fixture');
  const running = await f.workers.start(target.task.id, f.parent, AbortSignal.timeout(20000));
  const targetId = running.execution.childSessionId;
  await entered.promise;
  assert.equal(targetRequestCount, 1);
  const firstRequest = f.adapter.requests.find(isTarget);
  assert.ok(!requestSystem(firstRequest).includes('TASK_DEADLINE_WRAPUP_ONLY'));
  await f.workers.beginTaskTimeout(target.task.id);
  await f.workers.beginTaskTimeout(target.task.id);
  assert.equal(targetRequestCount, 1, 'timeout switching does not cancel or replace the in-flight model step');
  assert.equal(firstRequest.signal.aborted, false);

  // Exercise another actual task while the timed-out child is still blocked at
  // the model boundary, so accidental global timeout state becomes observable.
  const other = await f.newIntent('unrelated active task fixture');
  const otherRun = await f.workers.start(other.task.id, f.parent, AbortSignal.timeout(20000));
  const otherId = otherRun.execution.childSessionId;
  assert.equal((await f.turn(otherId)).data.reason.kind, 'completed');
  await f.app.get('subagents').drainChildren(f.parent, [SessionId(otherId)]);
  const otherRequests = f.adapter.requests.filter(request => requestSystem(request).includes(`MANAGED_WORKER_V1 ${otherId}`));
  assert.equal(otherRequests.length, 2);
  assert.ok(otherRequests.every(request => !requestSystem(request).includes('TASK_DEADLINE_WRAPUP_ONLY')));
  assert.equal(f.store.snapshot().intents.find(row => row.id === other.intent.id).state, 'done');
  assert.equal(targetRequestCount, 1);

  release.resolve();
  const end = await f.turn(targetId);
  assert.equal(end.data.reason.kind, 'error');
  assert.match(JSON.stringify(end.data.reason), /exhausted task timeout wrapup budget/);
  await f.app.get('subagents').drainChildren(f.parent, [SessionId(targetId)]);
  const targetRequests = f.adapter.requests.filter(isTarget);
  assert.equal(targetRequests.length, 3, 'one existing ordinary step plus exactly two independent timeout model steps');
  assert.ok(targetRequests.slice(1).every(request => requestSystem(request).includes('TASK_DEADLINE_WRAPUP_ONLY')));
  assert.equal(f.actualCalls.filter(call => call.sessionId === targetId).length, 3, 'each admitted step executes a real tool; no extra request follows the timeout budget');
  const instructions = f.observed.filter(row => row.sessionId === targetId && row.event.type === 'user/message' && row.event.data.source?.kind === 'artex-wrapup' && JSON.stringify(row.event.data.content).includes('TASK_DEADLINE_WRAPUP_ONLY'));
  assert.equal(instructions.length, 1, 'repeated beginTaskTimeout cannot duplicate the steering instruction or reset its budget');
  assert.equal(f.store.snapshot().intents.find(row => row.id === target.intent.id).state, 'blocked');
  assert.ok(f.disposed.includes(targetId));
});
