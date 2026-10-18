import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { build } from 'esbuild';
import { Context } from '@deepseek-ai/cordis';
import { SessionId, SessionStore } from '@deepseek-ai/dsh-session';
import AgentRegistry from '@deepseek-ai/dsh-agent';
import AgentLoop from '@deepseek-ai/dsh-agent-loop';
import LlmRuntime, { LlmAdapter } from '@deepseek-ai/dsh-llm';
import SystemPrompt from '@deepseek-ai/dsh-system-prompt';
import ToolRuntime, { assertObjectJsonSchema } from '@deepseek-ai/dsh-tools';
import SessionProjections from '@deepseek-ai/dsh-session-projection';

// Exercise the current implementations without sharing generated lib files with another build.
const bundled = await build({ stdin: { contents: "export { installPlatform } from './src/platform/index.ts'; export { RedTeamStore } from './src/store.ts'; export { createDshPlannerModel, createDshPlannerCompletion } from './src/planner/model.ts'; export { bootstrapTaskGoals } from './src/planner/bootstrap.ts'; export { installPlanner } from './src/planner/integration.ts';", resolveDir: process.cwd(), loader: 'ts' }, bundle: true, write: false, platform: 'node', format: 'esm', packages: 'external' });
const source = bundled.outputFiles[0].text.replaceAll('import.meta.url', JSON.stringify(import.meta.url)).replace(/from\s+(["'])([^"']+)\1/g, (_match, _quote, specifier) => `from ${JSON.stringify(import.meta.resolve(specifier))}`);
const { installPlatform, RedTeamStore, createDshPlannerModel, createDshPlannerCompletion, bootstrapTaskGoals, installPlanner } = await import(`data:text/javascript;base64,${Buffer.from(`${source}\n//# sourceURL=platform-planner-tests.bundle.mjs`).toString('base64')}`);

const calls = (name, args = {}) => [{ name, args }];
const text = result => result.content.filter(c => c.type === 'text').map(c => c.text).join('\n');
const system = request => [typeof request.system === 'string' ? request.system : '', ...request.messages.filter(m => m.role === 'system').map(m => typeof m.content === 'string' ? m.content : m.content.map(c => c.text ?? '').join('\n'))].join('\n');
class ScriptedAdapter extends LlmAdapter {
  requests = [];
  responses = [];
  async resolveModel(provider, model) { return { provider, id: model, name: model }; }
  async *stream(request) {
    this.requests.push(request);
    assert.ok(this.responses.length, 'unexpected additional model request');
    let response = this.responses.shift();
    if (typeof response === 'function') response = await response(request);
    if (response === 'done') { yield { type: 'text-delta', index: 0, text: 'Local planning finished' }; yield { type: 'finish', reason: { kind: 'stop' } }; return; }
    for (const [index, call] of response.entries()) yield { type: 'tool-call-delta', index, id: randomUUID(), name: call.name, argumentsDelta: JSON.stringify(call.args) };
    yield { type: 'finish', reason: { kind: 'tool-calls' } };
  }
}

async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'platform-planner-'));
  const store = new RedTeamStore(join(root, 'state.json'));
  const task = await store.createTask('Local platform Planner fixture', 'ONLY_LOCAL_VERIFIED_GOAL');
  const app = new Context(), fibers = [], adapter = new ScriptedAdapter();
  let platform, handle, planner;
  t.after(async () => {
    await planner?.dispose(); await platform?.dispose(); await handle?.dispose();
    for (const fiber of fibers.reverse()) await fiber.dispose();
    await rm(root, { recursive: true, force: true });
  });
  const mount = async (plugin, config) => { fibers.push(await app.plugin(plugin, config)); };
  await mount(SessionStore); await mount(AgentRegistry); await mount(LlmRuntime); await mount(SystemPrompt, {});
  await mount(ToolRuntime, { mode: 'native' }); await mount(SessionProjections); await mount(AgentLoop, {});
  await mount(ctx => { ctx.inject(['llm'], scope => { scope.llm.registerAdapter(['platform-planner-fixture'], adapter); }); });
  const ready = Promise.withResolvers();
  handle = await app.get('agents').create({ sessionId: SessionId(randomUUID()), meta: { cwd: root }, agentOptions: { provider: 'platform-planner-fixture', model: 'local-model' }, setup: async ctx => {
    await ctx.plugin(inner => { inner.inject(['tools', 'systemPrompt', 'agents'], async scope => {
      try { platform = await installPlatform(scope, store, { schedulerIntervalMs: 0 }); ready.resolve(); } catch (error) { ready.reject(error); }
    }); });
  } });
  await ready.promise;
  const agent = handle.agent;
  const management = async (name, action, payload) => {
    const result = await app.get('tools').execute({ callId: randomUUID(), name: `redteam_platform_${name}`, arguments: { action, payload }, agent, signal: AbortSignal.timeout(10000) });
    assert.equal(result.isError, false, text(result).slice(0, 2000)); return result.value;
  };
  const prepareRun = input => platform.prepareRun({ ...input, parent: agent, sessionId: agent.id });
  const model = (options = {}) => createDshPlannerModel(app.get('llm'), { provider: 'platform-planner-fixture', model: 'local-model', maxTurns: 9, prepareRun, ...options });
  const context = () => ({ taskId: task.id, snapshot: store.snapshot(), triggers: [{ kind: 'start' }], todos: [] });
  const bootstrap = signal => bootstrapTaskGoals(store, task.id, createDshPlannerCompletion(app.get('llm')), signal, { provider: 'platform-planner-fixture', model: 'local-model', maxTurns: 9, prepareRun });
  const install = async config => {
    // No test here dispatches a Worker: terminal proof completes the integration task.
    const workers = { start: async () => { throw new Error('Unexpected Worker dispatch'); }, stop: async () => { throw new Error('Unexpected Worker stop'); }, steer: async () => { throw new Error('Unexpected Worker steer'); }, quiesceTask: async () => {} };
    await mount(ctx => { ctx.inject(['tools', 'llm'], scope => { planner = installPlanner(scope, store, workers, { concurrency: 1, debounceMs: 60000, maxTurns: 9, prepareRun: platform.prepareRun, ...config }); }); });
    return planner;
  };
  const liveIds = () => app.get('agents').list().map(a => a.id).sort();
  return { root, store, task, app, adapter, platform, agent, management, model, context, bootstrap, install, liveIds };
}

test('Planner and goals compose per-request transforms with independent run ids and the real parent session', { timeout: 25000 }, async t => {
  const f = await fixture(t), runs = [], transformed = [];
  const prepareRun = async input => {
    const run = await f.platform.prepareRun({ ...input, parent: f.agent, sessionId: f.agent.id });
    runs.push({ runId: run.runId, role: input.agentKey });
    return { ...run, transformRequest: request => {
      transformed.push({ runId: run.runId, role: input.agentKey });
      return { ...request, sessionId: f.agent.id, system: `${request.system}\nRUN_PROJECTION=${run.runId}` };
    } };
  };
  f.adapter.responses.push(calls('set_goals', { text: 'Transform fixture goal' }), 'done');
  await bootstrapTaskGoals(f.store, f.task.id, createDshPlannerCompletion(f.app.get('llm')), AbortSignal.timeout(10000), { provider: 'platform-planner-fixture', model: 'local-model', prepareRun });
  f.adapter.responses.push(calls('add_intent', { summary: 'Transform fixture plan' }), 'done');
  await f.model({ prepareRun }).plan(f.context(), AbortSignal.timeout(10000));
  assert.equal(new Set(runs.map(run => run.runId)).size, 2);
  assert.deepEqual(transformed.map(run => run.role), ['goals', 'goals', 'planner', 'planner']);
  assert.ok(f.adapter.requests.every(request => request.sessionId === f.agent.id));
  for (let index = 0; index < f.adapter.requests.length; index++) assert.ok(f.adapter.requests[index].system.endsWith(`RUN_PROJECTION=${transformed[index].runId}`));
  assert.deepEqual(f.liveIds(), [f.agent.id], 'internal run IDs must not create fake resident sessions');
});

test('Planner refreshes enabled constraints, Overview template and previous overview results at every actual model request', { timeout: 25000 }, async t => {
  const f = await fixture(t);
  await f.management('prompts', 'save', { key: 'planner', template: 'DYNAMIC_OVERVIEW={{.Overview}}' });
  const own = await f.store.addConstraint({ taskId: f.task.id, text: 'PLANNER_BOUNDARY_A_V1', kind: 'deny', origin: 'human' });
  const b = await f.store.createTask('Other constraint task', 'Second local goal');
  await f.store.addConstraint({ taskId: b.id, text: 'PLANNER_BOUNDARY_B', kind: 'allow', origin: 'human' });
  let enabled = true;
  const model = f.model({ constraints: taskId => enabled ? f.store.snapshot().constraints.filter(row => row.taskId === taskId) : [] });
  f.adapter.responses.push(request => {
    assert.match(request.system, /PLANNER_BOUNDARY_A_V1/); assert.doesNotMatch(JSON.stringify(request), /PLANNER_BOUNDARY_B/);
    enabled = false; return calls('graph_overview');
  }, async request => {
    assert.doesNotMatch(JSON.stringify(request), /PLANNER_BOUNDARY_A_V1|PLANNER_BOUNDARY_B/);
    assert.deepEqual(JSON.parse(request.messages[0].content[0].text).constraints, []);
    assert.deepEqual(JSON.parse(request.messages.find(message => message.role === 'tool').content[0].text).constraints, []);
    await f.store.transaction(state => { state.constraints.find(row => row.id === own.id).text = 'PLANNER_BOUNDARY_A_V2'; });
    enabled = true; return calls('graph_overview');
  }, request => {
    assert.match(request.system, /PLANNER_BOUNDARY_A_V2/); assert.doesNotMatch(JSON.stringify(request), /PLANNER_BOUNDARY_A_V1|PLANNER_BOUNDARY_B/);
    return calls('add_intent', { summary: 'Verified current boundary' });
  }, 'done');
  const plan = await model.plan(f.context(), AbortSignal.timeout(10000));
  assert.equal(plan.intents[0].summary, 'Verified current boundary');
  f.adapter.responses.push(request => {
    assert.match(request.system, /PLANNER_BOUNDARY_B/); assert.doesNotMatch(JSON.stringify(request), /PLANNER_BOUNDARY_A_V[12]/);
    return calls('add_intent', { summary: 'Other task boundary' });
  }, 'done');
  await model.plan({ ...f.context(), taskId: b.id }, AbortSignal.timeout(10000));
  f.adapter.responses.push(request => { assert.match(request.system, /PLANNER_BOUNDARY_A_V2/); return calls('add_intent', { summary: 'Default injection remains enabled' }); }, 'done');
  await f.model().plan(f.context(), AbortSignal.timeout(10000));
});

test('managed Planner prompt, tool binding and defaults affect the next actual model request and staged handler output', { timeout: 25000 }, async t => {
  const f = await fixture(t), baseline = f.liveIds(), dispatches = [];
  const removeGuard = f.app.get('tools').guard(exec => { dispatches.push({ name: exec.name, agentId: exec.agent?.id }); }); t.after(removeGuard);
  await f.management('agents', 'update', { key: 'planner', patch: { maxTurns: 1 } });
  await f.management('prompts', 'save_wrapup', { key: 'planner', prompt: 'PLANNER_SETTLEMENT', maxTurns: 1 });
  await f.management('prompts', 'save', { key: 'planner', template: 'PLANNER_A goal={{.Goal}}' });
  f.adapter.responses.push(calls('add_intent', { summary: 'first local plan' }), 'done');
  const first = await f.model().plan(f.context(), AbortSignal.timeout(10000));
  assert.equal(first.intents[0].summary, 'first local plan'); assert.equal(first.intents[0].input.priority, 5);
  assert.match(system(f.adapter.requests[0]), /PLANNER_A goal=ONLY_LOCAL_VERIFIED_GOAL/);
  for (const tool of f.adapter.requests[0].tools) assertObjectJsonSchema(tool.parameters);
  assert.match(system(f.adapter.requests[1]), /PLANNER_SETTLEMENT/);
  assert.deepEqual(f.liveIds(), baseline, 'real per-run dispatch Agent must be released after a plan');

  const schema = structuredClone((await f.management('tools', 'list', {})).find(row => row.key === 'add_intent').schema);
  schema.properties.priority.default = 9;
  await f.management('tools', 'update', { key: 'add_intent', patch: { schema, description: 'MANAGED_ADD_INTENT' } });
  await f.management('prompts', 'save', { key: 'planner', template: 'PLANNER_B goal={{.Goal}}' });
  f.adapter.responses.push(calls('add_intent', { summary: 'second local plan' }), 'done');
  const second = await f.model().plan(f.context(), AbortSignal.timeout(10000));
  assert.equal(second.intents[0].input.priority, 9, 'configured default must reach the real staged Planner handler');
  assert.match(system(f.adapter.requests[2]), /PLANNER_B goal=ONLY_LOCAL_VERIFIED_GOAL/);
  assert.equal(f.adapter.requests[2].tools.find(tool => tool.name === 'add_intent').description, 'MANAGED_ADD_INTENT');
  assert.equal(f.adapter.requests[2].tools.find(tool => tool.name === 'add_intent').parameters.properties.priority.default, 9);

  await f.management('tools', 'update', { key: 'add_intent', patch: { agents: ['worker'] } });
  f.adapter.responses.push(calls('add_intent', { summary: 'hidden must not stage' }), 'done');
  const hidden = await f.model().plan(f.context(), AbortSignal.timeout(10000));
  assert.equal(f.adapter.requests[4].tools.some(tool => tool.name === 'add_intent'), false);
  assert.deepEqual(hidden.intents, []);
  assert.match(JSON.stringify(f.adapter.requests[5].messages), /规划工具未绑定/);
  assert.equal(dispatches.filter(call => call.name === 'add_intent').length, 2);
  assert.ok(dispatches.filter(call => call.name === 'add_intent').every(call => call.agentId && call.agentId !== f.agent.id));
  assert.deepEqual(f.liveIds(), baseline);
  assert.equal(f.store.snapshot().intents.length, 0, 'model planning stages effects; runtime owns committing them');
});

test('goals bootstrap uses managed prompt, normal-turn budget and distinct settlement budget before atomic commit', { timeout: 25000 }, async t => {
  const f = await fixture(t), baseline = f.liveIds();
  await f.management('agents', 'update', { key: 'goals', patch: { maxTurns: 1 } });
  await f.management('prompts', 'save', { key: 'goals', template: 'GOALS_MANAGED {{.EngagementDescription}}' });
  await f.management('prompts', 'save_wrapup', { key: 'goals', prompt: 'GOALS_FINALIZE_STAGED_DATA', maxTurns: 1 });
  f.adapter.responses.push(calls('set_goals', { text: 'Concrete local deliverable' }), () => {
    assert.equal(f.store.snapshot().goals.length, 0, 'tool result is staged until completion'); return 'done';
  });
  const result = await f.bootstrap(AbortSignal.timeout(10000));
  assert.equal(result.status, 'created'); assert.deepEqual(result.goals.map(g => g.text), ['Concrete local deliverable']);
  assert.equal(f.adapter.requests.length, 2, 'managed one regular turn overrides bootstrap option of nine');
  assert.match(system(f.adapter.requests[0]), /GOALS_MANAGED/); assert.doesNotMatch(system(f.adapter.requests[0]), /GOALS_FINALIZE_STAGED_DATA/);
  assert.match(system(f.adapter.requests[1]), /GOALS_FINALIZE_STAGED_DATA/);
  assert.ok(f.adapter.requests[0].tools.some(tool => tool.name === 'set_goals'));
  for (const tool of f.adapter.requests[0].tools) assertObjectJsonSchema(tool.parameters);
  assert.deepEqual(f.liveIds(), baseline);
});

test('cancelled goals bootstrap releases its actual DSH dispatch Agent and never commits staged or late model state', { timeout: 25000 }, async t => {
  const f = await fixture(t), baseline = f.liveIds(), entered = Promise.withResolvers(), release = Promise.withResolvers(), disposed = Promise.withResolvers();
  t.after(() => release.resolve());
  const stopObserve = f.app.on('agent/disposed', ({ agent }) => { if (agent.id !== f.agent.id) disposed.resolve(agent.id); }); t.after(stopObserve);
  const controller = new AbortController();
  f.adapter.responses.push(calls('set_constraints', { text: 'Local staged boundary', type: 'deny' }), async () => { entered.resolve(); await release.promise; return calls('set_goals', { text: 'Late goal must never persist' }); });
  const pending = f.bootstrap(controller.signal);
  await Promise.race([entered.promise, pending.then(() => { throw new Error('Bootstrap ended before the cancellable model request'); })]);
  assert.equal(f.liveIds().length, baseline.length + 1, 'the first staged tool created a real owned dispatch Agent');
  controller.abort(new Error('cancelled by fixture')); release.resolve();
  await assert.rejects(pending, /cancelled by fixture/); await disposed.promise;
  assert.deepEqual(f.store.snapshot().goals, []); assert.deepEqual(f.store.snapshot().constraints, []); assert.deepEqual(f.store.snapshot().scopes, []);
  assert.deepEqual(f.liveIds(), baseline);
});

test('Planner integration routes bootstrap modelStream calls as goals and subsequent planning through the same real platform', { timeout: 30000 }, async t => {
  const f = await fixture(t), routed = [], errors = [];
  const factId = randomUUID(); await f.store.addNode({ id: factId, taskId: f.task.id, kind: 'fact', label: 'Local fixture observation', data: { confidence: 'observed' } });
  await f.management('agents', 'update', { key: 'goals', patch: { maxTurns: 2 } });
  await f.management('agents', 'update', { key: 'planner', patch: { maxTurns: 2 } });
  await f.management('prompts', 'save', { key: 'goals', template: 'INTEGRATED_GOALS' });
  await f.management('prompts', 'save', { key: 'planner', template: 'INTEGRATED_PLANNER {{.Goal}}' });
  const installed = await f.install({ onError: error => errors.push(error), modelStream: call => { routed.push({ role: call.role, taskId: call.taskId, parentId: call.parent.id, final: call.final }); return f.app.get('llm').stream(call.request); } });
  f.adapter.responses.push(calls('set_goals', { text: 'Prove local fixture observation' }), 'done', () => {
    const goal = f.store.snapshot().goals.find(g => g.taskId === f.task.id); assert.ok(goal, 'bootstrap must commit before planning');
    return calls('prove_goal', { goal_id: goal.id, evidence_id: factId, reason: 'Local recorded observation' });
  }, 'done');
  const result = await installed.start(f.task.id, f.agent);
  assert.deepEqual(errors, []); assert.equal(result.taskStatus, 'done');
  assert.deepEqual(routed.map(call => call.role), ['goals', 'goals', undefined, undefined]);
  assert.ok(routed.every(call => call.taskId === f.task.id && call.parentId === f.agent.id && call.final === false));
  assert.match(system(f.adapter.requests[0]), /INTEGRATED_GOALS/); assert.match(system(f.adapter.requests[2]), /INTEGRATED_PLANNER ONLY_LOCAL_VERIFIED_GOAL/);
  assert.equal(f.store.snapshot().goals[0].state, 'met'); assert.equal(f.store.snapshot().intents.length, 0);
  assert.deepEqual(f.liveIds(), [f.agent.id]);
});

test('pausing a real Planner round drains its dispatch Agent and discards staged and late intents', { timeout: 25000 }, async t => {
  const f = await fixture(t), entered = Promise.withResolvers(), release = Promise.withResolvers(), errors = [];
  t.after(() => release.resolve());
  await f.store.addGoal({ taskId: f.task.id, text: 'Keep the local task open until proof', state: 'open' });
  const installed = await f.install({ onError: error => errors.push(error) });
  f.adapter.responses.push(calls('add_intent', { summary: 'Staged direction before cancellation' }), async () => {
    entered.resolve(); await release.promise; return calls('add_intent', { summary: 'Late direction after cancellation' });
  });
  const started = installed.start(f.task.id, f.agent);
  await Promise.race([entered.promise, started.then(() => { throw new Error('Planner ended before the cancellable model request'); })]);
  assert.equal(f.store.snapshot().intents.length, 0, 'successful tool calls are still staged while the round is in flight');
  assert.equal(f.liveIds().length, 2);
  const paused = installed.pause(f.task.id, f.agent);
  release.resolve();
  await started; const status = await paused;
  assert.equal(status.taskStatus, 'paused'); assert.equal(status.attached, false);
  assert.deepEqual(f.store.snapshot().intents, []); assert.equal(f.store.snapshot().goals[0].state, 'open');
  assert.deepEqual(f.liveIds(), [f.agent.id]); assert.deepEqual(errors, []);
});

test('DSH-compatible schema declarations retain real handler checks for empty strings and empty constraint/scope batches', { timeout: 25000 }, async t => {
  const f = await fixture(t);
  await f.management('agents', 'update', { key: 'planner', patch: { maxTurns: 1 } });
  await f.management('prompts', 'save_wrapup', { key: 'planner', prompt: 'Finish the validation fixture', maxTurns: 1 });
  f.adapter.responses.push([...calls('add_intent', { summary: '   ' }), ...calls('add_intent', { summary: 'Valid local direction' })], 'done');
  const plan = await f.model().plan(f.context(), AbortSignal.timeout(10000));
  assert.deepEqual(plan.intents.map(intent => intent.summary), ['Valid local direction']);
  const plannerResults = f.adapter.requests[1].messages.filter(message => message.role === 'tool');
  assert.equal(plannerResults.length, 2); assert.equal(plannerResults[0].isError, true); assert.equal(plannerResults[1].isError, false);

  await f.management('agents', 'update', { key: 'goals', patch: { maxTurns: 1 } });
  await f.management('prompts', 'save_wrapup', { key: 'goals', prompt: 'Finish the goal validation fixture', maxTurns: 1 });
  f.adapter.responses.push([...calls('set_goals', { text: '   ' }), ...calls('set_constraints', { constraints: [] }), ...calls('add_task_scope', { entries: [] }), ...calls('set_goals', { text: 'Valid local goal' })], 'done');
  const result = await f.bootstrap(AbortSignal.timeout(10000));
  assert.deepEqual(result.goals.map(goal => goal.text), ['Valid local goal']); assert.deepEqual(result.constraints, []); assert.deepEqual(result.scopes, []);
  const goalResults = f.adapter.requests[3].messages.filter(message => message.role === 'tool');
  assert.deepEqual(goalResults.map(message => message.isError), [true, true, true, false]);
});
