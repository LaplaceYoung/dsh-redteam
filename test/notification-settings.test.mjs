import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { once } from 'node:events';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { RedTeamStore } from '../lib/store.js';
import { NotificationDispatcher } from '../lib/notifications.js';
import { NotificationSettingsRuntime, registerNotificationManagementTools } from '../lib/notification-settings.js';

const event=(id,severity='high')=>({kind:'finding_created',findingId:id,taskId:'t1',vulnClass:'SQL injection',name:'Example',severity,summary:'Evidence',assetIds:[],assets:[]});
async function fixture(t,defaults={}) {
  const dir=await mkdtemp(join(tmpdir(),'dsh-notify-settings-'));t.after(()=>rm(dir,{recursive:true,force:true}));
  const store=new RedTeamStore(join(dir,'store.json'));await store.load();
  const repository={read:()=>store.snapshot(),transaction:fn=>store.transaction(fn)};
  const settings=new NotificationSettingsRuntime(repository,defaults),tools=new Map();
  registerNotificationManagementTools({tools:{register(tool){tools.set(tool.name,tool);return()=>tools.delete(tool.name);}}},settings);
  let now=new Date('2026-10-18T00:00:00Z');
  const dispatcher=new NotificationDispatcher(repository,()=>store.snapshot().notificationChannels,{allowLocalTargets:true,now:()=>now,settings:()=>settings.read()});
  return {dir,store,settings,dispatcher,advance:ms=>{now=new Date(now.getTime()+ms);},call:(name,args)=>tools.get(name).execute(args)};
}
async function receiver(t) {
  const requests=[];const server=http.createServer(async(req,res)=>{let body='';for await(const chunk of req)body+=chunk;requests.push({url:req.url,body:body?JSON.parse(body):null,headers:req.headers});res.end('{}');});
  server.listen(0,'127.0.0.1');await once(server,'listening');t.after(()=>new Promise(resolve=>{server.closeAllConnections();server.close(resolve);}));
  return {url:`http://127.0.0.1:${server.address().port}`,requests};
}
const create=(f,url,extra={})=>f.call('redteam_notification_channels',{action:'create',channel:{name:'Local receiver',kind:'webhook',config:{url},...extra}});

test('settings tool preserves plugin defaults until persisted override and normalizes public URLs',async t=>{
  const f=await fixture(t,{enabled:false,digestMinutes:45,publicBaseURL:'https://first.test/'});
  assert.deepEqual(await f.call('redteam_notification_settings',{action:'get'}),{notify_enabled:false,notify_public_base_url:'https://first.test',notify_digest_interval_min:45});
  await f.call('redteam_notification_settings',{action:'update',settings:{notify_enabled:true,notify_public_base_url:' https://public.test/base/// '}});
  assert.deepEqual(f.settings.read(),{notify_enabled:true,notify_public_base_url:'https://public.test/base',notify_digest_interval_min:45});
  const persisted=JSON.parse(await readFile(f.store.storagePath,'utf8'));assert.deepEqual(persisted.notificationSettings,{notify_enabled:true,notify_public_base_url:'https://public.test/base'});
  const copied=join(f.dir,'restart.json');await writeFile(copied,JSON.stringify(persisted));const restarted=new RedTeamStore(copied);await restarted.load();
  const settings=new NotificationSettingsRuntime({read:()=>restarted.snapshot(),transaction:fn=>restarted.transaction(fn)},{enabled:false,digestMinutes:45});assert.deepEqual(settings.read(),f.settings.read());
  await f.settings.update({notify_public_base_url:''});assert.equal(f.settings.read().notify_public_base_url,'');
});

test('settings update and snapshot import reject invalid values without partial writes',async t=>{
  const f=await fixture(t);const before=f.store.snapshot();
  for(const settings of [{notify_enabled:'false'},{notify_public_base_url:'ftp://x'},{notify_digest_interval_min:0},{notify_digest_interval_min:1441},{notify_digest_interval_min:1.5},{notify_enabled:false,notify_digest_interval_min:99999}]) {
    await assert.rejects(f.call('redteam_notification_settings',{action:'update',settings}));assert.deepEqual(f.store.snapshot(),before);
  }
  await assert.rejects(f.store.importSnapshot({notificationSettings:{notify_digest_interval_min:0}}),/1 到 1440/);assert.deepEqual(f.store.snapshot(),before);
  await f.store.importSnapshot({notificationSettings:{notify_digest_interval_min:1}});assert.equal(f.settings.read().notify_digest_interval_min,1);
});

test('global off retains event backlog and re-enabling sends through same live dispatcher with updated links',async t=>{
  const f=await fixture(t),r=await receiver(t);await create(f,r.url);
  await f.settings.update({notify_enabled:false});await f.dispatcher.enqueue(event('first'));
  const before=f.store.snapshot();await f.dispatcher.step();assert.deepEqual(f.store.snapshot(),before);assert.equal(r.requests.length,0);
  await f.settings.update({notify_enabled:true,notify_public_base_url:'https://redteam.test/root/'});await f.dispatcher.step();
  assert.equal(r.requests.length,1);assert.equal(r.requests[0].body.items[0].detail_url,'https://redteam.test/root/?redteamFinding=first');
  await f.settings.update({notify_public_base_url:''});await f.dispatcher.enqueue(event('second'));await f.dispatcher.step();assert.equal(r.requests[1].body.items[0].detail_url,'');
});

test('digest interval changes immediately reschedule existing pending work without resetting age',async t=>{
  const f=await fixture(t),r=await receiver(t);await create(f,r.url,{mode:'digest'});await f.dispatcher.enqueue(event('one'));await f.dispatcher.enqueue(event('two'));await f.dispatcher.step();
  assert.equal(r.requests.length,0);f.advance(5*60000);await f.settings.update({notify_digest_interval_min:10});await f.dispatcher.step();assert.equal(r.requests.length,0);
  await f.settings.update({notify_digest_interval_min:1});await f.dispatcher.step();assert.equal(r.requests.length,1);assert.equal(r.requests[0].body.count,2);assert.equal(r.requests[0].body.batch,true);
  await f.dispatcher.enqueue(event('three'));await f.dispatcher.step();f.advance(2*60000);await f.settings.update({notify_digest_interval_min:10});await f.dispatcher.step();assert.equal(r.requests.length,1);
  f.advance(8*60000);await f.dispatcher.step();assert.equal(r.requests.length,2);assert.equal(r.requests[1].body.count,1);
});

test('channel filter, template, mode and rate edits affect real subsequent delivery and keep masked secrets',async t=>{
  const f=await fixture(t),r=await receiver(t);const channel=await create(f,r.url,{filter:{min_severity:'critical'},rate_per_min:0});
  assert.equal(channel.ratePerMin,0);assert.ok(channel.config.url.startsWith('__masked__'));assert.deepEqual(channel.secret_keys,['url','headers']);
  await f.dispatcher.enqueue(event('filtered'));await f.dispatcher.step();assert.equal(r.requests.length,0);
  await f.call('redteam_notification_channels',{action:'update',channel_id:channel.id,channel:{filter:{min_severity:'high'},config:{url:channel.config.url,body_template:'{"id":{{json (index .Items 0).FindingID}},"home":{{json .HomeURL}},"count":{{.Count}}}'}}});
  await f.settings.update({notify_public_base_url:'https://new.test/'});await f.dispatcher.enqueue(event('sent'));await f.dispatcher.step();
  assert.deepEqual(r.requests[0].body,{id:'sent',home:'https://new.test',count:1});assert.equal(f.store.snapshot().notificationChannels[0].config.url,r.url);
  const before=f.store.snapshot();await assert.rejects(async()=>f.settings.updateChannel(channel.id,{filter:{min_severity:'hgih'}}));await assert.rejects(async()=>f.settings.updateChannel(channel.id,{config:{body_template:'{{.Items.'}}));assert.deepEqual(f.store.snapshot(),before);
  await f.settings.updateChannel(channel.id,{mode:'digest',rate_per_min:5});const changed=f.settings.listChannels()[0];assert.equal(changed.mode,'digest');assert.equal(changed.ratePerMin,5);
});

test('channel disable skips pending batches; delete cascades deliveries; kind changes reset config',async t=>{
  const f=await fixture(t),r=await receiver(t);const channel=await create(f,r.url,{mode:'digest'});await f.dispatcher.enqueue(event('queued'));await f.dispatcher.step();
  await f.settings.updateChannel(channel.id,{enabled:false});assert.equal(f.store.snapshot().notificationDeliveries[0].state,'skipped');
  await f.settings.updateChannel(channel.id,{enabled:true});f.advance(31*60000);await f.dispatcher.step();assert.equal(r.requests.length,0);
  await f.settings.updateChannel(channel.id,{kind:'wecom',config:{webhook:r.url}});const stored=f.store.snapshot().notificationChannels[0];assert.equal(stored.kind,'wecom');assert.deepEqual(stored.config,{webhook:r.url});
  await f.call('redteam_notification_channels',{action:'delete',channel_id:channel.id});assert.deepEqual(f.store.snapshot().notificationChannels,[]);assert.deepEqual(f.store.snapshot().notificationDeliveries,[]);assert.equal(f.store.snapshot().notificationEvents.length,1);
  await assert.rejects(f.settings.deleteChannel(channel.id),/not found/);
});

test('channel writes enforce name, rate, mode and required kind configuration',async t=>{
  const f=await fixture(t),r=await receiver(t);const before=f.store.snapshot();
  for(const patch of [{name:''},{mode:'hourly'},{rate_per_min:-1},{rate_per_min:1.5},{kind:'not-a-channel'},{filter:{min_severity:false}}]) {
    await assert.rejects(create(f,r.url,patch));assert.deepEqual(f.store.snapshot(),before);
  }
  const row=await create(f,r.url);await assert.rejects(f.settings.updateChannel(row.id,{kind:'email'}),/host/);
});
