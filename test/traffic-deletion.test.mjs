import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm, rename, rmdir, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { createHash } from 'node:crypto';
import { RedTeamStore } from '../lib/store.js';
import { TrafficQuery } from '../lib/traffic-tools/query.js';
import { incomingTrafficRecord } from '../lib/traffic-tools/blobs.js';
import { FindingsRuntime } from '../lib/findings-reports/runtime.js';

function deferred(){let resolve;const promise=new Promise(accept=>{resolve=accept;});return{promise,resolve};}
async function fixture(t){
  const dir=await mkdtemp(join(tmpdir(),'traffic-deletion-'));t.after(()=>rm(dir,{recursive:true,force:true}));
  const store=new RedTeamStore(join(dir,'state.json')),task=await store.createTask('Deletion','Verify disposable traffic and durable evidence');
  const query=new TrafficQuery(store),incoming=join(dir,'redteam','traffic','_incoming','test');await mkdir(incoming,{recursive:true});
  const body=Buffer.from('large captured proof '.repeat(20000)),hash=createHash('sha256').update(body).digest('hex');
  const canonical=join(query.blobRoot,hash.slice(0,2),hash+'.bin');
  const row=(host,taskId=task.id)=>({taskId,host,method:'GET',url:`http://${host}/evidence`,status:200,request:{startLine:'GET /evidence HTTP/1.1',headerFields:[],bodyBase64:'',bodyLength:0},response:{startLine:'HTTP/1.1 200 OK',headerFields:[['Content-Type','text/plain']],bodySha256:hash,bodyLength:body.length,binary:false}});
  const stage=async(host,taskId=task.id)=>{const name=hash+'.'+Math.random().toString(36).slice(2)+'.bin';await writeFile(join(incoming,name),body);return incomingTrafficRecord({...row(host,taskId),response:{...row(host,taskId).response,bodyFile:name}},incoming,query.blobRoot);};
  return{dir,store,task,query,incoming,body,hash,canonical,row,stage};
}

test('global exact and substring deletions preserve shared blobs and immutable finding evidence',async t=>{
  const f=await fixture(t),other=await f.store.createTask('Other task','Shared body reference');
  const a=await f.stage('api.example.test');const first=await f.store.addTraffic(a.record,a.prepare);
  const b=await f.stage('api.example.test.cn',other.id);await f.store.addTraffic(b.record,b.prepare);
  const findings=new FindingsRuntime(f.store);
  const finding=await findings.record({taskId:f.task.id,summary:'Verified independent proof',vulnClass:'test',severity:'low',status:'pending',assetIds:[],evidenceIds:[]},[{trafficId:first.id,role:'proof',note:'Verified response'}]);
  assert.equal((await f.query.deleteHostsExact(['api.example.test'])).deleted,1);
  assert.deepEqual(await readFile(f.canonical),f.body,'other host in another task still owns this blob');
  assert.equal(f.store.snapshot().traffic[0].host,'api.example.test.cn');
  const removed=await f.query.deleteHost('example.test');assert.equal(removed.deleted,1);assert.equal(removed.blobReclaimed,f.body.length);
  await assert.rejects(access(f.canonical),{code:'ENOENT'});
  const kept=findings.get(finding.id);assert.deepEqual(Buffer.from(kept.trafficBindings[0].snapshot.response.bodyBase64,'base64'),f.body);
  assert.throws(()=>f.query.deleteHost(' '),/missing host/);assert.throws(()=>f.query.deleteHostsExact([' ']),/missing hosts/);
});

test('DeleteAll compacts disposable rows and reclaims orphan SHA bodies but never active incoming files',async t=>{
  const f=await fixture(t),first=await f.stage('one.test');await f.store.addTraffic(first.record,first.prepare);
  const pending=await f.stage('future.test');const pendingFiles=await import('node:fs/promises').then(fs=>fs.readdir(f.incoming));
  const result=await f.query.deleteAll();assert.equal(result.deleted,1);assert.ok(result.reclaimed>0);assert.equal(result.blobReclaimed,f.body.length);
  for(const file of pendingFiles)await access(join(f.incoming,file));
  await f.store.addTraffic(pending.record,pending.prepare);
  assert.deepEqual(await readFile(f.canonical),f.body);
  await f.query.deleteAll();
  await mkdir(dirname(f.canonical),{recursive:true});await writeFile(f.canonical,f.body);
  const orphan=await f.query.deleteAll();assert.equal(orphan.deleted,0);assert.equal(orphan.blobReclaimed,f.body.length);
});

test('capture promotion queued behind deletion survives GC even when it has the same digest',async t=>{
  const f=await fixture(t),old=await f.stage('old.test');await f.store.addTraffic(old.record,old.prepare);
  const next=await f.stage('new.test'),entered=deferred(),release=deferred();
  const transaction=f.store.transaction.bind(f.store);
  f.store.transaction=async mutate=>{const result=await transaction(mutate);entered.resolve();await release.promise;return result;};
  const deleting=f.query.deleteAll();await entered.promise;
  let promoted=false;
  const writing=f.store.addTraffic(next.record,async()=>{promoted=true;return next.prepare();});
  assert.equal(promoted,false);release.resolve();
  assert.equal((await deleting).deleted,1);await writing;
  assert.equal(f.store.snapshot().traffic[0].host,'new.test');assert.deepEqual(await readFile(f.canonical),f.body);
});

test('deletion queued behind active promotion sees the committed live reference',async t=>{
  const f=await fixture(t),incoming=await f.stage('kept.test'),entered=deferred(),release=deferred();
  const writing=f.store.addTraffic(incoming.record,async()=>{const rollback=await incoming.prepare();entered.resolve();await release.promise;return rollback;});
  await entered.promise;
  let deleted=false;const deleting=f.query.deleteHost('different.test').then(result=>{deleted=true;return result;});
  assert.equal(deleted,false);release.resolve();await writing;assert.equal((await deleting).deleted,0);
  assert.deepEqual(await readFile(f.canonical),f.body);assert.equal(f.store.snapshot().traffic.length,1);
});

test('durable store write failure rolls back newly promoted blobs and incoming files',async t=>{
  const f=await fixture(t),incoming=await f.stage('failed.test');
  const saved=f.store.storagePath+'.saved';await rename(f.store.storagePath,saved);await mkdir(f.store.storagePath);
  try { await assert.rejects(f.store.addTraffic(incoming.record,incoming.prepare)); }
  finally {await rmdir(f.store.storagePath);await rename(saved,f.store.storagePath);}
  assert.equal(f.store.snapshot().traffic.length,0);await assert.rejects(access(f.canonical),{code:'ENOENT'});
  assert.deepEqual(await import('node:fs/promises').then(fs=>fs.readdir(f.incoming)),[]);
});

test('failed row validation never removes a preexisting blob owned by another host',async t=>{
  const f=await fixture(t),good=await f.stage('good.test');await f.store.addTraffic(good.record,good.prepare);
  const bad=await f.stage('missing.test','not-a-task');await assert.rejects(f.store.addTraffic(bad.record,bad.prepare),/task not found/);
  assert.deepEqual(await readFile(f.canonical),f.body);assert.equal(f.store.snapshot().traffic.length,1);
  const invalid=await f.stage('bad-checksum.test');
  const files=await import('node:fs/promises').then(fs=>fs.readdir(f.incoming));await writeFile(join(f.incoming,files[0]),Buffer.alloc(f.body.length));
  await assert.rejects(f.store.addTraffic(invalid.record,invalid.prepare),/checksum mismatch/);
  assert.deepEqual(await readFile(f.canonical),f.body);
});
