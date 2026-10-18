import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';
import { createAssistantMessage } from '@deepseek-ai/dsh-llm';

// Keep tests independent of the shared lib/ build while agents edit other modules.
const source = await readFile(new URL('../src/planner/model.ts', import.meta.url), 'utf8');
const { outputText } = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } });
const executable = outputText.replaceAll("'@deepseek-ai/dsh-llm'", JSON.stringify(import.meta.resolve('@deepseek-ai/dsh-llm')));
const { ToolCallingPlannerModel, createDshPlannerModel, PlannerExecutionError, plannerTools } = await import(`data:text/javascript;base64,${Buffer.from(executable).toString('base64')}`);
let seq = 0;
const call = (name, args) => ({ type: 'tool-call', id: `call-${++seq}`, name, arguments: typeof args === 'string' ? args : JSON.stringify(args) });
const answer = (...content) => createAssistantMessage({ source: { provider: 'test', model: 'planner' }, content });
const done = () => answer({ type: 'text', text: '本轮规划完成' });
const signal = () => new AbortController().signal;
const intent = (id, state = 'running') => ({ id, taskId: 't', summary: id, state, input: {}, createdAt: '', updatedAt: '' });
function context() {
  return { taskId: 't', triggers: [{ kind: 'finding', intentId: 'work', detail: 'new evidence' }], todos: [{ content: 'retain chain', status: 'pending' }], snapshot: {
    version: 1,
    tasks: [{ id: 't', title: 'Authorized fixture', goal: 'Verify fixture', status: 'running' }, { id: 'foreign', title: 'PRIVATE_OTHER_TASK' }],
    goals: [{ id: 'g', taskId: 't', text: 'Verify fixture', state: 'open' }],
    assets: [{ id: 'a', taskId: 't', value: 'https://fixture.invalid' }, { id: 'fa', taskId: 'foreign', value: 'https://shared-asset.invalid' }],
    nodes: [{ id: 'fact', taskId: 't', kind: 'fact', label: 'Observed', data: { confidence: 'observed', evidence: 'fixture trace' } }, { id: 'finding-node', taskId: 't', kind: 'finding', label: 'Finding', data: { status: 'open' } }],
    edges: [], intents: [], findings: [{ id: 'finding', taskId: 't', status: 'verified' }, { id: 'unverified', taskId: 't', status: 'open' }],
    evidence: [{ id: 'e', taskId: 't', summary: 'recorded evidence', raw: { result: 'ok' } }, { id: 'fe', taskId: 'foreign', summary: 'PRIVATE_OTHER_EVIDENCE' }],
    traces: [], constraints: [{ id: 'constraint', taskId: 't', kind: 'deny', text: 'Do not leave fixture scope' }], scopes: [],
    notificationChannels: [{ config: { credential: 'PRIVATE_CHANNEL_SECRET' } }],
  } };
}
function model(responses, options = {}) {
  const requests = [];
  return { requests, model: new ToolCallingPlannerModel(async (request) => {
    requests.push(request);
    const response = responses.shift();
    assert.ok(response, 'unexpected extra model call');
    return typeof response === 'function' ? response(request) : response;
  }, { provider: 'test', model: 'planner', maxTurns: 8, ...options }) };
}
const results = (request) => request.messages.filter((m) => m.role === 'tool').map((m) => ({ isError: m.isError, value: JSON.parse(m.content[0].text) }));

test('ARTEX planning tool loop carries task context, typed lineage and persistent todos', async () => {
  const c = context();
  const { model: m, requests } = model([
    answer(call('TodoWrite', { todos: [{ content: 'Inspect evidence', status: 'completed' }, { content: 'Verify next step', status: 'in_progress' }] }), call('list_facts', {})),
    answer(call('add_intent', { intents: [{ summary: 'Verify fixture next step', asset_ids: ['a'], parent_ids: ['fact'], priority: 8 }] })), done(),
  ]);
  const plan = await m.plan(c, signal());
  assert.deepEqual(plan.intents.map(({ id, ...row }) => row), [{ summary: 'Verify fixture next step', input: { assetIds: ['a'], priority: 8 }, parentIds: ['fact'] }]);
  assert.match(plan.intents[0].id, /^[\da-f-]{36}$/);
  assert.deepEqual(results(requests[2]).at(-1).value.ids, [plan.intents[0].id]);
  assert.equal(plan.todos[1].status, 'in_progress');
  assert.deepEqual(plan.proofs, []);
  assert.equal(requests.length, 3);
  const input = JSON.parse(requests[0].messages[0].content[0].text);
  assert.equal(input.todos[0].content, 'retain chain');
  assert.equal(input.triggers[0].detail, 'new evidence');
  assert.equal(input.constraints[0].text, 'Do not leave fixture scope');
  assert.equal(JSON.stringify(requests).includes('PRIVATE_'), false);
  assert.equal(results(requests[1])[1].value[0].id, 'fact');
  assert.equal(c.todos[0].status, 'pending', 'planning must not mutate persisted context');
});

test('add_intent preserves ordered partial success, supports over-four and repeated calls without summary dedup', async () => {
  const c = context(); c.snapshot.intents.push(intent('already', 'done'));
  const { model: m, requests } = model([
    answer(call('add_intent', { intents: Array.from({ length: 5 }, (_, i) => ({ summary: `new ${i}` })) })),
    answer(call('add_intent', { intents: [{ summary: 'valid' }, { summary: 'invalid', parent_ids: ['g'] }] })),
    answer(call('add_intent', { summary: 'already' })),
    answer(call('add_intent', { summary: 'next', priority: 0 })),
    answer(call('add_intent', { summary: 'second', priority: 12, asset_ids: ['fa'] })), done(),
  ]);
  const plan = await m.plan(c, signal());
  assert.deepEqual(plan.intents.map((row) => row.summary), ['new 0', 'new 1', 'new 2', 'new 3', 'new 4', 'valid', 'already', 'next', 'second']);
  const output = results(requests.at(-1));
  assert.equal(output.every((row) => !row.isError), true, 'batch errors are per-item results');
  assert.deepEqual(output[0].value.ids, plan.intents.slice(0, 5).map((row) => row.id));
  assert.deepEqual(output[1].value.ids, [plan.intents[5].id, 0]);
  assert.deepEqual(Object.keys(output[1].value.errors), ['1']);
  assert.match(output[1].value.errors['1'], /parent_id/);
  assert.equal(output[1].value.staged, true);
  assert.equal(plan.intents[7].input.priority, 5);
  assert.equal(plan.intents[8].input.priority, 12);
  assert.deepEqual(plan.intents[8].input.assetIds, ['fa']);
});

test('prove_goal accepts fact/finding nodes without a verification flag and reason is optional', async () => {
  for (const evidence of ['fact', 'finding-node']) {
    const { model: m } = model([answer(call('prove_goal', { goal_id: 'g', evidence_id: evidence, reason: 'Fixture observation satisfies goal' })), done()]);
    assert.deepEqual((await m.plan(context(), signal())).proofs, [{ goalId: 'g', evidenceIds: [evidence], reason: 'Fixture observation satisfies goal' }]);
  }
  const c = context(); c.snapshot.intents.push(intent('work'));
  const { model: m, requests } = model([answer(call('prove_goal', { goal_id: 'g', evidence_id: 'fe', reason: 'foreign' }), call('prove_goal', { goal_id: 'g', evidence_id: 'e' }), call('prove_goal', { goal_id: 'g', evidence_id: 'finding' }), call('node_detail', { id: 'fe' })), done()]);
  assert.deepEqual((await m.plan(c, signal())).proofs, []);
  assert.equal(results(requests[1]).every((row) => row.isError), true);
  assert.equal(JSON.stringify(requests).includes('PRIVATE_'), false);
  const repeated = model([answer(call('prove_goal', { goal_id: 'g', evidence_id: 'fact' }), call('prove_goal', { goal_id: 'g', evidence_id: 'finding-node', reason: '' }), call('list_goals', {})), done()]);
  c.snapshot.goals[0].state = 'met';
  assert.deepEqual((await repeated.model.plan(c, signal())).proofs, [{ goalId: 'g', evidenceIds: ['fact'], reason: '' }, { goalId: 'g', evidenceIds: ['finding-node'], reason: '' }]);
  assert.equal(results(repeated.requests[1]).at(-1).value[0].state, 'met');
});

test('direct source fact/finding references are read-only and do not expand source-of-source', async () => {
  const c = context();
  c.snapshot.tasks[0].sourceTaskIds = ['source', 'deleted-source'];
  c.snapshot.tasks.push({ id: 'source', sourceTaskIds: ['transitive'] }, { id: 'transitive' });
  c.snapshot.nodes.push({ id: 'source-fact', taskId: 'source', kind: 'fact' }, { id: 'source-finding', taskId: 'source', kind: 'finding' }, { id: 'transitive-fact', taskId: 'transitive', kind: 'fact' }, { id: 'deleted-source-fact', taskId: 'deleted-source', kind: 'fact' });
  c.snapshot.goals.push({ id: 'source-goal', taskId: 'source', state: 'open' });
  const { model: m, requests } = model([
    answer(call('prove_goal', { goal_id: 'source-goal', evidence_id: 'fact' }), call('prove_goal', { goal_id: 'g', evidence_id: 'transitive-fact' }), call('prove_goal', { goal_id: 'g', evidence_id: 'deleted-source-fact' })),
    answer(call('add_intent', { summary: 'Derived from source', parent_ids: ['source-fact', 'source-finding'] }), call('prove_goal', { goal_id: 'g', evidence_id: 'source-finding' }), call('node_detail', { id: 'source-fact' })), done(),
  ]);
  const plan = await m.plan(c, signal());
  assert.deepEqual(plan.intents[0].parentIds, ['source-fact', 'source-finding']);
  assert.deepEqual(plan.proofs, [{ goalId: 'g', evidenceIds: ['source-finding'], reason: '' }]);
  const output = results(requests[2]);
  assert.equal(output.slice(0, 3).every((row) => row.isError), true);
  assert.equal(output.at(-1).value.inherited, true);
  assert.equal(output.at(-1).value.sourceTaskId, 'source');
  assert.equal(c.snapshot.goals[1].state, 'open');
  assert.equal(c.snapshot.nodes.find((row) => row.id === 'source-fact').inherited, undefined);
});

test('empty batch uses the top-level intent and single-item failures are tool errors', async () => {
  const { model: m, requests } = model([
    answer(call('add_intent', { summary: '   ' }), call('add_intent', { summary: 'bad', parent_ids: ['missing'] }), call('add_intent', { summary: 'bad', priority: 1.5 })),
    answer(call('add_intent', { intents: [], summary: ' top-level fallback ' })), done(),
  ]);
  const plan = await m.plan(context(), signal());
  assert.deepEqual(plan.intents.map((row) => row.summary), [' top-level fallback '], 'only blank validation trims; ARTEX stores the original summary');
  assert.deepEqual(results(requests[2]).map((row) => !!row.isError), [true, true, true, false]);
});

test('goal_met stays in the catalog, is unbound by default, and explicit binding completes without changing individual goals', async () => {
  assert.ok(plannerTools.some((tool) => tool.name === 'goal_met'));
  const c = context();
  c.snapshot.intents.push(intent('work'));
  const unbound = model([answer(call('goal_met', { reason: 'completed' })), done()]);
  assert.equal((await unbound.model.plan(c, signal())).goalMet, undefined);
  assert.equal(unbound.requests[0].tools.some((tool) => tool.name === 'goal_met'), false);
  assert.equal(results(unbound.requests[1])[0].isError, true);
  const enabled = model([answer(call('goal_met', { reason: 'All actual outcomes verified' })), done()], { enableGoalMet: true });
  const plan = await enabled.model.plan(context(), signal());
  assert.deepEqual(plan.goalMet, { reason: 'All actual outcomes verified' });
  assert.deepEqual(plan.proofs, []);
  assert.equal(enabled.requests[0].tools.some((tool) => tool.name === 'goal_met'), true);
});

test('FINAL invokes the model once and permits unproven goals with no follow-up scheduling', async () => {
  const { model: m, requests } = model([done()], { final: true });
  const plan = await m.plan(context(), signal());
  assert.deepEqual(plan, { intents: [], proofs: [], steers: [], kills: [] });
  assert.equal(requests.length, 1);
  assert.match(requests[0].system, /任务终局 FINAL 判定/);
  assert.match(requests[0].system, /证据不足的目标保留未达成/);
  const names = requests[0].tools.map((tool) => tool.name);
  assert.ok(names.includes('prove_goal'));
  assert.ok(names.includes('goal_met'));
  assert.ok(names.includes('get_worker_output'));
  for (const name of ['add_intent', 'steer_work', 'kill_work', 'TodoWrite']) assert.equal(names.includes(name), false);
});

test('FINAL rejects scheduling/control tools even if the model calls them, and still accepts final proofs', async () => {
  const c = context(); c.snapshot.intents.push(intent('work'));
  const { model: m, requests } = model([
    answer(call('add_intent', { summary: 'must not schedule' }), call('steer_work', { intent_id: 'work', message: 'must not steer' }), call('kill_work', { intent_id: 'work', reason: 'must not kill' }), call('TodoWrite', { todos: [] })),
    answer(call('prove_goal', { goal_id: 'g', evidence_id: 'fact', reason: 'Final observed result proves goal' })), done(),
  ], { final: true });
  const plan = await m.plan(c, signal());
  assert.deepEqual(plan.intents, []);
  assert.deepEqual(plan.steers, []);
  assert.deepEqual(plan.kills, []);
  assert.equal(plan.todos, undefined);
  assert.deepEqual(plan.proofs, [{ goalId: 'g', evidenceIds: ['fact'], reason: 'Final observed result proves goal' }]);
  for (const result of results(requests[1])) {
    assert.equal(result.isError, true);
    assert.match(result.value.error, /工具未绑定/);
  }
});

test('FINAL binds goal_met through the native DSH completion seam even when ordinary binding is disabled', async () => {
  const requests = [];
  const llm = { async *stream(request) {
    requests.push(request);
    if (requests.length === 1) {
      yield { type: 'tool-call-delta', index: 0, id: 'final-goal-met', name: 'goal_met', argumentsDelta: '{"reason":"All outcomes verified after drain"}' };
      yield { type: 'finish', reason: { kind: 'tool-calls' } };
    } else {
      yield { type: 'finish', reason: { kind: 'stop' } };
    }
  } };
  const final = createDshPlannerModel(llm, { provider: 'test', model: 'planner', final: true, enableGoalMet: false });
  const plan = await final.plan(context(), signal());
  assert.deepEqual(plan.goalMet, { reason: 'All outcomes verified after drain' });
  assert.deepEqual(plan.proofs, []);
  assert.equal(requests.length, 2);
  assert.equal(requests[0].tools.some((tool) => tool.name === 'goal_met'), true);
  assert.equal(results(requests[1])[0].isError, false);
});

test('running worker steering and kill are staged, with kill removing earlier steering', async () => {
  const c = context(); c.snapshot.intents.push(intent('w1'), intent('w2'), intent('old', 'done'));
  const { model: m, requests } = model([
    answer(call('get_worker_output', { intent_id: 'w1' }), call('steer_work', { intent_id: 'w1', message: 'Use existing facts' }), call('kill_work', { intent_id: 'w2', reason: 'Direction exhausted' }), call('kill_work', { intent_id: 'old' })), done(),
  ]);
  const plan = await m.plan(c, signal());
  assert.deepEqual(plan.steers, [{ intentId: 'w1', message: 'Use existing facts' }]);
  assert.deepEqual(plan.kills, [{ intentId: 'w2', reason: 'Direction exhausted' }]);
  assert.equal(results(requests[1]).at(-1).isError, true);
  assert.equal(c.snapshot.intents[1].state, 'running');
  const second = model([answer(call('steer_work', { intent_id: 'w1', message: 'focus' }), call('kill_work', { intent_id: 'w1' })), done()]);
  assert.deepEqual((await second.model.plan(c, signal())).steers, []);
});

test('empty idle plan is challenged; no fixed plan synthesized; bounded failure when model ignores protocol', async () => {
  const { model: m, requests } = model([done(), answer(call('add_intent', { summary: 'Model-chosen next direction' })), done()]);
  assert.equal((await m.plan(context(), signal())).intents[0].summary, 'Model-chosen next direction');
  assert.match(requests[1].messages.at(-1).content[0].text, /不能停摆/);
  const failing = model([done(), done()], { maxTurns: 2 });
  await assert.rejects(failing.model.plan(context(), signal()), /exceeded 2/);
  const c = context(); c.snapshot.goals = []; c.snapshot.tasks[0].goal = '';
  assert.deepEqual((await model([done()]).model.plan(c, signal())).intents, []);
});

test('bad JSON, unknown tools and malformed todos are tool errors that the model may correct', async () => {
  const c = context(); c.snapshot.intents.push(intent('work'));
  const { model: m, requests } = model([answer(call('TodoWrite', '{'), call('goal_met', { reason: 'shortcut' }), call('TodoWrite', { todos: [{ content: 'bad', status: 'bogus' }] })), answer(call('TodoWrite', { todos: [] })), done()]);
  assert.deepEqual((await m.plan(c, signal())).todos, []);
  assert.equal(results(requests[1]).every((row) => row.isError), true);
});

test('cancellation does not expose partial plans; model failure preserves already successful tool effects', async () => {
  const controller = new AbortController();
  const c = context();
  let requests = 0;
  const m = new ToolCallingPlannerModel(async (request) => {
    requests++;
    assert.equal(request.signal, controller.signal);
    controller.abort(new Error('paused'));
    return answer(call('add_intent', { summary: 'Must not commit' }));
  }, { provider: 'test', model: 'planner' });
  await assert.rejects(m.plan(c, controller.signal), /paused/);
  await assert.rejects(m.plan(c, controller.signal), /paused/);
  assert.equal(requests, 1);
  const error = new Error('provider disconnected');
  await assert.rejects(model([answer(call('add_intent', { summary: 'already accepted' })), () => { throw error; }]).model.plan(c, signal()), (actual) => {
    assert.ok(actual instanceof PlannerExecutionError);
    assert.equal(actual.cause, error);
    assert.equal(actual.partialPlan.intents[0].summary, 'already accepted');
    return true;
  });
  const cancelAfterTool = new AbortController();
  const cancel = model([answer(call('add_intent', { summary: 'accepted then paused' })), () => { cancelAfterTool.abort(new Error('task paused')); throw error; }]);
  await assert.rejects(cancel.model.plan(c, cancelAfterTool.signal), (actual) => actual.message === 'task paused' && !(actual instanceof PlannerExecutionError));
});

test('DSH stream adapter assembles native tool calls and preserves reasoning replay', async () => {
  const requests = [];
  const llm = { async *stream(request) {
    requests.push(request);
    if (requests.length === 1) {
      yield { type: 'tool-call-delta', index: 0, id: 'stream-call', name: 'add_intent', argumentsDelta: '{"summary":' };
      yield { type: 'tool-call-delta', index: 0, id: 'stream-call', argumentsDelta: '"Native streamed plan"}' };
      yield { type: 'finish', reason: { kind: 'tool-calls' }, replayState: { response: { reasoningSignature: 'opaque' } } };
    } else {
      yield { type: 'text-delta', index: 0, text: 'done' };
      yield { type: 'finish', reason: { kind: 'stop' } };
    }
  } };
  const m = createDshPlannerModel(llm, { provider: 'test', model: 'planner' });
  assert.equal((await m.plan(context(), signal())).intents[0].summary, 'Native streamed plan');
  assert.equal(requests[1].messages.find((m) => m.role === 'assistant').source.replayState.response.reasoningSignature, 'opaque');
});

test('DSH adapter rejects truncated, error, aborted and unterminated streams', async () => {
  for (const kind of ['max-tokens', 'error', 'aborted', 'missing']) {
    const failure = { message: 'provider failure', code: 'fixture' };
    const llm = { async *stream() { yield { type: 'text-delta', index: 0, text: 'partial' }; if (kind !== 'missing') yield { type: 'finish', reason: { kind, failure } }; } };
    await assert.rejects(createDshPlannerModel(llm, { provider: 'test', model: 'planner' }).plan(context(), signal()), (error) => {
      if (kind === 'error' || kind === 'aborted') assert.deepEqual(error.cause.failure, failure);
      return true;
    });
  }
});
