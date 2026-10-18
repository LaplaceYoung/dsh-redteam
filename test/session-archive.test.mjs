import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { Context } from '@deepseek-ai/cordis';
import { SessionStore, SessionId } from '@deepseek-ai/dsh-session';
import * as Jsonl from '@deepseek-ai/dsh-session-persistence-jsonl';
import { SessionArchiveRuntime } from '../lib/session-archive.js';
import { ArchiveRuntime } from '../lib/archives.js';
import { RedTeamStore } from '../lib/store.js';

async function fixture(t) {
  const dir = await mkdtemp(join(tmpdir(), 'session-archive-'));
  const fibers = [];
  t.after(async () => { for (const fiber of fibers.reverse()) await fiber.dispose(); await rm(dir, { recursive: true, force: true }); });
  async function backend(name) {
    const app = new Context();
    fibers.push(await app.plugin(SessionStore));
    fibers.push(await app.plugin(Jsonl, { root: join(dir, name) }));
    return { app, store: app.get('sessions'), persistence: app.get('sessionPersistence') };
  }
  const source = await backend('source');
  const target = await backend('target');
  const parent = source.store.create(SessionId('parent'));
  parent.append('turn/start', { turn: 1 });
  parent.append('turn/end', { turn: 1, reason: { kind: 'completed' } });
  async function persist(session) {
    const writer = await source.persistence.create(session.header, { inheritedEventCount: session.inheritedEventCount });
    await writer.append(session.snapshotEvents());
    await writer.close();
  }
  await persist(parent);
  const parentRead = await source.persistence.open(parent.id, 'read');
  const seed = await parentRead.read();
  await parentRead.close();
  const child = source.store.create(SessionId('child'), { seed: seed.events, inheritedEventCount: seed.events.length,
    meta: { parentSession: parent.id, isSeeded: true, origin: 'subagent', delegationDepth: 1, agentPreset: 'redteam' } });
  child.append('turn/start', { turn: 2 });
  child.append('turn/end', { turn: 2, reason: { kind: 'completed' } });
  const nested = source.store.create(SessionId('nested'), { meta: { origin: 'subagent', delegationDepth: 2 } });
  nested.append('turn/start', { turn: 1 });
  nested.append('turn/end', { turn: 1, reason: { kind: 'completed' } });
  await persist(child);
  await persist(nested);
  const descendants = { async listDescendants(id) { assert.equal(id, 'child'); return [{ kind: 'child', id: nested.id, mode: 'continuable', label: 'nested', activity: 'inactive', hasChildren: false, parentId: child.id, depth: 1 }]; } };
  const store = new RedTeamStore(join(dir, 'state.json'));
  await store.load();
  const task = await store.createTask('Sessions', 'Archive complete DSH session logs');
  await store.setTaskStatus(task.id, 'paused');
  await store.transaction(state => state.intents.push({ id: 'intent', taskId: task.id, summary: 'Worker', state: 'done', input: {}, createdAt: task.createdAt, updatedAt: task.updatedAt, execution: { childSessionId: child.id, parentSessionId: parent.id, provider: 'fork' } }));
  const runtime = new SessionArchiveRuntime(source.persistence, descendants);
  const restore = new SessionArchiveRuntime(target.persistence, descendants);
  return { dir, source, target, parent, child, nested, store, task, runtime, restore, persist };
}

async function inspect(persistence, id) {
  const handle = await persistence.open(SessionId(id), 'read');
  try { return { meta: handle.header, inheritedEventCount: handle.inheritedEventCount, events: (await handle.read()).events }; }
  finally { await handle.close(); }
}

test('dedicated retest sessions and their parent are archived without a normal Worker binding', async t => {
  const f = await fixture(t);
  const retester = f.source.store.create(SessionId('retester'), { meta: { parentSession: f.parent.id, origin: 'subagent', delegationDepth: 1 } });
  retester.append('turn/start', { turn: 1 });
  retester.append('turn/end', { turn: 1, reason: { kind: 'completed' } });
  await f.persist(retester);
  const finding = await f.store.addFinding({ taskId: f.task.id, vulnClass: 'configuration', severity: 'info', summary: 'Retest archive fixture', assetIds: [], evidenceIds: [], status: 'pending' });
  await f.store.transaction(state => {
    state.intents = [];
    state.findings[0].retests = [{ id: 'retest', findingId: finding.id, sessionId: retester.id, status: 'running', notes: '', createdAt: finding.createdAt, snapshot: { finding, assets: [], constraints: [] } }];
  });
  const descendants = { listDescendants: async () => [] };
  const runtime = new SessionArchiveRuntime(f.source.persistence, descendants);
  const directory = join(f.dir, 'retest-payload');
  await assert.rejects(runtime.capture(directory, f.task.id, f.store.snapshot()), /retest is still active/);
  await f.store.transaction(state => { state.findings[0].retests[0].status = 'done'; });
  await runtime.capture(directory, f.task.id, f.store.snapshot());
  await new SessionArchiveRuntime(f.target.persistence, descendants).restore(directory, f.task.id);
  assert.deepEqual(await inspect(f.target.persistence, retester.id), await inspect(f.source.persistence, retester.id));
  assert.deepEqual(await inspect(f.target.persistence, f.parent.id), await inspect(f.source.persistence, f.parent.id));
  assert.equal(await f.target.persistence.stat(SessionId('child')), undefined);
});

test('real JSONL session handles preserve parent, fork cut and nested sessions through tar.zst restore', async t => {
  const f = await fixture(t);
  const archive = new ArchiveRuntime(f.store, { dataDir: f.dir, sessions: f.runtime, lifecycle: { quiesce: async () => {} } });
  const job = await archive.archive(f.task.id);
  for (const id of ['parent', 'child', 'nested']) assert.ok(await f.source.persistence.stat(SessionId(id)), 'archive retains host logs');
  const restore = new ArchiveRuntime(f.store, { dataDir: f.dir, sessions: f.restore, lifecycle: { quiesce: async () => {} } });
  await restore.restore(job.id);
  for (const id of ['parent', 'child', 'nested']) assert.deepEqual(await inspect(f.target.persistence, id), await inspect(f.source.persistence, id));
  assert.equal((await inspect(f.target.persistence, 'child')).inheritedEventCount, 2);
  assert.equal(f.store.snapshot().intents[0].execution.childSessionId, 'child');
});

test('identical retained logs and later parent events remain readable; conflicting events refuse without new writes', async t => {
  const f = await fixture(t);
  const payload = join(f.dir, 'payload');
  await f.runtime.capture(payload, f.task.id, f.store.snapshot());
  const next = f.parent.append('turn/start', { turn: 2 });
  const parentWriter = await f.source.persistence.open(f.parent.id, 'write');
  await parentWriter.append([next]);
  await parentWriter.close();
  await f.runtime.restore(payload, f.task.id);
  assert.equal((await inspect(f.source.persistence, 'parent')).events.length, 3);
  const original = await inspect(f.source.persistence, 'parent');
  const writer = await f.target.persistence.create(original.meta);
  await writer.append([{ ...original.events[0], time: original.events[0].time + 1 }]);
  await writer.close();
  await assert.rejects(f.restore.restore(payload, f.task.id), /event conflict.*parent/);
  assert.equal(await f.target.persistence.stat(SessionId('child')), undefined);
});

test('partial append can resume, and malformed inherited count or missing worker logs are errors', async t => {
  const f = await fixture(t);
  const payload = join(f.dir, 'payload');
  await f.runtime.capture(payload, f.task.id, f.store.snapshot());
  const original = await inspect(f.source.persistence, 'parent');
  const writer = await f.target.persistence.create(original.meta);
  await writer.append(original.events.slice(0, 1));
  await writer.close();
  await f.restore.restore(payload, f.task.id);
  assert.deepEqual(await inspect(f.target.persistence, 'parent'), original);
  const file = join(payload, '0.json');
  const child = JSON.parse(await readFile(file, 'utf8'));
  child.inheritedEventCount = child.events.length + 1;
  await writeFile(file, JSON.stringify(child));
  await assert.rejects(f.restore.restore(payload, f.task.id), /inherited event count/);
  child.inheritedEventCount = 1;
  await writeFile(file, JSON.stringify(child));
  await assert.rejects(f.restore.restore(payload, f.task.id), /fork boundary/);
  const missing = structuredClone(f.store.snapshot());
  missing.intents[0].execution.childSessionId = 'missing';
  const runtime = new SessionArchiveRuntime(f.source.persistence, { listDescendants: async () => [] });
  await assert.rejects(runtime.capture(join(f.dir, 'missing'), f.task.id, missing), /not found|does not exist/i);
  const unavailable = new SessionArchiveRuntime(f.source.persistence, { listDescendants: async () => [{ kind: 'diagnostic', id: 'nested', reason: 'unavailable' }] });
  await assert.rejects(unavailable.capture(join(f.dir, 'unavailable'), f.task.id, f.store.snapshot()), /cannot archive descendant nested: unavailable/);
});

