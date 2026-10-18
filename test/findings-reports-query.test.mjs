import test from 'node:test';
import assert from 'node:assert/strict';
import {
  filterFindings, listFindingsPage, listFindingGroups, findingStats,
  listFindingVulnClasses, buildFindingAssetTree, findingLineage,
} from '../lib/findings-reports/query.js';

const stamp = '2026-10-18T00:00:00Z';
const finding = (id, patch = {}) => ({ id, taskId: 't1', vulnClass: 'SQLi', severity: 'high', summary: 'proof',
  evidenceIds: [], assetIds: [], status: 'pending', createdAt: stamp, ...patch });
const task = (id, patch = {}) => ({ id, title: `Task ${id}`, description: `Description ${id}`, goal: 'goal', status: 'running', createdAt: stamp, updatedAt: stamp, ...patch });
const asset = (id, kind, value, metadata = {}, companyId) => ({ id, taskId: 't1', kind, value, metadata, companyId, source: 'user', createdAt: stamp });
const snapshot = (patch = {}) => ({ tasks: [task('t1')], findings: [], assets: [], companies: [], nodes: [], edges: [], ...patch });

test('finding list uses literal case-insensitive search across title/class/summary/evidence/report and composed filters', () => {
  const state = snapshot({ findings: [
    finding('1', { name: 'Upper %_\\ title', status: 'confirmed', assetIds: ['present'] }),
    finding('2', { evidence: { reproduction: 'Special TOKEN' }, severity: 'critical' }),
    finding('3', { report: '# SPECIAL token', severity: 'low', taskId: 'deleted' }),
    finding('4', { summary: 'separate', vulnClass: 'XSS', status: 'fixed', taskId: '' }),
  ], assets: [asset('present', 'ip', '127.0.0.1')] });
  assert.deepEqual(filterFindings(state, { query: '  %_\\  ' }).map(f => f.id), ['1']);
  assert.deepEqual(filterFindings(state, { query: 'special token' }).map(f => f.id), ['3', '2']);
  assert.deepEqual(filterFindings(state, { query: 'sqli', status: 'confirmed', severity: 'high', taskId: 't1', assetScope: 'a:present' }).map(f => f.id), ['1']);
  assert.deepEqual(filterFindings(state, { taskId: '__unassigned__' }).map(f => f.id), ['4', '3']);
  assert.equal(filterFindings(state, { taskId: 'missing' }).length, 0);
  assert.equal(filterFindings(state, { severity: 'all', status: 'all', vulnClass: 'all', taskId: 'all' }).length, 4);
  state.findings[2].trafficBindings = [{ id: 'binding', snapshot: { request: { bodyBase64: 'bGFyZ2U=' } } }];
  state.findings[2].retests = [{ id: 'retest', findingId: '3', status: 'done', notes: '', createdAt: stamp,
    snapshot: { finding: { ...state.findings[2] }, assets: [], constraints: [] } }];
  const listed = listFindingsPage(state, { query: 'SPECIAL token' }).items[0];
  assert.equal(listed.id, '3'); assert.equal(listed.report, undefined); assert.equal(listed.trafficBindings, undefined);
  assert.equal(listed.trafficCount, 1); assert.equal(listed.taskDescription, '');
  assert.equal(Object.hasOwn(listed, 'retests'), false);
  assert.equal(filterFindings(state, { query: 'SPECIAL token' })[0].report, '# SPECIAL token');
  assert.equal(state.findings[2].retests[0].snapshot.finding.report, '# SPECIAL token');
  assert.equal(state.findings[2].retests[0].snapshot.finding.trafficBindings[0].id, 'binding');
});

test('finding pagination applies defaults and cap, stable severity/time/id order and out-of-range pages', () => {
  const state = snapshot({ findings: Array.from({ length: 105 }, (_, i) => finding(String(i + 1), { severity: i === 0 ? 'critical' : 'high' })) });
  const first = listFindingsPage(state);
  assert.equal(first.total, 105); assert.equal(first.items.length, 20); assert.equal(first.items[0].id, '105');
  assert.equal(listFindingsPage(state, {}, 0, -2).pageSize, 20);
  assert.equal(listFindingsPage(state, {}, 1, 200).items.length, 100);
  assert.equal(listFindingsPage(state, {}, 2, 100).items.length, 5);
  assert.deepEqual(listFindingsPage(state, {}, Number.MAX_SAFE_INTEGER, 100).items, []);
  assert.equal(listFindingsPage(state, { sort: 'severity' }).items[0].id, '1');
  const timezone = snapshot({ findings: [finding('later', { createdAt: '2026-10-18T01:00:00Z' }), finding('earlier', { createdAt: '2026-10-18T08:00:00+08:00' })] });
  assert.deepEqual(filterFindings(timezone).map(f => f.id), ['later', 'earlier']);
});

test('task groups preserve exact finding total and merge deleted/absent tasks, with queued and terminal states', () => {
  const state = snapshot({ tasks: [task('t1', { queued: true }), task('t2', { status: 'done', queued: true })], findings: [
    finding('1'), finding('2', { taskId: 't2', severity: 'critical' }),
    finding('3', { taskId: 'gone', severity: 'medium' }), finding('4', { taskId: '', severity: 'low' }),
  ] });
  const groups = listFindingGroups(state, { sort: 'severity' }, 1, 1);
  assert.equal(groups.total, 3); assert.equal(groups.findingTotal, 4); assert.equal(groups.items[0].taskId, 't2');
  assert.equal(groups.items[0].taskStatus, 'done');
  assert.equal(listFindingGroups(state).items.find(g => g.taskId === 't1').taskStatus, 'queued');
  const unassigned = listFindingGroups(state).items.find(g => g.taskId === null);
  assert.equal(unassigned.count, 2); assert.equal(unassigned.medium, 1); assert.equal(unassigned.low, 1);
  assert.equal(listFindingGroups(state, {}, -1, 0).pageSize, 10);
  assert.equal(listFindingGroups(state, {}, 1, 1000).pageSize, 100);
  assert.deepEqual(listFindingGroups(state, {}, 1000).items, []);
});

test('stats and dynamic vuln-class catalog include supplied cold aggregates; task options do not inherit group pagination', () => {
  const state = snapshot({ tasks: Array.from({ length: 12 }, (_, i) => task(`t${i}`)),
    findings: Array.from({ length: 12 }, (_, i) => finding(String(i), { taskId: `t${i}`, vulnClass: i % 2 ? 'SQLi' : 'XSS', status: i === 0 ? 'open' : 'pending' })) });
  const cold = [{ total: 3, pending: 1, critical: 1, high: 0, medium: 2, low: 0, vulnClasses: ['IDOR', 'XSS'] }];
  const stats = findingStats(state, cold);
  assert.equal(stats.total, 15); assert.equal(stats.pending, 12); assert.equal(stats.high, 12); assert.equal(stats.critical, 1);
  assert.equal(stats.tasks.length, 12);
  assert.deepEqual(listFindingVulnClasses(state, cold), ['IDOR', 'SQLi', 'XSS']);
});

function treeFixture() {
  return snapshot({ companies: [{ id: 'c1', name: 'Example', createdAt: stamp, updatedAt: stamp }], assets: [
    asset('root', 'root_domain', 'example.com', {}, 'c1'),
    asset('sub', 'subdomain', 'api.example.com', { root_domain: 'example.com' }),
    asset('service', 'service', 'https://api.example.com', { domain: 'api.example.com', port: 443 }),
    asset('endpoint', 'endpoint', 'https://api.example.com/private'),
    asset('orphan', 'subdomain', 'api.other.com', { root_domain: 'other.com' }),
    asset('ip', 'ip', '127.0.0.1'), asset('smb', 'service', 'smb', { ip: '127.0.0.1', port: 445 }),
  ], findings: [
    finding('1', { assetIds: ['endpoint', 'sub'], severity: 'critical' }),
    finding('2', { assetIds: ['endpoint'], severity: 'high' }),
    finding('3', { assetIds: ['deleted'], severity: 'medium' }),
    finding('4', { assetIds: ['orphan'], severity: 'low' }),
    finding('5', { assetIds: ['smb'], severity: 'high' }),
  ] });
}

test('asset tree completes ancestors, de-duplicates common ancestors, synthesizes roots and preserves service ports', () => {
  const state = treeFixture(), tree = buildFindingAssetTree(state), nodes = new Map(tree.nodes.map(n => [n.key, n]));
  assert.equal(tree.findingTotal, 5);
  assert.equal(nodes.get('a:endpoint').parent, 'a:service');
  assert.equal(nodes.get('a:service').parent, 'a:sub');
  assert.equal(nodes.get('a:sub').parent, 'a:root');
  assert.equal(nodes.get('a:root').parent, 'c:c1');
  assert.equal(nodes.get('c:c1').total, 2); assert.equal(nodes.get('c:c1').critical, 1);
  assert.equal(nodes.get('a:sub').self, 1); assert.equal(nodes.get('a:sub').total, 2);
  assert.equal(nodes.get('a:orphan').parent, 'r:other.com');
  assert.equal(nodes.get('a:smb').label, '127.0.0.1:445');
  assert.equal(nodes.get('a:smb').parent, 'a:ip');
  assert.equal(tree.nodes.at(-1).key, '__none__'); assert.equal(nodes.get('__none__').self, 1);
  assert.deepEqual(filterFindings(state, { assetScope: 'c:c1' }).map(f => f.id), ['2', '1']);
  assert.deepEqual(filterFindings(state, { assetScope: 'r:other.com' }).map(f => f.id), ['4']);
  assert.deepEqual(filterFindings(state, { assetScope: '__none__' }).map(f => f.id), ['3']);
  assert.equal(filterFindings(state, { assetScope: 'a:deleted' }).length, 0);
});

test('tree ignores selected scope, respects other filters, and truncation retains counts without narrowing query scope', () => {
  const state = treeFixture();
  assert.equal(buildFindingAssetTree(state, { assetScope: 'a:endpoint' }).findingTotal, 5);
  const filtered = buildFindingAssetTree(state, { severity: 'critical' });
  assert.equal(filtered.findingTotal, 1); assert.equal(filtered.nodes.find(n => n.key === 'a:root').total, 1);
  assert.equal(filterFindings(state, { severity: 'critical', assetScope: 'r:other.com' }).length, 0);
  const truncated = buildFindingAssetTree(state, {}, 1);
  assert.equal(truncated.truncated, true); assert.deepEqual(truncated.droppedKinds, ['endpoint', 'service']);
  assert.equal(truncated.nodes.some(n => ['endpoint', 'service'].includes(n.kind)), false);
  assert.equal(truncated.nodes.find(n => n.key === 'c:c1').total, 2);
  assert.equal(filterFindings(state, { assetScope: 'a:service' }).length, 2);
});

test('lineage walks all reverse edges inside one task, handles cycles, legacy IDs and missing origins', () => {
  const nodes = ['1', '2', '3', '4'].map(id => ({ id, taskId: 't1', kind: id === '3' ? 'finding' : 'intent', label: id, data: {} }));
  const edge = (id, from, to, taskId = 't1') => ({ id, from, to, taskId, relation: 'derived_from' });
  const state = snapshot({ findings: [finding('f', { nodeId: '3' }), finding('4'), finding('gone', { taskId: 'deleted', nodeId: '3' }), finding('no-node')],
    nodes: [...nodes, { id: 'foreign', taskId: 't2', kind: 'intent', label: 'foreign', data: {} }],
    edges: [edge('a', '1', '2'), edge('b', '2', '3'), edge('c', '2', '1'), edge('d', '3', '4'), edge('e', 'foreign', '3', 't2')] });
  const lineage = findingLineage(state, 'f');
  assert.deepEqual(lineage.nodes.map(n => n.id), ['1', '2', '3']);
  assert.deepEqual(lineage.edges.map(e => e.id), ['a', 'b', 'c']);
  assert.equal(findingLineage(state, '4').nodes.length, 4);
  assert.deepEqual(findingLineage(state, 'gone'), { nodes: [], edges: [] });
  assert.deepEqual(findingLineage(state, 'no-node'), { nodes: [], edges: [] });
  assert.throws(() => findingLineage(state, 'missing'), { code: 'not_found' });
});
