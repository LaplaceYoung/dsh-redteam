import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';
import { Context } from '@deepseek-ai/cordis';
import { Loader } from '@deepseek-ai/cordis-plugin-loader';
import { SessionId, SessionStore } from '@deepseek-ai/dsh-session';
import AgentRegistry from '@deepseek-ai/dsh-agent';
import AgentLoop from '@deepseek-ai/dsh-agent-loop';
import AgentPresetRegistry from '@deepseek-ai/dsh-agent-preset-registry';
import LlmRuntime, { LlmAdapter } from '@deepseek-ai/dsh-llm';
import SystemPrompt from '@deepseek-ai/dsh-system-prompt';
import ToolRuntime from '@deepseek-ai/dsh-tools';
import SessionProjections from '@deepseek-ai/dsh-session-projection';

const source = `
import {installTaskLifecycle} from './src/task-management/integration.ts';
import {installPlanner} from './src/planner/integration.ts';
import {RedTeamStore} from './src/store.ts';
export {lifecycleForAgent,registerTaskLifecycleScope} from './src/task-management/runtime-scope.ts';
export const inject = ['llm','tools'];
export const installed = new Map();
export default function(outer, config) { outer.inject(['llm','tools'], ctx => {
  const store = new RedTeamStore(config.storagePath);
  const workers = {start:async()=>undefined,stop:async()=>{},steer:async()=>{},quiesceTask:async()=>{}};
  let lifecycle;
  const planner = installPlanner(ctx,store,workers,{concurrency:1,modelStream:call=>lifecycle.modelStream(call)});
  lifecycle = installTaskLifecycle(ctx,store,planner,{concurrency:1,autoPoll:false,profiles:{resolveProfile:()=>null,resolveBinding:()=>null}});
  installed.set(config.name,lifecycle);
  ctx.effect(()=>async()=>{await lifecycle.dispose();await planner.dispose();});
}); }`;
const built = await build({ stdin: { contents: source, resolveDir: process.cwd(), loader: 'ts' }, bundle: true, write: false, platform: 'node', format: 'esm', packages: 'external' });
const code = built.outputFiles[0].text.replace(/from\s+(["'])([^"']+)\1/g, (_m, _q, specifier) => `from ${JSON.stringify(import.meta.resolve(specifier))}`);
class Adapter extends LlmAdapter {
  async resolveModel(provider, model) { return { provider, id: model, name: model }; }
  async *stream(request) {
    if (!request.messages.some(message => message.role === 'tool')) {
      yield { type: 'tool-call-delta', index: 0, id: randomUUID(), name: 'add_intent', argumentsDelta: JSON.stringify({ intents: [{ summary: 'Inspect scoped fixture' }] }) };
      yield { type: 'finish', reason: { kind: 'tool-calls' } }; return;
    }
    yield { type: 'text-delta', index: 0, text: 'Planning complete' }; yield { type: 'finish', reason: { kind: 'stop' } };
  }
}

async function fixture(t) {
  const dir = await mkdtemp(join(tmpdir(), 'task-scope-')), modulePath = join(dir, 'fixture.mjs');
  await writeFile(modulePath, code); const moduleUrl = pathToFileURL(modulePath).href, plugin = await import(moduleUrl);
  const app = new Context(), fibers = [], handles = [], presets = [];
  t.after(async () => { for (const handle of handles.reverse()) await handle.dispose(); for (const release of presets.reverse()) await release(); for (const fiber of fibers.reverse()) await fiber.dispose(); await rm(dir, { recursive: true, force: true }); });
  for (const [module, config] of [[SessionStore], [AgentRegistry], [LlmRuntime], [SystemPrompt, {}], [ToolRuntime, { mode: 'native' }], [SessionProjections], [Loader, { baseUrl: pathToFileURL(dir + '/').href }], [AgentPresetRegistry, { default: 'a' }], [AgentLoop, {}]]) fibers.push(await app.plugin(module, config));
  fibers.push(await app.plugin(ctx => { ctx.inject(['llm'], inner => { inner.llm.registerAdapter(['fixture'], new Adapter()); }); }));
  for (const name of ['a', 'b']) presets.push(await app.get('agentPresets').register({ id: name, plugins: [{ id: name, name: moduleUrl, config: { name, storagePath: join(dir, name + '.json') } }] }));
  async function agent(preset, own) {
    const handle = await app.get('agents').create({ sessionId: SessionId(randomUUID()), agentOptions: { provider: 'fixture', model: 'parent' }, setup: async ctx => {
      if (preset) await app.get('agentPresets').mount(ctx, preset);
      if (own) await ctx.plugin(plugin.default, { name: own, storagePath: join(dir, own + '.json') });
    } }); handles.push(handle); return handle;
  }
  return { app, plugin, agent };
}

test('real preset scope lookup resolves the first task before parent binding, isolates siblings and follows recompose', { timeout: 20000 }, async t => {
  const f = await fixture(t), a = await f.agent('a'), a2 = await f.agent('a'), b = await f.agent('b'), plain = await f.agent();
  const ra = f.plugin.installed.get('a'), rb = f.plugin.installed.get('b');
  assert.strictEqual(f.plugin.lifecycleForAgent(a.agent), ra); assert.strictEqual(f.plugin.lifecycleForAgent(a2.agent), ra);
  assert.strictEqual(f.plugin.lifecycleForAgent(b.agent), rb); assert.equal(f.plugin.lifecycleForAgent(plain.agent), undefined);
  assert.equal(ra.taskForAgent(a.agent.id), undefined, 'lookup must work before any task binding');
  await f.app.get('agentPresets').select(a2.agent, 'b');
  assert.strictEqual(f.plugin.lifecycleForAgent(a2.agent), rb, 'read current scope chain rather than cached preset/session identity');
  const task = await ra.store.createManagedTask({ title: 'first task', goal: 'verify selected runtime' });
  await ra.store.addGoal({ taskId: task.id, text: 'Inspect fixture', state: 'open' });
  await f.plugin.lifecycleForAgent(a.agent).start(task.id, a.agent);
  assert.equal(ra.taskForAgent(a.agent.id).binding.taskId, task.id); assert.equal(rb.taskForAgent(a.agent.id), undefined);
  await a.dispose(); assert.equal(f.plugin.lifecycleForAgent(a.agent), undefined, 'unpublished/disposed agents cannot be reused from an HTTP cache');
});

test('exact Agent installation takes precedence and disposed runtimes are not returned', { timeout: 20000 }, async t => {
  const f = await fixture(t), own = await f.agent('a', 'exact'), sibling = await f.agent('a');
  const exact = f.plugin.installed.get('exact'), inherited = f.plugin.installed.get('a');
  assert.strictEqual(f.plugin.lifecycleForAgent(own.agent), exact); assert.strictEqual(f.plugin.lifecycleForAgent(sibling.agent), inherited);
  assert.throws(() => f.plugin.registerTaskLifecycleScope(own.agent.ctx, inherited), /already installed/);
  await exact.dispose(); assert.strictEqual(f.plugin.lifecycleForAgent(own.agent), inherited);
  await inherited.dispose(); assert.equal(f.plugin.lifecycleForAgent(sibling.agent), undefined);
});
