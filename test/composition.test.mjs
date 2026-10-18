import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { createUserMessage } from '@deepseek-ai/dsh-llm';
import { compositionFixture } from './helpers/composition-fixture.mjs';
import { lifecycleForAgent } from '../lib/task-management/runtime-scope.js';

test('agent surface mounts ARTEX/REA tools into a DSH context', { timeout: 40000 }, async t => {
  const f = await compositionFixture(t), agent = await f.createAgent();
  for (const name of ['redteam_rea_command', 'redteam_start_worker', 'redteam_dispatch_notifications', 'redteam_retry_notification']) {
    assert.ok(f.app.get('tools').get(name, agent), name);
    assert.equal(f.app.get('tools').get(name), undefined, `${name} must remain agent scoped`);
  }
  const task = await f.call(agent, 'redteam_create_task', { title: 'Mounted tools', goal: 'Fixture' }); assert.ok(task.id);
  agent.followup(createUserMessage({ content: [{ type: 'text', text: 'Confirm fixture' }], source: { kind: 'user' } })); await agent.whenIdle();
  for (const event of ['session/event', 'tools/pre-execute', 'tools/result']) assert.ok(f.observed.some(row => row.type === event), event);
  assert.ok(await f.app.get('sessionPersistence').stat(agent.id), 'real Agent session must be persisted');
});

test('ui surface exposes the snapshot route consumed by the native sidebar', { timeout: 40000 }, async t => {
  const f = await compositionFixture(t); await f.mountUi();
  assert.equal(f.app.get('tools').get('redteam_create_task'), undefined, 'UI does not install agent tools');
  assert.equal((await f.snapshot(null)).status, 401); assert.equal((await f.snapshot('Bearer fixture-guest')).status, 403);
  const response = await f.snapshot(); assert.equal(response.status, 200); assert.match(response.headers.get('content-type'), /application\/json/);
  assert.equal(response.body.tasks.length, 0);
  assert.deepEqual(f.admissions, [undefined, 'Bearer fixture-guest', 'Bearer fixture-owner'], 'HTTP must traverse connection.admit');
});

test('agent tool writes appear in an already mounted sidebar route', { timeout: 40000 }, async t => {
  const f = await compositionFixture(t); await f.mountUi();
  const agents = [await f.createAgent(), await f.createAgent()]; assert.notEqual(agents[0].id, agents[1].id);
  const tasks = await Promise.all(agents.map((agent, i) => f.call(agent, 'redteam_create_task', { title: `Agent ${i}`, goal: 'Fixture' })));
  const response = await f.snapshot(); assert.equal(response.status, 200);
  assert.deepEqual(new Set(response.body.tasks.map(task => task.id)), new Set(tasks.map(task => task.id)));
  const snapshot = await f.call(agents[1], 'redteam_snapshot'); assert.equal(snapshot.traces.length, 2);
  const persisted = JSON.parse(await readFile(f.storagePath, 'utf8'));
  assert.deepEqual(new Set(persisted.tasks.map(task => task.id)), new Set(tasks.map(task => task.id)));
});

test('a damaged store prevents plugin startup instead of serving an empty snapshot', { timeout: 40000 }, async t => {
  const f = await compositionFixture(t); await writeFile(f.storagePath, '{');
  await assert.rejects(f.mountUi(), SyntaxError);
  assert.equal(f.routes.has('/api/redteam/snapshot'), false, 'failed startup must not register an empty UI');
  assert.equal(await readFile(f.storagePath, 'utf8'), '{', 'failed startup must not overwrite corrupt data');
});

test('task deletion tool uses the caller lifecycle and preserves retained findings by default', { timeout: 40000 }, async t => {
  const f = await compositionFixture(t);
  const owner = await f.createAgent(), other = await f.createAgent();
  const task = await f.call(owner, 'redteam_create_task', { title: 'Delete through real tools', goal: 'Preserve evidence' });
  lifecycleForAgent(owner).bindParent(task.id, owner);
  const finding = await f.call(owner, 'redteam_record_finding', { task_id: task.id, vuln_class: 'configuration', severity: 'low', summary: 'Retained observation' });
  const denied = await f.app.get('tools').execute({ callId: 'foreign-delete', name: 'redteam_delete_task', arguments: { task_id: task.id }, agent: other, signal: AbortSignal.timeout(15000) });
  assert.equal(denied.isError, true);
  assert.ok((await f.call(owner, 'redteam_snapshot')).tasks.some(row => row.id === task.id));
  const result = await f.call(owner, 'redteam_delete_task', { task_id: task.id });
  assert.equal(result.deleted, true);
  assert.equal(result.findingsDeleted, 0);
  const snapshot = await f.call(owner, 'redteam_snapshot');
  assert.equal(snapshot.tasks.some(row => row.id === task.id), false);
  assert.ok(snapshot.findings.some(row => row.id === finding.id));
  assert.equal((await f.call(owner, 'redteam_delete_task', { task_id: task.id })).deleted, false);
});
