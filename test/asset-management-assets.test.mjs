import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {build} from 'esbuild';
const built=await build({stdin:{contents:"export {AssetManagementRuntime} from './src/asset-management/assets.ts'; export {RedTeamStore} from './src/store.ts';",resolveDir:process.cwd(),loader:'ts'},bundle:true,write:false,platform:'node',format:'esm',packages:'external'});
const code=built.outputFiles[0].text.replace(/from\s+(["'])([^"']+)\1/g,(_m,_q,s)=>`from ${JSON.stringify(import.meta.resolve(s))}`);
const {AssetManagementRuntime,RedTeamStore}=await import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`);
async function fixture(t){const dir=await mkdtemp(join(tmpdir(),'asset-admin-'));t.after(()=>rm(dir,{recursive:true,force:true}));const store=new RedTeamStore(join(dir,'state.json'));await store.load();return {store,runtime:new AssetManagementRuntime(store)};}

test('global management natural-key upsert enriches one shared asset and reports item errors',async t=>{
  const {store,runtime}=await fixture(t);
  const first=await runtime.insert([{type:'root_domain',domain:' Example.COM. ',icp:'icp1'},{type:'ip',ip:'host.invalid'}]);
  assert.equal(first.results.length,1);assert.equal(first.errors.length,1);assert.equal(first.errors[0].index,1);
  const second=await runtime.insert([{type:'root_domain',domain:'example.com',icp:'icp2'}]);
  assert.equal(first.results[0].id,second.results[0].id);assert.equal(store.snapshot().assets.length,1);
  assert.equal(runtime.get(first.results[0].id).icp,'icp2');
  assert.deepEqual(runtime.counts(),{root_domain:1});
});

test('management listing uses server defaults, composed DSL/task filters and complete pagination total',async t=>{
  const {store,runtime}=await fixture(t),task=await store.createTask('T','Local fixture');
  await runtime.insert([{type:'root_domain',domain:'one.example'},{type:'app',app_name:'appA'}]);
  const inserted=await runtime.insert([{type:'root_domain',domain:'two.example'},{type:'app',app_name:'appB'}],task.id);
  assert.equal(runtime.list().total,2);
  assert.equal(runtime.list({dsl:'app_name="app%"'}).total,2);
  const taskRows=runtime.list({task_id:task.id});assert.equal(taskRows.total,2);
  assert.ok(taskRows.assets.every(row=>row.task_source==='api'));
  const page=runtime.list({task_id:task.id,limit:1});assert.equal(page.count,1);assert.equal(page.total,2);
  assert.deepEqual(runtime.list({task_id:task.id,offset:1000}),{count:0,total:2,assets:[]});
  assert.equal(runtime.list({dsl:'app_name="app%"',task_id:task.id}).assets[0].app_name,'appB');
  assert.equal(runtime.get(inserted.results[0].id).task_ids[0],task.id);
  assert.throws(()=>runtime.list({limit:1.5}),/integer/);
  assert.throws(()=>runtime.list({dsl:'(domain=one.example'}),/DSL/);
});

test('company filter takes precedence without DSL, while DSL ignores the separate company selector like ARTEX',async t=>{
  const {store,runtime}=await fixture(t),task=await store.createTask('T','Local fixture');
  const a=await runtime.insert([{type:'root_domain',domain:'first.example'}]),b=await runtime.insert([{type:'root_domain',domain:'second.example'}],task.id);
  await store.transaction(state=>{state.assets.find(row=>row.id===a.results[0].id).companyId='company-a';state.assets.find(row=>row.id===b.results[0].id).companyId='company-b';});
  assert.equal(runtime.list({company_id:'company-a',task_id:task.id}).assets[0].id,a.results[0].id);
  assert.equal(runtime.list({company_id:'company-a',dsl:'domain=second.example'}).assets[0].id,b.results[0].id);
});

test('bulk deletion removes live anchor references and preserves finding audit evidence',async t=>{
  const {store,runtime}=await fixture(t),task=await store.createTask('T','Local fixture');
  const result=await runtime.insert([{type:'root_domain',domain:'first.example'},{type:'root_domain',domain:'second.example'}],task.id);
  const [a,b]=result.results.map(row=>row.id);
  const finding=await store.addFinding({taskId:task.id,vulnClass:'Fixture',severity:'low',status:'pending',summary:'Evidence',assetIds:[a],evidenceIds:[],evidence:{output:'historical'}});
  await store.transaction(state=>{
    state.nodes.push({id:'fact',taskId:task.id,kind:'fact',label:'Fact',data:{asset_ids:[a,b]}});
    state.edges.push({id:'anchor',taskId:task.id,from:'fact',to:a,relation:'anchors'});
  });
  assert.deepEqual(await runtime.delete([a,a,'missing']),{deleted:1});
  const state=store.snapshot();assert.equal(state.assets.length,1);assert.equal(state.assets[0].id,b);
  assert.ok(!state.nodes.some(row=>row.id===a));assert.ok(!state.edges.some(row=>row.id==='anchor'));
  assert.deepEqual(state.nodes.find(row=>row.id==='fact').data.asset_ids,[b]);
  assert.deepEqual(state.findings.find(row=>row.id===finding.id).assetIds,[a]);
  assert.deepEqual(state.findings.find(row=>row.id===finding.id).evidence,{output:'historical'});
  await assert.rejects(runtime.delete([]),/nonempty/);
});
