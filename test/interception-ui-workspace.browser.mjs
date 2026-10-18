import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { once } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';
import { buildWorkspaceBrowser } from './task-workspace-fixtures.mjs';

test('native approval UI uses real HTTP/repository decisions, results, rules and judge settings', { timeout: 120000 }, async t => {
  const frontend = await buildWorkspaceBrowser();
  const ui = await build({ stdin: { contents: `import React from 'react';import {createRoot} from 'react-dom/client';import {InterceptionTab} from './src/interception-ui/client.tsx';createRoot(document.getElementById('app')).render(React.createElement(React.Fragment,null,React.createElement('aside',null,'审批浏览器验收 · 本地测试记录'),React.createElement('div',{id:'workspace'},React.createElement(InterceptionTab,{visible:true,tab:{id:'approval',type:'dsh-redteam:approvals'}}))));`, resolveDir: resolve('.'), loader: 'tsx' }, bundle: true, platform: 'browser', format: 'cjs', write: false, external: ['react', 'react-dom', '@deepseek-ai/dsh-client-ui-primitives'] });
  const nativeImport = frontend.javascript.split('\n')[0];
  frontend.javascript = `${nativeImport}\nconst require=id=>{if(!(id in fixtureModules))throw new Error('Missing native module '+id);return fixtureModules[id];};\n${ui.outputFiles[0].text}`;
  const backend = await build({ stdin: { contents: `export {installInterceptionHttp} from './src/interception/http.ts'; export {RedTeamStore} from './src/store.ts';`, resolveDir: resolve('.'), loader: 'ts' }, bundle: true, platform: 'node', format: 'esm', packages: 'external', write: false });
  const source = backend.outputFiles[0].text.replace(/from\s+(["'])([^"']+)\1/g, (_all, _quote, specifier) => `from ${JSON.stringify(import.meta.resolve(specifier))}`);
  const { installInterceptionHttp, RedTeamStore } = await import(`data:text/javascript;base64,${Buffer.from(source + '\n//# sourceURL=interception-ui-fixture-server.mjs').toString('base64')}`);
  const dir = await mkdtemp(join(tmpdir(), 'interception-ui-'));
  let browser, browserServer, server;
  // Own the temporary browser process explicitly: Edge's graceful Browser.close
  // has stalled during fixture teardown on this Windows host.
  t.after(async () => { console.error('approval fixture cleanup: disconnect'); await browser?.close(); console.error('approval fixture cleanup: browser process'); await browserServer?.kill(); if (server) { server.closeAllConnections(); await new Promise(done => server.close(done)); } await rm(dir, { recursive: true, force: true }); });
  const store = new RedTeamStore(join(dir, 'state.json')); await store.load();
  const task = await store.createTask('Approval fixture', 'Local fixture'), otherTask = await store.createTask('Other fixture', 'Other local fixture');
  let route;
  const installed = installInterceptionHttp({ webServer: { register(value) { route = value; return () => {}; } }, effect(fn) { fn(); } }, store, { authenticate: request => request.headers.cookie?.includes('fixture-auth=yes') ? true : 401 }); await installed.ready;
  const repo = installed.repository;
  const input = taskId => ({ taskId, sessionId: 'fixture-session', callId: `call-${taskId}`, rootCallId: `root-${taskId}`, toolName: 'pwsh', toolInput: { command: 'Write-Output "local approval fixture"', nested: { exact: '参数末尾检查标记' } }, status: 'pending', action: 'ask', decisionSource: 'rule', reason: '规则要求人工核验完整参数', ruleName: '本地命令审批', inputDigest: 'fixture-input', configDigest: 'fixture-config', execution: { status: 'pending' } });
  const first = await repo.add(input(task.id)), second = await repo.add(input(otherTask.id));
  const writes = [];
  server = http.createServer(async (req, res) => {
    const pathname = new URL(req.url, 'http://localhost').pathname;
    if (pathname.startsWith('/api/redteam/interception')) {
      if (req.method !== 'GET') writes.push({ method: req.method, pathname });
      await route.handler(req, res); return;
    }
    const asset = frontend.assets.get(pathname);
    if (asset) { res.setHeader('content-type', pathname.endsWith('.css') ? 'text/css' : 'text/javascript'); res.end(asset); return; }
    if (pathname === '/fixture.js') { res.setHeader('content-type', 'text/javascript'); res.end(frontend.javascript); return; }
    if (pathname === '/fixture.css') { res.setHeader('content-type', 'text/css'); res.end(frontend.css); return; }
    res.setHeader('content-type', 'text/html;charset=utf-8'); res.end(frontend.html);
  });
  server.listen(0, '127.0.0.1'); await once(server, 'listening'); const origin = `http://127.0.0.1:${server.address().port}`;
  const { chromium } = await import(pathToFileURL(process.env.DSH_VERIFY_PLAYWRIGHT ?? 'C:/Users/xiaoz/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs').href);
  browserServer = await chromium.launchServer({ channel: 'msedge', headless: true });
  browser = await chromium.connect(browserServer.wsEndpoint()); const context = await browser.newContext({ viewport: { width: 1000, height: 1000 } });
  await context.addCookies([{ name: 'fixture-auth', value: 'yes', url: origin }]); const page = await context.newPage(), errors = []; page.on('pageerror', error => errors.push(error.message)); page.setDefaultTimeout(15000);
  const button = name => page.getByRole('button', { name, exact: true });
  console.error('approval fixture: browser ready');
  await page.goto(origin); await page.getByRole('button', { name: `查看审批 pwsh ${first.id}`, exact: true }).click();
  const details = page.getByRole('region', { name: '审批详情' }); await details.getByText('完整工具参数', { exact: true }).waitFor(); assert.match(await details.innerText(), /参数末尾检查标记/);
  await button('允许本次调用').click(); await page.getByRole('status').filter({ hasText: '已允许这条工具调用' }).waitFor();
  assert.equal((await repo.detail(first.id)).status, 'allowed'); assert.equal((await repo.detail(second.id)).status, 'pending');
  await repo.complete(first.id, { status: 'succeeded', output: '工具实际边界测试结果', completedAt: new Date().toISOString() });
  await details.getByText('工具实际边界测试结果', { exact: true }).waitFor(); await button('查看执行关联').click(); await details.getByText(/call-/).first().waitFor();
  await page.screenshot({ path: resolve('.tmp-interception-ui.png'), fullPage: true });
  console.error('approval fixture: allowed with result');
  await page.getByRole('button', { name: `查看审批 pwsh ${second.id}`, exact: true }).click(); await button('拒绝本次调用').click();
  await page.getByRole('status').filter({ hasText: '已拒绝这条工具调用' }).waitFor(); assert.equal((await repo.detail(second.id)).status, 'denied');
  await page.getByRole('tab', { name: '历史', exact: true }).click(); await page.getByRole('button', { name: `查看审批 pwsh ${first.id}`, exact: true }).waitFor();
  await page.getByLabel('按任务 ID 筛选审批').fill(task.id); await page.getByRole('button', { name: `查看审批 pwsh ${second.id}`, exact: true }).waitFor({ state: 'hidden' });
  await page.getByRole('tab', { name: '规则', exact: true }).click(); await button('新建规则').click();
  console.error('approval fixture: rules');
  await page.getByLabel('规则名称', { exact: true }).fill('UI 精确规则'); await page.getByLabel('规则任务 ID').fill(task.id); await page.getByLabel('优先级', { exact: true }).fill('20');
  await page.getByLabel('匹配对象').selectOption('tool_input'); await page.getByLabel('匹配方式').selectOption('regex'); await page.getByLabel('匹配表达式').fill('Write-Output'); await page.getByLabel('判定说明').fill('人工检查本地命令');
  await page.getByLabel('审批超时（秒）', { exact: true }).fill('90'); await button('保存规则').click(); await page.getByRole('article', { name: '规则 UI 精确规则' }).waitFor();
  let rule = (await repo.snapshot()).rules.find(row => row.name === 'UI 精确规则'); assert.equal(rule.taskId, task.id); assert.equal(rule.matchType, 'regex'); assert.equal(rule.priority, 20); assert.equal(rule.timeoutSeconds, 90);
  await button('停用规则').click(); await button('启用规则').waitFor(); assert.equal((await repo.snapshot()).rules.find(row => row.id === rule.id).enabled, false);
  await button('编辑规则').click(); await page.getByLabel('规则名称', { exact: true }).fill('UI 更新规则'); await button('保存规则').click(); await page.getByRole('article', { name: '规则 UI 更新规则' }).waitFor();
  await button('删除规则').click(); await button('确认删除规则').click(); await page.getByText('尚无拦截规则。').waitFor(); assert.equal((await repo.snapshot()).rules.some(row => row.id === rule.id), false);
  await page.getByRole('tab', { name: '设置', exact: true }).click(); await page.getByLabel('纳入拦截的工具').fill('pwsh\nweb_fetch'); await page.getByRole('checkbox', { name: '启用模型判定' }).check();
  console.error('approval fixture: settings');
  await page.getByLabel('判定模型配置 ID').fill('fixture-profile'); await page.getByLabel('判定提示词').fill('UI 自定义判断提示词'); await page.getByLabel('模型判定超时（秒）').fill('22'); await page.getByLabel('模型判定失败时').selectOption('ask');
  await page.getByLabel('模型转人工超时（秒）').fill('44'); await page.getByLabel('模型转人工超时操作').selectOption('allow'); await button('保存审批设置').click(); await page.getByRole('status').filter({ hasText: '审批设置已保存' }).waitFor();
  const saved = await repo.snapshot(); assert.deepEqual(saved.enabledTools, ['pwsh', 'web_fetch']); assert.deepEqual(saved.judge, { enabled: true, profileId: 'fixture-profile', prompt: 'UI 自定义判断提示词', timeoutSeconds: 22, failAction: 'ask', askTimeoutSeconds: 44, askTimeoutAction: 'allow' });
  // A second owner may decide after this UI renders but before its POST arrives.
  // Keep the real route and repository; delay only the outgoing browser boundary.
  const conflicted = await repo.add(input(task.id));
  await page.getByRole('tab', { name: '待审批', exact: true }).click();
  await page.getByRole('button', { name: `查看审批 pwsh ${conflicted.id}`, exact: true }).click();
  await page.route(`**/records/${conflicted.id}/decide`, async route => { await repo.decide(conflicted.id, false, { expectedTaskId: task.id }); await route.continue(); });
  await button('允许本次调用').click();
  await page.getByRole('alert').filter({ hasText: '审批已由其他操作处理' }).waitFor();
  await details.getByText('已拒绝', { exact: true }).waitFor();
  assert.equal((await repo.detail(conflicted.id)).effectiveAction, 'deny');
  assert.equal(await button('允许本次调用').count(), 0);
  await repo.configure({ judge: { ...saved.judge, timeoutSeconds: 33 } });
  await page.getByRole('tab', { name: '设置', exact: true }).click();
  await page.getByLabel('模型判定超时（秒）').waitFor();
  assert.equal(await page.getByLabel('模型判定超时（秒）').inputValue(), '33', 'reopened settings read the latest persisted configuration');
  await page.getByRole('tab', { name: '设置', exact: true }).click();
  assert.equal(await page.getByLabel('模型判定超时（秒）').inputValue(), '33', 'selecting the current tab keeps its form');
  assert.equal(writes.filter(row => row.pathname.endsWith('/decide')).length, 3); assert.deepEqual(errors, []);
});
