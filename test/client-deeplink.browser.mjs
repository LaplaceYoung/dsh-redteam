// Real browser fixture using the installed BetterSidebar service/store and plugin UI.
// Run: node --test test/client-deeplink.browser.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { once } from 'node:events';
import { build } from 'esbuild';
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { clientFixture } from './client-fixtures.mjs';

test('notification URL opens real BetterSidebar findings, selects task, paginates, expands and focuses the record',async t=>{
  const runtime=process.env.DSH_VERIFY_PLAYWRIGHT ?? 'C:/Users/xiaoz/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs';
  const {chromium}=await import(pathToFileURL(runtime).href);
  const source=`
    import React from 'react';import {createRoot} from 'react-dom/client';
    import {createBetterSidebarService} from './node_modules/dsh-better-sidebar/src/client/service.ts';
    import {createSidebarStore,allLeaves} from './node_modules/dsh-better-sidebar/src/client/state.ts';
    import {apply} from './src/client-entry.ts';
    const store=createSidebarStore(),sidebar=createBetterSidebarService(store);const disposers=[];
    apply({betterSidebar:sidebar,effect(fn){disposers.push(fn());}});
    function App(){
      const snapshot=React.useSyncExternalStore(sidebar.subscribeState,sidebar.getSnapshot,sidebar.getSnapshot);
      const leaves=snapshot.state?allLeaves(snapshot.state.bottomSplits):[];const leaf=leaves.find(row=>row.active);
      const tab=leaf?.tabs.find(row=>row.id===leaf.active),descriptor=sidebar.getTabs().find(row=>row.id===tab?.type);
      return React.createElement(React.Fragment,null,
        React.createElement('nav',{'aria-label':'测试宿主标签'},sidebar.getTabs().map(item=>React.createElement('button',{key:item.id,onClick:()=>sidebar.openTab({type:item.id})},item.title))),
        React.createElement('button',{onClick:()=>store.setSession('fixture-session')},'激活会话'),
        React.createElement('main',{'data-active-tab':tab?.type??'',style:{height:450,width:560}},descriptor&&React.createElement(descriptor.component,{tab,visible:true})),
        React.createElement('button',{onClick:()=>{history.pushState({},'', '?redteamFinding=missing-finding');dispatchEvent(new PopStateEvent('popstate'));}},'打开缺失记录'),
        React.createElement('button',{onClick:()=>{history.pushState({},'', '?redteamFinding=finding-a');dispatchEvent(new PopStateEvent('popstate'));}},'打开另一个记录'));
    }
    createRoot(document.getElementById('app')).render(React.createElement(App));
  `;
  // Host artwork and controls in unopened task/approval tabs are unused boundaries.
  // Keep the actual service, state reducers and findings UI. Fail if any of these
  // exports is rendered; task-workspace-browser tests the real native controls.
  const bundle=await build({stdin:{contents:source,resolveDir:resolve('.'),sourcefile:'deeplink-fixture.ts'},bundle:true,format:'iife',platform:'browser',write:false,plugins:[{name:'unused-host-artwork',setup(build){
    build.onResolve({filter:/^@deepseek-ai\/dsh-client-ui-primitives$/},()=>({path:'artwork',namespace:'fixture'}));
    build.onLoad({filter:/.*/,namespace:'fixture'},()=>({contents:'function unused(){throw new Error("Unexpected host control request in findings fixture");} export { unused as FileTypeIcon, unused as Button, unused as Input, unused as Checkbox, unused as Tag, unused as SegmentedTabs };'}));
  }}]});
  const data=clientFixture();data.findings.push(...Array.from({length:48},(_,i)=>({...data.findings[0],id:`b-${String(i).padStart(2,'0')}`,taskId:'task-b',summary:`任务 B 记录 ${i}`})));
  data.findings.push({...data.findings[0],id:'z-notification-target',taskId:'task-b',summary:'通知指向的完整记录'});
  const server=http.createServer((req,res)=>{
    if(req.url==='/api/redteam/snapshot'){res.setHeader('content-type','application/json');res.end(JSON.stringify(data));return;}
    if(req.url==='/fixture.js'){res.setHeader('content-type','text/javascript');res.end(bundle.outputFiles[0].text);return;}
    res.setHeader('content-type','text/html;charset=utf-8');res.end('<!doctype html><html lang="zh"><head><meta charset="utf-8"></head><body><div id="app"></div><script src="/fixture.js"></script></body></html>');
  });server.listen(0,'127.0.0.1');await once(server,'listening');t.after(()=>new Promise(done=>{server.closeAllConnections();server.close(done);}));
  const browser=await chromium.launch({executablePath:process.env.DSH_VERIFY_CHROMIUM ?? join(process.env.LOCALAPPDATA,'ms-playwright','chromium_headless_shell-1248','chrome-headless-shell-win64','chrome-headless-shell.exe'),headless:true});t.after(()=>browser.close());const page=await browser.newPage({viewport:{width:1000,height:800}}),errors=[];page.on('pageerror',error=>errors.push(error.message));
  await page.goto(`http://127.0.0.1:${server.address().port}/?redteamFinding=z-notification-target`);
  await page.getByRole('button',{name:'激活会话'}).waitFor();assert.equal(await page.locator('main').getAttribute('data-active-tab'),'');
  assert.deepEqual(await page.getByRole('navigation',{name:'测试宿主标签'}).getByRole('button').allTextContents(),['任务工作台','资产图','发现','流量','活动','报告','审批','资产管理','系统设置','调用记录','会话与文件','平台资源','宿主与更新']);
  await page.getByRole('button',{name:'激活会话'}).click();await page.locator('main[data-active-tab="dsh-redteam:findings"]').waitFor();
  const target=page.locator('details[data-finding-id="z-notification-target"]');await target.waitFor();
  assert.equal(await page.getByRole('combobox',{name:'筛选任务'}).inputValue(),'task-b');assert.equal(await target.getAttribute('open'),'');
  assert.match(await page.locator('.rt-pagination').innerText(),/2 \/ 2 页/);
  assert.equal(await target.evaluate(el=>document.activeElement===el),true);
  const visible=await target.evaluate(el=>{const a=el.getBoundingClientRect(),b=el.closest('.rt-scroll').getBoundingClientRect();return a.top<b.bottom&&a.bottom>b.top;});assert.equal(visible,true);
  assert.match(await target.innerText(),/关联资产/);assert.match(await target.innerText(),/本地响应样例/);
  await page.screenshot({path:resolve('.tmp-notification-deeplink.png'),fullPage:true});
  await page.getByRole('button',{name:'流量',exact:true}).click();await page.locator('main[data-active-tab="dsh-redteam:traffic"]').waitFor();
  await page.getByRole('button',{name:'打开另一个记录'}).click();await page.locator('main[data-active-tab="dsh-redteam:findings"]').waitFor();const other=page.locator('details[data-finding-id="finding-a"]');await other.waitFor();assert.equal(await other.getAttribute('open'),'');assert.equal(await page.getByRole('combobox',{name:'筛选任务'}).inputValue(),'task-a');
  await page.getByRole('button',{name:'打开缺失记录'}).click();await page.getByRole('status').filter({hasText:'未找到通知中的发现 missing-finding'}).waitFor();
  // A notification landing is consumed once. Ordinary subsequent task changes
  // must stay under the reader's control, including across polling updates.
  await page.getByRole('button',{name:'打开另一个记录'}).click();
  await page.getByRole('combobox',{name:'筛选任务'}).selectOption('task-b');
  await page.getByRole('searchbox',{name:'搜索发现'}).fill('任务 B 记录 2');
  assert.equal(await page.getByRole('combobox',{name:'筛选任务'}).inputValue(),'task-b');
  await page.getByRole('button',{name:'打开另一个记录'}).click();
  await other.waitFor();
  assert.equal(await page.getByRole('combobox',{name:'筛选任务'}).inputValue(),'task-a');
  assert.equal(await page.getByRole('searchbox',{name:'搜索发现'}).inputValue(),'');
  // Opening the application without a notification must not activate a tab.
  // Use a fresh context: BetterSidebar deliberately restores saved tabs on reload.
  const noTargetPage=await browser.newPage();
  noTargetPage.on('pageerror',error=>errors.push(error.message));
  await noTargetPage.goto(`http://127.0.0.1:${server.address().port}/`);
  await noTargetPage.getByRole('button',{name:'激活会话'}).click();
  assert.equal(await noTargetPage.locator('main').getAttribute('data-active-tab'),'');
  await noTargetPage.getByRole('button',{name:'打开另一个记录'}).click();
  await noTargetPage.locator('details[data-finding-id="finding-a"][open]').waitFor();
  assert.deepEqual(errors,[]);
});
