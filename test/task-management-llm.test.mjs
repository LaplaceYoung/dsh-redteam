import { test } from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';

const built = await build({ entryPoints: ['src/task-management/llm-chain.ts'], bundle: true, platform: 'node', format: 'esm', write: false });
const {
  emptyTaskLLMChain, replaceTaskLLMProfiles, markTaskLLMProfileQuotaExhausted,
  taskLLMChainView, resolveTaskRoleLLM, isQuotaExhaustedMessage, taskLLMReplayDecision,
} = await import(`data:text/javascript;base64,${Buffer.from(built.outputFiles[0].contents).toString('base64')}`);
const registry = new Set(['a', 'b', 'c']);
const now = new Date('2026-10-18T00:00:00Z');
const chain = (ids = ['a', 'b', 'c'], active = null) => replaceTaskLLMProfiles(emptyTaskLLMChain(), ids, registry, active);
const exhaust = (state, id, revision = state.revision, reason = '余额不足') => markTaskLLMProfileQuotaExhausted(state, id, reason, now, revision);

test('replace preserves order, selects requested cursor, resets exhaustion, and clears to fallback', () => {
  const original = chain(['c', 'a', 'b'], 'a');
  assert.deepEqual(original.profiles.map(p => [p.profileId, p.position]), [['c', 0], ['a', 1], ['b', 2]]);
  const failed = exhaust(original, 'a').state;
  const reset = replaceTaskLLMProfiles(failed, ['c', 'a', 'b'], registry);
  assert.equal(reset.activeProfileId, 'c');
  assert.equal(reset.legacyProfileId, 'c');
  assert.equal(reset.revision, 3);
  assert.ok(reset.profiles.every(p => p.status === 'ready' && p.exhaustedAt === null && p.lastError === ''));
  assert.equal(original.profiles[1].status, 'ready');
  const cleared = replaceTaskLLMProfiles(reset, [], registry, 'a');
  assert.deepEqual(cleared, { profiles: [], activeProfileId: null, legacyProfileId: null, revision: 4 });
  assert.equal(taskLLMChainView(cleared).failoverState, 'default');
});

test('invalid replacement throws without changing existing state', () => {
  const state = chain();
  const before = structuredClone(state);
  for (const ids of [['a', 'a'], [''], ['missing']]) assert.throws(() => replaceTaskLLMProfiles(state, ids, registry));
  assert.throws(() => replaceTaskLLMProfiles(state, ['a'], registry, 'c'), /not in the task chain/);
  assert.deepEqual(state, before);
});

test('quota failure advances once; concurrent older revision cannot skip next profile', () => {
  const selected = chain();
  const first = exhaust(selected, 'a');
  assert.deepEqual(first.transition, { previousProfileId: 'a', nextProfileId: 'b', chainExhausted: false, advanced: true, stale: false });
  assert.equal(first.state.revision, selected.revision + 1);
  const late = exhaust(first.state, 'a', selected.revision);
  assert.equal(late.transition.stale, true);
  assert.equal(late.transition.advanced, false);
  assert.strictEqual(late.state, first.state);
  assert.equal(late.state.activeProfileId, 'b');
});

test('replacement rejects in-flight errors even if same profile still appears in new chain', () => {
  const selected = chain();
  const replaced = replaceTaskLLMProfiles(selected, ['a', 'c'], registry);
  const result = exhaust(replaced, 'a', selected.revision);
  assert.strictEqual(result.state, replaced);
  assert.equal(result.transition.stale, true);
  assert.ok(result.state.profiles.every(p => p.status === 'ready'));
  assert.deepEqual(taskLLMReplayDecision(result.transition, false), { replay: true, emitTransition: false });
});

test('legacy late error marks old entry without advancing active cursor; first error is retained', () => {
  const selected = chain(['a', 'b', 'c'], 'b');
  const first = markTaskLLMProfileQuotaExhausted(selected, 'a', ' original error ', now);
  assert.equal(first.state.activeProfileId, 'b');
  assert.equal(first.state.revision, selected.revision);
  assert.equal(first.transition.advanced, false);
  assert.equal(first.transition.nextProfileId, 'b');
  const late = markTaskLLMProfileQuotaExhausted(first.state, 'a', 'new error', new Date('2026-10-19'));
  assert.equal(late.state.profiles[0].lastError, 'original error');
  assert.equal(late.state.profiles[0].exhaustedAt, now.toISOString());
});

test('manual middle start exhausts only forward and never resurrects earlier ready profile', () => {
  let state = chain(['a', 'b', 'c'], 'b');
  state = exhaust(state, 'b').state;
  const last = exhaust(state, 'c');
  assert.equal(last.transition.chainExhausted, true);
  assert.equal(last.state.activeProfileId, null);
  assert.equal(last.state.legacyProfileId, null);
  assert.equal(last.state.profiles[0].status, 'ready');
  assert.equal(taskLLMChainView(last.state).failoverState, 'chain_exhausted');
  const late = exhaust(last.state, 'a');
  assert.strictEqual(late.state, last.state);
  assert.equal(late.transition.advanced, false);
  assert.equal(late.transition.chainExhausted, true);
  assert.deepEqual(taskLLMReplayDecision(last.transition, false), { replay: false, emitTransition: true });
});

test('quota reason is UTF-8 bounded, and latest exhausted entry supplies the displayed reason', () => {
  const first = exhaust(chain(), 'a', 1, ' ' + '中'.repeat(400) + ' ').state;
  assert.equal(Buffer.byteLength(first.profiles[0].lastError), 999);
  assert.equal(first.profiles[0].lastError.includes('\uFFFD'), false);
  const second = markTaskLLMProfileQuotaExhausted(first, 'b', 'second', new Date('2026-10-18T01:00:00Z'), first.revision).state;
  assert.equal(taskLLMChainView(second).failoverReason, 'second');
  const absent = exhaust(second, 'removed');
  assert.strictEqual(absent.state, second);
  assert.equal(absent.transition.advanced, false);
});

const profile = (id, available = true) => ({ id, name: id, format: 'openai', model: `model-${id}`, available, ...(available ? {} : { reason: 'LLM 配置未设置 API Key' }) });
function inputs(state) {
  return { state, agentBinding: profile('bound'), profiles: new Map([['a', profile('a')]]), globalProfile: profile('global'), environment: { name: '', model: 'env-model', format: 'openai' } };
}
test('resolution honors available agent binding before task chain; binding does not mutate task failover', () => {
  const input = inputs(chain());
  const bound = resolveTaskRoleLLM(input);
  assert.equal(bound.source, 'agent_binding');
  assert.equal(bound.failoverProfileId, null);
  assert.equal(bound.revision, input.state.revision);
  const task = resolveTaskRoleLLM({ ...input, agentBinding: profile('bound', false) });
  assert.equal(task.source, 'task_chain');
  assert.equal(task.failoverProfileId, 'a');
});

test('nonempty exhausted or invalid task chain blocks global fallback; available binding still wins', () => {
  const exhausted = exhaust(chain(['a']), 'a').state;
  const input = inputs(exhausted);
  assert.equal(resolveTaskRoleLLM(input).source, 'agent_binding');
  const unavailable = resolveTaskRoleLLM({ ...input, agentBinding: null });
  assert.equal(unavailable.available, false);
  assert.equal(unavailable.source, 'task_chain');
  assert.match(unavailable.reason, /耗尽/);
  const missing = resolveTaskRoleLLM({ ...inputs(chain(['b'])), agentBinding: null });
  assert.equal(missing.source, 'task_chain');
  assert.equal(missing.available, false);
  assert.equal(missing.reason, 'LLM 配置不存在');
});

test('empty chain resolves global profile then environment then unavailable global', () => {
  const input = { ...inputs(emptyTaskLLMChain()), agentBinding: null };
  assert.equal(resolveTaskRoleLLM(input).source, 'global_profile');
  const environment = resolveTaskRoleLLM({ ...input, globalProfile: profile('global', false) });
  assert.equal(environment.source, 'environment');
  assert.equal(environment.name, '全局配置');
  assert.equal(environment.failoverProfileId, null);
  const unavailable = resolveTaskRoleLLM({ ...input, globalProfile: null, environment: null });
  assert.equal(unavailable.source, 'global');
  assert.equal(unavailable.available, false);
});

test('quota classifier preserves ARTEX distinction between account exhaustion and transient or auth failures', () => {
  for (const message of ['code=insufficient_quota status=429', 'quota_exceeded', 'grpc code=RESOURCE_EXHAUSTED', 'billing_not_active', 'HTTP status 402 Payment Required', '账户余额不足，请充值', 'credit balance is too low']) {
    assert.equal(isQuotaExhaustedMessage(message), true, message);
  }
  for (const message of ['', 'status 429: rate limit exceeded', 'RESOURCE_EXHAUSTED: TPM quota exceeded', 'quota exceeded for quota metric GenerateRequestsPerMinutePerProjectPerBaseModel', 'HTTP status 401: insufficient_quota', 'status code=403 billing_hard_limit_reached', 'HTTP 503 quota_exceeded', 'context length exceeded', 'dial tcp: network is unreachable']) {
    assert.equal(isQuotaExhaustedMessage(message), false, message);
  }
});

test('failover replays only before output commitment and emits only persisted advances', () => {
  const { transition } = exhaust(chain(), 'a');
  assert.deepEqual(taskLLMReplayDecision(transition, false), { replay: true, emitTransition: true });
  assert.deepEqual(taskLLMReplayDecision(transition, true), { replay: false, emitTransition: true });
  assert.deepEqual(taskLLMReplayDecision({ ...transition, advanced: false, stale: true }, true), { replay: false, emitTransition: false });
});
