import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { build } from 'esbuild';
import { Session, SessionId } from '@deepseek-ai/dsh-session';

// Bundle current sources in memory; shared lib/ may be rebuilt by the host integrator.
const bundled = await build({ stdin: { contents: "export { PlannerRuntime } from './src/planner/runtime.ts'; export { PlannerExecutionError } from './src/planner/model.ts'; export { RedTeamStore } from './src/store.ts'; export { WorkerRuntime } from './src/workers.ts';", resolveDir: process.cwd(), loader: 'ts' }, bundle: true, write: false, platform: 'node', format: 'esm', packages: 'external' });
const code = bundled.outputFiles[0].text.replace(/from\s+(["'])(@[^"']+)\1/g, (_match, _quote, specifier) => `from ${JSON.stringify(import.meta.resolve(specifier))}`);
const { PlannerRuntime, PlannerExecutionError, RedTeamStore, WorkerRuntime } = await import(`data:text/javascript;base64,${Buffer.from(code + '\n//# sourceURL=planner-runtime-tests.bundle.mjs').toString('base64')}`);
const plan = (intents = [], extra = {}) => ({ intents: intents.map((summary) => ({ summary, input: {} })), proofs: [], steers: [], kills: [], ...extra });
const deferred = () => { let resolve; const promise = new Promise((done) => { resolve = done; }); return { promise, resolve }; };

async function fixture(t, model = () => plan(['Inspect target']), options = {}) {
  const dir = await mkdtemp(join(tmpdir(), 'artex-planner-'));
  const store = new RedTeamStore(join(dir, 'state.json'));
  const task = await store.createTask('Planner fixture', options.goal ?? 'Find evidence');
  if (!task.goal) await store.transaction((state) => { state.tasks[0].description = ''; });
  if (task.goal) await store.addGoal({ taskId: task.id, text: 'Verified fixture objective', state: 'open' });
  const parent = { id: SessionId('planner-parent') };
  const sessions = new Map();
  const calls = [];
  const drains = [];
  const messages = [];
  let worker;
  const service = {
    getProvider: () => ({ prepareContinuable() {} }), resolveMaxDepth: () => 3,
    async startActivation(spec) {
      if (options.admit) await options.admit(spec);
      const session = Session.create(spec.childId);
      sessions.set(spec.childId, session);
      await worker.observe(session, session.append('turn/start', { turn: 1 }));
      return { childId: spec.childId, messageId: `message-${sessions.size}`, result: Promise.resolve({ reason: { kind: 'completed' } }) };
    },
    async drainChildren(_parent, ids) {
      drains.push(...ids);
      if (options.drain) await options.drain();
      for (const id of ids) {
        const session = sessions.get(id);
        const intent = store.snapshot().intents.find((row) => row.execution?.childSessionId === id);
        if (session && ['claimed', 'running'].includes(intent?.state)) await worker.observe(session, session.append('turn/end', { turn: 1, reason: { kind: 'aborted' } }));
      }
    },
    async sendMessage(_parent, id, content) {
      messages.push({ id, content });
      const intent = store.snapshot().intents.find((row) => row.execution?.childSessionId === id);
      if (intent?.state === 'claimed') await worker.observe(sessions.get(id), sessions.get(id).append('turn/start', { turn: 2 }));
      return 'steer-receipt';
    }
  };
  worker = new WorkerRuntime({ subagents: service }, store, options.concurrency ?? 2);
  const boundary = { async plan(context, signal) { calls.push(context); return model(context, signal); } };
  const plannerOptions = { concurrency: options.concurrency ?? 2, debounceMs: 60_000 };
  const runtime = new PlannerRuntime(store, worker, boundary, plannerOptions);
  t.after(async () => { await runtime.dispose(); await worker.dispose(); await rm(dir, { recursive: true, force: true }); });
  async function finish(intentId, reason = { kind: 'completed' }) {
    const intent = store.snapshot().intents.find((row) => row.id === intentId);
    const session = sessions.get(intent.execution.childSessionId);
    await worker.observe(session, session.append('turn/end', { turn: 1, reason }));
    runtime.notify(task.id, { kind: 'done', intentId });
  }
  return { store, task, parent, sessions, calls, runtime, worker, boundary, plannerOptions, finish, drains, messages };
}

test('initial model planning produces work; concurrent duplicate starts and notifications coalesce', async (t) => {
  const f = await fixture(t);
  await Promise.all([f.runtime.start(f.task.id, f.parent), f.runtime.start(f.task.id, f.parent)]);
  f.runtime.notify(f.task.id, { kind: 'finding', detail: 'one finding' });
  f.runtime.notify(f.task.id, { kind: 'finding', detail: 'one finding' });
  await f.runtime.flush(f.task.id);
  assert.equal(f.calls.length, 1);
  assert.equal(f.calls[0].triggers.filter((trigger) => trigger.kind === 'finding').length, 1);
  assert.equal(f.sessions.size, 1);
  assert.equal(f.store.snapshot().intents[0].state, 'running');
});

test('seed frontier skips initial LLM and completion refills free capacity', async (t) => {
  const f = await fixture(t, () => plan(), { concurrency: 1 });
  const first = await f.store.addIntent({ taskId: f.task.id, summary: 'seed A', input: {} });
  await f.store.addIntent({ taskId: f.task.id, summary: 'seed B', input: {} });
  await f.runtime.start(f.task.id, f.parent);
  await f.runtime.flush(f.task.id);
  assert.equal(f.calls.length, 0);
  assert.equal(f.sessions.size, 1);
  await f.finish(first.id);
  await f.runtime.flush(f.task.id);
  assert.equal(f.sessions.size, 2);
  assert.equal(f.calls.length, 1);
  assert.equal(f.store.snapshot().intents.filter((row) => row.state === 'running').length, 1);
});

test('one storage task has one owner across PlannerRuntime instances', async (t) => {
  const f = await fixture(t);
  const other = new PlannerRuntime(new RedTeamStore(f.store.storagePath), f.worker, f.boundary, f.plannerOptions);
  t.after(() => other.dispose());
  await Promise.all([f.runtime.start(f.task.id, f.parent), other.start(f.task.id, f.parent)]);
  await other.flush(f.task.id);
  assert.equal(f.calls.length, 1);
  await assert.rejects(other.start(f.task.id, { id: SessionId('other-parent') }), /another parent/);
});

test('capacity is shared by two tasks under the same parent and released slots refill', async (t) => {
  const f = await fixture(t, () => plan(), { concurrency: 1 });
  const second = await f.store.createTask('Second', 'Second goal');
  await f.store.addGoal({ taskId: second.id, text: 'Second verified objective', state: 'open' });
  const firstIntent = await f.store.addIntent({ taskId: f.task.id, summary: 'A', input: {} });
  await f.store.addIntent({ taskId: second.id, summary: 'B', input: {} });
  await Promise.all([f.runtime.start(f.task.id, f.parent), f.runtime.start(second.id, f.parent)]);
  await Promise.all([f.runtime.flush(f.task.id), f.runtime.flush(second.id)]);
  assert.equal(f.sessions.size, 1);
  await f.finish(firstIntent.id);
  await f.runtime.flush(second.id);
  assert.equal(f.sessions.size, 2);
  assert.equal(f.store.snapshot().intents.filter((row) => row.state === 'running').length, 1);
});

test('task pause drains live children before requeue; individually paused work remains parked', async (t) => {
  const drain = deferred();
  const entered = deferred();
  const f = await fixture(t, () => plan(), { drain: async () => { entered.resolve(); await drain.promise; } });
  const intent = await f.store.addIntent({ taskId: f.task.id, summary: 'active', input: {} });
  const parked = await f.store.addIntent({ taskId: f.task.id, summary: 'parked', input: {}, state: 'paused' });
  await f.runtime.start(f.task.id, f.parent); await f.runtime.flush(f.task.id);
  const pause = f.runtime.pause(f.task.id);
  await entered.promise;
  assert.equal(f.store.snapshot().tasks[0].status, 'paused');
  assert.notEqual(f.store.snapshot().intents.find((row) => row.id === intent.id).state, 'open');
  drain.resolve(); await pause;
  assert.equal(f.store.snapshot().intents.find((row) => row.id === intent.id).state, 'open');
  const previousChild = f.store.snapshot().intents.find((row) => row.id === intent.id).execution.childSessionId;
  assert.equal(f.store.snapshot().intents.find((row) => row.id === parked.id).state, 'paused');
  await f.runtime.start(f.task.id, f.parent); await f.runtime.flush(f.task.id);
  assert.equal(f.sessions.size, 1);
  assert.equal(f.messages[0].id, previousChild);
  assert.equal(f.store.snapshot().intents.find((row) => row.id === intent.id).state, 'running');
});

test('pausing a pending native admission requeues the interrupted intent', async (t) => {
  const entered = deferred();
  const f = await fixture(t, () => plan(), { admit: async (spec) => {
    entered.resolve();
    await new Promise((_, reject) => { spec.signal.addEventListener('abort', () => reject(spec.signal.reason), { once: true }); });
  } });
  await f.store.addIntent({ taskId: f.task.id, summary: 'admitting', input: {} });
  await f.runtime.start(f.task.id, f.parent);
  await entered.promise;
  await f.runtime.pause(f.task.id);
  assert.equal(f.store.snapshot().intents[0].state, 'open');
  assert.equal(f.sessions.size, 0);
});

test('stale model output is discarded when goals change during planning', async (t) => {
  const entered = deferred(); const release = deferred(); let rounds = 0;
  const f = await fixture(t, async () => {
    if (++rounds === 1) { entered.resolve(); await release.promise; return plan(['old goal direction']); }
    return plan(['new goal direction']);
  });
  await f.runtime.start(f.task.id, f.parent);
  const flushing = f.runtime.flush(f.task.id);
  await entered.promise;
  await f.store.updateGoal(f.store.snapshot().goals[0].id, { text: 'New goal' });
  release.resolve(); await flushing;
  assert.deepEqual(f.store.snapshot().intents.map((row) => row.summary), ['new goal direction']);
  assert.equal(f.calls.length, 2);
});

test('goal proof is atomic and completion drains workers without restarting pending work', async (t) => {
  let proof;
  const f = await fixture(t, () => plan([], { proofs: [proof] }), { concurrency: 1 });
  await f.store.addIntent({ taskId: f.task.id, summary: 'active', input: {} });
  await f.store.addIntent({ taskId: f.task.id, summary: 'queued', input: {} });
  const evidence = await f.store.addNode({ id: 'goal-proof', taskId: f.task.id, kind: 'fact', label: 'verified fixture', data: { verified: true } });
  await f.runtime.start(f.task.id, f.parent); await f.runtime.flush(f.task.id);
  proof = { goalId: f.store.snapshot().goals[0].id, evidenceIds: [evidence.id], reason: 'Fixture establishes the goal' };
  f.runtime.notify(f.task.id, { kind: 'finding' }); await f.runtime.flush(f.task.id);
  assert.equal(f.store.snapshot().tasks[0].status, 'done');
  assert.equal(f.store.snapshot().goals[0].state, 'met');
  assert.equal(f.sessions.size, 1);
  assert.equal(f.store.snapshot().intents[0].state, 'stopped');
  await f.runtime.start(f.task.id, f.parent); f.runtime.notify(f.task.id); await f.runtime.flush(f.task.id);
  assert.equal(f.calls.length, 1);
});

test('an invalid proof preserves successful intents and exposes the partial error', async (t) => {
  const f = await fixture(t, (context) => plan(['invalid batch'], { proofs: [{ goalId: context.snapshot.goals[0].id, evidenceIds: ['missing'], reason: 'Claim' }] }));
  await f.runtime.start(f.task.id, f.parent);
  await assert.rejects(f.runtime.flush(f.task.id), /missing task\/source fact/);
  assert.equal(f.store.snapshot().goals[0].state, 'open');
  assert.equal(f.store.snapshot().intents.length, 1);
  assert.equal(f.sessions.size, 1);
  assert.equal(f.store.snapshot().tasks[0].status, 'running');
  assert.ok(f.store.snapshot().traces.some((trace) => trace.worker === 'planner' && trace.kind === 'error' && /missing task\/source fact/.test(trace.summary)));
});

test('add_intent retains the original API ability to submit an identical direction', async (t) => {
  const f = await fixture(t, () => plan(['Same direction']));
  await f.store.addIntent({ taskId: f.task.id, summary: ' Same   direction ', input: {}, state: 'done' });
  await f.runtime.start(f.task.id, f.parent);
  await f.runtime.flush(f.task.id);
  assert.equal(f.sessions.size, 1);
  assert.equal(f.store.snapshot().intents.length, 2);
});

test('batches above four directions persist and still obey Worker concurrency', async (t) => {
  const f = await fixture(t, () => plan(['one', 'two', 'three', 'four', 'five', 'six']));
  await f.runtime.start(f.task.id, f.parent); await f.runtime.flush(f.task.id);
  assert.equal(f.store.snapshot().intents.length, 6);
  assert.equal(f.sessions.size, 2);
  assert.equal(f.store.snapshot().intents.filter(row => row.state === 'open').length, 4);
});

test('a later model failure retains accepted intent IDs and todos without duplicating retries', async (t) => {
  const accepted = plan([], { intents: [{ id: 'accepted-id', summary: 'accepted work', input: {} }], todos: [{ content: 'check result', status: 'in_progress' }] });
  const f = await fixture(t, () => { throw new PlannerExecutionError(accepted, new Error('provider disconnected')); });
  await f.runtime.start(f.task.id, f.parent);
  await assert.rejects(f.runtime.flush(f.task.id), /provider disconnected/);
  assert.equal(f.store.snapshot().intents[0].id, 'accepted-id');
  assert.equal(f.sessions.size, 1);
  f.runtime.notify(f.task.id);
  await assert.rejects(f.runtime.flush(f.task.id), /provider disconnected/);
  assert.deepEqual(f.calls[1].todos, accepted.todos);
  assert.equal(f.store.snapshot().intents.length, 1);
});

test('opt-in goal_met completes the task without fabricating individual goal proofs', async (t) => {
  const f = await fixture(t, () => plan([], { goalMet: { reason: 'explicit completion' } }));
  await f.runtime.start(f.task.id, f.parent); await f.runtime.flush(f.task.id);
  assert.equal(f.store.snapshot().tasks[0].status, 'done');
  assert.equal(f.store.snapshot().goals[0].state, 'open');
  assert.equal(f.store.snapshot().edges.filter(row => row.relation === 'proves').length, 0);
});

test('direct transaction proposals enforce the global asset gate and retain allowed siblings', async (t) => {
  const f = await fixture(t, () => plan([], { intents: [{ summary: 'blocked', input: { asset_ids: ['blocked-asset'] } }, { summary: 'allowed', input: {} }] }));
  await f.store.transaction((state) => {
    state.assets.push({ id: 'blocked-asset', taskId: 'another-task', kind: 'domain', value: 'example.gov', metadata: {}, createdAt: new Date().toISOString() });
  });
  await f.runtime.start(f.task.id, f.parent);
  await assert.rejects(f.runtime.flush(f.task.id), /资产.*校验/);
  assert.deepEqual(f.store.snapshot().intents.map(row => row.summary), ['allowed']);
  assert.equal(f.sessions.size, 1);
});

test('proof commit accepts direct source facts but rejects transitive sources and raw Evidence', async (t) => {
  const f = await fixture(t, () => plan(['continue remaining goal'], { proofs: [
    { goalId: 'direct-goal', evidenceIds: ['direct-fact'], reason: '' },
    { goalId: 'unproven-goal', evidenceIds: ['transitive-fact'], reason: '' },
    { goalId: 'unproven-goal', evidenceIds: ['raw-evidence'], reason: '' },
  ] }));
  const direct = await f.store.createTask('direct source', 'source');
  const transitive = await f.store.createTask('transitive source', 'source');
  await f.store.transaction((state) => {
    state.tasks.find(row => row.id === f.task.id).sourceTaskIds = [direct.id];
    state.tasks.find(row => row.id === direct.id).sourceTaskIds = [transitive.id];
    state.goals[0].id = 'direct-goal';
    state.goals.push({ ...state.goals[0], id: 'unproven-goal' });
    state.nodes.push({ id: 'direct-fact', taskId: direct.id, kind: 'fact', label: 'direct proof', data: {} });
    state.nodes.push({ id: 'transitive-fact', taskId: transitive.id, kind: 'fact', label: 'unrelated proof', data: {} });
    state.evidence.push({ id: 'raw-evidence', taskId: f.task.id, kind: 'text', content: 'raw record' });
  });
  await f.runtime.start(f.task.id, f.parent);
  await assert.rejects(f.runtime.flush(f.task.id), /transitive-fact.*raw-evidence/);
  assert.equal(f.store.snapshot().goals.find(row => row.id === 'direct-goal').state, 'met');
  assert.equal(f.store.snapshot().goals.find(row => row.id === 'unproven-goal').state, 'open');
  assert.deepEqual(f.store.snapshot().edges.filter(row => row.relation === 'proves').map(row => row.from), ['direct-fact']);
});

test('goalless direct tasks drain seeded work and finish without any model call', async (t) => {
  const f = await fixture(t, () => { throw new Error('must not plan'); }, { goal: '' });
  const intent = await f.store.addIntent({ taskId: f.task.id, summary: 'one direct instruction', input: {} });
  await f.runtime.start(f.task.id, f.parent); await f.runtime.flush(f.task.id);
  await f.finish(intent.id); await f.runtime.flush(f.task.id);
  assert.equal(f.store.snapshot().tasks[0].status, 'done');
  assert.equal(f.calls.length, 0);
});

test('cold recovery requires native reconciliation and never creates a second child for a running intent', async (t) => {
  const f = await fixture(t, () => plan());
  const intent = await f.store.addIntent({ taskId: f.task.id, summary: 'persisted', input: {} });
  await f.store.claimIntent(f.task.id, 'persisted-child', { execution: { parentSessionId: f.parent.id, childSessionId: 'persisted-child', provider: 'spawn' }, concurrency: 2 });
  const withoutRecovery = new PlannerRuntime(f.store, {
    start: (...args) => f.worker.start(...args), stop: (...args) => f.worker.stop(...args),
    steer: (...args) => f.worker.steer(...args), quiesceTask: (...args) => f.worker.quiesceTask(...args),
  }, f.boundary, f.plannerOptions);
  t.after(() => withoutRecovery.dispose());
  await assert.rejects(withoutRecovery.start(f.task.id, f.parent), /recovery adapter required/);
  assert.equal(f.sessions.size, 0);
  const recovered = [];
  const workers = {
    start: (...args) => f.worker.start(...args), stop: (...args) => f.worker.stop(...args), steer: (...args) => f.worker.steer(...args), quiesceTask: async () => {},
    async recover(row) { recovered.push(row.id); await f.store.updateIntent(row.id, { state: 'running' }); }
  };
  const runtime = new PlannerRuntime(f.store, workers, f.boundary, f.plannerOptions);
  t.after(() => runtime.dispose());
  await runtime.start(f.task.id, f.parent); await runtime.flush(f.task.id);
  assert.deepEqual(recovered, [intent.id]);
  assert.equal(f.sessions.size, 0);
  assert.equal(f.calls.length, 0);
  await runtime.pause(f.task.id);
});

test('planner failures remain observable and a later event can recover without a blind retry', async (t) => {
  let failed = true;
  const f = await fixture(t, () => { if (failed) throw new Error('model transport failed'); return plan(['recover direction']); });
  await f.runtime.start(f.task.id, f.parent);
  await assert.rejects(f.runtime.flush(f.task.id), /model transport failed/);
  assert.equal(f.calls.length, 1);
  failed = false; f.runtime.notify(f.task.id, { kind: 'heartbeat' }); await f.runtime.flush(f.task.id);
  assert.equal(f.calls.length, 2);
  assert.equal(f.sessions.size, 1);
});

test('todos survive a new planning round in durable result traces', async (t) => {
  const todos = [{ content: 'Inspect first then verify', status: 'in_progress' }];
  const f = await fixture(t, (context) => context.todos.length ? plan() : plan(['first step'], { todos }));
  await f.runtime.start(f.task.id, f.parent); await f.runtime.flush(f.task.id);
  f.runtime.notify(f.task.id, { kind: 'change' }); await f.runtime.flush(f.task.id);
  assert.deepEqual(f.calls[1].todos, todos);
});

test('pause cancels in-flight planning without committing its late plan', async (t) => {
  const entered = deferred();
  const f = await fixture(t, async (_context, signal) => {
    entered.resolve();
    await new Promise((resolve) => signal.addEventListener('abort', resolve, { once: true }));
    return plan(['late plan must not execute']);
  });
  await f.runtime.start(f.task.id, f.parent);
  const flushing = f.runtime.flush(f.task.id);
  await entered.promise;
  await f.runtime.pause(f.task.id); await flushing;
  assert.equal(f.store.snapshot().tasks[0].status, 'paused');
  assert.equal(f.store.snapshot().intents.length, 0);
  assert.equal(f.sessions.size, 0);
});

test('events received during planning cause a subsequent round without overlapping model calls', async (t) => {
  const entered = deferred(); const release = deferred(); let rounds = 0; let concurrent = 0; let maximum = 0;
  const f = await fixture(t, async () => {
    concurrent++; maximum = Math.max(maximum, concurrent);
    if (++rounds === 1) { entered.resolve(); await release.promise; }
    concurrent--;
    return rounds === 1 ? plan(['first']) : plan();
  });
  await f.runtime.start(f.task.id, f.parent); const flushing = f.runtime.flush(f.task.id);
  await entered.promise; f.runtime.notify(f.task.id, { kind: 'finding', detail: 'during LLM call' });
  release.resolve(); await flushing;
  assert.equal(f.calls.length, 2);
  assert.equal(maximum, 1);
  assert.equal(f.calls[1].triggers[0].detail, 'during LLM call');
});

test('steering and kill reach owned native workers and stopped work is not automatically relaunched', async (t) => {
  let chosen;
  let terminate = false;
  const f = await fixture(t, () => terminate ? plan(['replacement'], { kills: [{ intentId: chosen, reason: 'wrong direction' }] }) : plan([], { steers: [{ intentId: chosen, message: 'inspect output' }] }));
  const intent = await f.store.addIntent({ taskId: f.task.id, summary: 'seed', input: {} }); chosen = intent.id;
  await f.runtime.start(f.task.id, f.parent); await f.runtime.flush(f.task.id);
  f.runtime.notify(f.task.id); await f.runtime.flush(f.task.id);
  assert.equal(f.messages[0].content[0].text, 'inspect output');
  terminate = true; f.runtime.notify(f.task.id); await f.runtime.flush(f.task.id);
  const stopped = f.store.snapshot().intents.find((row) => row.id === intent.id);
  assert.equal(stopped.state, 'stopped');
  assert.equal(stopped.output.terminalReason, 'stopped');
  assert.equal(f.sessions.size, 2);
});

test('failed task stops admissions and stays terminal after restart request', async (t) => {
  const f = await fixture(t, () => plan(['seed']));
  await f.runtime.start(f.task.id, f.parent); await f.runtime.flush(f.task.id);
  await f.runtime.fail(f.task.id, 'Explicit task failure');
  assert.equal(f.store.snapshot().tasks[0].status, 'failed');
  assert.equal(f.store.snapshot().intents[0].output.terminalReason, 'stopped');
  await f.runtime.start(f.task.id, f.parent); await f.runtime.flush(f.task.id);
  assert.equal(f.sessions.size, 1);
  assert.equal(f.calls.length, 1);
});

test('ARTEX idle heartbeat wakes a seeded task after ten minutes and is reset after planning', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const f = await fixture(t, () => plan());
  await f.store.addIntent({ taskId: f.task.id, summary: 'long running seed', input: {} });
  await f.runtime.start(f.task.id, f.parent); await f.runtime.flush(f.task.id);
  t.mock.timers.tick(599_999); await f.runtime.flush(f.task.id);
  assert.equal(f.calls.length, 0);
  t.mock.timers.tick(1); await f.runtime.flush(f.task.id);
  assert.equal(f.calls.length, 1);
  assert.equal(f.calls[0].triggers[0].kind, 'heartbeat');
  t.mock.timers.tick(599_999); await f.runtime.flush(f.task.id);
  assert.equal(f.calls.length, 1);
});
