import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { reaToolContracts, getReaToolContract, reaUpstreamVersion } from '../../../src/rea-native/catalog/index.ts';

const readJson = async file => JSON.parse(await readFile(new URL(file, import.meta.url), 'utf8'));
const raw = await readJson('mcp-tools.json');
const index = await readJson('cli-manifest.json');
const full = await readJson('cli-full-manifest.json');
const catalog = await readJson('capability-catalog.json');

test('all advertised MCP input contracts, descriptions and annotations survive export exactly', () => {
  assert.equal(reaUpstreamVersion, '6.5.0');
  assert.equal(raw.tools.length, 207);
  assert.equal(reaToolContracts.length, raw.tools.length);
  assert.equal(new Set(reaToolContracts.map(tool => tool.name)).size, 207);
  for (const upstream of raw.tools) {
    const contract = getReaToolContract(upstream.name);
    assert.ok(contract, upstream.name);
    for (const field of ['inputSchema', 'description', 'annotations']) assert.deepEqual(contract[field], upstream[field], `${upstream.name}.${field}`);
    assert.ok(upstream.outputSchema, `${upstream.name} output schema retained`);
    assert.ok(contract.sources.length, `${upstream.name} source provenance`);
  }
  assert.equal(getReaToolContract('nonexistent_operation'), undefined);
  assert.equal(reaToolContracts.filter(tool => tool.nativeStatus === 'implemented-native-tested').length, 4);
  for (const name of ['import_evidence_bundle', 'export_evidence_bundle', 'compare_bundles', 'get_evidence_bundle']) assert.equal(getReaToolContract(name).nativeStatus, 'pending', `${name} session semantics remain pending`);
});

test('all 153 CLI contracts remain separate and every associated MCP operation exists', () => {
  assert.equal(index.commands.length, 153);
  assert.equal(full.commands.length, 153);
  assert.deepEqual(full.commands.map(x => x.name), index.commands.map(x => x.name));
  assert.deepEqual(catalog.cliCommands.map(x => x.name), index.commands.map(x => x.name));
  for (const command of catalog.cliCommands) {
    assert.deepEqual(command.schema, full.commands.find(upstream => upstream.name === command.name).schema, `${command.name} CLI schema preserved (including no-argument commands)`);
    assert.ok(command.sources.length, `${command.name} source provenance`);
    for (const tool of command.mcpTools) assert.ok(getReaToolContract(tool), `${command.name} -> ${tool}`);
  }
  assert.deepEqual(catalog.cliCommands.find(c => c.name === 'analyze').mcpTools, ['binary_overview', 'analyze_javascript_application']);
  assert.deepEqual(catalog.cliCommands.find(c => c.name === 'debug-with-gdb').mcpTools, ['start_gdb_session', 'gdb_console', 'close_gdb_session']);
  assert.equal(catalog.cliCommands.filter(command => command.nativeStatus === 'implemented-native-tested').length, 8);
  for (const [name, operation] of Object.entries({ 'inspect-evidence-bundle': 'inspect_evidence_bundle', compare: 'compare_evidence_bundle_files', 'evidence-import': 'validate_evidence_bundle_file', 'evidence-export': 'export_evidence_bundle_file' })) {
    const command = catalog.cliCommands.find(command => command.name === name);
    assert.equal(command.nativeStatus, 'implemented-native-tested');
    assert.equal(command.nativeOperation, operation);
  }
  assert.deepEqual(catalog.cliCommands.find(command => command.name === 'compare').aliases, ['compare-bundles']);
});

test('every local schema reference resolves within the preserved input/output schema root', () => {
  function walk(value, root, name) {
    if (!value || typeof value !== 'object') return;
    if (typeof value.$ref === 'string' && value.$ref.startsWith('#/')) {
      const resolved = value.$ref.slice(2).split('/').map(segment => segment.replaceAll('~1', '/').replaceAll('~0', '~')).reduce((node, key) => node?.[key], root);
      assert.notEqual(resolved, undefined, `${name}: ${value.$ref}`);
    }
    for (const child of Object.values(value)) walk(child, root, name);
  }
  for (const tool of raw.tools) for (const field of ['inputSchema', 'outputSchema']) walk(tool[field], tool[field], `${tool.name}.${field}`);
});
