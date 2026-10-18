import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { RedTeamStore } from '../lib/store.js';
import { GraphAssetRuntime, normalizeAsset, normalizeAssetURL, scopedAssets } from '../lib/graph-tools/assets.js';

async function fixture(t) {
  const directory = await mkdtemp(join(tmpdir(), 'graph-assets-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const store = new RedTeamStore(join(directory, 'store.json')); await store.load();
  const task = await store.createTask('asset contracts', 'local fixture only');
  return { store, task, runtime: new GraphAssetRuntime(store) };
}
const rowBy = (store, id) => store.snapshot().assets.find(row => row.id === id);

test('ARTEX normalizeURL independent examples preserve port, path and query spelling', () => {
  for (const [raw, expected] of [
    ['HTTPS://Example.COM/path', 'https://example.com/path'],
    ['http://example.com/', 'http://example.com'],
    ['http://example.com/page', 'http://example.com/page'],
    ['HTTP://Example.COM:80/a/../B?q=2&q=1', 'http://example.com:80/a/../B?q=2&q=1'],
    ['https://User:Pass@EXAMPLE.COM/?a=1', 'https://User:Pass@example.com/?a=1'],
  ]) assert.equal(normalizeAssetURL(raw), expected);
  assert.equal(normalizeAsset({ type: 'subdomain', domain: ' APP.Example.CO.UK. ' }).metadata.root_domain, 'example.co.uk');
  assert.equal(normalizeAsset({ type: 'ip', ip: '2001:db8:abcd:1::10' }).metadata.c_segment, '2001:db8:abcd::/48');
  assert.equal(normalizeAsset({ type: 'ip', ip: '192.0.2.199' }).metadata.c_segment, '192.0.2.0/24');
});

test('insert_assets persists mixed successes, rejects invalid input per item and deduplicates natural keys', async t => {
  const { store, task, runtime } = await fixture(t);
  const inserted = await runtime.insertAssets(task.id, [
    { type: 'root_domain', domain: ' Example.COM. ', icp: '备案A' },
    { type: 'ip', ip: 'hostname.invalid' },
    { type: 'root_domain', domain: 'example.com', icp: '' },
    { type: 'root_domain', domain: 42 },
    null,
    { type: 'service', ip: '192.0.2.2', port: 22, service_name: ' SSH ' },
    { type: 'service', ip: '192.0.2.2', port: 22, service_name: 'ssh' },
  ]);
  assert.deepEqual(inserted.errors.map(e => e.index), [1, 3, 4]);
  assert.match(inserted.errors[0].error, /IPv4\/IPv6/);
  assert.equal(inserted.results[0].id, inserted.results[1].id);
  assert.equal(inserted.results[2].id, inserted.results[3].id);
  assert.equal(rowBy(store, inserted.results[0].id).metadata.icp, '备案A');
  const persisted = JSON.parse(await readFile(store.storagePath, 'utf8'));
  assert.equal(persisted.assets.filter(a => a.kind === 'service').length, 1);
  assert.deepEqual(persisted.assets.find(a => a.kind === 'ip').metadata.open_ports, [{ port: 22, service: 'ssh' }]);
});

test('DNS A/AAAA expands valid comma-separated addresses; explicit input alone creates scope', async t => {
  const { store, task, runtime } = await fixture(t);
  const result = await runtime.insertAssets(task.id, [{ type: 'subdomain', domain: 'WWW.Example.com.', record_type: 'A', record_value: ['192.0.2.7, bad,192.0.2.8', '192.0.2.7'] }]);
  assert.deepEqual(result.errors, []);
  assert.equal(rowBy(store, result.results[0].id).metadata.ip, '192.0.2.7');
  assert.deepEqual(store.snapshot().assets.filter(a => a.kind === 'ip').map(a => a.value), ['192.0.2.7', '192.0.2.8']);
  assert.equal(store.snapshot().assets.filter(a => a.kind === 'root_domain').length, 1);
  assert.deepEqual(store.snapshot().assets.map(a => a.kind), ['root_domain', 'ip', 'ip', 'subdomain'], 'ARTEX creates derived root/IP rows before the subdomain sequence ID');
  assert.deepEqual(store.snapshot().scopes.map(s => [s.kind, s.value]), [['subdomain', 'www.example.com']]);
  assert.deepEqual(runtime.listAssets(task.id, { dsl: 'example.com' }).assets.map(a => a.type), ['subdomain']);
});

test('HTTP enrichments merge technology/auth, endpoint params and app bundle identity', async t => {
  const { store, task, runtime } = await fixture(t);
  const first = await runtime.insertAssets(task.id, [
    { type: 'service', url: 'HTTPS://Api.Example.com/', service_ip: '192.0.2.5', technologies: ['Nginx'], auth: [{ type: 'basic', username: 'alice' }], status_code: 200 },
    { type: 'endpoint', url: 'https://api.example.com/login', method: 'get', service_ip: '192.0.2.5', params: [{ location: 'query', name: 'q', value: 'a' }] },
    { type: 'app', app_name: 'Old name', bundle_id: 'com.example.app' },
  ]);
  const second = await runtime.insertAssets(task.id, [
    { type: 'service', url: 'https://api.example.com', technologies: ['Nginx', 'Vue'], auth: [{ username: 'alice', type: 'basic' }], status_code: 404 },
    { type: 'endpoint', url: 'https://api.example.com/login', method: 'GET', params: [{ name: 'q', value: 'z', location: 'query' }, { name: 'q', location: 'header', value: 'h' }] },
    { type: 'app', app_name: 'New name', bundle_id: 'com.example.app' },
  ]);
  assert.deepEqual(first.results.map(r => r.id), second.results.map(r => r.id));
  const service = rowBy(store, first.results[0].id).metadata;
  assert.deepEqual(service.technologies, ['Nginx', 'Vue']); assert.equal(service.auth.length, 1); assert.equal(service.status_code, 404); assert.equal(service.ip, '192.0.2.5');
  assert.deepEqual(rowBy(store, first.results[1].id).metadata.params, [{ name: 'q', location: 'header', value: 'h' }, { name: 'q', value: 'z', location: 'query' }]);
  assert.equal(rowBy(store, first.results[2].id).value, 'New name');
});

test('ARTEX gate runs on original supplied candidates; blocked assets have no derived writes or scope', async t => {
  const { store, task, runtime } = await fixture(t);
  await store.transaction(state => state.taskAssetRules.push({ id: 'allow', taskId: task.id, action: 'allow', enabled: true, kind: 'exact_domain', pattern: 'example.com', note: '', createdAt: '', updatedAt: '' }));
  const before = store.snapshot();
  const result = await runtime.insertAssets(task.id, [{ type: 'service', url: 'https://api.example.com/' }, { type: 'service', url: 'https://example.gov/' }]);
  assert.equal(result.errors.length, 2); assert.equal(result.results.length, 0);
  assert.deepEqual(store.snapshot().assets, before.assets); assert.deepEqual(store.snapshot().scopes, before.scopes);
  assert.match(result.errors[0].error, /白名单/); assert.match(result.errors[1].error, /拦截/);
});

test('ARTEX scope membership fixture: foreign producer, direct source scope, IP host and excluded transitive sources', async t => {
  const { store, task, runtime } = await fixture(t);
  const source = await store.createTask('source', ''), transitive = await store.createTask('transitive', ''), foreign = await store.createTask('foreign producer', '');
  await store.transaction(state => {
    state.tasks.find(t => t.id === task.id).sourceTaskIds = [source.id];
    state.tasks.find(t => t.id === source.id).sourceTaskIds = [transitive.id];
    for (const [owner, kind, value] of [[task.id, 'root_domain', 'example.com'], [source.id, 'root_domain', 'source.net'], [transitive.id, 'root_domain', 'hidden.org'], [task.id, 'cidr', '198.51.100.0/24']]) state.scopes.push({ id: `${owner}-${kind}`, taskId: owner, kind, value, source: 'agent', createdAt: '' });
    for (const [id, domain, root, url] of [['local', 'api.example.com', 'example.com', 'https://api.example.com/marker'], ['source', 'api.source.net', 'source.net', 'https://api.source.net/marker'], ['ip-host', '198.51.100.9', '198.51.100.9', 'http://198.51.100.9/marker'], ['transitive', 'api.hidden.org', 'hidden.org', 'https://api.hidden.org/marker'], ['outside', 'other.org', 'other.org', 'https://other.org/marker']]) state.assets.push({ id, taskId: foreign.id, kind: 'service', value: url, source: 'worker', metadata: { domain, root_domain: root, url, service_type: 'http' }, createdAt: '2026-01-01T00:00:00Z' });
  });
  const before = store.snapshot();
  assert.deepEqual(runtime.listAssets(task.id, { dsl: 'marker' }).assets.map(a => a.id), ['ip-host', 'source', 'local']);
  assert.deepEqual(runtime.listAssets(task.id, { ids: ['outside', 'transitive', 'local'], limit: 1 }).assets.map(a => a.id), ['local']);
  assert.equal(runtime.coverage(task.id).denominator, 2); // coverage CTE does not use IP-literal host arm
  assert.equal(runtime.coverage(source.id, false).denominator, 1);
  assert.equal(runtime.coverage(source.id).denominator, 2);
  assert.deepEqual(store.snapshot(), before);
});

test('DSL respects AND precedence, grouping, exact case, ILIKE wildcards, aliases and limits', async t => {
  const { store, task, runtime } = await fixture(t);
  await runtime.insertAssets(task.id, [
    { type: 'service', url: 'http://a.example.com', page_title: 'Login Portal', status_code: 200, technologies: ['Nginx'] },
    { type: 'service', url: 'https://b.example.com', page_title: 'Admin', status_code: 404, technologies: ['Shiro'] },
    { type: 'service', url: 'https://c.example.com', page_title: 'Login Test', status_code: 500, technologies: ['Nginx'] },
  ]);
  const query = dsl => runtime.listAssets(task.id, { dsl, type: 'service', limit: 100 }).assets.map(a => a.domain).sort();
  assert.deepEqual(query('port==80 OR status_code>=400 AND technology==Nginx'), ['a.example.com', 'c.example.com']);
  assert.deepEqual(query('(port==80 OR status_code>=400) AND technology=shiro'), ['b.example.com']);
  assert.deepEqual(query('title="Login P_r%"'), ['a.example.com']);
  assert.deepEqual(query('technology==nginx'), []);
  assert.deepEqual(query('page_title!=login'), ['b.example.com']);
  assert.deepEqual(query('tech!=Nginx'), ['b.example.com']);
  assert.throws(() => query('status=bad'), /整数/);
  assert.throws(() => query('domain>foo'), /不支持/);
  assert.throws(() => query('(port==80'), /右括号/);
  assert.throws(() => query('port==80 status==200'), /AND\/OR/);
  assert.throws(() => runtime.listAssets(task.id, { type: 'service' }), /dsl 不能为空/);
  await store.transaction(state => { for (const asset of state.assets) asset.metadata.last_seen = '2026-01-01'; });
  const all = runtime.listAssets(task.id, { dsl: 'example.com', type: 'service', limit: 10 }).assets;
  assert.deepEqual(runtime.listAssets(task.id, { dsl: 'example.com', type: 'service', limit: 1, offset: 1 }).assets.map(a => a.id), [all[1].id]);
});

test('untested assets union graph anchors and exclude only current/direct-source facts; hints remain untested', async t => {
  const { store, task, runtime } = await fixture(t);
  const source = await store.createTask('source', ''), transitive = await store.createTask('grandparent', '');
  const inserted = await runtime.insertAssets(task.id, [{ type: 'app', app_name: 'Anchored app' }, { type: 'app', app_name: 'Hint app' }, { type: 'app', app_name: 'Grandparent fact app' }]);
  const [a, b, c] = inserted.results.map(r => r.id);
  await store.transaction(state => {
    state.tasks.find(t => t.id === task.id).sourceTaskIds = [source.id];
    state.tasks.find(t => t.id === source.id).sourceTaskIds = [transitive.id];
    state.nodes.push(
      { id: 'tested', taskId: source.id, kind: 'fact', label: 'tested', data: { asset_ids: [a] } },
      { id: 'hint', taskId: task.id, kind: 'fact', label: 'hint', data: { hint: true, asset_ids: [b] } },
      { id: 'intent', taskId: task.id, kind: 'intent', label: 'anchor', data: { asset_ids: [c] } },
      { id: 'grandfact', taskId: transitive.id, kind: 'fact', label: 'not inherited', data: { asset_ids: [c] } },
      { id: 'digest', taskId: task.id, kind: 'fact', label: 'digest is not tested evidence', data: { kind: 'digest', asset_ids: [b, c] } },
    );
  });
  assert.deepEqual(runtime.listUntestedAssets(task.id, { page_size: 1 }).assets.map(a => a.id), [b]);
  assert.deepEqual(runtime.listUntestedAssets(task.id, { page: 2, page_size: 1 }).assets.map(a => a.id), [c]);
  assert.equal(runtime.listUntestedAssets(task.id).total, 2);
  assert.deepEqual(runtime.coverage(task.id).by_type, [{ type: 'app', total: 3, tested: 1 }]);
  assert.equal(runtime.coverage(task.id).pct, 1 / 3);
  assert.equal(scopedAssets(store.snapshot(), task.id).length, 0); // list_assets scope does not union anchors
});

test('worker insert anchors the owner intent, preserves provenance, and rejects source-owned intents', async t => {
  const { store, task, runtime } = await fixture(t);
  const other = await store.createTask('source task', '');
  const own = await store.addIntent({ taskId: task.id, summary: 'Discover apps', state: 'running', input: {} });
  const foreign = await store.addIntent({ taskId: other.id, summary: 'Source work', state: 'done', input: {} });
  const result = await runtime.insertAssets(task.id, [{ type: 'app', app_name: 'Owner app' }], { ownerIntentId: own.id });
  const id = result.results[0].id;
  assert.deepEqual(store.snapshot().intents.find(i => i.id === own.id).input.asset_ids, [id]);
  assert.deepEqual(store.snapshot().nodes.find(n => n.id === own.id).data.asset_ids, [id]);
  assert.ok(store.snapshot().edges.some(e => e.from === own.id && e.to === id && e.relation === 'anchors'));
  assert.equal(runtime.listUntestedAssets(task.id).assets[0].id, id);
  assert.equal(rowBy(store, id).metadata.task_sources[0].node_id, own.id);
  const before = store.snapshot();
  await assert.rejects(runtime.insertAssets(task.id, [{ type: 'app', app_name: 'Wrong owner' }], { ownerIntentId: foreign.id }), /current task/);
  assert.deepEqual(store.snapshot(), before);
});

test('shared assets accumulate task memberships while task source metadata remains local', async t => {
  const { store, task, runtime } = await fixture(t);
  const other = await store.createTask('second', '');
  const first = await runtime.insertAssets(task.id, [{ type: 'root_domain', domain: 'example.com' }]);
  await store.transaction(state => { state.tasks.find(t => t.id === other.id).sourceTaskIds = [task.id]; });
  const inherited = runtime.listAssets(other.id, { id: first.results[0].id }).assets[0];
  assert.equal(inherited.task_source, undefined);
  const second = await runtime.insertAssets(other.id, [{ type: 'root_domain', domain: 'EXAMPLE.com', icp: 'New' }]);
  assert.equal(first.results[0].id, second.results[0].id);
  assert.deepEqual(new Set(runtime.listAssets(other.id, { id: first.results[0].id }).assets[0].task_ids), new Set([task.id, other.id]));
  assert.equal(runtime.listAssets(task.id, { id: first.results[0].id }).assets[0].task_source, 'agent');
});

test('neighbor query is read-only and cannot expose unrelated assets by ID', async t => {
  const { store, task, runtime } = await fixture(t), foreign = await store.createTask('other', '');
  const own = await runtime.insertAssets(task.id, [{ type: 'root_domain', domain: 'example.com' }, { type: 'service', url: 'https://api.example.com' }]);
  const outside = await runtime.insertAssets(foreign.id, [{ type: 'root_domain', domain: 'other.org' }]);
  const before = store.snapshot();
  const result = runtime.assetNeighbors(task.id, { id: own.results[0].id, limit: 1 });
  assert.equal(result.total, 2); assert.equal(result.assets.length, 1);
  assert.throws(() => runtime.assetNeighbors(task.id, { id: outside.results[0].id }), /scope/);
  assert.deepEqual(store.snapshot(), before);
});

test('company scope attribution prefers domain then narrower network then exact normalized ICP', async t => {
  const { store, task, runtime } = await fixture(t);
  const domainCompany = await store.addCompany({ name: 'Domain' }), ipCompany = await store.addCompany({ name: 'Network' }), icpCompany = await store.addCompany({ name: 'ICP' });
  for (const [companyId, kind, value] of [[domainCompany.id, 'root_domain', 'example.com'], [ipCompany.id, 'cidr', '192.0.2.0/24'], [icpCompany.id, 'icp', '备案abc']]) await store.addScope({ taskId: 'global', companyId, kind, value, source: 'human' });
  const result = await runtime.insertAssets(task.id, [
    { type: 'service', url: 'https://api.example.com', service_ip: '192.0.2.8' },
    { type: 'ip', ip: '192.0.2.9' },
    { type: 'app', app_name: 'App', app_icp: '备 案 ABC' },
    { type: 'app', app_name: 'Explicit', app_icp: '备案abc', company_id: domainCompany.id },
  ]);
  assert.deepEqual(result.errors, []);
  assert.deepEqual(result.results.map(r => rowBy(store, r.id).companyId), [domainCompany.id, ipCompany.id, icpCompany.id, domainCompany.id]);
  const again = await runtime.insertAssets(task.id, [{ type: 'app', app_name: 'Explicit', app_icp: '备案abc' }]);
  assert.equal(rowBy(store, again.results[0].id).companyId, domainCompany.id);
  await store.transaction(state => { state.companies.push({ id: '17', name: 'Imported company', createdAt: '2026-01-01', updatedAt: '2026-01-01' }); });
  const imported = await runtime.insertAssets(task.id, [{ type: 'app', app_name: 'Numeric company ID', company_id: 17 }]);
  assert.equal(rowBy(store, imported.results[0].id).companyId, '17');
});
