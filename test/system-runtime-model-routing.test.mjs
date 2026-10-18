import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { build } from 'esbuild';
import { Context } from '@deepseek-ai/cordis';
import LlmRuntime, { LlmAdapter, LlmError } from '@deepseek-ai/dsh-llm';

const built = await build({ stdin: { contents: "export * from './src/system-runtime/model-health.ts'; export * from './src/task-management/runtime-model.ts'; export * from './src/task-management/runtime-profiles.ts'; export * from './src/task-management/llm-chain.ts';", resolveDir: process.cwd(), loader: 'ts' }, bundle: true, platform: 'node', format: 'esm', write: false, packages: 'external' });
const code = built.outputFiles[0].text.replace(/from\s+(["'])([^"']+)\1/g, (match, _quote, specifier) => specifier.startsWith('node:') ? match : `from ${JSON.stringify(import.meta.resolve(specifier))}`);
const { ModelHealthRuntime, TaskModelRouter, TaskProfileRegistry, emptyTaskLLMChain, replaceTaskLLMProfiles, TaskModelRuntimeError } = await import(`data:text/javascript;base64,${Buffer.from(code + '\n//# sourceURL=model-routing.bundle.mjs').toString('base64')}`);
const text = { type: 'text-delta', index: 0, text: 'recovered' }, stop = { type: 'finish', reason: { kind: 'stop' } };
const failure = (status, code) => ({ type: 'finish', reason: { kind: 'error', failure: { status, code, message: code } } });
const parent = { provider: 'parent', model: 'original' };
const request = () => ({ ...parent, messages: [{ role: 'user', content: [{ type: 'text', text: 'fixture' }] }] });
const collect = async stream => { const chunks = []; for await (const chunk of stream) chunks.push(chunk); return chunks; };

async function fixture(t, source) {
  const dir = await mkdtemp(join(tmpdir(), 'model-routing-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  let state = { tasks: [{ id: 'task', llmChain: emptyTaskLLMChain() }] };
  const store = {
    storagePath: join(dir, 'task.json'), load: async () => {}, snapshot: () => structuredClone(state),
    transaction: async update => { const draft = structuredClone(state); const result = await update(draft); state = draft; return result; },
  };
  const calls = [];
  const llm = {
    listProviders: () => ['route-a', 'route-b', 'parent'].map(id => ({ id, name: id })),
    resolveModelInfo: async (provider, id) => ({ provider, id, name: id }),
    listModels: async () => [],
    async *stream(options) { calls.push({ provider: options.provider, model: options.model }); yield* source(options); },
  };
  const registry = new TaskProfileRegistry(store, llm);
  await registry.upsert({ id: 'a', name: 'First', provider: 'route-a', model: 'm-a' });
  await registry.upsert({ id: 'b', name: 'Second', provider: 'route-b', model: 'm-b' });
  await registry.setActive('a');
  const health = await ModelHealthRuntime.open({ storagePath: join(dir, 'health.json'), profiles: registry, stream: options => llm.stream(options) });
  const policy = health.retryPolicy();
  for (const key of ['connect', 'empty', 'stream']) policy[key].attempts = -1;
  await health.setRetryPolicy(policy);
  const settings = { llm_pool_enabled: true, llm_pool_bind_fallback: false };
  const router = new TaskModelRouter(store, llm, registry, { modelHealth: health, poolSettings: () => settings });
  return { store, registry, health, router, settings, llm, calls, chain: () => state.tasks[0].llmChain };
}

test('binding/global atomic resolution retains independent profile identities even on identical routes', async t => {
  const f = await fixture(t, async function* () { yield text; yield stop; });
  await f.registry.upsert({ id: 'same-route', name: 'Separate key owner', provider: 'route-a', model: 'm-a' });
  await f.registry.bind('worker', 'same-route');
  assert.deepEqual(await f.registry.resolveBindingSelection('task', 'worker'), { profileId: 'same-route', route: { provider: 'route-a', model: 'm-a' } });
  assert.equal((await f.registry.resolveGlobalSelection()).profileId, 'a');
  const bound = await f.router.selectRoute('task', parent, 'worker');
  assert.equal(bound.profileId, 'same-route'); assert.equal(bound.source, 'agent_binding');
  const global = await f.router.selectRoute('task', parent, 'planner');
  assert.equal(global.profileId, 'a'); assert.equal(global.source, 'global_profile');
  await f.registry.bind('worker', null);
  assert.equal(await f.registry.resolveBindingSelection('task', 'worker'), null);
});

test('hand-built planner pool actually dispatches backup route and records health once', async t => {
  const f = await fixture(t, async function* (options) { yield* options.provider === 'route-a' ? [failure(401, 'AUTH')] : [text, stop]; });
  assert.deepEqual(await collect(f.router.stream('task', 'planner', Object.freeze(request()))), [text, stop]);
  assert.deepEqual(f.calls, [{ provider: 'route-a', model: 'm-a' }, { provider: 'route-b', model: 'm-b' }]);
  assert.equal(f.health.health('a').trips, 1);
  assert.deepEqual(f.chain(), emptyTaskLLMChain());
});

test('bound failure remains exclusive by default and opt-in pool fallback cannot advance unrelated task quota chain', async t => {
  const f = await fixture(t, async function* (options) { yield* options.provider === 'route-a' ? [failure(402, 'QUOTA')] : [text, stop]; });
  await f.registry.bind('worker', 'a');
  await f.registry.setTaskChain('task', ['a', 'b']);
  const original = f.chain();
  await assert.rejects(collect(f.router.stream('task', 'worker', request())), TaskModelRuntimeError);
  assert.deepEqual(f.calls, [{ provider: 'route-a', model: 'm-a' }]);
  assert.deepEqual(f.chain(), original);
  f.settings.llm_pool_bind_fallback = true;
  assert.deepEqual(await collect(f.router.stream('task', 'worker', request())), [text, stop]);
  assert.equal(f.calls.at(-1).provider, 'route-b');
  assert.deepEqual(f.chain(), original);
});

test('task quota cursor advances before global pool fallback and exhaustion still fences parent route', async t => {
  const f = await fixture(t, async function* () { yield failure(402, 'QUOTA'); });
  await f.registry.setTaskChain('task', ['a', 'b']);
  await assert.rejects(collect(f.router.stream('task', 'worker', request())), error => error.chainExhausted);
  assert.equal(f.chain().activeProfileId, null);
  assert.deepEqual(f.chain().profiles.map(p => p.status), ['quota_exhausted', 'quota_exhausted']);
  assert.equal(f.calls.length, 2);
  assert.equal((await f.router.selectRoute('task', parent, 'worker')).available, false);
});

test('native request selection returns actual provider before dispatch and retries remain bounded per step', async t => {
  const f = await fixture(t, async function* () { yield failure(503, 'SERVER_ERROR'); });
  const attempt = { triedProfileIds: [] };
  const first = await f.router.selectRoute('task', parent, 'worker', attempt);
  assert.equal(first.route.provider, 'route-a');
  const firstError = await f.router.recordFailure(first, failure(503, 'SERVER_ERROR').reason.failure, false, attempt);
  assert.equal(firstError.replay, true);
  const second = await f.router.selectRoute('task', parent, 'worker', attempt);
  assert.equal(second.route.provider, 'route-b');
  const secondError = await f.router.recordFailure(second, failure(503, 'SERVER_ERROR').reason.failure, false, attempt);
  assert.equal(secondError.replay, false);
  assert.deepEqual(attempt.triedProfileIds, ['a', 'b']);
  assert.equal((await f.router.selectRoute('task', parent, 'worker', attempt)).available, false);
  assert.equal((await f.router.selectRoute('task', parent, 'worker', { triedProfileIds: [] })).available, true);
});

test('readiness checks do not consume equal-priority rotation', async t => {
  const f = await fixture(t, async function* () { yield text; yield stop; });
  await f.registry.upsert({ id: 'c', name: 'Third', provider: 'route-b', model: 'm-c' });
  await f.health.recordFailure('a', { code: 'AUTH', status: 401, message: 'revoked' }, false);
  for (let i = 0; i < 5; i++) assert.equal((await f.router.selectRoute('task', parent, 'planner')).profileId, 'b');
  assert.equal((await f.router.selectRoute('task', parent, 'planner', { triedProfileIds: [] })).profileId, 'b');
  for (let i = 0; i < 3; i++) assert.equal((await f.router.selectRoute('task', parent, 'planner')).profileId, 'c');
  assert.equal((await f.router.selectRoute('task', parent, 'planner', { triedProfileIds: [] })).profileId, 'c');
});

test('actual DSH prepared calls consume selected provider/model and frozen requests cannot be rewritten by pool', async t => {
  const f = await fixture(t, async function* () { yield text; yield stop; });
  const app = new Context(), fibers = [], providers = [];
  class Adapter extends LlmAdapter {
    async *stream(options) {
      providers.push(options.provider);
      if (options.provider === 'route-a') throw new LlmError('revoked key', 'AUTH', { status: 401 });
      yield text; yield stop;
    }
  }
  fibers.push(await app.plugin(LlmRuntime));
  fibers.push(await app.plugin(ctx => { ctx.inject(['llm'], inner => { inner.llm.registerAdapter(['route-a', 'route-b'], new Adapter()); }); }));
  t.after(async () => { for (const fiber of fibers.reverse()) await fiber.dispose(); });
  const llm = app.get('llm'), attempt = { triedProfileIds: [] }, headers = [];
  for (;;) {
    const selected = await f.router.selectRoute('task', parent, 'worker', attempt);
    assert.equal(selected.available, true);
    const prepared = await llm.prepareCall(selected.route);
    headers.push(prepared.config);
    const options = Object.freeze({ ...request(), ...prepared.config });
    const chunks = await collect(f.router.decorateStream(options, selected, () => prepared.stream(options)));
    const last = chunks.at(-1);
    if (last.reason.kind !== 'error') { assert.deepEqual(chunks, [text, stop]); break; }
    const result = await f.router.recordFailure(selected, last.reason.failure, false, attempt);
    assert.equal(result.replay, true);
  }
  assert.deepEqual(providers, ['route-a', 'route-b']);
  assert.deepEqual(headers.map(header => header.provider), providers);
});

test('committed output and request errors never cause pool replay or mark unrelated task quotas', async t => {
  const f = await fixture(t, async function* () { yield text; yield failure(503, 'SERVER_ERROR'); });
  assert.deepEqual(await collect(f.router.stream('task', 'planner', request())), [text, failure(503, 'SERVER_ERROR')]);
  assert.equal(f.calls.length, 1);
  assert.equal(f.health.health('a').fails, 0);
  const attempt = { triedProfileIds: [] }, selected = await f.router.selectRoute('task', parent, 'worker', attempt);
  assert.deepEqual(await f.router.recordFailure(selected, failure(400, 'INVALID_REQUEST').reason.failure, false, attempt), { handled: false, replay: false });
  assert.deepEqual(attempt.triedProfileIds, []);
});
