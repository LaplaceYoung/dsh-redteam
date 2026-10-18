import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { Context } from '@deepseek-ai/cordis';
import { SessionStore, SessionId } from '@deepseek-ai/dsh-session';
import AgentRegistry from '@deepseek-ai/dsh-agent';
import AgentLoop from '@deepseek-ai/dsh-agent-loop';
import LlmRuntime, { LlmAdapter } from '@deepseek-ai/dsh-llm';
import SystemPrompt from '@deepseek-ai/dsh-system-prompt';
import ToolRuntime from '@deepseek-ai/dsh-tools';
import SessionProjections from '@deepseek-ai/dsh-session-projection';
import LocalFileSystem from '@deepseek-ai/dsh-fs-local';
import WorkingDirectory from '@deepseek-ai/dsh-working-directory';
import * as JsonlPersistence from '@deepseek-ai/dsh-session-persistence-jsonl';
import SessionQuery from '@deepseek-ai/dsh-session-query-sqlite';
import Subagents from '@deepseek-ai/dsh-subagent';
import * as spawnProvider from '@deepseek-ai/dsh-subagent-spawn-in-process';
import * as forkProvider from '@deepseek-ai/dsh-subagent-fork-in-process';
import { WorkerRuntime } from '../lib/workers.js';
import { RedTeamStore } from '../lib/store.js';

class Model extends LlmAdapter {
  calls = 0;
  hold;
  async *stream(options) {
    this.calls++;
    if (this.hold) {
      this.hold.entered.resolve();
      await Promise.race([this.hold.release.promise, new Promise((_, reject) => options.signal.addEventListener('abort', () => reject(options.signal.reason), { once: true }))]);
    }
    yield { type: 'block-start', index: 0, blockType: 'text' };
    yield { type: 'text-delta', index: 0, text: 'Durable worker result' };
    yield { type: 'block-end', index: 0, block: { type: 'text', text: 'Durable worker result' } };
    yield { type: 'finish', reason: { kind: 'stop' } };
  }
}

async function fixture(t, held = false, provider = 'spawn') {
  const dir = await mkdtemp(join(tmpdir(), 'worker-recovery-'));
  const app = new Context();
  const fibers = [];
  let parentHandle;
  let runtime;
  const eventWork = new Set();
  t.after(async () => {
    await runtime?.dispose();
    await parentHandle?.dispose();
    for (const fiber of fibers.reverse()) await fiber.dispose();
    await rm(dir, { recursive: true, force: true });
  });
  const mount = async (plugin, config) => fibers.push(await app.plugin(plugin, config));
  await mount(SessionStore);
  await mount(AgentRegistry);
  await mount(LlmRuntime);
  await mount(SystemPrompt, {});
  await mount(ToolRuntime, { mode: 'native' });
  await mount(SessionProjections);
  await mount(LocalFileSystem, { cwd: dir });
  await mount(WorkingDirectory, { defaultDirectory: dir });
  await mount(JsonlPersistence, { root: join(dir, 'sessions') });
  await mount(SessionQuery, { path: ':memory:', openAt: 'never' });
  await mount(AgentLoop, {});
  await mount(Subagents, {});
  await mount(spawnProvider, {});
  await mount(forkProvider, {});
  const model = new Model();
  if (held) model.hold = { entered: Promise.withResolvers(), release: Promise.withResolvers() };
  await mount(ctx => { ctx.inject(['llm'], child => { child.llm.registerAdapter(['fixture'], model); }); });
  parentHandle = await app.get('agents').create({ sessionId: SessionId(randomUUID()), meta: { cwd: dir }, agentOptions: { provider: 'fixture', model: 'fixture' } });
  const parent = parentHandle.agent;
  if (provider === 'fork') {
    parent.followup({ id: randomUUID(), role: 'user', content: [{ type: 'text', text: 'Parent-only earlier work' }], source: { kind: 'user' } });
    await parent.whenIdle();
  }
  const store = new RedTeamStore(join(dir, 'state.json'));
  const task = await store.createTask('Recovery', 'Recover original DSH activation');
  const intent = await store.addIntent({ taskId: task.id, summary: 'Return original result', input: {} });
  const childId = SessionId(randomUUID());
  await store.claimIntent(task.id, childId, { execution: { childSessionId: childId, parentSessionId: parent.id, provider }, concurrency: 2 });
  const accepted = await app.get('subagents').startActivation({ provider, label: 'original', childId, request: { parent, prompt: [{ type: 'text', text: 'Return durable result.' }], maxDepth: 2 }, delivery: 'caller', signal: AbortSignal.timeout(10000) });
  void accepted.result.catch(() => {});
  await store.setWorkerMessage(intent.id, accepted.messageId);
  if (held) await model.hold.entered.promise;
  else { await accepted.result; await app.get('subagents').drainChildren(parent, [childId]); }
  runtime = new WorkerRuntime({ subagents: app.get('subagents'), agents: app.get('agents'), sessionQuery: app.get('sessionQuery'), sessionPersistence: app.get('sessionPersistence') }, store, 2);
  await mount(ctx => ctx.on('session/event', (session, event) => {
    const pending = runtime.observe(session, event);
    eventWork.add(pending);
    void pending.finally(() => eventWork.delete(pending));
  }));
  return { dir, app, model, store, task, intent, parent, runtime, childId, accepted, async drainEvents() { await Promise.all([...eventWork]); } };
}
const current = f => f.store.snapshot().intents.find(row => row.id === f.intent.id);
async function raw(f) {
  await f.app.get('sessionPersistence').flush();
  const handle = await f.app.get('sessionPersistence').open(f.childId, 'read');
  try { return (await handle.read()).events; } finally { await handle.close(); }
}

test('cold completed Worker replays its original JSONL outcome exactly once without submitting new work', { timeout: 20000 }, async t => {
  const f = await fixture(t);
  assert.equal(current(f).state, 'claimed');
  const before = await raw(f);
  const calls = f.model.calls;
  await f.runtime.recover(current(f), f.parent, AbortSignal.timeout(5000));
  assert.equal(current(f).state, 'done');
  assert.deepEqual(current(f).output.content, [{ type: 'text', text: 'Durable worker result' }]);
  assert.equal(current(f).execution.messageId, f.accepted.messageId);
  assert.equal(f.model.calls, calls);
  assert.deepEqual(await raw(f), before);
  const traces = f.store.snapshot().traces.length;
  await f.runtime.recover(current(f), f.parent, AbortSignal.timeout(5000));
  assert.equal(f.store.snapshot().traces.length, traces, 'recovery is idempotent');
});

test('resident Worker remains bound to its exact parent and completion continues through live events', { timeout: 20000 }, async t => {
  const f = await fixture(t, true);
  await f.runtime.recover(current(f), f.parent, AbortSignal.timeout(5000));
  assert.equal(current(f).state, 'running');
  assert.equal(current(f).output.recovery.reason, 'live-running');
  assert.equal(f.model.calls, 1);
  f.model.hold.release.resolve();
  await f.accepted.result;
  await f.drainEvents();
  assert.equal(current(f).state, 'done');
  assert.equal(f.model.calls, 1);
  await assert.rejects(f.runtime.recover(current(f), { id: f.parent.id }, AbortSignal.timeout(5000)), /exact live parent/);
});

test('fork recovery excludes inherited parent turns while preserving child output and original identity', { timeout: 20000 }, async t => {
  const f = await fixture(t, false, 'fork');
  const reader = await f.app.get('sessionPersistence').open(f.childId, 'read');
  const cut = reader.inheritedEventCount;
  await reader.close();
  assert.ok(cut > 0);
  await f.runtime.recover(current(f), f.parent, AbortSignal.timeout(5000));
  assert.equal(current(f).state, 'done');
  const replayed = f.store.snapshot().traces.filter(trace => trace.data?.event);
  assert.ok(replayed.length > 0);
  assert.ok(replayed.every(trace => trace.data.seq >= cut));
  assert.equal(current(f).execution.childSessionId, f.childId);
  assert.equal(current(f).output.content[0].text, 'Durable worker result');
  assert.equal(f.model.calls, 2, 'one original parent turn plus one original child turn');
});

test('cold pending inbox and interrupted turn are preserved without persisting synthetic query closers', { timeout: 20000 }, async t => {
  const f = await fixture(t);
  const persistence = f.app.get('sessionPersistence');
  const before = await raw(f);
  const pendingId = randomUUID();
  const inboxEvent = { type: 'agent/inbox/spliced', seq: before.length, time: Date.now(), data: { target: 'next-turn', start: 0, inserted: [{ id: pendingId, role: 'user', content: [{ type: 'text', text: 'Already accepted queued task' }], source: { kind: 'user' } }] } };
  const writer = await persistence.open(f.childId, 'write');
  await writer.append([inboxEvent]);
  await writer.close();
  await f.store.updateIntent(f.intent.id, { state: 'claimed' });
  await f.runtime.recover(current(f), f.parent, AbortSignal.timeout(5000));
  assert.equal(current(f).state, 'paused');
  assert.deepEqual(current(f).output.recovery.pendingMessageIds, [pendingId]);
  assert.equal(current(f).output.recovery.reason, 'pending-inbox-needs-steer');
  const pendingLog = await raw(f);
  assert.equal(pendingLog.at(-1).type, 'agent/inbox/spliced');
  const nextTurn = Math.max(...pendingLog.filter(event => event.type === 'turn/start').map(event => event.data.turn)) + 1;
  const open = await persistence.open(f.childId, 'write');
  await open.append([
    { type: 'turn/start', seq: pendingLog.length, time: Date.now(), data: { turn: nextTurn } },
    { type: 'agent/inbox/spliced', seq: pendingLog.length + 1, time: Date.now(), data: { target: 'next-turn', start: 0, removedCount: 1, inserted: [] } },
  ]);
  await open.close();
  await f.store.updateIntent(f.intent.id, { state: 'running' });
  await f.runtime.recover(current(f), f.parent, AbortSignal.timeout(5000));
  assert.equal(current(f).state, 'paused');
  assert.equal(current(f).output.recovery.reason, 'interrupted-turn-needs-steer');
  assert.equal(current(f).execution.lastEventSeq, pendingLog.length, 'synthetic end must not advance watermark');
  assert.equal((await raw(f)).length, pendingLog.length + 2, 'recovery must not write synthetic events');
  assert.equal(f.model.calls, 1);
});
