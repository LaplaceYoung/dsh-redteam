import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { Context } from '@deepseek-ai/cordis';
import Loader from '@deepseek-ai/cordis-plugin-loader';
import AgentPresetRegistry from '@deepseek-ai/dsh-agent-preset-registry';
import { SessionStore, SessionId } from '@deepseek-ai/dsh-session';
import AgentRegistry from '@deepseek-ai/dsh-agent';
import AgentLoop from '@deepseek-ai/dsh-agent-loop';
import LlmRuntime, { LlmAdapter } from '@deepseek-ai/dsh-llm';
import SystemPrompt from '@deepseek-ai/dsh-system-prompt';
import ToolRuntime from '@deepseek-ai/dsh-tools';
import ApprovalService from '@deepseek-ai/dsh-user-approval';
import SessionProjections from '@deepseek-ai/dsh-session-projection';
import LocalFileSystem from '@deepseek-ai/dsh-fs-local';
import WorkingDirectory from '@deepseek-ai/dsh-working-directory';
import * as JsonlPersistence from '@deepseek-ai/dsh-session-persistence-jsonl';
import SessionQuery from '@deepseek-ai/dsh-session-query-sqlite';
import Subagents from '@deepseek-ai/dsh-subagent';
import * as spawnProvider from '@deepseek-ai/dsh-subagent-spawn-in-process';
import * as forkProvider from '@deepseek-ai/dsh-subagent-fork-in-process';
import * as plugin from '../lib/index.js';
import { lifecycleForAgent } from '../lib/task-management/runtime-scope.js';

// Only the external model boundary is deterministic; sessions, tools, children,
// agent loops and on-disk persistence all use the installed DSH implementation.
class FixtureAdapter extends LlmAdapter {
  hold;
  async resolveModel(provider, model) { return { provider, id: model, name: model }; }
  async *stream(options) {
    if (this.hold) {
      this.hold.entered.resolve();
      await new Promise((resolve) => {
        if (options.signal.aborted) resolve();
        else options.signal.addEventListener('abort', resolve, { once: true });
      });
      options.signal.throwIfAborted();
    }
    if (options.messages.at(-1)?.role !== 'tool') {
      const id = randomUUID();
      yield { type: 'block-start', index: 0, blockType: 'tool-call' };
      yield { type: 'tool-call-delta', index: 0, id, name: 'redteam_snapshot', argumentsDelta: '{}' };
      yield { type: 'block-end', index: 0, block: { type: 'tool-call', id, name: 'redteam_snapshot', arguments: '{}' } };
      yield { type: 'finish', reason: { kind: 'tool-calls' } };
      return;
    }
    const text = 'Native child completed the assigned fixture.';
    yield { type: 'block-start', index: 0, blockType: 'text' };
    yield { type: 'text-delta', index: 0, text };
    yield { type: 'block-end', index: 0, block: { type: 'text', text } };
    yield { type: 'finish', reason: { kind: 'stop' } };
  }
}

test('real DSH spawn and fork execute and persist worker outcomes', { timeout: 30000 }, async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'redteam-native-'));
  const app = new Context();
  const fibers = [];
  let parentHandle;
  let unregisterPreset;
  t.after(async () => {
    await parentHandle?.dispose();
    await unregisterPreset?.();
    for (const fiber of fibers.reverse()) await fiber.dispose();
    await rm(dir, { recursive: true, force: true });
  });
  async function mount(module, config) { fibers.push(await app.plugin(module, config)); }
  await mount(SessionStore);
  await mount(AgentRegistry);
  await mount(LlmRuntime);
  await mount(SystemPrompt, {});
  await mount(ToolRuntime, { mode: 'native' });
  await mount(ApprovalService, { policy: 'never' });
  await mount(SessionProjections);
  await mount(Loader, { baseUrl: new URL('../', import.meta.url).href });
  await mount(AgentPresetRegistry, { default: 'redteam' });
  await mount(LocalFileSystem, { cwd: dir });
  await mount(WorkingDirectory, { defaultDirectory: dir });
  await mount(JsonlPersistence, { root: join(dir, 'sessions') });
  await mount(SessionQuery, { path: ':memory:', openAt: 'never' });
  await mount(AgentLoop, {});
  await mount(Subagents, {});
  await mount(spawnProvider, {});
  await mount(forkProvider, {});
  const nativeEvents = [];
  const childTools = new Map();
  await mount(ctx => {
    ctx.on('session/event', (session, event) => { nativeEvents.push({ sessionId: session.id, type: event.type, data: event.data }); });
    ctx.on('agent/created', ({ agent }) => { childTools.set(agent.id, !!app.get('tools').get('redteam_snapshot', agent)); });
  });
  const storagePath = join(dir, 'state.json');
  unregisterPreset = await app.get('agentPresets').register({
    id: 'redteam',
    plugins: [{ id: 'redteam-agent', name: new URL('../lib/index.js', import.meta.url).href,
      config: { surface: 'agent', storagePath, notifications: { allowLocalTargets: true } } }],
  });
  assert.equal((await app.get('agentPresets').resolve('redteam')).broken, undefined);
  const adapter = new FixtureAdapter();
  await mount((ctx) => { ctx.inject(['llm'], (llmCtx) => {
    llmCtx.llm.registerAdapter(['fixture'], adapter);
  }); });
  parentHandle = await app.get('agents').create({
    sessionId: SessionId(randomUUID()),
    meta: { cwd: dir },
    agentOptions: { provider: 'fixture', model: 'fixture' },
    setup: async (agentCtx, agent) => {
      await agentCtx.get('agentPresets').mount(agentCtx, 'redteam');
      await waitForAgentTools(app, agent);
    },
  });
  const parent = parentHandle.agent;
  const store = new plugin.RedTeamStore(storagePath);
  await store.load();
  async function call(name, args) {
    const result = await app.get('tools').execute({ callId: randomUUID(), name, arguments: args, agent: parent, signal: AbortSignal.timeout(10000) });
    assert.equal(result.isError, false, JSON.stringify(result));
    return result.value;
  }
  for (const provider of ['spawn', 'fork']) {
    const task = await call('redteam_create_task', { title: provider, goal: 'Verify native execution' });
    const intent = await call('redteam_plan_intent', { task_id: task.id, summary: 'Return a fixture result' });
    const started = await call('redteam_start_worker', { task_id: task.id, provider });
    const childId = SessionId(started.execution.childSessionId);
    assert.equal(childTools.get(childId), true, `${provider} child must receive the scoped redteam tools`);
    await assertEventually(() => store.snapshot().intents.find((row) => row.id === intent.id)?.state === 'done', () => {
      const child = app.get('agents').get(childId);
      return JSON.stringify({ intent: store.snapshot().intents.find(row => row.id === intent.id), childResident: !!child, childHasSnapshotTool: childTools.get(childId), events: nativeEvents.filter(event => event.sessionId === childId) });
    });
    await app.get('subagents').drainChildren(parent, [childId]);
    assertSuccessfulChildTool(childId, nativeEvents);
    const settled = store.snapshot().intents.find((row) => row.id === intent.id);
    assert.equal(settled.state, 'done', JSON.stringify(settled));
    assert.match(JSON.stringify(settled.output), /Native child completed/);
    assert.ok(await app.get('sessionPersistence').stat(childId));
    assert.equal(app.get('agents').get(childId), undefined);
    const receipt = await call('redteam_steer_worker', { intent_id: intent.id, message: 'Continue with a second result.' });
    assert.equal(receipt.childSessionId, childId);
    assert.equal(childTools.get(childId), true, 'cold reconstruction retains the preset tools');
    await assertEventually(() => store.snapshot().intents.find((row) => row.id === intent.id)?.output?.turn === settled.output.turn + 1, () => JSON.stringify(store.snapshot().intents.find((row) => row.id === intent.id)));
    await app.get('subagents').drainChildren(parent, [childId]);
    assertSuccessfulChildTool(childId, nativeEvents, 2);
    assert.equal(store.snapshot().intents.find((row) => row.id === intent.id).state, 'done');
  }
  const received = [];
  const server = createServer(async (request, response) => {
    let body = '';
    for await (const chunk of request) body += chunk.toString();
    received.push(body);
    response.writeHead(200).end('ok');
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const channel = await call('redteam_add_notification_channel', { name: 'Fixture hook', kind: 'webhook', config: { url: `http://127.0.0.1:${server.address().port}/notify` }, filter: { on_status_change: true } });
  assert.match(channel.config.url, /^__masked__/);
  const archiveTask = await call('redteam_create_task', { title: 'Archive with notification', goal: 'Preserve finding and delivery association' });
  // This parent already owns spawn/fork tasks; select the findings workspace explicitly.
  lifecycleForAgent(parent).bindParent(archiveTask.id, parent);
  const finding = await call('redteam_record_finding', { task_id: archiveTask.id, vuln_class: 'fixture', severity: 'low', summary: 'Native integration finding' });
  await call('redteam_update_finding', { finding_id: finding.id, status: 'verified' });
  const deliveries = await call('redteam_dispatch_notifications', {});
  assert.equal(deliveries.filter((row) => row.state === 'sent').length, 2);
  assert.equal(received.length, 2);
  await call('redteam_set_task_status', { task_id: archiveTask.id, status: 'paused' });
  const archived = await call('redteam_archive_task', { task_id: archiveTask.id });
  assert.equal(archived.state, 'ready');
  assert.ok(!store.snapshot().tasks.some((row) => row.id === archiveTask.id));
  await assert.rejects(store.addEvidence({ taskId: archiveTask.id, provider: 'worker', summary: 'late worker output', raw: {} }), /task not found or archived/);
  const restored = await call('redteam_restore_task_archive', { archive_id: archived.id });
  assert.equal(restored.restored, archiveTask.id);
  assert.equal(store.snapshot().findings.find((row) => row.id === finding.id).status, 'verified');
  await call('redteam_dispatch_notifications', {});
  assert.equal(received.length, 2, 'restored sent deliveries must not be resent');
  await parent.whenIdle();
  adapter.hold = { entered: Promise.withResolvers() };
  const task = await call('redteam_create_task', { title: 'Cancellation', goal: 'Stop an active native child' });
  const intent = await call('redteam_plan_intent', { task_id: task.id, summary: 'Wait for cancellation' });
  const started = await call('redteam_start_worker', { task_id: task.id });
  await adapter.hold.entered.promise;
  const stopped = await call('redteam_kill_worker', { intent_id: intent.id });
  assert.equal(stopped.state, 'paused');
  assert.equal(app.get('agents').get(SessionId(started.execution.childSessionId)), undefined);
  assert.ok(store.snapshot().traces.some((row) => row.intentId === intent.id && row.data?.payload?.reason?.kind === 'aborted'));
});

function assertSuccessfulChildTool(childId, events, expectedTurns = 1) {
  const calls = events.filter(event => event.sessionId === childId && event.type === 'tool/call' && event.data.name === 'redteam_snapshot');
  assert.equal(calls.length, expectedTurns, 'each native child activation must execute the inherited snapshot tool');
  for (const call of calls) {
    const result = events.find(event => event.sessionId === childId && event.type === 'tool/result' && event.data.message.toolCallId === call.data.callId);
    assert.ok(result, 'the real tool runtime must record a correlated result');
    assert.notEqual(result.data.message.isError, true, JSON.stringify(result));
  }
}

async function assertEventually(predicate, diagnostic = () => 'native worker did not settle') {
  const deadline = Date.now() + 5000;
  while (!predicate() && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 10));
  assert.ok(predicate(), diagnostic());
}

function waitForAgentTools(app, agent) {
  return new Promise((resolve, reject) => {
    let dispose = () => {};
    const timer = setTimeout(() => { dispose(); reject(new Error('Native preset async initialization did not publish its final graph tools')); }, 20000);
    const check = () => {
      if (['redteam_create_task', 'redteam_snapshot', 'redteam_list_task_worker_traces'].every(name => app.get('tools').get(name, agent))) {
        clearTimeout(timer); dispose(); resolve();
      }
    };
    dispose = app.on('tools/change', check); check();
  });
}
