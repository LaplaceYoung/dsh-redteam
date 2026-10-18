// Reproduce the native application package from the selected, pinned MIT sources.
import { cp, mkdir, readFile, writeFile, readdir, realpath } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { join, dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

if (!process.argv[2]) throw new Error('Usage: node vendor.mjs <rea-agents@6.5.0 package root>');
const source = await realpath(resolve(process.argv[2]));
const destination = dirname(fileURLToPath(import.meta.url));
const metadata = JSON.parse(await readFile(join(source, 'package.json'), 'utf8'));
if (metadata.name !== 'rea-agents' || metadata.version !== '6.5.0') throw new Error('Expected rea-agents@6.5.0');
const upstream = join(destination, 'upstream');
await mkdir(upstream, { recursive: true });
const directories = ['dist', 'bridge', 'native', 'scripts', 'third_party', 'licenses', 'skills'];
for (const directory of directories) await cp(join(source, directory), join(upstream, directory), { recursive: true });
for (const name of ['LICENSE', 'THIRD_PARTY_NOTICES.md']) await cp(join(source, name), join(upstream, name));
await cp(join(source, 'LICENSE'), join(destination, 'LICENSE'));
await writeFile(join(upstream, 'package.json'), JSON.stringify({ name: metadata.name, version: metadata.version,
  type: 'module', imports: metadata.imports, license: metadata.license, files: metadata.files,
  dependencies: metadata.dependencies, optionalDependencies: metadata.optionalDependencies }, null, 2) + '\n');
await writeFile(join(destination, 'package.json'), JSON.stringify({
  name: '@dsh-redteam/rea-native-session', version: '6.5.0-dsh.1', private: true, type: 'module',
  description: 'REA application services and providers owned by DSH sessions; no REA transport or CLI entrypoint.',
  license: metadata.license, engines: metadata.engines,
  exports: {
    '.': { types: './runtime.d.mts', default: './runtime.mjs' },
    './prompts': { types: './prompts.d.mts', default: './upstream/dist/contracts/promptContracts.js' },
    './cli': { types: './cli/runtime.d.mts', default: './cli/runtime.mjs' },
    './upstream/*': './upstream/*',
  },
  files: ['runtime.mjs', 'runtime.d.mts', 'native-registrar.mjs', 'upstream', 'LICENSE', 'provenance.json', 'cli', 'prompts.d.mts'],
  dependencies: metadata.dependencies, optionalDependencies: metadata.optionalDependencies,
}, null, 2) + '\n');
const files = [];
async function walk(path) {
  for (const entry of await readdir(path, { withFileTypes: true })) {
    const item = join(path, entry.name);
    if (entry.isDirectory()) await walk(item);
    else {
      const bytes = await readFile(item);
      files.push({ path: relative(source, item).replaceAll('\\', '/'), bytes: bytes.length,
        sha256: createHash('sha256').update(bytes).digest('hex') });
    }
  }
}
for (const directory of directories) await walk(join(source, directory));
// This is the sole runtime substitution: a function registry, not an SDK server.
await writeFile(join(upstream, 'dist/server/EvidenceMcpServer.js'),
  "export { NativeRegistrar as EvidenceMcpServer, currentMcpRequestSignal } from '../../../native-registrar.mjs';\n");
await writeFile(join(destination, 'provenance.json'), JSON.stringify({
  package: metadata.name, version: metadata.version, license: metadata.license, sources: files,
  adaptations: [{ path: 'dist/server/EvidenceMcpServer.js', replacement: 'native-registrar.mjs',
    reason: 'Direct function dispatch and DSH request context replace the REA MCP server/transport.' }],
}, null, 2) + '\n');
console.log(JSON.stringify({ copiedFiles: files.length, sourceBytes: files.reduce((sum, file) => sum + file.bytes, 0) }));
