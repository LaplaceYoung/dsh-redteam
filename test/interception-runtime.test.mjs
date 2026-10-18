import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { build } from 'esbuild';
import { Context } from '@deepseek-ai/cordis';
import AgentRegistry from '@deepseek-ai/dsh-agent';
import AgentLoop from '@deepseek-ai/dsh-agent-loop';
import LlmRuntime, { LlmAdapter, createUserMessage } from '@deepseek-ai/dsh-llm';
import { SessionId, SessionStore } from '@deepseek-ai/dsh-session';
import SystemPrompt from '@deepseek-ai/dsh-system-prompt';
import ToolRuntime, { defineTool } from '@deepseek-ai/dsh-tools';
import ApprovalService from '@deepseek-ai/dsh-user-approval';
import SessionProjections from '@deepseek-ai/dsh-session-projection';
import WebServer from '@deepseek-ai/dsh-host-webserver';

const built = await build({ stdin: { contents: "export * from './src/interception/index.ts'; export * from './src/store.ts';", resolveDir: process.cwd(), loader: 'ts' }, bundle: true, write: false, platform: 'node', format: 'esm', packages: 'external' });
const code = built.outputFiles[0].text.replace(/from\s+(["'])([^"']+)\1/g, (_m, _q, specifier) => `from ${JSON.stringify(import.meta.resolve(specifier))}`);
const { installInterception, installInterceptionHttp, InterceptionArchive, withInterceptionArchive, InterceptionRepository, RedTeamStore, parseVerdict, reviewInput, matchRule, defaultJudgeConfig } = await import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`);
const inputRule = (patch = {}) => ({ name: 'fixture rule', enabled: true, priority: 1, matchTarget: 'tool_name', matchType: 'string', pattern: 'fixture', action: 'ask', message: 'Fixture approval', timeoutEnabled: false, timeoutSeconds: 60, timeoutAction: 'deny', ...patch });
const verdict = action => JSON.stringify({ decision: action, comment: '实际操作：读取夹具；成功后的后果：返回内容；命中规则：A5' });
async function repository(t) { const dir = await mkdtemp(join(tmpdir(), 'intercept-')); t.after(() => rm(dir, { recursive: true, force: true })); const repo = new InterceptionRepository(join(dir, 'interception.json')); await repo.initialize(); return repo; }

test('strict original verdict envelope rejects duplicate keys, prose, missing explanations and accepts complete fenced JSON', () => {
  assert.equal(parseVerdict(verdict('deny')).action, 'deny');
  assert.equal(parseVerdict('```json\n' + verdict('ask') + '\n```').action, 'ask');
  for (const invalid of ['allow', '{"decision":"allow","decision":"deny"}', '{"decision":"allow","comment":"ok"}', verdict('deny') + ' extra', verdict('other'), '{"decision":"allow","comment":null}', verdict('deny').slice(0, -1)]) assert.throws(() => parseVerdict(invalid));
});
test('review input omits worker/user-generated summaries and preserves full arguments while bounding explicit human background', () => {
  const args = { command: 'x'.repeat(9000) };
  assert.equal(reviewInput('fixture', args, { worker: true, humanMessage: 'private generated prompt' }).background, undefined);
  const input = reviewInput('fixture', args, { humanMessage: '中'.repeat(5000) });
  assert.equal(input.arguments.command.length, 9000); assert.equal(input.background.truncated, true); assert.ok(Buffer.byteLength(input.background.text) <= 4000); assert.ok(!input.background.text.endsWith('\ufffd'));
});
test('rule matching honors exact target, substring, RE2 flags, priority ties and task boundary', async t => {
  const repo = await repository(t);
  const foreign = await repo.upsertRule(inputRule({ taskId: 'other', priority: 90, action: 'deny' }));
  const first = await repo.upsertRule(inputRule({ action: 'allow' }));
  await repo.upsertRule(inputRule({ action: 'deny' }));
  assert.equal(matchRule((await repo.snapshot()).rules, 'fixture', '{}', 'mine').id, first.id);
  assert.equal(matchRule((await repo.snapshot()).rules, 'fixture', '{}', 'other').id, foreign.id);
  const regex = await repo.upsertRule(inputRule({ matchTarget: 'tool_input', matchType: 'regex', pattern: '(?i)needle', priority: 99 }));
  assert.equal(matchRule((await repo.snapshot()).rules, 'other_tool', '{"text":"NEEDLE"}').id, regex.id);
  await assert.rejects(repo.upsertRule(inputRule({ matchType: 'regex', pattern: '(?<=x)y' })));
  await assert.rejects(repo.upsertRule(inputRule({ matchType: 'regex', pattern: '(x)\\1' })));
});
test('atomic first decision wins and pre-registration human decision cannot be lost', async t => {
  const repo = await repository(t);
  const row = await repo.add({ sessionId: 's', callId: 'c', rootCallId: 'c', toolName: 'fixture', toolInput: {}, status: 'pending', action: 'ask', decisionSource: 'rule', reason: 'x', inputDigest: 'x', configDigest: 'x', execution: { status: 'pending' }, taskId: 'task' });
  await assert.rejects(repo.decide(row.id, true, { expectedTaskId: 'other' }));
  const outcomes = await Promise.all([repo.decide(row.id, true), repo.decide(row.id, false, { timeout: true })]);
  assert.equal(outcomes.filter(o => o.resolved).length, 1);
  assert.equal((await repo.wait(row.id, new AbortController().signal)).effectiveAction, 'allow');
  assert.equal((await new InterceptionRepository(repo.path).detail(row.id)).effectiveAction, 'allow');
});
test('fresh-process recovery closes stale approvals while concurrent scopes never reset a live request', async t => {
  const repo = await repository(t);
  const row = await repo.add({ sessionId: 's', callId: 'c', rootCallId: 'c', toolName: 'fixture', toolInput: {}, status: 'pending', action: 'ask', decisionSource: 'rule', reason: 'x', inputDigest: 'x', configDigest: 'x', execution: { status: 'pending' } });
  await Promise.all([repo.initialize(), new InterceptionRepository(repo.path).initialize()]); assert.equal((await repo.detail(row.id)).status, 'pending');
  const recoveredPath = repo.path + '.new-process'; await writeFile(recoveredPath, JSON.stringify(await repo.snapshot()));
  const recovered = new InterceptionRepository(recoveredPath); await Promise.all([recovered.initialize(), new InterceptionRepository(recoveredPath).initialize()]);
  assert.equal((await recovered.detail(row.id)).status, 'denied'); assert.equal((await recovered.detail(row.id)).execution.status, 'not_executed');
});
test('judge nonpositive timeout settings resolve to original defaults', async t => {
  const repo = await repository(t); await repo.configure({ judge: { ...defaultJudgeConfig(), timeoutSeconds: 0, askTimeoutSeconds: -1 } });
  assert.equal((await repo.snapshot()).judge.timeoutSeconds, 15); assert.equal((await repo.snapshot()).judge.askTimeoutSeconds, 300);
});

class Adapter extends LlmAdapter {
  responses = []; requests = [];
  async resolveModel(provider, model) { return { provider, id: model, name: model }; }
  async *stream(request) {
    this.requests.push(request); const response = this.responses.shift(); assert.notEqual(response, undefined, 'unexpected model request');
    if (Array.isArray(response)) { for (const [index, args] of response.entries()) yield { type: 'tool-call-delta', index, id: randomUUID(), name: 'fixture', argumentsDelta: JSON.stringify(args) }; yield { type: 'finish', reason: { kind: 'tool-calls' } }; return; }
    if (typeof response === 'function') { yield* response(request); return; }
    yield { type: 'text-delta', index: 0, text: response }; yield { type: 'finish', reason: { kind: 'stop' } };
  }
}
async function fixture(t, { policy = 'ask', rule = inputRule(), taskBinding } = {}) {
  const dir = await mkdtemp(join(tmpdir(), 'intercept-host-')), app = new Context(), fibers = [], adapter = new Adapter(), bodies = [];
  const store = new RedTeamStore(join(dir, 'state.json')); await store.load();
  const task = await store.createTask('Fixture', 'Verify real execution'); let runtime, handle; const installed = Promise.withResolvers();
  t.after(async () => { await runtime?.dispose(); await handle?.dispose(); for (const f of fibers.reverse()) await f.dispose(); await rm(dir, { recursive: true, force: true }); });
  for (const [plugin, config] of [[SessionStore], [AgentRegistry], [LlmRuntime], [SystemPrompt, {}], [ToolRuntime, { mode: 'native' }], [ApprovalService, { policy }], [SessionProjections], [AgentLoop, {}]]) fibers.push(await app.plugin(plugin, config));
  fibers.push(await app.plugin(ctx => { ctx.inject(['llm', 'tools'], scope => {
    scope.llm.registerAdapter(['fixture'], adapter);
    scope.tools.register(defineTool({ name: 'fixture', description: 'Local pure fixture', isConcurrencySafe: () => true, parameters: { value: { type: 'string', required: true } }, output: { schema: { type: 'string' }, render: (_a, value) => [{ type: 'text', text: value }] }, execute: async args => { bodies.push(args.value); return args.value; } }));
  }); }));
  handle = await app.get('agents').create({ sessionId: SessionId(randomUUID()), agentOptions: { provider: 'fixture', model: 'parent' }, setup: async agentCtx => {
    await agentCtx.plugin(ctx => { ctx.inject(['tools', 'llm', 'approval'], scope => { try { runtime = installInterception(scope, store, { taskForAgent: () => ({ taskId: taskBinding ?? task.id, worker: false }) }); installed.resolve(); } catch (error) { installed.reject(error); } }); });
  } });
  await installed.promise; assert.ok(runtime); await runtime.ready; await runtime.repository.configure({ enabledTools: ['fixture'] }); if (rule) await runtime.repository.upsertRule(rule);
  const turn = () => { handle.agent.followup(createUserMessage({ content: [{ type: 'text', text: 'Fixture' }], source: { kind: 'user' } })); return handle.agent.whenIdle(); };
  const pending = (count = 1) => new Promise((resolve, reject) => { const until = Date.now() + 5000; const poll = async () => { const records = (await runtime.repository.snapshot()).records.filter(r => r.status === 'pending'); if (records.length >= count) resolve(records); else if (Date.now() > until) reject(new Error('No pending approval')); else setTimeout(poll, 5); }; void poll(); });
  return { app, adapter, runtime, task, store, bodies, turn, pending, agent: handle.agent };
}
test('real scoped DSH approval releases only the exact approved tool execution and records paired result', { timeout: 15000 }, async t => {
  const f = await fixture(t); f.adapter.responses.push([{ value: 'first' }], 'done'); const turn = f.turn();
  const [row] = await f.pending(); assert.deepEqual(f.bodies, []);
  await f.runtime.repository.decide(row.id, true, { expectedTaskId: f.task.id }); await turn; await f.runtime.flush();
  assert.deepEqual(f.bodies, ['first']); const saved = await f.runtime.repository.detail(row.id); assert.equal(saved.execution.status, 'succeeded'); assert.equal(saved.execution.output, '"first"');
  assert.equal(saved.sessionId, f.agent.session.id); assert.ok(saved.callId);
  const events = Array.from({ length: f.agent.session.seq }, (_, i) => f.agent.session.eventAt(i));
  assert.equal(events.filter(e => e?.type === 'approval/asked').length, 1); assert.equal(events.find(e => e?.type === 'approval/decided').data.outcome, 'allowed-once');
});
test('DSH never policy rejects without a tool body and persists not-executed', { timeout: 15000 }, async t => {
  const f = await fixture(t, { policy: 'never' }); f.adapter.responses.push([{ value: 'blocked' }], 'done'); await f.turn(); await f.runtime.flush();
  assert.deepEqual(f.bodies, []); const row = (await f.runtime.repository.snapshot()).records[0]; assert.equal(row.status, 'denied'); assert.equal(row.execution.status, 'not_executed');
});
test('approval timeout allow produces a genuine DSH allowed-once result', { timeout: 15000 }, async t => {
  const f = await fixture(t, { rule: inputRule({ timeoutEnabled: true, timeoutSeconds: 1, timeoutAction: 'allow' }) }); f.adapter.responses.push([{ value: 'timed' }], 'done'); await f.turn(); await f.runtime.flush();
  assert.deepEqual(f.bodies, ['timed']); const row = (await f.runtime.repository.snapshot()).records[0]; assert.equal(row.status, 'timeout'); assert.equal(row.effectiveAction, 'allow'); assert.equal(row.execution.status, 'succeeded');
});
test('real LlmRuntime unmatched-call judge dispatches a one-shot bounded request and applies deny', { timeout: 15000 }, async t => {
  const f = await fixture(t, { rule: null }); await f.runtime.repository.configure({ judge: { ...defaultJudgeConfig(), enabled: true } });
  f.adapter.responses.push([{ value: 'judged' }], verdict('deny'), 'done'); await f.turn(); await f.runtime.flush();
  assert.deepEqual(f.bodies, []); const row = (await f.runtime.repository.snapshot()).records[0]; assert.equal(row.decisionSource, 'model'); assert.equal(row.status, 'denied');
  const request = f.adapter.requests[1]; assert.equal(request.temperature, 0); assert.equal(request.maxTokens, 1024); assert.equal(JSON.parse(request.messages[0].content[0].text).tool_name, 'fixture'); assert.equal(JSON.parse(request.messages[0].content[0].text).background.text, 'Fixture'); assert.equal(request.tools, undefined);
});
test('invalid model verdict follows configured ask and real human rejection', { timeout: 15000 }, async t => {
  const f = await fixture(t, { rule: null }); await f.runtime.repository.configure({ judge: { ...defaultJudgeConfig(), enabled: true, failAction: 'ask' } });
  f.adapter.responses.push([{ value: 'judged' }], 'invalid JSON', 'done'); const turn = f.turn(); const [row] = await f.pending(); assert.equal(row.modelFallback, true); await f.runtime.repository.decide(row.id, false); await turn; await f.runtime.flush(); assert.deepEqual(f.bodies, []);
});
test('judge cancellation persists actual token usage independently of a missing approval decision', { timeout: 15000 }, async t => {
  const f = await fixture(t, { rule: null }); await f.runtime.repository.configure({ judge: { ...defaultJudgeConfig(), enabled: true } });
  const entered = Promise.withResolvers();
  f.adapter.responses.push([{ value: 'cancel-judge' }], async function* (request) {
    yield { type: 'usage', usage: { inputTokens: 17, outputTokens: 3, cacheReadTokens: 2 } }; entered.resolve();
    await new Promise(resolve => { if (request.signal.aborted) resolve(); else request.signal.addEventListener('abort', resolve, { once: true }); });
    yield { type: 'finish', reason: { kind: 'aborted' } };
  }, 'done');
  const turn = f.turn(); await entered.promise; await f.runtime.dispose(); await turn;
  const state = await f.runtime.repository.snapshot(); assert.equal(state.judgeCalls[0].status, 'cancelled'); assert.equal(state.judgeCalls[0].usage.inputTokens, 17);
  const usage = await f.runtime.repository.judgeUsage(); assert.equal(usage.calls, 1); assert.equal(usage.input_tokens, 17); assert.equal(usage.output_tokens, 3); assert.equal(usage.cache_read_tokens, 2); assert.equal(usage.daily[0].calls, 1);
});

test('two concurrent identical tool inputs keep distinct approvals and reject only the selected call', { timeout: 15000 }, async t => {
  const f = await fixture(t); f.adapter.responses.push([{ value: 'same' }], 'done'); const turn = f.turn(); await f.pending();
  const concurrent = f.app.get('tools').execute({ agent: f.agent, callId: randomUUID(), name: 'fixture', arguments: { value: 'same' }, signal: new AbortController().signal });
  const [first, second] = await f.pending(2); assert.notEqual(first.callId, second.callId);
  await f.runtime.repository.decide(second.id, true); await f.runtime.repository.decide(first.id, false); await concurrent; await turn; await f.runtime.flush();
  assert.deepEqual(f.bodies, ['same']); assert.equal((await f.runtime.repository.detail(first.id)).execution.status, 'not_executed'); assert.equal((await f.runtime.repository.detail(second.id)).execution.status, 'succeeded');
});
test('scope disposal cancels pending request without running the tool body', { timeout: 15000 }, async t => {
  const f = await fixture(t); f.adapter.responses.push([{ value: 'cancelled' }], 'done'); const turn = f.turn(); const [row] = await f.pending();
  await f.runtime.dispose(); await turn; assert.deepEqual(f.bodies, []); assert.equal((await f.runtime.repository.detail(row.id)).status, 'denied');
});
test('native DSH answerer can approve and durable history records its exact outcome', { timeout: 15000 }, async t => {
  const f = await fixture(t); const off = f.app.on('approval/request', async () => 'allowed-once'); t.after(off);
  f.adapter.responses.push([{ value: 'native-ui' }], 'done'); await f.turn(); await f.runtime.flush(); assert.deepEqual(f.bodies, ['native-ui']);
  const row = (await f.runtime.repository.snapshot()).records[0]; assert.equal(row.effectiveAction, 'allow'); assert.equal(row.execution.status, 'succeeded');
});
test('task-scoped rule does not intercept a different task in a real scoped Agent', { timeout: 15000 }, async t => {
  const f = await fixture(t, { rule: inputRule({ taskId: 'other-task', action: 'deny' }) }); f.adapter.responses.push([{ value: 'own-task' }], 'done'); await f.turn(); await f.runtime.flush();
  assert.deepEqual(f.bodies, ['own-task']); assert.deepEqual((await f.runtime.repository.snapshot()).records, []);
});
test('archive blocks pending requests, preserves complete records, restores idempotently and rejects conflicts', async t => {
  const repo = await repository(t), archive = new InterceptionArchive(repo), directory = join(repo.path + '.archive');
  const rule = await repo.upsertRule(inputRule({ taskId: 'task' }));
  const judgeId = await repo.startJudge({ taskId: 'task', sessionId: 's', provider: 'p', model: 'm' }); await repo.updateJudge(judgeId, { status: 'failed', usage: { inputTokens: 9, outputTokens: 2 } });
  const row = await repo.add({ sessionId: 's', callId: 'c', rootCallId: 'c', toolName: 'fixture', toolInput: { data: 'full' }, status: 'pending', action: 'ask', decisionSource: 'rule', ruleId: rule.id, reason: 'x', inputDigest: 'x', configDigest: 'x', execution: { status: 'pending' }, taskId: 'task' });
  await assert.rejects(archive.capture(directory, 'task', {}), /live interception/);
  await repo.decide(row.id, false); await repo.complete(row.id, { status: 'not_executed', output: 'denied' }); await archive.capture(directory, 'task', {});
  const target = new InterceptionRepository(repo.path + '.restored'); await target.initialize(); const restored = new InterceptionArchive(target); await restored.restore(directory, 'task'); await restored.restore(directory, 'task');
  assert.deepEqual((await target.detail(row.id)).toolInput, { data: 'full' }); assert.equal((await target.snapshot()).records.length, 1);
  assert.equal((await target.judgeUsage()).input_tokens, 9);
  await target.complete(row.id, { status: 'unknown' }); await assert.rejects(restored.restore(directory, 'task'), /conflict/); assert.equal((await target.detail(row.id)).execution.status, 'unknown');
  await assert.rejects(restored.restore(directory, 'other'), /Invalid/);
  const clean = new InterceptionRepository(repo.path + '.clean'); await clean.initialize();
  const combined = withInterceptionArchive({ async capture() {}, async restore() { throw new Error('Session restore conflict'); } }, clean);
  await assert.rejects(combined.restore(directory, 'task'), /Session restore conflict/); assert.deepEqual((await clean.snapshot()).records, []); assert.deepEqual((await clean.snapshot()).rules, []);
});
test('HTTP pending/detail/execution/decide uses durable first-writer decisions and rejects cross-origin mutations', { timeout: 15000 }, async t => {
  const f = await fixture(t); const host = await f.app.plugin(WebServer, { host: '127.0.0.1', port: 0 }); let http;
  const owner = await f.app.plugin(ctx => { ctx.inject(['webServer'], scope => { http = installInterceptionHttp(scope, f.store, { authenticate: request => request.headers.authorization === 'Bearer fixture-owner' ? true : request.headers.authorization ? 403 : 401 }); }); });
  t.after(async () => { await owner.dispose(); await host.dispose(); });
  await http.ready; const base = `http://127.0.0.1:${f.app.get('webServer').port}/api/redteam/interception`;
  const headers = { authorization: 'Bearer fixture-owner', 'content-type': 'application/json' };
  assert.equal((await fetch(base + '/pending')).status, 401);
  assert.equal((await fetch(base + '/pending', { headers: { authorization: 'Bearer fixture-viewer' } })).status, 403);
  f.adapter.responses.push([{ value: 'via-http' }], 'done'); const turn = f.turn(); const [row] = await f.pending();
  assert.equal((await (await fetch(base + '/pending', { headers })).json()).items[0].id, row.id);
  assert.equal((await fetch(base + '/records/' + row.id + '/decide', { method: 'POST', headers: { ...headers, origin: 'https://unrelated.invalid' }, body: JSON.stringify({ allowed: true }) })).status, 403);
  const approve = () => fetch(base + '/records/' + row.id + '/decide', { method: 'POST', headers, body: JSON.stringify({ allowed: true, taskId: f.task.id }) });
  assert.equal((await approve()).status, 200); assert.equal((await approve()).status, 409); await turn; await f.runtime.flush();
  assert.equal((await (await fetch(base + '/history?status=denied', { headers })).json()).total, 0);
  assert.equal((await (await fetch(base + '/history?status=allowed&decision_source=rule', { headers })).json()).total, 1);
  const execution = await (await fetch(base + '/records/' + row.id + '/execution', { headers })).json(); assert.equal(execution.callId, row.callId); assert.equal(execution.execution.status, 'succeeded');
});



