import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { RedTeamStore } from '../lib/store.js';
import { ArtexWorkflow } from '../lib/artex.js';
import { registerRedTeamTools } from '../lib/tools.js';

async function fixture(t) {
  const dir = await mkdtemp(join(tmpdir(), 'redteam-host-domain-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const store = new RedTeamStore(join(dir, 'store.json'));
  await store.load();
  return store;
}

test('task tool forwards ordered profile IDs through the injected atomic creator', async t => {
  const store = await fixture(t);
  const workflow = new ArtexWorkflow(store, input => store.createManagedTask(input, new Set(['primary', 'secondary'])));
  const tools = new Map();
  registerRedTeamTools({ tools: { register(tool) { tools.set(tool.name, tool); return () => tools.delete(tool.name); } } }, store, workflow);
  const create = args => tools.get('redteam_create_task').execute(args);
  const task = await create({ title: 'Profile chain', goal: 'Verify task settings', llm_profile_ids: ['secondary', 'primary'] });
  assert.deepEqual(task.llmChain.profiles.map(row => row.profileId), ['secondary', 'primary']);
  const before = store.snapshot();
  await assert.rejects(create({ title: 'Invalid chain', llm_profile_ids: ['deleted-profile'] }));
  assert.deepEqual(store.snapshot(), before);
  assert.equal(await tools.get('redteam_worker_claim').execute({ task_id: task.id, worker: 'idle' }), null);
});

test('finding updates preserve retained records and commit notifications with status transitions', async t => {
  const store = await fixture(t);
  const task = await store.createTask('Finding lifecycle', 'Review evidence');
  const intent = await store.addIntent({ taskId: task.id, summary: 'Inspect configuration', input: {} });
  const finding = await store.addFinding({ taskId: task.id, intentId: intent.id, vulnClass: 'configuration', severity: 'low', summary: 'Observed configuration', assetIds: [], evidenceIds: [], status: 'pending' });
  const original = store.snapshot();
  assert.equal(original.edges.filter(edge => edge.from === intent.id && edge.to === finding.id && edge.relation === 'yields').length, 1);
  await assert.rejects(store.updateFindingAtomic(finding.id, (state, row) => {
    row.report = 'must roll back';
    return { evidenceIds: ['missing-evidence'] };
  }));
  assert.deepEqual(store.snapshot(), original);
  await store.transaction(state => { state.tasks = []; });
  const changed = await store.updateFinding(finding.id, { status: 'risk_accepted' });
  assert.equal(changed.status, 'risk_accepted');
  assert.equal(store.snapshot().notificationEvents.length, original.notificationEvents.length + 1);
  const count = store.snapshot().notificationEvents.length;
  await store.updateFinding(finding.id, { status: 'risk_accepted' });
  assert.equal(store.snapshot().notificationEvents.length, count);
  await assert.rejects(store.addFinding({ taskId: task.id, vulnClass: 'configuration', severity: 'low', summary: 'No live task', assetIds: [], evidenceIds: [], status: 'pending' }));
});
