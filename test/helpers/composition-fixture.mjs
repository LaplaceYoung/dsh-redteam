import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Context, Service } from '@deepseek-ai/cordis';
import Loader from '@deepseek-ai/cordis-plugin-loader';
import AgentPresetRegistry from '@deepseek-ai/dsh-agent-preset-registry';
import { SessionId, SessionStore } from '@deepseek-ai/dsh-session';
import AgentRegistry from '@deepseek-ai/dsh-agent';
import AgentLoop from '@deepseek-ai/dsh-agent-loop';
import LlmRuntime, { LlmAdapter } from '@deepseek-ai/dsh-llm';
import SystemPrompt from '@deepseek-ai/dsh-system-prompt';
import ToolRuntime from '@deepseek-ai/dsh-tools';
import ApprovalService from '@deepseek-ai/dsh-user-approval';
import SessionProjections from '@deepseek-ai/dsh-session-projection';
import LocalFileSystem from '@deepseek-ai/dsh-fs-local';
import WorkingDirectory from '@deepseek-ai/dsh-working-directory';
import * as JsonlPersistence from '@deepseek-ai/dsh-session-persistence-jsonl';
import SessionQuery from '@deepseek-ai/dsh-session-query-sqlite';
import Subagents from '@deepseek-ai/dsh-subagent';
import * as spawnProvider from '@deepseek-ai/dsh-subagent-spawn-in-process';
import * as forkProvider from '@deepseek-ai/dsh-subagent-fork-in-process';
import WebServer from '@deepseek-ai/dsh-host-webserver';
import * as plugin from '../../lib/index.js';

class FixtureAdapter extends LlmAdapter {
  async resolveModel(provider, model) { return { provider, id: model, name: model }; }
  async *stream() { yield { type: 'text-delta', index: 0, text: 'Fixture response' }; yield { type: 'finish', reason: { kind: 'stop' } }; }
}
function waitFor(check, subscribe, description) {
  return new Promise((resolve, reject) => {
    let unsubscribe = () => {};
    const timer = setTimeout(() => { unsubscribe(); reject(new Error(`Timed out waiting for ${description}`)); }, 20000);
    const inspect = () => {
      try { if (check()) { clearTimeout(timer); unsubscribe(); resolve(); } }
      catch (error) { clearTimeout(timer); unsubscribe(); reject(error); }
    };
    unsubscribe = subscribe(inspect); inspect();
  });
}

/** Only authentication and model transport are deterministic fixture boundaries. */
export async function compositionFixture(t, options = {}) {
  const dir = await mkdtemp(join(tmpdir(), 'redteam-composition-'));
  const storagePath = join(dir, 'state.json'), app = new Context(), fibers = [], handles = [];
  const routes = new Set(), routeEvents = new EventEmitter(), admissions = [], observed = [];
  let unregisterPreset;
  class ObservedWebServer extends WebServer {
    register(route) {
      const dispose = super.register(route); routes.add(route.path); routeEvents.emit('change');
      return () => { routes.delete(route.path); dispose(); };
    }
  }
  class FixtureConnection extends Service {
    constructor(ctx) { super(ctx, 'connection'); }
    admit(request) {
      admissions.push(request.headers.authorization);
      if (!request.headers.authorization) return { rejection: 401 };
      return { peer: { principal: { kind: request.headers.authorization === 'Bearer fixture-owner' ? 'owner' : 'guest' } } };
    }
  }
  // One ordered cleanup: finish all async effects before deleting their files.
  t.after(async () => {
    const errors = [];
    for (const handle of handles.reverse()) { try { await handle.dispose(); } catch (error) { errors.push(error); } }
    try { await unregisterPreset?.(); } catch (error) { errors.push(error); }
    for (const fiber of fibers.reverse()) { try { await fiber.dispose(); } catch (error) { errors.push(error); } }
    if (errors.length) throw new AggregateError(errors, 'Composition did not shut down cleanly; preserving its directory');
    await rm(dir, { recursive: true, force: true });
  });
  async function mount(module, config) { const fiber = await app.plugin(module, config); fibers.push(fiber); return fiber; }
  for (const [module, config] of [
    [SessionStore], [AgentRegistry], [LlmRuntime], [SystemPrompt, {}], [ToolRuntime, { mode: 'native' }],
    [ApprovalService, { policy: 'never' }], [SessionProjections], [LocalFileSystem, { cwd: dir }],
    [WorkingDirectory, { defaultDirectory: dir }], [JsonlPersistence, { root: join(dir, 'sessions') }],
    [SessionQuery, { path: ':memory:', openAt: 'never' }], [AgentLoop, {}], [Subagents, {}], [spawnProvider, {}], [forkProvider, {}],
    [ObservedWebServer, { host: '127.0.0.1', port: 0 }], [FixtureConnection],
  ]) await mount(module, config);
  if (options.preset) {
    await mount(Loader, { baseUrl: new URL('../../', import.meta.url).href });
    await mount(AgentPresetRegistry, { default: 'redteam' });
  }
  await mount(ctx => {
    ctx.inject(['llm'], inner => { inner.llm.registerAdapter(['fixture'], options.adapter ?? new FixtureAdapter()); });
    ctx.on('session/event', (session, event) => { observed.push({ type: 'session/event', sessionId: session.id, event: event.type }); });
    ctx.on('tools/pre-execute', async (exec, next) => { observed.push({ type: 'tools/pre-execute', name: exec.name }); return next(); });
    ctx.on('tools/result', exec => { observed.push({ type: 'tools/result', name: exec.name }); });
  });
  const config = surface => ({ surface, storagePath, reaCommand: 'rea', dataDir: join(dir, 'data'), notifications: { allowLocalTargets: true } });
  if (options.preset) {
    unregisterPreset = await app.get('agentPresets').register({ id: 'redteam', plugins: [{ id: 'redteam-agent', name: new URL('../../lib/index.js', import.meta.url).href, config: config('agent') }] });
    assert.equal((await app.get('agentPresets').resolve('redteam')).broken, undefined);
  }
  async function mountUi() {
    let startup;
    await mount(ctx => { startup = plugin.apply(ctx, config('ui')); return startup; });
    await startup;
    assert.ok(routes.has('/api/redteam/snapshot'), 'awaited plugin startup exposes the authenticated UI route');
  }
  async function createAgent() {
    const handle = await app.get('agents').create({ sessionId: SessionId(randomUUID()), meta: { cwd: dir }, agentOptions: { provider: 'fixture', model: 'fixture' }, setup: async (ctx, agent) => {
      if (options.preset) await app.get('agentPresets').mount(ctx, 'redteam');
      else {
        let startup;
        await ctx.plugin(owner => { startup = plugin.apply(owner, config('agent')); return startup; });
        await startup;
      }
      assert.ok(['redteam_create_task', 'redteam_record_fact', 'redteam_list_task_worker_traces'].every(name => app.get('tools').get(name, agent)), 'awaited preset startup exposes its complete tool set');
    } }); handles.push(handle); return handle.agent;
  }
  async function call(agent, name, args = {}) {
    const result = await app.get('tools').execute({ callId: randomUUID(), name, arguments: args, agent, signal: AbortSignal.timeout(15000) });
    assert.equal(result.isError, false, JSON.stringify(result)); return result.value;
  }
  async function snapshot(auth = 'Bearer fixture-owner') {
    const response = await fetch(`http://127.0.0.1:${app.get('webServer').port}/api/redteam/snapshot`, { headers: auth ? { authorization: auth } : {}, signal: AbortSignal.timeout(10000) });
    return { status: response.status, headers: response.headers, body: await response.json() };
  }
  const disposeAgent = agent => handles.find(handle => handle.agent === agent).dispose();
  return { app, dir, storagePath, routes, admissions, observed, mountUi, createAgent, disposeAgent, unregisterPreset: () => unregisterPreset?.(), call, snapshot };
}
