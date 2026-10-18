import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, mkdir, rmdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { RedTeamStore } from '../lib/store.js';
import { ArtexWorkflow } from '../lib/artex.js';

async function fixture(t) {
  const dir = await mkdtemp(join(tmpdir(), 'redteam-concurrency-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const path = join(dir, 'state.json');
  return { path, a: new RedTeamStore(path), b: new RedTeamStore(path) };
}

test('separate UI and agent stores see all concurrent writes', async (t) => {
  const { path, a, b } = await fixture(t);
  await Promise.all([a.load(), b.load()]);
  await Promise.all(Array.from({ length: 12 }, (_, i) => (i % 2 ? a : b).createTask(`task-${i}`, 'fixture')));
  const disk = JSON.parse(await readFile(path, 'utf8'));
  assert.equal(disk.tasks.length, 12);
  assert.deepEqual(a.snapshot(), disk);
  assert.deepEqual(b.snapshot(), disk);
});

test('concurrent workers claim each intent once and graph follows state', async (t) => {
  const { a, b } = await fixture(t);
  const first = new ArtexWorkflow(a);
  const second = new ArtexWorkflow(b);
  const task = await first.createTask('claim', 'fixture');
  const intent = await first.plan(task.id, 'one job');
  const claims = await Promise.all([first.claim(task.id, 'worker-a'), second.claim(task.id, 'worker-b')]);
  assert.equal(claims.filter(Boolean).length, 1);
  assert.equal(claims.find(Boolean).id, intent.id);
  const state = b.snapshot();
  assert.equal(state.traces.filter((trace) => trace.intentId === intent.id && trace.kind === 'start').length, 1);
  assert.equal(state.nodes.find((node) => node.id === intent.id).data.state, 'running');
  await first.finish(intent.id, { result: 'ok' });
  assert.equal(b.snapshot().nodes.find((node) => node.id === intent.id).data.state, 'done');
});

test('failed persistence does not publish state or poison later writes', async (t) => {
  const { path, a } = await fixture(t);
  await a.load();
  await mkdir(path);
  await assert.rejects(a.createTask('must not appear', 'fixture'));
  assert.equal(a.snapshot().tasks.length, 0);
  assert.equal(a.snapshot().version, 0);
  await rmdir(path);
  const task = await a.createTask('persisted', 'fixture');
  assert.deepEqual(JSON.parse(await readFile(path, 'utf8')).tasks.map((item) => item.id), [task.id]);
});

test('cold load and an immediate write preserve existing tasks', async (t) => {
  const { path, a } = await fixture(t);
  await writeFile(path, JSON.stringify({ version: 1, tasks: [{ id: 'existing', title: 'old', goal: 'fixture', status: 'draft', createdAt: '2026-01-01', updatedAt: '2026-01-01' }] }));
  await Promise.all([a.load(), a.createTask('new', 'fixture')]);
  assert.equal(a.snapshot().tasks.length, 2);
  assert.equal(a.snapshot().tasks[0].id, 'existing');
});

test('asset, evidence and finding records produce connected graph nodes', async (t) => {
  const { a, b, path } = await fixture(t);
  const task = await a.createTask('graph', 'fixture');
  const asset = await a.addAsset({ taskId: task.id, kind: 'domain', value: 'fixture.test', source: 'user', metadata: {} });
  const evidence = await a.addEvidence({ taskId: task.id, provider: 'worker', summary: 'response observation', raw: { status: 200 } });
  const finding = await a.addFinding({ taskId: task.id, vulnClass: 'fixture', severity: 'info', summary: 'observation', assetIds: [asset.id], evidenceIds: [evidence.id], status: 'open' });
  const snapshot = b.snapshot();
  const origin = snapshot.nodes.find((node) => node.taskId === task.id && node.data.origin === true);
  assert.ok(origin, 'task origin fact must remain in the graph');
  assert.equal(origin.kind, 'fact');
  assert.deepEqual(snapshot.nodes.filter((node) => node.id !== origin.id).map((node) => [node.id, node.kind]), [[asset.id, 'asset'], [evidence.id, 'evidence'], [finding.id, 'finding']]);
  assert.ok(snapshot.edges.some((edge) => edge.from === finding.id && edge.to === asset.id));
  assert.ok(snapshot.edges.some((edge) => edge.from === finding.id && edge.to === evidence.id));
  assert.deepEqual(JSON.parse(await readFile(path, 'utf8')).nodes, snapshot.nodes);
});
