import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { build } from 'esbuild';
import { Context } from '@deepseek-ai/cordis';
import { Session, SessionId, SessionStore } from '@deepseek-ai/dsh-session';
import AgentRegistry from '@deepseek-ai/dsh-agent';
import AgentLoop from '@deepseek-ai/dsh-agent-loop';
import LlmRuntime, { LlmAdapter } from '@deepseek-ai/dsh-llm';
import SystemPrompt from '@deepseek-ai/dsh-system-prompt';
import ToolRuntime from '@deepseek-ai/dsh-tools';
import SessionProjections from '@deepseek-ai/dsh-session-projection';
import LocalFileSystem from '@deepseek-ai/dsh-fs-local';
import WorkingDirectory from '@deepseek-ai/dsh-working-directory';
import * as JsonlPersistence from '@deepseek-ai/dsh-session-persistence-jsonl';
import SessionQuery from '@deepseek-ai/dsh-session-query-sqlite';
import Subagents from '@deepseek-ai/dsh-subagent';
import * as spawnProvider from '@deepseek-ai/dsh-subagent-spawn-in-process';

// Compile current sources in memory without racing another agent's lib/ build.
const bundled = await build({ stdin: { contents: "export { installPlanner } from './src/planner/integration.ts'; export { RedTeamStore } from './src/store.ts'; export { WorkerRuntime } from './src/workers.ts'; export { installGraphTools } from './src/graph-tools/index.ts';", resolveDir: process.cwd(), loader: 'ts' }, bundle: true, write: false, platform: 'node', format: 'esm', packages: 'external' });
const code = bundled.outputFiles[0].text.replace(/from\s+(["'])([^"']+)\1/g, (_match, _quote, specifier) => `from ${JSON.stringify(import.meta.resolve(specifier))}`);
const { installPlanner, RedTeamStore, WorkerRuntime, installGraphTools } = await import(`data:text/javascript;base64,${Buffer.from(`${code}\n//# sourceURL=planner-integration-tests.bundle.mjs`).toString('base64')}`);
const toolCall = (name, args) => ({ name, args });
const addWork = (...summaries) => [toolCall('add_intent', { intents: summaries.map(summary => ({ summary })) })];
const toolNames = ['redteam_start_planner', 'redteam_pause_planner', 'redteam_steer_planner', 'redteam_planner_status'];

class ScriptedAdapter extends LlmAdapter {
  requests = [];
  responses = [];
  async resolveModel(provider, model) {
    return { provider, id: model, name: model, reasoning: { efforts: [{ id: 'high', name: 'High' }], defaultEffort: 'high' } };
  }
  async *stream(request) {
    this.requests.push(request);
    assert.ok(this.responses.length, 'unexpected external model call');
    const response = this.responses.shift();
    if (response === 'done') {
      yield { type: 'text-delta', index: 0, text: '本轮完成' };
      yield { type: 'finish', reason: { kind: 'stop' } };
      return;
    }
    for (const [index, call] of response.entries()) {
      yield { type: 'tool-call-delta', index, id: randomUUID(), name: call.name, argumentsDelta: JSON.stringify(call.args) };
    }
    yield { type: 'finish', reason: { kind: 'tool-calls' } };
  }
}

async function fixture(t, options = {}) {
  const dir = await mkdtemp(join(tmpdir(), 'planner-integration-'));
  const store = new RedTeamStore(join(dir, 'state.json'));
  const task = await store.createTask('Planner integration fixture', options.goal ?? 'Verify the authorized fixture');
  if (!options.bootstrap) await store.addGoal({ taskId: task.id, text: 'Deliver verified fixture evidence', state: 'open' });
  const app = new Context();
  const fibers = [];
  const parents = [];
  const adapter = new ScriptedAdapter();
  const sessions = new Map();
  const drains = [];
  const nativeDone = Promise.withResolvers();
  let workers, installed;
  const service = {
    getProvider: () => ({ prepareContinuable() {} }), resolveMaxDepth: () => 3,
    async startActivation(spec) {
      const session = Session.create(spec.childId);
      sessions.set(spec.childId, session);
      await workers.observe(session, session.append('turn/start', { turn: 1 }));
      return { childId: spec.childId, messageId: randomUUID(), result: Promise.resolve({ reason: { kind: 'completed' } }) };
    },
    async drainChildren(_parent, ids) {
      drains.push(...ids);
      for (const id of ids) {
        const session = sessions.get(id);
        const intent = store.snapshot().intents.find(row => row.execution?.childSessionId === id);
        if (session && ['running', 'claimed'].includes(intent?.state)) {
          await workers.observe(session, session.append('turn/end', { turn: 1, reason: { kind: 'aborted' } }));
        }
      }
    },
    async sendMessage(_parent, id) {
      const session = sessions.get(id);
      await workers.observe(session, session.append('turn/start', { turn: 2 }));
      return randomUUID();
    },
  };
  workers = new WorkerRuntime({ subagents: service }, store, options.concurrency ?? 1);
  t.after(async () => {
    await installed?.dispose();
    await workers.dispose();
    for (const parent of parents.reverse()) await parent.dispose();
    for (const fiber of fibers.reverse()) await fiber.dispose();
    await rm(dir, { recursive: true, force: true });
  });
  async function mount(plugin, config) { fibers.push(await app.plugin(plugin, config)); }
  await mount(SessionStore);
  await mount(AgentRegistry);
  await mount(LlmRuntime);
  await mount(SystemPrompt, {});
  await mount(ToolRuntime, { mode: 'native' });
  await mount(SessionProjections);
  if (options.native) {
    await mount(LocalFileSystem, { cwd: dir });
    await mount(WorkingDirectory, { defaultDirectory: dir });
    await mount(JsonlPersistence, { root: join(dir, 'sessions') });
    await mount(SessionQuery, { path: ':memory:', openAt: 'never' });
  }
  await mount(AgentLoop, {});
  if (options.native) {
    await mount(Subagents, {});
    await mount(spawnProvider, {});
    workers = new WorkerRuntime({ subagents: app.get('subagents') }, store, options.concurrency ?? 1);
    await mount(ctx => { ctx.on('session/event', (session, event) => {
      if (!store.snapshot().intents.some(row => row.execution?.childSessionId === session.id)) return;
      void workers.observe(session, event).then(() => {
        installed?.notifyWorkerEvent(session, event);
        if (event.type === 'turn/end') nativeDone.resolve({ session, event });
      }, nativeDone.reject);
    }); });
  }
  await mount(ctx => { ctx.inject(['llm'], inner => { inner.llm.registerAdapter(['planner-fixture'], adapter); }); });
  const plannerPlugin = ctx => { ctx.inject(['tools', 'llm'], inner => {
    installed = installPlanner(inner, store, workers, { concurrency: options.concurrency ?? 1, debounceMs: 60_000, maxTurns: 5, onError() {}, ...options.config });
  }); };
  if (!options.scoped) await mount(plannerPlugin);
  async function parent(overrides = {}, setup) {
    const handle = await app.get('agents').create({ sessionId: SessionId(randomUUID()), meta: { cwd: dir }, agentOptions: { provider: 'planner-fixture', model: 'actual-parent-model', maxTokens: 1234, reasoningEffort: 'high', ...overrides }, setup });
    parents.push(handle);
    return handle.agent;
  }
  const agent = await parent({}, options.scoped ? async ctx => { await ctx.plugin(plannerPlugin); } : undefined);
  assert.ok(installed, 'Cordis injection must install the Planner');
  const call = (name, args = { task_id: task.id }, caller = agent) => app.get('tools').execute({ callId: randomUUID(), name, arguments: args, agent: caller, signal: AbortSignal.timeout(10000) });
  async function ok(name, args, caller) {
    const result = await call(name, args, caller);
    assert.equal(result.isError, false, JSON.stringify(result));
    return result.value;
  }
  return { app, store, task, adapter, sessions, workers, installed, agent, parent, call, ok, nativeDone, drains };
}

test('real Cordis tools start, inspect, steer and pause using the live parent model route', { timeout: 15000 }, async t => {
  const hooks = [];
  const messages = [];
  const f = await fixture(t, { config: { beforeModelCall: call => hooks.push(call), onMessage: (taskId, message) => messages.push({ taskId, message }) } });
  f.adapter.responses.push(addWork('Inspect first fixture', 'Inspect second fixture'), 'done');
  const started = await f.ok('redteam_start_planner');
  assert.equal(started.taskStatus, 'running');
  assert.deepEqual(started.counts, { open: 1, claimed: 0, running: 1, paused: 0, done: 0, failed: 0, stopped: 0, exhausted: 0, blocked: 0 });
  assert.equal(f.sessions.size, 1, 'concurrency limit must leave the second intent queued');
  assert.equal(hooks.length, 2, 'admission hook runs before each tool-loop model request');
  assert.ok(hooks.every(call => call.parent === f.agent && call.taskId === f.task.id));
  assert.ok(f.adapter.requests.every(request => request.provider === 'planner-fixture' && request.model === 'actual-parent-model' && request.maxTokens === 1234 && request.reasoningEffort === 'high'));
  assert.ok(f.store.snapshot().tasks[0].firstRunAt, 'first actual model request starts the task clock');
  assert.ok(messages.some(row => row.taskId === f.task.id && row.message.role === 'assistant'));
  const status = await f.ok('redteam_planner_status');
  assert.equal(status.runtime.parentSessionId, f.agent.id);
  const hint = await f.ok('redteam_steer_planner', { task_id: f.task.id, message: 'Prioritize fixture evidence' });
  assert.equal(f.store.snapshot().nodes.find(row => row.id === hint.hintId).label, 'Prioritize fixture evidence');
  f.adapter.responses.push('done');
  await f.installed.runtime.flush(f.task.id);
  const planningInput = JSON.parse(f.adapter.requests.at(-1).messages[0].content[0].text);
  assert.ok(planningInput.triggers.some(trigger => trigger.kind === 'hint' && trigger.hints.includes('Prioritize fixture evidence')));
  const paused = await f.ok('redteam_pause_planner');
  assert.equal(paused.taskStatus, 'paused');
  assert.equal(paused.attached, false);
  assert.equal(paused.counts.running, 0);
});

test('unregistered parent provider is rejected before any task state mutation', async t => {
  const f = await fixture(t);
  const foreignRoute = await f.parent({ provider: 'unregistered-provider' });
  const before = f.store.snapshot();
  const result = await f.call('redteam_start_planner', undefined, foreignRoute);
  assert.equal(result.isError, true);
  assert.match(JSON.stringify(result), /provider is not registered/);
  assert.deepEqual(f.store.snapshot(), before);
  assert.equal(f.adapter.requests.length, 0);
  assert.equal(f.installed.status(f.task.id).attached, false);
});

test('foreign parent cannot pause or steer a running Planner', async t => {
  const f = await fixture(t);
  f.adapter.responses.push(addWork('Keep authorized owner'), 'done');
  await f.ok('redteam_start_planner');
  const foreign = await f.parent();
  for (const [name, extra] of [['redteam_pause_planner', {}], ['redteam_steer_planner', { message: 'Foreign message' }]]) {
    const result = await f.call(name, { task_id: f.task.id, ...extra }, foreign);
    assert.equal(result.isError, true);
    assert.match(JSON.stringify(result), /another parent session/);
  }
  assert.equal(f.installed.status(f.task.id).taskStatus, 'running');
  assert.equal(f.installed.status(f.task.id).counts.running, 1);
  assert.equal(f.store.snapshot().nodes.some(row => row.label === 'Foreign message'), false);
});

test('failed beforeModelCall propagates through native tools without sending a model request or stamping time', async t => {
  const f = await fixture(t, { config: { beforeModelCall() { throw new Error('fixture admission denied'); } } });
  const result = await f.call('redteam_start_planner');
  assert.equal(result.isError, true);
  assert.match(JSON.stringify(result), /fixture admission denied/);
  assert.equal(f.adapter.requests.length, 0);
  assert.equal(f.store.snapshot().tasks[0].firstRunAt, undefined);
  assert.equal(f.store.snapshot().intents.length, 0);
  assert.ok(f.store.snapshot().traces.some(row => row.kind === 'error' && row.summary.includes('fixture admission denied')));
});

test('native Session turn/end is observed before notification and deduplicated only after commit', async t => {
  const f = await fixture(t);
  f.adapter.responses.push(addWork('Complete first', 'Refill second'), 'done');
  await f.ok('redteam_start_planner');
  const first = f.store.snapshot().intents.find(row => row.state === 'running');
  const session = f.sessions.get(first.execution.childSessionId);
  const event = session.append('turn/end', { turn: 1, reason: { kind: 'completed' } });
  f.installed.notifyWorkerEvent(session, event);
  assert.equal(f.installed.runtime.inspect(f.task.id).pendingTriggers, 0, 'uncommitted events must not be consumed');
  await f.workers.observe(session, event);
  f.installed.notifyWorkerEvent(session, event);
  f.installed.notifyWorkerEvent(session, event);
  assert.equal(f.installed.runtime.inspect(f.task.id).pendingTriggers, 1);
  f.adapter.responses.push('done');
  await f.installed.runtime.flush(f.task.id);
  assert.equal(f.sessions.size, 2, 'released capacity is refilled');
  assert.equal(f.store.snapshot().intents.find(row => row.id === first.id).state, 'done');
  const input = JSON.parse(f.adapter.requests.at(-1).messages[0].content[0].text);
  assert.deepEqual(input.triggers.filter(trigger => trigger.kind === 'done'), [{ kind: 'done', intentId: first.id, detail: 'completed' }]);
  f.installed.notifyWorkerEvent(session, event);
  await f.installed.runtime.flush(f.task.id);
  assert.equal(f.adapter.requests.length, 3, 'replayed terminal event must not trigger another model round');
});

test('goal-less task bootstraps real goals, constraints and scope before scheduling; resume retains decomposition', async t => {
  const f = await fixture(t, { bootstrap: true, goal: 'Verify https://fixture.example.test without deleting data' });
  assert.equal(f.store.snapshot().goals.length, 0);
  f.adapter.responses.push([
    toolCall('set_constraints', { text: 'Do not delete data', type: 'deny' }),
    toolCall('add_task_scope', { kind: 'subdomain', value: 'fixture.example.test', reason: 'Explicit URL in the task goal' }),
    toolCall('set_goals', { goals: [{ text: 'Deliver verified fixture evidence' }] }),
  ], 'done', addWork('Inspect authorized fixture'), 'done');
  await f.ok('redteam_start_planner');
  const snapshot = f.store.snapshot();
  assert.equal(snapshot.goals.length, 1);
  assert.equal(snapshot.goals[0].text, 'Deliver verified fixture evidence');
  assert.equal(snapshot.constraints[0].kind, 'deny');
  assert.equal(snapshot.scopes[0].value, 'fixture.example.test');
  assert.equal(snapshot.intents[0].state, 'running');
  assert.equal(f.adapter.requests.length, 4);
  await f.ok('redteam_pause_planner');
  await f.ok('redteam_start_planner');
  assert.equal(f.adapter.requests.length, 4, 'existing goals and retained work must not bootstrap again');
  assert.equal(f.store.snapshot().goals[0].id, snapshot.goals[0].id);
});

test('dispose unregisters all four native tools and is idempotent', async t => {
  const f = await fixture(t);
  for (const name of toolNames) assert.ok(f.app.get('tools').get(name, f.agent));
  await f.installed.dispose();
  await f.installed.dispose();
  for (const name of toolNames) assert.equal(f.app.get('tools').get(name, f.agent), undefined);
  const result = await f.call('redteam_start_planner');
  assert.equal(result.isError, true);
  assert.equal(f.adapter.requests.length, 0);
});

test('Planner starts a real native spawn child and receives its persisted completion event', { timeout: 15000 }, async t => {
  const f = await fixture(t, { native: true, scoped: true });
  // Native delivery also wakes the real parent AgentLoop to acknowledge the result.
  f.adapter.responses.push(addWork('Return a harmless fixture response'), 'done', 'done', 'done');
  await f.ok('redteam_start_planner');
  const { session, event } = await f.nativeDone.promise;
  assert.equal(event.data.reason.kind, 'completed');
  const intent = f.store.snapshot().intents[0];
  assert.equal(intent.state, 'done');
  assert.equal(intent.execution.childSessionId, session.id);
  assert.equal(intent.execution.lastEventSeq, event.seq);
  assert.match(JSON.stringify(intent.output), /本轮完成/);
  assert.ok(f.installed.runtime.inspect(f.task.id).pendingTriggers >= 1);
  await f.app.get('subagents').drainChildren(f.agent, [session.id]);
  assert.ok(await f.app.get('sessionPersistence').stat(session.id));
  assert.equal(f.app.get('agents').get(session.id), undefined);
  await f.agent.whenIdle();
  assert.equal(f.adapter.requests.length, 4);
  await f.ok('redteam_pause_planner');
});

test('agent-scoped Planner observes successful domain writes from a sibling Agent tool scope', async t => {
  const f = await fixture(t, { scoped: true });
  f.adapter.responses.push(addWork('Wait for evidence'), 'done');
  await f.ok('redteam_start_planner');
  const sibling = await f.parent({}, async ctx => { await ctx.plugin(inner => {
    inner.inject(['tools'], scope => { scope.effect(() => installGraphTools(scope, f.store, {
      notifyHint: (taskId, texts) => f.installed.notify(taskId, { kind: 'hint', hints: texts }),
      onMutation: (taskId, toolName) => f.installed.notify(taskId, { kind: 'change', detail: toolName }),
    })); });
  }); });
  assert.equal(f.app.get('tools').get('redteam_record_fact', f.agent), undefined, 'fixture writer must actually be scoped to a sibling');
  await f.ok('redteam_record_fact', { task_id: f.task.id, summary: 'Sibling fixture evidence', confidence: 'observed' }, sibling);
  assert.equal(f.installed.runtime.inspect(f.task.id).pendingTriggers, 1);
  f.adapter.responses.push('done');
  await f.installed.runtime.flush(f.task.id);
  const input = JSON.parse(f.adapter.requests.at(-1).messages[0].content[0].text);
  assert.ok(input.triggers.some(trigger => trigger.detail === 'redteam_record_fact'));
  assert.ok(input.nodes.some(fact => fact.kind === 'fact' && fact.label === 'Sibling fixture evidence'));
});

test('modelStream bridge handles bootstrap and planning after policy hooks and owns readiness stamping', async t => {
  const bridge = new ScriptedAdapter();
  const calls = [];
  const ordering = [];
  let f;
  f = await fixture(t, { bootstrap: true, config: {
    beforeModelCall() { ordering.push('policy'); },
    async *modelStream(call) {
      ordering.push('bridge'); calls.push(call);
      assert.equal(f.store.snapshot().tasks[0].firstRunAt, undefined, 'bridge must decide when the provider is ready before stamping');
      yield* bridge.stream(call.request);
    },
  } });
  bridge.responses.push([toolCall('set_goals', { text: 'Model bridge fixture objective' })], 'done', addWork('Bridge-selected work'), 'done');
  await f.ok('redteam_start_planner');
  assert.equal(f.adapter.requests.length, 0, 'configured bridge takes precedence over ctx.llm.stream');
  assert.deepEqual(ordering, ['policy', 'bridge', 'policy', 'bridge', 'policy', 'bridge', 'policy', 'bridge']);
  assert.equal(calls.length, 4);
  assert.ok(calls.every(call => call.parent === f.agent && call.taskId === f.task.id && call.final === false && !call.signal.aborted && call.request.signal === call.signal));
  assert.equal(f.store.snapshot().goals[0].text, 'Model bridge fixture objective');
  assert.equal(f.store.snapshot().intents[0].state, 'running');
});

test('FINAL freezes replenishment, waits for natural Worker completion, commits proof without a terminal task write', async t => {
  const bridge = new ScriptedAdapter();
  const bridgeCalls = [];
  const f = await fixture(t, { config: { async *modelStream(call) { bridgeCalls.push(call); yield* bridge.stream(call.request); } } });
  bridge.responses.push(addWork('Complete before FINAL', 'Do not dispatch during FINAL'), 'done');
  await f.ok('redteam_start_planner');
  const intent = f.store.snapshot().intents.find(row => row.state === 'running');
  const goal = f.store.snapshot().goals[0];
  const proof = await f.store.addNode({ id: randomUUID(), taskId: f.task.id, kind: 'fact', label: 'Verified fixture observation', data: { confidence: 'observed' } });
  const taskBefore = f.store.snapshot().tasks[0];
  await f.installed.beginSettling(f.task.id, f.agent);
  assert.equal(f.store.snapshot().intents.find(row => row.id === intent.id).state, 'running', 'settling must allow the active Worker to finish naturally');
  assert.equal(f.drains.length, 0);
  f.installed.notify(f.task.id, { kind: 'finding' });
  await f.installed.runtime.flush(f.task.id);
  assert.equal(bridge.requests.length, 2);
  bridge.responses.push([
    toolCall('add_intent', { summary: 'Forbidden FINAL work' }),
    toolCall('steer_work', { intent_id: intent.id, message: 'Forbidden FINAL steering' }),
    toolCall('prove_goal', { goal_id: goal.id, evidence_id: proof.id, reason: 'The verified fixture satisfies the objective' }),
  ], 'done');
  const final = f.installed.finalize(f.task.id, f.agent, new AbortController().signal);
  const session = f.sessions.get(intent.execution.childSessionId);
  const event = session.append('turn/end', { turn: 1, reason: { kind: 'completed' } });
  await f.workers.observe(session, event);
  f.installed.notifyWorkerEvent(session, event);
  assert.deepEqual(await final, { met: true });
  assert.deepEqual(await f.installed.finalize(f.task.id, f.agent, new AbortController().signal), { met: true }, 'repeated FINAL calls reuse the original judgment');
  assert.equal(bridgeCalls.filter(call => call.final).length, 2, 'one FINAL tool loop may need multiple model requests');
  assert.ok(bridgeCalls.filter(call => !call.final).every(call => call.signal.aborted), 'ordinary planning lifetime ends before the independent FINAL round');
  assert.ok(bridgeCalls.filter(call => call.final).every(call => !call.signal.aborted));
  const finalRequest = bridge.requests[2];
  assert.ok(finalRequest.tools.some(tool => tool.name === 'goal_met'));
  assert.ok(finalRequest.tools.some(tool => tool.name === 'prove_goal'));
  assert.equal(finalRequest.tools.some(tool => ['add_intent', 'steer_work', 'kill_work'].includes(tool.name)), false);
  const toolResults = bridge.requests[3].messages.filter(message => message.role === 'tool');
  assert.deepEqual(toolResults.map(message => message.isError), [true, true, false]);
  const snapshot = f.store.snapshot();
  assert.equal(snapshot.goals[0].state, 'met');
  assert.ok(snapshot.edges.some(edge => edge.from === proof.id && edge.to === goal.id && edge.relation === 'proves'));
  assert.deepEqual(snapshot.tasks[0], taskBefore, 'coordinator alone decides done versus timeout');
  assert.equal(snapshot.intents.length, 2);
  assert.equal(snapshot.intents.find(row => row.id === intent.id).state, 'done');
  assert.equal(snapshot.intents.filter(row => row.state === 'open').length, 1);
  assert.equal(f.sessions.size, 1, 'pending work cannot refill during settlement');
});

test('FINAL uses the 90-second grace budget then stops the native Worker and returns an unmet judgment', async t => {
  const f = await fixture(t);
  f.adapter.responses.push(addWork('Wait beyond settlement grace'), 'done');
  await f.ok('redteam_start_planner');
  const active = f.store.snapshot().intents[0];
  const taskBefore = f.store.snapshot().tasks[0];
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: Date.now() });
  f.adapter.responses.push('done');
  const final = f.installed.finalize(f.task.id, f.agent, new AbortController().signal);
  // Yield to let finalize establish its deadline and first event-driven wait.
  await new Promise(setImmediate);
  t.mock.timers.tick(89_999);
  await new Promise(setImmediate);
  assert.equal(f.adapter.requests.length, 2, 'no FINAL judgment while the grace budget remains');
  assert.equal(f.store.snapshot().intents[0].state, 'running');
  t.mock.timers.tick(1);
  assert.deepEqual(await final, { met: false });
  t.mock.timers.reset();
  assert.equal(f.store.snapshot().intents[0].state, 'stopped');
  assert.ok(f.drains.includes(active.execution.childSessionId));
  assert.equal(f.adapter.requests.length, 3, 'FINAL may return unmet without forcing a new direction');
  assert.deepEqual(f.store.snapshot().tasks[0], taskBefore);
});

test('FINAL binds goal_met even when normal planning disables it and leaves individual goals unchanged', async t => {
  const f = await fixture(t, { config: { enableGoalMet: false } });
  const taskBefore = f.store.snapshot().tasks[0];
  f.adapter.responses.push([toolCall('goal_met', { reason: 'Explicit global fixture judgment' })], 'done');
  assert.deepEqual(await f.installed.finalize(f.task.id, f.agent, new AbortController().signal), { met: true });
  assert.equal(f.store.snapshot().goals[0].state, 'open');
  assert.deepEqual(f.store.snapshot().tasks[0], taskBefore);
  assert.equal(f.store.snapshot().tasks[0].firstRunAt, undefined, 'a FINAL judgment must not restart task timing');
  assert.equal(f.store.snapshot().intents.length, 0);
});

test('park preserves queued/status metadata, requeues only interrupted work and freezes notifications', async t => {
  const f = await fixture(t);
  const paused = await f.store.addIntent({ taskId: f.task.id, summary: 'Individually paused fixture', input: {}, state: 'paused' });
  f.adapter.responses.push(addWork('Active admission fixture', 'Queued admission fixture'), 'done');
  await f.ok('redteam_start_planner');
  const active = f.store.snapshot().intents.find(row => row.state === 'running');
  await f.store.transaction(state => {
    const task = state.tasks.find(row => row.id === f.task.id);
    task.queued = true; task.queueMode = 'resume'; task.queuedAt = new Date().toISOString();
  });
  const taskBefore = f.store.snapshot().tasks[0];
  await f.installed.park(f.task.id, f.agent);
  const snapshot = f.store.snapshot();
  assert.deepEqual(snapshot.tasks[0], taskBefore);
  assert.equal(snapshot.intents.find(row => row.id === active.id).state, 'open');
  assert.equal(snapshot.intents.find(row => row.id === active.id).execution.childSessionId, active.execution.childSessionId);
  assert.equal(snapshot.intents.find(row => row.id === paused.id).state, 'paused');
  assert.equal(f.installed.status(f.task.id).attached, false);
  f.installed.notify(f.task.id, { kind: 'change' });
  await f.installed.runtime.flush(f.task.id);
  assert.equal(f.adapter.requests.length, 2);
  assert.equal(f.sessions.size, 1);
});
