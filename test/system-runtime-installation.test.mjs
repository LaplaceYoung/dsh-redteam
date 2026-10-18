import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { build } from 'esbuild';
import { Context } from '@deepseek-ai/cordis';
import ToolRuntime from '@deepseek-ai/dsh-tools';
import SystemPrompt from '@deepseek-ai/dsh-system-prompt';
import LlmRuntime, { LlmAdapter } from '@deepseek-ai/dsh-llm';
const bundled = await build({ entryPoints: ['src/system-runtime/index.ts'], bundle: true, write: false, platform: 'node', format: 'esm', packages: 'external' });
const code = bundled.outputFiles[0].text.replaceAll('import.meta.url', JSON.stringify(import.meta.url)).replace(/from\s+(["'])([^"']+)\1/g, (_match, _quote, specifier) => `from ${JSON.stringify(import.meta.resolve(specifier))}`);
const { installSystemRuntime } = await import(`data:text/javascript;base64,${Buffer.from(`${code}\n//# sourceURL=system-runtime-installation.bundle.mjs`).toString('base64')}`);

test('installer exposes usable settings/search tools with saved-key probes and independent direct proxy semantics', async t => {
  const root = await mkdtemp(join(tmpdir(), 'system-install-')); t.after(() => rm(root, { recursive: true, force: true }));
  const seen = [];
  const server = createServer((request, response) => { seen.push(request.headers['x-subscription-token']); response.setHeader('content-type', 'application/json'); response.end(JSON.stringify({ web: { results: [{ title: 'fixture', url: 'https://fixture.invalid', description: 'local result' }] } })); });
  server.listen(0, '127.0.0.1'); await once(server, 'listening'); t.after(() => new Promise(resolve => server.close(resolve)));
  const ctx = new Context(); const promptFiber = await ctx.plugin(SystemPrompt, {}); const toolsFiber = await ctx.plugin(ToolRuntime, { mode: 'native' });
  const runtime = await installSystemRuntime(ctx, { storagePath: join(root, 'store.json'), snapshot: () => ({ constraints: [{ taskId: 'task', kind: 'deny', text: 'no writes' }] }) }, {
    profiles: { list: async () => ({ profiles: [], activeProfileId: null }) }, search: { endpoints: { 'brave-free': `http://127.0.0.1:${server.address().port}/search` } },
  });
  t.after(async () => { await runtime.dispose(); await toolsFiber.dispose(); await promptFiber.dispose(); });
  const invoke = (name, args) => ctx.tools.execute({ name, arguments: args, callId: `test-${name}`, signal: new AbortController().signal });
  assert.equal((await invoke('web_search', { query: 'test' })).isError, true);
  await runtime.settings.update({ web_search_backend: 'brave-free', brave_search_api_key: 'secret-local-key', web_search_proxy: 'http://127.0.0.1:1' });
  const probe = await invoke('redteam_test_web_search', {});
  assert.equal(probe.isError, false); assert.equal(probe.value.ok, true); assert.deepEqual(seen, ['secret-local-key']);
  const publicRead = await invoke('redteam_get_system_settings', {});
  assert.equal(JSON.stringify(publicRead).includes('secret-local-key'), false);
  await invoke('redteam_update_system_settings', { patch: { web_search_enabled: true, web_search_proxy: '', constraints_inject_worker: false } });
  assert.deepEqual(runtime.constraints('task', 'worker'), []); assert.equal(runtime.constraints('task', 'planner').length, 1);
  const searched = await invoke('web_search', { query: 'local', limit: 1 }); assert.equal(searched.isError, false); assert.equal(searched.value[0].title, 'fixture');
  const captured = [];
  const prepare = runtime.wrapPrepareRun(async input => { captured.push(input.baseTools.map(t => t.name)); return {}; });
  await prepare({ agentKey: 'worker' }); assert.ok(captured[0].includes('web_search'));
  await runtime.settings.update({ web_search_enabled: false }); await prepare({ agentKey: 'worker' }); assert.equal(captured[1].includes('web_search'), false);
});

test('model connectivity tool dispatches actual DSH adapter and reports missing profile failures', async t => {
  const root = await mkdtemp(join(tmpdir(), 'system-probe-')); t.after(() => rm(root, { recursive: true, force: true }));
  const ctx = new Context(); const promptFiber = await ctx.plugin(SystemPrompt, {}); const toolsFiber = await ctx.plugin(ToolRuntime, { mode: 'native' }); const llmFiber = await ctx.plugin(LlmRuntime, {});
  let calls = 0;
  class Fixture extends LlmAdapter { async *stream(request) { calls++; assert.equal(request.model, 'fixture'); yield { type: 'text-delta', index: 0, text: 'hello' }; yield { type: 'finish', reason: { kind: 'stop' } }; } }
  const remove = ctx.llm.registerAdapter(['fixture'], new Fixture());
  const runtime = await installSystemRuntime(ctx, { storagePath: join(root, 'store.json'), snapshot: () => ({ constraints: [] }) }, { profiles: { list: async () => ({ profiles: [{ id: 'p', name: 'P', provider: 'fixture', model: 'fixture' }], activeProfileId: 'p' }) } });
  t.after(async () => { await runtime.dispose(); remove(); await llmFiber.dispose(); await toolsFiber.dispose(); await promptFiber.dispose(); });
  const result = await ctx.tools.execute({ name: 'redteam_test_model_profile', arguments: { profile_id: 'p' }, callId: 'probe', signal: new AbortController().signal });
  assert.equal(result.isError, false); assert.equal(result.value.ok, true); assert.equal(calls, 1);
  const absent = await ctx.tools.execute({ name: 'redteam_test_model_profile', arguments: { profile_id: 'missing' }, callId: 'absent', signal: new AbortController().signal });
  assert.equal(absent.isError, true); assert.equal(calls, 1);
});
