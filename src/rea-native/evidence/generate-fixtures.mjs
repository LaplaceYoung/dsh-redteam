// Maintainer-only upstream oracle; normal tests and runtime never load REA.
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
const root = resolve(process.argv[2] ?? process.env.REA_UPSTREAM_ROOT ?? '');
const pkg = JSON.parse(await readFile(resolve(root, 'package.json'), 'utf8'));
if (pkg.name !== 'rea-agents' || pkg.version !== '6.5.0') throw new Error('Expected rea-agents@6.5.0');
const load = (path) => import(pathToFileURL(resolve(root, 'dist', path)).href);
const { createEvidence } = await load('domain/evidence.js');
const { createEvidenceBundle } = await load('domain/evidenceBundle.js');
const { inspectEvidenceBundle } = await load('application/investigation/InspectEvidenceBundle.js');
const { compareEvidenceBundlesCommand } = await load('application/EvidenceBundleCommands.js');
const fixtureDir = resolve(dirname(fileURLToPath(import.meta.url)), 'fixtures');
await mkdir(fixtureDir, { recursive: true });
const provider = { id: 'fixture', name: 'Offline test producer', version: '1' };
const target = { path: '/fixtures/program.bin', sha256: 'ab'.repeat(32), format: 'elf', architecture: 'x86_64' };
const record = (operation, result) => createEvidence(target, provider, { operation, parameters: {}, result, limitations: ['Fixture observation only.'] });
const records = [
  record('analyze_function', { procedure: { address: '0x1000', name: 'main' }, native_value_flow: { available: true, truncated: true, known_omitted_inputs: 3 } }),
  record('analyze_function', { procedure: { address: '0x2000', name: 'second' }, native_value_flow: { available: false, reason: 'Producer did not supply value flow.' } }),
  record('analyze_function', { procedure: { address: '0x3000' } }),
  record('analyze_function', { procedure: { address: '0x4000' }, native_value_flow: { broken: true } }),
  record('list_strings', { strings: ['hello', 'world'] }),
];
const full = createEvidenceBundle(records);
const reduced = createEvidenceBundle(records.slice(0, 1));
const write = (name, value) => writeFile(resolve(fixtureDir, name), JSON.stringify(value, null, 2) + '\n');
await write('bundle.json', full);
await write('reduced.json', reduced);
await write('summary.expected.json', inspectEvidenceBundle(full, { detail: 'summary' }).value);
await write('compare.expected.json', (await compareEvidenceBundlesCommand({ leftPath: resolve(fixtureDir, 'bundle.json'), rightPath: resolve(fixtureDir, 'reduced.json') })).value);
console.log('Created canonical five-record bundle and upstream summary/comparison oracle fixtures.');
