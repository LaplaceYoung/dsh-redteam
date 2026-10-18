import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { crc32 } from 'node:zlib';
import { DatabaseSync } from 'node:sqlite';
import { createReaSession } from '../src/rea-native/session/runtime.mjs';

const hash = bytes => createHash('sha256').update(bytes).digest('hex');
async function withRuntime(callback, count = 1) {
  const directory = await mkdtemp(join(tmpdir(), 'rea-full-session-'));
  const sessions = [];
  try {
    for (let index = 0; index < count; index++) sessions.push(await createReaSession({ environment: { REA_WABT_BIN_DIRECTORY: join(directory, 'missing-wabt') } }));
    return await callback(sessions, directory);
  } finally {
    await Promise.all(sessions.map(session => session.close()));
    await rm(directory, { recursive: true, force: true });
  }
}
async function invoke(session, name, input = {}) {
  const response = await session.invoke(name, input);
  assert.notEqual(response.isError, true, `${name}: ${JSON.stringify(response.structuredContent)}`);
  return response.structuredContent;
}
const result = async (...args) => (await invoke(...args)).result;
const question = {
  question: 'What produced this observed resource?', domain: 'provenance', severity: 'medium',
  required_authority: 'shipped-artifact', required_confidence: 'observed', required_environment: null,
  recommended_probes: [], relationships: [],
};
function resourcePe() {
  const bytes = Buffer.alloc(640);
  bytes.write('MZ'); bytes.writeUInt32LE(128, 60);
  bytes.write('PE\0\0', 128); bytes.writeUInt16LE(0x8664, 132);
  bytes.writeUInt16LE(1, 134); bytes.writeUInt16LE(240, 148);
  bytes.writeUInt16LE(0x20b, 152); bytes.writeBigUInt64LE(0x140000000n, 176);
  bytes.writeUInt32LE(4096, 184); bytes.writeUInt32LE(512, 188);
  bytes.writeUInt32LE(8192, 208); bytes.writeUInt32LE(512, 212);
  bytes.writeUInt32LE(16, 260); bytes.writeUInt32LE(4096, 280); bytes.writeUInt32LE(128, 284);
  bytes.write('.rsrc', 392); bytes.writeUInt32LE(128, 400); bytes.writeUInt32LE(4096, 404);
  bytes.writeUInt32LE(128, 408); bytes.writeUInt32LE(512, 412); bytes.writeUInt32LE(0x40000040, 428);
  for (const [offset, id, target] of [[512, 10, 0x80000018], [536, 7, 0x80000030], [560, 1033, 72]]) {
    bytes.writeUInt16LE(1, offset + 14); bytes.writeUInt32LE(id, offset + 16); bytes.writeUInt32LE(target, offset + 20);
  }
  bytes.writeUInt32LE(4192, 584); bytes.writeUInt32LE(5, 588); bytes.write('HELLO', 608);
  return bytes;
}
function storedZip() {
  const name = Buffer.from('note.txt'); const data = Buffer.from('offline archive content\n');
  const local = Buffer.alloc(30); local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4);
  local.writeUInt32LE(crc32(data), 14); local.writeUInt32LE(data.length, 18); local.writeUInt32LE(data.length, 22); local.writeUInt16LE(name.length, 26);
  const central = Buffer.alloc(46); central.writeUInt32LE(0x02014b50, 0); central.writeUInt16LE(20, 4); central.writeUInt16LE(20, 6);
  central.writeUInt32LE(crc32(data), 16); central.writeUInt32LE(data.length, 20); central.writeUInt32LE(data.length, 24); central.writeUInt16LE(name.length, 28);
  const end = Buffer.alloc(22); end.writeUInt32LE(0x06054b50); end.writeUInt16LE(1, 8); end.writeUInt16LE(1, 10);
  end.writeUInt32LE(central.length + name.length, 12); end.writeUInt32LE(local.length + name.length + data.length, 16);
  return Buffer.concat([local, name, data, central, name, end]);
}

test('complete registrar exposes 207 tools and 6 prompts and rejects unknown operations', async () => withRuntime(async ([session]) => {
  assert.equal(session.operations.length, 207); assert.equal(new Set(session.operations).size, 207);
  assert.equal(session.prompts.length, 6);
  assert.ok(session.operations.includes('analyze_javascript_application'));
  await assert.rejects(session.invoke('missing_operation', {}), /Unknown REA native operation/);
  const invalid = await session.invoke('inspect_pe_resources', { path: 23 });
  assert.equal(invalid.isError, true); assert.equal(invalid.structuredContent.error.code, 'invalid_request');
}));

test('real PE evidence and unknown history isolate sessions and survive export/import', async () => withRuntime(async ([left, right], directory) => {
  const path = join(directory, 'resource.exe'); const bytes = resourcePe(); await writeFile(path, bytes);
  const evidence = await invoke(left, 'inspect_pe_resources', { path });
  assert.equal(evidence.subject.digest.sha256, hash(bytes));
  assert.equal(evidence.normalized_result.resources[0].payload.location.offset, 608);
  assert.equal(evidence.normalized_result.resources[0].payload.sha256, '3733cd977ff8eb18b987357e22ced99f46097f31ecb239e878ae63760e83e4d5');
  assert.equal((await result(left, 'get_evidence_bundle')).records.length, 1);
  assert.equal((await result(right, 'get_evidence_bundle')).records.length, 0);
  const head = await result(left, 'record_unknown', { ...question, supporting_evidence_ids: [evidence.evidence_id] });
  assert.equal(head.status, 'open'); assert.equal(head.revision, 1);
  const updated = await result(left, 'update_unknown', {
    unknown_id: head.unknown_id, expected_revision: head.revision, status: 'blocked', severity: head.severity,
    supporting_evidence_ids: head.supporting_evidence_ids, contradicting_evidence_ids: head.contradicting_evidence_ids,
    required_authority: head.required_authority, required_confidence: head.required_confidence,
    required_environment: head.required_environment, recommended_probes: head.recommended_probes,
    relationships: head.relationships, resolution: head.resolution,
  });
  assert.equal(updated.revision, 2); assert.equal(updated.status, 'blocked');
  assert.equal(updated.previous_revision_digest, head.revision_digest);
  assert.equal((await result(left, 'list_unknowns')).total, 1);
  assert.equal((await result(right, 'list_unknowns')).total, 0);
  const bundlePath = join(directory, 'evidence.json');
  const exported = await result(left, 'export_evidence_bundle', { path: bundlePath });
  assert.equal(exported.records, 3); assert.equal(exported.unknowns, 2);
  assert.equal(exported.bytes, (await readFile(bundlePath)).length);
  assert.deepEqual(await result(right, 'import_evidence_bundle', { path: bundlePath }), { imported: 3, unknowns_added: 2, total: 3 });
  assert.deepEqual(await result(right, 'get_evidence_bundle'), await result(left, 'get_evidence_bundle'));
  assert.deepEqual(await result(right, 'import_evidence_bundle', { path: bundlePath }), { imported: 0, unknowns_added: 0, total: 3 });
  await Promise.all([left.close(), left.close()]);
  await assert.rejects(left.invoke('get_evidence_bundle', {}), /closed/);
  assert.equal((await result(right, 'get_evidence_bundle')).records.length, 3);
}, 2));

test('SQLite worker reads real database rows with exact integer/blob/text types', async () => withRuntime(async ([session], directory) => {
  const path = join(directory, 'sample.sqlite');
  const database = new DatabaseSync(path);
  try {
    database.exec("CREATE TABLE sample(id INTEGER PRIMARY KEY, name TEXT NOT NULL, payload BLOB); INSERT INTO sample VALUES (9007199254740993, '测试', X'00ff7f'); INSERT INTO sample VALUES (2, 'second', NULL);");
  } finally { database.close(); }
  const bytes = await readFile(path);
  const evidence = await invoke(session, 'inspect_sqlite_database', { path, table: 'sample', columns: ['id', 'name', 'payload'], row_limit: 5 });
  const report = evidence.normalized_result;
  assert.equal(evidence.subject.digest.sha256, hash(bytes));
  assert.equal(report.schema.scope, 'selected_table'); assert.equal(report.schema.tables[0].name, 'sample');
  assert.deepEqual(report.rows.columns, ['id', 'name', 'payload']);
  assert.equal(report.rows.returned_rows, 2); assert.equal(report.rows.truncated, false);
  const row = report.rows.values.find(values => values[0].value === '9007199254740993');
  assert.deepEqual(row[0], { type: 'integer', value: '9007199254740993' });
  assert.equal(row[1].value, '测试'); assert.equal(row[1].bytes_hex, 'e6b58be8af95');
  assert.deepEqual(row[2], { type: 'blob', hex: '00ff7f' });
  assert.equal((await result(session, 'get_evidence_bundle')).records.length, 1);
}));

test('JavaScript directory analysis runs actual worker and reports static module facts', { timeout: 120_000 }, async () => withRuntime(async ([session], directory) => {
  const tree = join(directory, 'app'); await mkdir(tree);
  await writeFile(join(tree, 'package.json'), JSON.stringify({ name: 'fixture', version: '1.0.0', main: 'main.js' }));
  await writeFile(join(tree, 'main.js'), "const { ipcMain } = require('electron');\nipcMain.handle('greeting', () => 'hello');\n");
  const phases = [];
  const response = await session.invoke('analyze_javascript_application', { input_path: tree, format: 'directory' }, { onProgress: progress => phases.push(progress) });
  assert.notEqual(response.isError, true, JSON.stringify(response.structuredContent));
  const evidence = response.structuredContent;
  assert.equal(evidence.operation, 'analyze_javascript_application');
  const report = evidence.normalized_result;
  assert.equal(report.format, 'directory'); assert.equal(report.statistics.parsed_javascript_files, 1);
  assert.equal(report.statistics.parse_failures, 0); assert.equal(report.summary.ipc.main_handlers, 1);
  assert.ok(report.semantic_graph.nodes.length > 0);
  assert.ok(phases.length > 0);
  assert.equal((await result(session, 'get_evidence_bundle')).records[0].evidence_id, evidence.evidence_id);
}));

test('ZIP artifact opens and closes through the in-process provider without a native engine', async () => withRuntime(async ([session], directory) => {
  const path = join(directory, 'archive.zip'); const bytes = storedZip(); await writeFile(path, bytes);
  const opened = await result(session, 'open_binary', { path });
  assert.ok(opened, JSON.stringify(opened));
  const status = session.status();
  assert.equal(status.open, true); assert.equal(status.path, path);
  assert.equal(status.sha256, hash(bytes));
  const inspection = await invoke(session, 'inspect_artifact', {});
  const inventory = inspection.normalized_result.substeps[0].evidence.normalized_result;
  assert.ok(inventory.occurrences.some(item => item.logical_path === 'note.txt'));
  assert.ok(inventory.nodes.some(item => item.sha256 === hash(Buffer.from('offline archive content\n'))));
  await result(session, 'close_binary', {});
  assert.equal(session.status().open, false);
}));

test('missing configured WABT engine returns explicit capability error and no fabricated evidence', async () => withRuntime(async ([session], directory) => {
  const path = join(directory, 'empty.wasm'); await writeFile(path, Buffer.from([0, 97, 115, 109, 1, 0, 0, 0]));
  const response = await session.invoke('inspect_wasm_artifact', { path });
  assert.equal(response.isError, true);
  assert.equal(response.structuredContent.error.code, 'capability_unavailable');
  assert.match(JSON.stringify(response.structuredContent.error), /WABT|wabt/);
  assert.equal((await result(session, 'get_evidence_bundle')).records.length, 0);
}));
