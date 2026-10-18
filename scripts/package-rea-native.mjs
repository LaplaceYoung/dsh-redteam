// Materialize the native package before building: npm's directory-link bundling
// preserves nested dependencies under src/, which breaks their runtime resolution.
import { access, mkdir, mkdtemp, readFile, rename, rm } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const npmCli = process.env.npm_execpath ?? process.argv[2];
if (!npmCli) throw new Error('Run npm run package:rea-native or pass npm-cli.js.');
const vendor = join(root, 'vendor');
await mkdir(vendor, { recursive: true });
// Use a per-invocation pack directory. `npm run build` may be started by the
// host verifier while an editor or another build is still running; sharing
// `vendor/` as npm's pack destination makes those runs race on the temporary
// un-hashed filename before it can be renamed.
const packDir = await mkdtemp(join(vendor, '.rea-pack-'));
async function npm(args, cwd, capture = false) {
  const env = { ...process.env };
  // npm run exports this config as an environment CLI option, which npm rejects
  // for project installs. Install scripts remain explicitly disabled below.
  delete env.npm_config_allow_scripts;
  const child = spawn(process.execPath, [npmCli, ...args], {
    cwd, env, windowsHide: true,
    stdio: ['ignore', capture ? 'pipe' : 'inherit', 'inherit'],
  });
  const chunks = [];
  if (capture) child.stdout.on('data', data => chunks.push(data));
  const code = await new Promise((accept, reject) => { child.once('error', reject); child.once('exit', accept); });
  if (code !== 0) throw new Error(`npm ${args[0]} exited ${code}`);
  return Buffer.concat(chunks).toString();
}
try {
const packed = JSON.parse(await npm(['pack', '--json', '--pack-destination', packDir], join(root, 'src/rea-native/session'), true))[0];
const packedPath = join(packDir, packed.filename);
const hash = createHash('sha256').update(await readFile(packedPath)).digest('hex');
const filename = packed.filename.replace(/\.tgz$/, `-${hash.slice(0, 12)}.tgz`);
const targetPath = join(vendor, filename);
try { await access(targetPath); await rm(packedPath, { force: true }); }
catch (error) {
  if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') {
    try { await rename(packedPath, targetPath); }
    catch (renameError) {
      // Another invocation may have published the identical content between
      // access() and rename(). Keep the already-published artifact and only
      // fail when the target still does not exist.
      try { await access(targetPath); await rm(packedPath, { force: true }); }
      catch { throw renameError; }
    }
  } else throw error;
}
const dependency = `file:vendor/${filename}`;
const manifest = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));
const lock = JSON.parse(await readFile(join(root, 'package-lock.json'), 'utf8'));
const pinned = lock.packages['node_modules/@dsh-redteam/rea-native-session'];
if (manifest.dependencies['@dsh-redteam/rea-native-session'] !== dependency || pinned?.integrity !== packed.integrity) {
  await npm(['install', '--ignore-scripts', '--no-audit', '--no-fund', '--prefer-offline', '--save-exact', dependency], root);
}
console.log(JSON.stringify({ nativePackage: filename, bytes: packed.size, integrity: packed.integrity }));
} finally {
  await rm(packDir, { recursive: true, force: true });
}
