import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, writeFile, readFile, rm, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { TrafficArchiveRuntime } from '../lib/traffic-archive.js';
import { ArchiveRuntime } from '../lib/archives.js';
import { RedTeamStore } from '../lib/store.js';
import { TrafficDeletion } from '../lib/traffic-tools/deletion.js';

async function fixture(t) {
  const dir = await mkdtemp(join(tmpdir(), 'traffic-archive-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const store = new RedTeamStore(join(dir, 'state.json'));
  await store.load();
  const task = await store.createTask('Traffic', 'Preserve full binary bodies');
  const other = await store.createTask('Other', 'Shared evidence');
  await store.setTaskStatus(task.id, 'paused');
  const bytes = Buffer.alloc(300_000);
  for (let i = 0; i < bytes.length; i++) bytes[i] = i % 251;
  const hash = createHash('sha256').update(bytes).digest('hex');
  const root = join(dir, 'redteam', 'traffic', '_blobs', 'sha256');
  const path = join(root, hash.slice(0, 2), `${hash}.bin`);
  await mkdir(join(root, hash.slice(0, 2)), { recursive: true });
  await writeFile(path, bytes);
  for (const taskId of [task.id, other.id]) await store.addTraffic({ taskId, host: 'fixture.local', method: 'POST', url: 'https://fixture.local/', request: { bodySha256: hash, bodyLength: bytes.length } });
  const bodies = new TrafficArchiveRuntime(root);
  const archive = new ArchiveRuntime(store, { dataDir: dir, trafficBodies: bodies, lifecycle: { quiesce: async () => {} } });
  return { dir, root, path, bytes, hash, store, task, other, bodies, archive };
}

test('shared full binary traffic body survives archive and restores from package into empty storage', async t => {
  const f = await fixture(t);
  const job = await f.archive.archive(f.task.id);
  assert.deepEqual(await readFile(f.path), f.bytes, 'shared body remains available');
  assert.equal(f.store.snapshot().traffic[0].taskId, f.other.id);
  const newRoot = join(f.dir, 'restored-blobs');
  const restore = new ArchiveRuntime(f.store, { dataDir: f.dir, trafficBodies: new TrafficArchiveRuntime(newRoot), lifecycle: { quiesce: async () => {} } });
  await restore.restore(job.id);
  assert.deepEqual(await readFile(join(newRoot, f.hash.slice(0, 2), `${f.hash}.bin`)), f.bytes);
  assert.equal(f.store.snapshot().traffic.filter(row => row.request.bodySha256 === f.hash).length, 2);
});

test('existing identical blobs allow retry; conflicting bytes and corrupt packages refuse', async t => {
  const f = await fixture(t);
  const payload = join(f.dir, 'payload');
  await f.bodies.capture(payload, f.task.id, f.store.snapshot());
  await f.bodies.restore(payload, f.task.id);
  await writeFile(f.path, Buffer.alloc(f.bytes.length));
  await assert.rejects(f.bodies.restore(payload, f.task.id), /checksum mismatch/);
  assert.deepEqual(await readFile(f.path), Buffer.alloc(f.bytes.length), 'conflict not overwritten');
  await writeFile(f.path, f.bytes);
  await writeFile(join(payload, `${f.hash}.bin`), 'truncated');
  await assert.rejects(f.bodies.restore(payload, f.task.id), /size or file type mismatch/);
});

test('missing referenced blob fails archive without compacting task data', async t => {
  const f = await fixture(t);
  await rm(f.path);
  await assert.rejects(f.archive.archive(f.task.id), /ENOENT/);
  assert.ok(f.store.snapshot().tasks.some(row => row.id === f.task.id));
  assert.equal(f.store.snapshot().traffic.length, 2);
  assert.equal(f.store.snapshot().archives[0].state, 'archive_failed');
  await assert.rejects(stat(f.store.snapshot().archives[0].archivePath ?? join(f.dir, 'not-published')), /ENOENT/);
});

test('deleting the last old reference waits for restore to commit its restored body reference', { timeout: 10_000 }, async t => {
  const f = await fixture(t);
  await f.store.transaction(state => {
    state.traffic.find(row => row.taskId === f.other.id).host = 'other.local';
  });
  const job = await f.archive.archive(f.task.id);
  await rm(f.path);

  let bodyReady;
  let releaseCommit;
  const restoredBody = new Promise(resolve => { bodyReady = resolve; });
  const commitGate = new Promise(resolve => { releaseCommit = resolve; });
  const restore = new ArchiveRuntime(f.store, {
    dataDir: f.dir,
    trafficBodies: {
      capture: f.bodies.capture.bind(f.bodies),
      restore: async (...args) => {
        await f.bodies.restore(...args);
        bodyReady();
        await commitGate;
      },
    },
    lifecycle: { quiesce: async () => {} },
  });
  const restoring = restore.restore(job.id);
  await Promise.race([restoredBody, restoring.then(() => assert.fail('restore did not reach the body gate'))]);
  assert.deepEqual(await readFile(f.path), f.bytes);
  assert.equal(f.store.snapshot().traffic.length, 1, 'restored reference has not committed yet');

  // Forward to the real store while observing admission to the deletion transaction.
  // This catches an unlocked deletion before filesystem timing can hide the race.
  let deletionEntered = false;
  const deletion = new TrafficDeletion({
    storagePath: f.store.storagePath,
    snapshot: () => f.store.snapshot(),
    transaction: mutator => {
      deletionEntered = true;
      assert.ok(f.store.snapshot().traffic.some(row => row.taskId === f.task.id), 'deletion must wait for the restored reference');
      return f.store.transaction(mutator);
    },
  });
  const deleting = deletion.deleteHostsExact(['other.local']);
  // Attach the rejection handler immediately; preserve it for the final assertion.
  const deletionResult = deleting.then(value => ({ value }), error => ({ error }));
  try {
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(deletionEntered, false, 'deletion queues behind the paused restore');
    assert.equal(f.store.snapshot().traffic[0].taskId, f.other.id);
  } finally {
    releaseCommit();
    await restoring;
  }
  const result = await deletionResult;
  if (result.error) throw result.error;
  assert.equal(result.value.deleted, 1);
  assert.equal(result.value.blobReclaimed, 0);
  assert.deepEqual(f.store.snapshot().traffic.map(row => row.taskId), [f.task.id]);
  assert.deepEqual(await readFile(f.path), f.bytes, 'GC preserves the body now owned by the restored task');
});

test('archive quiesce can flush traffic before capture without reentering the traffic mutation lock', { timeout: 10_000 }, async t => {
  const f = await fixture(t);
  const archive = new ArchiveRuntime(f.store, {
    dataDir: f.dir,
    trafficBodies: f.bodies,
    lifecycle: {
      quiesce: async taskId => {
        assert.equal(taskId, f.task.id);
        await f.store.addTraffic({ taskId, host: 'flushed.local', method: 'GET', url: 'https://flushed.local/last' });
      },
    },
  });
  const job = await archive.archive(f.task.id);
  assert.equal(f.store.snapshot().traffic.some(row => row.taskId === f.task.id), false);
  await archive.restore(job.id);
  const restored = f.store.snapshot().traffic.filter(row => row.taskId === f.task.id);
  assert.equal(restored.length, 2);
  assert.ok(restored.some(row => row.url === 'https://flushed.local/last'), 'quiesce flush is included in the committed archive');
});
