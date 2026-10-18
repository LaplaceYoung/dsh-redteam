import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { TriggerScheduler } from '../lib/platform/scheduler.js';

const agent = (key = 'custom', extra = {}) => ({ key, enabled: true, builtin: false, triggerRunMode: 'serial', triggerMergeMode: 'by_task', triggerMaxParallel: 2, ...extra });
const trigger = (key = 'custom') => ({ agentKey: key, enabled: true, intervalSeconds: 0, events: ['finding'], toolNames: [], messages: {} });
async function fixture(t, options) {
  const root = await mkdtemp(join(tmpdir(), 'platform-scheduler-'));
  const runtime = new TriggerScheduler({ root, ...options }); await runtime.load();
  t.after(async () => { await runtime.dispose(); await rm(root, { recursive: true, force: true }); });
  return { root, runtime };
}
test('watermarks exclude history, consume disabled events, and survive restart', async t => {
  const events = [{ id: 'old', kind: 'finding', taskId: 't', message: 'old' }]; const ran = [];
  const options = { agents: () => [agent()], events: () => events, run: async r => { ran.push(r); } };
  const { root, runtime } = await fixture(t, options);
  await runtime.step(); const row = await runtime.save({ ...trigger(), enabled: false });
  events.push({ id: 'disabled', kind: 'finding', taskId: 't', message: 'disabled' }); await runtime.step();
  await runtime.save({ ...row, enabled: true }); await runtime.step(); await runtime.drain(); assert.equal(ran.length, 0);
  events.push({ id: 'new', kind: 'finding', taskId: 't', message: 'new' }); await runtime.step(); await runtime.drain(); assert.equal(ran.length, 1);
  const restarted = new TriggerScheduler({ root, ...options }); await restarted.load(); await restarted.step(); await restarted.drain(); await restarted.dispose(); assert.equal(ran.length, 1);
});
test('serial queues merge by task while distinct agents execute independently', async t => {
  const events = []; const ran = []; let release;
  const gate = new Promise(resolve => { release = resolve; });
  const { runtime } = await fixture(t, { agents: () => [agent(), agent('other')], events: () => events, run: async r => { ran.push(r); if (r.eventIds.includes('finding:1')) await gate; } });
  await runtime.step(); await runtime.save(trigger()); await runtime.save(trigger('other'));
  events.push({ id: '1', kind: 'finding', taskId: 'a', message: 'one' }); await runtime.step();
  events.push({ id: '2', kind: 'finding', taskId: 'a', message: 'two' }, { id: '3', kind: 'finding', taskId: 'b', message: 'three' }, { id: '4', kind: 'finding', taskId: 'a', message: 'four' }); await runtime.step();
  assert.equal(ran.length, 2); release(); await runtime.drain();
  for (const key of ['custom', 'other']) { const runs = ran.filter(r => r.agentKey === key); assert.equal(runs.length, 3); assert.deepEqual(runs[1].eventIds, ['finding:2', 'finding:4']); assert.equal(runs[2].taskId, 'b'); }
});
test('parallel respects capacity, preserves individual fires, and persists failures', async t => {
  let release; const gate = new Promise(resolve => { release = resolve; }); const events = []; let active = 0; let peak = 0;
  const { runtime } = await fixture(t, { agents: () => [agent('custom', { triggerRunMode: 'parallel', triggerMergeMode: 'all' })], events: () => events, run: async r => { peak = Math.max(peak, ++active); await gate; active--; if (r.eventIds.includes('finding:2')) throw new Error('fixture failed'); } });
  await runtime.step(); await runtime.save(trigger());
  for (let i = 0; i < 4; i++) events.push({ id: String(i), kind: 'finding', taskId: 'a', message: String(i) }); await runtime.step(); assert.equal(peak, 2);
  release(); await runtime.drain(); assert.equal(peak, 2); assert.equal(runtime.snapshot().runs.length, 4); assert.match(runtime.snapshot().runs.find(r => r.status === 'failed').error, /fixture failed/);
});
test('interval budget and tool filter use real event identities', async t => {
  let now = 10000; const events = []; const ran = [];
  const { runtime } = await fixture(t, { now: () => now, agents: () => [agent()], events: () => events, run: async r => { ran.push(r); } });
  await runtime.step(); await runtime.save({ ...trigger(), events: ['tool_call'], toolNames: ['REPORT_FINDING'], intervalSeconds: 5 });
  await runtime.step(); await runtime.drain(); assert.equal(ran.length, 1);
  events.push({ id: 'failed', kind: 'tool_call', toolName: 'report_finding', isError: true, message: 'failed' }, { id: 'ok', kind: 'tool_call', toolName: 'report_finding', message: 'ok' });
  await runtime.step(); await runtime.drain(); assert.equal(ran.length, 2);
  now += 5000; await runtime.step(); await runtime.drain(); assert.equal(ran.length, 3);
});
test('two installed scopes share atomic event consumption and per-agent capacity', async t => {
  const events = []; const ran = []; let release; const gate = new Promise(resolve => { release = resolve; });
  const options = { agents: () => [agent()], events: () => events, run: async row => { ran.push(row); await gate; } };
  const { root, runtime } = await fixture(t, options); await runtime.step();
  const other = new TriggerScheduler({ root, ...options }); await other.load();
  await runtime.save(trigger()); events.push({ id: 'shared', kind: 'finding', taskId: 't', message: 'shared' });
  await Promise.all([runtime.step(), other.step()]); assert.equal(ran.length, 1); assert.equal(other.snapshot().runs.length, 1);
  release(); await Promise.all([runtime.drain(), other.drain()]); await other.dispose();
});
