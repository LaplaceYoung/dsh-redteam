import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, chmod, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { RedTeamStore } from '../lib/store.js';
import { TrafficRuntime } from '../lib/traffic.js';

function deferred() { let resolve; const promise = new Promise(accept => { resolve = accept; }); return { promise, resolve }; }
async function fixture(t, code) {
  const dir = await mkdtemp(join(tmpdir(), 'redteam traffic runtime-'));
  t.after(() => rm(dir, { force: true, recursive: true }));
  const store = new RedTeamStore(join(dir, 'state.json'));
  const task = await store.createTask('Runtime fixture', 'Verify lifecycle');
  const source = join(dir, 'fixture.cjs');
  await writeFile(source, code);
  const command = join(dir, process.platform === 'win32' ? 'fixture.cmd' : 'fixture');
  await writeFile(command, process.platform === 'win32' ? `@echo off\r\n"${process.execPath}" "${source}"\r\n` : `#!/bin/sh\nexec '${process.execPath.replace(/'/g, "'\\''")}' '${source.replace(/'/g, "'\\''")}'\n`);
  if (process.platform !== 'win32') await chmod(command, 0o700);
  return { store, task, command };
}
const row = { host: 'fixture.test', method: 'GET', url: 'http://fixture.test/流量', status: 200, response: { body: '真实记录内容' } };
const captureScript = `console.log('DSH_TRAFFIC_READY'); console.log('DSH_TRAFFIC ' + ${JSON.stringify(JSON.stringify(row))}); setInterval(() => {}, 1000);`;

test('capture switch and global egress persist; disabled capture removes only the recorder CA', async t => {
  const {store,task,command}=await fixture(t,captureScript);
  const runtime=new TrafficRuntime(store,command);
  t.after(async()=>{if(runtime.status().running)await runtime.stop();});
  await runtime.load();
  assert.deepEqual(runtime.configuration(),{captureEnabled:false,globalProxy:'',trafficBindingEnabled:false});
  await runtime.setTrafficBindingEnabled(true);
  await runtime.setGlobalProxy('socks5://alice:secret@127.0.0.1:9000');
  assert.equal(runtime.configuration().globalProxy,'socks5://***:***@127.0.0.1:9000');
  const started=await runtime.start(task.id,18828);
  assert.equal(runtime.workerEnvironment(task.id).HTTP_PROXY,started.proxyUrl);
  assert.ok(runtime.workerEnvironment(task.id).SSL_CERT_FILE);
  await runtime.setCaptureEnabled(false);
  assert.equal(runtime.workerEnvironment(task.id).HTTP_PROXY,'socks5://alice:secret@127.0.0.1:9000');
  assert.equal(runtime.workerEnvironment(task.id).SSL_CERT_FILE,undefined);
  const restored=new TrafficRuntime(store,command);await restored.load();
  assert.deepEqual(restored.configuration(),runtime.configuration());
  assert.equal(restored.configuration().trafficBindingEnabled,true);
  await runtime.setGlobalProxy('');
  assert.deepEqual(runtime.workerEnvironment(task.id),{});
  await runtime.stop();
});

test('stop waits for accepted writes and actual process closure before allowing a new capture', { timeout: 20_000 }, async t => {
  const { store, task, command } = await fixture(t, captureScript);
  const received = deferred(); const release = deferred();
  const save = store.addTraffic.bind(store);
  store.addTraffic = async input => { received.resolve(); await release.promise; return save(input); };
  const runtime = new TrafficRuntime(store, command);
  t.after(async () => { release.resolve(); if (runtime.status().running) await runtime.stop(); });
  const started = await runtime.start(task.id, 18821);
  await received.promise;
  let stopReturned = false;
  const stopping = runtime.stop().then(value => { stopReturned = true; return value; });
  const restarting = runtime.start(task.id, 18822);
  assert.equal(store.snapshot().traffic.length, 0);
  assert.equal(stopReturned, false);
  release.resolve();
  assert.deepEqual(await stopping, { running: false });
  assert.equal(store.snapshot().traffic[0].response.body, '真实记录内容');
  assert.throws(() => process.kill(started.pid, 0), { code: 'ESRCH' });
  const next = await restarting;
  assert.equal(next.port, 18822);
  assert.equal(runtime.status().pid, next.pid);
  assert.deepEqual(await runtime.stop(), { running: false });
});

test('capture write failures are observable and stop rejects after process shutdown', { timeout: 20_000 }, async t => {
  const { store, task, command } = await fixture(t, captureScript);
  const received = deferred();
  store.addTraffic = async () => { received.resolve(); throw new Error('fixture disk write failed'); };
  const runtime = new TrafficRuntime(store, command);
  t.after(async () => { if (runtime.status().running) await runtime.stop(); });
  const started = await runtime.start(task.id, 18823);
  await received.promise;
  await assert.rejects(runtime.stop(), /failed to persist traffic.*fixture disk write failed/);
  assert.equal(runtime.status().running, false);
  assert.match(runtime.status().error, /fixture disk write failed/);
  assert.throws(() => process.kill(started.pid, 0), { code: 'ESRCH' });
});

test('startup failure reports stderr and does not claim a running proxy', { timeout: 20_000 }, async t => {
  const { store, task, command } = await fixture(t, "console.error('fixture port already in use'); process.exit(3);");
  const runtime = new TrafficRuntime(store, command);
  t.after(async () => { if (runtime.status().running) await runtime.stop(); });
  await assert.rejects(runtime.start(task.id, 18824), /fixture port already in use/);
  assert.equal(runtime.status().running, false);
  assert.match(runtime.status().diagnostics, /fixture port already in use/);
});

test('final stdout fragment is drained on unexpected exit and its failure is preserved', { timeout: 20_000 }, async t => {
  const script = `console.log('DSH_TRAFFIC_READY'); process.stdout.write('DSH_TRAFFIC ' + ${JSON.stringify(JSON.stringify(row))}, () => process.exit(7));`;
  const { store, task, command } = await fixture(t, script);
  const saved = deferred();
  const save = store.addTraffic.bind(store);
  store.addTraffic = async input => { const result = await save(input); saved.resolve(); return result; };
  const runtime = new TrafficRuntime(store, command);
  t.after(async () => { if (runtime.status().running) await runtime.stop(); });
  await runtime.start(task.id, 18825);
  await saved.promise;
  await assert.rejects(runtime.stop(), /exited.*code 7/);
  assert.equal(store.snapshot().traffic[0].url, 'http://fixture.test/流量');
});

test('invalid traffic rows produce diagnostics instead of silent data loss', { timeout: 20_000 }, async t => {
  const { store, task, command } = await fixture(t, "console.log('DSH_TRAFFIC_READY'); console.log('DSH_TRAFFIC {\"host\":3}'); setInterval(() => {}, 1000);");
  const runtime = new TrafficRuntime(store, command);
  t.after(async () => { if (runtime.status().running) await runtime.stop(); });
  try { await runtime.start(task.id, 18826); } catch (error) { assert.match(String(error), /invalid traffic capture record/); }
  await assert.rejects(runtime.stop(), /invalid traffic capture record/);
  assert.equal(store.snapshot().traffic.length, 0);
});

test('capture rejects missing or archived tasks before launching a process', async t => {
  const { store, task, command } = await fixture(t, captureScript);
  const runtime = new TrafficRuntime(store, command);
  await assert.rejects(runtime.start('missing'), /task not found/);
  await assert.rejects(runtime.start(task.id, 8080, { workerSessionId: 'unrelated-child' }), /worker session is not bound/);
  await store.addArchive({ taskId: task.id, state: 'ready', progress: 100 });
  await assert.rejects(runtime.start(task.id), /archive.*ready/);
  assert.equal(runtime.status().running, false);
});

test('addon persistence errors remain observable after process shutdown', { timeout: 20_000 }, async t => {
  const { store, task, command } = await fixture(t, "console.log('DSH_TRAFFIC_READY'); console.log('DSH_TRAFFIC_ERROR OSError: fixture blob volume full'); setInterval(() => {}, 1000);");
  const runtime = new TrafficRuntime(store, command);
  try { await runtime.start(task.id, 18827); } catch (error) { assert.match(String(error), /fixture blob volume full/); }
  await assert.rejects(runtime.stop(), /traffic capture failed.*fixture blob volume full/);
  assert.equal(runtime.status().running, false);
  assert.equal(store.snapshot().traffic.length, 0);
});
