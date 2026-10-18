import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import ts from 'typescript';
import { createAssistantMessage } from '@deepseek-ai/dsh-llm';
import { RedTeamStore } from '../lib/store.js';

const source = await readFile(new URL('../src/planner/bootstrap.ts', import.meta.url), 'utf8');
const { outputText } = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } });
const executable = outputText
  .replaceAll("'@deepseek-ai/dsh-llm'", JSON.stringify(import.meta.resolve('@deepseek-ai/dsh-llm')))
  .replaceAll("'tldts'", JSON.stringify(import.meta.resolve('tldts')));
const { bootstrapTaskGoals } = await import(`data:text/javascript;base64,${Buffer.from(executable).toString('base64')}`);
const options = { provider: 'test', model: 'goals' };
let seq = 0;
const call = (name, args) => ({ type: 'tool-call', id: `goals-${++seq}`, name, arguments: JSON.stringify(args) });
const answer = (...content) => createAssistantMessage({ source: options, content });
const done = () => answer({ type: 'text', text: '目标分解完成' });
const goals = (text = '取得目标成果') => answer(call('set_goals', { goals: [{ text, vulnclass: 'IDOR' }] }));
const signal = () => new AbortController().signal;
const deferred = () => { let resolve; const promise = new Promise((done) => { resolve = done; }); return { promise, resolve }; };

async function fixture(t, goal = '核验 https://app.example.com 上的两个独立成果，仅测试 app.example.com，禁止爆破', description = '目标背景') {
  const dir = await mkdtemp(join(tmpdir(), 'planner-bootstrap-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const store = new RedTeamStore(join(dir, 'state.json'));
  const task = await store.createTask('Goal bootstrap', goal);
  await store.transaction((state) => { state.tasks.find((row) => row.id === task.id).description = description; });
  const requests = [];
  const complete = (responses) => async (request) => {
    requests.push(request);
    const response = responses.shift();
    assert.ok(response, 'unexpected model request');
    return typeof response === 'function' ? response(request) : response;
  };
  return { store, task, requests, complete };
}

test('bootstrap uses ARTEX tools and atomically persists independent goals, constraints and exact scope', async (t) => {
  const f = await fixture(t);
  const initial = f.store.snapshot().version;
  const messages = [];
  const result = await bootstrapTaskGoals(f.store, f.task.id, f.complete([
    answer(call('set_constraints', { constraints: [{ type: 'allow', text: '仅测试 app.example.com' }, { text: '禁止对 app.example.com 爆破' }] })),
    answer(call('add_task_scope', { entries: [{ kind: 'subdomain', value: 'app.example.com' }], reason: '任务明确指定 https://app.example.com' })),
    () => {
      assert.equal(f.store.snapshot().constraints.length, 0);
      assert.equal(f.store.snapshot().scopes.length, 0);
      assert.equal(f.store.snapshot().goals.length, 0);
      return answer(call('set_goals', { goals: [{ text: '目标成果一', vulnclass: 'IDOR' }, { text: '目标成果二' }] }));
    }, done(),
  ]), signal(), { ...options, maxTokens: 1234, onMessage: (_id, message) => messages.push(message) });
  assert.equal(result.status, 'created');
  assert.deepEqual(result.goals.map((row) => row.text), ['目标成果一', '目标成果二']);
  assert.equal(result.goals[0].vulnClass, 'IDOR');
  assert.equal(result.constraints[1].kind, 'deny');
  assert.equal(result.constraints[0].origin, 'goals');
  assert.equal(result.scopes[0].value, 'app.example.com');
  assert.equal(f.store.snapshot().version, initial + 1);
  assert.equal(f.requests[0].maxTokens, 1234);
  assert.equal(messages.some((row) => row.role === 'tool'), true);
  const persisted = JSON.parse(await readFile(f.store.storagePath, 'utf8'));
  assert.equal(persisted.goals.length, 2);
  assert.notEqual(persisted.goals[0].text, f.task.goal, 'LLM decomposition is not raw goal copying');
});

test('existing goals including deleted skip model and bootstrap writes', async (t) => {
  const f = await fixture(t);
  await f.store.addGoal({ taskId: f.task.id, text: 'User removed objective', state: 'deleted' });
  const version = f.store.snapshot().version;
  const result = await bootstrapTaskGoals(f.store, f.task.id, () => { throw new Error('must not call model'); }, signal(), options);
  assert.equal(result.status, 'existing');
  assert.equal(result.goals[0].state, 'deleted');
  assert.equal(f.store.snapshot().version, version);
});

test('empty goal and description skip; background-only description requires explicit empty goal submission', async (t) => {
  const f = await fixture(t, '', '');
  assert.equal((await bootstrapTaskGoals(f.store, f.task.id, () => { throw new Error('must not call'); }, signal(), options)).status, 'skipped');
  await f.store.transaction((state) => { state.tasks[0].description = 'Only context; no requested outcome'; });
  const result = await bootstrapTaskGoals(f.store, f.task.id, f.complete([answer(call('set_goals', { goals: [] })), done()]), signal(), options);
  assert.equal(result.status, 'skipped');
  assert.equal(result.goals.length, 0);
});

test('LLM with no goals falls back to raw task goal once and reports degradation', async (t) => {
  const f = await fixture(t);
  const result = await bootstrapTaskGoals(f.store, f.task.id, f.complete([answer(call('set_constraints', { text: '禁止爆破', type: 'deny' })), done()]), signal(), options);
  assert.equal(result.status, 'fallback');
  assert.match(result.warning, /降级/);
  assert.equal(result.goals.length, 1);
  assert.equal(result.goals[0].text, f.task.goal);
  assert.equal(result.constraints.length, 1);
  assert.equal(f.requests.length, 2, 'fallback must follow a real model attempt');
  const empty = await fixture(t, '', 'Background');
  await assert.rejects(bootstrapTaskGoals(empty.store, empty.task.id, empty.complete([done()]), signal(), options), /did not submit/);
});

test('minimum scope remains a prompt instruction, while actual API schema allows all source-supported kinds', async (t) => {
  const f = await fixture(t);
  await f.store.addCompany({ name: 'Example' });
  const result = await bootstrapTaskGoals(f.store, f.task.id, f.complete([
    answer(call('add_task_scope', { kind: 'root_domain', value: 'example.com', reason: 'parent domain' }), call('add_task_scope', { kind: 'subdomain', value: 'other.example.com', reason: 'not literal in source' }), call('add_task_scope', { kind: 'company', value: 'Example', reason: 'existing company' }), call('add_task_scope', { kind: 'company', value: 'Unknown' })),
    answer(call('add_task_scope', { entries: [{ kind: 'icp', value: ' ICP 123 ' }, { kind: 'keyword', value: 'Example   Company' }] }), call('set_goals', { text: '核验目标成果' })), done(),
  ]), signal(), options);
  assert.equal(result.scopes.length, 5);
  assert.equal(result.scopes[2].companyId, f.store.snapshot().companies[0].id);
  assert.equal(result.scopes[3].value, 'icp123');
  assert.equal(result.scopes[4].value, 'example company');
  const results = f.requests[1].messages.filter((row) => row.role === 'tool');
  assert.deepEqual(results.map((row) => row.isError), [false, false, false, true]);
  assert.match(f.requests[0].system, /最小范围/);
});

test('explicit IP/CIDR and bare root domain are accepted; mixed batches retain successes and return indexed errors', async (t) => {
  const f = await fixture(t, '核验 192.0.2.1、192.0.2.0/24 和 example.net', '');
  const result = await bootstrapTaskGoals(f.store, f.task.id, f.complete([
    answer(call('add_task_scope', { entries: [{ kind: 'ip', value: '192.0.2.1' }, { kind: 'ip', value: '192.0.2.0/999' }], reason: 'invalid batch' })),
    answer(call('add_task_scope', { entries: [{ kind: 'ip', value: '192.0.2.1' }, { kind: 'cidr', value: '192.0.2.0/24' }, { kind: 'root_domain', value: 'example.net' }], reason: 'explicit targets' }), call('set_goals', { text: '核验三个目标成果' })), done(),
  ]), signal(), options);
  assert.deepEqual(result.scopes.map((row) => row.kind), ['ip', 'cidr', 'root_domain']);
  assert.equal(result.scopes[0].reason, 'invalid batch', 'valid first entry survives the second entry failure');
  assert.equal(result.scopes[0].value, '192.0.2.1/32');
  const partial = JSON.parse(f.requests[1].messages.find((row) => row.role === 'tool').content[0].text);
  assert.equal(partial.staged, 1);
  assert.match(partial.errors['1'], /CIDR/);
});

test('set_goals and set_constraints mixed batches preserve valid entries exactly as source tools', async (t) => {
  const f = await fixture(t);
  const result = await bootstrapTaskGoals(f.store, f.task.id, f.complete([
    answer(call('set_constraints', { constraints: [{ text: 'valid constraint', type: 'DENY' }, { text: '', type: 'deny' }] }), call('set_goals', { goals: [{ text: 'valid objective' }, { text: '' }, null] })), done(),
  ]), signal(), options);
  assert.equal(result.status, 'created');
  assert.deepEqual(result.goals.map((row) => row.text), ['valid objective']);
  assert.deepEqual(result.constraints.map((row) => row.text), ['valid constraint']);
  const results = f.requests[1].messages.filter((row) => row.role === 'tool').map((row) => JSON.parse(row.content[0].text));
  assert.deepEqual(Object.keys(results[0].errors), ['1']);
  assert.deepEqual(Object.keys(results[1].errors), ['1', '2']);
});

test('root domains use ICANN and private PSL rules while subdomain scopes retain the precise host', async (t) => {
  const f = await fixture(t);
  const entries = [
    { kind: 'root_domain', value: 'Api.Example.CO.UK.:443' },
    { kind: 'subdomain', value: 'Api.Example.CO.UK.:443' },
    { kind: 'root_domain', value: 'www.tenant.blogspot.com' },
    { kind: 'root_domain', value: 'assets.project.github.io' },
    { kind: 'root_domain', value: 'api.example.internal' },
  ];
  const result = await bootstrapTaskGoals(f.store, f.task.id, f.complete([
    answer(call('add_task_scope', { entries, reason: 'PSL fixture' }), call('set_goals', { text: '核验目标成果' })), done(),
  ]), signal(), options);
  assert.deepEqual(result.scopes.map((row) => [row.kind, row.value]), [
    ['root_domain', 'example.co.uk'],
    ['subdomain', 'api.example.co.uk'],
    ['root_domain', 'tenant.blogspot.com'],
    ['root_domain', 'project.github.io'],
    ['root_domain', 'example.internal'],
  ]);
});

test('root-domain inputs without a registrable parent retain the normalized host like ARTEX RootDomain', async (t) => {
  const f = await fixture(t);
  const hosts = ['LOCALHOST.', 'Co.Uk', 'github.io', '192.0.2.1', '2001:db8::1', '.example.com', 'a..example.com'];
  const result = await bootstrapTaskGoals(f.store, f.task.id, f.complete([
    answer(call('add_task_scope', { entries: hosts.map((value) => ({ kind: 'root_domain', value })) }), call('set_goals', { text: '核验边界输入' })), done(),
  ]), signal(), options);
  assert.deepEqual(result.scopes.map((row) => row.value), ['localhost', 'co.uk', 'github.io', '192.0.2.1', '2001:db8::1', '.example.com', 'a..example.com']);
});

test('concurrent bootstrap calls on shared store execute only one LLM loop', async (t) => {
  const f = await fixture(t);
  const gate = deferred(); const started = deferred(); let calls = 0;
  const complete = async () => { calls++; if (calls === 1) { started.resolve(); await gate.promise; return goals(); } return done(); };
  const first = bootstrapTaskGoals(f.store, f.task.id, complete, signal(), options);
  await started.promise;
  const secondStore = new RedTeamStore(f.store.storagePath);
  const second = bootstrapTaskGoals(secondStore, f.task.id, () => { throw new Error('duplicate model loop'); }, signal(), options);
  gate.resolve();
  const [a, b] = await Promise.all([first, second]);
  assert.deepEqual(a.goals, b.goals);
  assert.equal(calls, 2);
  assert.equal(f.store.snapshot().goals.length, 1);
});

test('pause, original goal change and description change invalidate in-flight decomposition', async (t) => {
  for (const change of ['pause', 'goal', 'description']) {
    const f = await fixture(t);
    const gate = deferred(); const started = deferred();
    const pending = bootstrapTaskGoals(f.store, f.task.id, f.complete([async () => { started.resolve(); await gate.promise; return goals(); }, done()]), signal(), options);
    const rejected = assert.rejects(pending, /paused|changed/);
    await started.promise;
    await f.store.transaction((state) => {
      if (change === 'pause') state.tasks[0].status = 'paused';
      else state.tasks[0][change] = 'new user requirement';
    });
    gate.resolve();
    await rejected;
    assert.equal(f.store.snapshot().goals.length, 0);
  }
});

test('goal added by human during model call wins and bootstrap does not add its stale goal', async (t) => {
  const f = await fixture(t);
  const result = await bootstrapTaskGoals(f.store, f.task.id, f.complete([async () => {
    await f.store.addGoal({ taskId: f.task.id, text: 'Human-added goal', state: 'open' });
    return goals('Model goal must be discarded');
  }, done()]), signal(), options);
  assert.equal(result.status, 'existing');
  assert.deepEqual(result.goals.map((row) => row.text), ['Human-added goal']);
});

test('cancellation never commits; model errors and turn exhaustion preserve already-produced goals with warnings', async (t) => {
  const f = await fixture(t);
  const controller = new AbortController();
  await assert.rejects(bootstrapTaskGoals(f.store, f.task.id, f.complete([goals(), () => { controller.abort(new Error('operator paused')); return done(); }]), controller.signal, options), /operator paused/);
  assert.equal(f.store.snapshot().goals.length, 0);
  const failure = new Error('provider unavailable');
  const preserved = await bootstrapTaskGoals(f.store, f.task.id, f.complete([goals(), () => { throw failure; }]), signal(), options);
  assert.equal(preserved.status, 'created');
  assert.equal(preserved.goals[0].text, '取得目标成果');
  assert.match(preserved.warning, /provider unavailable/);
  const exhausted = await fixture(t);
  const result = await bootstrapTaskGoals(exhausted.store, exhausted.task.id, exhausted.complete([goals()]), signal(), { ...options, maxTurns: 1 });
  assert.equal(result.status, 'created');
  assert.match(result.warning, /轮数上限/);
  const failed = await fixture(t);
  const fallback = await bootstrapTaskGoals(failed.store, failed.task.id, () => { throw failure; }, signal(), options);
  assert.equal(fallback.status, 'fallback');
  assert.equal(fallback.goals[0].text, failed.task.goal);
  assert.match(fallback.warning, /provider unavailable/);
});
