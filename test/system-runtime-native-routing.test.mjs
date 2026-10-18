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
const built = await build({ stdin: { contents: "export {installTaskLifecycle} from './src/task-management/integration.ts'; export {RedTeamStore} from './src/store.ts'; export {ModelHealthRuntime} from './src/system-runtime/model-health.ts';", resolveDir: process.cwd(), loader: 'ts' }, bundle: true, write: false, platform: 'node', format: 'esm', packages: 'external' });
const code = built.outputFiles[0].text.replaceAll('import.meta.url', JSON.stringify(import.meta.url)).replace(/from\s+(["'])([^"']+)\1/g, (_m, _q, specifier) => `from ${JSON.stringify(import.meta.resolve(specifier))}`);
const { installTaskLifecycle, RedTeamStore, ModelHealthRuntime } = await import(`data:text/javascript;base64,${Buffer.from(code + '\n//# sourceURL=system-native-routing.bundle.mjs').toString('base64')}`);

async function fixture(t, partial = false) {
  const root = await mkdtemp(join(tmpdir(), 'native-pool-')), store = new RedTeamStore(join(root, 'state.json'));
  const task = await store.createManagedTask({ title: 'native pool', goal: 'verify actual route' });
  const ctx = new Context(), fibers = [], requests = [];
  let lifecycle, handle;
  t.after(async () => { await lifecycle?.dispose(); await handle?.dispose(); for (const fiber of fibers.reverse()) await fiber.dispose(); await rm(root, { recursive: true, force: true }); });
  for (const [plugin, config] of [[SessionStore], [AgentRegistry], [LlmRuntime], [SystemPrompt, {}], [ToolRuntime, { mode: 'native' }], [SessionProjections], [AgentLoop, {}]]) fibers.push(await ctx.plugin(plugin, config));
  class Adapter extends LlmAdapter {
    async resolveModel(provider, model) { return { provider, id: model, name: model }; }
    async *stream(request) {
      requests.push(request); assert.ok(Object.isFrozen(request));
      if (request.provider === 'first') {
        if (partial) yield { type: 'text-delta', index: 0, text: 'partial' };
        yield { type: 'finish', reason: { kind: 'error', failure: { code: 'AUTH', status: 401, message: 'bad key' } } }; return;
      }
      yield { type: 'text-delta', index: 0, text: 'second succeeded' }; yield { type: 'finish', reason: { kind: 'stop' } };
    }
  }
  const profiles = [{ id: 'a', name: 'A', provider: 'first', model: 'one' }, { id: 'b', name: 'B', provider: 'second', model: 'two' }];
  const health = await ModelHealthRuntime.open({ storagePath: join(root, 'health.json'), profiles: { list: async () => ({ profiles, activeProfileId: 'a' }) }, stream: request => ctx.llm.stream(request) });
  fibers.push(await ctx.plugin(scope => { scope.inject(['llm', 'tools'], injected => {
    injected.llm.registerAdapter(['first', 'second'], new Adapter());
    const planner = { start: async () => ({ attached: false }), pause: async () => ({ attached: false }), status: () => ({ attached: false }), park: async () => {}, beginSettling: async () => {}, finalize: async () => ({ met: false }) };
    lifecycle = installTaskLifecycle(injected, store, planner, { concurrency: 1, autoPoll: false, modelHealth: health, poolSettings: () => ({ llm_pool_enabled: true, llm_pool_bind_fallback: false }), profiles: {
      resolveProfile: id => { const p = profiles.find(p => p.id === id); return p ? { provider: p.provider, model: p.model } : null; },
      resolveBinding: () => null, resolveGlobalSelection: () => ({ profileId: 'a', route: { provider: 'first', model: 'one' } }),
    } });
  }); }));
  handle = await ctx.agents.create({ sessionId: SessionId(randomUUID()), agentOptions: { provider: 'first', model: 'one' } });
  lifecycle.bindParent(task.id, handle.agent);
  handle.agent.followup(createUserMessage({ content: [{ type: 'text', text: 'probe' }], source: { kind: 'user' } })); await handle.agent.whenIdle();
  return { requests, agent: handle.agent, health, store };
}

test('native AgentLoop switches provider before request header and dispatch, preserving actual route attribution', { timeout: 20000 }, async t => {
  const f = await fixture(t);
  assert.deepEqual(f.requests.map(r => [r.provider, r.model]), [['first', 'one'], ['second', 'two']]);
  const headers = f.agent.session.snapshotEvents().filter(event => event.type === 'request/header');
  assert.equal(headers.length, 2);
  assert.ok(JSON.stringify(headers[1]).includes('second')); assert.ok(JSON.stringify(headers[1]).includes('two'));
  assert.equal((await f.health.status()).chain.find(p => p.profile_id === 'a').state, 'tripped');
  assert.equal(f.store.snapshot().tasks[0].llmChain.activeProfileId, null);
});

test('native pool never replays or trips the circuit after visible output, matching ARTEX streaming contract', { timeout: 20000 }, async t => {
  const f = await fixture(t, true);
  assert.deepEqual(f.requests.map(r => r.provider), ['first']);
  assert.equal((await f.health.status()).chain.find(p => p.profile_id === 'a').state, 'ok');
});
