import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { build } from 'esbuild';
const built = await build({ stdin: { contents: "export {CompanyManagementRuntime,parseCompanyScopeInputs,attributedCompanyForAsset} from './src/asset-management/companies.ts'; export {RedTeamStore} from './src/store.ts';", resolveDir: process.cwd(), loader: 'ts' }, bundle: true, write: false, platform: 'node', format: 'esm', packages: 'external' });
const code = built.outputFiles[0].text.replace(/from\s+(["'])([^"']+)\1/g, (_m, _q, name) => `from ${JSON.stringify(import.meta.resolve(name))}`);
const { CompanyManagementRuntime, parseCompanyScopeInputs, attributedCompanyForAsset, RedTeamStore } = await import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`);
async function fixture(t) {
  const dir = await mkdtemp(join(tmpdir(), 'company-domain-')), path = join(dir, 'store.json');
  t.after(() => rm(dir, { recursive: true, force: true }));
  const store = new RedTeamStore(path); await store.load();
  return { store, companies: new CompanyManagementRuntime(store), path };
}
function asset(id, kind, metadata, companyId) { return { id, kind, value: metadata.domain ?? metadata.ip ?? metadata.app_name ?? id, metadata, taskId: 'global', source: 'user', createdAt: '2026-10-18T00:00:00Z', ...(companyId ? { companyId } : {}) }; }

test('scope parser follows ARTEX URL/IDNA, network masking, exact domain, ICP and keyword normalization', () => {
  const result = parseCompanyScopeInputs(['HTTPS://Sub.Example.COM.:443/path', { kind: 'domain', value: '例子.公司.cn' }, '192.0.2.123/24', '192.0.2.5', '2001:db8:abcd::5/48', '2001:db8::1', ' 京 ICP 备 123号 ', '  ACME   SECURITY ', 'example.com', 'example.com']);
  assert.equal(result.invalid, 0);
  assert.deepEqual(result.rules.map(row => [row.kind, row.value]), [
    ['domain', 'sub.example.com'], ['domain', 'xn--fsqu00a.xn--55qx5d.cn'], ['cidr', '192.0.2.0/24'], ['ip', '192.0.2.5/32'], ['cidr', '2001:db8:abcd::/48'], ['ip', '2001:db8::1/128'], ['icp', '京icp备123号'], ['keyword', 'acme security'], ['domain', 'example.com'], ['domain', 'example.com'],
  ]);
  const bad = parseCompanyScopeInputs(['999.0.0.1', '192.0.2.1/99', '10.0.0.0/8', '2001:db8::/16', 'com', 'co.uk', { kind: 'domain', value: '127.0.0.1' }, { kind: 'unsupported', value: 'x' }, 'bad_.example.com']);
  assert.equal(bad.invalid, 8); assert.deepEqual(bad.rules.map(row => [row.kind, row.value]), [['keyword', 'com']]);
  assert.throws(() => parseCompanyScopeInputs(['中'.repeat(1025)]), error => error.status === 400);
  assert.throws(() => parseCompanyScopeInputs([{ value: 12 }]), error => error.status === 400);
  assert.equal(parseCompanyScopeInputs(Array.from({ length: 1200 }, () => 'example.com')).rules.length, 1200);
  assert.throws(() => parseCompanyScopeInputs([{ kind: 'keyword', value: 'İ'.repeat(1024) }]), error => error.status === 400);
});

test('company creation is atomic, normalizes duplicate names, retains partial scope feedback and persisted logo', async t => {
  const { store, companies, path } = await fixture(t);
  const result = await companies.create({ name: '  Acme   Group  ', logo: 'https://logo.test/a.svg', scope: ['example.com', 'EXAMPLE.COM', '192.0.2.1', '192.0.2.1/32', '10.0.0.0/8'] });
  assert.equal(result.created, true); assert.equal(result.scope_added, 2); assert.equal(result.scope_skipped, 2); assert.equal(result.scope_invalid, 1);
  assert.equal(companies.get(result.id).company.logo, 'https://logo.test/a.svg');
  assert.equal(companies.get(result.id).scope.length, 2);
  const before = store.snapshot();
  await assert.rejects(companies.create({ name: 'acme group', scope: ['different.example'] }), error => error.status === 409);
  assert.deepEqual(store.snapshot(), before); assert.deepEqual(JSON.parse(await readFile(path, 'utf8')), before);
  await assert.rejects(companies.create({ name: '', scope: [] }), error => error.status === 400);
  const raced = await Promise.allSettled([companies.create({ name: 'Race' }), companies.create({ name: 'RACE' })]);
  assert.equal(raced.filter(row => row.status === 'fulfilled').length, 1);
  assert.equal(companies.list().length, 2);
});

test('scope attribution precedence is domain, longest network, then exact ICP; explicit and legacy assignments remain', async t => {
  const { store, companies } = await fixture(t);
  const wide = await companies.create({ name: 'Network', scope: ['192.0.0.0/16', '2001:db8::/32'] });
  const narrow = await companies.create({ name: 'Specific network', scope: ['192.0.2.0/24', '2001:db8:1::/48'] });
  const domain = await companies.create({ name: 'Domain', scope: ['example.com'] });
  const icp = await companies.create({ name: 'ICP', scope: [{ kind: 'icp', value: '京 ICP 备123' }, { kind: 'keyword', value: 'Never auto match' }] });
  await store.transaction(state => state.assets.push(
    asset('both', 'service', { root_domain: 'example.com', ip: '192.0.2.10', icp: '京ICP备123' }),
    asset('ip', 'ip', { ip: '192.0.2.10' }), asset('ip6', 'ip', { ip: '2001:db8:1::2' }),
    asset('app', 'app', { app_name: 'App', app_icp: ' 京 ICP备123 ' }),
    asset('explicit', 'service', { root_domain: 'example.com', company_source: 'explicit' }, wide.id),
    asset('legacy', 'service', { root_domain: 'example.com' }, wide.id),
    asset('keyword', 'app', { app_name: 'Never auto match' }),
    asset('bad-ip', 'ip', { ip: 'not-an-ip' }),
  ));
  const result = await companies.reattribute(), byId = id => store.snapshot().assets.find(row => row.id === id);
  assert.equal(result.updated, 4); assert.match(result.warnings[0], /bad-ip/);
  assert.equal(byId('both').companyId, domain.id); assert.equal(byId('ip').companyId, narrow.id); assert.equal(byId('ip6').companyId, narrow.id);
  assert.equal(byId('app').companyId, icp.id); assert.equal(byId('explicit').companyId, wide.id); assert.equal(byId('legacy').companyId, wide.id); assert.equal(byId('keyword').companyId, undefined);
  assert.equal(byId('both').metadata.company_source, 'scope');
  assert.equal(companies.list().find(row => row.id === wide.id).asset_count, 2);
  await companies.scope(domain.id, { scope: [], reset: true });
  assert.equal(byId('both').companyId, narrow.id, 'removing higher-precedence scope exposes network match');
  assert.equal(byId('explicit').companyId, wide.id);
  assert.equal(attributedCompanyForAsset(store.snapshot(), asset('ip-only', 'ip', { ip: '192.0.8.1' })), wide.id);
  const warningOnly = await companies.scope(icp.id, { scope: ['Another descriptive keyword'] });
  assert.equal(warningOnly.invalid, 0); assert.match(warningOnly.warnings[0], /bad-ip/);
});

test('scope reset rejects invalid replacements before mutation, and empty replacement clears automatic ownership', async t => {
  const { store, companies, path } = await fixture(t);
  const company = await companies.create({ name: 'Scope', scope: ['example.com'] });
  await store.transaction(state => state.assets.push(asset('domain', 'root_domain', { root_domain: 'example.com', domain: 'example.com' })));
  await companies.reattribute(); const before = store.snapshot();
  await assert.rejects(companies.scope(company.id, { reset: true, scope: ['valid.example', '10.0.0.0/8'] }), /未覆盖原有范围/);
  assert.deepEqual(store.snapshot(), before); assert.deepEqual(JSON.parse(await readFile(path, 'utf8')), before);
  const partial = await companies.scope(company.id, { scope: ['second.example', '10.0.0.0/8'], reason: 'manual' });
  assert.equal(partial.added, 1); assert.equal(partial.invalid, 1); assert.equal(companies.get(company.id).scope.length, 2);
  await companies.scope(company.id, { reset: true, scope: [] });
  assert.equal(store.snapshot().assets[0].companyId, undefined); assert.deepEqual(companies.get(company.id).scope, []);
  await assert.rejects(companies.scope('missing', { scope: [] }), error => error.status === 404);
});

test('delete without assets detaches explicit ownership, reattributes, and removes live task company references', async t => {
  const { store, companies } = await fixture(t);
  const first = await companies.create({ name: 'Deleted', scope: ['example.com'] }), remaining = await companies.create({ name: 'Remaining', scope: ['example.com'] });
  const task = await store.createManagedTask({ title: 'Company task', description: 'Scope refs', goal: 'Test company cascade', companyIds: [first.id] });
  await store.transaction(state => { state.assets.push(asset('owned', 'root_domain', { domain: 'example.com', root_domain: 'example.com', company_source: 'explicit' }, first.id)); state.scopes.push({ id: 'task-company', taskId: task.id, kind: 'company', value: first.id, companyId: first.id, source: 'human', createdAt: task.createdAt }); });
  const result = await companies.delete(first.id, false);
  assert.equal(result.deleted, 1); assert.equal(result.assets_deleted, 0);
  assert.equal(store.snapshot().assets.find(row => row.id === 'owned').companyId, remaining.id);
  assert.deepEqual(store.snapshot().tasks.find(row => row.id === task.id).companyIds, []);
  assert.ok(store.snapshot().scopes.every(scope => scope.companyId !== first.id));
  assert.throws(() => companies.get(first.id), error => error.status === 404);
  const before = store.snapshot(); await assert.rejects(companies.delete(first.id, true), error => error.status === 404); assert.deepEqual(store.snapshot(), before);
});

test('delete_assets shares asset cascade while retaining finding evidence and unrelated global assets', async t => {
  const { store, companies } = await fixture(t), company = await companies.create({ name: 'Delete assets' });
  const task = await store.createTask('Evidence task', 'Retain history');
  await store.transaction(state => state.assets.push(asset('remove', 'ip', { ip: '192.0.2.8', company_source: 'explicit' }, company.id), asset('keep', 'ip', { ip: '198.51.100.8' })));
  const intent = await store.addIntent({ taskId: task.id, summary: 'Uses owned asset', input: { assetIds: ['remove', 'keep'] } });
  const finding = await store.addFinding({ taskId: task.id, vulnClass: 'test', severity: 'low', summary: 'Historical evidence', status: 'open', assetIds: ['remove'], evidenceIds: [] });
  const result = await companies.delete(company.id, true), state = store.snapshot();
  assert.equal(result.assets_deleted, 1); assert.deepEqual(state.assets.map(row => row.id), ['keep']);
  assert.deepEqual(state.intents.find(row => row.id === intent.id).input.assetIds, ['keep']);
  assert.deepEqual(state.findings.find(row => row.id === finding.id).assetIds, ['remove']);
});

test('ScopeSentry upsert reuses normalized company identity and atomically adds scopes with source reasons', async t => {
  const { store, companies } = await fixture(t);
  const original = await companies.create({ name: ' Sync Company ', logo: 'original-logo' });
  await store.transaction(state => state.assets.push(asset('synced', 'root_domain', { domain: 'sync.example', root_domain: 'sync.example' })));
  const result = await companies.upsertFromSync({ name: 'sync   company', roots: ['sync.example', 'sync.example'], source: 'scopesentry:project:1' });
  assert.equal(result.id, original.id); assert.equal(result.created, false); assert.equal(result.added, 1); assert.equal(result.skipped, 1);
  assert.equal(companies.get(result.id).company.logo, 'original-logo');
  assert.equal(companies.get(result.id).scope[0].reason, 'scopesentry:project:1');
  assert.equal(store.snapshot().assets[0].companyId, original.id);
});
