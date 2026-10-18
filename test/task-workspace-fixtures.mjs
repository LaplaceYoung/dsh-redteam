import assert from 'node:assert/strict';
import { openSync, readSync, closeSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { build } from 'esbuild';

/**
 * Read the installed host's native frontend bundle and static module seed.
 * Remove only the top-level application boot, then share its actual React and
 * primitives with the plugin. No replacement controls or synthetic CSS tokens.
 */
export async function buildWorkspaceBrowser(sourceOverride) {
  const archive = readHostArchive();
  const base = 'dsh/node_modules/@deepseek-ai/dsh-web-frontend/dist/assets/';
  const entries = Object.keys(archive.entry(base.slice(0, -1)).files);
  const indexName = entries.find(name => /^index-.*\.js$/.test(name));
  const nativeSource = archive.read(base + indexName).toString();
  const boot = nativeSource.indexOf('const Ms=globalThis.dshDesktopBoot');
  const seed = nativeSource.match(/function (\w+)\(\)\{return\{react:[^}]+"@deepseek-ai\/dsh-client-ui-primitives":/);
  assert.ok(boot > 0 && seed, 'Installed rc.2 native bootstrap shape changed; inspect its module seed before updating fixture');
  const assets = new Map(entries.filter(name => /\.(js|css)$/.test(name)).map(name => [`/native/${name}`, archive.read(base + name)]));
  assets.set(`/native/${indexName}`, Buffer.from(nativeSource.slice(0, boot) + `\nexport const fixtureModules=${seed[1]}();`));
  const theme = archive.read('dsh/node_modules/@deepseek-ai/dsh-client-ui-theme/lib/client.js').toString();
  const themeCss = [...theme.matchAll(/var \w+_css_default = ("(?:[^"\\]|\\.)*");/g)].map(match => JSON.parse(match[1])).join('\n');
  assert.ok(themeCss.includes('--dsw-alias-bg-base'), 'Native DSH semantic tokens must be available');
  const source = sourceOverride ?? `
    import React from 'react';
    import {createRoot} from 'react-dom/client';
    import {TaskWorkspaceTab} from './src/task-workspace/client.tsx';
    const params=new URLSearchParams(location.search);
    function App(){
      const [sessionId,setSessionId]=React.useState(params.get('session')??'parent-a');
      return React.createElement(React.Fragment,null,
        React.createElement('aside',{'aria-label':'浏览器测试宿主'},
          React.createElement('strong',null,'任务工作台浏览器验收 · 固定测试模型'),
          React.createElement('label',null,'当前 DSH 会话',React.createElement('select',{'aria-label':'切换 DSH 会话',value:sessionId,onChange:e=>setSessionId(e.target.value)},
            React.createElement('option',{value:''},'无会话'),
            React.createElement('option',{value:'parent-a'},'测试 Agent A'),
            React.createElement('option',{value:'parent-b'},'测试 Agent B'),
            React.createElement('option',{value:'missing'},'已关闭 Agent')))),
        React.createElement('div',{id:'workspace'},React.createElement(TaskWorkspaceTab,{visible:true,tab:{id:'workspace',type:'dsh-redteam:tasks'},...(sessionId?{scope:{sessionId}}:{})})));
    }
    createRoot(document.getElementById('app')).render(React.createElement(App));
  `;
  const built = await build({ stdin: { contents: source, resolveDir: resolve('.'), sourcefile: 'task-workspace-fixture.ts' }, bundle: true, platform: 'browser', format: 'cjs', write: false, external: ['react', 'react-dom', '@deepseek-ai/dsh-client-ui-primitives'] });
  return {
    javascript: `import {fixtureModules} from '/native/${indexName}';\nconst require=id=>{if(!(id in fixtureModules))throw new Error('Missing native module '+id);return fixtureModules[id];};\n${built.outputFiles[0].text}`,
    css: themeCss,
    assets,
    html: '<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">' + entries.filter(name => name.endsWith('.css')).map(name => `<link rel="stylesheet" href="/native/${name}">`).join('') + '<link rel="stylesheet" href="/fixture.css"><style>body{margin:0;font:12px/1.5 system-ui;background:var(--dsw-alias-bg-module-platform)}aside{display:flex;gap:16px;align-items:center;padding:12px;flex-wrap:wrap}aside label{display:flex;gap:8px}#workspace{height:calc(100vh - 70px);width:min(100%,560px);margin:auto;box-shadow:0 0 0 1px var(--dsw-alias-border-l2)}</style></head><body><div id="app"></div><script type="module" src="/fixture.js"></script></body></html>',
  };
}

function readHostArchive() {
  const path = process.env.DSH_VERIFY_ASAR ?? join(process.env.LOCALAPPDATA, 'Programs', 'DeepSeek Harness', 'resources', 'app.asar');
  const fd = openSync(path, 'r'), prefix = Buffer.alloc(16);
  readSync(fd, prefix, 0, prefix.length, 0);
  const header = Buffer.alloc(prefix.readUInt32LE(12)); readSync(fd, header, 0, header.length, 16);
  const root = JSON.parse(header), offset = 8 + prefix.readUInt32LE(4);
  const entry = name => name.split('/').reduce((node, part) => node.files[part], root);
  // Read selected entries only, then close the archive; this never extracts or modifies the host.
  closeSync(fd);
  return { entry, read(name) { const node = entry(name), bytes = Buffer.alloc(node.size); const handle = openSync(path, 'r'); try { readSync(handle, bytes, 0, bytes.length, offset + Number(node.offset)); return bytes; } finally { closeSync(handle); } } };
}

export async function importCurrentWorkspaceSources() {
  const result = await build({ stdin: { contents: `
    export {installTaskWorkspaceApi} from './src/task-workspace/api.ts';
    export {RedTeamStore} from './src/store.ts';
    export {installPlanner} from './src/planner/integration.ts';
    export {TaskLifecycleRuntime} from './src/task-management/integration.ts';
    export {TaskProfileRegistry} from './src/task-management/runtime-profiles.ts';
    export {TaskModelRouter} from './src/task-management/runtime-model.ts';
  `, resolveDir: resolve('.'), loader: 'ts' }, bundle: true, platform: 'node', format: 'esm', packages: 'external', write: false });
  const code = result.outputFiles[0].text.replace(/from\s+(["'])([^"']+)\1/g, (_match, _quote, specifier) => `from ${JSON.stringify(import.meta.resolve(specifier))}`);
  return import(`data:text/javascript;base64,${Buffer.from(`${code}\n//# sourceURL=task-workspace-browser-server.mjs`).toString('base64')}`);
}
