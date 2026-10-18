import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer, request } from 'node:http';
import { createServer as createHttpsServer } from 'node:https';
import { connect as connectTls, createServer as createTlsServer } from 'node:tls';
import { createServer as createPortReservation } from 'node:net';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { createHash } from 'node:crypto';
import { RedTeamStore } from '../lib/store.js';
import { TrafficRuntime } from '../lib/traffic.js';
import { TrafficQuery } from '../lib/traffic-tools/index.js';

function hasMitmdump() {
  const configured = process.env.MITMDUMP_COMMAND ?? 'mitmdump';
  let command = configured;
  if (process.platform === 'win32' && !configured.includes('\\') && !configured.includes('/')) {
    try { command = execFileSync('where.exe', [configured], { encoding: 'utf8', windowsHide: true }).split(/\r?\n/).find(Boolean) ?? configured; } catch { return false; }
  }
  // Windows launchers import the entire Python application even for --version.
  // Check installation here; the tests themselves verify executable startup.
  if (process.platform === 'win32') return existsSync(command);
  const result = command.toLowerCase().endsWith('.cmd')
    ? spawnSync(process.env.ComSpec ?? 'cmd.exe', ['/d', '/c', `${command} --version`], { stdio: 'ignore', windowsHide: true })
    : spawnSync(command, ['--version'], { stdio: 'ignore', windowsHide: true });
  return result.status === 0;
}
const mitmdumpAvailable = hasMitmdump();

async function unusedPort() {
  const reservation = createPortReservation();
  await new Promise(resolve => reservation.listen(0, '127.0.0.1', resolve));
  const port = reservation.address().port;
  await new Promise(resolve => reservation.close(resolve));
  return port;
}

async function closeCapture(runtime, servers, sockets = []) {
  const errors = [];
  try { await runtime.stop(); } catch (error) { errors.push(error); }
  for (const socket of sockets) socket.destroy();
  for (const server of servers) {
    if (!server) continue;
    server.closeAllConnections?.();
    try { await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve())); }
    catch (error) { errors.push(error); }
  }
  if (errors.length) throw new AggregateError(errors, 'traffic fixture cleanup failed');
}

test('mitmdump bridge starts ready and drains its captured HTTP flow before stop returns', { skip: !mitmdumpAvailable, timeout: 30_000 }, async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'redteam-traffic-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const store = new RedTeamStore(join(dir, 'state.json'));
  await store.load();
  const task = await store.createTask('Traffic integration', 'Verify capture and shutdown');
  const runtime = new TrafficRuntime(store, process.env.MITMDUMP_COMMAND ?? 'mitmdump');
  const largeBody = Buffer.from('A'.repeat(700000) + '尾部真实证据');
  const binaryBody = Buffer.from([0, 255, 128, 23, 65, 66]);
  const target = createServer(async (req, response) => {
    if (req.url === '/large') { response.writeHead(200, { 'content-type': 'text/plain; charset=utf-8', 'set-cookie': ['a=1', 'b=2'] }); response.end(largeBody); return; }
    if (req.url === '/binary') {
      const chunks = []; for await (const chunk of req) chunks.push(chunk);
      assert.deepEqual(Buffer.concat(chunks), binaryBody);
      response.writeHead(201, { 'content-type': 'application/octet-stream' }); response.end(binaryBody); return;
    }
    response.writeHead(200, { 'content-type': 'text/plain; charset=utf-8' }); response.end('ok 流量');
  });
  await new Promise(resolve => target.listen(0, '127.0.0.1', resolve));
  const targetPort = target.address().port;
  const proxyPort = await unusedPort();
  let secureTarget;
  try {
    await store.addIntent({ taskId: task.id, summary: 'Bound worker', input: {}, execution: { childSessionId: 'traffic-child', parentSessionId: 'parent', provider: 'spawn' } });
    const started = await runtime.start(task.id, proxyPort, { workerSessionId: 'traffic-child' });
    assert.equal(started.running, true);
    assert.equal(started.starting, false);
    assert.equal(runtime.workerEnvironment(task.id).HTTP_PROXY, `http://127.0.0.1:${proxyPort}`);
    assert.deepEqual(runtime.workerEnvironment('different-task'), {});
    // A distinct target subject avoids using the proxy CA itself as a server
    // leaf (which would give mitmproxy's generated leaf equal issuer/subject).
    const caPem = await readFile(new URL('./traffic-fixture-cert.pem', import.meta.url));
    const caCert = await readFile(started.caCertPath);
    secureTarget = createHttpsServer({ key: caPem, cert: caPem }, (_req,response) => { response.writeHead(200, { 'content-type':'text/plain', 'content-length': 16 }); response.end('secure localhost'); });
    await new Promise(resolve => secureTarget.listen(0,'127.0.0.1',resolve));
    const securePort = secureTarget.address().port;
    const secureResponse = await new Promise((resolve,reject) => {
      const tunnel = request({ host:'127.0.0.1', port:proxyPort, method:'CONNECT', path:`127.0.0.1:${securePort}` });
      tunnel.on('error',reject);
      tunnel.on('connect',(response,socket) => {
        if (response.statusCode !== 200) { socket.destroy(); reject(new Error(`CONNECT status ${response.statusCode}`)); return; }
        const secure = connectTls({ socket, ca:caCert, servername:'localhost' }, () => secure.write(`GET /secure HTTP/1.1\r\nHost: localhost:${securePort}\r\nConnection: close\r\n\r\n`));
        const chunks = []; secure.on('data',chunk => chunks.push(chunk)); secure.on('error',reject); secure.on('end',() => resolve(Buffer.concat(chunks).toString()));
      });
      tunnel.end();
    });
    assert.match(secureResponse, /secure localhost/);
    await new Promise((resolve, reject) => {
      const req = request({ host: '127.0.0.1', port: proxyPort, path: `http://127.0.0.1:${targetPort}/probe`, method: 'GET', headers: { host: `127.0.0.1:${targetPort}` }, timeout: 5000 }, response => {
        response.resume();
        response.once('end', resolve);
      });
      req.once('timeout', () => req.destroy(new Error('proxy request timed out')));
      req.once('error', reject);
      req.end();
    });
    for (const path of ['/large','/binary']) await new Promise((resolve,reject) => {
      const req = request({ host: '127.0.0.1', port: proxyPort, path: `http://127.0.0.1:${targetPort}${path}`, method: path === '/binary' ? 'POST' : 'GET', headers: { host: `127.0.0.1:${targetPort}`, 'x-repeated': ['one','two'], 'content-type': 'application/octet-stream' } }, response => {
        const chunks = []; response.on('data', chunk => chunks.push(chunk)); response.on('end', () => { try { assert.deepEqual(Buffer.concat(chunks), path === '/large' ? largeBody : binaryBody); resolve(); } catch (error) { reject(error); } });
      });
      req.on('error',reject); req.end(path === '/binary' ? binaryBody : undefined);
    });
    assert.deepEqual(await runtime.stop(), { running: false });
    const traffic = store.snapshot().traffic.filter(item => item.taskId === task.id);
    assert.equal(traffic.length, 4);
    const probe = traffic.find(row => row.url.endsWith('/probe'));
    assert.equal(probe.url, `http://127.0.0.1:${targetPort}/probe`);
    assert.equal(probe.status, 200);
    assert.equal(probe.response.body, 'ok 流量');
    assert.equal(probe.workerSessionId, 'traffic-child');
    assert.ok(probe.capturedAt);
    assert.equal(traffic.find(row => row.url.endsWith('/secure')).response.body, 'secure localhost');
    const query = new TrafficQuery(store);
    const large = traffic.find(row => row.url.endsWith('/large'));
    assert.equal(large.response.bodyLength, largeBody.length);
    assert.equal(large.response.bodyBase64, undefined);
    assert.equal(large.response.body.length, 8192);
    assert.deepEqual(large.response.headerFields.filter(([name]) => name.toLowerCase() === 'set-cookie'), [['set-cookie','a=1'],['set-cookie','b=2']]);
    assert.deepEqual(Buffer.from((await query.blob(large.response.bodySha256,700000)).base64,'base64'), largeBody.subarray(700000));
    assert.equal((await query.search({ host: `127.0.0.1:${targetPort}`, body_contains: '尾部真实证据' }))[0].id, large.id);
    const binary = traffic.find(row => row.url.endsWith('/binary'));
    assert.deepEqual(Buffer.from((await query.body(binary.id,'request')).base64,'base64'), binaryBody);
    assert.deepEqual(Buffer.from((await query.body(binary.id,'response')).base64,'base64'), binaryBody);
    assert.throws(() => process.kill(started.pid, 0), { code: 'ESRCH' });
    const reservation = createPortReservation();
    await new Promise((resolve, reject) => { reservation.once('error', reject); reservation.listen(proxyPort, '127.0.0.1', resolve); });
    await new Promise(resolve => reservation.close(resolve));
  } finally {
    await closeCapture(runtime, [secureTarget, target]);
  }
});

test('proxy protocol failure switches only subsequent connections to transparent TLS passthrough', {skip:!mitmdumpAvailable,timeout:45000}, async t=>{
  const dir=await mkdtemp(join(tmpdir(),'traffic-passthrough-'));
  const store=new RedTeamStore(join(dir,'state.json'));
  const task=await store.createTask('Passthrough','Verify original protocol-error fail-open');
  const runtime=new TrafficRuntime(store);
  const pem=await readFile(new URL('./traffic-fixture-cert.pem',import.meta.url));
  let calls=0;const sockets=new Set();
  const target=createTlsServer({key:pem,cert:pem},socket=>{
    sockets.add(socket);socket.on('error',()=>{});socket.on('close',()=>sockets.delete(socket));
    socket.once('data',()=>{calls++;socket.end(calls===1?'malformed HTTP response\r\n\r\n':'HTTP/1.1 200 OK\r\nContent-Length: 11\r\nConnection: close\r\n\r\ntransparent');});
  });
  await new Promise(resolve=>target.listen(0,'127.0.0.1',resolve));
  t.after(async()=>{try {await closeCapture(runtime,[target],sockets);} finally {await rm(dir,{recursive:true,force:true});}});
  const started=await runtime.start(task.id,await unusedPort());
  const ca=await readFile(started.caCertPath);
  const fetch=()=>new Promise((resolve,reject)=>{
    const req=request({host:'127.0.0.1',port:started.port,method:'CONNECT',path:`127.0.0.1:${target.address().port}`});
    req.on('error',reject);req.on('connect',(response,socket)=>{
      if(response.statusCode!==200){socket.destroy();reject(new Error('tunnel rejected'));return;}
      let issuer='';const tls=connectTls({socket,ca:[ca,pem],servername:'localhost'},()=>{issuer=tls.getPeerCertificate().issuer.CN;tls.write(`GET / HTTP/1.1\r\nHost: localhost:${target.address().port}\r\nConnection: close\r\n\r\n`);});
      let body='';tls.on('data',chunk=>body+=chunk);tls.on('error',reject);tls.on('end',()=>resolve({issuer,body}));
    });req.end();
  });
  const first=await fetch();assert.match(first.body,/502/);assert.equal(first.issuer,'mitmproxy');
  await new Promise((resolve,reject)=>{const timer=setInterval(()=>{if(runtime.status().diagnostics?.includes('DSH_TRAFFIC_PASSTHROUGH')){clearInterval(timer);clearTimeout(limit);resolve();}},10);const limit=setTimeout(()=>{clearInterval(timer);reject(new Error(runtime.status().diagnostics??'no passthrough event'));},3000);});
  const second=await fetch();assert.match(second.body,/transparent/);assert.equal(second.issuer,'localhost traffic test');
  await runtime.stop();
  assert.equal(store.snapshot().traffic.filter(row=>row.status===200).length,0,'transparent payload is not falsely recorded as intercepted HTTP');
});

test('real mitmdump preserves WebSocket exchange and records the HTTP upgrade', {skip:!mitmdumpAvailable,timeout:45000},async t=>{
  const dir=await mkdtemp(join(tmpdir(),'traffic-websocket-'));
  const store=new RedTeamStore(join(dir,'state.json')),task=await store.createTask('WebSocket','Preserve upgraded protocol');
  const runtime=new TrafficRuntime(store),target=createServer(),sockets=new Set();
  target.on('connection',socket=>{sockets.add(socket);socket.on('error',()=>{});socket.on('close',()=>sockets.delete(socket));});
  let received='';
  target.on('upgrade',(req,socket)=>{
    const accept=createHash('sha1').update(req.headers['sec-websocket-key']+'258EAFA5-E914-47DA-95CA-C5AB0DC85B11').digest('base64');
    socket.write(`HTTP/1.1 101 Switching Protocols\r\nConnection: Upgrade\r\nUpgrade: websocket\r\nSec-WebSocket-Accept: ${accept}\r\n\r\n`);
    let buffer=Buffer.alloc(0);
    const onData=chunk=>{
      buffer=Buffer.concat([buffer,chunk]);if(buffer.length<8)return;
      assert.equal(buffer[0],0x81);assert.equal(buffer[1],0x82);
      received=Buffer.from([buffer[6]^buffer[2],buffer[7]^buffer[3]]).toString();
      socket.off('data',onData);socket.end(Buffer.from([0x81,2,104,105,0x88,2,3,232]));
    };socket.on('data',onData);
  });
  await new Promise(resolve=>target.listen(0,'127.0.0.1',resolve));
  t.after(async()=>{try {await closeCapture(runtime,[target],sockets);} finally {await rm(dir,{recursive:true,force:true});}});
  const started=await runtime.start(task.id,await unusedPort());
  const response=await new Promise((resolve,reject)=>{
    const req=request({host:'127.0.0.1',port:started.port,path:`http://127.0.0.1:${target.address().port}/socket`,headers:{host:`127.0.0.1:${target.address().port}`,connection:'Upgrade',upgrade:'websocket','sec-websocket-key':Buffer.from('0123456789abcdef').toString('base64'),'sec-websocket-version':'13'}});
    req.on('error',reject);req.on('response',res=>{res.resume();reject(new Error('upgrade rejected: '+res.statusCode));});
    req.on('upgrade',(res,socket,head)=>{
      assert.equal(res.statusCode,101);const chunks=[head];
      const timer=setTimeout(()=>{socket.destroy();reject(new Error('WebSocket response timed out: '+runtime.status().diagnostics));},10000);
      socket.on('data',chunk=>{
        chunks.push(chunk);const body=Buffer.concat(chunks);
        if(body.includes(Buffer.from([0x88,2,3,232]))){
          clearTimeout(timer);socket.end(Buffer.from([0x88,0x82,1,2,3,4,3^1,232^2]));resolve(body);
        }
      });
      socket.on('error',error=>{clearTimeout(timer);reject(error);});socket.on('end',()=>{clearTimeout(timer);resolve(Buffer.concat(chunks));});
      socket.write(Buffer.from([0x81,0x82,1,2,3,4,104^1,105^2]));
    });req.end();
  });
  assert.equal(received,'hi');assert.ok(response.includes(Buffer.from([0x81,2,104,105])));
  await runtime.stop();
  const exchange=store.snapshot().traffic.find(row=>row.status===101);
  assert.ok(exchange);assert.match(exchange.url,/\/socket$/);
});
