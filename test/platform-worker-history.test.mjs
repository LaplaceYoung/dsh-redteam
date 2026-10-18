import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Session, SessionId } from '@deepseek-ai/dsh-session';
import { WorkerRuntime } from '../lib/workers.js';
import { RedTeamStore } from '../lib/store.js';
import { GraphTraceRuntime } from '../lib/graph-tools/traces.js';

test('two native Worker turns retain independent final text and omit reasoning from activities', async t => {
  const root = await mkdtemp(join(tmpdir(), 'platform-history-')); t.after(() => rm(root, { recursive: true, force: true }));
  const store = new RedTeamStore(join(root, 'state.json')); const task = await store.createTask('history', 'preserve text');
  const intent = await store.addIntent({ taskId: task.id, summary: 'fixture', input: {} }); let runtime, session;
  const parent = { id: SessionId('parent-history') };
  const subagents = { getProvider: () => ({ prepareContinuable() {} }), resolveMaxDepth: () => 2, async startActivation(spec) { session = Session.create(spec.childId); return { childId: spec.childId, messageId: 'one', result: Promise.resolve() }; }, async drainChildren() {}, async sendMessage() { return 'two'; } };
  runtime = new WorkerRuntime({ subagents }, store, 1); t.after(() => runtime.dispose());
  await runtime.start(task.id, parent, new AbortController().signal);
  for (const turn of [1, 2]) {
    await runtime.observe(session, session.append('turn/start', { turn }));
    const message = session.append('assistant/message', { turn, step: 1, message: { id: `answer-${turn}`, role: 'assistant', content: [{ type: 'thinking', text: `private-${turn}` }, { type: 'text', text: `visible turn ${turn}\nfull detail ${turn}` }] }, stream: [] }, { surfaceOp: 'append' });
    await runtime.observe(session, message);
    await runtime.observe(session, session.append('turn/end', { turn, reason: { kind: 'completed' } }));
  }
  const traces = store.snapshot().traces;
  const finals = traces.filter(row => row.data?.event === 'turn/end');
  assert.deepEqual(finals.map(row => row.data.detail), ['visible turn 1\nfull detail 1', 'visible turn 2\nfull detail 2']);
  assert.equal(traces.filter(row => row.data?.activityKind === 'text').length, 2);
  assert.ok(traces.every(row => !JSON.stringify(row).includes('private-')));
  const query = new GraphTraceRuntime(store);
  const detail = query.getWorkerTrace(task.id, { intent_id: intent.id, step_ids: finals.map(row => row.id) });
  assert.deepEqual(detail.steps.map(row => row.detail), finals.map(row => row.data.detail));
  assert.equal(query.getWorkerOutput(task.id, { intent_id: intent.id }).final_text, 'visible turn 2\nfull detail 2');
});
