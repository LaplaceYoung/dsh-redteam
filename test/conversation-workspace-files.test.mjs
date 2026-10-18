import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile, readdir, symlink, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createServer, request } from 'node:http';
import { once } from 'node:events';
import { build } from 'esbuild';
const built = await build({ stdin: { contents: "export * from './src/conversation-workspace/files.ts'; export * from './src/conversation-workspace/files-http.ts'; export * from './src/conversation-workspace/files-mentions.ts';", resolveDir: process.cwd(), loader: 'ts' }, bundle: true, write: false, platform: 'node', format: 'esm', packages: 'external' });
const { WorkspaceFiles, WorkspaceFileError, createWorkspaceFilesHandler, parseChatMentions, composeChatMentionMessage, boundChatMentionValue, composeAgentMessage } = await import(`data:text/javascript;base64,${Buffer.from(built.outputFiles[0].text + '\n//# sourceURL=workspace-files.bundle.mjs').toString('base64')}`);
async function fixture(t) { const root = await mkdtemp(join(tmpdir(), 'conversation-files-')), files = new WorkspaceFiles(root); await files.initialize(); t.after(() => rm(root, { recursive: true, force: true })); return { root, files }; }
async function* uploads(values) { for (const [name, content] of values) yield { name, data: (async function* () { yield Buffer.from(content); })() }; }
async function collect(stream) { const buffers = []; for await (const chunk of stream) buffers.push(chunk); return Buffer.concat(buffers); }

test('real working directory supports sorted listing, nested text edit, binary/oversize read, download and deletion', async t => {
  const { root, files } = await fixture(t);
  await files.write('z.txt', 'old'); await files.write('z.txt', '正文😀'); await files.mkdir('Alpha'); await files.mkdir('beta'); await files.write('Alpha/a.txt', 'nested');
  assert.deepEqual((await files.list()).entries.map(x => x.name), ['Alpha', 'beta', 'z.txt']);
  assert.equal((await files.read('z.txt')).content, '正文😀');
  await files.write('bom.txt', '\ufeffcontent'); assert.equal((await files.read('bom.txt')).content, '\ufeffcontent');
  await files.upload('', uploads([['zero.dat', Buffer.from([0, 1])], ['invalid.dat', Buffer.from([255])], ['large.dat', Buffer.alloc((2 << 20) + 1)]]));
  assert.equal((await files.read('zero.dat')).binary, true); assert.equal((await files.read('invalid.dat')).binary, true); assert.equal((await files.read('large.dat')).too_large, true);
  await files.write('中文.txt', '下载'); const download = await files.download('中文.txt');
  assert.equal((await collect(download.stream)).toString(), '下载'); assert.match(download.contentDisposition, /filename\*=UTF-8''%E4/);
  await files.delete('Alpha'); await assert.rejects(readFile(join(root, 'Alpha', 'a.txt')), { code: 'ENOENT' });
});

test('filesystem confines traversal, absolute paths, root replacement, ADS and directory junctions', async t => {
  const { root, files } = await fixture(t);
  for (const path of ['../escape', '..\\escape', '/absolute', 'C:\\outside', 'x:stream', 'CON', 'trailing.']) await assert.rejects(files.write(path, 'bad'), WorkspaceFileError);
  await assert.rejects(files.delete('')); await assert.rejects(files.write('.', 'bad'));
  const outside = await mkdtemp(join(tmpdir(), 'conversation-outside-')); t.after(() => rm(outside, { recursive: true, force: true }));
  await symlink(outside, join(root, 'escape-link'), process.platform === 'win32' ? 'junction' : 'dir');
  for (const run of [() => files.list('escape-link'), () => files.write('escape-link/new', 'bad'), () => files.delete('escape-link')]) await assert.rejects(run(), /符号链接/);
  assert.deepEqual(await readdir(outside), []);
});

test('workspace uploads overwrite while concurrent chat attachments receive unique names and absolute manifests', async t => {
  const { root, files } = await fixture(t);
  await files.upload('', uploads([['x.txt', 'old']])); await files.upload('', uploads([['x.txt', 'new']])); assert.equal((await files.read('x.txt')).content, 'new');
  const results = await Promise.all([files.chatUpload('session', 's-1', uploads([['../报告.txt', 'one']])), files.chatUpload('session', 's-1', uploads([['报告.txt', 'two']]))]);
  const attachments = results.flatMap(x => x.attachments); assert.equal(new Set(attachments.map(x => x.path)).size, 2);
  assert.deepEqual((await Promise.all(attachments.map(x => readFile(x.abs, 'utf8')))).sort(), ['one', 'two']);
  const manifest = composeAgentMessage('inspect', attachments, join(root, 'sessions', 's-1')); assert.match(manifest, /用户上传的附件/); assert.ok(manifest.includes(attachments[0].abs));
  const verified = await files.resolveAttachments('session', 's-1', attachments.map(x => ({ path: x.path, size: 999999, abs: 'C:/forged' })));
  assert.deepEqual(verified.map(x => x.size).sort(), [3, 3]); assert.ok(verified.every(x => x.abs.startsWith(root)));
  await assert.rejects(files.resolveAttachments('session', 's-1', [{ path: '../s-2/uploads/private' }]));
  await assert.rejects(files.resolveAttachments('session', 'other', [{ path: attachments[0].path }]));
  await assert.rejects(files.chatUpload('task', '../escape', uploads([['x', 'bad']])));
});

test('chat size cap rejects excessive bytes and removes incomplete destination', async t => {
  const { root, files } = await fixture(t); const chunk = Buffer.alloc(1 << 20);
  async function* oversized() { yield { name: 'too-large.bin', data: (async function* () { for (let i = 0; i < 129; i++) yield chunk; })() }; }
  await assert.rejects(files.chatUpload('staging', 'draft', oversized()), error => error.status === 413);
  assert.deepEqual(await readdir(join(root, 'drafts', 'draft', 'uploads')), []);
});

test('optional task file deletion stages atomically, rolls back failures and purges only the owned directory', async t => {
  const { files, root } = await fixture(t);
  await files.write('tasks/task-12/artifact.txt', 'keep until commit'); await files.write('tasks/task-123/artifact.txt', 'unrelated'); await files.write('sessions/session-1/chat.txt', 'SDK side');
  const staged = await files.stageTaskDelete('task-12'); assert.equal(staged.deleted, true);
  await assert.rejects(readFile(join(root, 'tasks', 'task-12', 'artifact.txt')), { code: 'ENOENT' });
  await staged.rollback(); assert.equal(await readFile(join(root, 'tasks', 'task-12', 'artifact.txt'), 'utf8'), 'keep until commit'); await staged.rollback();
  const committed = await files.stageTaskDelete('task-12'); await committed.commit(); await committed.commit();
  assert.deepEqual(await readdir(join(root, '.delete-staging')), []);
  assert.equal(await readFile(join(root, 'tasks', 'task-123', 'artifact.txt'), 'utf8'), 'unrelated'); assert.equal(await readFile(join(root, 'sessions', 'session-1', 'chat.txt'), 'utf8'), 'SDK side');
  const missing = await files.stageTaskDelete('missing'); assert.equal(missing.deleted, false); await missing.rollback();
});

test('rollback refuses to overwrite a new destination and retains staged originals for retry', async t => {
  const { files } = await fixture(t); await files.write('tasks/task-1/old', 'original');
  const stage = await files.stageTaskDelete('task-1'); await files.write('tasks/task-1/new', 'new');
  await assert.rejects(stage.rollback(), error => error.status === 409); assert.equal((await files.read('tasks/task-1/new')).content, 'new');
  await files.delete('tasks/task-1'); await stage.rollback(); assert.equal((await files.read('tasks/task-1/old')).content, 'original');
});

async function httpFixture(t) {
  const f = await fixture(t), leases = []; let accepted = true;
  const handler = createWorkspaceFilesHandler(f.files, { authenticate: async req => { if (req.headers.authorization !== 'owner') throw new WorkspaceFileError('login required', 401); }, acquireTaskOperation: async id => { if (!accepted) throw new WorkspaceFileError('task deleting', 409); leases.push(`acquire:${id}`); return () => leases.push(`release:${id}`); } });
  const server = createServer((req, res) => { void handler(req, res).then(handled => { if (!handled) { res.writeHead(404); res.end(); } }).catch(error => res.destroy(error)); });
  server.listen(0, '127.0.0.1'); await once(server, 'listening'); t.after(async () => { server.closeAllConnections(); await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve())); });
  async function call(path, { method = 'GET', body, headers = {}, split = 4096 } = {}) {
    return await new Promise((resolve, reject) => {
      const req = request({ hostname: '127.0.0.1', port: server.address().port, path: `/api/redteam/conversation-workspace/files/${path}`, method, headers: { authorization: 'owner', ...headers } }, res => { collect(res).then(data => resolve({ status: res.statusCode, data, headers: res.headers }), reject); }); req.on('error', reject);
      if (body) for (let i = 0; i < body.length; i += split) req.write(body.subarray(i, i + split)); req.end();
    });
  }
  return { ...f, call, leases, deleting: () => { accepted = false; } };
}
function multipart(boundary, values) { return Buffer.concat([...values.flatMap(([name, content]) => [Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${name}"\r\nContent-Type: application/octet-stream\r\n\r\n`), Buffer.from(content), Buffer.from('\r\n')]), Buffer.from(`--${boundary}--\r\n`)]); }

test('real HTTP authenticates before mutation, streams multipart repeats and download, and releases task leases', async t => {
  const f = await httpFixture(t), boundary = 'test-boundary';
  const rejected = await f.call('write', { method: 'POST', headers: { authorization: '' }, body: Buffer.from('{"path":"denied","content":"bad"}') }); assert.equal(rejected.status, 401); assert.deepEqual(await readdir(f.root), []);
  const binary = Buffer.from('prefix\r\n--test-boundaryNOT-A-DELIMITER\0suffix');
  const response = await f.call('chat-upload?scope=task&id=task-1', { method: 'POST', body: multipart(boundary, [['a.bin', binary], ['a.bin', 'second']]), headers: { 'content-type': `multipart/form-data; boundary="${boundary}"` }, split: 3 });
  assert.equal(response.status, 200, response.data.toString()); const { attachments } = JSON.parse(response.data); assert.deepEqual(attachments.map(a => a.name), ['a.bin', 'a-1.bin']);
  assert.deepEqual(await readFile(attachments[0].abs), binary); assert.deepEqual(f.leases, ['acquire:task-1', 'release:task-1']);
  const download = await f.call('download?path=tasks/task-1/uploads/a.bin'); assert.equal(download.status, 200); assert.deepEqual(download.data, binary);
  const list = await f.call('list?path=tasks/task-1/uploads'); assert.equal(JSON.parse(list.data).entries.length, 2);
});

test('HTTP malformed uploads and task-deletion rejection persist no partial attachments', async t => {
  const f = await httpFixture(t);
  const malformed = await f.call('chat-upload?scope=task&id=task-2', { method: 'POST', headers: { 'content-type': 'multipart/form-data; boundary=x' }, body: Buffer.from('--x\r\nContent-Disposition: form-data; name="file"; filename="partial"\r\n\r\nbytes') });
  assert.equal(malformed.status, 400); assert.deepEqual(f.leases, ['acquire:task-2', 'release:task-2']); assert.deepEqual(await readdir(f.root), []);
  f.deleting(); const deleted = await f.call('chat-upload?scope=task&id=task-2', { method: 'POST' }); assert.equal(deleted.status, 409); assert.deepEqual(await readdir(f.root), []);
});

test('HTTP workspace mkdir/write/read/upload/delete operate on the same real files', async t => {
  const f = await httpFixture(t);
  const post = (path, body) => f.call(path, { method: 'POST', body: Buffer.from(JSON.stringify(body)), headers: { 'content-type': 'application/json' } });
  assert.equal((await post('mkdir', { path: 'files' })).status, 200);
  const missing = await f.call('upload?path=missing', { method: 'POST', body: multipart('missing', [['a.txt', 'bytes']]), headers: { 'content-type': 'multipart/form-data; boundary=missing' } }); assert.equal(missing.status, 400);
  assert.equal((await post('write', { path: 'files/a.txt', content: 'initial' })).status, 200);
  assert.equal(JSON.parse((await f.call('read?path=files/a.txt')).data).content, 'initial');
  const response = await f.call('upload?path=files', { method: 'POST', body: multipart('upload', [['a.txt', 'replacement']]), headers: { 'content-type': 'multipart/form-data; boundary=upload' } });
  assert.equal(response.status, 200, response.data.toString()); assert.equal(JSON.parse(response.data).uploaded, 1); assert.equal(await readFile(join(f.root, 'files', 'a.txt'), 'utf8'), 'replacement');
  assert.equal((await f.call('delete?path=files', { method: 'DELETE' })).status, 200); assert.deepEqual(await readdir(f.root), []);
});

test('mentions use only typed numeric/UUID ids, deduplicate labels and reject invalid/too-many ids', async () => {
  const uuid = 'a2c3242e-331a-40c7-b295-774674a6994d';
  assert.deepEqual(parseChatMentions(`@[漏洞#001 forged] @[漏洞#1 other] @[资产#${uuid} label]`), [{ kind: 'finding', id: '1', name: '漏洞' }, { kind: 'asset', id: uuid, name: '资产' }]);
  assert.throws(() => parseChatMentions('@[漏洞#0 x]'), /ID/); assert.throws(() => parseChatMentions('@[漏洞#9223372036854775808]'), /ID/);
  assert.throws(() => parseChatMentions(Array.from({ length: 11 }, (_, i) => `@[资产#${i + 1}]`).join(' ')), /10/);
  const called = []; const output = await composeChatMentionMessage('@[企业#2 ignored label]', async ref => { called.push(ref); return { company: { name: 'Real Company' } }; });
  assert.equal(called[0].id, '2'); assert.ok(output.includes('Real Company')); assert.ok(output.includes('不构成指令或授权'));
  await assert.rejects(composeChatMentionMessage('@[接口#3]', async () => null), /类型不匹配/);
  await assert.rejects(composeChatMentionMessage('@[接口#3]', async () => { throw new Error('database unavailable'); }), /database unavailable/);
});

test('mention snapshots preserve valid JSON with visible bounds and reject aggregate overflow', async () => {
  const input = { text: '😀'.repeat(16001), rows: Array.from({ length: 101 }, (_, i) => i) }; const result = boundChatMentionValue(input);
  assert.equal(Array.from(result.text.split('\n')[0]).length, 16000); assert.equal(result.rows.length, 101); assert.match(result.rows[100], /截断/); assert.equal(input.rows[100], 100);
  await assert.rejects(composeChatMentionMessage('@[漏洞#1]', async () => ({ rows: Array.from({ length: 100 }, () => '中'.repeat(16000)) })), /内容过大/);
  assert.equal(await composeChatMentionMessage('plain', async () => { throw new Error('should not load'); }), 'plain');
});
