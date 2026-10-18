import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, stat, rm, rename } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { zstdCompressSync } from 'node:zlib';
import tar from 'tar-stream';
import { RedTeamStore } from '../lib/store.js';
import { ArchiveRuntime } from '../lib/archives.js';

async function fixture(t, options = {}) {
  const dir = await mkdtemp(join(tmpdir(), 'dsh-archive-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const store = new RedTeamStore(join(dir, 'store.json'));
  await store.load();
  const task = await store.createTask('Archive fixture', 'Preserve task data and evidence');
  await store.setTaskStatus(task.id, 'paused');
  await mkdir(join(dir, 'tasks', task.id, 'nested'), { recursive: true });
  await writeFile(join(dir, 'tasks', task.id, 'nested', 'evidence.bin'), Buffer.from([0, 1, 255, 128, 13, 10]));
  const runtime = new ArchiveRuntime(store, { dataDir: dir, lifecycle: { quiesce: async () => {}, ...options } });
  return { dir, store, task, runtime };
}

test('archive streams tar.zst with all task relationships and files; restore consumes package', async (t) => {
  const { dir, store, task, runtime } = await fixture(t);
  const other = await store.createTask('Other task', 'Must stay live');
  const company = await store.addCompany({ name: 'Fixture company' });
  const asset = await store.addAsset({ taskId: task.id, kind: 'file', value: 'fixture.bin', source: 'user', metadata: {} });
  const evidence = await store.addEvidence({ taskId: task.id, provider: 'rea', summary: 'Evidence', raw: { bytes: [1, 2, 3] } });
  await store.addFinding({ taskId: task.id, vulnClass: 'fixture', severity: 'high', summary: 'Finding', assetIds: [asset.id], evidenceIds: [evidence.id], status: 'open' });
  await store.addScope({ taskId: task.id, companyId: company.id, kind: 'company', value: company.name, source: 'human' });
  await store.addTraffic({ taskId: task.id, host: 'fixture.test', method: 'GET', url: 'https://fixture.test/', status: 200, response: { body: 'hello' } });
  await store.addTraffic({ taskId: other.id, host: 'other.test', method: 'GET', url: 'https://other.test/' });
  await store.setReport(task.id, '# Real report');
  await store.transaction((state) => {
    const event = state.notificationEvents.find((event) => event.snapshot.taskId === task.id);
    assert.ok(event, 'finding records its notification event');
    state.notificationDeliveries.push({ id: 'delivery-fixture', eventId: event.id, channelId: 'channel-fixture', state: 'sent', attempts: 1, nextAttemptAt: task.createdAt, createdAt: task.createdAt, sentAt: task.createdAt });
  });
  const before = store.snapshot();
  const archive = await runtime.archive(task.id);
  assert.equal(archive.state, 'ready'); assert.equal(archive.progress, 100);
  assert.equal(archive.sha256.length, 64); assert.ok(archive.originalSize > 0); assert.ok(archive.compressedSize > 0);
  const header = await readFile(archive.archivePath); assert.equal(header.subarray(0, 4).toString('hex'), '28b52ffd');
  assert.equal(store.snapshot().tasks.some((row) => row.id === task.id), false);
  assert.equal(store.snapshot().tasks.some((row) => row.id === other.id), true);
  assert.equal(store.snapshot().traffic.length, 1);
  assert.equal(store.snapshot().notificationEvents.length, 0);
  assert.equal(store.snapshot().notificationDeliveries.length, 0);
  await assert.rejects(stat(join(dir, 'tasks', task.id)), { code: 'ENOENT' });
  await runtime.restore(archive.id);
  const restored = store.snapshot();
  for (const key of ['tasks', 'assets', 'nodes', 'edges', 'findings', 'evidence', 'scopes', 'traffic', 'reports', 'notificationEvents', 'notificationDeliveries']) {
    const byId = (rows) => [...rows].sort((a, b) => a.id.localeCompare(b.id));
    assert.deepEqual(byId(restored[key]), byId(before[key]), key);
  }
  assert.deepEqual(await readFile(join(dir, 'tasks', task.id, 'nested', 'evidence.bin')), Buffer.from([0, 1, 255, 128, 13, 10]));
  assert.equal(restored.archives.length, 0);
  await assert.rejects(stat(archive.archivePath), { code: 'ENOENT' });
});

test('archive failure preserves live rows and rolls back staged files', async (t) => {
  const { dir, store, task, runtime } = await fixture(t);
  const transaction = store.transaction.bind(store);
  store.transaction = async (mutator) => transaction((state) => {
    const result = mutator(state);
    if (state.archives.some((archive) => archive.state === 'ready')) throw new Error('fixture persistence failure');
    return result;
  });
  await assert.rejects(runtime.archive(task.id), /fixture persistence failure/);
  assert.equal(store.snapshot().tasks.length, 1);
  assert.equal(store.snapshot().archives[0].state, 'archive_failed');
  assert.ok(await readFile(join(dir, 'tasks', task.id, 'nested', 'evidence.bin')));
  await assert.rejects(stat(join(dir, 'archives', 'tasks', `${store.snapshot().archives[0].id}.tar.zst`)), { code: 'ENOENT' });
});

test('restore rejects tampering before installing files and supports explicit retry', async (t) => {
  const { dir, store, task, runtime } = await fixture(t);
  const archive = await runtime.archive(task.id);
  const original = await readFile(archive.archivePath);
  await writeFile(archive.archivePath, Buffer.concat([original, Buffer.from('tampered')]));
  await assert.rejects(runtime.restore(archive.id), /checksum mismatch/);
  assert.equal(store.snapshot().archives[0].state, 'restore_failed');
  await assert.rejects(stat(join(dir, 'tasks', task.id)), { code: 'ENOENT' });
  await writeFile(archive.archivePath, original);
  await runtime.restore(archive.id);
  assert.equal(store.snapshot().tasks[0].id, task.id);
});

test('restore conflict does not overwrite live files or commit database rows', async (t) => {
  const { dir, store, task, runtime } = await fixture(t);
  const archive = await runtime.archive(task.id);
  await mkdir(join(dir, 'tasks', task.id), { recursive: true });
  await writeFile(join(dir, 'tasks', task.id, 'keep.txt'), 'existing content');
  await assert.rejects(runtime.restore(archive.id), /destination already exists/);
  assert.equal(await readFile(join(dir, 'tasks', task.id, 'keep.txt'), 'utf8'), 'existing content');
  assert.equal(store.snapshot().tasks.length, 0);
  assert.ok(await stat(archive.archivePath));
});

test('failed restore database transaction rolls back installed files for retry', async (t) => {
  const { dir, store, task, runtime } = await fixture(t);
  const archive = await runtime.archive(task.id);
  const transaction = store.transaction.bind(store);
  store.transaction = (mutator) => transaction((state) => {
    const result = mutator(state);
    if (state.archives.some((row) => row.phase === 'consume_package')) throw new Error('restore commit failed');
    return result;
  });
  await assert.rejects(runtime.restore(archive.id), /restore commit failed/);
  assert.equal(store.snapshot().tasks.length, 0);
  await assert.rejects(stat(join(dir, 'tasks', task.id)), { code: 'ENOENT' });
  store.transaction = transaction;
  await runtime.restore(archive.id);
  assert.equal(store.snapshot().tasks[0].id, task.id);
});

test('running tasks cannot be archived and quiesce failure leaves original data', async (t) => {
  const { dir, store, task, runtime } = await fixture(t, { quiesce: async () => { throw new Error('active worker could not drain'); } });
  await store.setTaskStatus(task.id, 'running');
  await assert.rejects(runtime.archive(task.id), /must be paused or terminal/);
  assert.equal(store.snapshot().archives.length, 0);
  await store.setTaskStatus(task.id, 'paused');
  await assert.rejects(runtime.archive(task.id), /active worker could not drain/);
  assert.equal(store.snapshot().archives[0].state, 'archive_failed');
  assert.ok(await stat(join(dir, 'tasks', task.id)));
});

test('concurrent task changes prevent compaction and remain in live storage', async (t) => {
  let store;
  const f = await fixture(t, { files: async (taskId) => {
    await store.addAsset({ taskId, kind: 'host', value: 'late.test', source: 'user', metadata: {} }); return [];
  } });
  store = f.store;
  await assert.rejects(f.runtime.archive(f.task.id), /task changed while archiving/);
  assert.equal(store.snapshot().assets[0].value, 'late.test');
  assert.ok(await stat(join(f.dir, 'tasks', f.task.id)));
});

test('in-flight notification delivery prevents archiving until it settles', async (t) => {
  const { dir, store, task, runtime } = await fixture(t);
  await store.addFinding({ taskId: task.id, vulnClass: 'fixture', severity: 'high', summary: 'Finding', assetIds: [], evidenceIds: [], status: 'open' });
  await store.transaction((state) => state.notificationDeliveries.push({ id: 'in-flight', eventId: state.notificationEvents[0].id, channelId: 'channel', state: 'sending', attempts: 1, nextAttemptAt: task.createdAt, createdAt: task.createdAt }));
  await assert.rejects(runtime.archive(task.id), /deliveries in flight/);
  assert.equal(store.snapshot().notificationDeliveries[0].state, 'sending');
  assert.ok(await stat(join(dir, 'tasks', task.id)));
  await store.transaction((state) => { state.notificationDeliveries[0].state = 'sent'; state.notificationDeliveries[0].sentAt = task.createdAt; });
  assert.equal((await runtime.archive(task.id)).state, 'ready');
});

test('configured DSH session files retain their original root and contents', async (t) => {
  const { dir, store, task } = await fixture(t);
  const sessions = join(dir, 'dsh-sessions');
  await mkdir(sessions); await writeFile(join(sessions, 'child.jsonl'), '{"type":"turn/end"}\n');
  const runtime = new ArchiveRuntime(store, { dataDir: dir, fileRoots: { sessions }, lifecycle: { quiesce: async () => {}, files: async () => [{ root: 'sessions', path: 'child.jsonl' }] } });
  const archive = await runtime.archive(task.id);
  await assert.rejects(stat(join(sessions, 'child.jsonl')), { code: 'ENOENT' });
  await runtime.restore(archive.id);
  assert.equal(await readFile(join(sessions, 'child.jsonl'), 'utf8'), '{"type":"turn/end"}\n');
});

test('recovery rolls back interrupted file staging and resumes the archive job', async (t) => {
  const { dir, store, task, runtime } = await fixture(t);
  const archive = await store.addArchive({ taskId: task.id, state: 'archiving', progress: 10 });
  const stage = join(dir, 'archives', 'tasks', '.staging', archive.id);
  const target = join(stage, 'payload', 'files', 'data', 'tasks', task.id);
  await mkdir(join(target, '..'), { recursive: true });
  await writeFile(join(stage, 'journal.json'), JSON.stringify({ archiveId: archive.id, taskId: task.id, files: [{ root: 'data', path: `tasks/${task.id}` }] }));
  await rename(join(dir, 'tasks', task.id), target);
  await runtime.recover();
  assert.equal(store.snapshot().archives[0].state, 'ready');
  await runtime.restore(archive.id);
  assert.deepEqual(await readFile(join(dir, 'tasks', task.id, 'nested', 'evidence.bin')), Buffer.from([0, 1, 255, 128, 13, 10]));
});

test('delete removes cold package and archive record', async (t) => {
  const { store, task, runtime } = await fixture(t);
  const archive = await runtime.archive(task.id);
  await runtime.delete(archive.id);
  assert.equal(store.snapshot().archives.length, 0);
  assert.equal(store.snapshot().tasks.length, 0);
  await assert.rejects(stat(archive.archivePath), { code: 'ENOENT' });
});

test('recovery completes consumption after restore database commit without replaying rows', async (t) => {
  const { dir, store, task, runtime } = await fixture(t);
  const original = store.snapshot().tasks[0];
  const archive = await runtime.archive(task.id);
  await store.transaction((state) => { state.tasks.push(original); Object.assign(state.archives[0], { state: 'restoring', phase: 'consume_package', progress: 95 }); });
  const stage = join(dir, 'archives', 'tasks', '.restore', archive.id);
  await mkdir(stage, { recursive: true });
  await writeFile(join(stage, 'journal.json'), JSON.stringify({ archiveId: archive.id, taskId: task.id, files: [{ root: 'data', path: `tasks/${task.id}` }] }));
  await mkdir(join(dir, 'tasks', task.id), { recursive: true });
  await writeFile(join(dir, 'tasks', task.id, 'restored.txt'), 'already restored');
  await runtime.recover();
  assert.equal(store.snapshot().tasks.length, 1);
  assert.equal(store.snapshot().archives.length, 0);
  assert.equal(await readFile(join(dir, 'tasks', task.id, 'restored.txt'), 'utf8'), 'already restored');
  await assert.rejects(stat(archive.archivePath), { code: 'ENOENT' });
});

test('extract rejects a tar path traversal even with a matching package checksum', async (t) => {
  const { dir, store, task, runtime } = await fixture(t);
  const archive = await runtime.archive(task.id);
  const pack = tar.pack();
  const parts = [];
  const collected = (async () => { for await (const part of pack) parts.push(part); })();
  pack.entry({ name: '../../../../escape.txt' }, 'should never be written'); pack.finalize();
  await collected;
  const malicious = zstdCompressSync(Buffer.concat(parts));
  await writeFile(archive.archivePath, malicious);
  await store.transaction((state) => { state.archives[0].sha256 = createHash('sha256').update(malicious).digest('hex'); });
  await assert.rejects(runtime.restore(archive.id), /invalid archive path/);
  assert.equal(store.snapshot().tasks.length, 0);
  assert.equal(store.snapshot().archives[0].state, 'restore_failed');
  await assert.rejects(stat(join(dir, 'archives', 'escape.txt')), { code: 'ENOENT' });
});
