import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import { getGlobalDispatcher } from 'undici';
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session';
import AgentRegistry from '@deepseek-ai/dsh-agent';
import { build } from 'esbuild';
import { Context } from '@deepseek-ai/cordis';
import LlmRuntime, { LlmAdapter } from '@deepseek-ai/dsh-llm';
import ToolRuntime, { defineTool } from '@deepseek-ai/dsh-tools';
import SystemPrompt from '@deepseek-ai/dsh-system-prompt';
import { createScope } from '@deepseek-ai/dsh-scope';

const bundle = await build({ stdin: { contents: "export * from './src/observability/index.ts'; export { installCompactionHost } from './src/system-runtime/compaction-host.ts'; export { setNativeModelAttribution, clearNativeModelAttribution, resolveModelCallAttribution } from './src/system-runtime/model-attribution.ts';", resolveDir: process.cwd(), loader: 'ts' }, bundle: true, write: false, format: 'esm', platform: 'node', packages: 'external' });
const code = bundle.outputFiles[0].text.replace(/from\s+(["'])([^"']+)\1/g, (_m, _q, specifier) => `from ${JSON.stringify(import.meta.resolve(specifier))}`);
const { installObservability, withObservation, withObservationStream, ObservabilityRepository, installObservabilityHttp, installCompactionHost, setNativeModelAttribution, clearNativeModelAttribution, resolveModelCallAttribution } = await import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`);

class Adapter extends LlmAdapter {
  response = [];
  async resolveModel(provider, model) { return { provider, id: model, name: model, reasoning: { efforts: [{ id: 'medium', name: 'Medium' }] } }; }
  async *stream(request) { if (typeof this.response === 'function') { yield* this.response(request); return; } for (const item of this.response) { if (item instanceof Error) throw item; yield item; } }
}
async function fixture(t, options = {}) {
  const dir = await mkdtemp(join(tmpdir(), 'observability-'));
  const app = new Context(), fibers = [], errors = [], adapter = new Adapter();
  fibers.push(await app.plugin(LlmRuntime)); fibers.push(await app.plugin(SystemPrompt, {})); fibers.push(await app.plugin(ToolRuntime, { mode: 'native' }));
  let runtime; const ready = Promise.withResolvers();
  fibers.push(await app.plugin(ctx => { ctx.inject(['llm', 'tools'], inner => {
    inner.llm.registerAdapter(['fixture'], adapter);
    runtime = installObservability(inner, { storagePath: join(dir, 'state.json') }, { resolveCall: options.resolveCall ?? (request => request.sessionId ? { taskId: 'task-1', sessionId: request.sessionId, profileId: 'profile-a', role: 'worker' } : undefined), resolveAgent: () => undefined, onError: error => errors.push(error) });
    ready.resolve(inner);
  }); }));
  const ctx = await ready.promise; await runtime.ready;
  t.after(async () => { await runtime.dispose(); for (const fiber of fibers.reverse()) await fiber.dispose(); assert.deepEqual(errors, []); await rm(dir, { recursive: true, force: true }); });
  const call = async (extra = {}) => { const output = []; for await (const chunk of ctx.llm.stream({ provider: 'fixture', model: 'fixture-model', messages: [{ role: 'user', content: 'local test' }], sessionId: 'session-1', ...extra })) output.push(chunk); return output; };
  return { ctx, app, fibers, runtime, repository: runtime.repository, adapter, call, dir };
}
const usage = { type: 'usage', usage: { inputTokens: 7, outputTokens: 3, cacheReadTokens: 11, cacheWriteTokens: 13 } };
const finish = { type: 'finish', reason: { kind: 'stop' } };

test('actual LlmRuntime meters with recording off; toggle is shared and exact trace deletion preserves usage', async t => {
  const f = await fixture(t); f.adapter.response = [usage, finish];
  await f.call(); assert.equal((await f.repository.records()).total, 0);
  const other = new ObservabilityRepository(f.repository.path); await other.setRecording(true);
  f.adapter.response = [{ type: 'text-delta', index: 0, text: 'real adapter output' }, usage, finish];
  await f.call({ reasoningEffort: 'medium', tools: [{ name: 'example', description: 'schema kept', parameters: { type: 'object' } }] });
  const listed = await other.records(); assert.equal(listed.total, 1); assert.equal('request' in listed.items[0], false);
  const detail = await other.detail(listed.items[0].id);
  assert.equal(detail.request.reasoningEffort, 'medium'); assert.equal(detail.request.tools[0].description, 'schema kept');
  assert.equal(detail.chunks[0].text, 'real adapter output'); assert.equal(detail.wire.available, false);
  const totals = await other.usage(); assert.deepEqual([totals[0].calls, totals[0].inputTokens, totals[0].outputTokens, totals[0].cacheReadTokens, totals[0].cacheWriteTokens], [2, 14, 6, 22, 26]);
  assert.equal(await other.deleteRecords('task'), 0); assert.equal(await other.deleteRecords('task-1'), 1);
  assert.equal((await other.usage())[0].calls, 2); assert.equal((await other.records()).total, 0);
});

test('failed and abandoned streams retain usage and explicit asynchronous auxiliary attribution', async t => {
  const f = await fixture(t); await f.repository.setRecording(true);
  f.adapter.response = [usage, new Error('fixture provider failed')];
  const output = await f.call(); assert.equal(output.at(-1).reason.kind, 'error');
  f.adapter.response = [usage, { type: 'text-delta', index: 0, text: 'partial' }, finish];
  await withObservation({ taskId: 'task-2', role: 'judge', profileId: 'profile-b', runId: 'judge-run' }, async () => {
    for await (const _chunk of f.ctx.llm.stream({ provider: 'fixture', model: 'judge-model', messages: [] })) break;
  });
  const state = await f.repository.snapshot(); assert.deepEqual(state.usage.map(row => row.status), ['error', 'aborted']);
  assert.equal(state.records[1].runId, 'judge-run'); assert.equal(state.records[1].role, 'judge'); assert.equal(state.records[1].usage.inputTokens, 7);
  const filtered = await f.repository.usage({ taskId: 'task-2' }, 'profile'); assert.equal(filtered[0].profileId, 'profile-b'); assert.equal(filtered[0].failed, 1);
  assert.equal((await f.repository.usage({}, 'day')).length, 2);
  const stream = withObservationStream({ taskId: 'external-consumer', runId: 'external-run' }, () => f.ctx.llm.stream({ provider: 'fixture', model: 'external-model', messages: [] }));
  await Promise.resolve(); for await (const _chunk of stream) break;
  const last = (await f.repository.snapshot()).usage.at(-1); assert.equal(last.taskId, 'external-consumer'); assert.equal(last.runId, 'external-run'); assert.equal(last.status, 'aborted');
});

test('DSH final tool pipeline records denial, thrown errors, timeout, truncation and nonzero process exit', async t => {
  const f = await fixture(t), remove = [];
  const install = (name, execute) => remove.push(f.ctx.tools.register(defineTool({ name, description: name, parameters: {}, output: { schema: { type: 'json' }, render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }] }, execute })));
  install('local_denied', () => { throw new Error('must not execute denied tool'); });
  install('local_error', () => { throw new Error('fixture body failure'); });
  install('local_timeout', () => ({ timedOut: true, exitCode: 1, stdout: { text: 'tail', truncated: true }, stderr: { text: '', truncated: false } }));
  install('local_exit', () => ({ exitCode: 4 }));
  remove.push(f.ctx.on('tools/pre-execute', (exec, next) => exec.name === 'local_denied' ? Promise.resolve({ kind: 'deny', reason: 'Fixture denied' }) : next()));
  for (const name of ['local_denied', 'local_error', 'local_timeout', 'local_exit']) await withObservation({ taskId: 'task-tools', sessionId: 'tool-session' }, () => f.ctx.tools.execute({ callId: randomUUID(), name, arguments: {}, signal: AbortSignal.timeout(1000) }));
  await f.runtime.flush();
  const state = await f.repository.snapshot(), rows = state.commands;
  assert.deepEqual(rows.map(row => row.status), ['denied', 'error', 'timeout', 'error']);
  assert.equal(rows[0].dispatched, false); assert.equal(rows[1].dispatched, true); assert.equal(rows[2].truncated, true); assert.equal(rows[3].exitCode, 4);
  assert.equal((await f.repository.commands({ q: 'fixture body', limit: 1 })).total, 1);
  const stats = await f.repository.toolStats({ taskId: 'task-tools', limit: 1 }); assert.equal(stats.length, 4, 'stats are over the full filter, not a page');
  assert.equal(stats.reduce((sum, row) => sum + row.errors, 0), 4, 'all unsuccessful outcomes contribute to the error total');
  remove.reverse().forEach(fn => fn());
});

test('separate preset installations on one host do not duplicate global observation', async t => {
  const f = await fixture(t);
  const scope = createScope(f.ctx, {});
  const second = installObservability(scope.ctx, { storagePath: join(f.dir, 'state.json') }, { resolveCall: () => ({ taskId: 'duplicate' }), resolveAgent: () => undefined });
  f.adapter.response = [usage, finish]; await f.call(); assert.equal((await f.repository.snapshot()).usage.length, 1);
  await second.dispose(); await scope.dispose(); await f.call(); assert.equal((await f.repository.snapshot()).usage.length, 2);
});

test('actual Node fetch transport captures exact request bytes, SSE frames and retry responses without changing delivery', async t => {
  const f = await fixture(t); await f.repository.setRecording(true);
  const requestBody = '{ "model": "wire-model", "stream": true, "messages": ["汉字"] }';
  const responseBody = 'data: {"choices":[{"delta":{"content":"你好"}}]}\r\n\r\ndata: [DONE]\n\n';
  const received = []; let attempt = 0;
  const server = createServer(async (req, res) => {
    const chunks = []; for await (const chunk of req) chunks.push(chunk); received.push(Buffer.concat(chunks));
    if (++attempt === 1) { res.writeHead(429, { 'content-type': 'text/plain' }); res.end('retry-body-exact\n'); }
    else { res.writeHead(200, { 'content-type': 'text/event-stream' }); res.end(responseBody); }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const url = `http://127.0.0.1:${server.address().port}/completion`;
  f.adapter.response = async function* () {
    let response = await fetch(url, { method: 'POST', body: requestBody }); assert.equal(await response.text(), 'retry-body-exact\n');
    response = await fetch(url, { method: 'POST', body: requestBody }); assert.equal(await response.text(), responseBody);
    yield usage; yield finish;
  };
  await f.call();
  const record = (await f.repository.snapshot()).records[0]; assert.equal(record.wire.available, true); assert.equal(record.wire.attempts.length, 2);
  assert.deepEqual(record.wire.attempts.map(a => a.status), [429, 200]);
  for (const [i, item] of record.wire.attempts.entries()) { assert.deepEqual(Buffer.from(item.requestBase64, 'base64'), received[i]); assert.equal(item.requestText, requestBody); assert.equal(item.complete, true); }
  assert.equal(record.wire.attempts[0].responseText, 'retry-body-exact\n');
  assert.deepEqual(Buffer.from(record.wire.attempts[1].responseBase64, 'base64'), Buffer.from(responseBody));
  await fetch(url).then(r => r.text()); assert.equal((await f.repository.snapshot()).records.length, 1, 'unrelated HTTP is not recorded');
});

test('owner HTTP exposes real repository data and rejects unauthenticated, non-owner and cross-origin writes', async t => {
  const f = await fixture(t); let handler;
  const routeContext = { effect(register) { return register(); }, webServer: { register(route) { handler = route.handler; return () => {}; } } };
  const installed = installObservabilityHttp(routeContext, { storagePath: join(f.dir, 'state.json') }, { authenticate: req => req.headers.authorization === 'owner' ? true : req.headers.authorization ? 403 : 401 });
  await installed.ready;
  const server = createServer((req, res) => handler(req, res)); await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}/api/redteam/observability`, headers = { authorization: 'owner', 'content-type': 'application/json' };
  assert.equal((await fetch(base + '/settings')).status, 401);
  assert.equal((await fetch(base + '/settings', { headers: { authorization: 'guest' } })).status, 403);
  assert.equal((await fetch(base + '/settings', { method: 'PUT', headers: { ...headers, origin: 'http://foreign.invalid' }, body: '{"enabled":true}' })).status, 403);
  assert.equal((await fetch(base + '/settings', { method: 'PUT', headers, body: '{"enabled":true}' })).status, 200);
  f.adapter.response = [usage, finish]; await f.call();
  const records = await fetch(base + '/records?taskId=task-1', { headers }).then(r => r.json()); assert.equal(records.total, 1);
  const detail = await fetch(base + '/records/' + records.items[0].id, { headers }).then(r => r.json()); assert.equal(detail.request.messages[0].content, 'local test');
  assert.equal((await fetch(base + '/records?offset=-1', { headers })).status, 400);
  assert.equal((await fetch(base + '/records', { method: 'DELETE', headers })).status, 400);
  const deleted = await fetch(base + '/records?taskId=task-1', { method: 'DELETE', headers }).then(r => r.json()); assert.equal(deleted.deleted, 1);
  assert.equal((await fetch(base + '/usage?group=profile', { headers }).then(r => r.json()))[0].calls, 1);
});

test('invocations are counted before completion and uninstall drains their final outcome', async t => {
  const previous = getGlobalDispatcher(), f = await fixture(t), entered = Promise.withResolvers(), release = Promise.withResolvers();
  const remove = f.ctx.tools.register(defineTool({ name: 'local_pending', description: 'Wait for a controlled test event', parameters: {}, output: { schema: { type: 'json' }, render: () => [{ type: 'text', text: 'done' }] }, execute: async () => { entered.resolve(); await release.promise; return { done: true }; } }));
  const result = withObservation({ taskId: 'in-flight' }, () => f.ctx.tools.execute({ callId: randomUUID(), name: 'local_pending', arguments: {}, signal: AbortSignal.timeout(3000) }));
  await entered.promise;
  assert.equal((await f.repository.commands()).items[0].status, 'running'); assert.equal((await f.repository.toolStats())[0].calls, 1);
  const disposing = f.runtime.dispose(); assert.equal(f.runtime.dispose(), disposing);
  release.resolve(); assert.equal((await result).isError, false); await disposing;
  const rows = (await f.repository.commands()).items; assert.equal(rows.length, 1); assert.equal(rows[0].status, 'ok');
  assert.equal(getGlobalDispatcher(), previous, 'the exact prior transport policy is restored'); remove();
});

test('transport cancellation retains received bytes and usage without turning an aborted call into success', async t => {
  const f = await fixture(t); await f.repository.setRecording(true); const controller = new AbortController();
  const server = createServer((_req, res) => { res.writeHead(200, { 'content-type': 'text/event-stream' }); res.write('data: partial\n\n'); });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => { server.closeAllConnections(); return new Promise(resolve => server.close(resolve)); });
  f.adapter.response = async function* () {
    yield usage;
    const response = await fetch(`http://127.0.0.1:${server.address().port}/stream`, { signal: controller.signal });
    const reader = response.body.getReader(); assert.equal(new TextDecoder().decode((await reader.read()).value), 'data: partial\n\n');
    controller.abort(); await reader.read();
  };
  await f.call({ signal: controller.signal });
  const row = (await f.repository.snapshot()).records[0]; assert.equal(row.status, 'aborted'); assert.equal(row.usage.cacheReadTokens, 11);
  assert.equal(row.wire.attempts[0].responseText, 'data: partial\n\n'); assert.equal(row.wire.attempts[0].complete, false);
});

test('actual selected model attribution overrides stale ALS route identity while preserving run and intent', async t => {
  const sessionId = 'selected-session';
  const f = await fixture(t, { resolveCall: request => resolveModelCallAttribution(request) });
  setNativeModelAttribution(sessionId, { taskId: 'actual-task', role: 'worker', profileId: 'pool-second' });
  try {
    f.adapter.response = [usage, finish];
    const stream = withObservationStream({ taskId: 'stale-task', role: 'mainagent', profileId: 'pool-first', runId: 'run-keep', intentId: 'intent-keep', explorationId: 'exploration-keep' }, () => f.ctx.llm.stream({ provider: 'fixture', model: 'actual-model', sessionId, messages: [] }));
    for await (const _chunk of stream) { /* consume actual SDK call */ }
    const row = (await f.repository.snapshot()).usage[0];
    assert.deepEqual([row.taskId, row.role, row.profileId, row.runId, row.intentId, row.explorationId], ['actual-task', 'worker', 'pool-second', 'run-keep', 'intent-keep', 'exploration-keep']);
  } finally { clearNativeModelAttribution(sessionId); }
});

test('real Noa native redispatch records only projected provider call, never outer envelope tokens', async t => {
  const f = await fixture(t); await f.repository.setRecording(true);
  f.fibers.push(await f.app.plugin(SessionStore)); f.fibers.push(await f.app.plugin(AgentRegistry));
  const host = installCompactionHost(f.ctx, { archiveRoot: f.dir, enabled: () => true });
  const prepare = host.wrapPrepareRun(async input => ({
    runId: input.runId, systemPrompt: '', renderSystemPrompt: () => '', tools: input.baseTools, maxTurns: 20, maxRunSeconds: 0,
    wrapup: { prompt: '', maxTurns: 2 }, taskTimeoutWrapup: { prompt: '', maxTurns: 2 },
    attach(ctx) { const removers = input.baseTools.map(tool => ctx.tools.register(tool)); return () => removers.reverse().forEach(remove => remove()); },
    startTaskTimeoutWrapup() {}, async dispose() {},
  }));
  const sessionId = SessionId('session-1'), prepared = await prepare({ agentKey: 'worker', sessionId, runId: 'native-observation', baseTools: [] });
  const handle = await f.app.get('agents').create({ sessionId, agentOptions: { provider: 'fixture', model: 'fixture-model' }, setup(ctx, agent) { ctx.effect(() => prepared.attach(ctx, agent)); } });
  let dispatched;
  f.adapter.response = async function* (request) { dispatched = request; yield usage; yield finish; };
  try {
    await f.call(); const state = await f.repository.snapshot();
    assert.equal(state.usage.length, 1); assert.equal(state.records.length, 1);
    assert.equal(state.usage[0].usage.inputTokens, 7); assert.ok(JSON.stringify(dispatched).includes('noa context management'));
    assert.deepEqual(state.records[0].request.messages, dispatched.messages);
  } finally { await handle.dispose(); await prepared.dispose(); host.dispose(); }
});
