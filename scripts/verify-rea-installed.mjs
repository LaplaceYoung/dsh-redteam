import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { realpath, mkdir, mkdtemp, writeFile, readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { join, dirname, relative, isAbsolute } from 'node:path';
import { pathToFileURL } from 'node:url';
import { DatabaseSync } from 'node:sqlite';

const root = await realpath(process.cwd());
const require = createRequire(import.meta.url);
const entry = require.resolve('dsh-redteam');
const packageRequire = createRequire(entry);
const runtime = await realpath(packageRequire.resolve('@dsh-redteam/rea-native-session'));
const localPath = relative(root, runtime);
assert.ok(!localPath.startsWith('..') && !isAbsolute(localPath), `Escaped installation: ${runtime}`);
const { createReaSession } = await import(pathToFileURL(runtime).href);
const nativeRequire = createRequire(runtime);
const nativeManifest = JSON.parse(await readFile(join(dirname(runtime), 'package.json'), 'utf8'));
const expectedDependencies = process.argv[2]
  ? JSON.parse(await readFile(process.argv[2], 'utf8'))
  : nativeManifest.dependencies;
const nativeDependencies = {};
for (const name of ['yaml', 'ws']) {
  const actual = JSON.parse(await readFile(nativeRequire.resolve(`${name}/package.json`), 'utf8')).version;
  assert.equal(actual, expectedDependencies[name], `Native ${name} dependency version`);
  nativeDependencies[name] = actual;
}
const fixtures = await mkdtemp(join(root, 'runtime-fixtures-'));
const session = await createReaSession();
let evidenceCount;
let cliCommands;
const runtimeSha256 = createHash('sha256').update(await readFile(runtime)).digest('hex');
try {
  assert.equal(session.operations.length, 207); assert.equal(session.prompts.length, 6);
  const { createNativeCli } = await import(pathToFileURL(packageRequire.resolve('@dsh-redteam/rea-native-session/cli')).href);
  const cli = createNativeCli();
  cliCommands = cli.commands.length;
  assert.equal(cliCommands, 153);
  const setup = await cli.invoke('setup');
  assert.equal(setup.isError, true);
  assert.equal(setup.error.code, 'REA_INSTALLATION_COMMAND_NOT_APPLICABLE');
  const path = join(fixtures, 'fixture.sqlite');
  const db = new DatabaseSync(path);
  try { db.exec("CREATE TABLE sample(id INTEGER, value TEXT); INSERT INTO sample VALUES (7, 'installed worker');"); }
  finally { db.close(); }
  const sqlite = await session.invoke('inspect_sqlite_database', { path, table: 'sample', columns: ['id', 'value'], row_limit: 5 });
  assert.notEqual(sqlite.isError, true, JSON.stringify(sqlite));
  assert.equal(sqlite.structuredContent.normalized_result.rows.values[0][1].value, 'installed worker');
  const app = join(fixtures, 'app'); await mkdir(app);
  await writeFile(join(app, 'package.json'), JSON.stringify({ name: 'fixture', version: '1.0.0', main: 'main.js' }));
  await writeFile(join(app, 'main.js'), "const { ipcMain } = require('electron'); ipcMain.handle('installed', () => 7);\n");
  const javascript = await session.invoke('analyze_javascript_application', { input_path: app, format: 'directory' });
  assert.notEqual(javascript.isError, true, JSON.stringify(javascript));
  assert.equal(javascript.structuredContent.normalized_result.statistics.parsed_javascript_files, 1);
  assert.equal(javascript.structuredContent.normalized_result.summary.ipc.main_handlers, 1);
  const bundle = await session.invoke('get_evidence_bundle', {});
  evidenceCount = bundle.structuredContent.result.records.length;
  assert.equal(evidenceCount, 2);
} finally { await session.close(); }
console.log(JSON.stringify({ runtime, runtimeSha256, entry, nativeDependencies, dependencyContract: process.argv[2] ?? 'native package manifest', operations: 207, prompts: 6, cliCommands, sqliteWorker: true, javascriptWorker: true, evidenceCount, closed: true }));
