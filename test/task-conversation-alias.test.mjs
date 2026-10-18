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
const { installTaskLifecycle, installPlanner, RedTeamStore, replaceTaskLLMProfiles } = await import(`data:text/javascript;base64,${Buffer.from(code + '\n//# sourceURL=task-conversation-alias.bundle.mjs').toString('base64')}`);
class Adapter extends LlmAdapter {
  requests = [];
  async resolveModel(provider, model) { return { provider, id: model, name: model }; }
  async *stream(request) { this.requests.push(request); yield { type: 'text-delta', index: 0, text: 'actual native chat' }; yield { type: 'finish', reason: { kind: 'stop' } }; }
}
async function fixture(t) {
  const dir = await mkdtemp(join(tmpdir(), 'task-conversation-alias-')), store = new RedTeamStore(join(dir, 'store.json')), app = new Context(), fibers = [], handles = [], adapter = new Adapter();
  let lifecycle, planner;
  t.after(async () => { for (const handle of handles.reverse()) await handle.dispose(); await lifecycle?.dispose(); await planner?.dispose(); for (const fiber of fibers.reverse()) await fiber.dispose(); await rm(dir, { recursive: true, force: true }); });
  for (const [plugin, config] of [[SessionStore], [AgentRegistry], [LlmRuntime], [SystemPrompt, {}], [ToolRuntime, { mode: 'native' }], [SessionProjections], [AgentLoop, {}]]) fibers.push(await app.plugin(plugin, config));
  fibers.push(await app.plugin(async ctx => { await ctx.inject(['llm', 'tools'], scope => {
    scope.llm.registerAdapter(['fixture'], adapter);
    planner = installPlanner(scope, store, { start: async () => undefined, stop: async () => {}, steer: async () => {}, quiesceTask: async () => {} }, { concurrency: 1, debounceMs: 60000, modelStream: call => lifecycle.modelStream(call) });
    lifecycle = installTaskLifecycle(scope, store, planner, { concurrency: 1, autoPoll: false, profiles: { resolveProfile: id => ({ provider: 'fixture', model: id }), resolveBinding: () => null } });
  }); }));
  const task = await store.createManagedTask({ title: 'Segments', goal: 'Keep Planner ownership stable' });
  await store.transaction(state => { state.tasks[0].llmChain = replaceTaskLLMProfiles(state.tasks[0].llmChain, ['task-model'], new Set(['task-model'])); });
  const agent = async () => { const handle = await app.get('agents').create({ sessionId: SessionId(randomUUID()), agentOptions: { provider: 'fixture', model: 'parent' } }); handles.push(handle); return handle; };
  const turn = async handle => { handle.agent.followup(createUserMessage({ content: [{ type: 'text', text: 'Inspect task' }], source: { kind: 'user' } })); await handle.agent.whenIdle(); };
  return { app, store, task, adapter, lifecycle, planner, agent, turn };
}
test('two native conversation segments share task routing while their disposal preserves the actual Planner owner', { timeout: 20000 }, async t => {
  const f = await fixture(t), owner = await f.agent(), one = await f.agent(), two = await f.agent();
  f.lifecycle.bindParent(f.task.id, owner.agent);
  await f.store.addGoal({ taskId: f.task.id, text: 'Existing goal', state: 'open' });
  await f.lifecycle.start(f.task.id, owner.agent);
  assert.equal(f.planner.status(f.task.id).attached, true);
  const releaseOne = f.lifecycle.attachConversation(f.task.id, one.agent), releaseTwo = f.lifecycle.attachConversation(f.task.id, two.agent);
  assert.strictEqual(f.lifecycle.taskForAgent(one.agent.id).binding.parent, owner.agent);
  assert.strictEqual(f.lifecycle.taskForAgent(two.agent.id).binding.parent, owner.agent);
  assert.throws(() => f.lifecycle.attachConversation(f.task.id, one.agent), /already attached/);
  const before = f.adapter.requests.length; await f.turn(one); await f.turn(two);
  assert.equal(f.adapter.requests.length, before + 2);
  assert.ok(f.adapter.requests.slice(before).every(request => request.model === 'task-model'));
  await one.dispose(); assert.equal(f.lifecycle.taskForAgent(one.agent.id), undefined);
  assert.strictEqual(f.lifecycle.taskForAgent(two.agent.id).binding.parent, owner.agent);
  assert.strictEqual(f.lifecycle.taskForAgent(owner.agent.id).binding.parent, owner.agent);
  assert.equal(f.planner.status(f.task.id).attached, true); assert.equal(f.store.snapshot().tasks[0].status, 'running');
  releaseOne(); releaseTwo(); assert.equal(f.lifecycle.taskForAgent(two.agent.id), undefined);
  assert.equal(f.planner.status(f.task.id).attached, true);
});
test('ownerless main chat has pure task attribution and model routing without fabricating a Planner parent or starting the task clock', { timeout: 20000 }, async t => {
  const f = await fixture(t), chat = await f.agent(), owner = await f.agent();
  f.lifecycle.attachConversation(f.task.id, chat.agent);
  const attribution = f.lifecycle.taskForAgent(chat.agent.id);
  assert.equal(attribution.binding.parent, undefined); assert.equal(attribution.role, 'mainagent');
  await f.turn(chat); assert.equal(f.adapter.requests.length, 1); assert.equal(f.adapter.requests[0].model, 'task-model');
  assert.equal(f.store.snapshot().tasks[0].firstRunAt, undefined); assert.equal(f.planner.status(f.task.id).attached, false);
  f.lifecycle.bindParent(f.task.id, owner.agent);
  assert.strictEqual(f.lifecycle.taskForAgent(chat.agent.id).binding.parent, owner.agent);
  await chat.dispose(); assert.equal(f.lifecycle.taskForAgent(chat.agent.id), undefined);
  assert.strictEqual(f.lifecycle.taskForAgent(owner.agent.id).binding.parent, owner.agent);
});
