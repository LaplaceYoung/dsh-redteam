import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { build } from 'esbuild';
import { Context } from '@deepseek-ai/cordis';
import LlmRuntime, { LlmAdapter } from '@deepseek-ai/dsh-llm';
import ToolRuntime from '@deepseek-ai/dsh-tools';
import SystemPrompt from '@deepseek-ai/dsh-system-prompt';

const built = await build({ stdin: { contents: "export * from './src/task-management/runtime-profiles.ts'; export * from './src/task-management/runtime-model.ts'; export * from './src/task-management/llm-chain.ts'; export { RedTeamStore } from './src/store.ts';", resolveDir: process.cwd(), loader: 'ts' }, bundle: true, platform: 'node', format: 'esm', write: false, packages: 'external' });
const code = built.outputFiles[0].text.replace(/from\s+(["'])(@[^"']+)\1/g, (_match, _quote, specifier) => `from ${JSON.stringify(import.meta.resolve(specifier))}`);
const { TaskProfileRegistry, installTaskProfiles, TaskModelRouter, markTaskLLMProfileQuotaExhausted, RedTeamStore } = await import(`data:text/javascript;base64,${Buffer.from(code + '\n//# sourceURL=task-profiles.bundle.mjs').toString('base64')}`);

class Adapter extends LlmAdapter {
  lookups = [];
  error;
  async listModels(provider) { return [{ provider, id: 'catalog-model', name: 'Catalog model' }]; }
  async resolveModel(provider, model) {
    this.lookups.push({ provider, model });
    if (this.error) throw this.error;
    return { provider, id: model, name: model, reasoning: { efforts: [{ id: 'low', name: 'Low' }, { id: 'high', name: 'High' }] } };
  }
  async *stream() { yield { type: 'text-delta', index: 0, text: 'ok' }; yield { type: 'finish', reason: { kind: 'stop' } }; }
}
async function fixture(t, tools = false) {
  const dir = await mkdtemp(join(tmpdir(), 'task-profiles-'));
  const store = new RedTeamStore(join(dir, 'redteam.json'));
  const task = await store.createTask('profile fixture', 'verify model routing');
  const app = new Context(), fibers = [], adapter = new Adapter();
  let registration, installation;
  t.after(async () => { installation?.dispose(); for (const fiber of fibers.reverse()) await fiber.dispose(); await rm(dir, { recursive: true, force: true }); });
  fibers.push(await app.plugin(LlmRuntime));
  fibers.push(await app.plugin(ctx => { ctx.inject(['llm'], inner => { registration = inner.llm.registerAdapter(['provider-a', 'provider-b', 'parent'], adapter); }); }));
  const llm = app.get('llm');
  let registry = new TaskProfileRegistry(store, llm);
  if (tools) {
    fibers.push(await app.plugin(SystemPrompt, {}));
    fibers.push(await app.plugin(ToolRuntime, { mode: 'native' }));
    fibers.push(await app.plugin(ctx => { ctx.inject(['llm', 'tools'], inner => { installation = installTaskProfiles(inner, store); registry = installation.registry; }); }));
  }
  const make = (id, overrides = {}) => registry.upsert({ id, name: `Profile ${id}`, provider: 'provider-a', model: `model-${id}`, ...overrides });
  const chain = () => store.snapshot().tasks.find(row => row.id === task.id).llmChain;
  const call = (name, args = {}) => app.get('tools').execute({ callId: randomUUID(), name, arguments: args, signal: AbortSignal.timeout(10000) });
  return { dir, store, task, app, llm, adapter, registration, installation, registry, make, chain, call };
}

test('profile ID is independent of provider/model, exact metadata validates unlisted model, and reload preserves edits', async t => {
  const f = await fixture(t);
  const created = await f.registry.upsert({ name: 'Primary', provider: 'provider-a', model: 'unlisted-model', reasoningEffort: 'high', maxTokens: 1024 });
  assert.notEqual(created.id, created.provider);
  assert.notEqual(created.id, created.model);
  assert.ok(f.adapter.lookups.some(p => p.model === 'unlisted-model'));
  const updated = await f.registry.upsert({ id: created.id, name: 'Renamed', provider: 'provider-b', model: 'changed-model' });
  assert.equal(updated.createdAt, created.createdAt);
  assert.equal(updated.reasoningEffort, undefined);
  const second = new TaskProfileRegistry(f.store, f.llm);
  assert.deepEqual((await second.list()).profiles, [updated]);
  assert.deepEqual(await second.resolveProfile(created.id), { provider: 'provider-b', model: 'changed-model' });
  assert.equal(second.storagePath, join(f.dir, 'task-model-profiles.json'));
});

test('reject unknown credentials, invalid controls, unregistered providers and unsupported effort before saving', async t => {
  const f = await fixture(t);
  const input = { name: 'Profile', provider: 'provider-a', model: 'model-a' };
  assert.throws(() => f.registry.upsert({ ...input, apiKey: 'secret' }), /credentials belong to DSH/);
  assert.throws(() => f.registry.upsert({ ...input, maxTokens: -1 }), /positive integer/);
  await assert.rejects(f.registry.upsert({ ...input, provider: 'missing' }), /not registered/);
  await assert.rejects(f.registry.upsert({ ...input, reasoningEffort: 'impossible' }), /unsupported reasoning/);
  assert.equal((await f.registry.list()).profiles.length, 0);
});

test('provider metadata I/O error propagates and does not publish a profile', async t => {
  const f = await fixture(t);
  const error = new Error('model metadata network offline');
  f.adapter.error = error;
  await assert.rejects(f.make('a'), failure => failure === error);
  assert.deepEqual((await f.registry.list()).profiles, []);
});

test('provider removal yields unavailable registry and resolver null without copying provider credentials', async t => {
  const f = await fixture(t);
  await f.make('a');
  f.registration.replace(['provider-b', 'parent']);
  assert.equal(await f.registry.resolveProfile('a'), null);
  const available = await f.registry.listAvailable();
  assert.equal(available[0].available, false);
  assert.match(available[0].reason, /not registered/);
  assert.equal((await f.registry.availableProfileIds()).size, 0);
  const raw = JSON.parse(await readFile(f.registry.storagePath, 'utf8'));
  assert.deepEqual(Object.keys(raw.profiles[0]).sort(), ['createdAt', 'id', 'model', 'name', 'provider', 'updatedAt']);
});

test('role binding > task chain > global active > parent route using persisted registry', async t => {
  const f = await fixture(t);
  await f.make('a'); await f.make('b', { provider: 'provider-b' });
  const router = new TaskModelRouter(f.store, f.llm, f.registry);
  const parent = { provider: 'parent', model: 'default-model' };
  assert.equal((await router.selectRoute(f.task.id, parent, 'planner')).source, 'parent');
  await f.registry.setActive('b');
  assert.equal((await router.selectRoute(f.task.id, parent, 'planner')).source, 'global_profile');
  await f.registry.setTaskChain(f.task.id, ['a']);
  assert.equal((await router.selectRoute(f.task.id, parent, 'planner')).route.model, 'model-a');
  await f.registry.bind('planner', 'b');
  assert.equal((await router.selectRoute(f.task.id, parent, 'planner')).source, 'agent_binding');
  assert.equal((await router.selectRoute(f.task.id, parent, 'worker')).source, 'task_chain');
  await f.registry.bind('planner', null);
  assert.equal((await router.selectRoute(f.task.id, parent, 'planner')).source, 'task_chain');
  await f.registry.setTaskChain(f.task.id, []);
  await f.registry.setActive(null);
  assert.equal((await router.selectRoute(f.task.id, parent, 'planner')).source, 'parent');
  await assert.rejects(f.registry.bind('planner', 'missing'), /not found/);
});

test('shared serialized registry writers and chain edits retain all committed configuration', async t => {
  const f = await fixture(t);
  const peer = new TaskProfileRegistry(new RedTeamStore(f.store.storagePath), f.llm);
  await Promise.all(Array.from({ length: 12 }, (_, i) => (i % 2 ? peer : f.registry).upsert({ id: `p${i}`, name: `P${i}`, provider: 'provider-a', model: `m${i}` })));
  assert.equal((await peer.list()).profiles.length, 12);
  await Promise.all([f.registry.bind('planner', 'p1'), peer.bind('worker', 'p2'), peer.setTaskChain(f.task.id, ['p3', 'p4'])]);
  assert.deepEqual((await f.registry.list()).roleBindings, { planner: 'p1', worker: 'p2' });
  assert.deepEqual(f.chain().profiles.map(p => p.profileId), ['p3', 'p4']);
});

test('task chain rejects missing/duplicate IDs without mutation and resets previous exhaustion', async t => {
  const f = await fixture(t);
  await f.make('a'); await f.make('b');
  await f.registry.setTaskChain(f.task.id, ['b', 'a'], 'a');
  const original = f.chain();
  await assert.rejects(f.registry.setTaskChain(f.task.id, ['missing']), /not found/);
  await assert.rejects(f.registry.setTaskChain(f.task.id, ['a', 'a']), /duplicate/);
  assert.deepEqual(f.chain(), original);
  await f.store.transaction(s => { const task = s.tasks[0]; task.llmChain = markTaskLLMProfileQuotaExhausted(task.llmChain, 'a', 'quota', new Date(), task.llmChain.revision).state; });
  assert.equal(f.chain().activeProfileId, null);
  await f.registry.setTaskChain(f.task.id, ['b', 'a']);
  assert.equal(f.chain().activeProfileId, 'b');
  assert.ok(f.chain().profiles.every(p => p.status === 'ready'));
});

test('deleting active global profile is rejected; removing chain current advances forward and clears role bindings', async t => {
  const f = await fixture(t);
  for (const id of ['a', 'b', 'c']) await f.make(id);
  await f.registry.setActive('a');
  await assert.rejects(f.registry.delete('a'), /cannot delete active/);
  await f.registry.bind('worker', 'b');
  await f.registry.setTaskChain(f.task.id, ['a', 'b', 'c'], 'b');
  const revision = f.chain().revision;
  await f.registry.delete('b');
  assert.equal(f.chain().activeProfileId, 'c');
  assert.equal(f.chain().revision, revision + 1);
  assert.deepEqual(f.chain().profiles.map(p => p.profileId), ['a', 'c']);
  assert.equal((await f.registry.list()).roleBindings.worker, undefined);
  await f.registry.delete('c');
  assert.deepEqual(f.chain().profiles, []);
  assert.equal(f.chain().activeProfileId, null);
});

test('deleting non-current entry preserves exhausted cursor and makes in-flight revisions stale', async t => {
  const f = await fixture(t);
  await f.make('a'); await f.make('b');
  await f.registry.setTaskChain(f.task.id, ['a', 'b'], 'b');
  await f.store.transaction(s => { const task = s.tasks[0]; task.llmChain = markTaskLLMProfileQuotaExhausted(task.llmChain, 'b', 'quota', new Date(), task.llmChain.revision).state; });
  const before = f.chain();
  await f.registry.delete('a');
  assert.equal(f.chain().activeProfileId, null);
  assert.equal(f.chain().revision, before.revision + 1);
  assert.equal(f.chain().profiles[0].status, 'quota_exhausted');
});

test('interrupted cross-file delete retains journal and recovers references on next registry access', async t => {
  const f = await fixture(t);
  await f.make('a'); await f.make('b');
  await f.registry.bind('planner', 'a');
  await f.registry.setTaskChain(f.task.id, ['a', 'b']);
  const transact = f.store.transaction.bind(f.store);
  f.store.transaction = async () => { throw new Error('task volume unavailable'); };
  await assert.rejects(f.registry.delete('a'), /task volume unavailable/);
  const pending = JSON.parse(await readFile(f.registry.storagePath, 'utf8'));
  assert.equal(pending.pendingDeletion, 'a');
  assert.equal(f.chain().activeProfileId, 'a');
  f.store.transaction = transact;
  const recovered = await new TaskProfileRegistry(f.store, f.llm).list();
  assert.equal(recovered.pendingDeletion, null);
  assert.equal(recovered.roleBindings.planner, undefined);
  assert.deepEqual(recovered.profiles.map(p => p.id), ['b']);
  assert.equal(f.chain().activeProfileId, 'b');
  const revision = f.chain().revision;
  await f.registry.list();
  assert.equal(f.chain().revision, revision);
});

test('recovery after task cleanup already committed does not advance the cursor twice', async t => {
  const f = await fixture(t);
  await f.make('a'); await f.make('b');
  await f.registry.setTaskChain(f.task.id, ['a', 'b']);
  const pending = await f.registry.list(); pending.pendingDeletion = 'a';
  await writeFile(f.registry.storagePath, JSON.stringify(pending));
  await f.store.transaction(s => { const c = s.tasks[0].llmChain; c.profiles = c.profiles.filter(p => p.profileId !== 'a'); c.activeProfileId = c.legacyProfileId = 'b'; c.revision++; });
  const revision = f.chain().revision;
  await f.registry.list();
  assert.equal(f.chain().revision, revision);
  assert.equal(f.chain().activeProfileId, 'b');
});

test('malformed persisted configuration is surfaced instead of silently resetting', async t => {
  const f = await fixture(t);
  await f.make('a');
  const state = await f.registry.list(); state.roleBindings.planner = 'missing';
  await writeFile(f.registry.storagePath, JSON.stringify(state));
  await assert.rejects(f.registry.list(), /invalid persisted role binding/);
  await assert.rejects(f.make('b'), /invalid persisted role binding/);
  assert.equal(JSON.parse(await readFile(f.registry.storagePath, 'utf8')).profiles.length, 1);
});

test('registered rc2 tools create, list, bind, set chain/global, and delete persisted profiles', async t => {
  const f = await fixture(t, true);
  const created = await f.call('redteam_upsert_model_profile', { name: 'Tool profile', provider: 'provider-a', model: 'tool-model', reasoning_effort: 'high' });
  assert.equal(created.isError, false, JSON.stringify(created));
  const id = created.value.id;
  assert.ok(id);
  const listing = await f.call('redteam_list_model_profiles');
  assert.equal(listing.isError, false);
  assert.equal(listing.value.profiles[0].available, true);
  assert.ok(listing.value.catalog.providers.some(p => p.id === 'provider-a'));
  assert.equal((await f.call('redteam_bind_role_model', { role: 'worker', profile_id: id })).isError, false);
  assert.equal((await f.call('redteam_set_task_model_chain', { task_id: f.task.id, profile_ids: [id] })).isError, false);
  assert.equal(f.chain().activeProfileId, id);
  assert.equal((await f.call('redteam_set_active_model_profile', { profile_id: id })).isError, false);
  assert.equal((await f.call('redteam_delete_model_profile', { profile_id: id })).isError, true);
  assert.equal((await f.call('redteam_set_active_model_profile')).isError, false);
  assert.equal((await f.call('redteam_delete_model_profile', { profile_id: id })).isError, false);
  assert.deepEqual((await f.registry.list()).profiles, []);
  assert.deepEqual(f.chain().profiles, []);
  f.installation.dispose();
  const removed = await f.call('redteam_list_model_profiles');
  assert.equal(removed.isError, true);
});

test('atomic task creation shares the deletion lock and never leaves a deleted profile reference', async t => {
  const f = await fixture(t); await f.make('a');
  const createdPromise = f.registry.createManagedTask({ title: 'atomic create', goal: 'profile consistency', llmProfileIds: ['a'] });
  const deletion = new TaskProfileRegistry(f.store, f.llm).delete('a');
  const [created] = await Promise.all([createdPromise, deletion]);
  assert.equal(created.llmChain.activeProfileId, 'a');
  assert.deepEqual(f.store.snapshot().tasks.find(task => task.id === created.id).llmChain.profiles, []);
  await f.make('b');
  const results = await Promise.allSettled([f.registry.delete('b'), f.registry.createManagedTask({ title: 'must reject', goal: 'no dangling profile', llmProfileIds: ['b'] })]);
  assert.equal(results[0].status, 'fulfilled'); assert.equal(results[1].status, 'rejected');
  assert.match(results[1].reason.message, /not found/);
  assert.equal(f.store.snapshot().tasks.some(task => task.title === 'must reject'), false);
});

test('reporter and retester native bindings select their exact independent model routes', async t => {
  const f = await fixture(t, true); await f.make('report'); await f.make('retest');
  for (const [role, id] of [['reporter', 'report'], ['retester', 'retest']]) {
    assert.equal((await f.call('redteam_bind_role_model', { role, profile_id: id })).isError, false);
    const selected = await new TaskModelRouter(f.store, f.llm, f.registry).selectRoute(f.task.id, { provider: 'parent', model: 'fallback' }, role);
    assert.equal(selected.source, 'agent_binding'); assert.equal(selected.route.model, `model-${id}`);
  }
});
