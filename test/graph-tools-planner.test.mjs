import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { build } from 'esbuild';
import { Context } from '@deepseek-ai/cordis';
import { SessionId, SessionStore } from '@deepseek-ai/dsh-session';
import AgentRegistry from '@deepseek-ai/dsh-agent';
import AgentLoop from '@deepseek-ai/dsh-agent-loop';
import LlmRuntime, { LlmAdapter } from '@deepseek-ai/dsh-llm';
import SystemPrompt from '@deepseek-ai/dsh-system-prompt';
import ToolRuntime from '@deepseek-ai/dsh-tools';
import SessionProjections from '@deepseek-ai/dsh-session-projection';

const built = await build({ stdin: { contents: "export { installPlanner } from './src/planner/integration.ts'; export { installTaskLifecycle } from './src/task-management/integration.ts'; export { RedTeamStore } from './src/store.ts';", resolveDir: process.cwd(), loader: 'ts' }, bundle: true, write: false, platform: 'node', format: 'esm', packages: 'external' });
const code = built.outputFiles[0].text.replace(/from\s+(["'])([^"']+)\1/g, (_match, _quote, specifier) => `from ${JSON.stringify(import.meta.resolve(specifier))}`);
const { installPlanner, installTaskLifecycle, RedTeamStore } = await import(`data:text/javascript;base64,${Buffer.from(code + '\n//# sourceURL=graph-tools-planner-tests.bundle.mjs').toString('base64')}`);
const deferred = () => Promise.withResolvers();

class Adapter extends LlmAdapter {
  requests = []; digestStarted = deferred(); digestFinished = deferred(); release = deferred();
  constructor(hold) { super(); this.hold = hold; }
  async resolveModel(provider, model) { return { provider, id: model, name: model }; }
  async *stream(request) {
    this.requests.push(request);
    if (request.purpose === 'compaction') {
      this.digestStarted.resolve(request);
      try {
        if (this.hold) await this.release.promise;
        yield { type: 'text-delta', index: 0, text: 'Observed combined conclusion (#f0,#f19).' };
        yield { type: 'usage', usage: { inputTokens: 110, outputTokens: 18 } };
        yield { type: 'finish', reason: { kind: 'stop' } };
      } finally { this.digestFinished.resolve(); }
      return;
    }
    yield { type: 'text-delta', index: 0, text: '已有待处理方向，保留当前规划。' };
    yield { type: 'finish', reason: { kind: 'stop' } };
  }
}

async function fixture(t, options = {}) {
  const dir = await mkdtemp(join(tmpdir(), 'graph-planner-')), store = new RedTeamStore(join(dir, 'state.json'));
  const task = await store.createManagedTask({ title: 'Digest integration', timeoutSeconds: 300 });
  await store.addGoal({ taskId: task.id, text: 'Verify fixture', state: 'open' });
  await store.addIntent({ taskId: task.id, summary: 'Existing open direction', input: {} });
  await store.transaction(state => {
    state.tasks.find(row => row.id === task.id).graphCompaction = { round: 6 };
    for (let i = 0; i < 20; i++) {
      state.nodes.push({ id: `f${i}`, taskId: task.id, kind: 'fact', label: `Independent evidence ${i}`, data: { state: 'confirmed', cold_since_round: 1 } });
      if (i) state.edges.push({ id: `e${i}`, taskId: task.id, from: `f${i - 1}`, to: `f${i}`, relation: 'derived_from' });
    }
  });
  const app = new Context(), fibers = [], adapter = new Adapter(options.hold), calls = [], usage = [], errors = [];
  let handle, planner, lifecycle;
  t.after(async () => {
    adapter.release.resolve(); await lifecycle?.dispose(); await planner?.dispose(); await handle?.dispose();
    for (const fiber of fibers.reverse()) await fiber.dispose();
    await rm(dir, { recursive: true, force: true });
  });
  for (const [plugin, config] of [[SessionStore], [AgentRegistry], [LlmRuntime], [SystemPrompt, {}], [ToolRuntime, { mode: 'native' }], [SessionProjections], [AgentLoop, {}]]) fibers.push(await app.plugin(plugin, config));
  fibers.push(await app.plugin(ctx => { ctx.inject(['llm', 'tools'], scope => {
    scope.llm.registerAdapter(['fixture'], adapter);
    scope.on('llm/stream', async function* (request, next) {
      for await (const chunk of next()) { if (chunk.type === 'usage') usage.push({ sessionId: request.sessionId, purpose: request.purpose, model: request.model, usage: chunk.usage }); yield chunk; }
    });
    const workers = { start: async () => undefined, stop: async () => {}, steer: async () => {}, quiesceTask: async () => {} };
    planner = installPlanner(scope, store, workers, { concurrency: 1, debounceMs: 60_000, onError: error => errors.push(error), modelStream(call) { calls.push(call); return lifecycle.modelStream(call); } });
    lifecycle = installTaskLifecycle(scope, store, planner, { concurrency: 1, autoPoll: false, profiles: {
      resolveProfile: () => null,
      resolveBinding: (_taskId, role) => role === 'planner' ? { provider: 'fixture', model: 'bound-planner', ...(options.profileMax === undefined ? {} : { maxTokens: options.profileMax }) } : null,
    } });
  }); }));
  handle = await app.get('agents').create({ sessionId: SessionId(randomUUID()), agentOptions: { provider: 'fixture', model: 'parent', maxTokens: 4096 } });
  lifecycle.bindParent(task.id, handle.agent);
  const start = async () => { await planner.start(task.id, handle.agent); planner.notify(task.id, { kind: 'change' }); await planner.runtime.flush(task.id); };
  const digests = () => store.snapshot().nodes.filter(node => node.taskId === task.id && node.data.kind === 'digest');
  return { store, task, adapter, calls, usage, errors, planner, lifecycle, agent: handle.agent, start, digests };
}

test('actual Planner round dispatches digest through lifecycle planner profile and attributes native usage to the parent', { timeout: 15000 }, async t => {
  const f = await fixture(t); await f.start(); await f.planner.compactor.waitForIdle(f.task.id);
  assert.equal(f.digests().length, 1); assert.equal(f.digests()[0].data.member_ids.facts.length, 20);
  const digest = f.calls.find(call => call.purpose === 'digest');
  assert.equal(digest.role, 'planner'); assert.equal(digest.request.purpose, 'compaction'); assert.equal(digest.request.sessionId, f.agent.id);
  const request = f.adapter.requests.find(request => request.purpose === 'compaction');
  assert.equal(request.model, 'bound-planner'); assert.equal(request.sessionId, f.agent.id);
  assert.equal(f.store.snapshot().tasks[0].graphCompaction.round, 7);
  const ordinary = f.adapter.requests.find(request => !request.purpose);
  assert.equal(JSON.parse(ordinary.messages[0].content[0].text).task.graphCompaction.round, 7, 'Planner snapshot follows durable compaction maintenance');
  assert.ok(f.store.snapshot().tasks[0].firstRunAt);
  assert.deepEqual(f.usage, [{ sessionId: f.agent.id, purpose: 'compaction', model: 'bound-planner', usage: { inputTokens: 110, outputTokens: 18 } }]);
  assert.deepEqual(f.errors, []);
});

for (const mode of ['runtime_pause', 'park', 'settle', 'dispose']) {
  test(`${mode} cancels a real in-flight digest and late provider completion cannot persist output or cancellation errors`, { timeout: 15000 }, async t => {
    const f = await fixture(t, { hold: true }); await f.start();
    const request = await f.adapter.digestStarted.promise;
    if (mode === 'runtime_pause') await f.planner.runtime.pause(f.task.id);
    else if (mode === 'park') await f.planner.park(f.task.id, f.agent);
    else if (mode === 'settle') await f.planner.beginSettling(f.task.id, f.agent);
    else { await f.lifecycle.dispose(); await f.planner.dispose(); }
    assert.equal(request.signal.aborted, true); const stopped = f.store.snapshot();
    if (mode === 'runtime_pause') {
      // The archive quiesce entry point is runtime.pause; removing the task after it drains is safe.
      await f.store.transaction(state => { state.tasks = state.tasks.filter(task => task.id !== f.task.id); });
    }
    const archived = f.store.snapshot();
    f.adapter.release.resolve(); await f.adapter.digestFinished.promise;
    await new Promise(resolve => setImmediate(resolve));
    assert.deepEqual(f.store.snapshot(), archived, 'no commit after pause/park/settle/dispose, including no error trace');
    assert.equal(f.digests().length, 0); assert.deepEqual(f.errors, []);
    if (mode === 'runtime_pause') await f.store.transaction(state => { state.tasks = stopped.tasks; });
  });
}

test('digest output budget survives an actual planner profile with a larger configured limit', { timeout: 15000 }, async t => {
  const f = await fixture(t, { profileMax: 4096 }); await f.start(); await f.planner.compactor.waitForIdle(f.task.id);
  assert.equal(f.adapter.requests.find(request => request.purpose === 'compaction').maxTokens, 1500);
  assert.equal(f.adapter.requests.find(request => !request.purpose).maxTokens, 4096);
});
