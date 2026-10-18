import http from 'node:http';
import { once } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import { build } from 'esbuild';
import { Context } from '@deepseek-ai/cordis';
import { SessionId, SessionStore } from '@deepseek-ai/dsh-session';
import AgentRegistry from '@deepseek-ai/dsh-agent';
import AgentLoop from '@deepseek-ai/dsh-agent-loop';
import LlmRuntime, { LlmAdapter } from '@deepseek-ai/dsh-llm';
import SystemPrompt from '@deepseek-ai/dsh-system-prompt';
import ToolRuntime from '@deepseek-ai/dsh-tools';
import SessionProjections from '@deepseek-ai/dsh-session-projection';
import * as JsonlPersistence from '@deepseek-ai/dsh-session-persistence-jsonl';
import SessionQuery from '@deepseek-ai/dsh-session-query-sqlite';
import { buildWorkspaceBrowser } from './task-workspace-fixtures.mjs';

class ManagementAdapter extends LlmAdapter {
  requests = [];
  async resolveModel(provider, model) { return { provider, id: model, name: model }; }
  async listModels(provider) { return [await this.resolveModel(provider, 'local-model')]; }
  async *stream(request) {
    this.requests.push(request);
    yield { type: 'text-delta', index: 0, text: '本地验证回答：已收到消息。' };
    yield { type: 'finish', reason: { kind: 'stop' } };
    yield { type: 'usage', inputTokens: 9, outputTokens: 6 };
  }
}

async function sources() {
  const result = await build({ stdin: { contents: `
    export {RedTeamStore} from './src/store.ts';
    export {TaskProfileRegistry} from './src/task-management/runtime-profiles.ts';
    export {installTaskWorkspaceApi} from './src/task-workspace/api.ts';
    export {installPlatform} from './src/platform/index.ts';
    export {createConversationWorkspace,installConversationWorkspaceHttp} from './src/conversation-workspace/index.ts';
    export {installSystemRuntimeHttp} from './src/system-runtime/http.ts';
    export {installObservability,installObservabilityHttp} from './src/observability/index.ts';
    export {installAssetManagementHttp} from './src/asset-management/index.ts';
  `, resolveDir: resolve('.'), sourcefile: 'management-ui-backend.ts' }, bundle: true, platform: 'node', format: 'esm', packages: 'external', write: false });
  const code = result.outputFiles[0].text.replace(/from\s+(["'])([^"']+)\1/g, (_m, _q, specifier) => `from ${JSON.stringify(import.meta.resolve(specifier))}`);
  return import(`data:text/javascript;base64,${Buffer.from(code + '\n//# sourceURL=management-ui-backend.mjs').toString('base64')}`);
}

/** One native frontend and one real HTTP/domain stack, with only the external model replaced. */
export async function managementFixture(t) {
  const domain = await sources();
  const frontend = await buildWorkspaceBrowser(`
    import React from 'react'; import {createRoot} from 'react-dom/client';
    import {apply} from './src/client-entry.ts';
    const entries=[],disposers=[];
    apply({betterSidebar:{registerTab(tab){entries.push(tab);return()=>{}},subscribeState(){return()=>{}},getSnapshot(){return{}},getTabs(){return entries}},effect(fn){disposers.push(fn());}});
    function App(){const [selected,setSelected]=React.useState('dsh-redteam:system');const entry=entries.find(row=>row.id===selected);
      return React.createElement(React.Fragment,null,
        React.createElement('nav',{'aria-label':'管理测试标签'},entries.map(row=>React.createElement('button',{key:row.id,onClick:()=>setSelected(row.id)},row.title))),
        React.createElement('div',{id:'workspace'},entry&&React.createElement(entry.component,{key:entry.id,visible:true,scope:{sessionId:'management-parent'},tab:{id:entry.id,type:entry.id}})));
    } createRoot(document.getElementById('app')).render(React.createElement(App));
  `);
  const directory = await mkdtemp(join(tmpdir(), 'management-ui-'));
  const store = new domain.RedTeamStore(join(directory, 'state.json')); await store.load();
  const app = new Context(), fibers = [], cleanups = [], routes = [], adapter = new ManagementAdapter();
  let server, browser;
  t.after(async () => {
    await browser?.close(); server?.closeAllConnections(); if (server) await new Promise(done => server.close(done));
    for (const cleanup of cleanups.reverse()) if (cleanup) await cleanup();
    for (const fiber of fibers.reverse()) await fiber.dispose();
    await rm(directory, { recursive: true, force: true });
  });
  for (const [plugin, config] of [[SessionStore], [AgentRegistry], [LlmRuntime], [SystemPrompt, {}], [ToolRuntime, { mode: 'native' }], [SessionProjections], [JsonlPersistence, { root: join(directory, 'sessions') }], [SessionQuery, { path: ':memory:', openAt: 'never' }], [AgentLoop, {}]]) fibers.push(await app.plugin(plugin, config));
  let host;
  fibers.push(await app.plugin(ctx => ctx.inject(['llm', 'agents', 'tools', 'sessionPersistence', 'sessionQuery'], value => { host = value; value.llm.registerAdapter(['management-local'], adapter); })));
  const profiles = new domain.TaskProfileRegistry(store, host.llm);
  const parent = await host.agents.create({ sessionId: SessionId('management-parent'), agentOptions: { provider: 'management-local', model: 'local-model' } });
  cleanups.push(() => parent.dispose());
  const platform = await domain.installPlatform(host, store, { schedulerIntervalMs: 0, defaultRoute: () => ({ provider: 'management-local', model: 'local-model' }) });
  const conversations = await domain.createConversationWorkspace(host, store, {
    profiles: { resolveProfile: id => profiles.resolveProfile(id), resolveGlobal: () => ({ provider: 'management-local', model: 'local-model' }) },
    prepareRun: platform.prepareRun, resolveAgent: key => platform.agents.list().some(row => row.key === key),
  });
  const authenticate = request => request.headers.cookie?.includes('management-owner=yes') ? true : 401;
  const ui = { llm: host.llm, agents: host.agents, effect(fn) { cleanups.push(fn()); }, webServer: { register(route) { routes.push(route); return () => { const index = routes.indexOf(route); if (index >= 0) routes.splice(index, 1); }; } } };
  domain.installConversationWorkspaceHttp(ui, conversations, { authenticate });
  const system = domain.installSystemRuntimeHttp(ui, store, { authenticate, profiles }); await system.ready;
  const observation = domain.installObservability(host, store, { resolveAgent: () => ({ taskId: 'ui-task', role: 'mainagent' }), resolveCall: () => ({ taskId: 'ui-task', role: 'mainagent' }) });
  await observation.ready;
  await domain.installObservabilityHttp(ui, store, { authenticate }).ready;
  await domain.installAssetManagementHttp(ui, store, { authenticate }).ready;
  domain.installTaskWorkspaceApi(ui, store, { authenticate, profiles, lifecycleForAgent: () => undefined, admission: () => ({ enabled: false, limit: 5 }), notify: () => {} });
  const task = await store.createTask('管理验证任务', '仅本地文件与模型边界验证');
  const requests = [];
  const prefix = '/workspace/';
  server = http.createServer(async (request, response) => {
    try {
      const pathname = new URL(request.url, 'http://localhost').pathname;
      if (pathname.startsWith(`${prefix}api/`)) {
        request.url = request.url.slice(prefix.length - 1);
        const route = routes.find(row => row.kind === 'exact' ? new URL(request.url, 'http://localhost').pathname === row.path : new URL(request.url, 'http://localhost').pathname.startsWith(row.path));
        requests.push({ method: request.method, path: request.url });
        if (route) { await route.handler(request, response); return; }
        if (request.url === '/api/redteam/snapshot') { response.setHeader('content-type', 'application/json'); response.end(JSON.stringify(store.snapshot())); return; }
        response.writeHead(404, { 'content-type': 'application/json' }); response.end(JSON.stringify({ error: '尚未安装此管理路由' })); return;
      }
      const asset = frontend.assets.get(pathname);
      if (asset) { response.setHeader('content-type', pathname.endsWith('.css') ? 'text/css' : 'text/javascript'); response.end(asset); return; }
      if (pathname === '/fixture.js') { response.setHeader('content-type', 'text/javascript'); response.end(frontend.javascript); return; }
      if (pathname === '/fixture.css') { response.setHeader('content-type', 'text/css'); response.end(frontend.css); return; }
      response.setHeader('content-type', 'text/html;charset=utf-8'); response.end(frontend.html.replace('<head>', `<head><base href="${prefix}">`));
    } catch (error) { response.writeHead(500, { 'content-type': 'application/json' }); response.end(JSON.stringify({ error: String(error) })); }
  });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  return { origin: `http://127.0.0.1:${server.address().port}`, prefix, store, task, system, observation, conversations, platform, profiles, adapter, requests, ui, domain, setBrowser(value) { browser = value; } };
}
