import test from 'node:test';
import { TrafficRuntime } from '../lib/traffic.js';
import { installTrafficControls } from '../lib/traffic-tools/controls.js';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { RedTeamStore } from '../lib/store.js';
import { TrafficQuery, installTrafficTools } from '../lib/traffic-tools/index.js';
import { Context } from '@deepseek-ai/cordis';
import ToolRuntime from '@deepseek-ai/dsh-tools';
import SystemPrompt from '@deepseek-ai/dsh-system-prompt';
import { SessionStore, SessionId } from '@deepseek-ai/dsh-session';
import AgentRegistry from '@deepseek-ai/dsh-agent';
import AgentLoop from '@deepseek-ai/dsh-agent-loop';
import LlmRuntime from '@deepseek-ai/dsh-llm';
import SessionProjections from '@deepseek-ai/dsh-session-projection';

async function fixture(t) {
  const dir = await mkdtemp(join(tmpdir(), 'traffic-query-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const store = new RedTeamStore(join(dir, 'state.json'));
  const task = await store.createTask('Query', 'Capture fidelity');
  return { dir, store, task, query: new TrafficQuery(store) };
}

test('ARTEX search isolates explicit ports, requires host, searches captured text and pages lightweight metadata', async t => {
  const { store, task, query } = await fixture(t);
  for (let i = 0; i < 12; i++) await store.addTraffic({ taskId: task.id, workerSessionId: 'child', capturedAt: `2026-10-18T00:00:${String(i).padStart(2,'0')}.000Z`, host: '127.0.0.1', method: 'GET', url: `http://127.0.0.1:8081/user/${i}`, status: i % 2 ? 404 : 200, response: { headers: { 'Content-Type': 'text/plain' }, body: `记录内容 ${i}` } });
  await store.addTraffic({ taskId: task.id, host: '127.0.0.1', method: 'GET', url: 'http://127.0.0.1:8082/user/99', status: 200, response: { body: '记录内容 wrong service' } });
  assert.equal((await query.search({ host: '127.0.0.1' })).length, 3);
  const rows = await query.search({ host: 'http://127.0.0.1:8081/path', body_contains: '记录内容', limit: 20 });
  assert.equal(rows.length, 10);
  assert.deepEqual(Object.keys(rows[0]), ['id','method','url','status','resp_len']);
  assert.match(rows[0].url, /8081\/user\/11$/);
  assert.equal((await query.search({ host: '127.0.0.1:8081', limit: 10, page: 1 })).length, 2);
  await assert.rejects(query.search({ host: '' }), /host 为必填/);
  await assert.rejects(query.search({ host: '127.0.0.1', body_contains: '记录' }), /至少需要 3/);
  const page = await query.page({ task_id: task.id, worker_session_id: 'child', method: 'get', path: '/user/{id}', status: '4xx', resp_min: 5, sort: 'ts', order: 'asc', size: 2 });
  assert.equal(page.count, 13); assert.equal(page.total, 6); assert.equal(page.exchanges.length, 2);
  assert.match(page.exchanges[0].url, /\/user\/1$/);
  assert.equal((await query.page({ q: '记录内容' })).total, 13);
  assert.equal((await query.page({ body: '记录' })).total, 13, 'ARTEX list ignores a body filter shorter than three characters');
  assert.equal(query.stats({ worker_session_id: 'child' }).count, 12);
  assert.deepEqual(query.stats().hosts, [{ host: '127.0.0.1', count: 13 }]);
});

test('large bodies keep hash references, byte paging, text search beyond the preview and binary fidelity', async t => {
  const { store, task, query } = await fixture(t);
  const data = Buffer.from('a'.repeat(700000) + '正文尾部证据');
  const hash = createHash('sha256').update(data).digest('hex');
  const directory = join(query.blobRoot, hash.slice(0,2)); await mkdir(directory, { recursive: true }); await writeFile(join(directory, `${hash}.bin`), data);
  const row = await store.addTraffic({ taskId: task.id, host: 'fixture.test', method: 'POST', url: 'http://fixture.test/upload', status: 201,
    request: { startLine: 'POST /upload HTTP/1.1', headerFields: [['X-Test','one'],['X-Test','two']], bodyBase64: Buffer.from([0,255,128,65]).toString('base64'), bodyLength: 4, binary: true },
    response: { startLine: 'HTTP/1.1 201 Created', headerFields: [['Content-Type','text/plain']], body: data.subarray(0,8192).toString(), bodySha256: hash, bodyLength: data.length, binary: false } });
  assert.match(query.get(row.id), /X-Test: one\nX-Test: two/);
  assert.match(query.get(row.id), new RegExp(`@blob sha256:${hash}`));
  const tail = await query.blob(hash, 700000, 100);
  assert.equal(tail.text, '正文尾部证据'); assert.equal(tail.total, data.length);
  assert.equal((await query.search({ host: 'fixture.test', body_contains: '正文尾部证据' }))[0].id, row.id);
  assert.deepEqual(Buffer.from((await query.body(row.id, 'request')).base64,'base64'), Buffer.from([0,255,128,65]));
  assert.equal((await query.blob(hash, 0, 99999)).length, 8192);
  assert.equal((await query.blob(hash, data.length + 1)).length, 0);
  await assert.rejects(query.blob(hash, -1), /nonnegative/);
  await assert.rejects(query.blob('../outside'), /not referenced/);
  await rm(join(directory, `${hash}.bin`));
  await assert.rejects(query.body(row.id, 'response'), { code: 'ENOENT' });
});

test('traffic tools register on real DSH ToolRuntime and execute the upstream lookup contracts', async t => {
  const { store, task } = await fixture(t);
  const row = await store.addTraffic({ taskId: task.id, host: 'fixture.test', method: 'GET', url: 'http://fixture.test/a', status: 200, response: { body: 'readable' } });
  const app = new Context();
  const prompt = await app.plugin(SystemPrompt, {});
  const tools = await app.plugin(ToolRuntime, { mode: 'native' });
  const plugin = await app.plugin({ inject: ['tools'], apply: ctx => { installTrafficTools(ctx, store); } });
  t.after(async () => { await plugin.dispose(); await tools.dispose(); await prompt.dispose(); });
  const call = async (name,args) => {
    const result = await app.get('tools').execute({ callId: name, name, arguments: args, signal: AbortSignal.timeout(1000) });
    assert.equal(result.isError, false, JSON.stringify(result)); return result.value;
  };
  assert.equal((await call('traffic_search', { host: 'fixture.test' }))[0].id, row.id);
  assert.match(await call('traffic_get', { id: row.id }), /readable/);
  assert.equal((await call('redteam_traffic_page', {})).total, 1);
  assert.equal((await call('redteam_traffic_stats', {})).count, 1);
  assert.equal((await call('redteam_traffic_delete_hosts', {hosts:['fixture.test']})).deleted,1);
  assert.equal((await call('redteam_traffic_stats', {})).count,0);
  const invalid = await app.get('tools').execute({ callId: 'missing', name: 'traffic_get', arguments: { id: 'missing' }, signal: AbortSignal.timeout(1000) });
  assert.equal(invalid.isError, true);
});

test('traffic controls persist the independent agent binding policy through real DSH tools', async t=>{
  const {store}=await fixture(t);const traffic=new TrafficRuntime(store);
  const app=new Context();const prompt=await app.plugin(SystemPrompt,{});const tools=await app.plugin(ToolRuntime,{mode:'native'});
  const plugin=await app.plugin({inject:['tools'],apply:ctx=>installTrafficControls(ctx,traffic)});
  t.after(async()=>{await plugin.dispose();await tools.dispose();await prompt.dispose();});
  const call=async(name,args={})=>{const result=await app.get('tools').execute({callId:name,name,arguments:args,signal:AbortSignal.timeout(5000)});assert.equal(result.isError,false,JSON.stringify(result));return result.value;};
  assert.equal((await call('redteam_traffic_settings')).trafficBindingEnabled,false);
  assert.equal((await call('redteam_traffic_set_binding',{enabled:true})).trafficBindingEnabled,true);
  const configuration=await call('redteam_traffic_set_proxy',{url:'http://user:secret@localhost:8888'});
  assert.equal(configuration.trafficBindingEnabled,true);assert.equal(configuration.globalProxy,'http://***:***@localhost:8888/');
  await call('redteam_traffic_set_enabled',{enabled:false});
  const recovered=new TrafficRuntime(store);await recovered.load();assert.equal(recovered.configuration().trafficBindingEnabled,true);
  assert.equal(recovered.configuration().captureEnabled,false);
});

test('capture toggle changes actual scoped tool schemas immediately without removing UI lookups or other scopes',async t=>{
  const first=await fixture(t),second=await fixture(t);
  const left=new TrafficRuntime(first.store),right=new TrafficRuntime(second.store);
  await left.load();await right.setCaptureEnabled(true);
  const app=new Context(),fibers=[],handles=[];
  t.after(async()=>{for(const handle of handles.reverse())await handle.dispose();for(const fiber of fibers.reverse())await fiber.dispose();});
  for(const [module,config] of [[SessionStore],[AgentRegistry],[LlmRuntime],[SystemPrompt,{}],[ToolRuntime,{mode:'native'}],[SessionProjections],[AgentLoop,{}]])fibers.push(await app.plugin(module,config));
  fibers.push(await app.plugin({inject:['tools'],apply:ctx=>installTrafficControls(ctx,left)}));
  const make=async(store,runtime)=>{
    const handle=await app.get('agents').create({sessionId:SessionId(randomUUID()),setup:async ctx=>{await ctx.plugin({inject:['tools'],apply:scope=>{installTrafficTools(scope,store,runtime);}});}});
    handles.push(handle);return handle.agent;
  };
  const a=await make(first.store,left),b=await make(second.store,right);
  const names=agent=>new Set(app.get('tools').schemas(agent).map(tool=>tool.name));
  const lookup=['traffic_search','traffic_get','traffic_blob'];
  for(const name of lookup){assert.equal(names(a).has(name),false);assert.equal(names(b).has(name),true);}
  assert.equal(names(a).has('redteam_traffic_page'),true);assert.equal(names(a).has('redteam_traffic_settings'),true);
  await left.setCaptureEnabled(true);
  for(const name of lookup)assert.equal(names(a).has(name),true);
  await left.setCaptureEnabled(false);
  for(const name of lookup){assert.equal(names(a).has(name),false);assert.equal(names(b).has(name),true);}
  assert.equal(names(a).has('redteam_traffic_page'),true);assert.equal(names(b).has('redteam_traffic_settings'),true);
  const result=await app.get('tools').execute({callId:'unavailable',name:'traffic_search',arguments:{host:'fixture.test'},agent:a,signal:AbortSignal.timeout(5000)});
  assert.equal(result.isError,true);
});
