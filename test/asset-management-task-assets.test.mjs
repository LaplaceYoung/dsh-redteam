import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { build } from 'esbuild';

const built = await build({ stdin: { contents: "export { TaskAssetRuntime } from './src/asset-management/task-assets.ts'; export { RedTeamStore } from './src/store.ts'; export { GraphAssetRuntime, assetKey, assetRow } from './src/graph-tools/assets.ts'; export { assetTaskIds } from './src/shared-assets.ts';", resolveDir: process.cwd(), loader: 'ts' }, bundle: true, write: false, platform: 'node', format: 'esm', packages: 'external' });
const code = built.outputFiles[0].text.replace(/from\s+(["'])([^"']+)\1/g, (_match, _quote, specifier) => `from ${JSON.stringify(import.meta.resolve(specifier))}`);
const { TaskAssetRuntime, RedTeamStore, GraphAssetRuntime, assetTaskIds, assetKey, assetRow } = await import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`);

async function fixture(t) {
  const dir = await mkdtemp(join(tmpdir(), 'task-assets-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const store = new RedTeamStore(join(dir, 'state.json'));
  const task = await store.createTask('任务资产', '验证共享资产关联');
  const other = await store.createTask('另一个任务', '验证共享资产关联');
  const graph = new GraphAssetRuntime(store), runtime = new TaskAssetRuntime(store);
  const insert = async (items, taskId = 'global', options) => {
    const result = await graph.insertAssets(taskId, items, options);
    assert.deepEqual(result.errors, []); return result.results.map(row => row.id);
  };
  return { store, task, other, graph, runtime, insert };
}

test('manual attach reuses global assets, deduplicates IDs, counts existing links and preserves another task provenance', async t => {
  const { store, task, other, runtime, insert } = await fixture(t);
  const [id] = await insert([{ type: 'root_domain', domain: 'EXAMPLE.com' }]);
  const original = store.snapshot().assets.find(asset => asset.id === id);
  assert.deepEqual(await runtime.attach(task.id, [id, id], '  操作员选择  '), { requested: 1, attached: 1, existing: 0 });
  await runtime.attach(other.id, [id], '另一个任务来源');
  assert.deepEqual(await runtime.attach(task.id, [id], '修订来源'), { requested: 1, attached: 0, existing: 1 });
  const state = store.snapshot(), asset = state.assets.find(asset => asset.id === id);
  assert.equal(state.assets.length, 1); assert.equal(assetKey(asset), assetKey(original));
  assert.deepEqual(new Set(assetTaskIds(asset)), new Set([task.id, other.id]));
  assert.equal(assetRow(asset, task.id).task_source_summary, '修订来源');
  assert.equal(assetRow(asset, other.id).task_source_summary, '另一个任务来源');
  assert.equal(state.scopes.length, 0, 'attaching an existing asset must not broaden task scope');
  const reloaded = new RedTeamStore(store.storagePath); await reloaded.load();
  assert.deepEqual(assetTaskIds(reloaded.snapshot().assets[0]), assetTaskIds(asset));
});

test('attach validates the complete batch and Unicode summary before any association changes', async t => {
  const { store, task, runtime, insert } = await fixture(t);
  const [id] = await insert([{ type: 'ip', ip: '192.0.2.10' }]);
  const before = store.snapshot();
  await assert.rejects(runtime.attach(task.id, [id, 'missing'], '全部一起提交'), error => error.status === 404);
  assert.deepEqual(store.snapshot(), before);
  await assert.rejects(runtime.attach(task.id, [], '来源'), error => error.status === 400);
  await assert.rejects(runtime.attach(task.id, [id], '  '), /source_summary is required/);
  await assert.rejects(runtime.attach(task.id, Array.from({ length: 101 }, (_, i) => `asset-${i}`), '来源'), /at most 100/);
  await assert.rejects(runtime.attach(task.id, [id], '界'.repeat(501)), /500/);
  assert.deepEqual(await runtime.attach(task.id, Array(101).fill(id), '😀'.repeat(500)), { requested: 1, attached: 1, existing: 0 });
});

test('detach removes only membership and source, retains global identity and historical intent/finding anchors', async t => {
  const { store, task, other, runtime, insert } = await fixture(t);
  const intent = await store.addIntent({ taskId: task.id, summary: 'Worker target', input: {} });
  const [id] = await insert([{ type: 'ip', ip: '192.0.2.20' }], task.id, { ownerIntentId: intent.id });
  await runtime.attach(other.id, [id], '共享目标');
  const finding = await store.addFinding({ taskId: task.id, vulnClass: 'Fixture', severity: 'low', summary: '历史证据', status: 'pending', evidenceIds: [], assetIds: [id] });
  const before = store.snapshot(), key = assetKey(before.assets.find(asset => asset.id === id));
  assert.deepEqual(await runtime.detach(task.id, id), { detached: id });
  const after = store.snapshot(), retained = after.assets.find(asset => asset.id === id);
  assert.ok(retained); assert.equal(assetKey(retained), key); assert.equal(retained.taskId, other.id);
  assert.deepEqual(assetTaskIds(retained), [other.id]);
  assert.equal(assetRow(retained, task.id).task_source, undefined);
  assert.deepEqual(after.edges, before.edges); assert.deepEqual(after.findings, before.findings);
  assert.equal(runtime.intentAssets(task.id).assets[0].source, 'anchor');
  assert.equal(runtime.refs(task.id, id).findings[0].id, finding.id);
  await assert.rejects(runtime.detach(task.id, id), error => error.status === 404);
  await runtime.detach(other.id, id);
  assert.equal(store.snapshot().assets.find(asset => asset.id === id).taskId, 'global');
});

test('provenance updates preserve an omitted source node, manual reattach clears it, and deleted source nodes are absent from views', async t => {
  const { store, task, runtime, insert } = await fixture(t);
  const intent = await store.addIntent({ taskId: task.id, summary: '目标', input: {} });
  const [id] = await insert([{ type: 'ip', ip: '192.0.2.30' }], task.id, { ownerIntentId: intent.id });
  await store.addNode({ id: 'source-fact', taskId: task.id, kind: 'fact', label: '来源证据', data: {} });
  await runtime.setSource(task.id, id, { source: ' WORKER ', sourceSummary: '  来源输出  ', sourceNodeId: 'source-fact' });
  await runtime.setSource(task.id, id, { source: '', sourceSummary: '继续说明' });
  let row = runtime.intentAssets(task.id).assets[0];
  assert.equal(row.source, 'system'); assert.equal(row.source_node_id, 'source-fact'); assert.equal(row.source_summary, '继续说明');
  await store.transaction(state => { state.nodes = state.nodes.filter(node => node.id !== 'source-fact'); });
  row = runtime.intentAssets(task.id).assets[0];
  assert.equal(row.source_node_id, undefined); assert.equal(row.source_summary, '继续说明');
  await runtime.attach(task.id, [id], '人工来源替换');
  assert.equal(assetRow(store.snapshot().assets.find(asset => asset.id === id), task.id).task_source_node_id, undefined);
  await assert.rejects(runtime.setSource(task.id, 'missing', { source: 'worker', sourceSummary: '输出' }), error => error.status === 400);
});

test('intent assets and refs include direct source terminal intents and facts but exclude live and indirect source intents', async t => {
  const { store, task, other: source, runtime, insert } = await fixture(t);
  const grand = await store.createTask('间接来源', '只读范围');
  const [id] = await insert([{ type: 'ip', ip: '192.0.2.40' }]);
  await store.transaction(state => {
    state.tasks.find(row => row.id === task.id).sourceTaskIds = [source.id];
    state.tasks.find(row => row.id === source.id).sourceTaskIds = [grand.id];
  });
  const own = await store.addIntent({ taskId: task.id, summary: '本地运行中', state: 'running', input: { asset_ids: [id] } });
  const done = await store.addIntent({ taskId: source.id, summary: '来源已完成', state: 'done', input: { assetIds: [id] } });
  const blocked = await store.addIntent({ taskId: source.id, summary: '来源阻塞终态', state: 'blocked', input: { asset_ids: [id] } });
  await store.addIntent({ taskId: source.id, summary: '来源尚在运行', state: 'running', input: { asset_ids: [id] } });
  await store.addIntent({ taskId: grand.id, summary: '间接来源完成', state: 'done', input: { asset_ids: [id] } });
  await runtime.attach(source.id, [id], '来源任务目标');
  await runtime.setSource(source.id, id, { source: 'agent', sourceSummary: '来源 Worker 登记', sourceNodeId: done.id });
  await store.addNode({ id: 'source-fact', taskId: source.id, kind: 'fact', label: '来源事实', data: { asset_ids: [id], summary: '记录的事实' } });
  await store.addEdge({ taskId: task.id, from: own.id, to: id, relation: 'anchors' });
  await store.addEdge({ taskId: task.id, from: own.id, to: id, relation: 'mentions' });
  const refs = runtime.refs(task.id, id), targets = runtime.intentAssets(task.id).assets;
  assert.deepEqual(new Set(refs.intents.map(row => row.id)), new Set([own.id, done.id, blocked.id]));
  assert.equal(refs.facts[0].source_task_id, source.id); assert.equal(refs.facts[0].inherited, true);
  assert.equal(refs.facts[0].summary, '记录的事实');
  assert.equal(targets.length, 3); assert.equal(targets[0].intent_id, own.id); assert.equal(targets[0].inherited, false);
  assert.ok(targets.filter(row => row.inherited).every(row => row.source_task_id === source.id));
  assert.ok(targets.filter(row => row.inherited).every(row => row.source === 'agent' && row.source_summary === '来源 Worker 登记' && row.source_node_id === done.id));
  assert.deepEqual(runtime.refs(task.id, 'missing'), { intents: [], facts: [], findings: [] });
  assert.throws(() => runtime.intentAssets('missing'), error => error.status === 404);
});

test('atomic task scope registration reuses global keys, persists all scope kinds and counts idempotent repeats', async t => {
  const { store, task, other, runtime, insert } = await fixture(t);
  const [rootId, ipId] = await insert([{ type: 'root_domain', domain: 'example.com' }, { type: 'ip', ip: '192.0.2.50' }], other.id);
  const input = [{ kind: 'domain', value: 'EXAMPLE.com' }, { kind: 'ip', value: '192.0.2.50' }, { kind: 'cidr', value: '198.51.100.0/24' },
    { kind: 'icp', value: ' 京 ICP 备 123 号 ' }, { kind: 'keyword', value: ' Acme   Security ' }];
  const first = await runtime.registerScopes(task.id, input);
  assert.deepEqual(first, { requested: 5, assets_linked: 2, assets_existing: 0, scopes_added: 5, scopes_existing: 0 });
  assert.deepEqual(store.snapshot().assets.map(asset => asset.id), [rootId, ipId]);
  const scopes = store.snapshot().scopes.filter(row => row.taskId === task.id);
  assert.deepEqual(new Map(scopes.map(row => [row.kind, row.value])), new Map([
    ['root_domain', 'example.com'], ['ip', '192.0.2.50/32'], ['cidr', '198.51.100.0/24'], ['icp', '京icp备123号'], ['keyword', 'acme security'],
  ]));
  assert.deepEqual(await runtime.registerScopes(task.id, input), { requested: 5, assets_linked: 0, assets_existing: 2, scopes_added: 0, scopes_existing: 5 });
  for (const asset of store.snapshot().assets) {
    assert.deepEqual(new Set(assetTaskIds(asset)), new Set([task.id, other.id]));
    assert.equal(assetRow(asset, task.id).task_source, 'manual');
  }
});

test('invalid or policy-blocked scope rolls back the complete request including previously staged assets', async t => {
  const { store, task, runtime } = await fixture(t), before = store.snapshot();
  await assert.rejects(runtime.registerScopes(task.id, [{ kind: 'domain', value: 'example.com' }, { kind: 'cidr', value: '10.0.0.0/8' }]), error => error.status === 400);
  assert.deepEqual(store.snapshot(), before);
  await assert.rejects(runtime.registerScopes(task.id, [{ kind: 'domain', value: 'example.com' }, { kind: 'domain', value: 'example.gov' }]), /禁止|拦截/);
  assert.deepEqual(store.snapshot(), before);
  await assert.rejects(runtime.registerScopes(task.id, []), /scope is required/);
});

test('scope registration attributes new assets while preserving legacy explicit company ownership', async t => {
  const { store, task, runtime, insert } = await fixture(t);
  const legacy = await store.addCompany({ name: '历史指定公司' });
  const scoped = await store.addCompany({ name: '范围归属公司' });
  await store.addScope({ taskId: 'global', companyId: scoped.id, kind: 'root_domain', value: 'example.com', source: 'human' });
  await store.addScope({ taskId: 'global', companyId: scoped.id, kind: 'cidr', value: '192.0.2.0/24', source: 'human' });
  const [legacyId] = await insert([{ type: 'root_domain', domain: 'example.com' }]);
  await store.transaction(state => {
    const asset = state.assets.find(row => row.id === legacyId);
    asset.companyId = legacy.id;
    delete asset.metadata.company_source;
  });
  assert.deepEqual(await runtime.registerScopes(task.id, [
    { kind: 'domain', value: 'example.com' }, { kind: 'ip', value: '192.0.2.60' },
    { kind: 'domain', value: 'new.example.org' }, { kind: 'ip', value: '192.0.2.60' },
  ]), { requested: 4, assets_linked: 3, assets_existing: 1, scopes_added: 3, scopes_existing: 1 });
  const assets = store.snapshot().assets;
  assert.equal(assets.length, 3);
  const retained = assets.find(row => row.id === legacyId);
  assert.equal(retained.companyId, legacy.id);
  assert.equal(retained.metadata.company_source, undefined);
  const ip = assets.find(row => row.kind === 'ip');
  assert.equal(ip.companyId, scoped.id); assert.equal(ip.metadata.company_source, 'scope');
  assert.deepEqual(assetTaskIds(ip), [task.id]);
  assert.ok(assets.some(row => row.kind === 'root_domain' && row.value === 'new.example.org'));
});
