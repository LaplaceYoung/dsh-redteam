import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { build } from 'esbuild';
import { Context } from '@deepseek-ai/cordis';
import { SessionId, SessionStore } from '@deepseek-ai/dsh-session';
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

// Read current source without racing other agents rebuilding lib/.
const built = await build({ stdin: { contents: "export { installDshFindings } from './src/findings-reports/dsh.ts'; export { RedTeamStore } from './src/store.ts'; export { TaskModelRouter } from './src/task-management/runtime-model.ts';", resolveDir: process.cwd(), loader: 'ts' }, bundle: true, write: false, platform: 'node', format: 'esm', packages: 'external' });
const code = built.outputFiles[0].text.replace(/from\s+(["'])([^"']+)\1/g, (_match, _quote, specifier) => `from ${JSON.stringify(import.meta.resolve(specifier))}`);
const { installDshFindings, RedTeamStore, TaskModelRouter } = await import(`data:text/javascript;base64,${Buffer.from(`${code}\n//# sourceURL=findings-dsh-integration-tests.bundle.mjs`).toString('base64')}`);

class ControlledAdapter extends LlmAdapter {
  requests = [];
  plans = new Map();
  nativeScript;
  plan(findingId, markdown, hold = false) {
    const plan = { markdown, entered: Promise.withResolvers(), release: Promise.withResolvers() };
    if (!hold) plan.release.resolve();
    this.plans.set(findingId, plan);
    return plan;
  }
  async resolveModel(provider, model) {
    if (provider === 'reporter-fixture') return { provider, id: model, name: model, reasoning: { efforts: [{ id: 'low', name: 'Low' }], defaultEffort: 'low' } };
    return { provider, id: model, name: model, reasoning: { efforts: [{ id: 'high', name: 'High' }], defaultEffort: 'high' } };
  }
  async *stream(request) {
    if (this.nativeScript) { this.requests.push({ request }); yield* this.nativeScript(request); return; }
    const input = JSON.parse(request.messages[0].content[0].text);
    const plan = this.plans.get(input.finding.id);
    assert.ok(plan, `unexpected model request for ${input.finding.id}`);
    this.requests.push({ request, input });
    plan.entered.resolve(request);
    await plan.release.promise;
    request.signal?.throwIfAborted();
    yield { type: 'text-delta', index: 0, text: '# ' };
    yield { type: 'text-delta', index: 0, text: plan.markdown };
    yield { type: 'finish', reason: { kind: 'stop' } };
  }
}

async function fixture(t, options = {}) {
  const dir = await mkdtemp(join(tmpdir(), 'findings-dsh-'));
  const store = new RedTeamStore(join(dir, 'state.json'));
  const app = new Context(), fibers = [], parents = [], bindings = new Map(), admissions = [], sessions = new Map();
  const adapter = new ControlledAdapter();
  const profiles = { resolveProfile: () => null, resolveBinding: () => null, ...options.profiles };
  let installed;
  t.after(async () => {
    await installed?.dispose();
    for (const plan of adapter.plans.values()) plan.release.resolve();
    for (const parent of parents.reverse()) await parent.dispose();
    for (const fiber of fibers.reverse()) await fiber.dispose();
    await rm(dir, { recursive: true, force: true });
  });
  const mount = async (plugin, config) => { fibers.push(await app.plugin(plugin, config)); };
  await mount(SessionStore);
  await mount(AgentRegistry);
  await mount(LlmRuntime);
  await mount(SystemPrompt, {});
  await mount(ToolRuntime, { mode: 'native' });
  await mount(SessionProjections);
  if (options.native) {
    await mount(LocalFileSystem, { cwd: dir }); await mount(WorkingDirectory, { defaultDirectory: dir });
    await mount(JsonlPersistence, { root: join(dir, 'sessions') });
    await mount(SessionQuery, { path: ':memory:', openAt: 'never' });
  }
  await mount(AgentLoop, {});
  if (options.native) { await mount(Subagents, {}); await mount(spawnProvider, {}); }
  await mount(ctx => {
    ctx.inject(['llm'], inner => { inner.llm.registerAdapter(['parent-a', 'parent-b', 'reporter-fixture', 'retester-fixture'], adapter); });
    ctx.on('session/event', session => { sessions.set(session.id, session); });
  });
  // Only admission is isolated: routing goes through the production TaskModelRouter and LlmRuntime.
  const lifecycle = {
    models: new TaskModelRouter(store, app.get('llm'), profiles),
    taskForAgent: id => bindings.has(id) ? { binding: bindings.get(id), role: 'mainagent' } : undefined,
    async start(taskId, parent, action) { admissions.push({ taskId, parent, action }); return { taskId, admitted: true }; },
  };
  await options.beforeInstall?.(store);
  await mount(ctx => { ctx.inject(['tools', 'llm', 'agents', ...(options.native ? ['subagents'] : [])], inner => { installed = installDshFindings(inner, store, lifecycle, profiles, { automaticReports: false }); }); });
  assert.ok(installed, 'native Cordis injection must install findings tools');
  await installed.ready;
  async function parent(route = {}) {
    const handle = await app.get('agents').create({ sessionId: SessionId(randomUUID()), meta: { cwd: dir },
      agentOptions: { provider: 'parent-a', model: 'model-a', maxTokens: 1234, reasoningEffort: 'high', ...route } });
    parents.push(handle); return handle.agent;
  }
  const bind = (agent, task, owner = agent) => bindings.set(agent.id, { taskId: task.id, parent: owner });
  const call = (agent, name, args) => app.get('tools').execute({ callId: randomUUID(), name, arguments: args, agent, signal: AbortSignal.timeout(10000) });
  async function ok(agent, name, args) { const result = await call(agent, name, args); assert.equal(result.isError, false, JSON.stringify(result)); return result.value; }
  async function finding(task, summary = '已保存的命令输出证据') {
    return store.addFinding({ taskId: task.id, vulnClass: 'Fixture', severity: 'high', summary,
      evidence: { command: 'fixture-only', output: summary }, status: 'pending', assetIds: [], evidenceIds: [] });
  }
  return { store, app, adapter, profiles, lifecycle, installed, parent, bind, call, ok, finding, admissions, sessions };
}

test('installer ready seals interrupted persisted retests before tools are used', async t => {
  let findingId;
  const f=await fixture(t,{beforeInstall:async store=>{
    const task=await store.createTask('Restart fixture','Local fixture');
    const finding=await store.addFinding({taskId:task.id,vulnClass:'Fixture',severity:'low',summary:'Retained',status:'pending',assetIds:[],evidenceIds:[]});
    findingId=finding.id;
    await store.transaction(state=>{state.findings[0].retests=[{id:'interrupted-retest',findingId,status:'running',notes:'',createdAt:new Date().toISOString(),sessionId:'old-session',snapshot:{finding,assets:[],constraints:[]}}];});
  }});
  assert.deepEqual(await f.installed.ready,{recovered:1});
  const parent=await f.parent();
  const history=await f.ok(parent,'redteam_finding_retests',{action:'history',finding_id:findingId});
  assert.equal(history[0].status,'cancelled');
  assert.match(history[0].error,/Host restarted/);
  assert.equal(f.store.snapshot().findings[0].status,'pending');
});

test('overlapping real Agent report calls retain each caller route across delayed resolution and streams', { timeout: 15000 }, async t => {
  const routeEntered = Promise.withResolvers(), releaseRoute = Promise.withResolvers();
  let taskAId, blocked = false;
  const f = await fixture(t, { profiles: { async resolveBinding(taskId, role) {
    if (taskId === taskAId && role === 'reporter' && !blocked) { blocked = true; routeEntered.resolve(); await releaseRoute.promise; }
    return null;
  } } });
  t.after(() => releaseRoute.resolve());
  const taskA = await f.store.createTask('A', 'authorized fixture'), taskB = await f.store.createTask('B', 'authorized fixture');
  taskAId = taskA.id;
  const parentA = await f.parent(), parentB = await f.parent({ provider: 'parent-b', model: 'model-b', maxTokens: 4321 });
  f.bind(parentA, taskA); f.bind(parentB, taskB);
  const findingA = await f.finding(taskA, 'A evidence'), findingB = await f.finding(taskB, 'B evidence');
  const planA = f.adapter.plan(findingA.id, 'A 独立报告', true), planB = f.adapter.plan(findingB.id, 'B 独立报告', true);
  const resultA = f.ok(parentA, 'redteam_finding_report', { finding_id: findingA.id, action: 'generate' });
  await routeEntered.promise;
  const resultB = f.ok(parentB, 'redteam_finding_report', { finding_id: findingB.id, action: 'generate' });
  const requestB = await planB.entered.promise;
  releaseRoute.resolve();
  const requestA = await planA.entered.promise;
  assert.equal(f.store.snapshot().findings.some(row => row.report), false, 'neither in-flight stream may save partial output');
  planB.release.resolve();
  assert.equal((await resultB).report, '# B 独立报告');
  assert.equal(f.store.snapshot().findings.find(row => row.id === findingA.id).report, undefined);
  planA.release.resolve();
  assert.equal((await resultA).report, '# A 独立报告');
  assert.deepEqual([requestA.provider, requestA.model, requestA.maxTokens], ['parent-a', 'model-a', 1234]);
  assert.deepEqual([requestB.provider, requestB.model, requestB.maxTokens], ['parent-b', 'model-b', 4321]);
  assert.deepEqual(f.adapter.requests.map(row => row.input.finding.summary), ['B evidence', 'A evidence']);
  assert.equal(f.admissions.length, 0, 'reporting must not restart task execution');
});

test('terminal task uses reporter role binding through real model routing without task admission', { timeout: 15000 }, async t => {
  const f = await fixture(t, { profiles: { resolveBinding: (_taskId, role) => role === 'reporter'
    ? { provider: 'reporter-fixture', model: 'reporter-model', maxTokens: 678 } : null } });
  const task = await f.store.createTask('Closed work', 'authorized fixture'), parent = await f.parent();
  f.bind(parent, task);
  const finding = await f.finding(task);
  await f.store.transaction(state => { state.tasks.find(row => row.id === task.id).status = 'done'; });
  f.adapter.plan(finding.id, '终态任务报告');
  const report = await f.ok(parent, 'redteam_finding_report', { finding_id: finding.id, action: 'generate' });
  assert.equal(report.report, '# 终态任务报告');
  const request = f.adapter.requests[0].request;
  assert.deepEqual([request.provider, request.model, request.maxTokens, request.reasoningEffort], ['reporter-fixture', 'reporter-model', 678, 'low']);
  assert.equal(f.store.snapshot().tasks.find(row => row.id === task.id).status, 'done');
  assert.equal(f.admissions.length, 0);
  assert.equal((await f.ok(parent, 'redteam_finding_report', { finding_id: finding.id, action: 'get' })).markdown, '# 终态任务报告');
});

test('real Agent task binding hides foreign findings and exposes direct inherited findings read-only', { timeout: 15000 }, async t => {
  const f = await fixture(t), parent = await f.parent();
  const own = await f.store.createTask('Own', 'fixture'), source = await f.store.createTask('Source', 'fixture'), foreign = await f.store.createTask('Foreign', 'fixture');
  await f.store.transaction(state => { state.tasks.find(row => row.id === own.id).sourceTaskIds = [source.id]; });
  f.bind(parent, own);
  const ownFinding = await f.finding(own), inherited = await f.finding(source), hidden = await f.finding(foreign);
  const list = await f.ok(parent, 'redteam_finding_query', { action: 'list' });
  assert.deepEqual(new Set(list.items.map(row => row.id)), new Set([ownFinding.id, inherited.id]));
  assert.equal((await f.ok(parent, 'redteam_finding_query', { action: 'get', finding_id: inherited.id })).id, inherited.id);
  for (const [name, args] of [
    ['redteam_finding_query', { action: 'get', finding_id: hidden.id }],
    ['redteam_finding_edit', { action: 'update', finding_id: hidden.id, status: 'fixed' }],
    ['redteam_finding_edit', { action: 'update', finding_id: inherited.id, status: 'fixed' }],
    ['redteam_finding_report', { action: 'generate', finding_id: inherited.id }],
    ['redteam_finding_report', { action: 'generate', finding_id: hidden.id }],
    ['redteam_finding_deepen', { finding_id: inherited.id, description: 'must be rejected' }],
  ]) {
    const result = await f.call(parent, name, args);
    assert.equal(result.isError, true, JSON.stringify({ name, args, result }));
    assert.match(JSON.stringify(result), /outside current task|read-only/);
  }
  assert.equal(f.adapter.requests.length, 0); assert.equal(f.admissions.length, 0);
  assert.equal(f.store.snapshot().findings.find(row => row.id === hidden.id).status, 'pending');
  assert.equal(f.store.snapshot().findings.find(row => row.id === inherited.id).status, 'pending');
  const updated = await f.ok(parent, 'redteam_finding_edit', { action: 'update', finding_id: ownFinding.id, status: 'confirmed' });
  assert.equal(updated.status, 'confirmed');
});

test('deepen persists lineage and passes the exact owning parent plus rerun to host admission', { timeout: 15000 }, async t => {
  const f = await fixture(t), owner = await f.parent(), caller = await f.parent({ provider: 'parent-b', model: 'model-b' });
  const task = await f.store.createTask('Completed task', 'fixture'), finding = await f.finding(task);
  f.bind(caller, task, owner);
  await f.store.transaction(state => { state.tasks.find(row => row.id === task.id).status = 'done'; });
  const result = await f.ok(caller, 'redteam_finding_deepen', { finding_id: finding.id, description: '验证已记录证据的边界条件' });
  assert.equal(f.admissions.length, 1);
  assert.equal(f.admissions[0].taskId, task.id);
  assert.strictEqual(f.admissions[0].parent, owner);
  assert.equal(f.admissions[0].action, 'rerun');
  assert.equal(result.admission.admitted, true);
  const state = f.store.snapshot(), intent = state.intents.find(row => row.id === result.intent.id);
  assert.ok(intent); assert.equal(intent.taskId, task.id); assert.equal(intent.summary, '验证已记录证据的边界条件');
  assert.ok(state.edges.some(edge => edge.from === (finding.nodeId ?? finding.id) && edge.to === intent.id && edge.relation === 'derived_from'));
  assert.equal(f.adapter.requests.length, 0);
});

test('installed retest tool uses a real isolated spawn to read context, record a verdict and atomically notify fixed status', { timeout: 20000 }, async t => {
  const f = await fixture(t, { native: true, profiles: { resolveBinding: (_taskId, role) => role === 'retester'
    ? { provider: 'retester-fixture', model: 'retester-model', maxTokens: 900 } : null } });
  const parent = await f.parent(), task = await f.store.createTask('Native retest', 'Local fixture only');
  f.bind(parent, task);
  const finding = await f.finding(task, 'ORIGINAL_RETEST_EVIDENCE');
  await f.store.updateFinding(finding.id, { status: 'confirmed' });
  const beforeEvents = f.store.snapshot().notificationEvents.length;
  let turn = 0;
  f.adapter.nativeScript = async function* (request) {
    if (request.model !== 'retester-model') {
      yield { type: 'text-delta', index: 0, text: 'Acknowledged child completion' };
      yield { type: 'finish', reason: { kind: 'stop' } }; return;
    }
    assert.equal(request.provider, 'retester-fixture'); assert.equal(request.maxTokens, 900);
    const index = turn++;
    if (index === 0 || index === 1) {
      if (index === 1) {
        assert.match(JSON.stringify(request.messages), /ORIGINAL_RETEST_EVIDENCE/);
        assert.match(JSON.stringify(request.messages), new RegExp(finding.id));
      }
      const name = index === 0 ? 'redteam_get_finding_retest_context' : 'redteam_record_finding_retest_result';
      const args = index === 0 ? {} : { verdict: 'fixed', summary: 'Controlled fixture no longer reproduces', evidence: 'Controlled baseline succeeded; original fixture condition failed under the same recorded inputs.' };
      yield { type: 'tool-call-delta', index: 0, id: randomUUID(), name, argumentsDelta: JSON.stringify(args) };
      yield { type: 'finish', reason: { kind: 'tool-calls' } }; return;
    }
    assert.equal(index, 2, 'ret tester should finish after recording one verdict');
    yield { type: 'text-delta', index: 0, text: 'Fixture verdict recorded' };
    yield { type: 'finish', reason: { kind: 'stop' } };
  };
  const result = await f.ok(parent, 'redteam_finding_retests', { action: 'start', finding_id: finding.id, notes: 'Only controlled local fixture evidence' });
  assert.equal(result.created, true); assert.equal(result.retest.status, 'done', JSON.stringify(result)); assert.equal(result.retest.verdict, 'fixed');
  assert.equal(turn, 3);
  const state = f.store.snapshot(), saved = state.findings.find(row => row.id === finding.id);
  assert.equal(saved.status, 'fixed'); assert.equal(saved.retests[0].sessionId, result.retest.sessionId);
  assert.equal(state.notificationEvents.length, beforeEvents + 1);
  const notification = state.notificationEvents.at(-1).snapshot;
  assert.deepEqual([notification.kind, notification.findingId, notification.fromStatus, notification.toStatus],
    ['finding_status_changed', finding.id, 'confirmed', 'fixed']);
  const session = f.sessions.get(result.retest.sessionId);
  assert.equal(session.header.parentSession, parent.id);
  assert.equal(session.snapshotEvents().filter(event => event.type === 'turn/end').at(-1).data.reason.kind, 'completed');
  assert.equal(f.app.get('agents').get(SessionId(result.retest.sessionId)), undefined, 'completed retester child is drained');
  assert.strictEqual(f.app.get('agents').get(parent.id), parent);
  assert.equal(f.admissions.length, 0);
  await parent.whenIdle();
});

test('disposing the host aborts an in-flight native retest and waits until its child is drained', { timeout: 20000 }, async t => {
  const f = await fixture(t, { native: true, profiles: { resolveBinding: (_taskId, role) => role === 'retester'
    ? { provider: 'retester-fixture', model: 'retester-model' } : null } });
  const parent = await f.parent(), task = await f.store.createTask('Disposal fixture', 'Local fixture only');
  f.bind(parent, task);
  const finding = await f.finding(task), entered = Promise.withResolvers();
  f.adapter.nativeScript = async function* (request) {
    if (request.model === 'retester-model') {
      entered.resolve();
      await new Promise((_resolve, reject) => {
        const abort = () => reject(request.signal.reason);
        if (request.signal.aborted) abort();
        else request.signal.addEventListener('abort', abort, { once: true });
      });
    }
    yield { type: 'text-delta', index: 0, text: 'Acknowledged cancellation' };
    yield { type: 'finish', reason: { kind: 'stop' } };
  };
  const running = f.call(parent, 'redteam_finding_retests', { action: 'start', finding_id: finding.id });
  await entered.promise;
  const retest = f.store.snapshot().findings.find(row => row.id === finding.id).retests[0];
  assert.ok(f.app.get('agents').get(SessionId(retest.sessionId)), 'child must be live before disposal');
  await f.installed.dispose();
  assert.equal(f.app.get('agents').get(SessionId(retest.sessionId)), undefined, 'dispose must await child drain');
  const result = await running;
  assert.equal(result.isError, false, JSON.stringify(result));
  assert.equal(result.value.retest.status, 'cancelled');
  assert.equal(f.sessions.get(retest.sessionId).snapshotEvents().filter(event => event.type === 'turn/end').at(-1).data.reason.kind, 'aborted');
  assert.equal(f.store.snapshot().findings.find(row => row.id === finding.id).status, 'pending');
  assert.strictEqual(f.app.get('agents').get(parent.id), parent);
  assert.equal(f.app.get('tools').get('redteam_finding_report', parent), undefined);
  await parent.whenIdle();
});
