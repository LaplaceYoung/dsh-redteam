import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { Session, SessionId } from '@deepseek-ai/dsh-session';
import { WorkerRuntime } from '../lib/workers.js';
import { RedTeamStore } from '../lib/store.js';

test('ARTEX Worker prefers DSH Agent Teams and keeps durable intent/steering bindings', async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'redteam-agent-team-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const store = new RedTeamStore(join(dir, 'state.json'));
  const task = await store.createTask('Team fixture', 'Inspect fixture with a named teammate');
  const intent = await store.addIntent({ taskId: task.id, summary: 'Inspect entry point', input: { target: 'fixture' } });
  const parent = { id: SessionId('parent') };
  const sessions = new Map();
  const teamCalls = [];
  const sent = [];
  const interrupted = [];
  const released = [];
  const subagents = {
    getProvider: () => ({ prepareContinuable() {} }),
    resolveMaxDepth: () => 2,
    async startActivation() { throw new Error('legacy subagent path should not be used when Agent Teams is available'); },
    async sendMessage() { throw new Error('legacy steering path should not be used when Agent Teams is available'); },
    async drainChildren(owner, ids) { released.push({ owner, ids }); },
  };
  let runtime;
  const agentTeams = {
    async spawnTeammate(caller, request) {
      teamCalls.push({ caller, request });
      const id = SessionId(randomUUID());
      sessions.set(id, Session.create(id));
      return { member: { id, name: request.name, phase: 'active' } };
    },
    async sendMessage(caller, request) {
      sent.push({ caller, request });
      return { messageId: 'team-steer-message' };
    },
    interrupt(caller, target) {
      interrupted.push({ caller, target });
      return { previousStatus: 'running' };
    },
  };
  runtime = new WorkerRuntime({ subagents, agentTeams }, store, 2);
  t.after(() => runtime.dispose());
  const signal = new AbortController().signal;
  const started = await runtime.start(task.id, parent, signal, 'spawn');
  assert.equal(started.id, intent.id);
  assert.equal(started.execution.teamName, `artex-worker-${intent.id.replace(/[^a-z0-9-]/gi, '').toLowerCase().slice(0, 40)}`);
  assert.equal(teamCalls.length, 1);
  assert.equal(teamCalls[0].request.context, 'fresh');
  assert.equal(teamCalls[0].request.provider, 'spawn');
  const receipt = await runtime.steer(intent.id, 'Inspect exports next', parent, signal);
  assert.equal(receipt.messageId, 'team-steer-message');
  assert.equal(sent[0].request.target, started.execution.teamName);
  assert.deepEqual(sent[0].request.content, [{ type: 'text', text: 'Inspect exports next' }]);
  const child = sessions.get(SessionId(started.execution.childSessionId));
  const end = child.append('turn/end', { turn: 1, reason: { kind: 'completed' } });
  await runtime.observe(child, end);
  assert.equal(store.snapshot().intents[0].state, 'done');
  await runtime.stop(intent.id, parent);
  assert.equal(interrupted[0].target, started.execution.teamName);
  assert.deepEqual(released[0].ids, [SessionId(started.execution.childSessionId)]);
});
