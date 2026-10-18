import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import net from 'node:net';
import { once } from 'node:events';
import { createHmac } from 'node:crypto';
import { NotificationDispatcher, sendNotification, matchNotification, maskNotificationConfig, prepareNotificationConfigUpdate, blockedNotificationIP, PermanentNotificationError, validateNotificationChannel, renderNotificationTelegram, renderNotificationFeishu, renderNotificationEmail } from '../lib/notifications.js';
import { renderNotificationTemplate } from '../lib/notifications-template.js';

const snapshot = (id='f1',extra={}) => ({kind:'finding_created',findingId:id,taskId:'t1',vulnClass:'SQL injection',name:'登录测试',severity:'high',summary:'参数验证',assetIds:['a1'],assets:['example.test'],...extra});
const message = (items=[snapshot()],batch=false) => ({items:items.map(i=>({...i,detailURL:''})),batch,windowMinutes:30,homeURL:''});
async function receiver(t,respond) {
  const requests=[]; const server=http.createServer(async(req,res)=>{ let text='';for await(const chunk of req) text+=chunk; requests.push({method:req.method,url:req.url,headers:req.headers,body:text?JSON.parse(text):undefined}); respond(req,res,requests); });
  server.listen(0,'127.0.0.1'); await once(server,'listening');t.after(()=>new Promise(r=>{server.closeAllConnections();server.close(r);})); return {url:`http://127.0.0.1:${server.address().port}`,requests};
}
const allow={allowLocalTargets:true};
function fixture(url,mode='realtime',filter={}) {
  let state={notificationEvents:[],notificationDeliveries:[]};let clock=new Date('2026-10-18T00:00:00Z');
  const channels=[{id:'c1',name:'测试渠道',kind:'webhook',enabled:true,mode,config:{url},filter}];
  const repo={read:()=>structuredClone(state),transaction:async fn=>{const draft=structuredClone(state);const result=fn(draft);state=draft;return structuredClone(result);}};
  const dispatcher=new NotificationDispatcher(repo,()=>channels,{...allow,now:()=>clock});
  return {repo,dispatcher,channels,advance:ms=>{clock=new Date(clock.getTime()+ms);}};
}
test('notification filters preserve severity, scope, exclusion and status opt-in',()=>{
  assert.equal(matchNotification({min_severity:'critical'},snapshot()),false);
  assert.equal(matchNotification({vulnclass_include:[' SQL '],vulnclass_exclude:['injection']},snapshot()),false);
  assert.equal(matchNotification({task_ids:['other']},snapshot()),false);
  assert.equal(matchNotification({asset_ids:['a1']},snapshot()),true);
  assert.equal(matchNotification({},snapshot('f',{kind:'finding_status_changed'})),false);
  assert.equal(matchNotification({on_status_change:true},snapshot('f',{kind:'finding_status_changed'})),true);
});
test('actual webhook fanout sends immutable snapshots exactly once in concurrent steps',async t=>{
  const {url,requests}=await receiver(t,(_q,r)=>r.end('{}'));const f=fixture(url); const event=snapshot();await f.dispatcher.enqueue(event);event.summary='mutated';
  await Promise.all([f.dispatcher.step(),f.dispatcher.step()]);await f.dispatcher.step();
  assert.equal(requests.length,1);assert.equal(requests[0].body.items[0].summary,'参数验证');assert.equal(f.repo.read().notificationDeliveries[0].state,'sent');
});
test('transient failures back off 5s then 30s and exhausted delivery can be manually retried',async t=>{
  let status=503;const {url,requests}=await receiver(t,(_q,r)=>{r.statusCode=status;r.end('{}');});const f=fixture(url);await f.dispatcher.enqueue(snapshot());
  await f.dispatcher.step();let row=f.repo.read().notificationDeliveries[0];assert.equal(row.state,'pending');assert.equal(row.nextAttemptAt,'2026-10-18T00:00:05.000Z');
  await f.dispatcher.step();assert.equal(requests.length,1);f.advance(5000);await f.dispatcher.step();row=f.repo.read().notificationDeliveries[0];assert.equal(row.nextAttemptAt,'2026-10-18T00:00:35.000Z');
  f.advance(30000);await f.dispatcher.step();row=f.repo.read().notificationDeliveries[0];assert.equal(row.state,'failed');assert.equal(row.attempts,3);
  status=200;await f.dispatcher.retry(row.id);await f.dispatcher.step();assert.equal(f.repo.read().notificationDeliveries[0].state,'sent');assert.equal(requests.length,4);
});
test('permanent HTTP rejection fails immediately and disabling channels skips pending work',async t=>{
  const {url}=await receiver(t,(_q,r)=>{r.statusCode=403;r.end('rejected');});const f=fixture(url);await f.dispatcher.enqueue(snapshot());await f.dispatcher.step();assert.equal(f.repo.read().notificationDeliveries[0].state,'failed');
  await f.dispatcher.enqueue(snapshot('f2'));await f.repo.transaction(s=>{s.notificationEvents.at(-1).fannedOut=true;s.notificationDeliveries.push({...s.notificationDeliveries[0],id:'pending',eventId:s.notificationEvents.at(-1).id,state:'pending'});});
  f.channels[0].enabled=false;await f.dispatcher.step();assert.equal(f.repo.read().notificationDeliveries.at(-1).state,'skipped');await assert.rejects(f.dispatcher.retry('pending'),/停用/);
});
test('digest waits from oldest event and excludes status changes even with opt-in',async t=>{
  const {url,requests}=await receiver(t,(_q,r)=>r.end('{}'));const f=fixture(url,'digest',{on_status_change:true});await f.dispatcher.enqueue(snapshot());await f.dispatcher.step();f.advance(29*60000);await f.dispatcher.enqueue(snapshot('f2'));await f.dispatcher.enqueue(snapshot('f3',{kind:'finding_status_changed'}));await f.dispatcher.step();assert.equal(requests.length,0);
  f.advance(60000);await f.dispatcher.step();assert.equal(requests.length,1);assert.equal(requests[0].body.batch,true);assert.equal(requests[0].body.count,2);
});
test('expired sending lease resumes after dispatcher restart',async t=>{
  const {url,requests}=await receiver(t,(_q,r)=>r.end('{}'));const f=fixture(url);await f.dispatcher.enqueue(snapshot());
  await f.repo.transaction(s=>{s.notificationEvents[0].fannedOut=true;s.notificationDeliveries.push({id:'d1',eventId:s.notificationEvents[0].id,channelId:'c1',state:'sending',attempts:1,nextAttemptAt:'2026-10-18T00:03:00Z',createdAt:'2026-10-18T00:00:00Z'});});
  await f.dispatcher.step();assert.equal(requests.length,0);f.advance(180000);await f.dispatcher.step();assert.equal(requests.length,1);assert.equal(f.repo.read().notificationDeliveries[0].attempts,2);
});
test('rate limits meter requests before claiming and do not consume waiting delivery attempts',async t=>{
  const {url,requests}=await receiver(t,(_q,r)=>r.end('{}'));const f=fixture(url);f.channels[0].ratePerMin=1;
  await f.dispatcher.enqueue(snapshot('first'));await f.dispatcher.enqueue(snapshot('second'));await f.dispatcher.step();await f.dispatcher.step();assert.equal(requests.length,1);assert.equal(f.repo.read().notificationDeliveries[1].attempts,0);
  f.advance(60000);await f.dispatcher.step();assert.equal(requests.length,2);assert.ok(f.repo.read().notificationDeliveries.every(d=>d.state==='sent'&&d.attempts===1));
});
test('IM adapters use correct signature algorithms and business error semantics',async t=>{
  let body='{"errcode":0}';const {url,requests}=await receiver(t,(_q,r)=>r.end(body));const now=new Date('2026-10-18T00:00:00Z');
  await sendNotification('dingtalk',{webhook:url,secret:'key'},message(),{...allow,now});const requestURL=new URL(requests[0].url,url);const timestamp=String(now.getTime());assert.equal(requestURL.searchParams.get('sign'),createHmac('sha256','key').update(`${timestamp}\nkey`).digest('base64'));
  body='{"code":0}';await sendNotification('feishu',{webhook:url,secret:'key'},message(),{...allow,now});assert.equal(requests[1].body.sign,createHmac('sha256',`${Math.floor(now.getTime()/1000)}\nkey`).digest('base64'));
  body='{"errcode":45009}';await assert.rejects(sendNotification('wecom',{webhook:url},message(),allow),e=>!(e instanceof PermanentNotificationError));
  body='{"ok":false,"error_code":403}';await assert.rejects(sendNotification('telegram',{base_url:url,bot_token:'token',chat_id:'chat'},message(),allow),PermanentNotificationError);
});
test('WeCom digest length retains unsent records and does not spend their attempt budget',async t=>{
  const {url,requests}=await receiver(t,(_q,r)=>r.end('{"errcode":0}'));const f=fixture(url,'digest');f.channels[0].kind='wecom';f.channels[0].config={webhook:url};
  for(let i=0;i<40;i++)await f.dispatcher.enqueue(snapshot(`f${i}`,{name:'长标题'.repeat(20)}));await f.dispatcher.step();f.advance(30*60000);await f.dispatcher.step();
  const rows=f.repo.read().notificationDeliveries;assert.ok(rows.some(d=>d.state==='sent'));assert.ok(rows.some(d=>d.state==='pending'));assert.ok(rows.filter(d=>d.state==='pending').every(d=>d.attempts===0));assert.ok(Buffer.byteLength(requests[0].body.markdown.content)<=4096);
});
test('webhook templates preserve range, variables, conditional comma and JSON escaping',async t=>{
  const tpl='{"title":{{json .Title}},"items":[{{range $i, $it := .Items}}{{if $i}},{{end}}{"id":{{json $it.FindingID}},"name":{{json $it.Name}}}{{end}}]}';
  const rendered=JSON.parse(renderNotificationTemplate(tpl,message([snapshot('a',{name:'"quoted"\nname'}),snapshot('b')],true)));assert.equal(rendered.items.length,2);assert.equal(rendered.items[0].name,'"quoted"\nname');
  const {url,requests}=await receiver(t,(_q,r)=>r.end('{}'));await sendNotification('webhook',{url,method:'PUT',body_template:tpl,headers:{'X-Test':'works'}},message(),allow);assert.equal(requests[0].method,'PUT');assert.equal(requests[0].headers['x-test'],'works');
});
test('credentials are masked and destination changes require explicit replacement',()=>{
  assert.equal(maskNotificationConfig('telegram',{bot_token:'secret-token',chat_id:'visible'}).bot_token,'__masked__:…-token');
  assert.throws(()=>prepareNotificationConfigUpdate('webhook',{url:'https://a.test',headers:{Authorization:'secret'}},{url:'https://b.test'}),/凭据/);
  assert.deepEqual(prepareNotificationConfigUpdate('webhook',{url:'https://a.test',headers:{Authorization:'secret'}},{url:'__masked__',headers:'__masked__'}),{url:'https://a.test',headers:{Authorization:'secret'}});
  assert.equal(blockedNotificationIP('::ffff:7f00:1'),true);assert.equal(blockedNotificationIP('192.168.1.10'),false);
});
test('template syntax is rejected on save and hidden/prototype fields remain inaccessible',()=>{
  assert.throws(()=>validateNotificationChannel('webhook',{url:'https://example.test',body_template:'{{.Items.'}),/未闭合/);
  assert.throws(()=>renderNotificationTemplate('{"x":{{json .Environment}}}',message()),/字段不存在/);
  assert.throws(()=>renderNotificationTemplate('{"x":{{json .constructor}}}',message()),/字段不存在/);
});
test('upstream printf/index template and nested pipelines render the public template contract',()=>{
  const upstream='{"msg": {{json (printf "%d 条" .Count)}}, "first": {{json (index .Items 0).Name}}}';
  assert.deepEqual(JSON.parse(renderNotificationTemplate(upstream,message())),{msg:'1 条',first:'登录测试'});
  assert.deepEqual(JSON.parse(renderNotificationTemplate('{"msg":{{.Count | printf "%d 条" | json}},"nested":"{{jsons (index .Items 0).Assets}}"}',message())),{msg:'1 条',nested:'["example.test"]'});
});
test('Feishu cards preserve per-finding blocks, severity colors and detail/home actions',()=>{
  const single=message();single.items[0].detailURL='https://example.test/detail';const {card,kept}=renderNotificationFeishu(single);
  assert.equal(kept,1);assert.equal(card.header.template,'orange');assert.equal(card.elements[1].actions[0].url,'https://example.test/detail');assert.equal(card.elements[1].actions[0].text.content,'查看详情');
  const batch={...message([snapshot('a'),snapshot('b')],true),homeURL:'https://example.test/'};const rendered=renderNotificationFeishu(batch);assert.equal(rendered.card.elements.length,4);assert.match(rendered.card.elements[0].text.content,/高危 2/);assert.equal(rendered.card.elements[3].actions[0].text.content,'在平台中查看全部');
});
test('email HTML follows inline-style severity and digest design without interpolating HTML',()=>{
  const single=message([snapshot('f',{name:'<img src="x">',fromStatus:'pending',toStatus:'fixed'})]);single.items[0].detailURL='https://example.test/?x="';
  const content=renderNotificationEmail(single);assert.match(content,/border-left:4px solid #e8830c/);assert.match(content,/&lt;img src=&quot;x&quot;&gt;/);assert.match(content,/待处理 → 已修复/);assert.match(content,/href="https:\/\/example.test\/\?x=&quot;"/);
  const batch=renderNotificationEmail({...message([snapshot(),snapshot('f2',{severity:'critical'})],true),homeURL:'https://example.test/'});assert.match(batch,/近 30 分钟新增 2 个漏洞/);assert.match(batch,/严重 1/);assert.match(batch,/高危 1/);assert.match(batch,/border-left:3px/);
});
test('Telegram renders HTML links and escapes finding fields without Markdown artifacts',()=>{
  const rendered=renderNotificationTelegram({...message([snapshot('f',{name:'<b>测试</b>',fromStatus:'pending',toStatus:'fixed'})]),items:[{...snapshot('f',{name:'<b>测试</b>',fromStatus:'pending',toStatus:'fixed'}),detailURL:'https://example.test/?x="'}]});
  assert.match(rendered.text,/&lt;b&gt;测试&lt;\/b&gt;/);assert.match(rendered.text,/待处理 → 已修复/);assert.match(rendered.text,/<a href="https:\/\/example.test\/\?x=&quot;">查看详情<\/a>/);assert.equal(rendered.kept,1);
});
test('archiving task gate prevents both new fanout and existing delivery claims',async t=>{
  const {url,requests}=await receiver(t,(_q,r)=>r.end('{}'));const f=fixture(url);await f.dispatcher.enqueue(snapshot());let available=false;
  const dispatcher=new NotificationDispatcher(f.repo,()=>f.channels,{...allow,isTaskAvailable:()=>available});await dispatcher.step();assert.equal(f.repo.read().notificationEvents[0].fannedOut,false);assert.equal(requests.length,0);
  available=true;await dispatcher.step();assert.equal(requests.length,1);
  await f.dispatcher.enqueue(snapshot('second'));await f.repo.transaction(s=>{const event=s.notificationEvents.at(-1);event.fannedOut=true;s.notificationDeliveries.push({id:'already-pending',eventId:event.id,channelId:'c1',state:'pending',attempts:0,nextAttemptAt:'2026-10-18T00:00:00Z',createdAt:'2026-10-18T00:00:00Z'});});
  available=false;await dispatcher.step();assert.equal(requests.length,1);assert.equal(f.repo.read().notificationDeliveries.at(-1).attempts,0);
});
test('local targets require explicit opt-in and cross-host redirects are rejected',async t=>{
  const {url}=await receiver(t,(_q,r)=>{r.writeHead(302,{Location:'http://example.test/secret'});r.end();});
  await assert.rejects(sendNotification('webhook',{url},message()),/本机/);await assert.rejects(sendNotification('webhook',{url},message(),allow),/跨主机/);
});
test('actual SMTP conversation delivers MIME body and classifies temporary recipient failures',async t=>{
  let rejectRecipient=false;const mails=[];
  const server=net.createServer(socket=>{socket.write('220 local SMTP\r\n');let buffer='',data=false,mail='';socket.on('data',chunk=>{buffer+=chunk;let i;while((i=buffer.indexOf('\r\n'))>=0){const line=buffer.slice(0,i);buffer=buffer.slice(i+2);if(data){if(line==='.') {mails.push(mail);mail='';data=false;socket.write('250 accepted\r\n');}else mail+=line+'\r\n';}else if(line.startsWith('EHLO'))socket.write('250 local\r\n');else if(line.startsWith('RCPT')&&rejectRecipient)socket.write('450 try later\r\n');else if(line==='DATA'){data=true;socket.write('354 continue\r\n');}else if(line==='QUIT'){socket.end('221 bye\r\n');}else socket.write('250 ok\r\n');}});});
  server.listen(0,'127.0.0.1');await once(server,'listening');t.after(()=>new Promise(r=>server.close(r)));
  const config={host:'127.0.0.1',port:server.address().port,from:'from@example.test',to:['to@example.test']};assert.equal(await sendNotification('email',config,message(),allow),1);assert.equal(mails.length,1);assert.match(mails[0],/Content-Transfer-Encoding: base64/);const decoded=Buffer.from(mails[0].split('\r\n\r\n')[1].replace(/\s/g,''),'base64').toString();assert.match(decoded,/参数验证/);
  rejectRecipient=true;await assert.rejects(sendNotification('email',config,message(),allow),e=>!(e instanceof PermanentNotificationError)&&e.message.includes('450'));
});
