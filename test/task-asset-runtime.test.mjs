import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { RedTeamStore } from '../lib/store.js';
import { ArtexWorkflow } from '../lib/artex.js';
import { ArchiveRuntime } from '../lib/archives.js';
import { registerRedTeamTools } from '../lib/tools.js';
import { assetCandidates, matchAssetRules, evaluateAssetGate, assertIntentAssetsAllowed } from '../lib/task-asset-runtime.js';

const rule = (kind,pattern,enabled=true) => ({ kind,pattern,enabled,note:'' });
const candidate = (domains=[],ips=[],urls=[]) => ({ domains,ips,urls });
const denied = error => error.code === 'asset_policy_denied';
async function fixture(t) {
  const dir=await mkdtemp(join(tmpdir(),'dsh-asset-policy-')); t.after(()=>rm(dir,{recursive:true,force:true}));
  const store=new RedTeamStore(join(dir,'store.json'));await store.load();const workflow=new ArtexWorkflow(store),tools=new Map();
  registerRedTeamTools({tools:{register(tool){tools.set(tool.name,tool);return()=>{};}}},store,workflow);
  const call=(name,args)=>tools.get(name).execute(args);
  const task=await store.createTask('Policy test','Goal');
  const add=(kind,value,metadata={})=>call('redteam_add_asset',{task_id:task.id,kind,value,metadata,source:'user'});
  return {dir,store,workflow,task,call,add};
}

test('ARTEX exact/fuzzy/CIDR rules retain original matching semantics',()=>{
  const cases=[
    ['exact_domain','Example.com',candidate([' example.com ']),true],
    ['exact_domain','example.com',candidate(['a.example.com']),false],
    ['fuzzy_domain','.gov.cn',candidate(['portal.GOV.CN']),true],
    ['fuzzy_domain','*.test',candidate(['app.test']),false],
    ['exact_ip','203.0.113.5',candidate([],['203.0.113.5']),true],
    ['fuzzy_ip','203.0.113.',candidate([],['203.0.113.99']),true],
    ['cidr','192.168.0.0/16',candidate([],['192.168.5.20']),true],
    ['cidr','192.168.0.0/16',candidate([],['10.0.0.1']),false],
    ['cidr','2001:db8::/32',candidate([],['2001:db8:1::23']),true],
    ['cidr','192.168.0.0/16',candidate([],['::ffff:192.168.5.20']),true],
    ['cidr','10.0.0.0/invalid',candidate([],['10.1.2.3']),false],
    ['exact_ip','2001:db8::1',candidate([],['2001:0db8::1']),false],
    ['exact_url','https://a.test/Login',candidate([],[],['https://a.test/login']),false],
    ['fuzzy_url','/ADMIN',candidate([],[],['https://x.test/admin/panel']),true],
    ['fuzzy_domain',' ',candidate(['test']),false]
  ];
  for(const [kind,pattern,candidates,expected] of cases) assert.equal(Boolean(matchAssetRules([rule(kind,pattern)],candidates)),expected,`${kind} ${pattern}`);
  assert.equal(matchAssetRules([rule('exact_domain','a.test',false)],candidate(['a.test'])),undefined);
  assert.equal(matchAssetRules([],candidate(['a.test'])),undefined);
});

test('ARTEX block precedes allow and disabled allow does not enable a whitelist',()=>{
  const block=[rule('fuzzy_domain','.gov.cn')],allow=[rule('fuzzy_domain','example.com')];
  assert.equal(evaluateAssetGate(block,allow,candidate(['www.gov.cn'])).allowed,false);
  assert.match(evaluateAssetGate(block,allow,candidate(['other.test'])).reason,/白名单/);
  assert.equal(evaluateAssetGate(block,allow,candidate(['api.example.com'])).allowed,true);
  assert.equal(evaluateAssetGate([],[],candidate()).allowed,true);
  assert.equal(evaluateAssetGate([],allow.map(r=>({...r,enabled:false})),candidate()).allowed,true);
  assert.equal(evaluateAssetGate(block,block,candidate(['www.gov.cn'])).allowed,false);
});

test('asset candidates include typed metadata, URL host and raw IPv6 spelling',()=>{
  const domains=assetCandidates({kind:'service',value:'https://user:pass@portal.gov.cn:8443/app',metadata:{root_domain:'gov.cn',bound_domains:['alt.test'],domain:'main.test',ip:'10.1.2.3',service_ip:'10.9.8.7'}});
  assert.deepEqual(domains.domains,['main.test','gov.cn','alt.test','portal.gov.cn']);assert.deepEqual(domains.ips,['10.1.2.3','10.9.8.7']);
  const ipv6=assetCandidates({kind:'service',value:'https://[2001:0db8::1]:8443/app',metadata:{}});
  assert.deepEqual(ipv6.ips,['2001:0db8::1']);assert.equal(matchAssetRules([rule('exact_ip','2001:db8::1')],ipv6),undefined);
  assert.ok(matchAssetRules([rule('cidr','2001:db8::/32')],ipv6));
  const urlOnly=assetCandidates({kind:'service',value:'service label',metadata:{url:'http://10.1.2.3/x'}});
  assert.ok(matchAssetRules([rule('cidr','10.0.0.0/8')],urlOnly));
});

test('native asset tool applies global and task rules atomically with useful reasons',async t=>{
  const {store,task,call,add}=await fixture(t);
  const builtins=await call('redteam_global_asset_rules',{action:'list'});assert.equal(builtins.length,4);assert.ok(builtins.every(r=>r.builtin&&r.enabled));
  let before=store.snapshot();await assert.rejects(add('service','https://portal.gov.cn:8443/app'),denied);assert.deepEqual(store.snapshot(),before);
  await call('redteam_task_asset_rules',{action:'create',task_id:task.id,rule:{...rule('fuzzy_domain','.test'),action:'allow'}});
  const blocked=await call('redteam_task_asset_rules',{action:'create',task_id:task.id,rule:{...rule('exact_domain','blocked.test'),action:'block'}});
  before=store.snapshot();await assert.rejects(add('domain','blocked.test'),e=>denied(e)&&e.hits[0].decision.ruleId===blocked.id);assert.deepEqual(store.snapshot(),before);
  await assert.rejects(add('domain','outside.example'),e=>denied(e)&&/白名单/.test(e.message));
  const accepted=await add('domain','allowed.test');assert.ok(store.snapshot().nodes.some(n=>n.id===accepted.id));
  await store.createTaskAssetRule(task.id,{...rule('fuzzy_domain','.gov'),action:'allow'});
  await assert.rejects(add('domain','portal.gov'),denied);
});

test('intent bindings check current policy against global asset IDs before graph/traces persist',async t=>{
  const {store,task,call,add}=await fixture(t);const asset=await add('domain','later-blocked.test');
  const other=await store.createTask('Other','Goal');
  await store.createTaskAssetRule(other.id,{...rule('exact_domain',asset.value),action:'block'});
  let before=store.snapshot();await assert.rejects(call('redteam_plan_intent',{task_id:other.id,summary:'Blocked foreign anchor',asset_ids:[asset.id]}),denied);assert.deepEqual(store.snapshot(),before);
  await store.createGlobalAssetRule(rule('exact_domain',asset.value));
  for(const input of [{assetIds:[asset.id]},{asset_ids:[asset.id]}]) {
    before=store.snapshot();await assert.rejects(store.addIntent({taskId:task.id,summary:'Blocked binding',input}),denied);assert.deepEqual(store.snapshot(),before);
  }
  assert.throws(()=>assertIntentAssetsAllowed(store.snapshot(),task.id,{assetIds:[asset.id]}),denied);
  await assert.rejects(call('redteam_plan_intent',{task_id:task.id,summary:'Cannot overwrite blocked input',input:{assetIds:[asset.id]},asset_ids:[]}),denied);
  await assert.rejects(store.addIntent({taskId:task.id,summary:'Malformed binding',input:{assetIds:'wrong'}}),/字符串数组/);
  const accepted=await call('redteam_plan_intent',{task_id:task.id,summary:'No binding',asset_ids:[]});assert.equal(accepted.state,'open');
});

test('global CRUD validates rules, preserves builtin status and persists intentional deletions',async t=>{
  const {store,call,dir}=await fixture(t);const builtin=store.listGlobalAssetRules()[0];
  const changed=await call('redteam_global_asset_rules',{action:'update',rule_id:builtin.id,rule:rule('exact_domain','custom.test')});assert.equal(changed.builtin,true);
  await call('redteam_global_asset_rules',{action:'toggle',rule_id:builtin.id,enabled:false});assert.equal(store.listGlobalAssetRules().find(r=>r.id===builtin.id).enabled,false);
  for(const row of store.listGlobalAssetRules()) await call('redteam_global_asset_rules',{action:'delete',rule_id:row.id});
  assert.deepEqual(await call('redteam_global_asset_rules',{action:'list'}),[]);
  const copy=join(dir,'restarted.json');await writeFile(copy,await readFile(store.storagePath));const restarted=new RedTeamStore(copy);await restarted.load();assert.deepEqual(restarted.snapshot().assetInterceptRules,[]);
  const before=store.snapshot();await assert.rejects(call('redteam_global_asset_rules',{action:'create',rule:rule('cidr','10.0.0.0/33')}),/CIDR|cidr/);assert.deepEqual(store.snapshot(),before);
  await assert.rejects(call('redteam_global_asset_rules',{action:'create',rule:{...rule('exact_domain','a.test'),action:'allow'}}),/always block/);
  const created=await call('redteam_global_asset_rules',{action:'create',rule:rule('exact_ip','203.0.113.1')});assert.equal(created.builtin,false);assert.equal('action' in created,false);
});

test('legacy missing collection seeds original defaults without duplicating persisted rules',async t=>{
  const {dir}=await fixture(t);const path=join(dir,'legacy.json');await writeFile(path,JSON.stringify({tasks:[]}));const legacy=new RedTeamStore(path);await legacy.load();
  assert.deepEqual(legacy.snapshot().assetInterceptRules.map(r=>r.pattern),['.gov','.gov.cn','.edu','.edu.cn']);
  await legacy.createTask('Persist','Goal');const persisted=JSON.parse(await readFile(path,'utf8'));assert.equal(persisted.assetInterceptRules.length,4);
});

test('malformed persisted or imported global policy is rejected at the data boundary',async t=>{
  const {store,dir}=await fixture(t);const before=store.snapshot();
  await assert.rejects(store.importSnapshot({assetInterceptRules:[{id:'broken',kind:'regex',pattern:'.*'}]}),/global asset rule/);assert.deepEqual(store.snapshot(),before);
  const path=join(dir,'invalid.json');await writeFile(path,JSON.stringify({tasks:[],assetInterceptRules:null}));await assert.rejects(new RedTeamStore(path).load(),/assetInterceptRules must be an array/);
});

test('task archives preserve historical assets and task rules without capturing global rules',async t=>{
  const {store,task,dir,add}=await fixture(t);const asset=await add('domain','history.test');
  await store.createTaskAssetRule(task.id,{...rule('exact_domain','history.test'),action:'block'});await store.setTaskStatus(task.id,'paused');
  const archives=new ArchiveRuntime(store,{dataDir:dir,lifecycle:{quiesce:async()=>{}}});const job=await archives.archive(task.id);
  const global=await store.createGlobalAssetRule(rule('exact_domain','history.test'));const globalBefore=store.snapshot().assetInterceptRules;
  await archives.restore(job.id);assert.deepEqual(store.snapshot().assetInterceptRules,globalBefore);assert.ok(store.snapshot().assets.some(a=>a.id===asset.id));
  assert.equal(store.snapshot().taskAssetRules.length,1);await assert.rejects(store.addIntent({taskId:task.id,summary:'New binding',input:{assetIds:[asset.id]}}),e=>denied(e)&&e.hits[0].decision.ruleId===global.id);
});
