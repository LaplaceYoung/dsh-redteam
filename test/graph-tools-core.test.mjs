import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { RedTeamStore } from '../lib/store.js';
import { GraphRuntime, GraphAssetRuntime, installGraphTools } from '../lib/graph-tools/index.js';

async function fixture(t, options = {}) {
  const dir = await mkdtemp(join(tmpdir(), 'dsh-graph-core-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const store = new RedTeamStore(join(dir, 'state.json')); await store.load();
  const ancestor = await store.createManagedTask({ title: 'ancestor' });
  const source = await store.createManagedTask({ title: 'source', sourceTaskIds: [ancestor.id] });
  const current = await store.createManagedTask({ title: 'current', sourceTaskIds: [source.id] });
  const graph = new GraphRuntime(store, options), tools = new Map();
  const dispose = installGraphTools({ tools: { register(tool) { assert.equal(tools.has(tool.name), false); tools.set(tool.name, tool); return () => tools.delete(tool.name); } } }, store, options);
  t.after(dispose);
  return { store, graph, ancestor, source, current, tools, call: (name, args, exec) => tools.get(name).execute(args, exec) };
}

test('fact batches preserve order, reject inherited intent writes and commit real lineage', async t => {
  const { store, graph, current, source } = await fixture(t);
  const local = await store.addIntent({ taskId: current.id, summary: 'local work', input: {} });
  const inherited = await store.addIntent({ taskId: source.id, summary: 'source work', input: {}, state: 'done' });
  const asset = await store.addAsset({ taskId: current.id, kind: 'domain', value: 'example.test', source: 'user', metadata: {} });
  const result = await graph.recordFact(current.id, { intent_id: local.id, facts: [
    { summary: 'A', detail: 'full detail', evidence: ' command output ', confidence: ' observed ', asset_ids: [asset.id, asset.id] },
    { summary: 'B', intent_id: inherited.id }, { summary: '   ' }, { summary: 'D' },
  ] });
  assert.equal(result.ids.length, 4); assert.equal(result.ids[1], 0); assert.equal(result.ids[2], 0);
  assert.match(result.errors['1'], /只读/); assert.match(result.errors['2'], /summary/);
  const disk = JSON.parse(await readFile(store.storagePath, 'utf8'));
  const first = disk.nodes.find(node => node.id === result.ids[0]);
  assert.deepEqual(first.data.asset_ids, [asset.id]); assert.equal(first.data.evidence, 'command output'); assert.equal(first.data.confidence, 'observed');
  assert.equal(disk.edges.filter(edge => edge.relation === 'yields' && edge.from === local.id).length, 2);
  assert.equal(graph.nodeDetail(current.id, first.id).payload.detail, 'full detail');
  const before = store.snapshot();
  await assert.rejects(graph.recordFact(current.id, { summary: 'bad', intent_id: inherited.id }), /只读/);
  assert.deepEqual(store.snapshot(), before);
});

test('facts use stable newest-first cursors, filtered total, 160 codepoint summaries and direct sources only', async t => {
  const { graph, current, source, ancestor } = await fixture(t);
  await graph.recordFact(ancestor.id, { summary: 'match transitive secret' });
  const first = await graph.recordFact(source.id, { summary: 'MATCH first' });
  const second = await graph.recordFact(current.id, { summary: 'match ' + '😀'.repeat(170) });
  const third = await graph.recordFact(source.id, { summary: 'match newest' });
  await graph.addHint(current.id, { text: 'match hint must be separate' });
  const page = graph.listFacts(current.id, { q: ' match ', limit: 2 });
  assert.equal(page.total, 3); assert.equal(page.has_more, true); assert.equal(page.next_before, second.id);
  assert.deepEqual(page.facts.map(row => row.id), [third.id, second.id]);
  assert.equal(page.facts[0].source_task_id, source.id); assert.equal(page.facts[0].inherited, true);
  assert.equal(Array.from(page.facts[1].summary).length, 161); assert.equal(page.facts[1].summary_truncated, true);
  const older = graph.listFacts(current.id, { q: 'match', before: page.next_before, limit: 2 });
  assert.deepEqual(older.facts.map(row => row.id), [first.id]); assert.equal(older.total, 3); assert.equal(older.has_more, false);
  assert.equal('next_before' in older, false);
  assert.equal(graph.listFacts(current.id, { q: 'MATCH%FIRST' }).total, 1, 'ARTEX fact search uses SQL ILIKE patterns');
  assert.throws(() => graph.listFacts(current.id, { before: 'missing' }), /cursor/);
});

test('hint batches enforce traffic setting, normalize refs and wake exactly once after durable commit', async t => {
  let enabled = false; const calls = [];
  const { store, graph, current } = await fixture(t, { trafficBindingEnabled: () => enabled, notifyHint: (taskId, texts) => { assert.ok(store.snapshot().nodes.some(node => node.label === texts[0])); calls.push({ taskId, texts }); } });
  const denied = await graph.addHint(current.id, { hints: [{ text: 'with traffic', traffic_refs: [{ traffic_id: 't' }] }, { text: 'valid' }] });
  assert.equal(denied.ids[0], 0); assert.equal(calls.length, 1); assert.deepEqual(calls[0].texts, ['valid']);
  enabled = true;
  const added = await graph.addHint(current.id, { text: 'Look here', traffic_refs: [{ traffic_id: '  traffic-a ' }, { traffic_id: 'traffic-a', role: 'proof' }, { traffic_id: 'traffic-b', role: 'verification' }] });
  assert.deepEqual(graph.nodeDetail(current.id, added.id).payload.traffic_refs, [{ traffic_id: 'traffic-a', role: 'supporting', note: '' }, { traffic_id: 'traffic-b', role: 'verification', note: '' }]);
  assert.equal(graph.nodeDetail(current.id, added.id).kind, 'hint');
  assert.equal(graph.listFacts(current.id, { q: 'Look here' }).total, 0);
  assert.ok(graph.overview(current.id).hints.some(hint => hint.id === added.id));
  assert.equal(calls.length, 2);
  await assert.rejects(graph.addHint(current.id, { text: 'bad role', traffic_refs: [{ traffic_id: 't', role: 'bogus' }] }), /用途/);
  assert.equal(calls.length, 2);
});

test('node detail and graph overview exclude live source intents and transitive tasks; source frontier never becomes local', async t => {
  const { store, graph, current, source, ancestor } = await fixture(t);
  const live = await store.addIntent({ taskId: source.id, summary: 'PRIVATE LIVE', state: 'running', input: {} });
  const done = await store.addIntent({ taskId: source.id, summary: 'historical', state: 'done', input: {} });
  const ancient = await graph.recordFact(ancestor.id, { summary: 'TRANSITIVE SECRET' });
  const fact = await graph.recordFact(source.id, { summary: 'source conclusion', intent_id: live.id });
  const currentIntent = await store.addIntent({ taskId: current.id, summary: 'current open', input: {} });
  assert.throws(() => graph.nodeDetail(current.id, live.id), /未找到/);
  assert.throws(() => graph.nodeDetail(current.id, ancient.id), /未找到/);
  assert.equal(graph.nodeDetail(current.id, done.id).inherited, true);
  const overview = graph.overview(current.id);
  assert.deepEqual(overview.open_intents.map(row => row.id), [currentIntent.id]);
  assert.equal(overview.related_tasks.length, 1);
  assert.equal(overview.related_tasks[0].source_task_id, source.id);
  assert.equal(JSON.stringify(overview).includes('PRIVATE LIVE'), false); assert.equal(JSON.stringify(overview).includes('TRANSITIVE SECRET'), false);
  assert.equal(overview.related_tasks[0].recent_facts.find(row => row.id === fact.id).from_intent, undefined);
  const read = graph.nodeDetail(current.id, fact.id); read.payload.summary = 'mutated copy';
  assert.equal(graph.nodeDetail(current.id, fact.id).payload.summary, 'source conclusion');
});

test('overview caps open intents by priority and carries producing relationships', async t => {
  const { store, graph, current } = await fixture(t);
  const ids = [];
  for (let index = 0; index < 32; index++) ids.push((await store.addIntent({ taskId: current.id, summary: `work ${index}`, input: { priority: index } })).id);
  const fact = await graph.recordFact(current.id, { summary: 'conclusion', intent_id: ids[0] });
  await store.addEdge({ taskId: current.id, from: fact.id, to: ids[31], relation: 'derived_from' });
  const result = graph.overview(current.id);
  assert.equal(result.frontier_open, 32); assert.equal(result.open_intents.length, 30);
  assert.equal(result.open_intents[0].id, ids[31]); assert.deepEqual(result.open_intents[0].parents, [fact.id]);
  assert.equal(result.recent_facts.find(row => row.id === fact.id).from_intent, ids[0]);
});

test('digest reads restore persisted members and hot causal ancestors reappear in overview', async t => {
  const { store, graph, current } = await fixture(t);
  const fact = await graph.recordFact(current.id, { summary: 'foldable fact' });
  await store.addNode({ id: 'digest-one', taskId: current.id, kind: 'fact', label: 'digest', data: { kind: 'digest', state: 'active', body: 'condensed conclusion' } });
  await store.addEdge({ taskId: current.id, from: 'digest-one', to: fact.id, relation: 'covers' });
  let result = graph.overview(current.id);
  assert.equal(result.recent_facts.some(row => row.id === fact.id), false);
  assert.deepEqual(result.cold_digests, [{ id: 'digest-one', body: 'condensed conclusion', member_count: 1 }]);
  assert.equal(graph.expandDigest(current.id, 'digest-one').members[0].summary, 'foldable fact');
  const live = await store.addIntent({ taskId: current.id, summary: 'new live work', input: {} });
  await store.addEdge({ taskId: current.id, from: fact.id, to: live.id, relation: 'derived_from' });
  result = graph.overview(current.id); assert.equal(result.recent_facts.some(row => row.id === fact.id), true);
});

test('real defineTool schema dispatch and native worker task binding reject cross-task calls', async t => {
  const mutations = [];
  const { store, current, source, call, tools } = await fixture(t, { onMutation: (taskId, toolName) => mutations.push({ taskId, toolName }) });
  const worker = await store.addIntent({ taskId: current.id, summary: 'bound work', input: {}, state: 'running', worker: 'child', execution: { childSessionId: 'child', parentSessionId: 'parent', provider: 'spawn' } });
  const exec = { agent: { id: 'child' }, signal: new AbortController().signal };
  const written = await call('redteam_record_fact', { summary: 'real tool body', intent_id: worker.id }, exec);
  assert.ok(store.snapshot().nodes.some(row => row.id === written.id));
  assert.deepEqual(mutations, [{ taskId: current.id, toolName: 'redteam_record_fact' }]);
  await call('redteam_record_fact', { facts: [{ summary: ' ' }] }, exec);
  assert.equal(mutations.length, 1, 'failed batch must not trigger Planner mutation notification');
  await assert.rejects(call('redteam_node_detail', { task_id: source.id, id: written.id }, exec), /different task/);
  await assert.rejects(call('redteam_add_hint', { task_id: source.id, text: 'cannot mutate source' }, exec), /different task/);
  assert.equal((await call('redteam_list_facts', { q: 'real tool body' }, exec)).total, 1);
  await store.transaction(state => { state.traces.push({ id: '17', taskId: current.id, intentId: worker.id, worker: 'child', kind: 'tool', summary: 'legacy step', data: { detail: 'full step' }, createdAt: '2026-01-01T00:00:00Z' }); });
  const steps = await call('redteam_get_worker_trace', { intent_id: worker.id, step_ids: [0, -1, 17, 17] }, exec);
  assert.deepEqual(steps.returned_step_ids, ['17']); assert.equal(steps.steps[0].detail, 'full step');
  await assert.rejects(call('redteam_graph_overview', {}), /task_id/);
  await assert.rejects(call('redteam_list_facts', { task_id: current.id, limit: 1.5 }), /integer|schema/i);
  assert.ok(tools.has('redteam_get_task_graph')); assert.ok(tools.has('redteam_get_task_worker_trace')); assert.ok(tools.has('redteam_insert_assets'));
  const global = await call('redteam_insert_assets', { assets: [{ type: 'root_domain', domain: 'global.test' }] });
  const globalAsset = (await call('redteam_list_assets', { id: global.results[0].id })).assets[0];
  assert.deepEqual(globalAsset.task_ids, []); assert.equal(store.snapshot().scopes.some(scope => scope.taskId === 'global' && scope.value === 'global.test'), false);
  await assert.rejects(call('redteam_list_assets', { task_id: 'global', id: globalAsset.id }, exec), /different task/);
});

test('finding reads retain severity, lineage, full evidence and source provenance', async t => {
  const { store, graph, current, source } = await fixture(t);
  const intent = await store.addIntent({ taskId: source.id, summary: 'finished work', state: 'done', input: {} });
  const finding = await store.addFinding({ taskId: source.id, summary: 'verified sample', vulnClass: 'config', severity: 'medium', status: 'verified', evidenceIds: [], assetIds: [] });
  await store.transaction(state => { state.findings.find(row => row.id === finding.id).trafficBindings = [{ id: 'binding', role: 'proof', note: 'fixture', position: 0, createdAt: '2026-01-01', snapshot: { id: 'snapshot', sourceTrafficId: 'traffic-17', url: 'https://example.test/', method: 'GET', capturedAt: '2026-01-01', createdAt: '2026-01-01', request: { head: '', bodyBase64: '', sha256: '', length: 0 }, response: { head: '', bodyBase64: '', sha256: '', length: 0 } } }]; });
  await store.addEdge({ taskId: source.id, from: intent.id, to: finding.id, relation: 'yields' });
  const rows = graph.listFindings(current.id);
  assert.equal(rows[0].intent_id, intent.id); assert.equal(rows[0].vulnclass, 'config'); assert.equal(rows[0].task_id, source.id); assert.equal(rows[0].inherited, true);
  assert.equal(rows[0].traffic_count, 1);
  assert.deepEqual(graph.listFindings(current.id, { severity: 'critical' }), []);
  assert.equal(graph.nodeDetail(current.id, finding.id).payload.status, 'verified');
  assert.deepEqual(graph.nodeDetail(current.id, finding.id).traffic_ids, ['traffic-17']);
});

test('overview coverage uses scoped asset membership and 0..1 ratio without transitive source inheritance', async t => {
  const { store, graph, current, source, ancestor } = await fixture(t);
  const assets = new GraphAssetRuntime(store);
  await assets.insertAssets(ancestor.id, [{ type: 'root_domain', domain: 'ancestor.test' }]);
  const added = await assets.insertAssets(source.id, [{ type: 'root_domain', domain: 'source.test' }]);
  await assets.insertAssets(current.id, [{ type: 'root_domain', domain: 'current.test' }]);
  await graph.recordFact(source.id, { summary: 'tested source', asset_ids: [added.results[0].id] });
  const result = graph.overview(current.id);
  assert.equal(result.coverage.denominator, 2); assert.equal(result.coverage.tested, 1); assert.equal(result.coverage.pct, 0.5);
  assert.equal(result.related_tasks[0].asset_coverage.denominator, 1);
  await store.transaction(state => { state.tasks.find(task => task.id === current.id).coverageEnabled = false; });
  assert.deepEqual(Object.keys(graph.overview(current.id).coverage), ['host_count']);
});
