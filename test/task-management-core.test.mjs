import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

async function loadSource(path) {
  const result = await build({ entryPoints: [path], bundle: true, platform: 'node', format: 'esm', write: false, packages: 'external' });
  const code = result.outputFiles[0].text.replace(/from\s+(["'])([^"']+)\1/g, (_m, _q, specifier) => `from ${JSON.stringify(import.meta.resolve(specifier))}`);
  return import(`data:text/javascript;base64,${Buffer.from(code + '\n//# sourceURL=task-management-core.bundle.mjs').toString('base64')}`);
}
const m = await loadSource('src/task-management/index.ts');
const { RedTeamStore } = await loadSource('src/store.ts');
const at = value => new Date(`2026-10-18T00:${value}:00.000Z`);
const state = () => ({ tasks: [], ...m.emptyTaskManagement() });
const task = (s, input = {}, now = at('00')) => m.createManagedTask(s, { title: '任务', description: '目标描述', goal: '核验目标', ...input }, now);
const rule = { enabled: true, action: 'block', kind: 'cidr', pattern: ' 192.0.2.0/24 ', note: '范围' };
const limit = { enabled: true, limit: 1 };

test('categories normalize identity, count live tasks and clear task/template references on delete', () => {
  const s = state(); const category = m.createTaskCategory(s, '  Web\n  Audit  ', at('00'));
  assert.equal(category.name, 'Web Audit');
  assert.throws(() => m.createTaskCategory(s, 'web audit'), { code: 'conflict' });
  const a = task(s); const b = task(s);
  const template = m.createTaskTemplate(s, { name: '模板', description: '描述', goal: '目标', categoryId: category.id });
  assert.deepEqual(m.setTasksCategory(s, [a.id, b.id, 'vanished'], category.id), [a.id, b.id]);
  assert.equal(m.listTaskCategories(s)[0].taskCount, 2);
  assert.throws(() => m.setTasksCategory(s, [a.id], 'missing'), { code: 'not_found' });
  assert.equal(a.categoryId, category.id);
  assert.equal(m.deleteTaskCategory(s, category.id), true);
  assert.equal(a.categoryId, null); assert.equal(b.categoryId, null); assert.equal(template.categoryId, null);
});

test('template PATCH preserves omitted fields, allows clear and copies creation-time rules', () => {
  const s = state(); const category = m.createTaskCategory(s, '研究');
  const template = m.createTaskTemplate(s, { name: '  HTTP  检查 ', description: ' description ', goal: ' goal ', categoryId: category.id, interceptRules: [rule] }, at('00'));
  assert.equal(template.name, 'HTTP 检查'); assert.equal(template.description, 'description');
  const created = m.createManagedTask(s, { templateId: template.id }, at('01'));
  assert.equal(created.description, 'description'); assert.equal(created.goal, 'goal'); assert.equal(created.categoryId, category.id);
  assert.equal(s.taskAssetRules[0].pattern, '192.0.2.0/24');
  m.patchTaskTemplate(s, template.id, { goal: 'new', categoryId: null, interceptRules: [] }, at('02'));
  assert.equal(template.description, 'description'); assert.equal(template.categoryId, null);
  assert.equal(created.goal, 'goal'); assert.equal(s.taskAssetRules.length, 1);
  assert.throws(() => m.patchTaskTemplate(s, template.id, {}), { code: 'invalid' });
  assert.throws(() => m.patchTaskTemplate(s, template.id, { description: '' }), { code: 'invalid' });
  assert.equal(template.description, 'description');
  assert.throws(() => m.createTaskTemplate(s, { name: 'http 检查', description: 'd', goal: 'g' }), { code: 'conflict' });
});

test('Unicode length counts code points and validation rejects malformed rule IP/CIDR', () => {
  const s = state(); m.createTaskCategory(s, '😀'.repeat(80));
  assert.throws(() => m.createTaskCategory(s, '😀'.repeat(81)), { code: 'invalid' });
  assert.throws(() => m.normalizeTaskRule({ ...rule, pattern: '192.0.2.0/33' }), { code: 'invalid' });
  assert.throws(() => m.normalizeTaskRule({ ...rule, kind: 'exact_ip', pattern: '999.1.1.1' }), { code: 'invalid' });
  assert.equal(m.normalizeTaskRule({ ...rule, pattern: '2001:db8::/32' }).pattern, '2001:db8::/32');
});

test('new task applies ARTEX defaults and preserves distinct description, title, company and source contracts', () => {
  const s = state(); const source = task(s);
  const created = m.createManagedTask(s, { title: ' 名称 ', description: '描述', sourceTaskIds: [source.id], companyIds: ['company', 'company'], timeoutSeconds: -1, planHeartbeatSeconds: 300, coverageEnabled: false }, at('00'), ['company']);
  assert.equal(created.title, '名称'); assert.equal(created.description, '描述'); assert.equal(created.timeoutSeconds, 0);
  assert.equal(created.planHeartbeatSeconds, 600); assert.equal(created.seedFirstIntent, false); assert.equal(created.coverageEnabled, false);
  assert.deepEqual(created.companyIds, ['company']);
  const count = s.tasks.length;
  assert.throws(() => task(s, { sourceTaskIds: [source.id, source.id] }), { code: 'invalid' });
  assert.throws(() => task(s, { sourceTaskIds: ['deleted'] }), { code: 'not_found' });
  assert.throws(() => task(s, { companyIds: ['missing'] }), { code: 'not_found' });
  assert.equal(s.tasks.length, count);
});

test('task creation validates the authoritative model registry and persists its ordered chain', () => {
  const s = state();
  assert.throws(() => m.createManagedTask(s, { llmProfileIds: ['missing'] }), /not found/);
  assert.equal(s.tasks.length, 0);
  const row = m.createManagedTask(s, { llmProfileIds: ['b', 'a'] }, at('00'), [], new Set(['a', 'b']));
  assert.deepEqual(row.llmChain.profiles.map(p => p.profileId), ['b', 'a']);
  assert.equal(row.llmChain.activeProfileId, 'b'); assert.equal(row.llmChain.revision, 0);
});

test('source inheritance is live, direct and read-only; active source intents never enter inherited context', () => {
  const s = state(); const root = task(s); const source = task(s, { sourceTaskIds: [root.id] }); const target = task(s, { sourceTaskIds: [source.id] });
  const rows = [
    { id: 'root-fact', taskId: root.id, kind: 'fact', data: { summary: 'indirect' } },
    { id: 'fact', taskId: source.id, kind: 'fact', data: { summary: 'v1' } },
    { id: 'running', taskId: source.id, kind: 'intent', state: 'running' },
    { id: 'done', taskId: source.id, kind: 'intent', state: 'done' },
    { id: 'local', taskId: target.id, kind: 'intent', state: 'running' },
  ];
  let view = m.recordsWithDirectSources(s, target.id, rows);
  assert.deepEqual(view.map(r => r.id), ['local', 'fact', 'done']);
  assert.equal(view[1].inherited, true); assert.equal(view[1].sourceTaskId, source.id);
  view[1].data.summary = 'changed view'; assert.equal(rows[1].data.summary, 'v1');
  rows[1].data.summary = 'v2'; assert.equal(m.recordsWithDirectSources(s, target.id, rows)[1].data.summary, 'v2');
  assert.throws(() => m.requireOwnedRecord(target.id, rows, 'done'), { code: 'conflict' });
  assert.equal(m.requireOwnedRecord(target.id, rows, 'local').id, 'local');
  s.tasks.splice(s.tasks.indexOf(source), 1);
  assert.deepEqual(m.recordsWithDirectSources(s, target.id, rows).map(r => r.id), ['local']);
});

test('task sources do not gate admission on completion', () => {
  const s = state(); const source = task(s); const target = task(s, { sourceTaskIds: [source.id] });
  m.admitManagedTask(s, target.id, limit);
  assert.equal(source.status, 'draft'); assert.equal(target.status, 'running'); assert.equal(target.queued, false);
});

test('FIFO re-admission is idempotent and paused queued task resumes at tail with bootstrap intact', () => {
  const s = state(); const holder = task(s); const a = task(s); const b = task(s);
  m.admitManagedTask(s, holder.id, limit, 'start', at('00'));
  m.admitManagedTask(s, a.id, limit, 'start', at('01')); const queuedAt = a.queuedAt;
  m.admitManagedTask(s, a.id, limit, 'start', at('02')); assert.equal(a.queuedAt, queuedAt);
  m.admitManagedTask(s, b.id, limit, 'start', at('02'));
  m.pauseManagedTask(s, a.id, at('03')); assert.equal(a.queued, false); assert.equal(a.queueMode, 'bootstrap');
  m.admitManagedTask(s, a.id, limit, 'resume', at('04'));
  m.finishManagedTask(s, holder.id, 'done', at('05'));
  assert.deepEqual(m.promoteQueuedTasks(s, limit, at('05')), [{ taskId: b.id, mode: 'bootstrap' }]);
  assert.equal(a.queued, true); assert.equal(a.firstRunAt, undefined);
  assert.throws(() => m.stampTaskFirstRun(s, a.id), { code: 'conflict' });
});

test('unavailable queued task does not block a ready task and lowering capacity never requeues active task', () => {
  const s = state(); const a = task(s); const b = task(s);
  const options = { ...limit, ready: t => t.id !== a.id };
  m.admitManagedTask(s, a.id, options); assert.equal(a.queued, true);
  m.admitManagedTask(s, b.id, options); assert.equal(b.queued, false);
  m.admitManagedTask(s, b.id, options); assert.equal(b.queued, false);
  m.finishManagedTask(s, b.id, 'done');
  assert.deepEqual(m.promoteQueuedTasks(s, options), []);
  assert.deepEqual(m.promoteQueuedTasks(s, limit), [{ taskId: a.id, mode: 'bootstrap' }]);
});

test('deadline starts at real call, survives pause/resume and timeout rerun gets a new clock', () => {
  const s = state(); const a = task(s, { timeoutSeconds: 120 });
  m.admitManagedTask(s, a.id, limit, 'start', at('00')); assert.equal(a.deadlineAt, undefined);
  m.stampTaskFirstRun(s, a.id, at('01')); assert.equal(a.deadlineAt, at('03').toISOString());
  m.pauseManagedTask(s, a.id, at('02'));
  assert.deepEqual(m.expiredTaskIds(s, at('03')), [a.id]);
  m.admitManagedTask(s, a.id, limit, 'resume', at('04')); m.stampTaskFirstRun(s, a.id, at('04'));
  assert.equal(a.deadlineAt, at('03').toISOString());
  assert.equal(m.finishManagedTask(s, a.id, 'timeout', at('04')), true);
  assert.equal(m.finishManagedTask(s, a.id, 'done', at('05')), false); assert.equal(a.status, 'timeout'); assert.equal(a.completedAt, at('04').toISOString());
  assert.throws(() => m.admitManagedTask(s, a.id, limit, 'resume'), { code: 'conflict' });
  m.admitManagedTask(s, a.id, limit, 'rerun', at('05')); assert.equal(a.deadlineAt, undefined); assert.equal(a.completedAt, undefined);
  m.stampTaskFirstRun(s, a.id, at('06')); assert.equal(a.deadlineAt, at('08').toISOString());
});

test('timeout rerun waiting behind another task preserves resume mode and leaves its fresh clock unstamped', () => {
  const s = state(); const a = task(s, { timeoutSeconds: 60 }); const b = task(s);
  m.admitManagedTask(s, a.id, limit); m.stampTaskFirstRun(s, a.id, at('00')); m.finishManagedTask(s, a.id, 'timeout', at('01'));
  m.admitManagedTask(s, b.id, limit); m.admitManagedTask(s, a.id, limit, 'rerun', at('02'));
  assert.equal(a.queueMode, 'resume'); assert.equal(a.deadlineAt, undefined); assert.equal(a.queued, true);
  m.pauseManagedTask(s, a.id); m.admitManagedTask(s, a.id, limit, 'resume');
  assert.equal(a.queueMode, 'resume');
  m.finishManagedTask(s, b.id, 'done');
  assert.deepEqual(m.promoteQueuedTasks(s, limit), [{ taskId: a.id, mode: 'resume' }]);
});

test('resuming a pre-call task with already decomposed goals does not bootstrap it again', () => {
  const s = state(); const a = task(s); const b = task(s);
  m.admitManagedTask(s, a.id, limit); m.pauseManagedTask(s, a.id); m.admitManagedTask(s, b.id, limit);
  m.admitManagedTask(s, a.id, { ...limit, hasGoals: t => t.id === a.id }, 'resume');
  assert.equal(a.firstRunAt, undefined); assert.equal(a.queueMode, 'resume');
});

test('provider outage releases the slot only once its active call finishes', () => {
  const s = state(); const a = task(s); const b = task(s);
  m.admitManagedTask(s, a.id, limit); m.stampTaskFirstRun(s, a.id, at('00')); m.admitManagedTask(s, b.id, limit);
  const options = { ...limit, ready: t => t.id !== a.id };
  assert.deepEqual(m.reconcileTaskAdmission(s, options, () => true), { parked: [], started: [] });
  assert.deepEqual(m.reconcileTaskAdmission(s, options, () => false), { parked: [a.id], started: [{ taskId: b.id, mode: 'bootstrap' }] });
  assert.equal(a.queueMode, 'resume'); assert.equal(a.firstRunAt, at('00').toISOString());
});

test('pinning keeps its original position and preserves task execution metadata', () => {
  const s = state(); const a = task(s, {}, at('00')); const b = task(s, {}, at('01'));
  m.patchTaskMetadata(s, a.id, { pinned: true }, at('02'));
  m.patchTaskMetadata(s, b.id, { pinned: true }, at('03'));
  m.patchTaskMetadata(s, a.id, { title: '更新名称', pinned: true }, at('04'));
  assert.equal(a.pinnedAt, at('02').toISOString()); assert.equal(a.status, 'draft');
  assert.deepEqual(m.listManagedTasks(s).map(t => t.id), [b.id, a.id]);
});

test('task asset policy CRUD prevents another task from editing the same rule', () => {
  const s = state(); const a = task(s); const b = task(s); const r = m.createTaskAssetRule(s, a.id, rule);
  assert.throws(() => m.toggleTaskAssetRule(s, b.id, r.id, false), { code: 'conflict' });
  m.updateTaskAssetRule(s, a.id, r.id, { ...rule, action: 'allow' }); assert.equal(r.action, 'allow');
  m.toggleTaskAssetRule(s, a.id, r.id, false); assert.equal(r.enabled, false);
  assert.equal(m.deleteTaskAssetRule(s, b.id, r.id), false); assert.equal(m.deleteTaskAssetRule(s, a.id, r.id), true);
});

test('shared durable store serializes disjoint template patches, capacity claims and terminal races', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'dsh-task-management-')); t.after(() => rm(dir, { recursive: true, force: true }));
  const path = join(dir, 'state.json'); const a = new RedTeamStore(path); const b = new RedTeamStore(path);
  const setup = await a.transaction(s => {
    m.initializeTaskManagement(s); const template = m.createTaskTemplate(s, { name: '模板', description: '描述', goal: '目标' });
    return { template, first: task(s), second: task(s) };
  });
  await Promise.all([
    a.transaction(s => m.patchTaskTemplate(s, setup.template.id, { description: '新描述' })),
    b.transaction(s => m.patchTaskTemplate(s, setup.template.id, { goal: '新目标' })),
  ]);
  await Promise.all([
    a.transaction(s => m.admitManagedTask(s, setup.first.id, limit)),
    b.transaction(s => m.admitManagedTask(s, setup.second.id, limit)),
  ]);
  const transitions = await Promise.all([
    a.transaction(s => m.finishManagedTask(s, setup.first.id, 'done')),
    b.transaction(s => m.finishManagedTask(s, setup.first.id, 'timeout')),
  ]);
  assert.deepEqual(transitions, [true, false]);
  const disk = JSON.parse(await readFile(path, 'utf8'));
  assert.equal(disk.taskTemplates[0].description, '新描述'); assert.equal(disk.taskTemplates[0].goal, '新目标');
  assert.equal(disk.tasks.find(t => t.id === setup.second.id).queued, true);
  assert.equal(disk.tasks.find(t => t.id === setup.first.id).status, 'done');
  assert.deepEqual(b.snapshot(), disk);
});
