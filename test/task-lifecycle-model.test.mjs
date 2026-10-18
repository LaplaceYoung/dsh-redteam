import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { build } from 'esbuild';
import { Context } from '@deepseek-ai/cordis';
import LlmRuntime, { LlmAdapter, LlmError } from '@deepseek-ai/dsh-llm';

const built = await build({ stdin: { contents: "export * from './src/task-management/runtime-model.ts'; export * from './src/task-management/llm-chain.ts'; export { RedTeamStore } from './src/store.ts';", resolveDir: process.cwd(), loader: 'ts' }, bundle: true, platform: 'node', format: 'esm', write: false, packages: 'external' });
const code = built.outputFiles[0].text.replace(/from\s+(["'])(@[^"']+)\1/g, (_match, _quote, specifier) => `from ${JSON.stringify(import.meta.resolve(specifier))}`);
const { TaskModelRouter, TaskModelRuntimeError, taskModelChunkCommitsOutput, RedTeamStore, replaceTaskLLMProfiles } = await import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`);
const routes = new Map([['a', { provider: 'route-a', model: 'model-a' }], ['b', { provider: 'route-b', model: 'model-b', maxTokens: 512 }]]);
const parent = { provider: 'parent', model: 'parent-model', maxTokens: 1024 };
const text = value => ({ type: 'text-delta', index: 0, text: value });
const stop = { type: 'finish', reason: { kind: 'stop' } };
const quota = { type: 'finish', reason: { kind: 'error', failure: { code: 'QUOTA', message: 'account depleted', status: 429 } } };
const metadata = { type: 'block-start', index: 0, blockType: 'text' };
const request = () => ({ ...parent, messages: [{ role: 'user', content: [{ type: 'text', text: 'authorized fixture' }] }], system: 'fixture system', tools: [] });
async function collect(stream) { const chunks = []; for await (const chunk of stream) chunks.push(chunk); return chunks; }

async function fixture(t, responses = [], options = {}) {
  const dir = await mkdtemp(join(tmpdir(), 'task-model-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const store = new RedTeamStore(join(dir, 'state.json'));
  const task = await store.createTask('model fixture', 'verify route behavior');
  await store.transaction(state => {
    const row = state.tasks.find(row => row.id === task.id);
    row.llmChain = replaceTaskLLMProfiles(row.llmChain, options.ids ?? ['a', 'b'], new Set(routes.keys()));
  });
  const requests = [], transitions = [];
  const service = {
    listProviders: () => [...routes.values(), parent, { provider: 'bound', model: 'bound-model' }].map(r => ({ id: r.provider, name: r.provider })),
    async *stream(input) {
      requests.push(input);
      assert.ok(responses.length, 'unexpected model call');
      const response = responses.shift();
      if (typeof response === 'function') { yield* response(input); return; }
      for (const chunk of response) yield chunk;
    },
  };
  const resolver = { resolveProfile: id => routes.get(id) ?? null, resolveBinding: () => null, ...options.resolver };
  const router = new TaskModelRouter(store, options.service ?? service, resolver, { onTransition: (s, tr) => transitions.push({ s, tr }) });
  const state = () => store.snapshot().tasks.find(row => row.id === task.id).llmChain;
  return { dir, store, task, router, requests, transitions, state, resolver };
}

test('quota finish before output reroutes real GenerateOptions and discards previous attempt metadata', async t => {
  const f = await fixture(t, [[metadata, quota], [text('ok'), stop]]);
  const input = Object.freeze({ ...request(), reasoningEffort: 'parent-only-effort' });
  const chunks = await collect(f.router.stream(f.task.id, 'planner', input));
  assert.deepEqual(chunks, [text('ok'), stop]);
  assert.deepEqual(f.requests.map(r => [r.provider, r.model, r.maxTokens]), [['route-a', 'model-a', undefined], ['route-b', 'model-b', 512]]);
  assert.equal(f.requests[0].reasoningEffort, undefined);
  assert.strictEqual(f.requests[0].messages, input.messages);
  assert.equal(f.requests[0].system, input.system);
  assert.equal(input.provider, 'parent');
  assert.equal(f.state().activeProfileId, 'b');
  assert.equal(f.transitions.length, 1);
  const persisted = JSON.parse(await readFile(join(f.dir, 'state.json'), 'utf8'));
  assert.equal(persisted.tasks[0].llmChain.activeProfileId, 'b');
});

test('thrown provider quota before output advances and retries', async t => {
  const f = await fixture(t, [async function* () { throw new Error('余额不足'); }, [text('recovered'), stop]]);
  assert.deepEqual(await collect(f.router.stream(f.task.id, 'goals', request())), [text('recovered'), stop]);
  assert.equal(f.requests.length, 2);
  assert.equal(f.state().activeProfileId, 'b');
});

for (const committedChunk of [text('visible'), { type: 'reasoning-delta', index: 0, text: 'thinking' }, { type: 'block-start', index: 0, blockType: 'tool-call' }, { type: 'tool-call-delta', index: 0, id: 'tool-1', name: 'write_file', argumentsDelta: '' }]) {
  test(`quota after ${committedChunk.type} persists switch but never replays`, async t => {
    const f = await fixture(t, [[committedChunk, quota]]);
    const seen = [];
    await assert.rejects(async () => { for await (const chunk of f.router.stream(f.task.id, 'planner', request())) seen.push(chunk); }, error => error instanceof TaskModelRuntimeError && error.outputCommitted && !error.chainExhausted);
    assert.deepEqual(seen, [committedChunk]);
    assert.equal(f.requests.length, 1);
    assert.equal(f.state().activeProfileId, 'b');
  });
}

test('fully exhausted explicit chain blocks parent fallback on this and later calls', async t => {
  const f = await fixture(t, [[quota]], { ids: ['a'] });
  await assert.rejects(collect(f.router.stream(f.task.id, 'planner', request())), error => error.chainExhausted === true);
  const selected = await f.router.selectRoute(f.task.id, parent, 'worker');
  assert.equal(selected.available, false);
  assert.equal(selected.chainExhausted, true);
  assert.equal(f.requests.length, 1);
  assert.equal(f.state().activeProfileId, null);
});

test('role binding and empty-chain parent fallback never mutate task chain on quota failures', async t => {
  const bound = await fixture(t, [[quota]], { resolver: { resolveBinding: () => ({ provider: 'bound', model: 'role-model' }) } });
  const initial = bound.state();
  assert.deepEqual(await collect(bound.router.stream(bound.task.id, 'worker', request())), [quota]);
  assert.equal(bound.requests[0].model, 'role-model');
  assert.deepEqual(bound.state(), initial);
  const fallback = await fixture(t, [[quota]], { ids: [] });
  assert.deepEqual(await collect(fallback.router.stream(fallback.task.id, 'mainagent', request())), [quota]);
  assert.equal(fallback.requests[0].provider, 'parent');
  assert.equal(fallback.transitions.length, 0);
});

test('unregistered bindings fall through, unregistered task profiles stop, and resolver errors propagate', async t => {
  const f = await fixture(t, [], { resolver: { resolveBinding: () => ({ provider: 'missing', model: 'm' }) } });
  assert.equal((await f.router.selectRoute(f.task.id, parent, 'planner')).source, 'task_chain');
  f.resolver.resolveProfile = () => ({ provider: 'missing', model: 'm' });
  const unavailable = await f.router.selectRoute(f.task.id, parent, 'planner');
  assert.equal(unavailable.available, false);
  assert.match(unavailable.reason, /not registered/);
  f.resolver.resolveBinding = () => { throw new Error('configuration read failed'); };
  await assert.rejects(f.router.selectRoute(f.task.id, parent, 'planner'), /configuration read failed/);
  assert.equal(f.requests.length, 0);
});

test('each call rereads current chain and concurrent failures advance only once', async t => {
  const f = await fixture(t);
  const first = await f.router.selectRoute(f.task.id, parent, 'worker');
  const second = await f.router.selectRoute(f.task.id, parent, 'planner');
  const [a, b] = await Promise.all([f.router.recordFailure(first, quota.reason.failure, false), f.router.recordFailure(second, quota.reason.failure, false)]);
  assert.equal(a.transition.advanced, true);
  assert.equal(b.transition.stale, true);
  assert.equal(b.replay, true);
  assert.equal(f.state().activeProfileId, 'b');
  assert.equal(f.transitions.length, 1);
  assert.equal((await f.router.selectRoute(f.task.id, parent, 'worker')).route.provider, 'route-b');
});

test('in-flight chain replacement is not overwritten by stale quota failure', async t => {
  const f = await fixture(t, [async function* () {
    await f.store.transaction(state => { const row = state.tasks[0]; row.llmChain = replaceTaskLLMProfiles(row.llmChain, ['b'], new Set(routes.keys())); });
    yield quota;
  }, [text('new chain'), stop]]);
  assert.deepEqual(await collect(f.router.stream(f.task.id, 'planner', request())), [text('new chain'), stop]);
  assert.equal(f.state().profiles[0].status, 'ready');
  assert.equal(f.transitions.length, 0);
});

test('canonical transient/auth codes and HTTP exclusions preserve original finish error', async t => {
  for (const failure of [
    { code: 'RATE_LIMIT', message: 'quota exceeded', status: 429 },
    { code: 'AUTH', message: 'insufficient_quota', status: 401 },
    { code: 'QUOTA', message: 'account depleted', status: 503 },
  ]) {
    const terminal = { type: 'finish', reason: { kind: 'error', failure } };
    const f = await fixture(t, [[metadata, terminal]]);
    assert.deepEqual(await collect(f.router.stream(f.task.id, 'planner', request())), [metadata, terminal]);
    assert.equal(f.state().activeProfileId, 'a');
    assert.equal(f.transitions.length, 0);
  }
});

test('thrown rc2 LlmError retains nested status exclusions', async t => {
  const original = new LlmError('insufficient_quota', 'QUOTA', { status: 503 });
  const f = await fixture(t, [async function* () { throw original; }]);
  await assert.rejects(collect(f.router.stream(f.task.id, 'planner', request())), error => error === original);
  assert.equal(f.state().activeProfileId, 'a');
});

test('aborted terminal and caller cancellation cannot exhaust or replay', async t => {
  const aborted = { type: 'finish', reason: { kind: 'aborted', failure: quota.reason.failure } };
  const f = await fixture(t, [[metadata, aborted]]);
  assert.deepEqual(await collect(f.router.stream(f.task.id, 'planner', request())), [metadata, aborted]);
  const controller = new AbortController();
  controller.abort(new Error('caller stopped'));
  await assert.rejects(collect(f.router.stream(f.task.id, 'planner', { ...request(), signal: controller.signal })), /caller stopped/);
  assert.equal(f.requests.length, 1);
  assert.equal(f.state().activeProfileId, 'a');
});

test('durable failure blocks replay and identifies already committed output', async t => {
  const f = await fixture(t, [[text('visible'), quota]]);
  const failStore = { snapshot: () => f.store.snapshot(), transaction: async () => { throw new Error('disk full'); } };
  const router = new TaskModelRouter(failStore, {
    listProviders: () => [{ id: 'route-a', name: 'a' }],
    async *stream() { yield text('visible'); yield quota; },
  }, f.resolver);
  await assert.rejects(collect(router.stream(f.task.id, 'worker', request())), error => error.routerHandled && error.outputCommitted && /disk full/.test(error.message));
  assert.equal(f.state().activeProfileId, 'a');
});

test('consumer and iterator cleanup errors are never treated as provider quota', async t => {
  const f = await fixture(t, [[text('visible'), stop]]);
  const iterator = f.router.stream(f.task.id, 'planner', request())[Symbol.asyncIterator]();
  await iterator.next();
  const consumerError = new Error('consumer quota exceeded');
  await assert.rejects(iterator.throw(consumerError), error => error === consumerError);
  assert.equal(f.state().activeProfileId, 'a');
  const cleanup = await fixture(t, [async function* () { try { yield quota; } finally { throw new Error('cleanup quota exceeded'); } }]);
  await assert.rejects(collect(cleanup.router.stream(cleanup.task.id, 'planner', request())), /cleanup quota exceeded/);
  assert.equal(cleanup.state().activeProfileId, 'a');
});

test('rc2 LlmRuntime adapter dispatch actually receives selected provider/model and normalizes thrown quota', async t => {
  const app = new Context();
  const fibers = [];
  t.after(async () => { for (const fiber of fibers.reverse()) await fiber.dispose(); });
  fibers.push(await app.plugin(LlmRuntime));
  const received = [];
  class Adapter extends LlmAdapter {
    async *stream(input) {
      received.push([input.provider, input.model]);
      if (input.provider === 'route-a') throw new LlmError('depleted', 'ACCOUNT_QUOTA', { status: 429 });
      yield text('native runtime ok'); yield stop;
    }
  }
  fibers.push(await app.plugin(ctx => { ctx.inject(['llm'], inner => { inner.llm.registerAdapter(['route-a', 'route-b', 'parent'], new Adapter()); }); }));
  const f = await fixture(t, [], { service: app.get('llm') });
  assert.deepEqual(await collect(f.router.stream(f.task.id, 'planner', request())), [text('native runtime ok'), stop]);
  assert.deepEqual(received, [['route-a', 'model-a'], ['route-b', 'model-b']]);
  assert.equal(f.state().activeProfileId, 'b');
});

test('chunk commitment recognizes completed content and buffers empty text metadata', () => {
  assert.equal(taskModelChunkCommitsOutput(metadata), false);
  assert.equal(taskModelChunkCommitsOutput(text('')), false);
  assert.equal(taskModelChunkCommitsOutput({ type: 'usage', usage: { inputTokens: 1, outputTokens: 0 } }), false);
  assert.equal(taskModelChunkCommitsOutput({ type: 'block-end', index: 0, block: { type: 'text', text: 'complete' } }), true);
  assert.equal(taskModelChunkCommitsOutput(stop), true);
  assert.equal(taskModelChunkCommitsOutput(quota), false);
});
