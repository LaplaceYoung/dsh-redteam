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
import LlmRuntime, { LlmAdapter, createUserMessage } from '@deepseek-ai/dsh-llm';
import SystemPrompt from '@deepseek-ai/dsh-system-prompt';
import ToolRuntime from '@deepseek-ai/dsh-tools';
import SessionProjections from '@deepseek-ai/dsh-session-projection';

const built = await build({ stdin: { contents: "export {installTaskLifecycle} from './src/task-management/integration.ts'; export {installPlanner} from './src/planner/integration.ts'; export {RedTeamStore} from './src/store.ts'; export {replaceTaskLLMProfiles} from './src/task-management/llm-chain.ts';", resolveDir: process.cwd(), loader: 'ts' }, bundle: true, write: false, platform: 'node', format: 'esm', packages: 'external' });
const code = built.outputFiles[0].text.replace(/from\s+(["'])([^"']+)\1/g, (_m, _q, specifier) => `from ${JSON.stringify(import.meta.resolve(specifier))}`);
const { installTaskLifecycle, installPlanner, RedTeamStore, replaceTaskLLMProfiles } = await import(`data:text/javascript;base64,${Buffer.from(code + '\n//# sourceURL=task-lifecycle-host.bundle.mjs').toString('base64')}`);

class Adapter extends LlmAdapter {
  requests = []; responses = [];
  async resolveModel(provider, model) { return { provider, id: model, name: model }; }
  async *stream(request) {
    this.requests.push(request); assert.ok(this.responses.length, 'unexpected model request');
    const response = this.responses.shift();
    if (typeof response === 'function') { yield* response(request); return; }
    if (Array.isArray(response)) {
      for (const [index, call] of response.entries()) yield { type: 'tool-call-delta', index, id: randomUUID(), name: call.name, argumentsDelta: JSON.stringify(call.args) };
      yield { type: 'finish', reason: { kind: 'tool-calls' } }; return;
    }
    yield { type: 'text-delta', index: 0, text: response }; yield { type: 'finish', reason: { kind: 'stop' } };
  }
}
async function fixture(t, options = {}) {
  const dir = await mkdtemp(join(tmpdir(), 'task-host-')); const store = new RedTeamStore(join(dir, 'state.json'));
  const task = await store.createManagedTask({ title: 'Actual DSH fixture', goal: 'Verify model and final boundaries', timeoutSeconds: 1 });
  const app = new Context(), fibers = [], adapter = new Adapter(); let handle, planner, lifecycle;
  let now = new Date('2026-10-18T00:00:00Z');
  t.after(async () => { await lifecycle?.dispose(); await planner?.dispose(); await handle?.dispose(); for (const fiber of fibers.reverse()) await fiber.dispose(); await rm(dir, { recursive: true, force: true }); });
  for (const [plugin, config] of [[SessionStore], [AgentRegistry], [LlmRuntime], [SystemPrompt, {}], [ToolRuntime, { mode: 'native' }], [SessionProjections], [AgentLoop, {}]]) fibers.push(await app.plugin(plugin, config));
  fibers.push(await app.plugin(ctx => { ctx.inject(['llm', 'tools'], scope => {
    scope.llm.registerAdapter(['fixture'], adapter);
    const workers = { start: async () => undefined, stop: async () => {}, steer: async () => {}, quiesceTask: async () => {}, beginTaskTimeout: options.beginTaskTimeout };
    planner = installPlanner(scope, store, workers, { concurrency: 1, debounceMs: 60000, modelStream: call => lifecycle.modelStream(call) });
    lifecycle = installTaskLifecycle(scope, store, planner, { concurrency: 1, autoPoll: false, now: () => now, profiles: { resolveProfile: id => ({ provider: 'fixture', model: id }), resolveBinding: options.resolveBinding ?? (() => null) } });
  }); }));
  handle = await app.get('agents').create({ sessionId: SessionId(randomUUID()), agentOptions: { provider: 'fixture', model: 'parent' } });
  const agent = handle.agent; lifecycle.bindParent(task.id, agent);
  async function chain() { await store.transaction(state => { state.tasks[0].llmChain = replaceTaskLLMProfiles(state.tasks[0].llmChain, ['a', 'b'], new Set(['a', 'b'])); }); }
  async function turn() { agent.followup(createUserMessage({ content: [{ type: 'text', text: 'Run fixture' }], source: { kind: 'user' } })); await agent.whenIdle(); }
  return { app, store, task, adapter, agent, planner, lifecycle, chain, turn, expire: () => { now = new Date(now.getTime() + 1000); } };
}
const quota = { type: 'finish', reason: { kind: 'error', failure: { code: 'QUOTA', message: 'insufficient quota' } } };

test('native AgentLoop retries before output with actual profile route, preserving immutable requests', { timeout: 15000 }, async t => {
  const f = await fixture(t); await f.chain();
  f.adapter.responses.push(async function* (request) { assert.ok(Object.isFrozen(request)); yield quota; }, 'success on b');
  await f.turn();
  assert.deepEqual(f.adapter.requests.map(r => r.model), ['a', 'b']);
  assert.equal(f.store.snapshot().tasks[0].llmChain.activeProfileId, 'b');
  assert.equal(f.store.snapshot().tasks[0].firstRunAt, undefined, 'main chat does not start the task wall clock');
});

test('native AgentLoop never replays visible partial content; next turn uses the advanced route', { timeout: 15000 }, async t => {
  const f = await fixture(t); await f.chain();
  f.adapter.responses.push(async function* () { yield { type: 'text-delta', index: 0, text: 'already visible' }; yield quota; });
  await f.turn(); assert.deepEqual(f.adapter.requests.map(r => r.model), ['a']);
  assert.equal(f.store.snapshot().tasks[0].llmChain.activeProfileId, 'b');
  f.adapter.responses.push('next turn on b'); await f.turn(); assert.deepEqual(f.adapter.requests.map(r => r.model), ['a', 'b']);
});

test('real Planner model bridge stamps dispatch and FINAL proof commits done with released owner', { timeout: 15000 }, async t => {
  const f = await fixture(t); const goal = await f.store.addGoal({ taskId: f.task.id, text: 'Verified fixture', state: 'open' });
  const proof = await f.store.addNode({ id: randomUUID(), taskId: f.task.id, kind: 'fact', label: 'Verified evidence', data: { confidence: 'observed' } });
  f.adapter.responses.push([{ name: 'add_intent', args: { intents: [{ summary: 'Pending fixture' }] } }], 'pending');
  await f.planner.start(f.task.id, f.agent);
  assert.equal(f.store.snapshot().tasks[0].firstRunAt, '2026-10-18T00:00:00.000Z');
  f.adapter.responses.push([{ name: 'prove_goal', args: { goal_id: goal.id, evidence_id: proof.id, reason: 'Fixture evidence establishes the goal' } }], 'proved');
  f.expire(); await f.lifecycle.step(); await f.lifecycle.flush();
  assert.equal(f.store.snapshot().tasks[0].status, 'done');
  assert.equal(f.store.snapshot().goals[0].state, 'met');
  assert.equal(f.planner.status(f.task.id).attached, false);
  assert.equal(f.adapter.requests[2].tools.some(tool => tool.name === 'add_intent'), false);
  assert.ok(f.adapter.requests[2].tools.some(tool => tool.name === 'prove_goal'));
  await f.lifecycle.step(); assert.equal(f.adapter.requests.length, 4);
});

test('real bootstrap uses the goals role binding before the normal Planner route', { timeout: 15000 }, async t => {
  const f = await fixture(t, { resolveBinding: (_id, role) => role === 'goals' ? { provider: 'fixture', model: 'goal-decomposer' } : null });
  f.adapter.responses.push([{ name: 'set_goals', args: { goals: [{ text: 'Verify bootstrap routing' }] } }], 'goals ready', [{ name: 'add_intent', args: { intents: [{ summary: 'Pending verification' }] } }], 'planned');
  await f.planner.start(f.task.id, f.agent);
  assert.deepEqual(f.adapter.requests.map(request => request.model), ['goal-decomposer', 'goal-decomposer', 'parent', 'parent']);
  assert.equal(f.store.snapshot().goals[0].text, 'Verify bootstrap routing');
  assert.equal(f.store.snapshot().tasks[0].firstRunAt, '2026-10-18T00:00:00.000Z');
});

test('deadline settlement lets an existing Worker finish through the real LLM hook without restarting its clock', { timeout: 15000 }, async t => {
  let f, child, intent;
  const wrapped = [];
  f = await fixture(t, { beginTaskTimeout: async taskId => {
    assert.equal(taskId, f.task.id);
    if (f.store.snapshot().intents.find(row => row.id === intent.id).state === 'done') return;
    await assert.rejects(f.lifecycle.beforeModelCall(taskId, 'planner'), /not admitted/);
    await assert.rejects(f.lifecycle.beforeModelCall(taskId, 'goals'), /not admitted/);
    for await (const chunk of f.app.get('llm').stream({ provider: 'fixture', model: 'worker', sessionId: child.agent.id, messages: [] })) wrapped.push(chunk);
    await f.store.updateIntent(intent.id, { state: 'done' });
  } });
  await f.store.addGoal({ taskId: f.task.id, text: 'Remaining goal', state: 'open' });
  f.adapter.responses.push([{ name: 'add_intent', args: { intents: [{ summary: 'Finish existing work' }] } }], 'planned');
  await f.planner.start(f.task.id, f.agent);
  child = await f.app.get('agents').create({ sessionId: SessionId(randomUUID()), agentOptions: { provider: 'fixture', model: 'worker' } });
  try {
    intent = await f.store.claimIntent(f.task.id, child.agent.id, { concurrency: 1, execution: { childSessionId: child.agent.id, parentSessionId: f.agent.id, provider: 'spawn' } });
    assert.ok(intent);
    const before = f.store.snapshot().tasks[0];
    f.adapter.responses.push('existing Worker wrapped up', 'goal remains unmet');
    f.expire(); await f.lifecycle.step(); await f.lifecycle.flush();
    assert.equal(wrapped.find(chunk => chunk.type === 'text-delta')?.text, 'existing Worker wrapped up');
    const after = f.store.snapshot().tasks[0];
    assert.equal(after.firstRunAt, before.firstRunAt);
    assert.equal(after.deadlineAt, before.deadlineAt);
    assert.equal(after.status, 'timeout');
    assert.equal(f.store.snapshot().intents.find(row => row.id === intent.id).state, 'done');
    assert.equal(f.adapter.requests.length, 4);
  } finally { await child.dispose(); }
});

