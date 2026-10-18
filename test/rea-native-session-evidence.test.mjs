import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createSessionEvidence, InvestigationRecords, EvidenceLedger, inputSchemas, projectAnalysisError } from '../src/rea-native/session-evidence/runtime.mjs';

const fixture = (name) => fileURLToPath(new URL(`../src/rea-native/evidence/fixtures/${name}`, import.meta.url));
const bundlePath = fixture('bundle.json');
const reducedPath = fixture('reduced.json');
const bundle = JSON.parse(await readFile(bundlePath, 'utf8'));
const sample = bundle.records[0];
const target = { path: '/fixtures/program.bin', sha256: 'ab'.repeat(32), format: 'elf', architecture: 'x86_64' };
const value = (result) => { assert.equal(result.ok, true, result.error?.message); return result.value; };
const failure = (result, tag, reason) => { assert.equal(result.ok, false); assert.equal(result.error._tag, tag); if (reason) assert.equal(result.error.reason, reason); return result.error; };
const question = (overrides = {}) => ({ question: 'Does this artifact preserve the observed behavior?', domain: 'behavior', severity: 'medium', required_authority: 'shipped-artifact', required_confidence: 'observed', required_environment: null, recommended_probes: [], relationships: [], ...overrides });
const fullQuestion = (overrides = {}) => question({ supporting_evidence_ids: [], contradicting_evidence_ids: [], ...overrides });
function update(head, overrides = {}) {
  return { unknown_id: head.unknown_id, expected_revision: head.revision, status: head.status, severity: head.severity, supporting_evidence_ids: head.supporting_evidence_ids, contradicting_evidence_ids: head.contradicting_evidence_ids, required_authority: head.required_authority, required_confidence: head.required_confidence, required_environment: head.required_environment, recommended_probes: head.recommended_probes, relationships: head.relationships, resolution: head.resolution, ...overrides };
}
const invoke = async (runtime, operation, input = {}, options) => value(await runtime.invoke(operation, input, options));
async function withSessions(callback, options = {}) {
  const runtime = createSessionEvidence(options);
  try { return await callback(runtime); } finally { await runtime.close(); }
}
async function withTemp(callback) {
  const directory = await mkdtemp(join(tmpdir(), 'dsh-rea-session-evidence-'));
  try { return await callback(directory); } finally { await rm(directory, { recursive: true, force: true }); }
}

test('session instances isolate Evidence, unknown heads and close lifecycle', async () => {
  const left = createSessionEvidence();
  const right = createSessionEvidence();
  try {
    assert.equal(value(left.recordEvidence(sample)), 'added');
    await invoke(left, 'record_unknown', question());
    assert.equal((await invoke(left, 'get_evidence_bundle')).records.length, 2);
    assert.equal((await invoke(right, 'get_evidence_bundle')).records.length, 0);
    assert.equal((await invoke(right, 'list_unknowns')).total, 0);
    await left.close();
    assert.equal(left.records.exportEvidenceBundle().records.length, 0);
    failure(await left.invoke('get_evidence_bundle', {}), 'AnalysisCapabilityUnavailableError', 'session_closed');
    assert.equal((await invoke(right, 'get_evidence_bundle')).records.length, 0);
  } finally { await Promise.all([left.close(), right.close()]); }
});

test('record ownership authenticates IDs, deduplicates and detaches mutable reads', () => {
  const ledger = new EvidenceLedger();
  assert.equal(value(ledger.record(sample)), 'added');
  assert.equal(value(ledger.record(structuredClone(sample))), 'duplicate');
  const detached = ledger.get(sample.evidence_id);
  detached.limitations.push('external mutation');
  assert.deepEqual(ledger.get(sample.evidence_id), sample);
  assert.equal(Object.isFrozen(ledger.forAnalysis(sample.evidence_id)), true);
  assert.equal(Object.isFrozen(ledger.forAnalysis(sample.evidence_id).normalized_result), true);
  const tampered = structuredClone(sample);
  tampered.normalized_result = { changed: true };
  failure(ledger.record(tampered), 'EvidenceIntegrityError');
  assert.equal(ledger.export().records.length, 1);
});

test('injecting the upstream record owner shares exactly one ledger and preserves it on adapter close', async () => {
  const records = new InvestigationRecords();
  const runtime = createSessionEvidence({ records });
  value(records.recordEvidence(sample));
  assert.equal((await invoke(runtime, 'get_evidence_bundle')).records[0].evidence_id, sample.evidence_id);
  await invoke(runtime, 'record_unknown', question());
  assert.equal(records.listUnknowns().length, 1);
  await runtime.close();
  assert.equal(records.exportEvidenceBundle().records.length, 2);
  records.clear();
});

test('imports return newly added counts and authenticated summary selection', async () => withSessions(async (runtime) => {
  assert.deepEqual(await invoke(runtime, 'import_evidence_bundle', { path: bundlePath }), { imported: 5, unknowns_added: 0, total: 5 });
  assert.deepEqual(await invoke(runtime, 'import_evidence_bundle', { path: bundlePath }), { imported: 0, unknowns_added: 0, total: 5 });
  const summary = await invoke(runtime, 'get_evidence_bundle', { detail: 'summary', filters: { operation: 'list_strings' } });
  assert.equal(summary.total_retained_records, 5);
  assert.equal(summary.matching_records, 1);
  failure(await runtime.invoke('get_evidence_bundle', { filters: {} }), 'AnalysisInputError');
}));

test('record-only import updates display metadata without changing semantic identity', () => {
  const records = new InvestigationRecords();
  value(records.mergeEvidenceBundle(bundle));
  const rebound = structuredClone(bundle);
  rebound.records[0].subject.local_path = '/new/location/program.bin';
  rebound.records[0].subject.name = 'renamed.bin';
  const imported = value(records.mergeEvidenceBundle(rebound));
  assert.deepEqual(imported, { recordsAdded: 0, unknownsAdded: 0, changed: true, metadataChanged: true });
  assert.equal(records.evidenceById(sample.evidence_id).subject.local_path, '/new/location/program.bin');
});

test('unknown lifecycle preserves mutation evidence, revision chain and optimistic conflicts', async () => withSessions(async (runtime) => {
  value(runtime.recordEvidence(sample));
  const created = await invoke(runtime, 'record_unknown', question({ supporting_evidence_ids: [sample.evidence_id] }));
  assert.equal(created.status, 'open');
  assert.equal(created.revision, 1);
  assert.equal(created.scope_digest, target.sha256);
  const mutation = runtime.records.evidenceById(created.mutation_evidence_ids[0]);
  assert.equal(mutation.predicate_type, 'rea.residual-unknown-mutation');
  assert.equal(mutation.authority, 'analyst-inference');
  assert.deepEqual(mutation.evidence_links, [sample.evidence_id]);
  failure(await runtime.invoke('record_unknown', question({ supporting_evidence_ids: [sample.evidence_id] })), 'UnknownRegistryError', 'already-exists');
  const investigating = await invoke(runtime, 'update_unknown', update(created, { status: 'investigating' }));
  assert.equal(investigating.revision, 2);
  assert.equal(investigating.previous_revision_digest, created.revision_digest);
  failure(await runtime.invoke('update_unknown', update(created, { status: 'blocked' })), 'UnknownRegistryError', 'revision-conflict');
  const resolved = await invoke(runtime, 'update_unknown', update(investigating, { status: 'resolved', resolution: { disposition: 'verified', rationale: 'The retained observed artifact Evidence meets the exact requirement.', evidence_ids: [sample.evidence_id] } }));
  assert.equal(resolved.revision, 3);
  assert.deepEqual(await invoke(runtime, 'verify_unknown_resolution', { unknown_id: created.unknown_id }), { valid: true, truthVerified: true, unknown: resolved });
  const exported = await invoke(runtime, 'get_evidence_bundle');
  assert.equal(exported.unknowns.length, 3);
  assert.equal(exported.records.length, 4);
}, { getTarget: () => target }));

test('withdrawal resolves registry state without asserting truth', async () => withSessions(async (runtime) => {
  const created = await invoke(runtime, 'record_unknown', question());
  const head = await invoke(runtime, 'update_unknown', update(created, { status: 'resolved', resolution: { disposition: 'withdrawn', rationale: 'The question was withdrawn.', evidence_ids: [] } }));
  const verification = await invoke(runtime, 'verify_unknown_resolution', { unknown_id: head.unknown_id });
  assert.equal(verification.valid, true);
  assert.equal(verification.truthVerified, false);
}));

test('invalid references and insufficient resolution evidence append nothing', async () => withSessions(async (runtime) => {
  const before = await invoke(runtime, 'get_evidence_bundle');
  failure(await runtime.invoke('record_unknown', question({ supporting_evidence_ids: ['ev_' + '00'.repeat(32)] })), 'UnknownRegistryError', 'integrity');
  assert.deepEqual(await invoke(runtime, 'get_evidence_bundle'), before);
  value(runtime.recordEvidence(sample));
  const head = await invoke(runtime, 'record_unknown', question({ supporting_evidence_ids: [sample.evidence_id], required_authority: 'controlled-replay' }));
  const beforeUpdate = await invoke(runtime, 'get_evidence_bundle');
  failure(await runtime.invoke('update_unknown', update(head, { status: 'resolved', resolution: { disposition: 'verified', rationale: 'Incorrect authority must fail.', evidence_ids: [sample.evidence_id] } })), 'UnknownRegistryError', 'integrity');
  assert.deepEqual(await invoke(runtime, 'get_evidence_bundle'), beforeUpdate);
}));

test('contradicted unknowns cannot become verified while contradiction remains', async () => withSessions(async (runtime) => {
  value(runtime.recordEvidence(sample));
  const head = await invoke(runtime, 'record_unknown', question({ contradicting_evidence_ids: [sample.evidence_id] }));
  assert.equal(head.status, 'contradicted');
  const before = await invoke(runtime, 'get_evidence_bundle');
  failure(await runtime.invoke('update_unknown', update(head, { status: 'resolved', resolution: { disposition: 'verified', rationale: 'Still contradicted.', evidence_ids: [sample.evidence_id] } })), 'UnknownRegistryError', 'integrity');
  assert.deepEqual(await invoke(runtime, 'get_evidence_bundle'), before);
}));

test('dependency cycles are rejected atomically', async () => withSessions(async (runtime) => {
  const first = await invoke(runtime, 'record_unknown', question({ question: 'First question?' }));
  const second = await invoke(runtime, 'record_unknown', question({ question: 'Second question?', relationships: [{ type: 'depends-on', unknown_id: first.unknown_id }] }));
  const before = await invoke(runtime, 'get_evidence_bundle');
  failure(await runtime.invoke('update_unknown', update(first, { relationships: [{ type: 'depends-on', unknown_id: second.unknown_id }] })), 'UnknownRegistryError', 'integrity');
  assert.deepEqual(await invoke(runtime, 'get_evidence_bundle'), before);
}));

test('unknown pagination uses stable IDs, filters and empty boundary pages', async () => withSessions(async (runtime) => {
  for (const [questionText, severity] of [['z?', 'high'], ['a?', 'low'], ['m?', 'high']]) await invoke(runtime, 'record_unknown', question({ question: questionText, severity }));
  const all = await invoke(runtime, 'list_unknowns');
  assert.equal(all.total, 3);
  assert.deepEqual(all.items.map((x) => x.unknown_id), all.items.map((x) => x.unknown_id).sort());
  const first = await invoke(runtime, 'list_unknowns', { limit: 1 });
  assert.equal(first.next_offset, 1);
  const rest = await invoke(runtime, 'list_unknowns', { offset: first.next_offset });
  assert.deepEqual([...first.items, ...rest.items], all.items);
  assert.equal(rest.next_offset, null);
  const past = await invoke(runtime, 'list_unknowns', { offset: Number.MAX_SAFE_INTEGER, limit: 2 });
  assert.deepEqual(past, { items: [], total: 3, offset: Number.MAX_SAFE_INTEGER, next_offset: null });
  assert.equal((await invoke(runtime, 'list_unknowns', { severity: 'high' })).total, 2);
  for (const input of [{ limit: 0 }, { offset: -1 }, { offset: 0.5 }, { extra: 1 }]) failure(await runtime.invoke('list_unknowns', input), 'AnalysisInputError');
}));

test('conflicting unknown revisions make full import atomic', async () => {
  const left = createSessionEvidence();
  const right = createSessionEvidence();
  try {
    await invoke(left, 'record_unknown', question({ severity: 'low' }));
    await invoke(right, 'record_unknown', question({ severity: 'high' }));
    value(right.recordEvidence(sample));
    const before = await invoke(left, 'get_evidence_bundle');
    failure(left.records.mergeEvidenceBundle(await invoke(right, 'get_evidence_bundle')), 'EvidenceIntegrityError');
    assert.deepEqual(await invoke(left, 'get_evidence_bundle'), before);
  } finally { await Promise.all([left.close(), right.close()]); }
});

test('derived Evidence and linked unknown commit together and remain idempotent', () => {
  const records = new InvestigationRecords();
  const input = fullQuestion({ supporting_evidence_ids: [sample.evidence_id] });
  const head = value(records.recordEvidenceWithUnknown(sample, input));
  assert.equal(records.hasEvidence(sample.evidence_id), true);
  assert.equal(records.listUnknowns()[0].unknown_id, head.unknown_id);
  assert.equal(value(records.recordEvidenceWithUnknown(sample, input)), null);
  assert.equal(records.exportEvidenceBundle().records.length, 2);
});

test('import rejects gaps in unknown history without mutating the destination', async () => withSessions(async (runtime) => {
  const head = await invoke(runtime, 'record_unknown', question());
  await invoke(runtime, 'update_unknown', update(head, { status: 'blocked' }));
  const broken = structuredClone(await invoke(runtime, 'get_evidence_bundle'));
  broken.unknowns = broken.unknowns.slice(1);
  const destination = new InvestigationRecords();
  value(destination.recordEvidence(sample));
  const before = destination.exportEvidenceBundle();
  failure(destination.mergeEvidenceBundle(broken), 'EvidenceIntegrityError');
  assert.deepEqual(destination.exportEvidenceBundle(), before);
}));

test('session export/import preserves full histories and exact added revision counts', async () => withTemp(async (directory) => {
  const left = createSessionEvidence();
  const right = createSessionEvidence();
  try {
    const head = await invoke(left, 'record_unknown', question());
    await invoke(left, 'update_unknown', update(head, { status: 'blocked' }));
    const path = join(directory, 'history.json');
    const exported = await invoke(left, 'export_evidence_bundle', { path });
    assert.equal(exported.unknowns, 2);
    assert.equal(exported.records, 2);
    assert.equal(exported.bytes, (await readFile(path)).length);
    assert.deepEqual(await invoke(right, 'import_evidence_bundle', { path }), { imported: 2, unknowns_added: 2, total: 2 });
    assert.deepEqual(await invoke(right, 'get_evidence_bundle'), await invoke(left, 'get_evidence_bundle'));
    assert.deepEqual(await invoke(right, 'import_evidence_bundle', { path }), { imported: 0, unknowns_added: 0, total: 2 });
    failure(await left.invoke('export_evidence_bundle', { path }), 'EvidenceFileError', 'exists');
  } finally { await Promise.all([left.close(), right.close()]); }
}));

test('compare_bundles retains source closure and emits comparison Evidence with explicit pairing', async () => withSessions(async (runtime) => {
  const right = JSON.parse(await readFile(reducedPath, 'utf8'));
  const pairedLeft = bundle.records.find((r) => r.evidence_id !== right.records[0].evidence_id);
  const pairs = [{ left_evidence_id: pairedLeft.evidence_id, right_evidence_id: right.records[0].evidence_id }];
  const evidence = await invoke(runtime, 'compare_bundles', { left_bundle_path: bundlePath, right_bundle_path: reducedPath, record_pairs: pairs });
  assert.equal(evidence.predicate_type, 'rea.bundle-comparison');
  assert.equal(evidence.operation, 'compare_bundles');
  assert.equal(evidence.authority, 'analyst-inference');
  assert.equal(evidence.confidence, 'derived');
  assert.equal(evidence.normalized_result.summary.records_changed, 1);
  assert.deepEqual(evidence.parameters.record_pairs, pairs);
  assert.equal(evidence.evidence_links.length, 5);
  assert.equal((await invoke(runtime, 'get_evidence_bundle')).records.length, 6);
}));

test('invalid comparison pairs publish no sources or comparison record', async () => withSessions(async (runtime) => {
  const error = failure(await runtime.invoke('compare_bundles', { left_bundle_path: bundlePath, right_bundle_path: reducedPath, record_pairs: [{ left_evidence_id: 'ev_' + '00'.repeat(32), right_evidence_id: sample.evidence_id }] }), 'AnalysisInputError');
  assert.equal(error.operation, 'compare_bundles');
  assert.equal((await invoke(runtime, 'get_evidence_bundle')).records.length, 0);
}));

test('comparison distinguishes advanced and divergent unknown histories', async () => withTemp(async (directory) => {
  const source = createSessionEvidence();
  const branch = createSessionEvidence();
  const comparison = createSessionEvidence();
  try {
    const head = await invoke(source, 'record_unknown', question());
    const initial = join(directory, 'initial.json');
    await invoke(source, 'export_evidence_bundle', { path: initial });
    await invoke(branch, 'import_evidence_bundle', { path: initial });
    await invoke(source, 'update_unknown', update(head, { status: 'investigating' }));
    await invoke(branch, 'update_unknown', update(head, { status: 'blocked' }));
    const advanced = join(directory, 'advanced.json');
    const diverged = join(directory, 'diverged.json');
    await invoke(source, 'export_evidence_bundle', { path: advanced });
    await invoke(branch, 'export_evidence_bundle', { path: diverged });
    const first = await invoke(comparison, 'compare_bundles', { left_bundle_path: initial, right_bundle_path: advanced });
    assert.equal(first.normalized_result.summary.unknowns_advanced, 1);
    assert.equal(first.normalized_result.changes.some((c) => c.entity === 'residual_unknown' && c.classification === 'history_advanced'), true);
    const second = await invoke(comparison, 'compare_bundles', { left_bundle_path: advanced, right_bundle_path: diverged });
    assert.equal(second.normalized_result.summary.unknowns_diverged, 1);
    assert.equal(second.normalized_result.changes.some((c) => c.entity === 'residual_unknown' && c.classification === 'history_diverged'), true);
    // Comparing imports source Evidence, not the two incompatible unknown graphs.
    assert.equal((await invoke(comparison, 'list_unknowns')).total, 0);
  } finally { await Promise.all([source.close(), branch.close(), comparison.close()]); }
}));

test('pre-cancelled calls never mutate the session and close drains admitted work', async () => {
  const runtime = createSessionEvidence();
  const signal = AbortSignal.abort();
  failure(await runtime.invoke('import_evidence_bundle', { path: bundlePath }, { signal }), 'AnalysisCancelledError');
  failure(await runtime.invoke('record_unknown', question(), { signal }), 'AnalysisCancelledError');
  assert.equal(runtime.records.exportEvidenceBundle().records.length, 0);
  const comparing = runtime.invoke('compare_bundles', { left_bundle_path: bundlePath, right_bundle_path: reducedPath });
  const closing = runtime.close();
  value(await comparing);
  await closing;
  assert.equal(runtime.records.exportEvidenceBundle().records.length, 0);
});

if (process.env.REA_UPSTREAM_ROOT) {
  test('live upstream InvestigationRecords, comparison Evidence and schemas match', async () => withSessions(async (runtime) => {
    const load = (path) => import(pathToFileURL(resolve(process.env.REA_UPSTREAM_ROOT, 'dist', path)).href);
    const { InvestigationRecords: UpstreamRecords } = await load('application/investigation/InvestigationRecords.js');
    const { createEvidence } = await load('domain/evidence.js');
    const { compareBundles } = await load('domain/bundleComparison.js');
    const { BUNDLE_COMPARISON_PROVIDER } = await load('application/InvestigationProviders.js');
    const { projectAnalysisError: upstreamProject } = await load('domain/analysisErrorProjection.js');
    const { SESSION_TOOL_CONTRACTS } = await load('contracts/sessionToolContracts.js');
    const { z } = await import(pathToFileURL(resolve(process.env.REA_UPSTREAM_ROOT, 'node_modules/zod/index.js')).href);
    const upstream = new UpstreamRecords();
    assert.deepEqual(runtime.recordEvidence(sample), upstream.recordEvidence(sample));
    const input = fullQuestion({ supporting_evidence_ids: [sample.evidence_id] });
    const ours = await invoke(runtime, 'record_unknown', input);
    assert.deepEqual(ours, value(upstream.recordUnknown(input)));
    const next = update(ours, { status: 'blocked' });
    assert.deepEqual(await invoke(runtime, 'update_unknown', next), value(upstream.updateUnknown(next)));
    assert.deepEqual(await invoke(runtime, 'get_evidence_bundle'), upstream.exportEvidenceBundle());
    const stale = failure(await runtime.invoke('update_unknown', next), 'UnknownRegistryError');
    assert.deepEqual(projectAnalysisError(stale), upstreamProject(failure(upstream.updateUnknown(next), 'UnknownRegistryError')));
    const right = JSON.parse(await readFile(reducedPath, 'utf8'));
    const compared = compareBundles(bundle, right, []);
    const sources = [...new Map([...bundle.records, ...right.records].map((r) => [r.evidence_id, r])).values()];
    const expected = createEvidence(undefined, BUNDLE_COMPARISON_PROVIDER, { predicateType: 'rea.bundle-comparison', operation: 'compare_bundles', parameters: { left_bundle_sha256: compared.left_bundle_sha256, right_bundle_sha256: compared.right_bundle_sha256, record_pairs: [] }, result: compared, confidence: 'derived', authority: 'analyst-inference', limitations: compared.limitations, evidenceLinks: sources.map((r) => r.evidence_id) });
    assert.deepEqual(await invoke(runtime, 'compare_bundles', { left_bundle_path: bundlePath, right_bundle_path: reducedPath }), expected);
    for (const [name, schema] of Object.entries(inputSchemas)) {
      const contract = SESSION_TOOL_CONTRACTS.find((c) => c.name === name);
      assert.deepEqual(schema, z.toJSONSchema(contract.inputSchema, { io: 'input' }), name);
    }
  }));
}
