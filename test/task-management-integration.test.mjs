import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { RedTeamStore } from '../lib/store.js';
import { ArtexWorkflow } from '../lib/artex.js';
import { ArchiveRuntime } from '../lib/archives.js';
import { registerRedTeamTools } from '../lib/tools.js';

const rule={enabled:true,action:'block',kind:'exact_domain',pattern:'blocked.test',note:'task policy'};
async function fixture(t){
  const dir=await mkdtemp(join(tmpdir(),'dsh-task-management-'));t.after(()=>rm(dir,{recursive:true,force:true}));
  const store=new RedTeamStore(join(dir,'store.json'));await store.load();const workflow=new ArtexWorkflow(store);const tools=new Map();
  registerRedTeamTools({tools:{register(tool){tools.set(tool.name,tool);return()=>{};}}},store,workflow);
  const call=(name,args)=>tools.get(name).execute(args);
  const archives=new ArchiveRuntime(store,{dataDir:dir,lifecycle:{quiesce:async()=>{}}});
  return {dir,store,workflow,call,archives};
}
test('legacy snapshots migrate task defaults and retain existing task management fields',async t=>{
  const {dir}=await fixture(t),path=join(dir,'legacy.json');
  await writeFile(path,JSON.stringify({version:1,tasks:[{id:'legacy',title:'Old',goal:'Goal',status:'draft',createdAt:'2026-01-01',updatedAt:'2026-01-01'},{id:'new',title:'New',goal:'Goal',status:'paused',createdAt:'2026-01-01',updatedAt:'2026-01-01',timeoutSeconds:30,coverageEnabled:false,planHeartbeatSeconds:900,sourceTaskIds:['legacy']}]}));
  const store=new RedTeamStore(path);await store.load();const state=store.snapshot();assert.equal(state.tasks[0].planHeartbeatSeconds,600);assert.deepEqual(state.tasks[0].companyIds,[]);assert.equal(state.tasks[0].coverageEnabled,true);assert.equal(state.tasks[1].timeoutSeconds,30);assert.equal(state.tasks[1].coverageEnabled,false);assert.deepEqual(state.taskAssetRules,[]);
  await store.updateTaskMetadata('legacy',{title:'Renamed'});assert.ok(JSON.parse(await readFile(path,'utf8')).taskCategories);
});
test('default store location honors the active DSH_HOME',async t=>{
  const {dir}=await fixture(t);const previous=process.env.DSH_HOME;process.env.DSH_HOME=dir;
  try{assert.equal(new RedTeamStore().storagePath,join(dir,'storages','redteam.json'));}finally{if(previous===undefined)delete process.env.DSH_HOME;else process.env.DSH_HOME=previous;}
});
test('advanced task tool copies template rules and company scope while linking shared company assets atomically',async t=>{
  const {store,call}=await fixture(t);const category=await call('redteam_task_categories',{action:'create',name:'  Web   Checks '});
  const template=await call('redteam_task_templates',{action:'create',name:'Web template',description:'Template description',goal:'Template goal',category_id:category.id,asset_rules:[rule]});
  const source=await store.createTask('source','source goal');const company=await store.addCompany({name:'Company'});
  await call('redteam_add_company_scope',{company_id:company.id,kind:'root_domain',value:'known.test'});
  const original=await call('redteam_add_asset',{task_id:'global',company_id:company.id,kind:'domain',value:'known.test',source:'user'});
  const task=await call('redteam_create_task',{template_id:template.id,source_task_ids:[source.id],company_ids:[company.id],seed_first_intent:true,timeout_seconds:120,plan_heartbeat_seconds:30,coverage_enabled:false});
  const state=store.snapshot();assert.equal(task.description,'Template description');assert.equal(task.goal,'Template goal');assert.equal(task.templateId,template.id);assert.equal(task.planHeartbeatSeconds,600);assert.equal(task.coverageEnabled,false);assert.equal(state.goals.filter(g=>g.taskId===task.id).length,0);
  assert.equal(state.taskAssetRules.find(r=>r.taskId===task.id).pattern,'blocked.test');assert.equal(state.scopes.find(s=>s.taskId===task.id).value,'known.test');
  assert.equal(state.assets.length,1);const linked=state.assets.find(a=>a.id===original.id);assert.equal(linked.taskId,'global');assert.deepEqual(linked.metadata.task_ids,[task.id]);assert.deepEqual(linked.metadata.task_sources,[{task_id:task.id,source:'company',summary:'任务创建时关联企业：Company'}]);
  const intent=state.intents.find(i=>i.taskId===task.id);assert.match(intent.summary,/Template goal/);assert.ok(state.edges.some(e=>e.taskId===task.id&&e.to===intent.id&&e.relation==='derived_from'));
  await call('redteam_task_templates',{action:'update',template_id:template.id,goal:'Changed later',asset_rules:[]});assert.equal(store.snapshot().tasks.find(t=>t.id===task.id).goal,'Template goal');assert.equal(store.snapshot().taskAssetRules.length,1);
  const before=store.snapshot();await assert.rejects(call('redteam_create_task',{company_ids:['missing'],seed_first_intent:true}),e=>e.code==='not_found');assert.deepEqual(store.snapshot(),before);
});
test('category and metadata tools preserve identity, return vanished task IDs, and clear references on delete',async t=>{
  const {store,call}=await fixture(t);const category=await call('redteam_task_categories',{action:'create',name:'Category'});await assert.rejects(call('redteam_task_categories',{action:'create',name:' category '}),e=>e.code==='conflict');
  const task=await call('redteam_create_task',{title:'Task',goal:'Goal'});const moved=await call('redteam_set_tasks_category',{task_ids:[task.id,'vanished'],category_id:category.id});assert.deepEqual(moved,{moved:[task.id],missing:['vanished']});
  const first=await call('redteam_update_task_metadata',{task_id:task.id,pinned:true,title:'New title'});const second=await call('redteam_update_task_metadata',{task_id:task.id,pinned:true});assert.equal(first.pinnedAt,second.pinnedAt);assert.equal((await call('redteam_list_tasks',{}))[0].title,'New title');
  const template=await call('redteam_task_templates',{action:'create',name:'template',description:'description',goal:'goal',category_id:category.id});await call('redteam_task_categories',{action:'delete',category_id:category.id});assert.equal(store.snapshot().tasks[0].categoryId,null);assert.equal(store.snapshot().taskTemplates.find(t=>t.id===template.id).categoryId,null);
});
test('asset policy CRUD enforces task ownership and stays separate from tool interception',async t=>{
  const {store,call}=await fixture(t);const a=await store.createTask('A','Goal'),b=await store.createTask('B','Goal');
  const row=await call('redteam_task_asset_rules',{action:'create',task_id:a.id,rule});await assert.rejects(call('redteam_task_asset_rules',{action:'toggle',task_id:b.id,rule_id:row.id,enabled:false}),e=>e.code==='conflict');
  await call('redteam_task_asset_rules',{action:'toggle',task_id:a.id,rule_id:row.id,enabled:false});assert.equal(store.snapshot().taskAssetRules[0].enabled,false);assert.deepEqual(store.snapshot().interceptRules,[]);
  await call('redteam_task_asset_rules',{action:'delete',task_id:a.id,rule_id:row.id});assert.deepEqual(await call('redteam_task_asset_rules',{action:'list',task_id:a.id}),[]);
});
test('direct source context excludes transitive tasks, live intents and private traces',async t=>{
  const {store,call}=await fixture(t);const ancestor=await store.createTask('ancestor','goal');const source=await store.createManagedTask({title:'source',sourceTaskIds:[ancestor.id]});const current=await store.createManagedTask({title:'current',sourceTaskIds:[source.id]});
  const done=await store.addIntent({taskId:source.id,summary:'done',input:{},state:'done'});const active=await store.addIntent({taskId:source.id,summary:'active',input:{},state:'running'});
  await store.addTrace({taskId:source.id,intentId:done.id,worker:'worker',kind:'result',summary:'completed trace'});await store.addTrace({taskId:source.id,intentId:active.id,worker:'worker',kind:'tool',summary:'private live'});await store.addTrace({taskId:source.id,worker:'planner',kind:'tool',summary:'private planner'});
  const view=await call('redteam_source_context',{task_id:current.id});assert.deepEqual(view.sources.map(t=>t.id),[source.id]);assert.deepEqual(view.intents.map(i=>i.id),[done.id]);assert.equal(view.traces.length,1);assert.equal(view.traces[0].inherited,true);assert.equal(view.nodes.some(n=>n.taskId===ancestor.id||n.id===active.id),false);
  view.nodes[0].label='mutated';assert.equal(store.snapshot().nodes.some(n=>n.label==='mutated'),false);
});
test('task archive restores category/template references, policy snapshots and advanced clocks',async t=>{
  const {store,archives}=await fixture(t);const category=await store.createTaskCategory('Archive category');const template=await store.createTaskTemplate({name:'Archive template',description:'description',goal:'goal',categoryId:category.id,interceptRules:[rule]});
  const task=await store.createManagedTask({title:'archive',templateId:template.id,timeoutSeconds:100,coverageEnabled:false,seedFirstIntent:true});await store.setTaskStatus(task.id,'timeout');
  await store.transaction(s=>{const row=s.tasks.find(t=>t.id===task.id);row.firstRunAt='2026-10-18T00:00:00Z';row.deadlineAt='2026-10-18T00:01:40Z';});
  const job=await archives.archive(task.id);assert.equal(store.snapshot().taskAssetRules.length,0);await store.deleteTaskTemplate(template.id);await store.deleteTaskCategory(category.id);await archives.restore(job.id);
  const state=store.snapshot(),restored=state.tasks.find(t=>t.id===task.id);assert.equal(restored.status,'timeout');assert.equal(restored.templateId,template.id);assert.equal(restored.categoryId,category.id);assert.equal(restored.deadlineAt,'2026-10-18T00:01:40Z');assert.equal(restored.coverageEnabled,false);assert.equal(state.taskAssetRules[0].pattern,'blocked.test');assert.ok(state.taskTemplates.some(t=>t.id===template.id));assert.ok(state.taskCategories.some(c=>c.id===category.id));
});
test('archive restore remaps equivalent category/template names and rejects changed identity without partial state',async t=>{
  const {store,archives}=await fixture(t);const category=await store.createTaskCategory('Shared');const template=await store.createTaskTemplate({name:'Shared template',description:'description',goal:'goal',categoryId:category.id});const task=await store.createManagedTask({templateId:template.id});await store.setTaskStatus(task.id,'paused');
  const job=await archives.archive(task.id);await store.renameTaskCategory(category.id,'Renamed');await assert.rejects(archives.restore(job.id),/category id conflict/);assert.equal(store.snapshot().tasks.some(t=>t.id===task.id),false);
  await store.deleteTaskTemplate(template.id);await store.deleteTaskCategory(category.id);const replacement=await store.createTaskCategory('Shared');const replacementTemplate=await store.createTaskTemplate({name:'Shared template',description:'description',goal:'goal',categoryId:replacement.id});await archives.restore(job.id);
  const restored=store.snapshot().tasks.find(t=>t.id===task.id);assert.equal(restored.categoryId,replacement.id);assert.equal(restored.templateId,replacementTemplate.id);assert.equal(store.snapshot().taskCategories.length,1);
});
test('queued/terminal tasks cannot claim native execution and unavailable LLM profile cannot be persisted',async t=>{
  const {store}=await fixture(t);const task=await store.createTask('Task','Goal');await store.addIntent({taskId:task.id,summary:'intent',input:{}});await store.transaction(s=>{s.tasks[0].queued=true;});
  await assert.rejects(store.claimIntent(task.id,'worker',{execution:{childSessionId:'child',parentSessionId:'parent',provider:'spawn'},concurrency:4}),/queued/);
  await assert.rejects(store.claimIntent(task.id,'manual-worker'),/queued/);
  await assert.rejects(store.createManagedTask({llmProfileIds:['unknown']}),/profile|配置/i);
});
