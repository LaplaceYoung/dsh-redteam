import test from 'node:test';
import assert from 'node:assert/strict';
import childProcess from 'node:child_process';
import { syncBuiltinESMExports } from 'node:module';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { RedTeamStore } from '../lib/store.js';

test('Windows tree termination error waits for actual capture closure and drains accepted records', {skip: process.platform !== 'win32', timeout: 20_000}, async t => {
  const directory = await mkdtemp(join(tmpdir(), 'traffic-stop-race-'));
  const originalExecFile = childProcess.execFile;
  let runtime;
  t.after(async () => {
    childProcess.execFile = originalExecFile;
    syncBuiltinESMExports();
    try { if (runtime?.status().running) await runtime.stop(); }
    finally { await rm(directory, {recursive: true, force: true}); }
  });
  let terminationRequested = false;
  childProcess.execFile = function (file, args, options, callback) {
    if (file !== 'taskkill.exe') return originalExecFile(file, args, options, callback);
    terminationRequested = true;
    // Keep the real process boundary. Report taskkill's transient tree error
    // before the OS completes termination and Node emits the capture close.
    const process = originalExecFile(file, args, options, () => {});
    callback(Object.assign(new Error('a descendant already exited'), {code: 255}), '', 'a descendant already exited');
    return process;
  };
  syncBuiltinESMExports();
  const { TrafficRuntime } = await import('../lib/traffic.js?termination-race');
  const script = join(directory, 'capture.cjs');
  const command = join(directory, 'capture.cmd');
  await writeFile(script, `console.log('DSH_TRAFFIC_READY'); console.log('DSH_TRAFFIC '+JSON.stringify({host:'race.test',method:'GET',url:'http://race.test/drain'})); setInterval(()=>{},1000);`);
  await writeFile(command, `@echo off\r\n"${process.execPath}" "${script}"\r\n`);
  const store = new RedTeamStore(join(directory, 'state.json'));
  const task = await store.createTask('Process closure', 'Drain records after a tree termination race');
  runtime = new TrafficRuntime(store, command);
  const status = await runtime.start(task.id, 18829);
  assert.deepEqual(await runtime.stop(), {running: false});
  assert.equal(terminationRequested, true);
  assert.throws(() => process.kill(status.pid, 0), {code: 'ESRCH'});
  assert.equal(store.snapshot().traffic[0].url, 'http://race.test/drain');
});
