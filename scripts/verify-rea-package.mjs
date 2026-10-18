// Actual pack/install verification. Keeps its temporary directory and logs as evidence.
import { mkdtemp, mkdir, readFile, writeFile, copyFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const npmCli = process.env.npm_execpath ?? process.argv[2];
if (!npmCli) throw new Error('Run through npm exec or pass the absolute npm-cli.js path.');
const directory = await mkdtemp(join(tmpdir(), 'dsh-rea-package-'));
const reusedInstallation = process.argv[3] ? resolve(process.argv[3]) : undefined;
const installed = reusedInstallation ?? join(directory, 'installed');
if (!reusedInstallation) await mkdir(installed);
console.log(JSON.stringify({ directory }));
async function run(label, executable, args, cwd) {
  const invocation = args[0] === npmCli ? [npmCli, '--logs-dir', join(directory, 'npm-logs'), ...args.slice(1)] : args;
  const env = { ...process.env };
  delete env.npm_config_allow_scripts;
  const child = spawn(executable, invocation, { cwd, env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  const stdout = []; const stderr = [];
  child.stdout.on('data', data => stdout.push(data));
  child.stderr.on('data', data => stderr.push(data));
  const code = await new Promise((accept, reject) => { child.once('error', reject); child.once('exit', accept); });
  const output = Buffer.concat(stdout).toString();
  await writeFile(join(directory, `${label}.stdout.log`), output);
  await writeFile(join(directory, `${label}.stderr.log`), Buffer.concat(stderr));
  if (code !== 0) throw new Error(`${label} exited ${code}; see ${directory}`);
  return output;
}
const packed = JSON.parse(await run('pack', process.execPath, [npmCli, 'pack', '--json', '--pack-destination', directory], root))[0];
const archive = join(directory, packed.filename);
if (!reusedInstallation) await writeFile(join(installed, 'package.json'), JSON.stringify({ name: 'rea-installed-validation', private: true, type: 'module' }));
await run('install', process.execPath, [npmCli, 'install', '--ignore-scripts', '--omit=dev', '--no-audit', '--no-fund', '--prefer-offline', archive], installed);
await copyFile(join(root, 'scripts/verify-rea-installed.mjs'), join(installed, 'verify.mjs'));
const verification = JSON.parse(await run('runtime', process.execPath, ['verify.mjs'], installed));
const nativePrefix = 'node_modules/@dsh-redteam/rea-native-session/';
const compared = packed.files.filter(file => (file.path.startsWith(nativePrefix) && !file.path.slice(nativePrefix.length).startsWith('node_modules/'))
  || (!file.path.startsWith('node_modules/') && !file.path.startsWith('src/')));
const differences = [];
for (const file of compared) {
  const source = file.path.startsWith(nativePrefix) ? join(root, 'src/rea-native/session', file.path.slice(nativePrefix.length)) : join(root, file.path);
  const packaged = join(installed, 'node_modules/dsh-redteam', file.path);
  const [sourceBytes, packagedBytes] = await Promise.all([readFile(source), readFile(packaged)]);
  if (!sourceBytes.equals(packagedBytes)) differences.push(file.path);
}
const result = { directory, installed, reusedInstallation: reusedInstallation ?? null, archive, sha256: createHash('sha256').update(await readFile(archive)).digest('hex'),
  packedBytes: packed.size, unpackedBytes: packed.unpackedSize, fileCount: packed.entryCount,
  installFlags: ['--ignore-scripts', '--omit=dev'], verification,
  sourceComparison: { comparedFiles: compared.length, matchesCurrentSource: differences.length === 0, differences } };
await writeFile(join(directory, 'result.json'), JSON.stringify(result, null, 2) + '\n');
console.log(JSON.stringify(result, null, 2));
assert.equal(differences.length, 0, 'Installed package differs from current source; see result.json');
