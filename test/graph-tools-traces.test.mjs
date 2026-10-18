import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { RedTeamStore } from '../lib/store.js';
import { GraphTraceRuntime } from '../lib/graph-tools/traces.js';

async function fixture(t) {
  const dir = await mkdtemp(join(tmpdir(), 'dsh-graph-traces-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const store = new RedTeamStore(join(dir, 'store.json'));
  const indirect = await store.createManagedTask({ title: 'indirect', goal: 'fixture', seedFirstIntent: false });
  const source = await store.createManagedTask({ title: 'source', goal: 'fixture', sourceTaskIds: [indirect.id], seedFirstIntent: false });
  const task = await store.createManagedTask({ title: 'current', goal: 'fixture', sourceTaskIds: [source.id], seedFirstIntent: false });
  const intent = await store.addIntent({ taskId: task.id, summary: 'Current work', state: 'running', input: {} });
  return { store, runtime: new GraphTraceRuntime(store), task, source, indirect, intent };
}
const trace = (taskId, intentId, id, summary, data = {}, kind = 'tool') => ({ id, taskId, intentId, worker: 'worker-fixture', kind, summary, data, createdAt: '2026-01-01T00:00:00.000Z' });

test('trace summaries use ARTEX firstLine Unicode cap; detail IDs deduplicate before five-item cap and enforce both task and intent', async t => {
  const { store, runtime, task, intent, source } = await fixture(t);
  const other = await store.addIntent({ taskId: task.id, summary: 'Other', state: 'done', input: {} });
  await store.transaction(s => {
    for (let i = 1; i <= 7; i++) s.traces.push(trace(task.id, intent.id, `step-${i}`, i === 1 ? `  ${'😀'.repeat(101)}\nnot first line` : `step ${i}`, { detail: `Full content ${i}\nSecond line` }));
    s.traces.push(trace(task.id, other.id, 'other-intent', 'private', { detail: 'other intent' }));
    s.traces.push(trace(source.id, intent.id, 'wrong-task', 'private', { detail: 'wrong task' }));
    s.traces.push(trace(task.id, intent.id, 'thinking', 'secret', { kind: 'thinking', detail: 'reasoning' }));
    s.traces.push(trace(task.id, intent.id, 'usage', 'tokens', { activityKind: 'usage', detail: 'tokens' }));
  });
  const before = store.snapshot();
  const summaries = runtime.getWorkerTrace(task.id, { intent_id: intent.id });
  assert.equal(summaries.steps.length, 7);
  assert.equal(summaries.steps[0].summary, '😀'.repeat(100) + '…');
  assert.equal('detail' in summaries.steps[0], false);
  const details = runtime.getWorkerTrace(task.id, { intent_id: intent.id, step_ids: ['', null, 0, 'step-3', 'step-3', 'step-1', 'step-2', 'step-4', 'step-5', 'step-6', 'step-7'] });
  assert.deepEqual(details.returned_step_ids, ['step-3', 'step-1', 'step-2', 'step-4', 'step-5']);
  assert.deepEqual(details.omitted_step_ids, ['step-6', 'step-7']);
  assert.deepEqual(details.steps.map(row => row.step_id), ['step-1', 'step-2', 'step-3', 'step-4', 'step-5']);
  assert.equal(details.steps[0].detail, 'Full content 1\nSecond line');
  assert.match(details.notice, /5/);
  assert.deepEqual(runtime.getWorkerTrace(task.id, { intent_id: intent.id, step_ids: ['other-intent', 'wrong-task', 'thinking', 'usage'] }).steps, []);
  assert.deepEqual(store.snapshot(), before, 'all query modes are read-only');
});

test('search uses summary and full detail, default limits, original ILIKE patterns, and excludes own and unbound traces', async t => {
  const { store, runtime, task, intent } = await fixture(t);
  const other = await store.addIntent({ taskId: task.id, summary: 'Other', state: 'running', input: {} });
  await store.transaction(s => {
    s.traces.push(trace(task.id, intent.id, 'own', 'Needle'));
    s.traces.push(trace(task.id, undefined, 'planner', 'Needle'));
    for (let i = 0; i < 501; i++) s.traces.push(trace(task.id, other.id, `hit-${i}`, 'action', { detail: `NEEDLE item_${i}` }));
  });
  assert.equal(runtime.getWorkerTrace(task.id, { intent_id: other.id }).steps.length, 500);
  assert.equal(runtime.getWorkerTrace(task.id, { intent_id: other.id, q: 'needle' }).steps.length, 100);
  assert.equal(runtime.getWorkerTrace(task.id, { intent_id: other.id, q: 'needle', limit: 2 }).steps.length, 2);
  assert.deepEqual(runtime.getWorkerTrace(task.id, { intent_id: other.id, q: 'item\\_0' }).steps.map(row => row.step_id), ['hit-0']);
  const hits = runtime.searchAllWorkerTraces(task.id, { q: 'Needle' }, intent.id).hits;
  assert.equal(hits.length, 100);
  assert.equal(hits[0].step_id, 'hit-0');
  assert.ok(hits.every(row => row.intent_id === other.id && !('detail' in row)));
  assert.equal(runtime.searchAllWorkerTraces(task.id, { q: 'NE%DLE', limit: 1 }, intent.id).hits.length, 1);
  assert.throws(() => runtime.searchAllWorkerTraces(task.id, { q: ' ' }), /q 必填/);
  assert.throws(() => runtime.getWorkerTrace(task.id, { intent_id: other.id, limit: 0.1 }), /integer/);
});

test('only direct terminal source intents are readable; reopening or removing source revokes history immediately', async t => {
  const { store, runtime, task, source, indirect } = await fixture(t);
  const rows = [];
  for (const state of ['done', 'blocked', 'exhausted', 'stopped', 'running', 'open', 'failed']) rows.push(await store.addIntent({ taskId: source.id, summary: state, state, input: {} }));
  const indirectIntent = await store.addIntent({ taskId: indirect.id, summary: 'indirect', state: 'done', input: {} });
  await store.transaction(s => {
    for (const row of [...rows, indirectIntent]) s.traces.push(trace(row.taskId, row.id, `trace-${row.state}-${row.taskId}`, 'shared needle', { detail: row.state }, 'result'));
    s.traces.push(trace(source.id, undefined, 'source-planner', 'shared needle'));
  });
  const search = runtime.searchAllWorkerTraces(task.id, { q: 'needle' });
  assert.equal(search.hits.length, 4);
  assert.ok(search.hits.every(row => row.inherited === true && row.source_task_id === source.id));
  for (const row of rows.slice(0, 4)) {
    assert.equal(runtime.getWorkerOutput(task.id, { intent_id: row.id }).final_text, row.state);
    assert.equal(runtime.getWorkerTrace(task.id, { intent_id: row.id }).inherited, true);
  }
  for (const row of [...rows.slice(4), indirectIntent]) assert.throws(() => runtime.getWorkerTrace(task.id, { intent_id: row.id }), /可读意图/);
  await store.updateIntent(rows[0].id, { state: 'running' });
  assert.throws(() => runtime.getWorkerOutput(task.id, { intent_id: rows[0].id }), /可读意图/);
  await store.transaction(s => { s.tasks.find(row => row.id === task.id).sourceTaskIds = []; });
  assert.equal(runtime.searchAllWorkerTraces(task.id, { q: 'needle' }).hits.length, 0);
});

test('work index is local newest-first then sources, skips unexecuted work and defaults to 50', async t => {
  const { store, runtime, task, source, intent } = await fixture(t);
  const at = '2026-01-01T00:00:00Z';
  await store.transaction(s => {
    for (let i = 0; i < 60; i++) s.intents.push({ id: `local-${i}`, taskId: task.id, summary: `Executed ${i}`, state: 'done', input: {}, createdAt: at, updatedAt: at });
    s.intents.push({ id: 'open', taskId: task.id, summary: 'Unexecuted', state: 'open', input: {}, createdAt: at, updatedAt: at });
    s.intents.push({ id: 'source-done', taskId: source.id, summary: 'Source executed', state: 'done', input: {}, createdAt: at, updatedAt: at });
  });
  const works = runtime.listWorkerTraces(task.id).works;
  assert.equal(works.length, 50);
  assert.equal(works[0].intent_id, 'local-59');
  const all = runtime.listWorkerTraces(task.id, { limit: 100 }).works;
  assert.equal(all.at(-2).intent_id, intent.id);
  assert.deepEqual(all.at(-1), { intent_id: 'source-done', summary: 'Source executed', state: 'done', inherited: true, source_task_id: source.id });
  assert.equal(runtime.listWorkerTraces(task.id, { q: ' SOURCE ' }).works.length, 1);
});

test('final result takes priority over newer text, falls back to text/summary, and preserves empty-source provenance', async t => {
  const { store, runtime, task, intent, source } = await fixture(t);
  assert.equal(runtime.getWorkerOutput(task.id, { intent_id: intent.id }), '（该 work 尚无任何输出）');
  const empty = await store.addIntent({ taskId: source.id, summary: 'empty', state: 'done', input: {} });
  assert.deepEqual(runtime.getWorkerOutput(task.id, { intent_id: empty.id }), { intent_id: empty.id, final_text: '（该 work 尚无任何输出）', source_task_id: source.id, inherited: true });
  await store.addTrace({ taskId: task.id, intentId: intent.id, worker: 'worker', kind: 'tool', summary: 'text', data: { activityKind: 'text', detail: 'partial conclusion' } });
  assert.equal(runtime.getWorkerOutput(task.id, { intent_id: intent.id }).final_text, 'partial conclusion');
  await store.addTrace({ taskId: task.id, intentId: intent.id, worker: 'worker', kind: 'result', summary: 'summary fallback', data: { detail: '', is_error: true } });
  await store.addTrace({ taskId: task.id, intentId: intent.id, worker: 'worker', kind: 'tool', summary: 'newer text', data: { kind: 'text', detail: 'later partial' } });
  const result = runtime.getWorkerOutput(task.id, { intent_id: intent.id });
  assert.equal(result.final_text, 'summary fallback');
  assert.equal(result.is_error, true);
});

test('native DSH tool and final event payloads expose their real content and correct tool error identity', async t => {
  const { store, runtime, task, intent } = await fixture(t);
  await store.transaction(s => { s.intents.find(row => row.id === intent.id).execution = { childSessionId: 'native-child', parentSessionId: 'parent', provider: 'spawn' }; });
  await store.recordWorkerEvent('native-child', 1, { kind: 'tool', summary: 'read_file', data: { event: 'tool/call', payload: { turn: 1, name: 'read_file', callId: 'call-1', arguments: '{"path":"fixture"}' } } });
  await store.recordWorkerEvent('native-child', 2, { kind: 'tool', summary: '工具执行结果', data: { event: 'tool/result', payload: { turn: 1, message: { role: 'tool', toolCallId: 'call-1', isError: true, content: [{ type: 'text', text: 'File unavailable' }] } } } });
  await store.recordWorkerEvent('native-child', 3, { kind: 'result', summary: 'DSH Worker 结束', data: { event: 'turn/end', payload: { turn: 1 } } }, { state: 'done', output: { turn: 1, content: [{ type: 'text', text: 'Verified conclusion' }, { type: 'thinking', text: 'never return' }] } });
  const steps = runtime.getWorkerTrace(task.id, { intent_id: intent.id }).steps;
  assert.deepEqual(steps.map(row => row.kind), ['tool_use', 'tool_result', 'result']);
  assert.equal(steps[1].tool, 'read_file');
  assert.equal(steps[1].is_error, true);
  const detail = runtime.getWorkerTrace(task.id, { intent_id: intent.id, step_ids: steps.map(row => row.step_id) }).steps;
  assert.deepEqual(detail.map(row => row.detail), ['{"path":"fixture"}', 'File unavailable', 'Verified conclusion']);
  assert.equal(runtime.getWorkerOutput(task.id, { intent_id: intent.id }).final_text, 'Verified conclusion');
  assert.equal(runtime.getWorkerTrace(task.id, { intent_id: intent.id, q: 'unavailable' }).steps.length, 1);
  await store.updateIntent(intent.id, { output: { turn: 2, content: [{ type: 'text', text: 'Later turn output' }] } });
  assert.equal(runtime.getWorkerTrace(task.id, { intent_id: intent.id, step_ids: [steps[2].step_id] }).steps[0].detail, '', 'never misattribute a later turn output to legacy history');
});
