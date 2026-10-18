import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdtemp, rm, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { crc32 } from 'node:zlib';
import { createNativeCli } from '../src/rea-native/session/cli/runtime.mjs';
import { createReaSession } from '../src/rea-native/session/runtime.mjs';

const fixture = new URL('../src/rea-native/evidence/fixtures/bundle.json', import.meta.url);
const temporary = async operation => { const path = await mkdtemp(join(tmpdir(), 'rea-native-cli-')); try { return await operation(path); } finally { await rm(path, { recursive: true, force: true }); } };
const zip = () => {
  const name = Buffer.from('note.txt'), data = Buffer.from('known workflow artifact');
  const local = Buffer.alloc(30); local.writeUInt32LE(0x04034b50); local.writeUInt16LE(20, 4); local.writeUInt32LE(crc32(data), 14); local.writeUInt32LE(data.length, 18); local.writeUInt32LE(data.length, 22); local.writeUInt16LE(name.length, 26);
  const central = Buffer.alloc(46); central.writeUInt32LE(0x02014b50); central.writeUInt16LE(20, 4); central.writeUInt16LE(20, 6); central.writeUInt32LE(crc32(data), 16); central.writeUInt32LE(data.length, 20); central.writeUInt32LE(data.length, 24); central.writeUInt16LE(name.length, 28);
  const end = Buffer.alloc(22); end.writeUInt32LE(0x06054b50); end.writeUInt16LE(1, 8); end.writeUInt16LE(1, 10); end.writeUInt32LE(central.length + name.length, 12); end.writeUInt32LE(local.length + name.length + data.length, 16);
  return Buffer.concat([local, name, data, central, name, end]);
};

test('all 153 canonical workflow contracts retain upstream names, schemas and explicit installation differences', async () => {
  const cli = createNativeCli();
  const original = JSON.parse(await readFile(new URL('../docs/rea-native/catalog/cli-manifest.json', import.meta.url), 'utf8'));
  assert.deepEqual(cli.commands, original.commands.map(item => item.name).sort());
  for (const name of cli.commands) {
    const description = cli.describe(name);
    assert.equal(description.name, name);
    assert.equal(description.argsSchema.type, 'object');
    assert.equal(description.optionsSchema.type, 'object');
  }
  assert.equal(cli.describe('compare-bundles').description, cli.describe('compare').description);
  for (const name of ['setup', 'update', 'uninstall']) {
    assert.equal(cli.describe(name).classification, 'external-installation-management');
    const result = await cli.invoke(name);
    assert.equal(result.isError, true);
    assert.equal(result.error.code, 'REA_INSTALLATION_COMMAND_NOT_APPLICABLE');
  }
});

test('file workflows use actual canonical export, validation and alias comparison', () => temporary(async directory => {
  const cli = createNativeCli();
  const source = join(directory, 'source.json'), output = join(directory, 'output.json');
  await writeFile(source, await readFile(fixture));
  const exported = await cli.invoke('evidence-export', { args: { source, output } });
  assert.equal(exported.isError, false, JSON.stringify(exported));
  const imported = await cli.invoke('evidence-import', { args: { path: output } });
  assert.equal(imported.isError, false, JSON.stringify(imported));
  const compared = await cli.invoke('compare-bundles', { args: { left: source, right: output } });
  assert.equal(compared.isError, false, JSON.stringify(compared));
  assert.deepEqual(JSON.parse(await readFile(output, 'utf8')), JSON.parse(await readFile(source, 'utf8')));
  const duplicate = await cli.invoke('evidence-export', { args: { source, output } });
  assert.equal(duplicate.isError, true);
  assert.equal(duplicate.error.code, 'invalid_request');
}));

test('real SQLite workflow returns rows repeatedly and leaves process exit/listeners untouched on failure', () => temporary(async directory => {
  const path = join(directory, 'data.sqlite'); const database = new DatabaseSync(path);
  database.exec("CREATE TABLE sample(value TEXT); INSERT INTO sample VALUES ('actual-row');"); database.close();
  const cli = createNativeCli(); const exitCode = process.exitCode;
  const listeners = ['SIGINT', 'SIGTERM'].map(signal => process.listenerCount(signal));
  for (let i = 0; i < 2; i++) {
    const result = await cli.invoke('inspect-sqlite-database', { args: { path }, options: { table: 'sample', rowLimit: 1 } });
    assert.equal(result.isError, false, JSON.stringify(result));
    assert.match(JSON.stringify(result.value.normalized_result), /actual-row/);
  }
  const invalid = await cli.invoke('inspect-go-binary', { args: { path: join(directory, 'missing.exe') } });
  assert.equal(invalid.isError, true); assert.equal(invalid.error.code, 'invalid_request');
  assert.equal(process.exitCode, exitCode);
  assert.deepEqual(['SIGINT', 'SIGTERM'].map(signal => process.listenerCount(signal)), listeners);
}));

test('structured input rejects unknown fields and pre-aborted invocation does not start work', async () => {
  const cli = createNativeCli();
  const invalid = await cli.invoke('inspect-go-binary', { args: { path: 'irrelevant', typo: true } });
  assert.equal(invalid.isError, true); assert.equal(invalid.error.code, 'invalid_request');
  await assert.rejects(cli.invoke('inspect-go-binary', { args: { path: 'irrelevant' } }, { signal: AbortSignal.abort(new Error('caller cancelled')) }), /caller cancelled/);
});

test('JavaScript workflow reports progress through the host and honors in-flight abort without changing process state', () => temporary(async directory => {
  const tree = join(directory, 'app'); await mkdir(tree);
  await writeFile(join(tree, 'package.json'), JSON.stringify({ name: 'workflow-app', main: 'index.js' }));
  await writeFile(join(tree, 'index.js'), 'export const answer = 42;\n');
  const cli = createNativeCli(); const controller = new AbortController(); const updates = [];
  const exitCode = process.exitCode;
  const result = await cli.invoke('analyze', { args: { path: tree } }, { signal: controller.signal, onProgress(update) { updates.push(update); controller.abort(); } });
  assert.ok(updates.length > 0);
  assert.equal(result.isError, true, JSON.stringify(result));
  assert.equal(result.error.code, 'cancelled');
  assert.equal(process.exitCode, exitCode);
}));

test('artifact CLI workflow shares host target and Evidence while another aggregate stays isolated', () => temporary(async directory => {
  const path = join(directory, 'sample.zip'); await writeFile(path, zip());
  const left = await createReaSession(), right = await createReaSession();
  try {
    const result = await left.invokeCommand('inspect-artifact', { args: { path } });
    assert.equal(result.isError, false, JSON.stringify(result));
    const leftBundle = (await left.invoke('get_evidence_bundle', {})).structuredContent.result;
    const rightBundle = (await right.invoke('get_evidence_bundle', {})).structuredContent.result;
    assert.ok(leftBundle.records.length > 0);
    assert.equal(leftBundle.records.filter(record => record.evidence_id === result.value.evidence_id).length, 1);
    assert.equal(rightBundle.records.length, 0);
    const inspected = await left.invoke('inspect_artifact', {});
    assert.notEqual(inspected.isError, true, JSON.stringify(inspected));
    assert.equal(left.status().open, true);
  } finally { await Promise.all([left.close(), right.close()]); }
}));

test('target-free SQLite CLI Evidence is authenticated into the host ledger and remains usable by unknowns', () => temporary(async directory => {
  const path = join(directory, 'ledger.sqlite'); const database = new DatabaseSync(path);
  database.exec('CREATE TABLE ledger_sample(id INTEGER PRIMARY KEY); INSERT INTO ledger_sample VALUES(17);'); database.close();
  const host = await createReaSession();
  try {
    const workflow = await host.invokeCommand('inspect-sqlite-database', { args: { path }, options: { table: 'ledger_sample' } });
    assert.equal(workflow.isError, false, JSON.stringify(workflow));
    const bundle = (await host.invoke('get_evidence_bundle', {})).structuredContent.result;
    assert.deepEqual(bundle.records.map(record => record.evidence_id), [workflow.value.evidence_id]);
    const unknown = await host.invoke('record_unknown', { question: 'What wrote the row?', domain: 'provenance', severity: 'medium', required_authority: 'shipped-artifact', required_confidence: 'observed', required_environment: null, recommended_probes: [], relationships: [], supporting_evidence_ids: [workflow.value.evidence_id] });
    assert.notEqual(unknown.isError, true, JSON.stringify(unknown));
    assert.equal(unknown.structuredContent.result.status, 'open');
  } finally { await host.close(); }
}));
