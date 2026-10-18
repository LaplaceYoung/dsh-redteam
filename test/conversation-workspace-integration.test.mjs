import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { build } from 'esbuild';
import { Context } from '@deepseek-ai/cordis';
import { SessionStore } from '@deepseek-ai/dsh-session';
import AgentRegistry from '@deepseek-ai/dsh-agent';
import AgentLoop from '@deepseek-ai/dsh-agent-loop';
import LlmRuntime, { LlmAdapter } from '@deepseek-ai/dsh-llm';
import SystemPrompt from '@deepseek-ai/dsh-system-prompt';
import ToolRuntime from '@deepseek-ai/dsh-tools';
import SessionProjections from '@deepseek-ai/dsh-session-projection';
import * as JsonlPersistence from '@deepseek-ai/dsh-session-persistence-jsonl';
import SessionQuery from '@deepseek-ai/dsh-session-query-sqlite';
const built = await build({ entryPoints: ['src/conversation-workspace/index.ts'], bundle: true, write: false, platform: 'node', format: 'esm', packages: 'external' });
const code = built.outputFiles[0].text.replace(/from\s+(["'])([^"']+)\1/g, (_m, _q, specifier) => `from ${JSON.stringify(import.meta.resolve(specifier))}`);
const { createConversationWorkspace, createConversationWorkspaceHandler, installConversationWorkspaceTools } = await import(`data:text/javascript;base64,${Buffer.from(code + '\n//# sourceURL=conversation-workspace-integration.bundle.mjs').toString('base64')}`);
class Adapter extends LlmAdapter {
  requests = [];
  async resolveModel(provider, model) { return { provider, id: model, name: model, context: { contextWindow: 200000 } }; }
  async *stream(request) { this.requests.push(request); yield { type: 'text-delta', index: 0, text: 'actual adapter reply' }; yield { type: 'finish', reason: { kind: 'stop' } }; }
}
async function fixture(t) {
  const dir = await mkdtemp(join(tmpdir(), 'conversation-integration-')), app = new Context(), fibers = [], adapter = new Adapter();
  let runtime, server;
  t.after(async () => { if (server) { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); } await runtime?.dispose(); for (const fiber of fibers.reverse()) await fiber.dispose(); await rm(dir, { recursive: true, force: true }); });
  for (const [module, config] of [[SessionStore], [AgentRegistry], [LlmRuntime], [SystemPrompt, {}], [ToolRuntime, { mode: 'native' }], [SessionProjections], [JsonlPersistence, { root: join(dir, 'native') }], [SessionQuery, { path: ':memory:', openAt: 'never' }], [AgentLoop, {}]]) fibers.push(await app.plugin(module, config));
  let host;
  fibers.push(await app.plugin(async ctx => { await ctx.inject(['llm', 'agents', 'tools', 'sessionPersistence', 'sessionQuery'], inner => { host = inner; inner.llm.registerAdapter(['fixture'], adapter); }); }));
  // Snapshot boundary is in-memory; all conversation/LLM/session/files/HTTP behavior is real.
  const assetId = '11111111-1111-4111-8111-111111111111';
  const state = { tasks: [{ id: 'task-1' }], archives: [], intents: [], assets: [{ id: assetId, taskId: 'task-1', kind: 'ip', value: '127.0.0.1', metadata: {} }], findings: [], companies: [], scopes: [] };
  const store = { storagePath: join(dir, 'store.json'), snapshot: () => structuredClone(state) };
  runtime = await createConversationWorkspace(host, store, { profiles: { resolveProfile: () => null, resolveBinding: () => null, resolveGlobal: () => ({ provider: 'fixture', model: 'local' }) }, resolveAgent: key => ['custom', 'mainagent'].includes(key), resolveAgentProfile: () => null,
    prepareRun: async () => ({ attach: () => () => {}, dispose: async () => {} }) });
  const unregister = installConversationWorkspaceTools(host, runtime);
  const handler = createConversationWorkspaceHandler(runtime, { authenticate: request => request.headers.authorization === 'Bearer owner' ? true : 401 });
  server = createServer((request, response) => { void handler(request, response).then(handled => { if (!handled) { response.statusCode = 404; response.end(); } }); });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const base = `http://127.0.0.1:${server.address().port}/api/redteam/conversation-workspace`;
  async function request(path, method = 'GET', body, headers = {}) {
    const response = await fetch(base + path, { method, headers: { authorization: 'Bearer owner', ...(body === undefined ? {} : { 'content-type': 'application/json' }), ...headers }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    return { response, data: await response.json() };
  }
  return { runtime, adapter, state, assetId, request, host, unregister, base };
}
test('authenticated HTTP joins true conversation sends, mention lookup, attachment uploads and independent side replies', { timeout: 30000 }, async t => {
  const f = await fixture(t);
  assert.equal((await f.request('/conversations', 'GET', undefined, { authorization: '' })).response.status, 401);
  assert.equal((await f.request('/conversations', 'POST', { agent_key: 'custom' }, { origin: 'http://evil.test' })).response.status, 403);
  assert.equal((await f.runtime.conversations.list()).length, 0);
  const created = await f.request('/conversations', 'POST', { agent_key: 'custom' }); assert.equal(created.response.status, 200); const c = created.data;
  const form = new FormData(); form.append('file', new Blob(['actual evidence']), 'proof.txt');
  const upload = await fetch(`${f.base}/files/chat-upload?scope=session&id=${c.id}`, { method: 'POST', headers: { authorization: 'Bearer owner' }, body: form }); assert.equal(upload.status, 200);
  const attachments = (await upload.json()).attachments;
  const sent = await f.request(`/conversations/${c.id}/send`, 'POST', { message: `检查 @[IP#${f.assetId} forged label]`, attachments }); assert.equal(sent.response.status, 200);
  await f.runtime.conversations.wait(c.id);
  const main = f.adapter.requests.find(row => row.sessionId === c.sessionId); const content = JSON.stringify(main.messages);
  assert.ok(content.includes('127.0.0.1')); assert.ok(content.includes('proof.txt')); assert.ok(content.includes('用户引用的记录快照'));
  const messages = await f.request(`/conversations/${c.id}/messages?limit=1`); assert.equal(messages.data.events.length, 1); assert.equal(messages.data.hasMore, true);
  const side = await f.request('/side-questions', 'POST', { parent_kind: 'conversation', parent_id: c.id, client_request_id: 'http-side-1', question: '解释已知证据' }); assert.equal(side.response.status, 200);
  const events = await fetch(`${f.base}/side-requests/${side.data.id}/events`, { headers: { authorization: 'Bearer owner' } }); const sse = await events.text();
  assert.ok(sse.includes('event: exchange')); assert.ok(sse.includes('completed')); assert.equal((await f.runtime.sideQuestions.wait(side.data.id)).answer, 'actual adapter reply');
  assert.equal(f.adapter.requests.at(-1).sessionId, undefined); assert.equal(f.adapter.requests.at(-1).tools, undefined);
  assert.equal((await f.request(`/conversations/${c.id}/unknown`)).response.status, 404);
  assert.equal((await f.request(`/conversations/${c.id}/send`, 'POST', { message: '@[IP#999 missing]' })).response.status, 400);
  await f.request(`/conversations/${c.id}`, 'DELETE'); assert.equal((await f.runtime.conversations.list()).length, 0);
});
test('aggregate task deletion waits uploads, rolls back files and permits same-ID recreation only after commit', { timeout: 30000 }, async t => {
  const f = await fixture(t), r = f.runtime;
  const c = (await f.request('/tasks/task-1/main-session', 'POST')).data;
  await r.files.write('tasks/task-1/proof.txt', 'proof');
  const release = await r.acquireTaskOperation('task-1');
  let prepared = false; const pending = r.prepareTaskDelete('task-1', { deleteFiles: true }).then(value => { prepared = true; return value; });
  await assert.rejects(r.acquireTaskOperation('task-1'), /删除/); assert.equal(prepared, false);
  release(); const tx = await pending; await assert.rejects(access(join(c.cwd, 'proof.txt')));
  await tx.rollback(); assert.equal((await r.files.read('tasks/task-1/proof.txt')).content, 'proof');
  const deletion = await r.prepareTaskDelete('task-1', { deleteFiles: true }); f.state.tasks = []; await deletion.commit();
  await assert.rejects(r.acquireTaskOperation('task-1'), /不存在/); assert.equal((await r.conversations.segments('task-1')).sessions.length, 0);
  f.state.tasks = [{ id: 'task-1' }]; const next = await r.conversations.ensureMainSession('task-1'); assert.notEqual(next.sessionId, c.sessionId);
  await assert.rejects(access(join(c.cwd, 'proof.txt')));
});
test('scoped tool registrations point at the shared runtime and dispose completely', async t => {
  const f = await fixture(t);
  const names = ['redteam_conversation', 'redteam_side_question', 'redteam_workspace_file', 'redteam_search_chat_mentions'];
  for (const name of names) assert.ok(f.host.tools.get(name));
  f.unregister(); for (const name of names) assert.equal(f.host.tools.get(name), undefined);
});
