import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { RedTeamStore } from '../lib/store.js';
import { FindingsRuntime } from '../lib/findings-reports/runtime.js';
import { FindingRetests } from '../lib/findings-reports/retests.js';

async function fixture(t) {
  const dir = await mkdtemp(join(tmpdir(), 'findings-')); t.after(() => rm(dir, {recursive:true,force:true}));
  const store = new RedTeamStore(join(dir, 'state.json')); await store.load();
  const task = await store.createTask('证据测试','验证证据');
  const runtime = new FindingsRuntime(store);
  const input = { taskId:task.id,vulnClass:'SQLi',severity:'high',summary:'实际证据',status:'pending',assetIds:[],evidenceIds:[] };
  const traffic = await store.addTraffic({taskId:task.id,host:'test.local',method:'GET',url:'https://test.local/a',status:200,request:{startLine:'GET /a HTTP/1.1',headerFields:[['Host','test.local']],bodyBase64:'',bodyLength:0},response:{startLine:'HTTP/1.1 200 OK',headerFields:[['Content-Type','text/plain']],bodyBase64:Buffer.from('真实输出\u0000').toString('base64'),bodyLength:13}});
  return {store,task,runtime,input,traffic};
}
test('real capture binds atomically; duplicate does not overwrite notes; deleted traffic retains bytes', async t => {
  const {store,runtime,input,traffic} = await fixture(t);
  const f = await runtime.record(input,[{trafficId:traffic.id,role:'proof',note:'first'}]);
  assert.equal(f.evidenceVersion,1); assert.equal(store.snapshot().notificationEvents.length,1);
  await runtime.bindTraffic(f.id,[{trafficId:traffic.id,note:'overwrite?'}]);
  const view = runtime.traffic(f.id); assert.equal(view.bindings.length,1); assert.equal(view.version,1); assert.equal(view.bindings[0].note,'first');
  await store.transaction(s => { s.traffic=[]; });
  const part = runtime.body(f.id,view.bindings[0].id,'response',0,6);
  assert.equal(Buffer.from(part.base64,'base64').toString(),'真实'); assert.equal(part.total,13); assert.equal(part.eof,false);
  const reloaded = new RedTeamStore(store.storagePath); await reloaded.load(); assert.equal(reloaded.snapshot().findings[0].trafficBindings.length,1);
});
test('mixed valid/invalid references leave neither finding nor notification', async t => {
  const {store,runtime,input,traffic} = await fixture(t);
  await assert.rejects(runtime.record(input,[{trafficId:traffic.id},{trafficId:'missing'}]),/not found/);
  assert.equal(store.snapshot().findings.length,0); assert.equal(store.snapshot().notificationEvents.length,0);
});
test('local evidence hint preserves ordered traffic refs and inherited hint is refused',async t=>{
  const {store,runtime,input,traffic}=await fixture(t);
  await store.addNode({id:'hint',taskId:input.taskId,kind:'fact',label:'证据交接',data:{kind:'strategic_hint',traffic_refs:[{traffic_id:traffic.id,role:'proof',note:'原验证'}]}});
  const finding=await runtime.record(input,[],'hint');assert.equal(finding.trafficBindings[0].note,'原验证');assert.equal(finding.trafficBindings[0].role,'proof');
  const other=await store.createTask('来源只读','目标');await assert.rejects(runtime.record({...input,taskId:other.id},[],'hint'),/hint must belong/);
  assert.equal(store.snapshot().findings.length,1);
});
test('optimistic report lock, exact reorder, and immutable body integrity', async t => {
  const {store,runtime,input,traffic} = await fixture(t); const f = await runtime.record(input,[{trafficId:traffic.id}]);
  await runtime.updateReport(f.id,'# 原报告',1);
  const id=f.trafficBindings[0].id;
  await runtime.editTraffic(f.id,1,{bindingId:id,note:'new'});
  await assert.rejects(runtime.updateReport(f.id,'# 过时',1), e=>e.code==='conflict');
  await assert.rejects(runtime.editTraffic(f.id,2,{order:[id,id]}),e=>e.code==='conflict');
  assert.equal(runtime.get(f.id).report,'# 原报告'); assert.equal(runtime.get(f.id).reportEvidenceVersion,1);
  await store.transaction(s=>{s.findings[0].trafficBindings[0].snapshot.response.bodyBase64='AAAA';});
  assert.throws(()=>runtime.body(f.id,id,'response'),e=>e.code==='integrity');
});
test('report generated from captured context refuses concurrent evidence change', async t => {
  const {store,runtime,input,traffic} = await fixture(t); const f=await runtime.record(input,[{trafficId:traffic.id}]);
  let resolve; const waiting = new Promise(r=>resolve=r);
  const generated=new FindingsRuntime(store,{generate: async source=>{assert.equal(source.finding.id,f.id); return waiting;}}).generateReport(f.id);
  await runtime.editTraffic(f.id,1,{bindingId:f.trafficBindings[0].id,note:'changed'}); resolve('# Report');
  await assert.rejects(generated,e=>e.code==='conflict'); assert.equal(runtime.get(f.id).report,undefined);
});
test('cross-task evidence rejected and inherited findings cannot be mutated', async t => {
  const {store,runtime,input,traffic,task} = await fixture(t); const other=await store.createTask('另一任务','目标');
  await assert.rejects(runtime.record({...input,taskId:other.id},[{trafficId:traffic.id}]),e=>e.code==='forbidden');
  const f=await runtime.record(input); assert.throws(()=>runtime.get(f.id,{taskId:other.id}),e=>e.code==='forbidden');
  await store.transaction(s=>{s.tasks.find(x=>x.id===other.id).sourceTaskIds=[task.id];});
  assert.equal(runtime.get(f.id,{taskId:other.id}).id,f.id);
  await assert.rejects(runtime.update(f.id,{status:'fixed'},{taskId:other.id}),e=>e.code==='forbidden');
});
test('deepen creates lineage and refuses missing origin', async t => {
  const {store,runtime,input} = await fixture(t); const f=await runtime.record(input); const intent=await runtime.deepen(f.id,'核验根因');
  assert.equal(intent.input.priority,10); assert.ok(store.snapshot().edges.some(e=>e.from===f.id&&e.to===intent.id));
  await store.transaction(s=>{s.tasks=[];}); await assert.rejects(runtime.deepen(f.id,'again'),e=>e.code==='unavailable');
});
test('retained finding remains editable after originating task and assets are deleted', async t=>{
  const {store,runtime,input}=await fixture(t);const asset=await store.addAsset({taskId:input.taskId,kind:'domain',value:'retained.local',source:'user',metadata:{}});
  const finding=await runtime.record({...input,assetIds:[asset.id]});await store.transaction(s=>{s.tasks=[];s.assets=[];});
  const updated=await runtime.update(finding.id,{status:'risk_accepted'});
  assert.equal(updated.status,'risk_accepted');assert.deepEqual(updated.assetIds,[asset.id]);
  assert.equal(store.snapshot().notificationEvents.at(-1).snapshot.toStatus,'risk_accepted');
});
test('retest deduplication, session authority, one verdict and atomic fixed notification', async t => {
  const {store,runtime,input} = await fixture(t); const f=await runtime.record(input);
  let finish, started; const ready=new Promise(r=>started=r), wait=new Promise(r=>finish=r);
  const retests=new FindingRetests(store,{run:async({onSession})=>{await onSession('real-session');started();await wait;return 'done';}});
  const first=await retests.start(f.id); await ready; const second=await retests.start(f.id); assert.equal(second.created,false);
  await assert.rejects(retests.recordResult('other','fixed','固定','证据'),e=>e.code==='forbidden');
  await retests.recordResult('real-session','fixed','已修复','实际复测输出');
  await assert.rejects(retests.recordResult('real-session','reproduced','仍在','输出'),e=>e.code==='conflict');
  assert.equal(runtime.get(f.id).status,'pending'); finish(); await first.completion;
  assert.equal(runtime.get(f.id).status,'fixed'); assert.equal(retests.history(f.id)[0].status,'done');
  assert.equal(store.snapshot().notificationEvents.filter(e=>e.snapshot.kind==='finding_status_changed').length,1);
  await runtime.update(f.id,{status:'ignored'}); await retests.finish(f.id,first.retest.id,'done'); assert.equal(runtime.get(f.id).status,'ignored');
});
test('cancelled retest cannot mark fixed and successful run without verdict fails', async t=>{
  const {store,runtime,input}=await fixture(t); const f=await runtime.record(input);
  const retests=new FindingRetests(store,{run:async({onSession})=>{await onSession('cancelled-session');await retests.recordResult('cancelled-session','fixed','结果','证据');return 'cancelled';}});
  const run=await retests.start(f.id);await run.completion;assert.equal(runtime.get(f.id).status,'pending');assert.equal(retests.history(f.id)[0].status,'cancelled');
  const none=new FindingRetests(store,{run:async({onSession})=>{await onSession('empty-session');return 'done';}});
  const empty=await none.start(f.id);await empty.completion;assert.equal(none.history(f.id).at(-1).status,'failed');
});

test('sibling retest scope preserves another live run during recovery and disposal but can explicitly cancel it', async t => {
  const { store, runtime, input } = await fixture(t), finding = await runtime.record(input);
  const entered = Promise.withResolvers();
  let runSignal;
  const owner = new FindingRetests(store, { run: async ({ onSession, signal }) => {
    runSignal = signal;
    await onSession('shared-store-retest-session');
    entered.resolve();
    await new Promise(resolve => {
      if (signal.aborted) resolve();
      else signal.addEventListener('abort', resolve, { once: true });
    });
    return 'cancelled';
  } });
  const siblingStore = new RedTeamStore(store.storagePath);
  assert.notStrictEqual(siblingStore, store);
  const management = new FindingRetests(siblingStore);
  const started = await owner.start(finding.id);
  t.after(async () => { owner.cancelAll(); await started.completion; });
  await entered.promise;
  assert.deepEqual(await management.recover(), { recovered: 0 });
  assert.equal(management.history(finding.id)[0].status, 'running');
  management.cancelAll();
  assert.equal(runSignal.aborted, false, 'disposing a sibling scope must not abort the owner run');
  assert.equal(owner.history(finding.id)[0].status, 'running');
  management.cancel(started.retest.id);
  assert.equal(runSignal.aborted, true, 'explicit cancellation must find the controller in the shared store');
  await started.completion;
  assert.equal(owner.history(finding.id)[0].status, 'cancelled');
  assert.equal(management.active().length, 0);
  assert.equal(runtime.get(finding.id).status, 'pending');
  assert.equal(store.snapshot().notificationEvents.filter(event => event.snapshot.kind === 'finding_status_changed').length, 0);
  assert.throws(() => management.cancel(started.retest.id), error => error.code === 'not_found');
});

test('recovery on another store object cannot clear a pending retest before its controller is registered', async t => {
  const {store,runtime,input}=await fixture(t), finding=await runtime.record(input);
  const siblingStore=new RedTeamStore(store.storagePath), management=new FindingRetests(siblingStore);
  const committed=Promise.withResolvers(), release=Promise.withResolvers(), entered=Promise.withResolvers();
  const transaction=store.transaction.bind(store);
  store.transaction=async mutator=>{
    const result=await transaction(mutator);
    if(result?.created===true){committed.resolve();await release.promise;}
    return result;
  };
  const owner=new FindingRetests(store,{run:async({onSession,signal})=>{
    await onSession('pending-window-session');entered.resolve();
    await new Promise(resolve=>{if(signal.aborted)resolve();else signal.addEventListener('abort',resolve,{once:true});});
    return 'cancelled';
  }});
  const starting=owner.start(finding.id);
  t.after(async()=>{release.resolve();const started=await starting;owner.cancelAll();await started.completion;});
  await committed.promise;
  const recovering=management.recover();
  // This real store transaction drains recovery if it wrongly bypassed the host gate.
  await siblingStore.transaction(state=>state.version);
  assert.equal(management.history(finding.id)[0].status,'pending');
  release.resolve();
  const started=await starting;
  assert.deepEqual(await recovering,{recovered:0});
  await entered.promise;
  management.cancel(started.retest.id);await started.completion;
  assert.equal(management.history(finding.id)[0].status,'cancelled');
});
