import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile, readFile, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { deflateRawSync, zstdCompressSync, crc32 } from 'node:zlib';
import { SkillsRuntime, validSkillName, skillRelativePath } from '../lib/platform/skills.js';

async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'platform-skills-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  return { root, runtime: new SkillsRuntime({ root }) };
}
const md = (name = 'fixture', body = 'Use ${SKILL_DIR}/scripts/run.py') => `---\nname: ${name}\ndescription: fixture instructions\nmcps: [local-test]\n---\n${body}\n`;

// ZIP fixtures implement the public ZIP record format independently, using the
// runtime's zlib CRC implementation rather than the implementation under test.
function archive(files) {
  const locals = [], centrals = []; let offset = 0;
  for (const file of files) {
    const name = Buffer.isBuffer(file.name) ? file.name : Buffer.from(file.name);
    const raw = Buffer.from(file.body ?? ''), method = file.method ?? 8;
    const compressed = file.compressed ?? (method === 8 ? deflateRawSync(raw) : method === 93 || method === 20 ? zstdCompressSync(raw) : raw);
    const header = Buffer.alloc(30), central = Buffer.alloc(46);
    header.writeUInt32LE(0x04034b50, 0); header.writeUInt16LE(20, 4); header.writeUInt16LE(file.flags ?? 0, 6); header.writeUInt16LE(method, 8);
    header.writeUInt32LE(crc32(raw), 14); header.writeUInt32LE(compressed.length, 18); header.writeUInt32LE(raw.length, 22); header.writeUInt16LE(name.length, 26);
    central.writeUInt32LE(0x02014b50, 0); central.writeUInt16LE(0x0314, 4); central.writeUInt16LE(20, 6); central.writeUInt16LE(file.flags ?? 0, 8); central.writeUInt16LE(method, 10);
    central.writeUInt32LE(file.crc ?? crc32(raw), 16); central.writeUInt32LE(compressed.length, 20); central.writeUInt32LE(file.size ?? raw.length, 24); central.writeUInt16LE(name.length, 28);
    central.writeUInt32LE(file.attributes ?? 0, 38); central.writeUInt32LE(offset, 42);
    locals.push(header, name, compressed); centrals.push(central, name); offset += header.length + name.length + compressed.length;
  }
  const directory = Buffer.concat(centrals), end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(files.length, 8); end.writeUInt16LE(files.length, 10); end.writeUInt32LE(directory.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, directory, end]);
}

test('ARTEX names and relative paths accept Unicode and reject traversal and Windows aliases', () => {
  for (const name of ['web-recon', 'a', 'nuclei2', '中文技能', '端口扫描-x']) assert.equal(validSkillName(name), true, name);
  for (const name of ['', 'Web', '-lead', 'trail-', 'dou--ble', 'a/b', '1abc', '中\u202e文', 'a'.repeat(65)]) assert.equal(validSkillName(name), false, name);
  assert.equal(skillRelativePath('./参考/中文说明.md'), '参考/中文说明.md');
  for (const path of ['../secret', 'x/../../secret', '/abs', 'a//b', 'a\\b', '%2e%2e/a', '中\u202e文.md', 'a\u00a0b', 'a:stream', 'NUL', 'a.', 'a ']) assert.throws(() => skillRelativePath(path), /path/);
});

test('file CRUD and metadata updates preserve instruction body and unknown YAML fields', async t => {
  const { runtime } = await fixture(t);
  await runtime.create({ name: '中文技能', description: 'x: quoted safely', instructions: 'Do the actual procedure.', mcps: [' one ', ''] });
  await assert.rejects(runtime.create({ name: '中文技能', description: 'duplicate' }), { code: 'EEXIST' });
  const body = 'Body\r\nkeep this byte-for-byte\r\n';
  await runtime.writeFile('中文技能', 'SKILL.md', `---\nname: display-name\ndescription: before\ncustom:\n  nested: true\nmcps: old\n---\n${body}`);
  await runtime.updateMeta('中文技能', { description: 'after: yes', license: 'MIT', mcps: [' local ', ''] });
  const text = (await runtime.readFile('中文技能', 'SKILL.md')).toString();
  assert.ok(text.endsWith(body)); assert.match(text, /nested: true/);
  await runtime.mkdir('中文技能', 'empty-folder');
  await runtime.writeFile('中文技能', '参考/说明 文档.md', '真实内容');
  assert.deepEqual(await runtime.files('中文技能'), ['SKILL.md', 'empty-folder/', '参考/', '参考/说明 文档.md']);
  assert.equal((await runtime.readFile('中文技能', '参考/说明 文档.md')).toString(), '真实内容');
  const listed = (await runtime.list())[0];
  assert.equal(listed.directory, '中文技能'); assert.equal(listed.name, 'display-name'); assert.deepEqual(listed.mcps, ['local']);
  assert.equal(listed.description, 'after: yes');
  await runtime.deleteFile('中文技能', '参考'); assert.ok(!(await runtime.files('中文技能')).some(p => p.startsWith('参考')));
  await runtime.remove('中文技能'); assert.deepEqual(await runtime.list(), []);
});

test('actual load substitutes directory, returns MCPs, records hits/misses and survives restart', async t => {
  const { root, runtime } = await fixture(t);
  await runtime.create({ name: 'ledger', description: 'ledger', instructions: 'Read ${SKILL_DIR}/guide.md', mcps: ['fixture-mcp'] });
  const loaded = await runtime.load('ledger', { agentKey: 'worker', taskId: 't1', args: '中文' });
  assert.equal(loaded.content, `Read ${join(root, 'skills', 'ledger')}/guide.md\n\n## Additional context from the caller\n\n中文`);
  assert.deepEqual(loaded.mcps, ['fixture-mcp']);
  const other = new SkillsRuntime({ root });
  await Promise.all(Array.from({ length: 12 }, (_, i) => (i % 2 ? runtime : other).load('ledger', { agentKey: 'planner', taskId: 't1', sessionId: `s${i}` })));
  await assert.rejects(runtime.load('missing-skill', { agentKey: 'worker', taskId: 't2' }), /Unknown skill/);
  const restarted = new SkillsRuntime({ root });
  assert.equal((await restarted.usage('ledger')).length, 13);
  assert.equal((await restarted.usage('ledger')).at(-1).argsLen, 6);
  assert.deepEqual((await restarted.stats('t1')).map(s => [s.skill, s.calls, s.tasks, s.agents]), [['ledger', 13, 1, ['planner', 'worker']]]);
  assert.equal((await restarted.missing())[0].skill, 'missing-skill');
  assert.equal((await restarted.list())[0].calls, 13);
  assert.equal((await readFile(join(root, 'skill-usage.json'), 'utf8')).includes('中文'), false);
  await runtime.remove('ledger'); assert.equal((await restarted.stats())[0].calls, 13);
});

test('ledger corruption reports diagnostics but does not block a resolved skill', async t => {
  const { root, runtime } = await fixture(t);
  await runtime.create({ name: 'ledger', description: 'ledger', instructions: 'Do this' });
  await writeFile(join(root, 'skill-usage.json'), 'broken json');
  const errors = [], degraded = new SkillsRuntime({ root, onLedgerError: error => errors.push(error) });
  assert.equal((await degraded.load('ledger', { agentKey: 'worker' })).content, 'Do this');
  assert.equal(errors.length, 2);
  await assert.rejects(degraded.stats(), /JSON/);
});

test('ZIP import/export uses real files, retains binary bytes and prevents partial overwrite', async t => {
  const { root, runtime } = await fixture(t);
  const zip = archive([{ name: 'bundle/SKILL.md', body: md() }, { name: 'bundle/data.bin', body: Buffer.from([0, 255, 23]), method: 0 }, { name: '__MACOSX/._junk', body: 'ignored' }]);
  assert.deepEqual(await runtime.importZip(zip), { name: 'fixture', files: 2 });
  assert.deepEqual(await runtime.readFile('fixture', 'data.bin'), Buffer.from([0, 255, 23]));
  await assert.rejects(runtime.importZip(zip), /already exists/);
  const exported = await runtime.exportZip('fixture');
  const restored = new SkillsRuntime({ root: join(root, 'restored') });
  await restored.importZip(exported);
  assert.deepEqual(await restored.readFile('fixture', 'data.bin'), Buffer.from([0, 255, 23]));
  const hostile = archive([{ name: 'bundle/SKILL.md', body: md('fixture', 'replacement') }, { name: 'bundle/../escape', body: 'escape' }]);
  await assert.rejects(runtime.importZip(hostile, { overwrite: true }), /path/);
  assert.match((await runtime.readFile('fixture', 'SKILL.md')).toString(), /Use/);
  await runtime.importZip(archive([{ name: 'SKILL.md', body: md('fixture', 'replaced') }]), { overwrite: true });
  assert.deepEqual(await runtime.files('fixture'), ['SKILL.md']);
  assert.match((await runtime.load('fixture', { agentKey: 'worker' })).content, /replaced/);
});

test('ZIP supports Zstandard methods 20/93 and legacy GBK filenames', async t => {
  const { runtime } = await fixture(t);
  const gbkName = Buffer.concat([Buffer.from('bundle/'), Buffer.from([0xd6, 0xd0, 0xce, 0xc4]), Buffer.from('.md')]);
  await runtime.importZip(archive([{ name: 'bundle/SKILL.md', body: md(), method: 93 }, { name: gbkName, body: '中文内容', method: 20 }]));
  assert.equal((await runtime.readFile('fixture', '中文.md')).toString(), '中文内容');
});

test('ZIP supports bzip2 payloads produced by Python standard library', async t => {
  const { runtime } = await fixture(t);
  // Python 3.12: base64.b64encode(bz2.compress(b'bzip2 payload'))
  const compressed = Buffer.from('QlpoOTFBWSZTWbbON54AAAIZgEAAEAA0JMAwIAAiAA9QgGmmht1roA6jxdyRThQkLbON54A=', 'base64');
  await runtime.importZip(archive([{ name: 'SKILL.md', body: md() }, { name: 'payload.txt', body: 'bzip2 payload', method: 12, compressed }]));
  assert.equal((await runtime.readFile('fixture', 'payload.txt')).toString(), 'bzip2 payload');
  await assert.rejects(runtime.importZip(archive([{ name: 'SKILL.md', body: md() }, { name: 'payload.txt', body: 'bzip2 payload', size: 0, method: 12, compressed }])), /exceeds declared limit/);
});

test('ZIP64 end records retain the same bounded extraction behavior', async t => {
  const { runtime } = await fixture(t);
  const original = archive([{ name: 'SKILL.md', body: md() }]);
  const oldEnd = original.subarray(-22), end = Buffer.from(oldEnd), offset = original.length - 22;
  const zip64 = Buffer.alloc(56), locator = Buffer.alloc(20);
  zip64.writeUInt32LE(0x06064b50); zip64.writeBigUInt64LE(44n, 4); zip64.writeUInt16LE(45, 12); zip64.writeUInt16LE(45, 14);
  zip64.writeBigUInt64LE(1n, 24); zip64.writeBigUInt64LE(1n, 32); zip64.writeBigUInt64LE(BigInt(oldEnd.readUInt32LE(12)), 40); zip64.writeBigUInt64LE(BigInt(oldEnd.readUInt32LE(16)), 48);
  locator.writeUInt32LE(0x07064b50); locator.writeBigUInt64LE(BigInt(offset), 8); locator.writeUInt32LE(1, 16);
  end.writeUInt16LE(0xffff, 8); end.writeUInt16LE(0xffff, 10); end.writeUInt32LE(0xffffffff, 12); end.writeUInt32LE(0xffffffff, 16);
  await runtime.importZip(Buffer.concat([original.subarray(0, -22), zip64, locator, end]));
  assert.match((await runtime.load('fixture', { agentKey: 'worker' })).content, /scripts\/run.py/);
});

test('legacy metadata aliases and headerless ZIP skills remain usable', async t => {
  const { runtime } = await fixture(t);
  await runtime.importZip(archive([{ name: 'legacy/SKILL.md', body: '  Plain legacy instructions\n' }]));
  assert.equal((await runtime.load('legacy', { agentKey: 'worker' })).content, 'Plain legacy instructions');
  await runtime.writeFile('legacy', 'SKILL.md', '---\nname: legacy\nwhenToUse: legacy description\nmcp: local, second\n---\nDo it');
  assert.equal((await runtime.list())[0].description, 'legacy description');
  assert.deepEqual((await runtime.load('legacy', { agentKey: 'worker' })).mcps, ['local', 'second']);
});

test('ZIP rejects encryption, unsupported methods, links, CRC mismatch and declared bombs', async t => {
  const { runtime } = await fixture(t);
  for (const [file, expected] of [
    [{ flags: 1 }, /Encrypted/], [{ method: 9 }, /compression method 9/], [{ attributes: 0xa1ff0000 }, /symbolic link/],
    [{ crc: 123 }, /CRC/], [{ size: 21 << 20 }, /size exceeds/],
  ]) await assert.rejects(runtime.importZip(archive([{ name: 'SKILL.md', body: md(), ...file }])), expected);
  await assert.rejects(runtime.importZip(archive([{ name: 'SKILL.md', body: md() }, { name: './SKILL.md', body: md() }])), /Duplicate/);
  assert.deepEqual(await runtime.list(), []);
});

test('file operations reject a symlink that points outside managed skill directory', async t => {
  const { root, runtime } = await fixture(t);
  await runtime.create({ name: 'links', description: 'links' });
  await runtime.mkdir('links', 'real');
  await symlink(root, join(root, 'skills', 'links', 'escape'), process.platform === 'win32' ? 'junction' : 'dir');
  await assert.rejects(runtime.writeFile('links', 'escape/outside.txt', 'escape'), /Symbolic links/);
  await assert.rejects(runtime.files('links'), /Symbolic links/);
});
