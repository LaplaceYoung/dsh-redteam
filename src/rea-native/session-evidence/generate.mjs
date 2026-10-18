// Reproduce vendored runtime from an explicitly selected installed REA 6.5.0.
import { build } from 'esbuild';
import { readFile, writeFile, mkdir, copyFile, realpath } from 'node:fs/promises';
import { resolve, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

const upstream = await realpath(resolve(process.argv[2] ?? process.env.REA_UPSTREAM_ROOT ?? ''));
const target = dirname(fileURLToPath(import.meta.url));
const pkg = JSON.parse(await readFile(resolve(upstream, 'package.json'), 'utf8'));
if (pkg.name !== 'rea-agents' || pkg.version !== '6.5.0') throw new Error('Expected an explicit rea-agents@6.5.0 package directory.');
const result = await build({
  absWorkingDir: upstream,
  entryPoints: [resolve(target, 'entry.mjs')],
  outfile: resolve(target, 'runtime.mjs'),
  bundle: true, platform: 'node', format: 'esm', target: 'node22',
  alias: { 'rea-upstream': upstream },
  metafile: true, legalComments: 'eof',
  banner: { js: '// REA 6.5.0 session Evidence ledger. See LICENSES and provenance.json.' },
});
await mkdir(resolve(target, 'LICENSES'), { recursive: true });
const sources = [];
const packages = new Set();
for (const input of Object.keys(result.metafile.inputs).sort()) {
  const absolute = resolve(upstream, input);
  const path = relative(upstream, absolute).replaceAll('\\', '/');
  const isAdapter = await realpath(absolute) === await realpath(resolve(target, 'entry.mjs'));
  if (path.startsWith('..') && !isAdapter) throw new Error(`Unexpected source outside upstream: ${path}`);
  sources.push({ path: isAdapter ? 'adapter/entry.mjs' : path, sha256: createHash('sha256').update(await readFile(absolute)).digest('hex') });
  const match = path.match(/^node_modules\/((?:@[^/]+\/)?[^/]+)\//);
  if (match) packages.add(match[1]);
}
await copyFile(resolve(upstream, 'LICENSE'), resolve(target, 'LICENSES/rea-agents.txt'));
const dependencies = [];
for (const name of [...packages].sort()) {
  const dependencyRoot = resolve(upstream, 'node_modules', name);
  const dependency = JSON.parse(await readFile(resolve(dependencyRoot, 'package.json'), 'utf8'));
  await copyFile(resolve(dependencyRoot, 'LICENSE'), resolve(target, 'LICENSES', name.replaceAll('/', '_') + '.txt'));
  dependencies.push({ name, version: dependency.version, license: dependency.license });
}
const runtime = await readFile(resolve(target, 'runtime.mjs'));
const references = [];
for (const path of ['dist/contracts/sessionToolContracts.js', 'dist/server/registerSessionRecordTools.js', 'dist/server/registerBundleComparisonTool.js', 'dist/application/binary/BinarySessionRecords.js']) {
  references.push({ path, sha256: createHash('sha256').update(await readFile(resolve(upstream, path))).digest('hex') });
}
await writeFile(resolve(target, 'provenance.json'), JSON.stringify({ name: pkg.name, version: pkg.version, license: pkg.license, runtime: { file: 'runtime.mjs', bytes: runtime.length, sha256: createHash('sha256').update(runtime).digest('hex') }, dependencies, sources, references }, null, 2) + '\n');
console.log(JSON.stringify({ output: 'src/rea-native/session-evidence/runtime.mjs', sourceFiles: sources.length, dependencies }));
