import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFile, writeFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
  inspectEvidenceBundleFile, compareEvidenceBundleFiles,
  validateEvidenceBundleFile, exportEvidenceBundleFile, inputSchemas, projectAnalysisError,
} from '../src/rea-native/evidence/runtime.mjs';

const fixture = (name) => fileURLToPath(new URL(`../src/rea-native/evidence/fixtures/${name}`, import.meta.url));
const bundlePath = fixture('bundle.json');
const reducedPath = fixture('reduced.json');
const bundle = JSON.parse(await readFile(bundlePath, 'utf8'));
const summaryOracle = JSON.parse(await readFile(fixture('summary.expected.json'), 'utf8'));
const value = (result) => { assert.equal(result.ok, true, result.error?.message); return result.value; };
const failure = (result, tag) => { assert.equal(result.ok, false); assert.equal(result.error._tag, tag); return result.error; };
async function withTemp(callback) {
  const directory = await mkdtemp(join(tmpdir(), 'dsh-rea-evidence-'));
  try { return await callback(directory); } finally { await rm(directory, { recursive: true, force: true }); }
}

test('complete delivery defaults to the entire authenticated canonical bundle', async () => {
  assert.deepEqual(value(await inspectEvidenceBundleFile({ path: bundlePath })), bundle);
});

test('summary matches upstream oracle and preserves value-flow uncertainty', async () => {
  const summary = value(await inspectEvidenceBundleFile({ path: bundlePath, detail: 'summary' }));
  assert.deepEqual(summary, summaryOracle);
  assert.equal(summary.total_retained_records, 5);
  assert.equal(summary.matching_records, 5);
  assert.equal(summary.records.every((record) => record.retention === 'complete-record'), true);
  assert.equal(summary.records.some((record) => 'normalized_result' in record), false);
  const native = new Map(summary.records.filter((r) => r.native_dossier.available).map((r) => [r.native_dossier.procedure_address, r.native_dossier]));
  assert.deepEqual(native.get('0x1000').value_flow, { status: 'observed', truncated: true, omitted_operations_lower_bound: null, known_omitted_inputs: 3, known_omitted_edges: null });
  assert.equal(native.get('0x2000').value_flow.status, 'unavailable');
  assert.equal(native.get('0x3000').value_flow.status, 'not-recorded');
  assert.equal(native.get('0x4000').value_flow.status, 'unknown');
});

test('all exact filters combine conjunctively without renormalizing addresses', async () => {
  const selected = bundle.records.find((r) => r.normalized_result.procedure?.address === '0x1000');
  const filters = { operation: 'analyze_function', target_sha256: 'ab'.repeat(32), evidence_id: selected.evidence_id, procedure_address: '0x1000' };
  const summary = value(await inspectEvidenceBundleFile({ path: bundlePath, detail: 'summary', filters }));
  assert.equal(summary.matching_records, 1);
  assert.equal(summary.total_retained_records, 5);
  assert.deepEqual(summary.filters, filters);
  for (const extra of [{ procedure_address: '0X1000' }, { analysis_profile_digest: 'ab'.repeat(32) }, { operation: 'none' }]) {
    assert.equal(value(await inspectEvidenceBundleFile({ path: bundlePath, detail: 'summary', filters: { ...filters, ...extra } })).matching_records, 0);
  }
});

test('complete-with-filters preserves the upstream semantic input error', async () => {
  const error = failure(await inspectEvidenceBundleFile({ path: bundlePath, filters: {} }), 'AnalysisInputError');
  assert.equal(error.operation, 'get_evidence_bundle');
  assert.deepEqual(error.issues[0].path, ['filters']);
});

test('unsupported pagination, relative paths, NUL paths and malformed filters are rejected', async () => {
  for (const input of [
    { path: bundlePath, offset: 0 }, { path: bundlePath, limit: 1 },
    { path: 'relative.json' }, { path: `${bundlePath}\0` },
    { path: bundlePath, detail: 'summary', filters: { target_sha256: 'bad' } },
    { path: bundlePath, detail: 'summary', filters: { unknown: true } },
  ]) failure(await inspectEvidenceBundleFile(input), 'AnalysisInputError');
  assert.equal(inputSchemas.inspect_evidence_bundle.additionalProperties, false);
  assert.deepEqual(inputSchemas.inspect_evidence_bundle.required, ['path']);
});

test('tampered record IDs, duplicate records and inconsistent manifests fail integrity', async () => withTemp(async (directory) => {
  const idTampered = structuredClone(bundle);
  idTampered.records[0].normalized_result = { altered: true };
  const duplicate = structuredClone(bundle);
  duplicate.records.push(duplicate.records[0]);
  const wrongManifest = structuredClone(bundle);
  wrongManifest.providers = [];
  for (const [index, invalid] of [idTampered, duplicate, wrongManifest].entries()) {
    const path = join(directory, `${index}.json`);
    await writeFile(path, JSON.stringify(invalid));
    failure(await inspectEvidenceBundleFile({ path }), 'EvidenceIntegrityError');
  }
}));

test('single-record files, invalid JSON, missing files and directories have distinct errors', async () => withTemp(async (directory) => {
  const single = join(directory, 'single.json');
  const invalid = join(directory, 'invalid.json');
  await writeFile(single, JSON.stringify(bundle.records[0]));
  await writeFile(invalid, '{');
  for (const [path, reason] of [[single, 'wrong-kind'], [invalid, 'invalid-json'], [join(directory, 'missing.json'), 'missing'], [directory, 'not-file']]) {
    assert.equal(failure(await inspectEvidenceBundleFile({ path }), 'EvidenceFileError').reason, reason);
  }
}));

test('comparison matches upstream and one-sided membership remains unknown', async () => {
  const comparison = value(await compareEvidenceBundleFiles({ left: bundlePath, right: reducedPath }));
  assert.deepEqual(comparison, JSON.parse(await readFile(fixture('compare.expected.json'), 'utf8')));
  assert.equal(comparison.status, 'unknown');
  assert.equal(comparison.summary.records_unchanged, 1);
  assert.equal(comparison.summary.records_removed, 0);
  assert.equal(comparison.summary.unresolved, 4);
  assert.equal(comparison.changes.every((change) => change.classification === 'unknown'), true);
  assert.equal(value(await compareEvidenceBundleFiles({ left: bundlePath, right: bundlePath })).status, 'unchanged');
});

test('file validation counts records without importing session state', async () => {
  assert.deepEqual(value(await validateEvidenceBundleFile({ path: bundlePath })), { imported: 5, unknowns_added: 0, total: 5 });
});

test('export writes canonical bytes, rejects overwrite by default and honors explicit overwrite', async () => withTemp(async (directory) => {
  const output = join(directory, 'export.json');
  const first = value(await exportEvidenceBundleFile({ source: bundlePath, output }));
  const bytes = await readFile(output);
  assert.equal(first.records, 5);
  assert.equal(first.bytes, bytes.length);
  assert.deepEqual(JSON.parse(bytes.toString()), bundle);
  assert.equal(failure(await exportEvidenceBundleFile({ source: reducedPath, output }), 'EvidenceFileError').reason, 'exists');
  assert.deepEqual(await readFile(output), bytes);
  assert.equal(value(await exportEvidenceBundleFile({ source: reducedPath, output, overwrite: true })).records, 1);
  assert.equal(value(await inspectEvidenceBundleFile({ path: output })).records.length, 1);
}));

test('failed source validation never publishes a destination', async () => withTemp(async (directory) => {
  const output = join(directory, 'out.json');
  failure(await exportEvidenceBundleFile({ source: join(directory, 'missing.json'), output }), 'EvidenceFileError');
  await assert.rejects(readFile(output), { code: 'ENOENT' });
}));

// Opt-in live parity adds direct imports from the installed upstream oracle,
// never a subprocess. Ordinary CI stays standalone and uses committed oracles.
if (process.env.REA_UPSTREAM_ROOT) {
  test('live installed REA 6.5.0 parity for summary, comparison, file errors and canonical bytes', async () => withTemp(async (directory) => {
    const root = process.env.REA_UPSTREAM_ROOT;
    const load = (path) => import(pathToFileURL(resolve(root, 'dist', path)).href);
    const { readEvidenceBundle } = await load('application/EvidenceBundleFiles.js');
    const { inspectEvidenceBundle } = await load('application/investigation/InspectEvidenceBundle.js');
    const upstreamCommands = await load('application/EvidenceBundleCommands.js');
    const { projectAnalysisError: upstreamProject } = await load('domain/analysisErrorProjection.js');
    const loaded = value(await readEvidenceBundle(bundlePath));
    assert.deepEqual(await inspectEvidenceBundleFile({ path: bundlePath, detail: 'summary' }), inspectEvidenceBundle(loaded, { detail: 'summary' }));
    assert.deepEqual(await compareEvidenceBundleFiles({ left: bundlePath, right: reducedPath }), await upstreamCommands.compareEvidenceBundlesCommand({ leftPath: bundlePath, rightPath: reducedPath }));
    const malformed = join(directory, 'malformed.json');
    await writeFile(malformed, '{');
    const localError = failure(await inspectEvidenceBundleFile({ path: malformed }), 'EvidenceFileError');
    const upstreamError = failure(await readEvidenceBundle(malformed), 'EvidenceFileError');
    assert.deepEqual(projectAnalysisError(localError), upstreamProject(upstreamError));
    const localPath = join(directory, 'local.json');
    const upstreamPath = join(directory, 'upstream.json');
    value(await exportEvidenceBundleFile({ source: bundlePath, output: localPath }));
    value(await upstreamCommands.exportEvidenceBundleCommand(bundlePath, upstreamPath, false));
    assert.deepEqual(await readFile(localPath), await readFile(upstreamPath));
  }));
}
