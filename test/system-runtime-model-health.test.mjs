import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { build } from 'esbuild';
import { Context } from '@deepseek-ai/cordis';
import LlmRuntime, { LlmAdapter, LlmError, attributionHeaders } from '@deepseek-ai/dsh-llm';

const built = await build({ entryPoints: ['src/system-runtime/model-health.ts'], bundle: true, platform: 'node', format: 'esm', write: false, packages: 'external' });
const code = built.outputFiles[0].text.replace(/from\s+(["'])(@[^"']+)\1/g, (_m, _q, specifier) => `from ${JSON.stringify(import.meta.resolve(specifier))}`);
const { ModelHealthRuntime, classifyModelFailure } = await import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`);
const collect = async iterable => { const chunks = []; for await (const chunk of iterable) chunks.push(chunk); return chunks; };
const stop = { type: 'finish', reason: { kind: 'stop' } };
const text = { type: 'text-delta', index: 0, text: 'OK' };
const fail = (status, code = 'HTTP_ERROR', extra = {}) => ({ type: 'finish', reason: { kind: 'error', failure: { status, code, message: 'private server body secret-key', ...extra } } });
const request = (model = 'a', extra = {}) => ({ provider: 'fixture', model, messages: [{ role: 'user', content: [{ type: 'text', text: 'hello' }] }], ...extra });
const selection = (profileId = 'a', extra = {}) => ({ profileId, enabled: true, bindFallback: false, ...extra });
async function fixture(t, stream, profiles = ['a', 'b', 'c']) {
  const dir = await mkdtemp(join(tmpdir(), 'model-health-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  let now = 1_000_000;
  const sleeps = [], source = { list: async () => ({ profiles: profiles.map(id => ({ id, name: `Profile ${id}`, provider: 'fixture', model: id })), activeProfileId: 'a' }) };
  const options = { storagePath: join(dir, 'health.json'), profiles: source, stream, now: () => now, sleep: async (ms, signal) => { signal?.throwIfAborted(); sleeps.push(ms); await new Promise(resolve => setImmediate(resolve)); now += ms; } };
  const runtime = await ModelHealthRuntime.open(options);
  return { runtime, options, sleeps, advance: ms => { now += ms; }, now: () => now };
}
async function noRetries(runtime) {
  const policy = runtime.retryPolicy();
  for (const key of ['connect', 'empty', 'stream']) policy[key].attempts = -1;
  await runtime.setRetryPolicy(policy);
}

test('hard failure immediately trips profile, safe-window failover succeeds, reload preserves cooldown and reset clears it', async t => {
  const calls = [];
  const f = await fixture(t, async function* (options) { calls.push(options.model); yield* options.model === 'a' ? [fail(401)] : [text, stop]; });
  assert.deepEqual(await collect(f.runtime.stream(request(), selection())), [text, stop]);
  assert.deepEqual(calls, ['a', 'b']);
  assert.equal(f.runtime.health('a').trips, 1);
  assert.equal(f.runtime.health('a').openUntil, f.now() + 60_000);
  const disk = await readFile(f.options.storagePath, 'utf8');
  assert.ok(!disk.includes('secret-key'));
  const restoredPath = `${f.options.storagePath}.restored`;
  await writeFile(restoredPath, disk);
  const reloaded = await ModelHealthRuntime.open({ ...f.options, storagePath: restoredPath });
  assert.equal(reloaded.health('a').trips, 1);
  await collect(reloaded.stream(request(), selection()));
  assert.equal(calls.at(-1), 'b');
  await reloaded.reset('a');
  assert.equal(reloaded.health('a').openUntil, 0);
});

test('scoped runtimes at the same canonical path share limits, health and policy without retaining another scope stream', async t => {
  const dispatchTimes = [], owners = [];
  const f = await fixture(t, async function* () { dispatchTimes.push(f.now()); owners.push('first'); yield text; yield stop; }, ['a']);
  const second = await ModelHealthRuntime.open({ ...f.options, storagePath: join(f.options.storagePath, '..', 'health.json'), stream: async function* () { dispatchTimes.push(f.now()); owners.push('second'); yield text; yield stop; } });
  const policy = f.runtime.profilePolicy('a'); policy.ratePerSecond = 1;
  await f.runtime.setProfilePolicy('a', policy);
  assert.equal(second.profilePolicy('a').ratePerSecond, 1);
  await Promise.all([collect(f.runtime.stream(request(), selection())), collect(second.stream(request(), selection()))]);
  assert.deepEqual(owners, ['first', 'second']);
  assert.ok(dispatchTimes[1] - dispatchTimes[0] >= 1000);
  await second.recordFailure('a', { code: 'AUTH', status: 401, message: 'revoked' }, false);
  assert.equal(f.runtime.health('a').trips, 1);
  await f.runtime.reset('a');
  assert.equal(second.health('a').trips, 0);
});

test('transient breaker threshold and escalating cooldown match ARTEX; success clears all history', async t => {
  let broken = true;
  const f = await fixture(t, async function* () { yield* broken ? [fail(503)] : [text, stop]; }, ['a']);
  await noRetries(f.runtime);
  for (let i = 0; i < 2; i++) await collect(f.runtime.stream(request(), selection()));
  assert.equal(f.runtime.health('a').fails, 2);
  assert.equal(f.runtime.health('a').trips, 0);
  await collect(f.runtime.stream(request(), selection()));
  assert.equal(f.runtime.health('a').openUntil - f.now(), 60_000);
  f.advance(60_000);
  for (let i = 0; i < 3; i++) await collect(f.runtime.stream(request(), selection()));
  assert.equal(f.runtime.health('a').openUntil - f.now(), 300_000);
  broken = false; f.advance(300_000);
  await collect(f.runtime.stream(request(), selection()));
  assert.equal(f.runtime.health('a').trips, 0);
});

test('bound profile remains exclusive unless fallback enabled, excluded backup is not selected', async t => {
  const calls = [];
  const f = await fixture(t, async function* (o) { calls.push(o.model); yield* o.model === 'a' ? [fail(402, 'QUOTA')] : [text, stop]; });
  const policy = f.runtime.profilePolicy('b'); policy.excluded = true;
  await f.runtime.setProfilePolicy('b', policy);
  const failed = await collect(f.runtime.stream(request(), selection('a', { bound: true })));
  assert.equal(failed.at(-1).reason.failure.code, 'QUOTA');
  assert.deepEqual(calls, ['a']);
  await f.runtime.reset();
  await collect(f.runtime.stream(request(), selection('a', { bound: true, bindFallback: true })));
  assert.deepEqual(calls, ['a', 'a', 'c']);
});

test('no failover or replay after first chunk; malformed request and cancellation do not trip', async t => {
  const calls = [];
  let chunks = [text, fail(503)];
  const f = await fixture(t, async function* (o) { calls.push(o.model); yield* chunks; });
  assert.deepEqual(await collect(f.runtime.stream(request(), selection())), chunks);
  assert.deepEqual(calls, ['a']);
  chunks = [fail(400)]; await collect(f.runtime.stream(request(), selection()));
  chunks = [{ type: 'finish', reason: { kind: 'aborted', failure: { code: 'ABORTED', message: 'cancelled' } } }];
  await collect(f.runtime.stream(request(), selection()));
  assert.equal(f.runtime.health('a').fails, 0);
  assert.deepEqual(calls, ['a', 'a', 'a']);
  const controller = new AbortController(); controller.abort();
  assert.equal(classifyModelFailure({ status: 503, code: 'HTTP_ERROR', message: 'failure' }, controller.signal), 'none');
});

test('shared per-profile rate limiter limits concurrent dispatch and honors provider retry-after', async t => {
  const dispatchTimes = [];
  const f = await fixture(t, async function* () { dispatchTimes.push(f.now()); yield text; yield stop; }, ['a']);
  const policy = f.runtime.profilePolicy('a'); policy.ratePerSecond = 1;
  await f.runtime.setProfilePolicy('a', policy);
  await Promise.all([1, 2, 3].map(() => collect(f.runtime.stream(request(), selection()))));
  assert.ok(dispatchTimes[1] - dispatchTimes[0] >= 1000);
  assert.ok(dispatchTimes[2] - dispatchTimes[1] >= 1000);
  assert.equal(f.sleeps.reduce((a, b) => a + b, 0), 2000);
  let attempts = 0;
  const g = await fixture(t, async function* () { yield* attempts++ === 0 ? [fail(429, 'RATE_LIMIT', { providerRetryAfterMs: 2500 })] : [text, stop]; }, ['a']);
  await collect(g.runtime.stream(request(), selection()));
  assert.equal(g.sleeps.reduce((a, b) => a + b, 0), 2500);
  assert.equal(g.runtime.health('a').trips, 0);
});

test('priority groups rotate, undersized windows are skipped, all-open chain probes head', async t => {
  const calls = [];
  const f = await fixture(t, async function* (o) { calls.push(o.model); yield* o.model === 'a' ? [fail(401)] : [text, stop]; });
  await collect(f.runtime.stream(request(), selection()));
  await collect(f.runtime.stream(request(), selection()));
  assert.deepEqual(calls, ['a', 'b', 'c']);
  const small = f.runtime.profilePolicy('b'); small.windowTokens = 1;
  await f.runtime.setProfilePolicy('b', small);
  await collect(f.runtime.stream(request(), selection()));
  assert.equal(calls.at(-1), 'c');
  const all = await fixture(t, async function* (o) { calls.push(o.model); yield fail(401); });
  await collect(all.runtime.stream(request(), selection()));
  calls.length = 0;
  await collect(all.runtime.stream(request(), selection()));
  assert.deepEqual(calls, ['a']);
});

test('retry overrides inherit each field, negative breaker leaves transient errors degraded; middleware errors propagate', async t => {
  const f = await fixture(t, async function* () { yield fail(503); }, ['a']);
  const global = f.runtime.retryPolicy(); global.connect = { attempts: 1, interval_ms: 150 }; global.breaker.attempts = -1;
  await f.runtime.setRetryPolicy(global);
  const profile = f.runtime.profilePolicy('a'); profile.retry.connect.interval_ms = 80;
  await f.runtime.setProfilePolicy('a', profile);
  assert.deepEqual(f.runtime.resolvedRetry('a').connect, { attempts: 1, interval_ms: 80 });
  for (let i = 0; i < 4; i++) await collect(f.runtime.stream(request(), selection()));
  assert.equal(f.runtime.health('a').fails, 4);
  assert.equal(f.runtime.health('a').trips, 0);
  assert.deepEqual(f.sleeps, [80, 80, 80, 80]);
  await assert.rejects(collect(f.runtime.stream(request(), selection(), async function* () { throw new Error('middleware bug'); })), /middleware bug/);
  await assert.rejects(f.runtime.setProfilePolicy('unknown', profile), /not found/);
  global.connect.attempts = 21;
  await assert.rejects(f.runtime.setRetryPolicy(global), /attempts/);
});

test('real DSH adapter and local HTTP fixture exercise connectivity failure, recovery, and frozen waterfall dispatch', async t => {
  let status = 401, hits = 0;
  const server = createServer(async (req, res) => {
    hits++; assert.equal(req.url, '/chat/completions');
    let body = ''; for await (const part of req) body += part;
    const input = JSON.parse(body); assert.equal(input.model, 'a');
    res.writeHead(status, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(status === 200 ? { text: 'OK' } : { error: 'invalid key' }));
  });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  t.after(() => new Promise(resolve => server.close(resolve)));
  const endpoint = `http://127.0.0.1:${server.address().port}`;
  class FixtureAdapter extends LlmAdapter {
    async *stream(options) {
      const response = await fetch(`${endpoint}/chat/completions`, { method: 'POST', headers: { ...attributionHeaders(), 'Content-Type': 'application/json' }, body: JSON.stringify({ model: options.model, messages: options.messages }), signal: options.signal });
      if (!response.ok) throw new LlmError('fixture rejected credentials', 'AUTH', { status: response.status });
      const result = await response.json(); yield { type: 'text-delta', index: 0, text: result.text }; yield stop;
    }
  }
  const app = new Context(), fibers = [];
  fibers.push(await app.plugin(LlmRuntime));
  fibers.push(await app.plugin(ctx => { ctx.inject(['llm'], inner => { inner.llm.registerAdapter(['fixture'], new FixtureAdapter()); }); }));
  t.after(async () => { for (const fiber of fibers.reverse()) await fiber.dispose(); });
  const llm = app.get('llm'), f = await fixture(t, options => llm.stream(options), ['a']);
  const failed = await f.runtime.probe('a');
  assert.equal(failed.ok, false); assert.equal(failed.failure.status, 401); assert.equal(hits, 1);
  status = 200;
  assert.equal((await f.runtime.probe('a')).ok, true); assert.equal(f.runtime.health('a').trips, 0); assert.equal(hits, 2);
  const remove = app.on('llm/stream', (options, next) => f.runtime.decorateStream(options, 'a', next));
  t.after(remove);
  const frozen = Object.freeze(request('a', { maxTokens: 8 }));
  assert.deepEqual(await collect(llm.stream(frozen)), [text, stop]);
  assert.equal(hits, 3);
});

test('probe refuses empty or truncated success and does not turn catalog existence into connectivity', async t => {
  let chunks = [stop];
  const f = await fixture(t, async function* () { yield* chunks; }, ['a']);
  assert.equal((await f.runtime.probe('a')).failure.code, 'EMPTY_RESPONSE');
  chunks = [text];
  assert.equal((await f.runtime.probe('a')).failure.code, 'STREAM_INTERRUPTED');
  chunks = [text, { type: 'block-end', index: 0, block: { type: 'text', text: 'OK' } }, stop];
  assert.equal((await f.runtime.probe('a')).response, 'OK');
});
