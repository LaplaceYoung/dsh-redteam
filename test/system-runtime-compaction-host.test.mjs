import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { build } from 'esbuild';
import { Context } from '@deepseek-ai/cordis';
import LlmRuntime, { LlmAdapter, createUserMessage } from '@deepseek-ai/dsh-llm';
import ToolRuntime from '@deepseek-ai/dsh-tools';
import SystemPrompt from '@deepseek-ai/dsh-system-prompt';
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session';
import AgentRegistry from '@deepseek-ai/dsh-agent';
import AgentLoop from '@deepseek-ai/dsh-agent-loop';
import SessionProjections from '@deepseek-ai/dsh-session-projection';
import CompactionEngine from '@deepseek-ai/dsh-compaction';

const bundle = await build({ entryPoints: ['src/system-runtime/compaction-host.ts'], bundle: true, write: false, platform: 'node', format: 'esm', packages: 'external' });
const code = bundle.outputFiles[0].text.replace(/from\s+(["'])([^"']+)\1/g, (_m, _q, specifier) => `from ${JSON.stringify(import.meta.resolve(specifier))}`);
const { installCompactionHost, isNoaRedispatchedRequest } = await import(`data:text/javascript;base64,${Buffer.from(code + '\n//# sourceURL=compaction-host-test.bundle.mjs').toString('base64')}`);
const summary = 'Verified original evidence and exact decisions are preserved in the archive. Continue the remaining user task and consult the original files for details.';
const request = sessionId => ({ provider: 'fixture', model: 'fixture', sessionId, messages: Array.from({ length: 12 }, (_, i) => ({ role: 'user', content: [{ type: 'text', text: `message-${i}: ${'evidence '.repeat(1000)}` }] })) });
const refs = request => request.messages.map(m => m.content.find(c => c.type === 'text' && c.text.startsWith('<noa-ref'))?.text.match(/id="([^"]+)"/)?.[1]);
class Adapter extends LlmAdapter {
  requests = [];
  behavior;
  async *stream(request) { this.requests.push(request); if (this.behavior) { yield* this.behavior(request); return; } yield { type: 'text-delta', index: 0, text: 'fixture complete' }; yield { type: 'finish', reason: { kind: 'stop' } }; }
}
class BuiltIn extends CompactionEngine {
  automaticCalls = 0;
  async compactIfNeeded() { this.automaticCalls++; return null; }
  async compactNow() { return null; }
  async compactRegion() { throw new Error('fixture region reached'); }
}
async function fixture(t, options = {}) {
  const root = await mkdtemp(join(tmpdir(), 'noa-host-')), app = new Context(), fibers = [], handles = [], runs = [], adapter = new Adapter();
  for (const [plugin, config] of [[SessionStore], [AgentRegistry], [LlmRuntime], [SystemPrompt, {}], [ToolRuntime, { mode: 'native' }], [SessionProjections], [AgentLoop, {}], [BuiltIn]]) fibers.push(await app.plugin(plugin, config));
  let ctx, host, enabled = true; const observed = [];
  fibers.push(await app.plugin(owner => { owner.inject(['llm', 'tools', 'compaction'], inner => { ctx = inner; inner.llm.registerAdapter(['fixture'], adapter); inner.on('llm/stream', async function* (request, next) { try { yield* next(); } finally { if (!isNoaRedispatchedRequest(request)) observed.push(request); } }); host = installCompactionHost(inner, { archiveRoot: root, enabled: () => enabled, ...options }); }); }));
  const prepare = host.wrapPrepareRun(async input => {
    const registryApp = new Context(), prompt = await registryApp.plugin(SystemPrompt, {}), tools = await registryApp.plugin(ToolRuntime, { mode: 'native' });
    const registry = registryApp.get('tools');
    const definitions = input.baseTools ?? [];
    const register = await registryApp.plugin({ inject: ['tools'], apply(inner) { for (const tool of definitions) inner.tools.register(tool); } });
    const prepared = { runId: input.runId ?? randomUUID(), systemPrompt: '', renderSystemPrompt: () => '', tools: definitions, maxTurns: 20, maxRunSeconds: 0, wrapup: { prompt: '', maxTurns: 2 }, taskTimeoutWrapup: { prompt: '', maxTurns: 2 },
      execute: (name, args, callId, signal) => registry.execute({ name, arguments: args, callId, signal }),
      attach: (agentCtx, agent) => { const disposers = definitions.map(tool => agentCtx.tools.register(tool)); return () => { for (const remove of disposers.reverse()) remove(); }; },
      startTaskTimeoutWrapup() {}, async dispose() { await register.dispose(); await tools.dispose(); await prompt.dispose(); },
    };
    return prepared;
  });
  t.after(async () => { for (const handle of handles.reverse()) await handle.dispose(); for (const run of runs.reverse()) await run.dispose(); host.dispose(); for (const fiber of fibers.reverse()) await fiber.dispose(); await rm(root, { recursive: true, force: true }); });
  return { app, ctx, host, adapter, runs, handles, observed, setEnabled: value => { enabled = value; }, prepare: async input => { const run = await prepare(input); runs.push(run); return run; }, stream: async value => { const chunks = []; for await (const chunk of ctx.llm.stream(value)) chunks.push(chunk); return chunks; } };
}

test('planner transforms real request and executes Compress through real DSH ToolRuntime without substituting session identity', async t => {
  const f = await fixture(t), sessionId = SessionId(randomUUID());
  const run = await f.prepare({ agentKey: 'planner', sessionId, runId: 'planner-ledger', baseTools: [] });
  const original = request(sessionId), prepared = run.transformRequest(original), ids = refs(prepared);
  await f.stream({ ...prepared, signal: new AbortController().signal });
  assert.equal(f.adapter.requests[0].sessionId, sessionId);
  const result = await run.execute('Compress', { content: [{ startId: ids[0], endId: ids[2], summary }] }, randomUUID(), new AbortController().signal);
  assert.equal(result.isError, false, JSON.stringify(result));
  const projected = run.transformRequest(original); await f.stream({ ...projected, provider: 'fixture', model: 'fixture' });
  assert.ok(JSON.stringify(f.adapter.requests[1].messages).includes(summary));
  assert.ok(!JSON.stringify(f.adapter.requests[1].messages).includes('message-0:'));
  assert.equal(f.adapter.requests.length, 2); assert.equal(f.host.getRun(sessionId), undefined);
});

test('two hand-built runs sharing one real parent remain isolated across request spreads', async t => {
  const f = await fixture(t), sessionId = SessionId(randomUUID()), input = request(sessionId);
  const a = await f.prepare({ agentKey: 'planner', sessionId, runId: 'a', baseTools: [] });
  const b = await f.prepare({ agentKey: 'planner', sessionId, runId: 'b', baseTools: [] });
  const ids = refs(a.transformRequest(input)); b.transformRequest(input);
  const result = await a.execute('Compress', { content: [{ startId: ids[0], endId: ids[2], summary }] }, randomUUID(), new AbortController().signal); assert.equal(result.isError, false);
  await f.stream({ ...a.transformRequest(input) }); await f.stream({ ...b.transformRequest(input) });
  assert.ok(JSON.stringify(f.adapter.requests[0]).includes(summary)); assert.ok(JSON.stringify(f.adapter.requests[1]).includes('message-0:'));
});

test('actual native AgentLoop request is projected and built-in compaction is excluded only for attached run', async t => {
  const f = await fixture(t), sessionId = SessionId(randomUUID());
  const prepared = await f.prepare({ agentKey: 'worker', sessionId, runId: 'native', baseTools: [] });
  let detach;
  const handle = await f.app.get('agents').create({ sessionId, agentOptions: { provider: 'fixture', model: 'fixture' }, setup: (ctx, agent) => { detach = prepared.attach(ctx, agent); ctx.effect(() => detach); } });
  f.handles.push(handle);
  assert.equal(f.host.getRun(sessionId).enabled, true);
  handle.agent.followup(createUserMessage({ content: [{ type: 'text', text: 'native request' }], source: { kind: 'user' } }));
  await handle.agent.whenIdle();
  assert.equal(f.adapter.requests.length, 1);
  assert.equal(f.observed.length, 1); assert.equal(f.observed[0], f.adapter.requests[0]);
  assert.ok(JSON.stringify(f.adapter.requests[0]).includes('noa context management'));
  assert.ok(f.adapter.requests[0].tools.some(tool => tool.name === 'Compress'));
  const builtin = f.ctx.compaction, signal = new AbortController().signal;
  assert.equal(await builtin.compactIfNeeded(handle.agent, 'pressure', signal), null); assert.equal(builtin.automaticCalls, 0);
  await assert.rejects(() => builtin.compactNow(handle.agent, signal), /disabled/);
  await builtin.compactIfNeeded({ session: { id: 'unmanaged' }, options: {} }, 'pressure', signal); assert.equal(builtin.automaticCalls, 1);
  f.setEnabled(false); assert.equal(f.host.getRun(sessionId).enabled, true);
  detach(); await builtin.compactIfNeeded(handle.agent, 'pressure', signal); assert.equal(builtin.automaticCalls, 2);
});

test('terminal finish.error overflow retries once only when projected request is smaller', async t => {
  const f = await fixture(t), sessionId = SessionId(randomUUID());
  const prepared = await f.prepare({ agentKey: 'worker', sessionId, runId: 'overflow', baseTools: [] });
  const handle = await f.app.get('agents').create({ sessionId, agentOptions: { provider: 'fixture', model: 'fixture' }, setup: (ctx, agent) => { const detach = prepared.attach(ctx, agent); ctx.effect(() => detach); } }); f.handles.push(handle);
  const input = request(sessionId);
  input.messages = [
    { role: 'assistant', id: 'a', source: { kind: 'model', provider: 'fixture', model: 'fixture' }, content: [{ type: 'tool-call', id: 'read', name: 'Read', arguments: '{}' }] },
    { role: 'tool', id: 'r', source: { kind: 'tool', callId: 'read' }, toolCallId: 'read', content: [{ type: 'text', text: 'large result '.repeat(8000) }] },
    ...Array.from({ length: 6 }, (_, i) => ({ role: 'user', content: [{ type: 'text', text: `recent ${i}` }] })),
  ];
  f.adapter.behavior = async function* () { if (f.adapter.requests.length === 1) throw new Error('maximum context length is 10000 tokens'); yield { type: 'text-delta', index: 0, text: 'recovered' }; yield { type: 'finish', reason: { kind: 'stop' } }; };
  const chunks = await f.stream(input);
  assert.equal(f.adapter.requests.length, 2); assert.equal(f.observed.length, 2);
  assert.equal(chunks.at(-1).reason.kind, 'stop'); assert.ok(!chunks.some(c => c.type === 'finish' && c.reason.kind === 'error'));
  assert.ok(JSON.stringify(f.adapter.requests[1]).includes('[truncated for context space'));
  f.adapter.requests.length = 0;
  input.messages = [{ role: 'user', content: [{ type: 'text', text: 'unshrinkable '.repeat(8000) }] }];
  const failed = await f.stream(input);
  assert.equal(f.adapter.requests.length, 1); assert.equal(failed.at(-1).reason.kind, 'error');
});

test('policy removal and immutable built-in services fail before enabling partial noa wiring', async t => {
  const f = await fixture(t);
  const stripped = f.host.wrapPrepareRun(async () => ({ tools: [], async dispose() {} }));
  await assert.rejects(() => stripped({ agentKey: 'worker', baseTools: [] }), /removed Compress/);
  f.host.dispose();
  const engine = f.ctx.compaction;
  Object.defineProperty(engine, 'compactIfNeeded', { writable: false, configurable: true, value: engine.compactIfNeeded });
  const guarded = installCompactionHost(f.ctx, { enabled: () => true, archiveRoot: tmpdir() });
  try { await assert.rejects(() => guarded.wrapPrepareRun(async () => { throw new Error('must not reach'); })({ agentKey: 'worker', baseTools: [] }), /Cannot disable/); }
  finally { guarded.dispose(); Object.defineProperty(engine, 'compactIfNeeded', { writable: true }); }
});
