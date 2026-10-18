import { readFile, stat, realpath } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const workerPaths = [
  'dist/composition/javascriptAnalysisWorkerProcess.js',
  'dist/hopper/HopperRegexWorker.js',
  'dist/evm/EvmoleInterfaceWorker.js',
  'dist/sqlite/SqliteDatabaseWorker.js',
  'dist/javascript/sourceMaps/SourceMapCodecProcess.js',
  'dist/browser/history/NodeCaptureProcess.js',
];
const dependencyAssets = {
  'frida': ['build/frida_binding.node'],
  '@lydell/node-pty': ['requireBinary.js', 'conpty_console_list_agent.js'],
  '@lydell/node-pty-win32-x64': ['conpty.node', 'conpty_console_list.node'],
  'evmole': ['dist/evmole_bg.wasm', 'dist/evmole.js'],
  'har-schema': ['lib/har.json'],
  'ajv': ['dist/refs/json-schema-draft-06.json'],
  'playwright-core': ['browsers.json', 'lib/server/electron/loader.js'],
};

async function packageDirectory(name, from) {
  const require = createRequire(join(from, 'package.json'));
  // Read metadata via Node's actual search paths, including ESM-only packages
  // which deliberately do not expose package.json or a require entry point.
  for (const search of require.resolve.paths(name)) {
    const directory = join(search, name);
    try {
      const pkg = JSON.parse(await readFile(join(directory, 'package.json'), 'utf8'));
      if (pkg.name !== name) throw new Error(`Unexpected package identity at ${directory}`);
      return directory;
    } catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
  throw new Error(`Package root not found: ${name}`);
}

async function fileRecord(base, relative) {
  try {
    const observed = await stat(join(base, relative));
    return { path: relative, exists: true, type: observed.isDirectory() ? 'directory' : 'file', bytes: observed.size };
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    return { path: relative, exists: false };
  }
}
async function digest(path) {
  const hash = createHash('sha256');
  for await (const bytes of createReadStream(path)) hash.update(bytes);
  return hash.digest('hex');
}

/** Read-only packaging audit. It does not load addons or launch providers. */
export async function auditRuntimeAssets(rootPath) {
  const root = await realpath(resolve(rootPath));
  const pkg = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));
  if (pkg.name !== 'rea-agents' || pkg.version !== '6.5.0') throw new Error('Expected the original rea-agents@6.5.0 package scope');
  const declaredAssets = pkg.files.filter(path => /^(bridge\/|native\/|scripts\/|third_party\/|licenses$|skills$|LICENSE$|THIRD_PARTY_NOTICES\.md$)/.test(path));
  const assets = await Promise.all([...new Set([...workerPaths, ...declaredAssets])].map(path => fileRecord(root, path)));
  const dependencies = [];
  const expected = { ...pkg.dependencies, ...pkg.optionalDependencies };
  if (process.platform === 'win32' && process.arch === 'x64') expected['@lydell/node-pty-win32-x64'] = '1.1.0';
  for (const [name, version] of Object.entries(expected)) {
    const optional = Object.hasOwn(pkg.optionalDependencies ?? {}, name);
    try {
      const directory = await packageDirectory(name, root);
      const metadata = JSON.parse(await readFile(join(directory, 'package.json'), 'utf8'));
      const files = await Promise.all((dependencyAssets[name] ?? []).map(path => fileRecord(directory, path)));
      dependencies.push({ name, version: metadata.version, expectedVersion: version, optional, root: await realpath(directory), matches: metadata.version === version, assets: files });
    } catch (error) {
      dependencies.push({ name, expectedVersion: version, optional, unavailable: error.message });
    }
  }
  const nativeManifest = JSON.parse(await readFile(join(root, 'native/windows/build/manifest.json'), 'utf8'));
  const nativeSha256 = await digest(join(root, 'native/windows/build/rea-windows-x64.node'));
  const workerMapping = pkg.imports?.['#javascript-analysis-worker'];
  const issues = [
    ...assets.filter(asset => !asset.exists).map(asset => `Missing runtime asset: ${asset.path}`),
    ...dependencies.filter(dep => !dep.optional && (dep.unavailable || !dep.matches || dep.assets.some(asset => !asset.exists))).map(dep => `Invalid required dependency: ${dep.name}`),
    ...(workerMapping !== './dist/composition/javascriptAnalysisWorkerProcess.js' ? ['JavaScript worker package import mapping differs'] : []),
    ...(nativeManifest.packageVersion !== pkg.version || nativeSha256 !== nativeManifest.artifactSha256 ? ['Windows native artifact version or digest mismatch'] : []),
  ];
  return {
    package: { name: pkg.name, version: pkg.version, root },
    node: { version: process.version, platform: process.platform, architecture: process.arch, napi: process.versions.napi },
    workerMapping, assets, dependencies,
    windowsNative: { ...nativeManifest, observedSha256: nativeSha256 },
    optionalUnavailable: dependencies.filter(dep => dep.optional && (dep.unavailable || !dep.matches || dep.assets.some(asset => !asset.exists))),
    issues, ok: issues.length === 0,
  };
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  if (!process.argv[2]) throw new Error('Usage: node audit.mjs <original-or-staged-rea-package-root>');
  const report = await auditRuntimeAssets(process.argv[2]);
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  if (!report.ok) process.exitCode = 1;
}
