import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { build } from 'esbuild';

// Keep tests on current sources without racing the host's shared lib/ compilation.
const built = await build({ stdin: { contents: "export { RedTeamStore } from './src/store.ts'; export { GraphCompactor, GraphRuntime, createDshDigestProvider } from './src/graph-tools/index.ts'; export { blockSignature } from './src/graph-tools/coldgraph.ts'; export { nodeFingerprint } from './src/graph-tools/digest-state.ts';", resolveDir: process.cwd(), loader: 'ts' }, bundle: true, write: false, platform: 'node', format: 'esm', packages: 'external' });
const code = built.outputFiles[0].text.replace(/from\s+(["'])([^"']+)\1/g, (_match, _quote, specifier) => `from ${JSON.stringify(import.meta.resolve(specifier))}`);
const { RedTeamStore, GraphCompactor, GraphRuntime, createDshDigestProvider, blockSignature, nodeFingerprint } = await import(`data:text/javascript;base64,${Buffer.from(code + '\n//# sourceURL=graph-tools-compaction-tests.bundle.mjs').toString('base64')}`);

function deferred() { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; }
async function fixture(t, count = 20, options = {}) {
  const dir = await mkdtemp(join(tmpdir(), 'dsh-compaction-')); const store = new RedTeamStore(join(dir, 'state.json')); await store.load();
  const task = await store.createManagedTask({ title: 'compaction fixture' });
  await store.transaction(state => {
    for (let i = 0; i < count; i++) {
      state.nodes.push({ id: `f${i}`, taskId: task.id, kind: 'fact', label: `observed result ${i}`, data: { confidence: i % 2 ? 'inferred' : 'observed', state: 'confirmed' } });
      if (i) state.edges.push({ id: `e${i}`, taskId: task.id, from: `f${i - 1}`, to: `f${i}`, relation: 'derived_from' });
    }
  });
  const calls = [];
  const compactor = new GraphCompactor(store, { provider: { generate: async input => { calls.push(input); return 'Combined observed and inferred conclusion (#f0,#f1).'; } }, ...options });
  t.after(async () => { await compactor.dispose(); await rm(dir, { recursive: true, force: true }); });
  return { store, taskId: task.id, compactor, graph: new GraphRuntime(store), calls };
}
async function cool(compactor, taskId, rounds = 7) { let result; for (let i = 0; i < rounds; i++) result = await compactor.onPlannerRound(taskId); return result; }
function digests(store, taskId) { return store.snapshot().nodes.filter(node => node.taskId === taskId && node.data.kind === 'digest'); }

test('six complete cold rounds gate real background generation; body, provenance, versions and covers commit together', async t => {
  const { store, taskId, compactor, calls, graph } = await fixture(t);
  await cool(compactor, taskId, 6); assert.equal(calls.length, 0);
  const round = await compactor.onPlannerRound(taskId); assert.equal(round.round, 7); assert.equal(round.started, true);
  await compactor.waitForIdle(taskId);
  assert.equal(calls.length, 1); assert.equal(calls[0].members.length, 20); assert.equal(calls[0].edges.length, 19);
  assert.equal(calls[0].members[1].confidence, 'inferred');
  const [digest] = digests(store, taskId); assert.equal(digest.data.generation, 1); assert.equal(digest.data.state, 'active');
  assert.equal(graph.expandDigest(taskId, digest.id).members.length, 20);
  assert.equal(graph.overview(taskId).cold_digests[0].body, digest.data.body);
  const disk = JSON.parse(await readFile(store.storagePath, 'utf8'));
  assert.equal(disk.tasks.find(task => task.id === taskId).graphCompaction.round, 7);
  assert.equal(disk.edges.filter(edge => edge.from === digest.id && edge.relation === 'covers').length, 20);
  assert.equal(disk.nodes.find(node => node.id === 'f0').data.cold_since_round, 1);
  assert.equal(disk.nodes.find(node => node.id === 'f0').data.content_version, 0);
});

test('editing folded content restores it in overview immediately and supersedes digest plus covers atomically next round', async t => {
  const { store, taskId, compactor, graph } = await fixture(t); await cool(compactor, taskId); await compactor.waitForIdle(taskId);
  const [digest] = digests(store, taskId);
  await store.transaction(state => { state.nodes.find(node => node.id === 'f19').label = 'corrected evidence'; });
  assert.equal(graph.overview(taskId).cold_digests, undefined);
  assert.ok(graph.overview(taskId).recent_facts.some(node => node.id === 'f19'));
  await compactor.onPlannerRound(taskId);
  const snapshot = store.snapshot(); assert.equal(snapshot.nodes.find(node => node.id === digest.id).data.state, 'superseded');
  assert.equal(snapshot.edges.some(edge => edge.from === digest.id && edge.relation === 'covers'), false);
  assert.equal(snapshot.nodes.find(node => node.id === 'f19').data.content_version, 1);
  assert.equal(graph.expandDigest(taskId, digest.id).body, digest.data.body);
});

test('in-flight edits reject stale model output, task lock spans instances, and cooldown starts at completion', async t => {
  const started = deferred(), release = deferred(); let now = 0, count = 0;
  const provider = { async generate() { count++; started.resolve(); await release.promise; return 'outdated conclusion'; } };
  const { store, taskId, compactor } = await fixture(t, 20, { provider, now: () => now });
  const second = new GraphCompactor(new RedTeamStore(store.storagePath), { provider, now: () => now }); t.after(() => second.dispose());
  await cool(compactor, taskId); await started.promise;
  assert.equal((await second.onPlannerRound(taskId)).started, false);
  await store.transaction(state => { state.nodes.find(node => node.id === 'f0').label = 'changed during request'; });
  now = 10_000; release.resolve(); await compactor.waitForIdle(taskId);
  assert.equal(digests(store, taskId).length, 0); assert.equal(count, 1);
  now = 69_999; assert.equal((await compactor.onPlannerRound(taskId)).started, false);
  now = 70_000; assert.equal((await second.onPlannerRound(taskId)).started, true); await second.waitForIdle(taskId);
  assert.equal(count, 2); assert.equal(digests(store, taskId).length, 1);
});

test('new live descendants during generation revive ancestors and prevent cold folding', async t => {
  const started = deferred(), release = deferred();
  const { store, taskId, compactor } = await fixture(t, 20, { provider: { async generate() { started.resolve(); await release.promise; return 'now hot'; } } });
  await cool(compactor, taskId); await started.promise;
  const live = await store.addIntent({ taskId, summary: 'revisit results', input: {} });
  await store.transaction(state => state.edges.push({ id: 'revive', taskId, from: 'f19', to: live.id, relation: 'derived_from' }));
  release.resolve(); await compactor.waitForIdle(taskId); assert.equal(digests(store, taskId).length, 0);
  await compactor.onPlannerRound(taskId);
  assert.equal(store.snapshot().nodes.find(node => node.id === 'f0').data.cold_since_round, undefined);
});

test('DSH claimed intents keep their ancestor chain hot while the worker is being started', async t => {
  const { store, taskId, compactor, calls } = await fixture(t);
  const claimed = await store.addIntent({ taskId, summary: 'starting worker', input: {}, state: 'claimed' });
  await store.transaction(state => state.edges.push({ id: 'claimed-parent', taskId, from: 'f19', to: claimed.id, relation: 'derived_from' }));
  const round = await cool(compactor, taskId); assert.equal(round.started, false); assert.equal(calls.length, 0);
  assert.equal(store.snapshot().nodes.find(node => node.id === 'f0').data.cold_since_round, undefined);
});

test('major rebuild reads original nodes, supersedes old coverage, and advances overlapping generation', async t => {
  const { store, taskId, compactor, calls } = await fixture(t, 16);
  await store.transaction(state => {
    for (let i = 0; i < 8; i++) {
      state.nodes.push({ id: `d${i}`, taskId, kind: 'fact', label: 'old compressed body', data: { kind: 'digest', state: 'active', body: 'old body', generation: i === 0 ? 3 : 1, signature: `old-${i}`,
        member_ids: { facts: [`f${i * 2}`, `f${i * 2 + 1}`], intents: [] }, ...(i === 0 ? { source_fingerprints: { f0: nodeFingerprint(state.nodes.find(node => node.id === 'f0')) } } : {}) } });
      for (const to of [`f${i * 2}`, `f${i * 2 + 1}`]) state.edges.push({ id: `cover-${to}`, taskId, from: `d${i}`, to, relation: 'covers' });
    }
  });
  await store.transaction(state => { state.nodes.find(node => node.id === 'f0').label = 'observed result corrected'; });
  // Original compactor's major trigger can run before debounce: make the fixture already cold.
  await store.transaction(state => { state.tasks.find(task => task.id === taskId).graphCompaction = { round: 6 }; for (const node of state.nodes) if (node.id.startsWith('f')) node.data.cold_since_round = 1; });
  assert.equal((await compactor.onPlannerRound(taskId)).started, true); await compactor.waitForIdle(taskId);
  assert.equal(calls.length, 1); assert.equal(calls[0].members.length, 16); assert.ok(calls[0].members.every(node => node.summary.startsWith('observed result')));
  const all = digests(store, taskId); assert.equal(all.filter(node => node.data.state === 'superseded').length, 8);
  assert.equal(all.find(node => node.data.state === 'active').data.generation, 4);
  assert.equal(store.snapshot().edges.filter(edge => edge.relation === 'covers').length, 16);
});

test('major unchanged signatures reuse bodies without a model call', async t => {
  const { store, taskId, compactor, calls } = await fixture(t, 16);
  await store.transaction(state => {
    state.edges = state.edges.filter(edge => edge.taskId !== taskId);
    state.tasks.find(task => task.id === taskId).graphCompaction = { round: 6 };
    for (let i = 0; i < 8; i++) {
      const members = [`f${i * 2}`, `f${i * 2 + 1}`];
      state.edges.push({ id: `pair${i}`, taskId, from: members[0], to: members[1], relation: 'yields' });
      state.nodes.push({ id: `d${i}`, taskId, kind: 'fact', label: 'retained', data: { kind: 'digest', state: 'active', body: 'retained', generation: 1, signature: blockSignature({ members, anchors: [] }, new Map()) } });
      for (const to of members) { state.nodes.find(node => node.id === to).data.cold_since_round = 1; state.edges.push({ id: `c${to}`, taskId, from: `d${i}`, to, relation: 'covers' }); }
    }
  });
  await compactor.onPlannerRound(taskId); await compactor.waitForIdle(taskId);
  assert.equal(calls.length, 0); assert.equal(digests(store, taskId).filter(node => node.data.state === 'active').length, 8);
});

test('empty provider failures remain observable and never create digest; dispose aborts a noncooperative request', async t => {
  const errors = [];
  const { store, taskId, compactor } = await fixture(t, 20, { provider: { generate: async () => '  ' }, onError: (id, error) => errors.push({ id, error }) });
  await cool(compactor, taskId); await assert.rejects(compactor.waitForIdle(taskId), /empty body/);
  assert.equal(digests(store, taskId).length, 0); assert.equal(errors[0].id, taskId);
  assert.ok(store.snapshot().traces.some(trace => trace.worker === 'compactor' && trace.kind === 'error' && /empty body/.test(trace.data.error)));
  const other = await fixture(t, 20, { provider: { generate: () => new Promise(() => {}) } });
  await cool(other.compactor, other.taskId); await other.compactor.dispose(); assert.equal(digests(other.store, other.taskId).length, 0);
});

test('DSH provider sends real route, summary-only input and 1500-token request; incomplete streams fail', async () => {
  const input = { taskId: 'task', members: [{ id: 'f0', kind: 'fact', state: 'confirmed', summary: 'observed', confidence: 'observed' }], edges: [], anchors: [] };
  const requests = [], signal = new AbortController().signal;
  const provider = createDshDigestProvider({ async *stream(request) { requests.push(request); yield { type: 'text-delta', index: 0, text: ' conclusion #f0 ' }; yield { type: 'finish', reason: { kind: 'stop' } }; } }, () => ({ provider: 'configured', model: 'parent-model' }));
  assert.equal(await provider.generate(input, signal), 'conclusion #f0'); assert.equal(requests[0].maxTokens, 1500); assert.equal(requests[0].model, 'parent-model');
  assert.deepEqual(JSON.parse(requests[0].messages[0].content[0].text), input); assert.equal(requests[0].signal, signal);
  const incomplete = createDshDigestProvider({ async *stream() { yield { type: 'text-delta', index: 0, text: 'partial' }; } }, () => ({ provider: 'configured', model: 'parent-model' }));
  await assert.rejects(incomplete.generate(input, signal), /without finish/);
  const limited = createDshDigestProvider({ async *stream() { yield { type: 'text-delta', index: 0, text: 'partial' }; yield { type: 'finish', reason: { kind: 'length' } }; } }, () => ({ provider: 'configured', model: 'parent-model' }));
  await assert.rejects(limited.generate(input, signal), /did not complete/);
});

test('a failed block does not stop independent later blocks from committing', async t => {
  const { store, taskId, compactor } = await fixture(t, 20, { provider: { async generate(input) {
    if (input.members.some(member => member.id === 'f0')) throw new Error('first component unavailable');
    return 'second component conclusion';
  } } });
  await store.transaction(state => { state.edges = state.edges.filter(edge => edge.id !== 'e10'); });
  await cool(compactor, taskId);
  await assert.rejects(compactor.waitForIdle(taskId), /first component unavailable/);
  const [digest] = digests(store, taskId); assert.equal(digest.data.body, 'second component conclusion');
  assert.deepEqual(digest.data.member_ids.facts, Array.from({ length: 10 }, (_, i) => `f${i + 10}`));
});

test('disposing a queued major transaction preserves existing digest states and coverage', async t => {
  const { store, taskId, compactor } = await fixture(t, 16);
  await store.transaction(state => {
    state.tasks.find(task => task.id === taskId).graphCompaction = { round: 6 };
    for (const node of state.nodes) if (node.id.startsWith('f')) node.data.cold_since_round = 1;
    for (let i = 0; i < 8; i++) {
      state.nodes.push({ id: `d${i}`, taskId, kind: 'fact', label: 'old', data: { kind: 'digest', state: 'active', body: 'old', generation: 1, signature: `old${i}` } });
      for (const to of [`f${i * 2}`, `f${i * 2 + 1}`]) state.edges.push({ id: `c-${to}`, taskId, from: `d${i}`, to, relation: 'covers' });
    }
  });
  const entered = deferred(), release = deferred(), transaction = store.transaction.bind(store); let calls = 0;
  // Hold only the storage boundary; the real transaction and compactor logic still execute.
  store.transaction = async mutator => { if (++calls === 2) { entered.resolve(); await release.promise; } return transaction(mutator); };
  await compactor.onPlannerRound(taskId); await entered.promise;
  const disposed = compactor.dispose(); release.resolve(); await disposed;
  assert.equal(digests(store, taskId).filter(node => node.data.state === 'active').length, 8);
  assert.equal(store.snapshot().edges.filter(edge => edge.relation === 'covers').length, 16);
});

test('content retirement retains generation ancestry across cooldown and incremental rebuilding', async t => {
  let now = 0;
  const { store, taskId, compactor } = await fixture(t, 20, { now: () => now });
  await cool(compactor, taskId); await compactor.waitForIdle(taskId);
  await store.transaction(state => {
    state.nodes.find(node => node.data.kind === 'digest').data.generation = 3;
    state.nodes.find(node => node.id === 'f0').label = 'revised source';
  });
  assert.equal((await compactor.onPlannerRound(taskId)).started, false);
  assert.equal(digests(store, taskId)[0].data.state, 'superseded');
  now = 60_000; assert.equal((await compactor.onPlannerRound(taskId)).started, true); await compactor.waitForIdle(taskId);
  assert.equal(digests(store, taskId).find(node => node.data.state === 'active').data.generation, 4);
});
