import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { build } from 'esbuild';
import { Context } from '@deepseek-ai/cordis';
import { SessionStore, SessionId } from '@deepseek-ai/dsh-session';
import AgentRegistry from '@deepseek-ai/dsh-agent';
import AgentLoop from '@deepseek-ai/dsh-agent-loop';
import LlmRuntime, { LlmAdapter } from '@deepseek-ai/dsh-llm';
import SystemPrompt from '@deepseek-ai/dsh-system-prompt';
import ToolRuntime from '@deepseek-ai/dsh-tools';
import SessionProjections from '@deepseek-ai/dsh-session-projection';
import * as Jsonl from '@deepseek-ai/dsh-session-persistence-jsonl';
import SessionQuery from '@deepseek-ai/dsh-session-query-sqlite';

const built = await build({ stdin: { contents: `export { createConversationWorkspace } from './src/conversation-workspace/index.ts'; export { withConversationArchive } from './src/conversation-workspace/archive.ts'; export { SessionArchiveRuntime } from './src/session-archive.ts'; export { ArchiveRuntime } from './src/archives.ts'; export { RedTeamStore } from './src/store.ts';`, resolveDir: process.cwd() }, bundle: true, write: false, platform: 'node', format: 'esm', packages: 'external' });
const code = built.outputFiles[0].text.replace(/from\s+(["'])([^"']+)\1/g, (_m, _q, specifier) => `from ${JSON.stringify(import.meta.resolve(specifier))}`);
const { createConversationWorkspace, withConversationArchive, SessionArchiveRuntime, ArchiveRuntime, RedTeamStore } = await import(`data:text/javascript;base64,${Buffer.from(code + '\n//# sourceURL=conversation-archive-test.bundle.mjs').toString('base64')}`);
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
class Adapter extends LlmAdapter {
  responses = []; requests = [];
  async resolveModel(provider, model) { return { provider, id: model, name: model }; }
  async *stream(request) {
    this.requests.push(request);
    const response = this.responses.shift(); assert.notEqual(response, undefined, 'unexpected model request');
    if (typeof response === 'function') { yield* response(request); return; }
    yield { type: 'text-delta', index: 0, text: response }; yield { type: 'finish', reason: { kind: 'stop' } };
  }
}
async function fixture(t) {
  const dir = await mkdtemp(join(tmpdir(), 'conversation-archive-')), fibers = [], workspaces = [];
  t.after(async () => { for (const workspace of workspaces.reverse()) await workspace.dispose(); for (const fiber of fibers.reverse()) await fiber.dispose(); await rm(dir, { recursive: true, force: true }); });
  const store = new RedTeamStore(join(dir, 'state.json')); await store.load();
  const task = await store.createTask('Conversation archive', 'Preserve native conversations and side questions');
  await store.setTaskStatus(task.id, 'paused');
  async function backend(name) {
    const app = new Context(), adapter = new Adapter();
    for (const [plugin, config] of [[SessionStore], [AgentRegistry], [LlmRuntime], [SystemPrompt, {}], [ToolRuntime, { mode: 'native' }], [SessionProjections], [Jsonl, { root: join(dir, name, 'native') }], [SessionQuery, { path: ':memory:', openAt: 'never' }], [AgentLoop, {}]]) fibers.push(await app.plugin(plugin, config));
    let host;
    fibers.push(await app.plugin(owner => { owner.inject(['llm', 'agents', 'sessionPersistence', 'sessionQuery'], ctx => { host = ctx; ctx.llm.registerAdapter(['fixture'], adapter); }); }));
    const workspace = await createConversationWorkspace(host, store, {
      directory: join(dir, name, 'metadata'), workspaceRoot: join(dir, 'workspace'),
      profiles: { resolveProfile: () => null, resolveBinding: () => null, resolveGlobal: () => ({ provider: 'fixture', model: 'fixture' }) },
      resolveAgent: () => true,
      prepareRun: async () => ({ provider: 'fixture', model: 'fixture', attach: () => () => {}, dispose: async () => {} }),
    });
    workspaces.push(workspace);
    const sessions = withConversationArchive(new SessionArchiveRuntime(app.get('sessionPersistence'), { listDescendants: async () => [] }), workspace);
    const archives = new ArchiveRuntime(store, { dataDir: dir, sessions, lifecycle: { quiesce: async () => {} } });
    async function turn(conversation, text = 'Archived native evidence') { adapter.responses.push('native answer'); await workspace.conversations.send(conversation.id, text); await workspace.conversations.wait(conversation.id); }
    return { app, adapter, workspace, sessions, archives, turn };
  }
  return { dir, store, task, backend };
}
async function inspect(persistence, id) { const handle = await persistence.open(SessionId(id), 'read'); try { return { header: handle.header, events: (await handle.read()).events }; } finally { await handle.close(); } }

test('task archive restores exploration metadata, tombstones, side history and real native JSONL into a fresh workspace', { timeout: 30000 }, async t => {
  const f = await fixture(t), source = await f.backend('source'), target = await f.backend('target');
  const main = await source.workspace.conversations.ensureMainSession(f.task.id);
  const exploration = await source.workspace.conversations.create({ taskId: f.task.id, agentKey: 'mainagent', title: 'Exploration' });
  const tombstone = await source.workspace.conversations.create({ taskId: f.task.id, agentKey: 'mainagent', title: 'Deleted segment' });
  const unrelated = await source.workspace.conversations.create({ agentKey: 'custom', title: 'Unrelated conversation' });
  for (const row of [main, exploration, tombstone, unrelated]) await source.turn(row);
  await source.workspace.conversations.delete(tombstone.id);
  const parent = { kind: 'task', id: f.task.id, explorationId: exploration.id };
  source.adapter.responses.push('Side evidence preserved');
  const answer = await source.workspace.sideQuestions.ask(parent, { clientRequestId: 'archive-question', question: 'What was found?' });
  await source.workspace.sideQuestions.wait(answer.id);
  const metadata = await source.workspace.conversations.exportTaskArchive(f.task.id);
  const side = await source.workspace.sideQuestions.exportTaskArchive(f.task.id);
  assert.equal(metadata.conversations.length, 3); assert.ok(metadata.conversations.find(row => row.id === tombstone.id).deletedAt);
  const job = await source.archives.archive(f.task.id);
  await target.archives.restore(job.id);
  assert.deepEqual(await target.workspace.conversations.exportTaskArchive(f.task.id), metadata);
  assert.deepEqual(await target.workspace.sideQuestions.exportTaskArchive(f.task.id), side);
  assert.equal((await target.workspace.sideQuestions.list(parent)).items[0].answer, 'Side evidence preserved');
  for (const row of [main, exploration, tombstone]) assert.deepEqual(await inspect(target.app.get('sessionPersistence'), row.sessionId), await inspect(source.app.get('sessionPersistence'), row.sessionId));
  assert.equal(await target.app.get('sessionPersistence').stat(SessionId(unrelated.sessionId)), undefined);
  assert.equal((await target.workspace.conversations.list()).some(row => row.id === tombstone.id), false);
  target.adapter.responses.push('Answer after restore');
  const continued = await target.workspace.sideQuestions.ask(parent, { clientRequestId: 'restored-question', question: 'Continue from restored evidence?' });
  assert.ok(continued.ordinal > answer.ordinal);
  assert.equal((await target.workspace.sideQuestions.wait(continued.id)).answer, 'Answer after restore');
});

test('archive drains an active side answer and releases its operation gate after capture failure', { timeout: 30000 }, async t => {
  const f = await fixture(t), source = await f.backend('source');
  const main = await source.workspace.conversations.ensureMainSession(f.task.id); await source.turn(main);
  const parent = { kind: 'task', id: f.task.id, explorationId: main.id }, entered = deferred();
  source.adapter.responses.push(async function* (request) { entered.resolve(); await new Promise(resolve => { request.signal.addEventListener('abort', resolve, { once: true }); if (request.signal.aborted) resolve(); }); });
  const answer = await source.workspace.sideQuestions.ask(parent, { clientRequestId: 'active', question: 'Pending answer' }); await entered.promise;
  const failing = withConversationArchive({ capture: async () => { throw new Error('capture fixture failure'); }, restore: async () => {} }, source.workspace);
  const archives = new ArchiveRuntime(f.store, { dataDir: f.dir, sessions: failing, lifecycle: { quiesce: async () => {} } });
  await assert.rejects(archives.archive(f.task.id), /capture fixture failure/);
  assert.equal((await source.workspace.sideQuestions.get(answer.id)).status, 'cancelled');
  await source.turn(main, 'Retry after released archive gate');
  source.adapter.responses.push('Side resumed');
  const next = await source.workspace.sideQuestions.ask(parent, { clientRequestId: 'retry', question: 'Continue?' });
  assert.equal((await source.workspace.sideQuestions.wait(next.id)).answer, 'Side resumed');
});

test('metadata conflict rejects restore before new native sessions and releases the restore gate', { timeout: 30000 }, async t => {
  const f = await fixture(t), source = await f.backend('source'), target = await f.backend('target');
  const main = await source.workspace.conversations.ensureMainSession(f.task.id); await source.turn(main);
  const metadata = await source.workspace.conversations.exportTaskArchive(f.task.id);
  const changed = structuredClone(metadata); changed.conversations[0].title = 'Existing different metadata';
  await target.workspace.conversations.restoreTaskArchive(f.task.id, changed);
  const job = await source.archives.archive(f.task.id);
  await assert.rejects(target.archives.restore(job.id), /conflict/i);
  assert.equal(await target.app.get('sessionPersistence').stat(SessionId(main.sessionId)), undefined);
  assert.deepEqual(await target.workspace.conversations.exportTaskArchive(f.task.id), changed);
  const barrier = await target.workspace.prepareTaskDelete(f.task.id); await barrier.rollback();
});
