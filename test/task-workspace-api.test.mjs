import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:http';
import { build } from 'esbuild';
const bundle = await build({ stdin: { contents: `export * from './src/task-workspace/api.ts'; export {RedTeamStore} from './src/store.ts'; export {TaskProfileRegistry} from './src/task-management/runtime-profiles.ts';`, resolveDir: process.cwd(), loader: 'ts' }, bundle: true, format: 'esm', platform: 'node', write: false, plugins: [{ name: 'externals', setup(build) { build.onResolve({ filter: /^[^./]|^node:/ }, args => ({ path: args.path.startsWith('node:') ? args.path : import.meta.resolve(args.path), external: true })); } }] });
const { installTaskWorkspaceApi, RedTeamStore, TaskProfileRegistry } = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString('base64')}`);

async function fixture(t, lifecycleOverride = {}, admissionOverride) {
  const directory = await mkdtemp(join(tmpdir(), 'task-workspace-')); const store = new RedTeamStore(join(directory, 'state.json')); await store.load();
  const effects = [], calls = []; let route; const agent = { id: 'current', options: { provider: 'test-provider', model: 'test-model' } };
  const llm = { listProviders: () => [{ id: 'test-provider', name: 'Provider', apiKey: 'secret-never-return' }], listModels: async () => [{ id: 'test-model', name: 'Model', provider: 'test-provider', config: { secret: 'hidden' } }], resolveModelInfo: async () => ({ reasoning: { efforts: [{ id: 'high', name: 'High' }] } }) };
  const profiles = new TaskProfileRegistry(store, llm);
  const lifecycle = { admission: () => ({ enabled: true, limit: 2 }), start: async (...args) => { calls.push(['start', ...args]); }, pause: async (...args) => { calls.push(['pause', ...args]); }, ...lifecycleOverride };
  const ctx = { agents: { get: id => id === agent.id ? agent : undefined }, llm, webServer: { register: value => { route = value; return () => { route = undefined; }; } }, effect: callback => effects.push(callback()), logger: { warn() {} } };
  const installation = installTaskWorkspaceApi(ctx, store, { profiles, authenticate: request => request.headers.origin === 'https://foreign.invalid' ? 403 : request.headers.authorization === 'Bearer fixture', lifecycleForAgent: a => a === agent ? lifecycle : undefined, admission: admissionOverride ?? lifecycle.admission, notify: id => calls.push(['notify', id]) });
  const server = createServer((req, res) => route.handler(req, res)); await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const url = `http://127.0.0.1:${server.address().port}/api/redteam/task-workspace`;
  const get = async (session = 'current', authorized = true) => { const r = await fetch(`${url}?sessionId=${session}`, { headers: authorized ? { authorization: 'Bearer fixture' } : {} }); return { status: r.status, body: await r.json() }; };
  const post = async (body, authorized = true) => { const r = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json', ...(authorized ? { authorization: 'Bearer fixture' } : {}) }, body: JSON.stringify(body) }); return { status: r.status, body: await r.json() }; };
  t.after(async () => { await new Promise(resolve => server.close(resolve)); installation.dispose(); await rm(directory, { recursive: true, force: true }); });
  return { store, profiles, agent, calls, get, post, url, installation, route: () => route };
}
test('authentication rejects reads and writes before any task mutation', async t => {
  const f = await fixture(t); assert.equal((await f.get('current', false)).status, 401);
  assert.equal((await f.post({ action: 'task.create', input: { title: 'Hidden' } }, false)).status, 401); assert.equal(f.store.snapshot().tasks.length, 0);
  const forbidden = await fetch(f.url, { headers: { authorization: 'Bearer fixture', origin: 'https://foreign.invalid' } }); assert.equal(forbidden.status, 403);
});
test('HTTP boundary rejects malformed JSON, oversized bodies and unsupported methods', async t => {
  const f = await fixture(t); const headers = { authorization: 'Bearer fixture', 'content-type': 'application/json' };
  assert.equal((await fetch(f.url, { method: 'POST', headers, body: '{broken' })).status, 400);
  assert.equal((await fetch(f.url, { method: 'POST', headers, body: JSON.stringify({ action: 'task.create', input: { title: 'x'.repeat(1024 * 1024) } }) })).status, 413);
  assert.equal((await fetch(f.url, { method: 'POST', headers: { authorization: 'Bearer fixture', 'content-type': 'text/plain' }, body: '{}' })).status, 415);
  assert.equal((await fetch(f.url, { method: 'DELETE', headers })).status, 405);
  assert.equal(f.store.snapshot().tasks.length, 0);
});
test('workspace exposes explicit current Agent and allowlisted catalog without secrets', async t => {
  const f = await fixture(t); const r = await f.get(); assert.equal(r.status, 200); assert.equal(r.body.agent.available, true);
  assert.deepEqual(r.body.catalog.models[0].reasoningEfforts, [{ id: 'high', name: 'High' }]); assert.doesNotMatch(JSON.stringify(r.body), /secret-never-return|hidden/);
  assert.equal((await f.get('missing')).body.agent.available, false);
});
test('workspace awaits the latest asynchronous admission settings without a live Agent', async t => {
  let settings = { enabled: true, limit: 3 };
  const f = await fixture(t, {}, async () => structuredClone(settings));
  let response = await f.get('missing');
  assert.equal(response.status, 200); assert.equal(response.body.agent.available, false);
  assert.deepEqual(response.body.admission, { enabled: true, limit: 3 });
  settings = { enabled: false, limit: 7 };
  response = await f.get('missing');
  assert.deepEqual(response.body.admission, { enabled: false, limit: 7 });
});
test('create from template, update metadata and move category use durable domain operations', async t => {
  const f = await fixture(t);
  let r = await f.post({ action: 'category.create', name: 'Apps' }); const categoryId = r.body.workspace.categories[0].id;
  r = await f.post({ action: 'template.create', input: { name: 'Review', description: 'Check app', goal: 'Verified issue', categoryId } }); const templateId = r.body.workspace.templates[0].id;
  r = await f.post({ action: 'task.create', input: { templateId } }); assert.equal(r.status, 200); const taskId = r.body.taskId;
  assert.equal(r.body.workspace.tasks[0].goal, 'Verified issue'); assert.equal(f.store.snapshot().nodes.filter(n => n.taskId === taskId).length, 1); assert.equal(f.store.snapshot().goals.length, 0);
  await f.post({ action: 'task.metadata', taskId, patch: { title: 'Renamed', pinned: true } }); await f.post({ action: 'task.category', taskIds: [taskId], categoryId: null });
  const task = f.store.snapshot().tasks[0]; assert.equal(task.title, 'Renamed'); assert.ok(task.pinnedAt); assert.equal(task.categoryId, null);
});
test('execution uses the exact live Agent and rejects missing or model-less sessions', async t => {
  const f = await fixture(t); const task = await f.store.createTask('Run', 'Goal');
  assert.equal((await f.post({ action: 'task.start', taskId: task.id, sessionId: 'missing' })).status, 409); assert.equal(f.calls.length, 0);
  assert.equal((await f.post({ action: 'task.start', taskId: task.id })).status, 400);
  for (const action of ['start', 'resume', 'rerun', 'pause']) assert.equal((await f.post({ action: `task.${action}`, taskId: task.id, sessionId: 'current' })).status, 200);
  assert.strictEqual(f.calls[0][2], f.agent); assert.equal(f.calls.find(call => call[3] === 'resume')[1], task.id);
  delete f.agent.options.model; assert.equal((await f.post({ action: 'task.start', taskId: task.id, sessionId: 'current' })).status, 409);
});
test('pause can reach lifecycle while a start request awaits model work', async t => {
  let started, release; const entered = new Promise(resolve => { started = resolve; }); const blocker = new Promise(resolve => { release = resolve; });
  const f = await fixture(t, { start: async () => { started(); await blocker; }, pause: async () => { release(); } }); const task = await f.store.createTask('Run', 'Goal');
  const pending = f.post({ action: 'task.start', taskId: task.id, sessionId: 'current' }); await entered;
  assert.equal((await f.post({ action: 'task.pause', taskId: task.id, sessionId: 'current' })).status, 200); assert.equal((await pending).status, 200);
});

test('task deletion validates flags and delegates exact Agent without requiring a model selection', async t => {
  const calls = []; const f = await fixture(t, { deleteTask: async (...args) => { calls.push(args); } });
  const task = await f.store.createTask('Delete fixture', 'Goal');
  assert.equal((await f.post({ action: 'task.delete', taskId: task.id, sessionId: 'current', deleteAssets: 'yes' })).status, 400);
  assert.equal((await f.post({ action: 'task.delete', taskId: task.id, sessionId: 'missing' })).status, 409);
  delete f.agent.options.model;
  assert.equal((await f.post({ action: 'task.delete', taskId: task.id, sessionId: 'current', deleteAssets: true, deleteFindings: false })).status, 200);
  assert.deepEqual(calls, [[task.id, f.agent, { deleteAssets: true, deleteFindings: false }]]);
  assert.equal(f.calls.some(call => call[0] === 'notify'), false, 'deleted task must not wake its Planner');
});
test('goal and constraint mutation validates task ownership and wakes the task', async t => {
  const f = await fixture(t); const a = await f.store.createTask('A', 'Goal'), b = await f.store.createTask('B', 'Goal');
  let r = await f.post({ action: 'goal.create', taskId: a.id, text: 'Evidence' }); const goalId = r.body.workspace.goals[0].id;
  assert.equal((await f.post({ action: 'goal.delete', taskId: b.id, id: goalId })).status, 404); assert.equal(f.store.snapshot().goals[0].state, 'open');
  await f.post({ action: 'goal.update', taskId: a.id, id: goalId, text: 'New evidence' }); await f.post({ action: 'goal.delete', taskId: a.id, id: goalId }); assert.equal(f.store.snapshot().goals[0].state, 'deleted');
  r = await f.post({ action: 'constraint.create', taskId: a.id, kind: 'deny', text: 'No disruption' }); const id = r.body.workspace.constraints[0].id;
  r = await f.post({ action: 'constraint.delete', taskId: a.id, id }); assert.equal(r.body.workspace.constraints.length, 0); assert.ok(f.calls.some(call => call[0] === 'notify' && call[1] === a.id));
});
test('profile and task chain persist order, active cursor, reset and deletion', async t => {
  const f = await fixture(t); const task = await f.store.createTask('Models', 'Goal');
  for (const name of ['First', 'Second']) assert.equal((await f.post({ action: 'profile.upsert', input: { name, provider: 'test-provider', model: 'test-model', reasoningEffort: 'high' } })).status, 200);
  const ids = (await f.profiles.list()).profiles.map(p => p.id);
  let r = await f.post({ action: 'chain.set', taskId: task.id, profileIds: ids.toReversed(), activeProfileId: ids[0] });
  assert.equal(r.status, 200); assert.deepEqual(r.body.workspace.tasks[0].llmChain.profiles.map(p => p.profileId), ids.toReversed()); assert.equal(r.body.workspace.tasks[0].llmChain.activeProfileId, ids[0]);
  r = await f.post({ action: 'chain.set', taskId: task.id, profileIds: [] }); assert.equal(r.body.workspace.tasks[0].llmChain.profiles.length, 0);
  assert.equal((await f.post({ action: 'profile.delete', id: ids[0] })).status, 200); assert.equal((await f.profiles.list()).profiles.length, 1);
});
test('malformed values and credential injection are rejected without mutations', async t => {
  const f = await fixture(t);
  for (const action of [{ action: 'task.create', input: { goal: 12 } }, { action: 'task.create', input: { timeoutSeconds: '10' } }, { action: 'category.create', name: [] }, { action: 'profile.upsert', input: { name: 'Bad', provider: 'test-provider', model: 'test-model', apiKey: 'secret' } }, { action: 'goal.create', taskId: 'no-task', text: 'Goal' }]) assert.ok((await f.post(action)).status >= 400);
  assert.equal(f.store.snapshot().tasks.length, 0); assert.equal((await f.profiles.list()).profiles.length, 0);
});
test('disposal removes the registered host route', async t => { const f = await fixture(t); assert.ok(f.route()); f.installation.dispose(); assert.equal(f.route(), undefined); });
