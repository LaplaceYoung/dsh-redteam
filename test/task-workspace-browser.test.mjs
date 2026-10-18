import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { once } from 'node:events';
import { randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { Context } from '@deepseek-ai/cordis';
import { SessionId, SessionStore } from '@deepseek-ai/dsh-session';
import AgentRegistry from '@deepseek-ai/dsh-agent';
import AgentLoop from '@deepseek-ai/dsh-agent-loop';
import LlmRuntime, { LlmAdapter } from '@deepseek-ai/dsh-llm';
import SystemPrompt from '@deepseek-ai/dsh-system-prompt';
import ToolRuntime from '@deepseek-ai/dsh-tools';
import SessionProjections from '@deepseek-ai/dsh-session-projection';
import { buildWorkspaceBrowser, importCurrentWorkspaceSources } from './task-workspace-fixtures.mjs';

// Real API/store/Agent/Planner/FIFO. Provider output is deliberately scripted;
// Worker admission is held at its boundary so no external target is contacted.
class FixtureAdapter extends LlmAdapter {
  requests = []; responses = [];
  async resolveModel(provider, model) { return { provider, id: model, name: model, reasoning: { efforts: [{ id: 'high', name: 'High' }] } }; }
  async listModels(provider) { return [await this.resolveModel(provider, 'fixture-model'), await this.resolveModel(provider, 'chain-model')]; }
  async *stream(request) {
    this.requests.push(request); assert.ok(this.responses.length, 'Unexpected model request: fixture must specify actual outputs');
    const response = this.responses.shift();
    if (typeof response === 'function') { yield* response(request); return; }
    if (Array.isArray(response)) {
      for (const [index, call] of response.entries()) yield { type: 'tool-call-delta', index, id: randomUUID(), name: call.name, argumentsDelta: JSON.stringify(call.args) };
      yield { type: 'finish', reason: { kind: 'tool-calls' } };
    } else { yield { type: 'text-delta', index: 0, text: response }; yield { type: 'finish', reason: { kind: 'stop' } }; }
  }
}

async function fixture(t, { prefix = '/' } = {}) {
  const [sources, frontend] = await Promise.all([importCurrentWorkspaceSources(), buildWorkspaceBrowser()]);
  const dir = await mkdtemp(join(tmpdir(), 'task-workspace-browser-'));
  const store = new sources.RedTeamStore(join(dir, 'state.json'));
  await store.load();
  const app = new Context(), fibers = [], handles = [], adapter = new FixtureAdapter();
  let planner, lifecycle, profiles, api, route, server, browser;
  t.after(async () => {
    await browser?.close(); server?.closeAllConnections(); if (server) await new Promise(done => server.close(done));
    api?.dispose(); await lifecycle?.dispose(); await planner?.dispose();
    for (const handle of handles.reverse()) await handle.dispose();
    for (const fiber of fibers.reverse()) await fiber.dispose();
    await rm(dir, { recursive: true, force: true });
  });
  for (const [plugin, config] of [[SessionStore], [AgentRegistry], [LlmRuntime], [SystemPrompt, {}], [ToolRuntime, { mode: 'native' }], [SessionProjections], [AgentLoop, {}]]) fibers.push(await app.plugin(plugin, config));
  fibers.push(await app.plugin(ctx => { ctx.inject(['llm', 'tools'], scope => {
    scope.llm.registerAdapter(['workspace-fixture'], adapter);
    profiles = new sources.TaskProfileRegistry(store, scope.llm);
    planner = sources.installPlanner(scope, store, { start: async () => undefined, stop: async () => {}, steer: async () => {}, quiesceTask: async () => {} }, { concurrency: 1, debounceMs: 60000, modelStream: call => lifecycle.modelStream(call) });
    lifecycle = new sources.TaskLifecycleRuntime(store, planner, new sources.TaskModelRouter(store, scope.llm, profiles), { concurrency: 1, autoPoll: false });
  }); }));
  for (const id of ['parent-a', 'parent-b']) handles.push(await app.get('agents').create({ sessionId: SessionId(id), agentOptions: { provider: 'workspace-fixture', model: 'fixture-model' } }));
  const actions = [], requests = []; let nextHeldResponse;
  api = sources.installTaskWorkspaceApi({
    webServer: { register(value) { route = value; return () => { route = undefined; }; } },
    agents: app.get('agents'), llm: app.get('llm'), effect() {}, logger: { warn() {} },
  }, store, { profiles, authenticate: request => request.headers.cookie?.includes('fixture-auth=yes') === true,
    lifecycleForAgent: agent => handles.some(handle => handle.agent === agent) ? lifecycle : undefined,
    admission: () => lifecycle.admission(), notify: taskId => planner.notify(taskId),
  });
  server = http.createServer(async (req, res) => {
    const pathname = new URL(req.url, 'http://localhost').pathname;
    if (pathname === prefix.slice(0, -1) + route?.path) {
      requests.push({ method: req.method, url: req.url });
      if (req.method === 'POST' && nextHeldResponse) {
        const held = nextHeldResponse; nextHeldResponse = undefined;
        const end = res.end.bind(res);
        res.end = (...args) => { held.resolve(() => end(...args)); return res; };
      }
      await route.handler(req, res); return;
    }
    const asset = frontend.assets.get(pathname);
    if (asset) { res.setHeader('content-type', pathname.endsWith('.css') ? 'text/css' : 'text/javascript'); res.end(asset); return; }
    if (pathname === '/fixture.js') { res.setHeader('content-type', 'text/javascript'); res.end(frontend.javascript); return; }
    if (pathname === '/fixture.css') { res.setHeader('content-type', 'text/css'); res.end(frontend.css); return; }
    if (pathname.includes('/api/')) { res.writeHead(404); res.end('API escaped fixture proxy prefix'); return; }
    res.setHeader('content-type', 'text/html;charset=utf-8'); res.end(frontend.html.replace('<head>', `<head><base href="${prefix}">`));
  });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const origin = `http://127.0.0.1:${server.address().port}`;
  const runtime = process.env.DSH_VERIFY_PLAYWRIGHT ?? 'C:/Users/xiaoz/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs';
  const { chromium } = await import(pathToFileURL(runtime).href);
  browser = await chromium.launch({ executablePath: process.env.DSH_VERIFY_CHROMIUM ?? join(process.env.LOCALAPPDATA, 'ms-playwright', 'chromium_headless_shell-1248', 'chrome-headless-shell-win64', 'chrome-headless-shell.exe'), headless: true });
  const context = await browser.newContext({ viewport: { width: 1000, height: 950 } });
  await context.addCookies([{ name: 'fixture-auth', value: 'yes', url: origin }]);
  const page = await context.newPage(), errors = []; page.on('pageerror', error => { errors.push(error.message); });
  page.on('request', request => { if (request.method() === 'POST' && request.url().includes('/api/redteam/task-workspace')) actions.push(JSON.parse(request.postData())); });
  page.setDefaultTimeout(10000);
  await page.goto(origin + prefix);
  await page.getByRole('button', { name: '新建任务', exact: true }).waitFor();
  return { store, adapter, page, context, origin, actions, requests, errors, lifecycle, holdNextPost() { nextHeldResponse = Promise.withResolvers(); return nextHeldResponse.promise; } };
}

async function mutate(f, action, operation) {
  const response = f.page.waitForResponse(response => response.request().method() === 'POST' && response.url().includes('/api/redteam/task-workspace') && JSON.parse(response.request().postData()).action === action);
  await operation(); const result = await response;
  assert.equal(result.status(), 200, await result.text());
  await f.page.getByRole('status').filter({ hasText: '正在处理操作' }).waitFor({ state: 'hidden' });
  return result.json();
}
const button = (page, name) => page.getByRole('button', { name, exact: true });
const tab = (page, name) => page.getByRole('tab', { name, exact: true });
const screenshotDir = resolve('docs/parity/task-workspace-fixtures');

test('native workspace confirms task deletion and protects another task shared asset', { timeout: 90000 }, async t => {
  const f = await fixture(t), p = f.page;
  await button(p, '新建任务').click();
  await p.getByLabel('任务名称', { exact: true }).fill('删除任务 A');
  await p.getByLabel('任务描述', { exact: true }).fill('核验共享资产删除边界');
  const created = await mutate(f, 'task.create', () => button(p, '创建任务').click());
  const other = await f.store.createTask('保留任务 B', '保留共享引用');
  const shared = await f.store.addAsset({ taskId: created.taskId, kind: 'ip', value: '192.0.2.21', source: 'user', metadata: { task_ids: [created.taskId, other.id] } });
  await f.store.addAsset({ taskId: created.taskId, kind: 'ip', value: '192.0.2.22', source: 'user', metadata: {} });
  await p.locator('summary').filter({ hasText: /^删除任务$/ }).click();
  await p.getByRole('checkbox', { name: '同时删除没有其他任务引用的资产', exact: true }).check();
  await button(p, '删除任务 删除任务 A').click();
  assert.ok(f.store.snapshot().tasks.some(row => row.id === created.taskId), 'first click only opens confirmation');
  await button(p, '取消').click(); assert.equal(f.actions.some(row => row.action === 'task.delete'), false);
  await button(p, '删除任务 删除任务 A').click();
  await mutate(f, 'task.delete', () => button(p, '确认删除').click());
  await p.getByRole('article', { name: '任务：保留任务 B', exact: true }).waitFor();
  assert.equal(f.store.snapshot().tasks.some(row => row.id === created.taskId), false);
  assert.deepEqual(f.store.snapshot().assets.map(row => row.id), [shared.id]);
  assert.deepEqual(f.store.snapshot().assets[0].metadata.task_ids, [other.id]);
  assert.deepEqual(f.actions.find(row => row.action === 'task.delete'), { action: 'task.delete', taskId: created.taskId, deleteAssets: true, deleteFindings: false, sessionId: 'parent-a' });
  assert.deepEqual(f.errors, []);
});

test('native DSH workspace creates templates/tasks, edits contracts and models, then executes lifecycle with real selected Agent', { timeout: 120000 }, async t => {
  const f = await fixture(t), p = f.page;
  await button(p, '模板与分类').click();
  await p.getByLabel('分类名称', { exact: true }).fill('授权测试');
  await mutate(f, 'category.create', () => button(p, '添加分类').click());
  const category = f.store.snapshot().taskCategories[0];
  await button(p, '新建模板').click();
  await p.getByLabel('模板名称', { exact: true }).fill('登录核验模板');
  await p.getByLabel('模板描述', { exact: true }).fill('使用测试账号核验已授权登录流程');
  await p.getByLabel('模板目标', { exact: true }).fill('提交可复核的登录验证证据');
  await p.getByLabel('模板分类', { exact: true }).selectOption(category.id);
  await mutate(f, 'template.create', () => button(p, '保存模板').click());
  await button(p, '返回任务').click(); await button(p, '新建任务').click();
  await p.getByLabel('使用模板', { exact: true }).selectOption(f.store.snapshot().taskTemplates[0].id);
  assert.equal(await p.getByLabel('任务描述', { exact: true }).inputValue(), '使用测试账号核验已授权登录流程');
  await p.getByLabel('任务名称', { exact: true }).fill('浏览器任务 A');
  await p.getByText('执行设置与来源任务', { exact: true }).click();
  await p.getByLabel('任务时限（秒）', { exact: true }).fill('1200');
  await p.getByRole('checkbox', { name: '启用覆盖分析', exact: true }).uncheck();
  const created = await mutate(f, 'task.create', () => button(p, '创建任务').click());
  const taskId = created.taskId;
  assert.equal(f.store.snapshot().tasks.find(row => row.id === taskId).status, 'draft');
  assert.equal(f.store.snapshot().tasks.find(row => row.id === taskId).coverageEnabled, false);
  await button(p, '重命名').click(); await p.getByLabel('修改任务名称').fill('浏览器任务 A（已核验）');
  await mutate(f, 'task.metadata', () => button(p, '保存名称').click());
  await mutate(f, 'task.metadata', () => button(p, '置顶任务').click());
  assert.ok(f.store.snapshot().tasks.find(row => row.id === taskId).pinnedAt);
  await tab(p, '目标').click(); await p.getByLabel('目标内容').fill('测试登录返回授权账号标识');
  await mutate(f, 'goal.create', () => button(p, '添加目标').click());
  await button(p, '编辑目标').click(); await p.getByLabel('目标内容').fill('测试登录返回正确账号标识及证据');
  await mutate(f, 'goal.update', () => button(p, '保存目标').click());
  await tab(p, '约束').click(); await p.getByLabel('约束内容').fill('不得修改生产账号');
  await mutate(f, 'constraint.create', () => button(p, '添加约束').click());
  assert.equal(f.store.snapshot().constraints[0].kind, 'deny');
  await tab(p, '模型链').click(); await button(p, '新建模型配置').click();
  await p.getByLabel('配置名称', { exact: true }).fill('测试备用模型');
  await p.getByLabel('模型提供方', { exact: true }).selectOption('workspace-fixture');
  await p.getByLabel('模型', { exact: true }).selectOption('chain-model');
  await p.getByLabel('推理强度', { exact: true }).selectOption('high');
  await p.getByLabel('最大输出 token', { exact: true }).fill('2048');
  const profileResult = await mutate(f, 'profile.upsert', () => button(p, '保存模型配置').click());
  const profile = profileResult.workspace.profiles[0];
  await p.getByLabel('添加模型配置').selectOption(profile.id); await button(p, '加入链').click();
  await mutate(f, 'chain.set', () => button(p, '保存模型链').click());
  // Background quota/accounting revisions must not discard local editor input.
  await button(p, '新建模型配置').click(); await p.getByLabel('配置名称', { exact: true }).fill('尚未保存的配置');
  await button(p, '清空选择').click();
  await f.store.transaction(state => { state.tasks.find(row => row.id === taskId).llmChain.revision++; });
  await p.waitForResponse(response => response.request().method() === 'GET' && response.url().includes('/api/redteam/task-workspace'));
  assert.equal(await p.getByLabel('配置名称', { exact: true }).inputValue(), '尚未保存的配置');
  assert.equal(await p.getByRole('article', { name: '模型链配置：测试备用模型', exact: true }).count(), 0);
  await button(p, '收起配置表单').click();
  f.adapter.responses.push([{ name: 'add_intent', args: { summary: '固定测试模型：核验登录响应', input: {} } }], '固定测试模型完成本轮规划');
  await mutate(f, 'task.start', () => button(p, '启动任务').click());
  assert.ok(f.adapter.requests.length >= 2);
  assert.ok(f.adapter.requests.every(request => request.provider === 'workspace-fixture' && request.model === 'chain-model' && request.maxTokens === 2048));
  assert.equal(f.actions.find(action => action.action === 'task.start').sessionId, 'parent-a');
  assert.ok(f.store.snapshot().tasks.find(row => row.id === taskId).firstRunAt);
  assert.equal(f.store.snapshot().intents.filter(row => row.taskId === taskId).length, 1);
  await mkdir(screenshotDir, { recursive: true }); await p.screenshot({ path: join(screenshotDir, 'models-running.png'), fullPage: true, animations: 'disabled' });
  await mutate(f, 'task.pause', () => button(p, '暂停任务').click());
  assert.equal(f.store.snapshot().tasks.find(row => row.id === taskId).status, 'paused');
  await mutate(f, 'task.resume', () => button(p, '恢复任务').click());
  assert.equal(f.store.snapshot().tasks.find(row => row.id === taskId).status, 'running');
  await tab(p, '概览').click(); await tab(p, '概览').press('ArrowRight');
  assert.equal(await tab(p, '目标').getAttribute('aria-selected'), 'true', 'native tabs retain keyboard navigation');
  await p.setViewportSize({ width: 360, height: 780 });
  await p.screenshot({ path: join(screenshotDir, 'goals-narrow.png'), fullPage: true, animations: 'disabled' });
  assert.equal(await p.locator('.tw-root').evaluate(element => element.scrollWidth <= element.clientWidth), true);

  // A second real Agent requests another task while the first consumes the FIFO slot.
  await p.getByLabel('切换 DSH 会话').selectOption('parent-b'); await button(p, '新建任务').click();
  await p.getByLabel('任务名称', { exact: true }).fill('排队任务 B');
  await p.getByLabel('任务描述', { exact: true }).fill('等待首个任务释放运行名额');
  await p.getByLabel('任务目标', { exact: true }).fill('核验 FIFO 状态');
  const second = await mutate(f, 'task.create', () => button(p, '创建任务').click());
  await mutate(f, 'task.start', () => button(p, '启动任务').click());
  assert.equal(f.store.snapshot().tasks.find(row => row.id === second.taskId).queued, true);
  await p.getByRole('status').filter({ hasText: '任务正在排队' }).waitFor();
  await p.screenshot({ path: join(screenshotDir, 'queue-narrow.png'), fullPage: true, animations: 'disabled' });
  await mutate(f, 'task.pause', () => button(p, '暂停排队').click());
  assert.equal(f.store.snapshot().tasks.find(row => row.id === second.taskId).status, 'paused');
  assert.deepEqual(f.errors, []);
});

test('proxy-scoped workspace can pause a real pending Planner call and ignores its stale HTTP response', { timeout: 90000 }, async t => {
  const f = await fixture(t, { prefix: '/proxy/dsh/' }), p = f.page;
  await button(p, '新建任务').click(); await p.getByLabel('任务名称', { exact: true }).fill('可取消规划');
  await p.getByLabel('任务描述', { exact: true }).fill('验证真实模型调用取消');
  await p.getByLabel('任务目标', { exact: true }).fill('保留未达成目标');
  const created = await mutate(f, 'task.create', () => button(p, '创建任务').click());
  await tab(p, '目标').click(); await p.getByLabel('目标内容').fill('待执行的真实规划');
  await mutate(f, 'goal.create', () => button(p, '添加目标').click());
  const started = Promise.withResolvers(), aborted = Promise.withResolvers();
  f.adapter.responses.push(async function* (request) {
    started.resolve(request);
    await new Promise((_resolve, reject) => request.signal.addEventListener('abort', () => { aborted.resolve(); reject(request.signal.reason); }, { once: true }));
  });
  await button(p, '启动任务').click(); const request = await started.promise;
  assert.equal(request.model, 'fixture-model');
  await button(p, '暂停任务').waitFor();
  assert.equal(await button(p, '暂停任务').isDisabled(), false, 'polling exposes pause while start request is still pending');
  await mutate(f, 'task.pause', () => button(p, '暂停任务').click()); await aborted.promise;
  assert.equal(f.store.snapshot().tasks.find(row => row.id === created.taskId).status, 'paused');
  await button(p, '恢复任务').waitFor();
  assert.equal(await p.getByRole('alert').count(), 0, 'older aborted start cannot overwrite pause success');

  // Hold a successful resume response after the server has captured running state.
  // Pause reaches the same actual lifecycle before the older response is released.
  f.adapter.responses.push([{ name: 'add_intent', args: { summary: '固定测试模型的待办', input: {} } }], '规划完成');
  const held = f.holdNextPost();
  const resumed = p.waitForResponse(response => response.request().method() === 'POST' && JSON.parse(response.request().postData()).action === 'task.resume');
  await button(p, '恢复任务').click(); const release = await held;
  await button(p, '暂停任务').waitFor();
  const paused = p.waitForResponse(response => response.request().method() === 'POST' && JSON.parse(response.request().postData()).action === 'task.pause');
  await button(p, '暂停任务').click(); assert.equal((await paused).status(), 200);
  await button(p, '恢复任务').waitFor(); release(); assert.equal((await resumed).status(), 200);
  await p.getByRole('status').filter({ hasText: '正在处理操作' }).waitFor({ state: 'hidden' });
  assert.equal(await button(p, '恢复任务').count(), 1, 'stale running snapshot cannot replace newer paused state');
  assert.ok(f.requests.length > 0 && f.requests.every(row => row.url.startsWith('/proxy/dsh/api/redteam/task-workspace')));
  assert.deepEqual(f.errors, []);
});

test('native workspace preserves drafts on API errors and never invents an Agent for unavailable or empty scope', { timeout: 90000 }, async t => {
  const f = await fixture(t), p = f.page;
  await button(p, '新建任务').click(); await p.getByLabel('任务名称', { exact: true }).fill('错误恢复任务');
  await p.getByLabel('任务描述', { exact: true }).fill('保留用户输入');
  await f.context.clearCookies();
  const failed = p.waitForResponse(response => response.request().method() === 'POST' && response.status() === 401);
  await button(p, '创建任务').click(); await failed;
  await p.getByRole('alert').filter({ hasText: 'DSH authentication required' }).waitFor();
  assert.equal(await p.getByLabel('任务描述', { exact: true }).inputValue(), '保留用户输入');
  assert.equal(f.store.snapshot().tasks.length, 0);
  await f.context.addCookies([{ name: 'fixture-auth', value: 'yes', url: f.origin }]);
  await mutate(f, 'task.create', () => button(p, '创建任务').click());
  await p.getByLabel('切换 DSH 会话').selectOption('missing');
  await p.getByText(/当前会话尚不能执行任务/).waitFor();
  await button(p, '错误恢复任务').click();
  assert.equal(await button(p, '启动任务').isDisabled(), true);
  assert.equal(f.adapter.requests.length, 0);
  await p.getByLabel('切换 DSH 会话').selectOption('');
  await p.getByText('请先打开一个 DSH 会话。工作台会使用该会话的 Agent 和模型执行任务。').waitFor();
  assert.equal(await button(p, '启动任务').count(), 0);
  assert.equal(f.actions.some(action => action.action === 'task.start'), false);
  assert.deepEqual(f.errors, []);
});
