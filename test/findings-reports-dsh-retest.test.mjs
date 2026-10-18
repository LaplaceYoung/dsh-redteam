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
import { createDshRetestProvider } from '../lib/findings-reports/dsh-retest.js';

class Model extends LlmAdapter {
  requests = [];
  finish = 'stop';
  hold;
  onRequest;
  async *stream(request) {
    this.requests.push(request);
    this.onRequest?.(request);
    if (this.hold) {
      this.hold.entered.resolve();
      await new Promise((resolve, reject) => {
        const abort = () => reject(request.signal.reason);
        request.signal.addEventListener('abort', abort, { once: true });
        this.hold.release.promise.then(resolve, reject).finally(() => request.signal.removeEventListener('abort', abort));
        if (request.signal.aborted) abort();
      });
    }
    yield { type: 'text-delta', index: 0, text: 'Recorded retest outcome' };
    yield { type: 'finish', reason: this.finish === 'error' ? { kind: 'error', failure: { message: 'fixture provider failure', code: 'FIXTURE' } } : { kind: this.finish } };
  }
}

async function fixture(t) {
  const dir = await mkdtemp(join(tmpdir(), 'finding-retest-dsh-'));
  const app = new Context(), fibers = [], parents = [], sessions = new Map(), model = new Model();
  t.after(async () => {
    model.hold?.release.resolve();
    for (const handle of parents.reverse()) await handle.dispose();
    for (const fiber of fibers.reverse()) await fiber.dispose();
    await rm(dir, { recursive: true, force: true });
  });
  const mount = async (plugin, config) => { fibers.push(await app.plugin(plugin, config)); };
  await mount(SessionStore); await mount(AgentRegistry); await mount(LlmRuntime);
  await mount(SystemPrompt, {}); await mount(ToolRuntime, { mode: 'native' }); await mount(SessionProjections);
  await mount(LocalFileSystem, { cwd: dir }); await mount(WorkingDirectory, { defaultDirectory: dir });
  await mount(JsonlPersistence, { root: join(dir, 'sessions') });
  await mount(SessionQuery, { path: ':memory:', openAt: 'never' });
  await mount(AgentLoop, {}); await mount(Subagents, {}); await mount(spawnProvider, {});
  await mount(ctx => {
    ctx.inject(['llm'], inner => inner.llm.registerAdapter(['fixture', 'retest-route'], model));
    ctx.on('session/event', session => { sessions.set(session.id, session); });
  });
  const makeParent = async () => {
    const handle = await app.get('agents').create({ sessionId: SessionId(randomUUID()), meta: { cwd: dir }, agentOptions: { provider: 'fixture', model: 'parent-model', maxTokens: 1200 } });
    parents.push(handle); return handle.agent;
  };
  const parent = await makeParent();
  const ctx = { root: app, agents: app.get('agents'), subagents: app.get('subagents') };
  const retest = { id: 'retest-1', findingId: 'finding-1', status: 'pending', notes: 'Authorized local fixture only', createdAt: '2026-10-18T00:00:00Z', snapshot: { finding: { id: 'finding-1', taskId: 'task-1', summary: 'Original recorded issue', status: 'confirmed', severity: 'high', evidenceIds: [], assetIds: [], createdAt: '2026-10-18T00:00:00Z' }, assets: [], constraints: [] } };
  return { app, ctx, parent, makeParent, model, sessions, retest };
}
function end(f, id) { return f.sessions.get(id)?.snapshotEvents().filter(event => event.type === 'turn/end').at(-1); }

test('real spawn binds before execution, inherits route, isolates history and drains after completed turn', { timeout: 20000 }, async t => {
  const f = await fixture(t);
  f.parent.followup({ id: randomUUID(), role: 'user', content: [{ type: 'text', text: 'PARENT_ONLY_PRIVATE_HISTORY' }], source: { kind: 'user' } });
  await f.parent.whenIdle();
  f.model.requests.length = 0;
  let childId, bound = false;
  f.model.onRequest = () => {
    assert.equal(bound, true);
    assert.equal(f.ctx.agents.isOwnedBy(SessionId(childId), f.parent), true);
  };
  const result = await createDshRetestProvider(f.ctx, f.parent).run({ retest: f.retest, signal: AbortSignal.timeout(10000), onSession: async id => {
    childId = id;
    assert.equal(f.ctx.agents.get(SessionId(id)), undefined, 'binding precedes Agent creation');
    assert.equal(f.model.requests.length, 0);
    await Promise.resolve(); bound = true;
  } });
  assert.equal(result, 'done');
  assert.equal(end(f, childId).data.reason.kind, 'completed');
  assert.equal(f.sessions.get(childId).header.parentSession, f.parent.id);
  assert.equal(f.ctx.agents.get(SessionId(childId)), undefined, 'child is drained');
  assert.equal(f.ctx.agents.get(f.parent.id), f.parent, 'parent remains live');
  assert.equal(f.model.requests[0].provider, 'fixture');
  assert.equal(f.model.requests[0].model, 'parent-model');
  assert.equal(f.model.requests[0].maxTokens, 1200);
  assert.equal(JSON.stringify(f.model.requests).includes('PARENT_ONLY_PRIVATE_HISTORY'), false);
  const catalog = await f.ctx.subagents.listChildren(f.parent.id);
  assert.equal(catalog.some(row => row.id === childId && row.mode === 'continuable'), true);
});

test('real spawn accepts model route overrides in supported agentOptions fields', { timeout: 20000 }, async t => {
  const f = await fixture(t);
  const provider = createDshRetestProvider(f.ctx, f.parent, { route: { provider: 'retest-route', model: 'retester-model', maxTokens: 3456 } });
  assert.equal(await provider.run({ retest: f.retest, signal: AbortSignal.timeout(10000), onSession: async () => {} }), 'done');
  assert.equal(f.model.requests[0].provider, 'retest-route');
  assert.equal(f.model.requests[0].model, 'retester-model');
  assert.equal(f.model.requests[0].maxTokens, 3456);
  assert.equal(f.parent.options.model, 'parent-model');
});

for (const kind of ['error', 'max-tokens']) {
  test(`real ${kind} session termination cannot report done`, { timeout: 20000 }, async t => {
    const f = await fixture(t); f.model.finish = kind; let childId;
    await assert.rejects(createDshRetestProvider(f.ctx, f.parent).run({ retest: f.retest, signal: AbortSignal.timeout(10000), onSession: async id => { childId = id; } }), new RegExp(kind));
    assert.equal(end(f, childId).data.reason.kind, kind);
    assert.equal(f.ctx.agents.get(SessionId(childId)), undefined);
  });
}

test('cancellation after native inbox acceptance aborts and drains only the retest child', { timeout: 20000 }, async t => {
  const f = await fixture(t), controller = new AbortController();
  f.model.hold = { entered: Promise.withResolvers(), release: Promise.withResolvers() };
  let childId;
  const running = createDshRetestProvider(f.ctx, f.parent).run({ retest: f.retest, signal: controller.signal, onSession: async id => { childId = id; } });
  await f.model.hold.entered.promise;
  assert.equal(f.ctx.agents.isOwnedBy(SessionId(childId), f.parent), true);
  controller.abort(new Error('user cancelled retest'));
  assert.equal(await running, 'cancelled');
  assert.equal(end(f, childId).data.reason.kind, 'aborted');
  assert.equal(f.ctx.agents.get(SessionId(childId)), undefined);
  assert.equal(f.ctx.agents.get(f.parent.id), f.parent);
});

test('binding failure and pre-publication cancellation never run a model', { timeout: 20000 }, async t => {
  const f = await fixture(t), error = new Error('binding storage failed');
  await assert.rejects(createDshRetestProvider(f.ctx, f.parent).run({ retest: f.retest, signal: AbortSignal.timeout(10000), onSession: async () => { throw error; } }), actual => actual === error);
  const controller = new AbortController(); let reserved;
  assert.equal(await createDshRetestProvider(f.ctx, f.parent).run({ retest: f.retest, signal: controller.signal, onSession: async id => { reserved = id; controller.abort(); } }), 'cancelled');
  assert.equal(f.model.requests.length, 0);
  assert.equal(f.ctx.agents.get(SessionId(reserved)), undefined);
  assert.equal((await f.ctx.subagents.listChildren(f.parent.id)).length, 0);
});

test('forged same-id parent object is rejected by exact live ownership check', { timeout: 20000 }, async t => {
  const f = await fixture(t); let bound = false;
  await assert.rejects(createDshRetestProvider(f.ctx, { id: f.parent.id }).run({ retest: f.retest, signal: AbortSignal.timeout(10000), onSession: async () => { bound = true; } }), /exact live parent/);
  assert.equal(bound, false);
  assert.equal(f.model.requests.length, 0);
});
