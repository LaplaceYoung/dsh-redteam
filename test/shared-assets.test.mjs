import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { RedTeamStore, ArchiveRuntime, assetTaskIds, associateTaskAsset, deleteManagedTaskData, TaskLifecycleRuntime } from './shared-assets-fixtures.mjs';

async function fixture(t) {
  const dir = await mkdtemp(join(tmpdir(), 'shared-assets-'));
  const store = new RedTeamStore(join(dir, 'state.json')); await store.load();
  const a = await store.createTask('A', 'A goal'), b = await store.createTask('B', 'B goal');
  await store.setTaskStatus(a.id, 'paused'); await store.setTaskStatus(b.id, 'paused');
  const archives = new ArchiveRuntime(store, { dataDir: dir, lifecycle: { quiesce: async () => {} } });
  t.after(() => rm(dir, { recursive: true, force: true }));
  return { store, archives, a, b, dir };
}
async function asset(f, owner = f.a.id, value = 'shared.example.test') {
  return f.store.addAsset({ taskId: owner, kind: 'root_domain', value, source: 'user', metadata: { domain: value, page_title: 'archived title' } });
}

test('company task creation links the existing global asset and records company provenance without cloning', async t => {
  const f = await fixture(t), company = await f.store.addCompany({ name: 'Example Company' });
  const row = await f.store.addAsset({ taskId: 'global', companyId: company.id, kind: 'root_domain', value: 'company.test', source: 'user', metadata: {} });
  const a = await f.store.createManagedTask({ title: 'Company A', companyIds: [company.id] });
  const b = await f.store.createManagedTask({ title: 'Company B', companyIds: [company.id] });
  assert.equal(f.store.snapshot().assets.length, 1);
  const shared = f.store.snapshot().assets[0]; assert.equal(shared.id, row.id); assert.equal(shared.taskId, 'global');
  assert.deepEqual(assetTaskIds(shared), [a.id, b.id]);
  assert.deepEqual(shared.metadata.task_sources, [a,b].map(task => ({ task_id: task.id, source: 'company', summary: '任务创建时关联企业：Example Company' })));
});

test('two-task archive detaches only A and restore preserves B live business fields and provenance', async t => {
  const f = await fixture(t), row = await asset(f);
  await f.store.transaction(state => { associateTaskAsset(state.assets[0], f.a.id, {source:'worker',summary:'A source'}); associateTaskAsset(state.assets[0], f.b.id, {source:'worker',summary:'B source'}); });
  const archive = await f.archives.archive(f.a.id);
  let live = f.store.snapshot().assets[0]; assert.equal(live.id, row.id); assert.equal(live.taskId, f.b.id); assert.deepEqual(assetTaskIds(live), [f.b.id]);
  await f.store.transaction(state => { state.assets[0].metadata.page_title = 'B newer title'; state.assets[0].metadata.new_live_field = 'preserve'; state.assets[0].metadata.task_sources[0].summary = 'B newer source'; });
  await f.archives.restore(archive.id);
  live = f.store.snapshot().assets[0]; assert.equal(f.store.snapshot().assets.length, 1); assert.equal(live.metadata.page_title, 'B newer title'); assert.equal(live.metadata.new_live_field, 'preserve');
  assert.deepEqual(new Set(assetTaskIds(live)), new Set([f.a.id,f.b.id]));
  assert.equal(live.metadata.task_sources.find(s => s.task_id === f.b.id).summary, 'B newer source');
  assert.equal(live.metadata.task_sources.find(s => s.task_id === f.a.id).summary, 'A source');
});

test('archive protects another task anchor-only reference, company assets and unrelated global assets', async t => {
  const f = await fixture(t), row = await asset(f), company = await f.store.addCompany({name:'Kept'});
  const companyAsset = await f.store.addAsset({taskId:f.a.id,companyId:company.id,kind:'ip',value:'192.0.2.1',source:'user',metadata:{}});
  await f.store.transaction(state => {
    state.assets.push({id:'global-unrelated',taskId:'global',kind:'ip',value:'192.0.2.2',source:'user',metadata:{},createdAt:f.a.createdAt});
    state.nodes.push({id:'b-fact',taskId:f.b.id,kind:'fact',label:'B evidence',data:{}});
    state.edges.push({id:'b-anchor',taskId:f.b.id,from:'b-fact',to:row.id,relation:'anchors'});
  });
  const archive = await f.archives.archive(f.a.id), state = f.store.snapshot();
  assert.deepEqual(new Set(state.assets.map(a=>a.id)), new Set([row.id,companyAsset.id,'global-unrelated']));
  assert.equal(state.assets.find(a=>a.id===row.id).taskId,'global');
  assert.ok(state.edges.some(e=>e.id==='b-anchor')); assert.equal(archive.dataCounts.assets,2);
  await f.archives.restore(archive.id); assert.equal(f.store.snapshot().assets.length,3);
});

async function references(f, row) {
  const intent = await f.store.addIntent({taskId:f.a.id,summary:'intent',state:'open',input:{asset_ids:[row.id],assetIds:[row.id]}});
  const finding = await f.store.addFinding({taskId:f.a.id,vulnClass:'fixture',severity:'info',summary:'finding',assetIds:[row.id],evidenceIds:[],status:'open'});
  await f.store.transaction(state => {state.nodes.push({id:'a-fact',taskId:f.a.id,kind:'fact',label:'anchored fact',data:{asset_ids:[row.id],assetIds:[row.id]}});state.edges.push({id:'a-anchor',taskId:f.a.id,from:'a-fact',to:row.id,relation:'anchors'});});
  return {intent,finding};
}
function assertReferences(state, taskId, refs, id) {
  assert.deepEqual(state.intents.find(i=>i.id===refs.intent.id).input,{asset_ids:[id],assetIds:[id]});
  assert.deepEqual(state.findings.find(i=>i.id===refs.finding.id).assetIds,[id]);
  assert.deepEqual(state.nodes.find(n=>n.id==='a-fact').data,{asset_ids:[id],assetIds:[id]});
  assert.equal(state.edges.find(e=>e.id==='a-anchor').to,id);
  assert.equal(state.edges.find(e=>e.taskId===taskId && e.relation==='affects').to,id);
  assert.equal(state.nodes.filter(n=>n.kind==='asset' && n.id===id).length,1);
}

test('restore reuses a new live ID with the same natural key and remaps every task asset reference', async t => {
  const f=await fixture(t),row=await asset(f),refs=await references(f,row),archive=await f.archives.archive(f.a.id);
  assert.equal(f.store.snapshot().assets.length,0);
  const replacement=await asset(f,f.b.id); await f.store.transaction(s=>{s.assets[0].metadata.page_title='New live fields';});
  const warnings=await f.archives.restore(archive.id),state=f.store.snapshot();
  assert.equal(state.assets.length,1);assert.equal(state.assets[0].id,replacement.id);assert.equal(state.assets[0].metadata.page_title,'New live fields');
  assertReferences(state,f.a.id,refs,replacement.id);assert.ok(warnings.some(w=>w.includes(row.id)&&w.includes(replacement.id)));
});

test('restore allocates a fresh ID when old ID now belongs to another natural key', async t => {
  const f=await fixture(t),row=await asset(f),refs=await references(f,row),archive=await f.archives.archive(f.a.id);
  await f.store.transaction(s=>s.assets.push({...row,taskId:f.b.id,value:'different.test',metadata:{domain:'different.test',page_title:'keep this'}}));
  const warnings=await f.archives.restore(archive.id),state=f.store.snapshot(),restored=state.assets.find(a=>a.value===row.value);
  assert.notEqual(restored.id,row.id);assert.equal(state.assets.find(a=>a.id===row.id).value,'different.test');assertReferences(state,f.a.id,refs,restored.id);assert.ok(warnings.some(w=>w.includes('occupied')));
});

test('task snapshot includes global graph-only assets, excludes source-task bulk assets, and cold package deletion leaves live assets alone', async t => {
  const f=await fixture(t),b=await asset(f,f.b.id,'b-only.test');
  await f.store.transaction(s=>{s.tasks.find(t=>t.id===f.a.id).sourceTaskIds=[f.b.id];s.assets.push({id:'global-ref',taskId:'global',kind:'ip',value:'192.0.2.9',source:'user',metadata:{},createdAt:f.a.createdAt});s.nodes.push({id:'global-fact',taskId:f.a.id,kind:'fact',label:'fact',data:{asset_ids:['global-ref']}});});
  const archive=await f.archives.archive(f.a.id);assert.equal(archive.dataCounts.assets,1);assert.deepEqual(f.store.snapshot().assets.map(a=>a.id),[b.id]);
  await f.archives.delete(archive.id);assert.deepEqual(f.store.snapshot().assets.map(a=>a.id),[b.id]);
});

test('ordinary deletion retains global assets while explicit deletion removes only unshared candidates, including company assets', async t => {
  const f=await fixture(t),shared=await asset(f),company=await f.store.addCompany({name:'Company'});
  const exclusive=await f.store.addAsset({taskId:f.a.id,companyId:company.id,kind:'ip',value:'192.0.2.4',source:'user',metadata:{}});
  await f.store.transaction(s=>associateTaskAsset(s.assets.find(a=>a.id===shared.id),f.b.id));
  const first=await f.store.transaction(s=>deleteManagedTaskData(s,f.a.id));assert.equal(first.assetsDeleted,0);assert.equal(first.assetsDetached,2);assert.equal(f.store.snapshot().assets.length,2);
  const c=await f.store.createTask('C','C');await f.store.transaction(s=>associateTaskAsset(s.assets.find(a=>a.id===exclusive.id),c.id));
  const second=await f.store.transaction(s=>deleteManagedTaskData(s,c.id,{deleteAssets:true}));assert.equal(second.assetsDeleted,1);assert.deepEqual(f.store.snapshot().assets.map(a=>a.id),[shared.id]);
  assert.equal((await f.store.transaction(s=>deleteManagedTaskData(s,c.id))).deleted,false);
});

test('deleteAssets protects another task graph-only asset reference and removes only current provenance', async t => {
  const f=await fixture(t),row=await asset(f);
  await f.store.transaction(s=>{associateTaskAsset(s.assets[0],f.a.id,{source:'worker',summary:'A'});s.nodes.push({id:'b-reference',taskId:f.b.id,kind:'fact',label:'B reference',data:{assetIds:[row.id]}});});
  const result=await f.store.transaction(s=>deleteManagedTaskData(s,f.a.id,{deleteAssets:true}));assert.equal(result.assetsDeleted,0);assert.equal(result.assetsDetached,1);assert.equal(f.store.snapshot().assets[0].taskId,'global');assert.deepEqual(f.store.snapshot().assets[0].metadata.task_sources,[]);
});

test('source-only membership protects a shared asset and deleting a task clears source-task links', async t => {
  const f=await fixture(t),row=await asset(f);
  await f.store.transaction(s=>{s.assets[0].metadata.task_sources=[{task_id:f.b.id,source:'worker',summary:'B only source link'}];s.tasks.find(t=>t.id===f.b.id).sourceTaskIds=[f.a.id];});
  const result=await f.store.transaction(s=>deleteManagedTaskData(s,f.a.id,{deleteAssets:true}));
  assert.equal(result.assetsDeleted,0);assert.equal(f.store.snapshot().assets[0].id,row.id);assert.equal(f.store.snapshot().assets[0].taskId,f.b.id);assert.deepEqual(f.store.snapshot().tasks[0].sourceTaskIds,[]);
});

test('ordinary task deletion preserves standalone findings and evidence; explicit finding deletion removes their records', async t => {
  const f=await fixture(t),evidence=await f.store.addEvidence({taskId:f.a.id,provider:'worker',summary:'proof',raw:{proof:true}});
  const finding=await f.store.addFinding({taskId:f.a.id,vulnClass:'fixture',severity:'info',summary:'retain',assetIds:[],evidenceIds:[evidence.id],status:'open'});
  const result=await f.store.transaction(s=>deleteManagedTaskData(s,f.a.id));assert.equal(result.findingsDeleted,0);assert.equal(f.store.snapshot().findings[0].id,finding.id);assert.equal(f.store.snapshot().evidence[0].id,evidence.id);
  const second=await f.store.addFinding({taskId:f.b.id,vulnClass:'fixture',severity:'info',summary:'remove',assetIds:[],evidenceIds:[],status:'open'});
  const deleted=await f.store.transaction(s=>deleteManagedTaskData(s,f.b.id,{deleteFindings:true}));assert.equal(deleted.findingsDeleted,1);assert.ok(!f.store.snapshot().findings.some(row=>row.id===second.id));assert.equal(f.store.snapshot().evidence[0].id,evidence.id);
});

test('lifecycle delete drains execution, commits writer fence, unbinds task and rolls back fence on failed persistence', async t => {
  const f=await fixture(t),parent={id:'real-parent',options:{provider:'fixture',model:'fixture'}},events=[];
  const planner={status:()=>({}),start:async()=>({}),pause:async id=>{events.push('drain');await f.store.setTaskStatus(id,'paused');return{};},park:async()=>{},beginSettling:async()=>{},finalize:async()=>({met:false})};
  const runtime=new TaskLifecycleRuntime(f.store,planner,{selectRoute:async()=>({available:true})},{concurrency:1,autoPoll:false,prepareTaskDelete:async()=>{events.push('prepare');return{commit:async()=>events.push('commit'),rollback:async()=>events.push('rollback')};}});
  t.after(()=>runtime.dispose());runtime.bindParent(f.a.id,parent);
  await runtime.deleteTask(f.a.id,parent);assert.deepEqual(events,['prepare','drain','commit']);assert.equal(runtime.taskForAgent(parent.id),undefined);
  events.length=0;const transaction=f.store.transaction.bind(f.store);
  f.store.transaction=fn=>transaction(state=>{const result=fn(state);if(!state.tasks.some(t=>t.id===f.b.id))throw new Error('fixture disk failure');return result;});
  await assert.rejects(runtime.deleteTask(f.b.id,parent),/fixture disk failure/);assert.deepEqual(events,['prepare','drain','rollback']);assert.ok(f.store.snapshot().tasks.some(t=>t.id===f.b.id));
});

test('post-commit writer cleanup failure is reported and the next delete retries cleanup without replaying deletion', async t => {
  const f=await fixture(t),parent={id:'parent',options:{}},events=[];let fail=true;
  const planner={status:()=>({}),start:async()=>({}),pause:async id=>{await f.store.setTaskStatus(id,'paused');return{};},park:async()=>{},beginSettling:async()=>{},finalize:async()=>({met:false})};
  const runtime=new TaskLifecycleRuntime(f.store,planner,{selectRoute:async()=>({available:true})},{concurrency:1,autoPoll:false,prepareTaskDelete:async()=>{events.push('prepare');return{commit:async()=>{events.push('commit');if(fail)throw new Error('cleanup disk failure');},rollback:async()=>events.push('rollback')};}});
  t.after(()=>runtime.dispose());
  await assert.rejects(runtime.deleteTask(f.a.id,parent),/task deleted; conversation cleanup failed/);assert.ok(!f.store.snapshot().tasks.some(t=>t.id===f.a.id));
  fail=false;assert.equal((await runtime.deleteTask(f.a.id,parent)).deleted,false);assert.deepEqual(events,['prepare','commit','commit']);
});
