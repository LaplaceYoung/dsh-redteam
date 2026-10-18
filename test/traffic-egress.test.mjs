import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer, request } from 'node:http';
import { createServer as tcpServer, connect } from 'node:net';
import { once } from 'node:events';
import { createServer as httpsServer } from 'node:https';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { TrafficEgress, validateProxyUrl } from '../lib/traffic-tools/egress.js';

test('egress switches direct, authenticated HTTP CONNECT and SOCKS5 per new connection', {timeout:15000}, async t => {
  const sockets = new Set();
  const track = socket => { sockets.add(socket); socket.on('error',()=>{}); socket.on('close',()=>sockets.delete(socket)); return socket; };
  const target = createServer((req,res)=>res.end('response:'+req.url));
  const proxy = createServer();
  const tunnels = [];
  const forwardedHttp=[]; const forwardedSocks=[];
  proxy.on('connect',(req,client,head)=>{
    tunnels.push({url:req.url,auth:req.headers['proxy-authorization']});
    client.on('data',chunk=>forwardedHttp.push(chunk.toString()));
    const url = new URL('http://'+req.url);
    const remote = track(connect(Number(url.port),url.hostname,()=>{ client.write('HTTP/1.1 200 Connection Established\r\n\r\n'); if(head.length)remote.write(head); remote.pipe(client);client.pipe(remote); }));
    client.on('close',()=>remote.destroy());
  });
  const socksCalls=[];
  const socks = tcpServer(client=>{
    let buffer=Buffer.alloc(0),phase=0;
    const receive=chunk=>{
      buffer=Buffer.concat([buffer,chunk]);
      if(phase===0 && buffer.length>=2+buffer[1]) { assert.equal(buffer[0],5); buffer=buffer.subarray(2+buffer[1]);client.write(Buffer.from([5,2]));phase=1; }
      if(phase===1 && buffer.length>=2 && buffer.length>=3+buffer[1]+buffer[2+buffer[1]]) {
        const name=buffer.subarray(2,2+buffer[1]).toString();const password=buffer.subarray(3+buffer[1],3+buffer[1]+buffer[2+buffer[1]]).toString();
        assert.equal(name,'alice');assert.equal(password,'secret');buffer=buffer.subarray(3+buffer[1]+buffer[2+buffer[1]]);client.write(Buffer.from([1,0]));phase=2;
      }
      if(phase===2 && buffer.length>=5 && buffer.length>=7+buffer[4]) {
        assert.equal(buffer[3],3);const host=buffer.subarray(5,5+buffer[4]).toString(),port=buffer.readUInt16BE(5+buffer[4]); socksCalls.push({host,port});
        const remaining=buffer.subarray(7+buffer[4]);client.off('data',receive);
        client.on('data',chunk=>forwardedSocks.push(chunk.toString()));
        const remote=track(connect(port,host,()=>{client.write(Buffer.from([5,0,0,1,127,0,0,1,0,0]));if(remaining.length)remote.write(remaining);remote.pipe(client);client.pipe(remote);}));
        client.on('close',()=>remote.destroy());phase=3;
      }
    };client.on('data',receive);
  });
  for(const server of [target,proxy,socks]) {server.on('connection',track);server.listen(0,'127.0.0.1');await once(server,'listening');}
  let selected='';const relay=new TrafficEgress(()=>selected);const endpoint=new URL(await relay.start());
  t.after(async()=>{await relay.close();for(const socket of sockets)socket.destroy();await Promise.all([target,proxy,socks].map(server=>new Promise(resolve=>server.close(resolve))));});
  const fetchViaRelay=path=>new Promise((resolve,reject)=>{const req=request({host:endpoint.hostname,port:endpoint.port,path:`http://127.0.0.1:${target.address().port}${path}`,agent:false},res=>{let body='';res.on('data',chunk=>body+=chunk);res.on('end',()=>resolve({status:res.statusCode,body}));});req.on('error',reject);req.end();});
  assert.deepEqual(await fetchViaRelay('/direct'),{status:200,body:'response:/direct'});
  selected=validateProxyUrl(`http://alice:secret@127.0.0.1:${proxy.address().port}`);
  assert.deepEqual(await fetchViaRelay('/http'),{status:200,body:'response:/http'});
  assert.equal(tunnels.length,1);assert.equal(tunnels[0].auth,'Basic '+Buffer.from('alice:secret').toString('base64'));
  assert.match(forwardedHttp.join(''),/GET \/http HTTP\/1.1/);
  selected=validateProxyUrl(`socks5://alice:secret@127.0.0.1:${socks.address().port}`);
  assert.deepEqual(await fetchViaRelay('/socks'),{status:200,body:'response:/socks'});
  assert.deepEqual(socksCalls,[{host:'127.0.0.1',port:target.address().port}]);
  assert.match(forwardedSocks.join(''),/GET \/socks HTTP\/1.1/);
  selected='';assert.deepEqual(await fetchViaRelay('/cleared'),{status:200,body:'response:/cleared'});
  assert.equal(tunnels.length,1);assert.equal(socksCalls.length,1);
});

test('egress proxy configuration rejects unsupported or missing schemes',()=>{
  assert.equal(validateProxyUrl('  '),'');
  assert.throws(()=>validateProxyUrl('ftp://example.test'));
  assert.throws(()=>validateProxyUrl('example.test:8080'));
  assert.equal(validateProxyUrl('https://user:pass@example.test:8443'),'https://user:pass@example.test:8443/');
});

test('egress preserves WebSocket upgrade and bidirectional bytes after the HTTP handshake', {timeout:10000},async t=>{
  const sockets=new Set();
  const target=createServer();target.on('connection',socket=>{sockets.add(socket);socket.on('close',()=>sockets.delete(socket));});
  const payload=Buffer.from([0x82,3,0,255,128]);
  target.on('upgrade',(req,socket,head)=>{
    assert.equal(req.headers.upgrade,'websocket');assert.equal(req.url,'/socket?q=1');assert.equal(head.length,0);
    socket.write('HTTP/1.1 101 Switching Protocols\r\nConnection: Upgrade\r\nUpgrade: websocket\r\n\r\n');
    socket.once('data',chunk=>{assert.deepEqual(chunk,payload);socket.end(chunk);});
  });
  target.listen(0,'127.0.0.1');await once(target,'listening');
  const relay=new TrafficEgress(()=>''),url=new URL(await relay.start());
  t.after(async()=>{await relay.close();for(const socket of sockets)socket.destroy();await new Promise(resolve=>target.close(resolve));});
  const result=await new Promise((resolve,reject)=>{
    const req=request({host:url.hostname,port:url.port,path:`http://127.0.0.1:${target.address().port}/socket?q=1`,headers:{connection:'Upgrade',upgrade:'websocket'}});
    req.on('error',reject);req.on('response',res=>reject(new Error('not upgraded: '+res.statusCode)));
    req.on('upgrade',(res,socket,head)=>{assert.equal(res.statusCode,101);const chunks=[head];socket.on('data',chunk=>chunks.push(chunk));socket.on('error',reject);socket.on('end',()=>resolve(Buffer.concat(chunks)));socket.write(payload);});req.end();
  });
  assert.deepEqual(result,payload);
});

test('HTTPS upstream verifies its certificate and carries the real target request through CONNECT',{timeout:20000},async t=>{
  const fixture=new URL('./traffic-fixture-cert.pem',import.meta.url),pem=await readFile(fixture),sockets=new Set();
  const target=createServer((_req,res)=>res.end('verified HTTPS upstream'));
  const proxy=httpsServer({key:pem,cert:pem});let auth='',forwarded='';
  proxy.on('connect',(req,client,head)=>{
    auth=req.headers['proxy-authorization'];const url=new URL('http://'+req.url);
    const remote=connect(Number(url.port),url.hostname,()=>{client.write('HTTP/1.1 200 Connection Established\r\n\r\n');if(head.length)remote.write(head);remote.pipe(client);client.pipe(remote);});
    sockets.add(remote);remote.on('error',()=>client.destroy());client.on('close',()=>remote.destroy());client.on('data',chunk=>forwarded+=chunk.toString());
  });
  for(const server of [target,proxy]){server.on('connection',socket=>{sockets.add(socket);socket.on('error',()=>{});});server.listen(0,'127.0.0.1');await once(server,'listening');}
  t.after(async()=>{for(const socket of sockets)socket.destroy();await Promise.all([target,proxy].map(server=>new Promise(resolve=>server.close(resolve))));});
  const moduleUrl=new URL('../lib/traffic-tools/egress.js',import.meta.url).href;
  const source=`import {TrafficEgress} from ${JSON.stringify(moduleUrl)};import {request} from 'node:http';const relay=new TrafficEgress(()=>${JSON.stringify(`https://alice:secret@localhost:${proxy.address().port}`)});const address=new URL(await relay.start());try{const result=await new Promise((resolve,reject)=>{const req=request({host:address.hostname,port:address.port,path:${JSON.stringify(`http://127.0.0.1:${target.address().port}/secure-proxy`)}},res=>{let body='';res.on('data',chunk=>body+=chunk);res.on('end',()=>resolve({status:res.statusCode,body}));});req.on('error',reject);req.end();});console.log(JSON.stringify(result));}finally{await relay.close();}`;
  const {stdout}=await promisify(execFile)(process.execPath,['--input-type=module','-e',source],{env:{...process.env,NODE_EXTRA_CA_CERTS:fileURLToPath(fixture)},windowsHide:true,timeout:15000});
  assert.deepEqual(JSON.parse(stdout),{status:200,body:'verified HTTPS upstream'});
  assert.equal(auth,'Basic '+Buffer.from('alice:secret').toString('base64'));assert.match(forwarded,/GET \/secure-proxy HTTP\/1.1/);
});
