import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rename, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { build } from 'esbuild';
import { Context } from '@deepseek-ai/cordis';
import { SessionId, SessionStore } from '@deepseek-ai/dsh-session';
import AgentRegistry from '@deepseek-ai/dsh-agent';
import AgentLoop from '@deepseek-ai/dsh-agent-loop';
import LlmRuntime, { LlmAdapter } from '@deepseek-ai/dsh-llm';
import SystemPrompt from '@deepseek-ai/dsh-system-prompt';
import ToolRuntime, { defineTool } from '@deepseek-ai/dsh-tools';
import SessionProjections from '@deepseek-ai/dsh-session-projection';
import * as JsonlPersistence from '@deepseek-ai/dsh-session-persistence-jsonl';
import SessionQuery from '@deepseek-ai/dsh-session-query-sqlite';

const built = await build({ entryPoints: ['src/conversation-workspace/conversations.ts'], bundle: true, write: false, platform: 'node', format: 'esm', packages: 'external' });
const code = built.outputFiles[0].text.replace(/from\s+(["'])([^"']+)\1/g, (_m, _q, specifier) => `from ${JSON.stringify(import.meta.resolve(specifier))}`);
const { ConversationRuntime } = await import(`data:text/javascript;base64,${Buffer.from(code + '\n//# sourceURL=conversation-workspace-conversations.bundle.mjs').toString('base64')}`);
class Adapter extends LlmAdapter {
  requests = []; block = false; callTool = false; entered; enteredPromise;
  constructor() { super(); this.enteredPromise = new Promise(resolve => { this.entered = resolve; }); }
  async resolveModel(provider, model) { return { provider, id: model, name: model }; }
  async *stream(request) {
    this.requests.push(request); this.entered();
    if (this.block) await new Promise(resolve => { request.signal.addEventListener('abort', resolve, { once: true }); if (request.signal.aborted) resolve(); });
    else if (this.callTool) { this.callTool = false; yield { type: 'tool-call-delta', index: 0, id: 'conversation-call', name: 'conversation_fixture_tool', argumentsDelta: '{}' }; yield { type: 'finish', reason: { kind: 'tool-calls' } }; }
    else { yield { type: 'text-delta', index: 0, text: `native reply ${request.model}` }; yield { type: 'finish', reason: { kind: 'stop' } }; }
  }
}
async function fixture(t, extra = {}) {
  const dir = await mkdtemp(join(tmpdir(), 'artex-conversations-')), app = new Context(), fibers = [], runtimes = [], adapter = new Adapter();
  t.after(async () => { for (const runtime of runtimes.reverse()) await runtime.dispose(); for (const fiber of fibers.reverse()) await fiber.dispose(); await rm(dir, { recursive: true, force: true }); });
  for (const [module, config] of [[SessionStore], [AgentRegistry], [LlmRuntime], [SystemPrompt, {}], [ToolRuntime, { mode: 'native' }], [SessionProjections], [JsonlPersistence, { root: join(dir, 'native-sessions') }], [SessionQuery, { path: ':memory:', openAt: 'never' }], [AgentLoop, {}]]) fibers.push(await app.plugin(module, config));
  let host;
  fibers.push(await app.plugin(ctx => { ctx.inject(['llm', 'agents', 'tools', 'sessionPersistence', 'sessionQuery'], inner => { host = inner; inner.llm.registerAdapter(['fixture'], adapter); }); }));
  const bindings = [], unbindings = [], prepared = [], detached = [], setups = [];
  const options = { storagePath: join(dir, 'conversations.json'), workspaceRoot: join(dir, 'workspace'), profiles: { resolveProfile: id => id === 'bad' ? null : { provider: 'fixture', model: id }, resolveBinding: () => null, resolveGlobal: () => ({ provider: 'fixture', model: 'global' }) }, resolveAgent: key => ['custom', 'mainagent', 'bound'].includes(key), resolveAgentProfile: key => key === 'bound' ? { provider: 'fixture', model: 'agent-bound' } : null, taskExists: id => id === 'task-1', bindTask: (id, agent) => { bindings.push({ id, agent }); return () => { unbindings.push(agent); }; }, setupAgent: (scope, agent) => { setups.push(agent); scope.tools.register(defineTool({ name: 'persistent_scope_tool', description: 'Survives chat turns', parameters: {}, output: { schema: { type: 'json' }, render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }] }, execute: () => true })); }, prepareMessage: (message, attachments) => `${message}\nresolved context ${attachments.map(a => a.path).join(',')}`, prepareRun: async input => {
    prepared.push(input);
    return { provider: 'fixture', model: 'prepared-fallback',
      attach: (scope, agent) => {
        const request = scope.on('agent/request', async (_payload, next) => { if (input.signal) assert.equal(input.signal.aborted, false, 'run preparation remains valid during actual model dispatch'); return next(); });
        const remove = scope.tools.register(defineTool({ name: 'conversation_fixture_tool', description: 'Actual native scoped tool', parameters: {}, output: { schema: { type: 'json' }, render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }] }, execute: () => { if (input.signal) assert.equal(input.signal.aborted, false, 'run preparation remains valid during native tool execution'); return { agentId: agent.id }; } }));
        return () => { detached.push(agent.id); request(); remove(); };
      }, dispose: async () => {},
    };
  }, ...extra };
  async function runtime(overrides = {}) { const value = new ConversationRuntime(host, { ...options, ...overrides }); runtimes.push(value); await value.initialize(); return value; }
  return { app, dir, adapter, options, prepared, detached, bindings, unbindings, setups, runtime, conversations: await runtime() };
}

test('native conversations preserve CRUD, profile precedence, raw input, cursor reads and cold recovery', { timeout: 30000 }, async t => {
  const f = await fixture(t), r = f.conversations;
  const c = await r.create({ agentKey: 'custom', profileId: 'pinned' });
  const native = f.app.get('agents').get(SessionId(c.sessionId));
  assert.ok(native); assert.equal(native.session.header.parentSession, undefined); assert.equal(native.session.header.cwd, join(f.options.workspaceRoot, 'sessions', c.id));
  assert.ok(f.app.get('tools').get('conversation_fixture_tool', native));
  f.adapter.callTool = true;
  await r.send(c.id, 'Original first question', { attachments: [{ name: 'proof.txt', path: 'proof.txt', size: 7 }] }); await r.wait(c.id);
  assert.equal(f.adapter.requests[0].model, 'pinned');
  const page = await r.messages(c.id, 0, 1); assert.equal(page.events.length, 1); assert.equal(page.cursor, 1); assert.equal(page.hasMore, true);
  const all = await r.messages(c.id, 0, 1000);
  assert.ok(JSON.stringify(all.events).includes('resolved context proof.txt'));
  assert.ok(JSON.stringify(all.events).includes('artex-conversation-user'));
  const toolResult = all.events.find(event => event.type === 'tool/result');
  assert.ok(toolResult, 'native AgentLoop executes its advertised scoped tool');
  assert.ok(JSON.stringify(toolResult).includes(c.sessionId), JSON.stringify(toolResult));
  assert.equal((await r.get(c.id)).title, 'Original first question');
  assert.equal((await r.list({ query: 'native reply' })).length, 1);
  const firstPin = await r.update(c.id, { pinned: true, title: 'Renamed' });
  assert.equal((await r.update(c.id, { pinned: true })).pinnedAt, firstPin.pinnedAt);
  await r.update(c.id, { profileId: null }); await r.send(c.id, 'global next'); await r.wait(c.id); assert.equal(f.adapter.requests.at(-1).model, 'global');
  assert.equal(f.app.get('agents').get(SessionId(c.sessionId)), native, 'multiple turns retain the same actual Agent object and its worker scope');
  assert.equal(f.setups.length, 1); assert.ok(f.app.get('tools').get('persistent_scope_tool', native));
  assert.ok(f.prepared.every(input => input.workingDirectory === c.cwd));
  await r.dispose();
  const reopened = await f.runtime(); const agent = await reopened.recover(c.id);
  assert.equal(agent.id, c.sessionId); assert.ok((await reopened.messages(c.id)).events.length >= all.events.length);
  await reopened.send(c.id, 'after restart'); await reopened.wait(c.id); assert.equal(f.adapter.requests.at(-1).model, 'global');
  const bound = await reopened.create({ agentKey: 'bound', profileId: 'pinned' }); await reopened.send(bound.id, 'binding wins'); await reopened.wait(bound.id);
  assert.equal(f.adapter.requests.at(-1).model, 'agent-bound');
  await reopened.delete(c.id); assert.equal((await reopened.list()).some(row => row.id === c.id), false);
  await assert.rejects(reopened.recover(c.id), /not found/);
  assert.ok(await f.app.get('sessionPersistence').stat(SessionId(c.sessionId)), 'SDK-native audit history is retained because SDK has no delete API');
});

test('task segments share workspace, one live turn, cancel/drain and deletion rollback without touching task graph', { timeout: 30000 }, async t => {
  const f = await fixture(t), r = f.conversations;
  const [one, same] = await Promise.all([r.ensureMainSession('task-1'), r.ensureMainSession('task-1')]);
  assert.equal(one.sessionId, same.sessionId, 'concurrent ensure creates precisely one actual native segment zero');
  const two = await r.create({ agentKey: 'mainagent', taskId: 'task-1' });
  assert.equal(one.cwd, two.cwd); assert.equal(one.segment, 0); assert.equal(two.segment, 1);
  assert.deepEqual((await r.segments('task-1')).sessions.map(row => row.segment), [1, 0]);
  f.adapter.block = true; await r.send(one.id, 'long native turn'); await f.adapter.enteredPromise;
  await assert.rejects(r.send(two.id, 'must not overlap'), /already running/);
  await r.cancel(one.id); assert.equal((await r.get(one.id)).running, false);
  const deleting = await r.prepareTaskDelete('task-1');
  await assert.rejects(r.send(two.id, 'deleting'), /being deleted/); await assert.rejects(r.create({ agentKey: 'mainagent', taskId: 'task-1' }), /being deleted/);
  await assert.rejects(r.delete(two.id), /being deleted/);
  await deleting.rollback(); f.adapter.block = false; await r.send(one.id, 'historical segment still interactive'); await r.wait(one.id);
  const final = await r.prepareTaskDelete('task-1'); await final.commit(); await final.commit(); assert.deepEqual((await r.segments('task-1')).sessions, []);
  assert.equal(f.unbindings.length, 2, 'each actual Agent scope releases its task alias exactly once');
  await assert.rejects(r.create({ agentKey: 'mainagent', taskId: 'missing' }), /Task not found/);
  assert.ok(f.bindings.every(binding => binding.id === 'task-1' && binding.agent.id));
});

test('metadata rejects corruption, unknown profiles and working-directory escape; ownership never steals a live agent', { timeout: 30000 }, async t => {
  const f = await fixture(t), r = f.conversations;
  await assert.rejects(r.create({ agentKey: 'unknown' }), /Agent not found/);
  await assert.rejects(r.create({ agentKey: 'custom', profileId: 'bad' }), /profile is unavailable/);
  await assert.rejects(r.create({ agentKey: 'custom', cwd: '../escape' }), /根目录/);
  const c = await r.create({ agentKey: 'custom' });
  const competitor = await f.runtime(); await assert.rejects(competitor.recover(c.id), /owned by another/);
  await competitor.dispose(); assert.ok(f.app.get('agents').get(SessionId(c.sessionId)), 'foreign runtime cannot dispose the actual owner');
  const brokenPath = join(f.dir, 'broken.json'); await writeFile(brokenPath, '{"version":1,"conversations":[{}]}');
  const broken = new ConversationRuntime(f.app, { ...f.options, storagePath: brokenPath });
  await assert.rejects(broken.initialize(), /Invalid conversation/);
});

test('conversation delete retries post-commit side cleanup without reviving tombstoned sessions', { timeout: 30000 }, async t => {
  let attempts = 0, rollbacks = 0;
  const f = await fixture(t, { prepareSideQuestionDelete: async () => ({ commit: async () => { if (++attempts === 1) throw new Error('cleanup failed'); }, rollback: async () => { rollbacks++; } }) });
  const c = await f.conversations.create({ agentKey: 'custom' });
  await assert.rejects(f.conversations.delete(c.id), /cleanup failed/);
  assert.deepEqual(await f.conversations.list(), []); await f.conversations.delete(c.id);
  assert.equal(attempts, 2); assert.equal(rollbacks, 0);
});

test('failed metadata deletion rolls back side-question fence and permits native session recovery', { timeout: 30000 }, async t => {
  let committed = 0, rolledBack = 0;
  const f = await fixture(t, { prepareSideQuestionDelete: async () => ({ commit: async () => { committed++; }, rollback: async () => { rolledBack++; } }) });
  const row = await f.conversations.create({ agentKey: 'custom' });
  const saved = f.options.storagePath + '.saved'; await rename(f.options.storagePath, saved); await mkdir(f.options.storagePath);
  await assert.rejects(f.conversations.delete(row.id)); assert.equal(rolledBack, 1); assert.equal(committed, 0);
  await rm(f.options.storagePath, { recursive: true }); await rename(saved, f.options.storagePath);
  assert.equal((await f.conversations.get(row.id)).id, row.id);
  const native = await f.conversations.recover(row.id); assert.equal(native.id, row.sessionId);
  await f.conversations.send(row.id, 'Recovered after storage failure'); await f.conversations.wait(row.id);
  assert.equal(f.adapter.requests.length, 1);
});

test('archive seams preserve tombstones, reject resurrection and restore metadata under a deletion gate', { timeout: 30000 }, async t => {
  let taskAvailable = true;
  const f = await fixture(t, { taskExists: id => taskAvailable && id === 'task-1' }), r = f.conversations;
  const zero = await r.ensureMainSession('task-1'), deleted = await r.create({ agentKey: 'mainagent', taskId: 'task-1' });
  await r.delete(deleted.id); await r.quiesceTask('task-1');
  assert.equal(f.app.get('agents').get(SessionId(zero.sessionId)), undefined, 'archive quiescence disposes the owned live Agent so direct native sends cannot bypass the archive gate');
  assert.ok(await f.app.get('sessionPersistence').stat(SessionId(zero.sessionId)), 'archive quiescence retains the native persisted transcript');
  const backup = await r.exportTaskArchive('task-1'); assert.equal(backup.conversations.length, 2); assert.ok(backup.conversations.find(row => row.id === deleted.id).deletedAt);
  taskAvailable = false; assert.deepEqual(await r.list(), []);
  const destination = await f.runtime({ storagePath: join(f.dir, 'restored-conversations.json') });
  const gate = await destination.prepareTaskDelete('task-1');
  await destination.preflightTaskArchive('task-1', backup); await destination.restoreTaskArchive('task-1', backup); await destination.restoreTaskArchive('task-1', backup);
  assert.deepEqual(await destination.exportTaskArchive('task-1'), backup);
  const revive = structuredClone(backup); revive.conversations.find(row => row.id === deleted.id).deletedAt = null;
  await assert.rejects(destination.preflightTaskArchive('task-1', revive), /conflicts/);
  await gate.rollback(); await r.dispose(); taskAvailable = true;
  assert.deepEqual((await destination.list()).map(row => row.id), [zero.id]);
  const agent = await destination.recover(zero.id); assert.equal(agent.id, zero.sessionId);
  await assert.rejects(destination.recover(deleted.id), /not found/);
});

test('an empty native conversation can be created before a global model is configured', { timeout: 30000 }, async t => {
  let global = null;
  const f = await fixture(t, { profiles: { resolveProfile: () => null, resolveBinding: () => null, resolveGlobal: () => global }, prepareRun: async () => ({ attach: () => () => {}, dispose: async () => {} }) });
  const row = await f.conversations.create({ agentKey: 'custom' });
  const native = f.app.get('agents').get(SessionId(row.sessionId)); assert.ok(native); assert.equal(native.options.provider, undefined);
  await assert.rejects(f.conversations.send(row.id, 'not configured yet'), /No available conversation model/);
  assert.equal(f.adapter.requests.length, 0);
  global = { provider: 'fixture', model: 'newly-configured' };
  await f.conversations.send(row.id, 'now configured'); await f.conversations.wait(row.id);
  assert.equal(f.adapter.requests.at(-1).model, 'newly-configured');
  assert.equal(f.app.get('agents').get(SessionId(row.sessionId)), native);
});
