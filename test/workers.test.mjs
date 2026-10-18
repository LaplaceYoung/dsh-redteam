import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Session, SessionId } from '@deepseek-ai/dsh-session';
import { WorkerRuntime } from '../lib/workers.js';
import { RedTeamStore } from '../lib/store.js';

// The DSH service is the external boundary; persistence, graph projection and
// native Session event creation/output folding are real in these adapter tests.
async function fixture(t, overrides = {}, concurrency = 4) {
  const dir = await mkdtemp(join(tmpdir(), 'redteam-workers-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const store = new RedTeamStore(join(dir, 'state.json'));
  const task = await store.createTask('Fixture', 'Inspect fixture');
  const intent = await store.addIntent({ taskId: task.id, summary: 'Inspect entry point', input: { target: 'fixture' } });
  const sessions = new Map();
  const delivered = [];
  const released = [];
  let runtime;
  const service = {
    getProvider: () => ({ prepareContinuable() {} }),
    resolveMaxDepth: () => 2,
    async startActivation(spec) {
      const session = Session.create(spec.childId);
      sessions.set(spec.childId, session);
      await runtime.observe(session, session.append('turn/start', { turn: 1 }));
      assert.equal(spec.delivery, 'parent');
      return { childId: spec.childId, messageId: 'initial-message', result: Promise.resolve() };
    },
    async sendMessage(parent, childId, content, options) { delivered.push({ parent, childId, content, options }); return 'steer-message'; },
    async drainChildren(parent, ids) { released.push({ parent, ids }); },
    ...overrides
  };
  runtime = new WorkerRuntime({ subagents: service }, store, concurrency);
  const parent = { id: SessionId('parent') };
  const signal = new AbortController().signal;
  return { store, task, intent, runtime, parent, signal, sessions, delivered, released };
}

test('start binds the native child before early events and records native final output', async (t) => {
  const f = await fixture(t);
  const result = await f.runtime.start(f.task.id, f.parent, f.signal);
  assert.equal(result.id, f.intent.id);
  assert.equal(result.state, 'running');
  assert.equal(result.execution.parentSessionId, f.parent.id);
  assert.equal(result.execution.messageId, 'initial-message');
  const session = f.sessions.get(result.execution.childSessionId);
  session.append('assistant/message', { turn: 1, step: 1, message: { id: 'answer', role: 'assistant', content: [{ type: 'text', text: 'Verified fixture result' }] }, stream: [] }, { surfaceOp: 'append' });
  const end = session.append('turn/end', { turn: 1, reason: { kind: 'completed' } });
  await f.runtime.observe(session, end);
  await f.runtime.observe(session, end);
  const state = f.store.snapshot();
  assert.equal(state.intents[0].state, 'done');
  assert.deepEqual(state.intents[0].output.content, [{ type: 'text', text: 'Verified fixture result' }]);
  assert.equal(state.nodes.find((item) => item.id === f.intent.id).data.state, 'done');
  assert.equal(state.traces.filter((item) => item.data?.event === 'turn/end').length, 1);
});

test('steer returns a native inbox receipt and rejects a different parent', async (t) => {
  const f = await fixture(t);
  const started = await f.runtime.start(f.task.id, f.parent, f.signal);
  const receipt = await f.runtime.steer(f.intent.id, 'Inspect exports next', f.parent, f.signal);
  assert.equal(receipt.messageId, 'steer-message');
  assert.equal(f.delivered[0].childId, started.execution.childSessionId);
  assert.deepEqual(f.delivered[0].content, [{ type: 'text', text: 'Inspect exports next' }]);
  await assert.rejects(f.runtime.steer(f.intent.id, 'wrong', { id: SessionId('other') }, f.signal), /different parent/);
  assert.equal(f.delivered.length, 1);
});

test('stop waits for DSH child teardown before reporting paused', async (t) => {
  let release;
  const teardown = new Promise((resolve) => { release = resolve; });
  const f = await fixture(t, { drainChildren: () => teardown });
  await f.runtime.start(f.task.id, f.parent, f.signal);
  const stopping = f.runtime.stop(f.intent.id, f.parent);
  assert.equal(f.store.snapshot().intents[0].state, 'running');
  release();
  assert.equal((await stopping).state, 'paused');
});

test('native startup failure is persisted and returned to the caller', async (t) => {
  const f = await fixture(t, { async startActivation() { throw new Error('provider failed'); } });
  await assert.rejects(f.runtime.start(f.task.id, f.parent, f.signal), /provider failed/);
  const intent = f.store.snapshot().intents[0];
  assert.equal(intent.state, 'blocked');
  assert.equal(intent.output.error, 'provider failed');
  assert.equal(f.released.length, 1);
});

test('missing continuable provider does not consume a frontier intent', async (t) => {
  const f = await fixture(t, { getProvider: () => undefined });
  await assert.rejects(f.runtime.start(f.task.id, f.parent, f.signal), /provider is unavailable/);
  assert.equal(f.store.snapshot().intents[0].state, 'open');
});

test('concurrent starts enforce capacity before native child publication', async (t) => {
  const f = await fixture(t, {}, 1);
  await f.store.addIntent({ taskId: f.task.id, summary: 'second', input: {} });
  const results = await Promise.allSettled([f.runtime.start(f.task.id, f.parent, f.signal), f.runtime.start(f.task.id, f.parent, f.signal)]);
  assert.equal(results.filter((item) => item.status === 'fulfilled').length, 1);
  assert.match(results.find((item) => item.status === 'rejected').reason.message, /concurrency limit/);
  assert.equal(f.sessions.size, 1);
  assert.equal(f.store.snapshot().intents.filter((item) => item.state === 'open').length, 1);
});

test('a native turn error records failure rather than successful completion', async (t) => {
  const f = await fixture(t);
  const started = await f.runtime.start(f.task.id, f.parent, f.signal);
  const session = f.sessions.get(started.execution.childSessionId);
  await f.runtime.observe(session, session.append('turn/end', { turn: 1, reason: { kind: 'error', error: { code: 'FIXTURE', message: 'Model request failed' } } }));
  assert.equal(f.store.snapshot().intents[0].state, 'blocked');
  assert.equal(f.store.snapshot().intents[0].output.reason.error.code, 'FIXTURE');
});

test('disposal releases only children started by this runtime', async (t) => {
  const f = await fixture(t);
  const started = await f.runtime.start(f.task.id, f.parent, f.signal);
  await f.runtime.dispose();
  assert.deepEqual(f.released, [{ parent: f.parent, ids: [started.execution.childSessionId] }]);
});

test('native output budget exhaustion preserves its distinct ARTEX state', async (t) => {
  const f = await fixture(t);
  const started = await f.runtime.start(f.task.id, f.parent, f.signal);
  const session = f.sessions.get(started.execution.childSessionId);
  await f.runtime.observe(session, session.append('turn/end', { turn: 1, reason: { kind: 'max-tokens' } }));
  assert.equal(f.store.snapshot().intents[0].state, 'exhausted');
  assert.equal(f.store.snapshot().intents[0].output.reason.kind, 'max-tokens');
});

test('task shutdown records the requested stopped state after native cancellation', async (t) => {
  const f = await fixture(t, { async drainChildren(parent, ids) {
    for (const id of ids) {
      const session = f.sessions.get(id);
      await f.runtime.observe(session, session.append('turn/end', { turn: 1, reason: { kind: 'aborted', reason: 'user' } }));
    }
  } });
  await f.runtime.start(f.task.id, f.parent, f.signal);
  await f.runtime.quiesceTask(f.task.id, 'stopped');
  assert.equal(f.store.snapshot().intents[0].state, 'stopped');
});

test('disposal aborts a child still being admitted and rejects later starts', async (t) => {
  let admitted;
  const admission = new Promise((resolve) => { admitted = resolve; });
  const f = await fixture(t, {
    async startActivation(spec) {
      admitted();
      await new Promise((_, reject) => {
        spec.signal.addEventListener('abort', () => reject(spec.signal.reason), { once: true });
        if (spec.signal.aborted) reject(spec.signal.reason);
      });
    }
  });
  const start = f.runtime.start(f.task.id, f.parent, f.signal);
  const rejected = assert.rejects(start, /disposed/);
  await admission;
  await f.runtime.dispose();
  await rejected;
  assert.equal(f.store.snapshot().intents[0].state, 'blocked');
  await assert.rejects(f.runtime.start(f.task.id, f.parent, f.signal), /disposed/);
});

test('a steering delivery failure does not create a successful receipt trace', async (t) => {
  const f = await fixture(t, { async sendMessage() { throw new Error('inbox unavailable'); } });
  await f.runtime.start(f.task.id, f.parent, f.signal);
  const traces = f.store.snapshot().traces.length;
  await assert.rejects(f.runtime.steer(f.intent.id, 'next', f.parent, f.signal), /inbox unavailable/);
  assert.equal(f.store.snapshot().traces.length, traces);
});

test('activation result capture failure is persisted even without a turn-end event', async (t) => {
  const result = Promise.withResolvers();
  const f = await fixture(t, { async startActivation(spec) { return { childId: spec.childId, messageId: 'initial-message', result: result.promise }; } });
  await f.runtime.start(f.task.id, f.parent, f.signal);
  result.reject(new Error('result capture failed'));
  await f.runtime.dispose();
  assert.equal(f.store.snapshot().intents[0].state, 'blocked');
  assert.equal(f.store.snapshot().intents[0].output.error, 'result capture failed');
});

test('a superseded activation failure cannot overwrite the later steering receipt', async (t) => {
  const result = Promise.withResolvers();
  const f = await fixture(t, { async startActivation(spec) { return { childId: spec.childId, messageId: 'initial-message', result: result.promise }; } });
  await f.runtime.start(f.task.id, f.parent, f.signal);
  await f.runtime.steer(f.intent.id, 'Continue', f.parent, f.signal);
  result.reject(new Error('previous activation failed'));
  await f.runtime.dispose();
  const intent = f.store.snapshot().intents[0];
  assert.equal(intent.execution.messageId, 'steer-message');
  assert.notEqual(intent.state, 'blocked');
});
