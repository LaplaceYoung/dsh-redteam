import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, readFile, writeFile, rm, rename, mkdir, rmdir } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { build } from 'esbuild';
import { Context } from '@deepseek-ai/cordis';
import { SessionId, SessionStore } from '@deepseek-ai/dsh-session';
import AgentRegistry from '@deepseek-ai/dsh-agent';
import AgentLoop from '@deepseek-ai/dsh-agent-loop';
import LlmRuntime, { LlmAdapter, createUserMessage } from '@deepseek-ai/dsh-llm';
import SystemPrompt from '@deepseek-ai/dsh-system-prompt';
import ToolRuntime from '@deepseek-ai/dsh-tools';
import SessionProjections from '@deepseek-ai/dsh-session-projection';
import * as JsonlPersistence from '@deepseek-ai/dsh-session-persistence-jsonl';

const built = await build({ entryPoints: ['src/conversation-workspace/side-questions.ts'], bundle: true, write: false, platform: 'node', format: 'esm', packages: 'external' });
const code = built.outputFiles[0].text.replace(/from\s+(["'])([^"']+)\1/g, (_m, _q, specifier) => `from ${JSON.stringify(import.meta.resolve(specifier))}`);
const { installSideQuestions, SideQuestionService } = await import(`data:text/javascript;base64,${Buffer.from(code + '\n//# sourceURL=side-questions-test.bundle.mjs').toString('base64')}`);
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
const stop = { type: 'finish', reason: { kind: 'stop' } };
class Adapter extends LlmAdapter {
  requests = []; responses = [];
  async resolveModel(provider, model) { return { provider, id: model, name: model }; }
  async *stream(request) {
    this.requests.push(request); const response = this.responses.shift(); assert.notEqual(response, undefined, 'model requests must have an explicit fixture response');
    if (typeof response === 'function') { yield* response(request); return; }
    yield { type: 'text-delta', index: 0, text: response }; yield stop;
  }
}
async function fixture(t) {
  const dir = await mkdtemp(join(tmpdir(), 'dsh-side-')), app = new Context(), fibers = [], handles = [], adapter = new Adapter(), parents = new Map(), existing = new Set();
  const observed = []; let service, identity = 'v1', expanded = 0;
  t.after(async () => { await service?.dispose(); for (const handle of handles.reverse()) await handle.dispose(); for (const fiber of fibers.reverse()) await fiber.dispose(); await rm(dir, { recursive: true, force: true }); });
  for (const [plugin, config] of [[SessionStore], [AgentRegistry], [LlmRuntime], [SystemPrompt, {}], [ToolRuntime, { mode: 'native' }], [SessionProjections], [JsonlPersistence, { root: join(dir, 'sessions') }], [AgentLoop, {}]]) fibers.push(await app.plugin(plugin, config));
  let ctx;
  fibers.push(await app.plugin(owner => { owner.inject(['llm'], inner => { ctx = inner; inner.llm.registerAdapter(['fixture'], adapter); }); owner.on('session/event', (session, event) => observed.push({ id: session.id, event })); }));
  const options = { directory: dir, parentForSession: id => parents.get(id), parentExists: parent => existing.has(parent.id), modelIdentity: () => identity,
    prepareQuestion: (_parent, question) => { expanded++; return `${question}\n[resolved mention context]`; } };
  service = await installSideQuestions(ctx, options);
  async function create(parent = { kind: 'task', id: randomUUID() }) { const handle = await app.get('agents').create({ sessionId: SessionId(randomUUID()), agentOptions: { provider: 'fixture', model: 'fixture' } }); handles.push(handle); parents.set(handle.agent.id, parent); existing.add(parent.id); return { agent: handle.agent, parent }; }
  async function turn(agent, text = 'main task evidence') { agent.followup(createUserMessage({ content: [{ type: 'text', text }], source: { kind: 'user' } })); await agent.whenIdle(); }
  return { app, ctx, dir, options, service, adapter, observed, existing, create, turn, expanded: () => expanded, changeModel: () => { identity = 'v2'; }, reopen: async () => { await service.dispose(); service = await SideQuestionService.open(ctx, options); return service; } };
}
function waitForAbort(request) { return new Promise(resolve => { if (request.signal.aborted) resolve(); else request.signal.addEventListener('abort', resolve, { once: true }); }); }

test('actual native Agent active request snapshot allows independent answer without touching main run or Session', { timeout: 15000 }, async t => {
  const f = await fixture(t), { agent, parent } = await f.create(); const entered = deferred(), release = deferred();
  f.adapter.responses.push(async function* () { entered.resolve(); await release.promise; yield { type: 'text-delta', index: 0, text: 'main completed' }; yield stop; }, 'side answer');
  agent.followup(createUserMessage({ content: [{ type: 'text', text: 'evidence while main still active' }], source: { kind: 'user' } }));
  await entered.promise; const before = f.observed.filter(row => row.id === agent.id).length;
  try {
    const e = await f.service.ask(parent, { clientRequestId: 'one', question: 'what is known?' });
    const completed = await f.service.wait(e.id); assert.equal(completed.status, 'completed'); assert.equal(completed.answer, 'side answer');
    assert.equal(f.observed.filter(row => row.id === agent.id).length, before, 'side answer never appends the main Session');
    const request = f.adapter.requests[1]; assert.equal(request.sessionId, undefined); assert.equal(request.tools, undefined); assert.equal(request.toolHistory, undefined);
    assert.match(JSON.stringify(request.messages), /evidence while main still active/); assert.match(JSON.stringify(request.messages), /resolved mention context/);
    assert.ok(Object.isFrozen(f.adapter.requests[0]), 'real AgentLoop sends frozen request');
  } finally { release.resolve(); await agent.whenIdle(); }
  assert.equal(f.adapter.requests.length, 2);
});

test('client request id is durable idempotency, conflicting text rejected, clear resets generation', { timeout: 15000 }, async t => {
  const f = await fixture(t), { agent, parent } = await f.create(); f.adapter.responses.push('main', 'answer'); await f.turn(agent);
  const e = await f.service.ask(parent, { clientRequestId: 'stable', question: 'q' }); await f.service.wait(e.id);
  assert.equal((await f.service.ask(parent, { clientRequestId: 'stable', question: 'q' })).id, e.id); assert.equal(f.expanded(), 1);
  await assert.rejects(f.service.ask(parent, { clientRequestId: 'stable', question: 'different' }), /同一请求/);
  const restarted = await f.reopen(); assert.equal((await restarted.ask(parent, { clientRequestId: 'stable', question: 'q' })).id, e.id);
  await restarted.clear(parent); f.adapter.responses.push('new generation'); const newer = await restarted.ask(parent, { clientRequestId: 'stable', question: 'different' });
  assert.notEqual(newer.id, e.id); assert.equal((await restarted.wait(newer.id)).status, 'completed');
  f.changeModel(); await assert.rejects(restarted.ask(parent, { clientRequestId: 'changed', question: 'q' }), /模型配置已删除或变化/);
});

test('cancellation drains its own transport, rejects busy admission, and never cancels main Agent', { timeout: 15000 }, async t => {
  const f = await fixture(t), { agent, parent } = await f.create(); const entered = deferred(); f.adapter.responses.push('main'); await f.turn(agent);
  f.adapter.responses.push(async function* (request) { yield { type: 'text-delta', index: 0, text: 'partial' }; entered.resolve(); await waitForAbort(request); });
  const e = await f.service.ask(parent, { clientRequestId: 'cancel-me', question: 'q' }); await entered.promise;
  await assert.rejects(f.service.ask(parent, { clientRequestId: 'busy', question: 'q' }), /已有旁路/);
  const result = await f.service.cancel(e.id); assert.equal(result.status, 'cancelled'); assert.equal(result.answer, 'partial');
  f.adapter.responses.push('main continues'); await f.turn(agent, 'another main turn'); assert.equal(f.adapter.requests.at(-1).sessionId, agent.id);
});

test('parent delete barrier drains pending answer, rollback reopens, commit rejects late resurrection', { timeout: 15000 }, async t => {
  const f = await fixture(t), { agent, parent } = await f.create(); const entered = deferred(); f.adapter.responses.push('main'); await f.turn(agent);
  f.adapter.responses.push(async function* (request) { entered.resolve(); await waitForAbort(request); });
  const e = await f.service.ask(parent, { clientRequestId: 'delete', question: 'q' }); await entered.promise;
  const barrier = await f.service.prepareTaskDelete(parent.id); assert.equal((await f.service.get(e.id)).status, 'cancelled');
  await assert.rejects(f.service.ask(parent, { clientRequestId: 'blocked', question: 'q' }), /正在删除/);
  await barrier.rollback(); f.adapter.responses.push('after rollback'); const next = await f.service.ask(parent, { clientRequestId: 'allowed', question: 'q' }); await f.service.wait(next.id);
  const commit = await f.service.prepareTaskDelete(parent.id); f.existing.delete(parent.id); await commit.commit(); assert.deepEqual((await f.service.list(parent)).items, []);
  await assert.rejects(f.service.ask(parent, { clientRequestId: 'gone', question: 'q' }), /已删除或归档/);
});

test('delete generation rejects a late main completion while restored same-id task can capture a new turn', { timeout: 15000 }, async t => {
  const f = await fixture(t), { agent, parent } = await f.create(); const entered = deferred(), release = deferred();
  f.adapter.responses.push(async function* () { entered.resolve(); await release.promise; yield { type: 'text-delta', index: 0, text: 'old run' }; yield stop; });
  agent.followup(createUserMessage({ content: [{ type: 'text', text: 'old active turn' }], source: { kind: 'user' } })); await entered.promise;
  const barrier = await f.service.prepareTaskDelete(parent.id); f.existing.delete(parent.id); await barrier.commit();
  f.existing.add(parent.id); release.resolve(); await agent.whenIdle();
  assert.equal((await f.service.list(parent)).snapshot, undefined, 'late completion and turn/end cannot resurrect the deleted generation');
  await assert.rejects(f.service.ask(parent, { clientRequestId: 'need-fresh', question: 'q' }), /尚无上下文快照/);
  f.adapter.responses.push('new turn', 'new side'); await f.turn(agent, 'restored task new evidence');
  const e = await f.service.ask(parent, { clientRequestId: 'fresh', question: 'q' }); assert.equal((await f.service.wait(e.id)).answer, 'new side');
  assert.match(JSON.stringify(f.adapter.requests.at(-1).messages), /restored task new evidence/);
});

test('restart terminalizes a persisted in-flight exchange and malformed persistence refuses startup', { timeout: 15000 }, async t => {
  const f = await fixture(t), { agent, parent } = await f.create(); f.adapter.responses.push('main', 'complete'); await f.turn(agent);
  const e = await f.service.ask(parent, { clientRequestId: 'crashed', question: 'q' }); await f.service.wait(e.id); await f.service.dispose();
  const path = join(f.dir, 'side-questions.json'), state = JSON.parse(await readFile(path, 'utf8'));
  Object.values(state.sessions)[0].exchanges[0].status = 'running'; await writeFile(path, JSON.stringify(state));
  const recovered = await f.reopen(); assert.equal((await recovered.get(e.id)).status, 'interrupted');
  assert.equal((await recovered.ask(parent, { clientRequestId: 'crashed', question: 'q' })).status, 'interrupted');
  await recovered.dispose(); await writeFile(path, '{broken'); await assert.rejects(SideQuestionService.open(f.ctx, f.options), SyntaxError);
});

test('context overflow before output makes one bounded summary and retry; tool calls cannot execute', { timeout: 15000 }, async t => {
  const f = await fixture(t), { agent, parent } = await f.create(); f.adapter.responses.push('main'); await f.turn(agent, 'source evidence '.repeat(500));
  f.adapter.responses.push(async function* () { yield { type: 'finish', reason: { kind: 'error', failure: { code: 'CONTEXT', message: 'maximum context length exceeded' } } }; }, 'short evidence summary', 'recovered answer');
  const e = await f.service.ask(parent, { clientRequestId: 'overflow', question: 'q' }); const result = await f.service.wait(e.id);
  assert.equal(result.status, 'completed'); assert.equal(result.answer, 'recovered answer'); assert.equal(result.context.overflowRetried, true); assert.equal(result.context.snapshotSummarized, true);
  assert.equal(f.adapter.requests.length, 4); assert.ok(JSON.stringify(f.adapter.requests[3]).length < JSON.stringify(f.adapter.requests[1]).length);
  f.adapter.responses.push(async function* () { yield { type: 'tool-call-delta', index: 0, id: 'forbidden', name: 'delete_file', argumentsDelta: '{}' }; yield { type: 'finish', reason: { kind: 'tool-calls' } }; });
  const tools = await f.service.ask(parent, { clientRequestId: 'tools', question: 'q' }); const rejectedTool = await f.service.wait(tools.id);
  assert.equal(rejectedTool.status, 'completed'); assert.match(rejectedTool.answer, /不能执行工具操作/);
});

test('visible partial overflow is never replayed, and block-end-only answers preserve provider usage', { timeout: 15000 }, async t => {
  const f = await fixture(t), { agent, parent } = await f.create(); f.adapter.responses.push('main'); await f.turn(agent);
  f.adapter.responses.push(async function* () {
    yield { type: 'text-delta', index: 0, text: 'partial answer' };
    yield { type: 'usage', usage: { inputTokens: 10, outputTokens: 3, cacheReadTokens: 2 } };
    yield { type: 'finish', reason: { kind: 'error', failure: { code: 'CONTEXT', message: 'context window exceeded' } } };
  });
  const e = await f.service.ask(parent, { clientRequestId: 'partial', question: 'q' }), result = await f.service.wait(e.id);
  assert.equal(result.status, 'failed'); assert.equal(result.answer, 'partial answer'); assert.equal(result.usage.inputTokens, 10); assert.equal(result.usage.cacheReadTokens, 2);
  assert.equal(f.adapter.requests.length, 2, 'a partial answer cannot trigger overflow retry');
  f.adapter.responses.push(async function* () { yield { type: 'block-end', index: 0, block: { type: 'text', text: 'whole block answer' } }; yield stop; });
  const block = await f.service.ask(parent, { clientRequestId: 'block', question: 'q' }); assert.equal((await f.service.wait(block.id)).answer, 'whole block answer');
});

test('task archive drains and preserves all exploration/worker histories, restores while gated, hides inactive parents', { timeout: 15000 }, async t => {
  const f = await fixture(t), taskId = randomUUID();
  const main = await f.create({ kind: 'task', id: taskId, explorationId: 'first' });
  const worker = await f.create({ kind: 'task', id: taskId, explorationId: 'second', intentId: 'worker-one' });
  const unrelated = await f.create({ kind: 'conversation', id: randomUUID() });
  f.adapter.responses.push('main'); await f.turn(main.agent, 'archive primary evidence '.repeat(500));
  f.adapter.responses.push(async function* () { yield { type: 'finish', reason: { kind: 'error', failure: { code: 'CONTEXT', message: 'maximum context length exceeded' } } }; }, 'retained snapshot summary', 'main answer');
  const e = await f.service.ask(main.parent, { clientRequestId: 'original', question: 'q' }); assert.equal((await f.service.wait(e.id)).status, 'completed');
  const entered = deferred(); f.adapter.responses.push('worker'); await f.turn(worker.agent);
  f.adapter.responses.push(async function* (request) { yield { type: 'text-delta', index: 0, text: 'worker partial' }; entered.resolve(); await waitForAbort(request); });
  const w = await f.service.ask(worker.parent, { clientRequestId: 'worker', question: 'q' }); await entered.promise;
  await f.service.quiesceTask(taskId); assert.equal((await f.service.get(w.id)).status, 'cancelled');
  f.adapter.responses.push('unrelated', 'unrelated answer'); await f.turn(unrelated.agent);
  const other = await f.service.ask(unrelated.parent, { clientRequestId: 'other', question: 'q' }); await f.service.wait(other.id);
  const barrier = await f.service.prepareTaskDelete(taskId); f.existing.delete(taskId);
  assert.deepEqual((await f.service.list(main.parent)).items, []); assert.equal(await f.service.get(e.id), undefined);
  const archive = await f.service.exportTaskArchive(taskId); assert.equal(archive.sessions.length, 2); assert.equal(archive.ordinal, 3);
  assert.ok(archive.sessions.find(s => !s.parent.intentId).memory.snapshotSummary);
  await barrier.commit(); const restoreGate = await f.service.prepareTaskDelete(taskId);
  await f.service.preflightTaskArchive(taskId, archive); await f.service.restoreTaskArchive(taskId, archive);
  assert.equal(await f.service.get(e.id), undefined, 'restore must not leak an inactive parent');
  f.existing.add(taskId); await restoreGate.rollback();
  assert.equal((await f.service.get(e.id)).answer, 'main answer'); assert.equal((await f.service.get(w.id)).answer, 'worker partial'); assert.equal((await f.service.get(other.id)).answer, 'unrelated answer');
  assert.equal((await f.service.ask(main.parent, { clientRequestId: 'original', question: 'q' })).id, e.id, 'restored idempotency must survive');
  f.adapter.responses.push('next answer'); const fresh = await f.service.ask(main.parent, { clientRequestId: 'after-restore', question: 'q' }); await f.service.wait(fresh.id); assert.equal(fresh.ordinal, archive.ordinal + 1);
  const disk = JSON.parse(await readFile(join(f.dir, 'side-questions.json'), 'utf8'));
  assert.equal(disk.ordinal, fresh.ordinal); const reopened = await f.reopen(); assert.equal((await reopened.get(w.id)).status, 'cancelled');
});

test('archive preflight validates task ownership and conflicts without writing; restore merges and rechecks', { timeout: 15000 }, async t => {
  const f = await fixture(t), { agent, parent } = await f.create(); f.adapter.responses.push('main', 'answer'); await f.turn(agent);
  const e = await f.service.ask(parent, { clientRequestId: 'one', question: 'q' }); await f.service.wait(e.id);
  const archive = await f.service.exportTaskArchive(parent.id), before = await readFile(join(f.dir, 'side-questions.json'), 'utf8');
  const wrongOwner = structuredClone(archive); wrongOwner.sessions[0].snapshot.parent.id = 'foreign';
  await assert.rejects(f.service.preflightTaskArchive(parent.id, wrongOwner), /snapshot/);
  const corrupt = structuredClone(archive); corrupt.sessions[0].memory.through = -1;
  await assert.rejects(f.service.preflightTaskArchive(parent.id, corrupt), /memory/);
  const duplicate = structuredClone(archive); duplicate.sessions.push(duplicate.sessions[0]);
  await assert.rejects(f.service.preflightTaskArchive(parent.id, duplicate), /重复/);
  const conflict = structuredClone(archive); conflict.sessions[0].exchanges[0].answer = 'changed';
  await assert.rejects(f.service.preflightTaskArchive(parent.id, conflict), /冲突/);
  assert.equal(await readFile(join(f.dir, 'side-questions.json'), 'utf8'), before);
  const incoming = structuredClone(archive), addition = { ...structuredClone(incoming.sessions[0].exchanges[0]), id: randomUUID(), clientRequestId: 'two', ordinal: ++incoming.ordinal, answer: 'imported' };
  incoming.sessions[0].exchanges.push(addition);
  await f.service.preflightTaskArchive(parent.id, incoming); await f.service.restoreTaskArchive(parent.id, incoming);
  assert.equal((await f.service.get(addition.id)).answer, 'imported'); assert.equal((await f.service.get(e.id)).answer, 'answer');
  await f.service.restoreTaskArchive(parent.id, incoming); assert.equal((await f.service.list(parent)).items.length, 2, 'same archive restore is idempotent');
  const stale = structuredClone(archive); stale.sessions[0].exchanges.push({ ...addition, id: randomUUID(), answer: 'conflicting second row' }); stale.ordinal = incoming.ordinal;
  await assert.rejects(f.service.restoreTaskArchive(parent.id, stale), /冲突/);
});

test('failed archive persistence leaves memory unchanged and a gated restore can retry', { timeout: 15000 }, async t => {
  const f = await fixture(t), { agent, parent } = await f.create(); f.adapter.responses.push('main', 'answer'); await f.turn(agent);
  const e = await f.service.ask(parent, { clientRequestId: 'one', question: 'q' }); await f.service.wait(e.id);
  const archive = await f.service.exportTaskArchive(parent.id), extra = { ...structuredClone(archive.sessions[0].exchanges[0]), id: randomUUID(), clientRequestId: 'imported', ordinal: ++archive.ordinal };
  archive.sessions[0].exchanges.push(extra); const gate = await f.service.prepareTaskDelete(parent.id);
  await f.service.preflightTaskArchive(parent.id, archive);
  const path = join(f.dir, 'side-questions.json'), backup = join(f.dir, 'side-questions.backup');
  await rename(path, backup); await mkdir(path);
  try { await assert.rejects(f.service.restoreTaskArchive(parent.id, archive)); assert.equal(await f.service.get(extra.id), undefined); assert.equal((await f.service.get(e.id)).answer, 'answer'); }
  finally { await rmdir(path); await rename(backup, path); }
  await assert.rejects(f.service.ask(parent, { clientRequestId: 'blocked', question: 'q' }), /正在删除/);
  await assert.rejects(f.service.clear(parent), /正在删除/);
  await f.service.restoreTaskArchive(parent.id, archive); await gate.rollback(); assert.equal((await f.service.get(extra.id)).answer, 'answer');
});
