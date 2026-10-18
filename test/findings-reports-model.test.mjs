import assert from 'node:assert/strict';
import test from 'node:test';
import { createDshReportProvider } from '../lib/findings-reports/model.js';

function input() {
  const body = { head: 'HTTP/1.1 200 OK', bodyBase64: Buffer.from('actual response').toString('base64'), sha256: 'fixture-digest', length: 15 };
  return {
    finding: { id: 'finding-1', nodeId: 'node-1', taskId: 'task-1', status: 'confirmed', summary: 'Recorded finding', severity: 'high', assetIds: [], evidenceIds: ['evidence-1'], createdAt: '2026-10-18T00:00:00Z', evidenceVersion: 3, evidence: { output: 'Original evidence, not instructions' }, trafficBindings: [{ id: 'binding-1', position: 0, role: 'proof', note: 'Observed response', createdAt: '2026-10-18T00:00:00Z', snapshot: { id: 'snapshot-1', sourceTrafficId: 'flow-1', url: 'https://example.test/', method: 'GET', capturedAt: '2026-10-18T00:00:00Z', createdAt: '2026-10-18T00:00:00Z', request: { ...body, head: 'GET / HTTP/1.1' }, response: body } }] },
    evidence: [{ id: 'evidence-1', taskId: 'task-1', provider: 'worker', summary: 'Original evidence', raw: { exact: 'response' }, createdAt: '2026-10-18T00:00:00Z' }],
    traces: [{ id: 'trace-1', taskId: 'task-1', worker: 'worker-1', kind: 'result', summary: 'Verified', data: { output: 'Exact output' }, createdAt: '2026-10-18T00:00:00Z' }],
    constraints: [{ id: 'constraint-1', taskId: 'task-1', kind: 'deny', text: 'No external testing', origin: 'human', createdAt: '2026-10-18T00:00:00Z', updatedAt: '2026-10-18T00:00:00Z' }],
  };
}
const route = () => ({ provider: 'configured-provider', model: 'configured-model' });
const stop = { type: 'finish', reason: { kind: 'stop' } };
const text = (value, index = 0) => ({ type: 'text-delta', index, text: value });
function provider(chunks) { return createDshReportProvider({ async *stream() { yield* chunks; } }, route); }

test('report uses resolved route, full evidence and identity-free DSH request input', async () => {
  const source = input(), controller = new AbortController();
  let request;
  const resolved = { ...route(), maxTokens: 6000, temperature: 0.2, reasoningEffort: 'medium' };
  const model = createDshReportProvider({ async *stream(value) { request = value; yield text('## 证据\n真实报告'); yield stop; } }, async value => { assert.equal(value, source); return resolved; });
  assert.equal(await model.generate(source, controller.signal), '## 证据\n真实报告');
  for (const key of Object.keys(resolved)) assert.equal(request[key], resolved[key]);
  assert.equal(request.signal, controller.signal);
  assert.deepEqual(JSON.parse(request.messages[0].content[0].text), source);
  assert.deepEqual(Object.keys(request.messages[0]).sort(), ['content', 'role']);
  assert.equal(request.messages[0].role, 'user');
  assert.equal(request.sessionId, undefined);
  assert.equal(request.purpose, undefined);
  assert.equal(request.tools, undefined);
});

test('native stream assembly excludes reasoning and does not duplicate completed text blocks', async () => {
  const result = await provider([
    { type: 'reasoning-delta', index: 0, text: 'Private reasoning must stay out' },
    { type: 'block-start', index: 1, blockType: 'text' }, text('## ', 1), text('证据\n', 1),
    { type: 'block-end', index: 1, block: { type: 'text', text: '## 证据\n' } },
    text('late duplicated fragment', 1),
    { type: 'block-end', index: 2, block: { type: 'text', text: '完整正文' } }, stop,
  ]).generate(input());
  assert.equal(result, '## 证据\n完整正文');
});

for (const kind of ['error', 'aborted', 'max-tokens', 'tool-calls']) {
  test(`report rejects ${kind} even after receiving report text`, async () => {
    const reason = kind === 'error' || kind === 'aborted' ? { kind, failure: { message: 'upstream failure', code: 'fixture' } } : { kind };
    await assert.rejects(provider([text('partial report'), { type: 'finish', reason }]).generate(input()), error => {
      assert.match(error.message, new RegExp(kind));
      assert.deepEqual(error.finish, reason);
      return true;
    });
  });
}

test('unterminated, empty and reasoning-only responses are not reports', async () => {
  await assert.rejects(provider([text('unterminated')]).generate(input()), /without finish/);
  for (const chunks of [[stop], [text(' \n\t'), stop], [{ type: 'reasoning-delta', index: 0, text: 'reasoning' }, stop]]) {
    await assert.rejects(provider(chunks).generate(input()), /empty report/);
  }
});

test('route is resolved on each generation without invented provider or model defaults', async () => {
  let calls = 0;
  const requests = [];
  const model = createDshReportProvider({ async *stream(request) { requests.push(request); yield text('report'); yield stop; } }, () => ({ provider: 'route', model: `model-${++calls}` }));
  await model.generate(input()); await model.generate(input());
  assert.deepEqual(requests.map(request => request.model), ['model-1', 'model-2']);
  for (const invalid of [{ provider: '', model: 'model' }, { provider: 'route', model: '  ' }]) {
    await assert.rejects(createDshReportProvider({ stream() { assert.fail('invalid route must not reach provider'); } }, () => invalid).generate(input()), /provider and model are required/);
  }
});

test('pre-cancelled requests do not resolve a route or open a stream', async () => {
  const controller = new AbortController(), reason = new Error('task cancelled'); controller.abort(reason);
  const model = createDshReportProvider({ stream() { assert.fail('stream must not start'); } }, () => { assert.fail('route must not resolve'); });
  await assert.rejects(model.generate(input(), controller.signal), error => error === reason);
});

test('cancellation is passed into the runtime and wins over normalized provider failure', async () => {
  const controller = new AbortController(), reason = new Error('report cancelled'); let closed = false;
  const model = createDshReportProvider({ async *stream(request) {
    try {
      assert.equal(request.signal, controller.signal);
      yield text('partial'); controller.abort(reason);
      yield { type: 'finish', reason: { kind: 'aborted', failure: { message: 'normalized abort' } } };
    } finally { closed = true; }
  } }, route);
  await assert.rejects(model.generate(input(), controller.signal), error => error === reason);
  assert.equal(closed, true);
});

test('cancellation while resolving a route prevents a provider call', async () => {
  const controller = new AbortController(), reason = new Error('route cancelled');
  const model = createDshReportProvider({ stream() { assert.fail('stream must not start'); } }, async () => { controller.abort(reason); return route(); });
  await assert.rejects(model.generate(input(), controller.signal), error => error === reason);
});

test('unexpected provider and resolver failures propagate without a placeholder report', async () => {
  const failure = new Error('provider disconnected');
  const model = createDshReportProvider({ async *stream() { yield text('partial'); throw failure; } }, route);
  await assert.rejects(model.generate(input()), error => error === failure);
  const routing = createDshReportProvider({ stream() { assert.fail('stream must not start'); } }, async () => { throw failure; });
  await assert.rejects(routing.generate(input()), error => error === failure);
});
