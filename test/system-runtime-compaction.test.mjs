import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, readdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:http';
import { build } from 'esbuild';

const bundle = await build({ entryPoints: ['src/system-runtime/compaction.ts'], bundle: true, write: false, platform: 'node', format: 'esm', packages: 'external' });
const { createCompactionRuntime } = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString('base64')}`);
const summary = 'The earlier task inspected project files and established the exact required behavior. Preserve the user request and continue the remaining verification.';
const message = (value) => ({ role: 'user', content: [{ type: 'text', text: value }] });
const request = () => ({ provider: 'fixture', model: 'fixture', messages: Array.from({ length: 12 }, (_, i) => message(`message-${i}: ${'original-evidence '.repeat(500)}`)) });
const refs = value => value.messages.map(m => m.content.find(c => c.type === 'text' && c.text.startsWith('<noa-ref'))?.text.match(/id="([^"]+)"/)?.[1]);
async function fixture(t, enabled = () => true) {
  const root = await mkdtemp(join(tmpdir(), 'noa-test-')); t.after(() => rm(root, { recursive: true, force: true }));
  const runtime = createCompactionRuntime({ enabled, archiveRoot: root });
  return { root, runtime, run: runtime.createRun({ sessionId: 'fixture-session', kind: 'worker' }) };
}

test('setting is captured once for each of the four agent roles and disabled requests remain identical', async t => {
  let enabled = false;
  const { runtime } = await fixture(t, () => enabled);
  for (const kind of ['planner', 'worker', 'mainagent', 'chat']) {
    const off = runtime.createRun({ sessionId: kind, kind }); enabled = true;
    const input = request(); assert.equal(off.prepareRequest(input), input);
    const on = runtime.createRun({ sessionId: kind, kind }); enabled = false;
    assert.equal(on.enabled, true); assert.equal(on.prepareRequest(input).tools[0].name, 'Compress');
  }
});

test('model supplied summary replaces only selected messages, preserves frozen input, and archives exact originals', async t => {
  const { run } = await fixture(t), input = request();
  const original = JSON.stringify(input); Object.freeze(input.messages); Object.freeze(input);
  const prepared = run.prepareRequest(input), ids = refs(prepared);
  const result = run.compress({ content: [{ startId: ids[0], endId: ids[2], summary }] });
  assert.equal(result.blocks.length, 1); assert.ok(result.reclaimedTokens > 0);
  const archived = JSON.parse(await readFile(result.archives[0], 'utf8'));
  assert.deepEqual(archived.map(e => e.message), input.messages.slice(0, 3));
  const projected = run.prepareRequest(input);
  assert.equal(projected.messages.length, input.messages.length - 2);
  assert.ok(projected.messages[0].content[0].text.includes(summary));
  assert.ok(!JSON.stringify(projected.messages).includes('message-0:'));
  assert.equal(JSON.stringify(input), original);
  assert.equal(refs(projected)[1], ids[3]);
});

test('ledger survives restart and changed message content is never hidden under an older summary', async t => {
  const { root, run } = await fixture(t), input = request(), ids = refs(run.prepareRequest(input));
  run.compress({ content: [{ startId: ids[0], endId: ids[2], summary }] });
  const restored = createCompactionRuntime({ enabled: () => true, archiveRoot: root }).createRun({ sessionId: 'fixture-session', kind: 'chat' });
  assert.ok(restored.prepareRequest(input).messages[0].content[0].text.includes(summary));
  const edited = structuredClone(input); edited.messages[1].content[0].text = 'changed evidence';
  const projected = restored.prepareRequest(edited);
  assert.equal(projected.messages.length, input.messages.length);
  assert.ok(JSON.stringify(projected).includes('changed evidence'));
});

test('validation rejects recent context, overlapping ranges, growing summaries and malformed inputs atomically', async t => {
  const { root, run } = await fixture(t), input = request(), ids = refs(run.prepareRequest(input));
  assert.throws(() => run.compress({ content: [{ startId: ids[8], endId: ids[10], summary }] }), /recent/);
  assert.throws(() => run.compress({ content: [{ startId: ids[0], endId: ids[1], summary }, { startId: ids[1], endId: ids[2], summary }] }), /overlap/);
  assert.throws(() => run.compress({ content: [{ startId: ids[0], endId: ids[0], summary: 'x'.repeat(19_000) }] }), /shrink/);
  assert.throws(() => run.compress({ content: [{ startId: ids[0] }] }), /requires/);
  const directory = join(root, (await readdir(root))[0]);
  assert.deepEqual(await readdir(directory), ['state.json']);
  assert.equal(run.prepareRequest(input).messages.length, input.messages.length);
});

test('tool exchange boundaries are preserved and complete exchanges can be compressed', async t => {
  const { run } = await fixture(t), input = request();
  input.messages.splice(1, 0,
    { role: 'assistant', id: 'assistant-1', source: { kind: 'model', provider: 'fixture', model: 'fixture' }, content: [{ type: 'tool-call', id: 'call-1', name: 'Read', arguments: '{}' }] },
    { role: 'tool', id: 'tool-1', source: { kind: 'tool', callId: 'call-1' }, toolCallId: 'call-1', content: [{ type: 'text', text: 'tool-output'.repeat(500) }] });
  const ids = refs(run.prepareRequest(input));
  assert.throws(() => run.compress({ content: [{ startId: ids[2], endId: ids[3], summary }] }), /pair/);
  assert.equal(run.compress({ content: [{ startId: ids[0], endId: ids[3], summary }] }).blocks.length, 1);
  assert.ok(!JSON.stringify(run.prepareRequest(input).messages).includes('call-1'));
});

test('two runs cannot report success for overlapping stale views', async t => {
  const { runtime, run } = await fixture(t), input = request();
  const another = runtime.createRun({ sessionId: 'fixture-session', kind: 'worker' });
  const ids = refs(run.prepareRequest(input)); another.prepareRequest(input);
  run.compress({ content: [{ startId: ids[0], endId: ids[2], summary }] });
  assert.throws(() => another.compress({ content: [{ startId: ids[0], endId: ids[2], summary }] }), /stale/);
});

test('attachment registers executable tool on actual agent scope and cancellation prevents archival', async t => {
  const { run } = await fixture(t), input = request(), ids = refs(run.prepareRequest(input));
  let definition, disposed = false;
  const agent = { id: 'fixture-session', ctx: { tools: { register(tool) { definition = tool; return () => { disposed = true; }; } } } };
  const detach = run.attach({}, agent); assert.equal(definition.name, 'Compress');
  const abort = AbortSignal.abort(new Error('test-abort'));
  await assert.rejects(() => definition.execute({ content: [{ startId: ids[0], endId: ids[2], summary }] }, { signal: abort }), /test-abort/);
  const result = await definition.execute({ content: [{ startId: ids[0], endId: ids[2], summary }] }, { signal: new AbortController().signal });
  assert.equal(result.blocks.length, 1); detach(); assert.equal(disposed, true);
});

test('real local protocol endpoint receives compacted message payload with original archive available', async t => {
  const { run } = await fixture(t), input = request(), ids = refs(run.prepareRequest(input));
  const result = run.compress({ content: [{ startId: ids[0], endId: ids[2], summary }] });
  let received;
  const server = createServer(async (req, res) => { const chunks = []; for await (const chunk of req) chunks.push(chunk); received = JSON.parse(Buffer.concat(chunks)); res.setHeader('content-type', 'application/json'); res.end(JSON.stringify({ choices: [{ message: { role: 'assistant', content: 'ok' } }] })); });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => { server.closeAllConnections(); server.close(resolve); }));
  const reply = await fetch(`http://127.0.0.1:${server.address().port}/v1/chat/completions`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(run.prepareRequest(input)) });
  assert.equal(reply.status, 200); await reply.json();
  assert.ok(JSON.stringify(received.messages).includes(summary)); assert.ok(!JSON.stringify(received.messages).includes('message-0:'));
  assert.ok((await readFile(result.archives[0], 'utf8')).includes('message-0:'));
});

test('enable failure warns and retains built-in behavior; malformed state is never treated as successful compression', async t => {
  const { root } = await fixture(t); const invalid = join(root, 'regular-file'); await writeFile(invalid, 'x');
  const warnings = [], runtime = createCompactionRuntime({ enabled: () => true, archiveRoot: invalid, onWarn: value => warnings.push(value) });
  const run = runtime.createRun({ sessionId: 'bad', kind: 'planner' });
  assert.equal(run.enabled, false); assert.equal(warnings.length, 1);
  const input = request(); assert.equal(run.prepareRequest(input), input);
});

test('multi-tier summaries retain recoverable archive chains and enforce terminal tier', async t => {
  const { run } = await fixture(t), input = request(), ids = refs(run.prepareRequest(input));
  const first = run.compress({ content: [
    { startId: ids[0], endId: ids[1], summary: summary.repeat(12) },
    { startId: ids[2], endId: ids[3], summary: summary.repeat(12) },
  ] });
  const view2 = run.prepareRequest(input), tier2 = run.compress({ content: [{ startId: refs(view2)[0], endId: refs(view2)[1], summary: summary.repeat(4) }] });
  const archive2 = await readFile(tier2.archives[0], 'utf8');
  assert.ok(JSON.parse(archive2)[0].message.content[0].text.includes(JSON.stringify(first.archives[0])));
  const view3 = run.prepareRequest(input), tier3 = run.compress({ content: [{ startId: refs(view3)[0], endId: refs(view3)[1], summary }] });
  const view4 = run.prepareRequest(input); assert.ok(view4.messages[0].content[0].text.includes('tier="3"'));
  assert.throws(() => run.compress({ content: [{ startId: refs(view4)[0], endId: refs(view4)[0], summary }] }), /Tier 3/);
  assert.ok((await readFile(tier3.archives[0], 'utf8')).includes('tier=\\"2\\"'));
});

test('pressure nudges stop after three ignored attempts and restart for new user input', async t => {
  const { runtime } = await fixture(t), input = request();
  const run = runtime.createRun({ sessionId: 'pressure', kind: 'planner', contextWindow: 10_000 });
  for (let n = 0; n < 3; n++) assert.equal(run.prepareRequest(input).messages.length, input.messages.length + 1);
  assert.equal(run.prepareRequest(input).messages.length, input.messages.length);
  input.messages.push(message('a new user instruction'));
  assert.equal(run.prepareRequest(input).messages.length, input.messages.length + 1);
});

test('emergency valve only shortens old large tool text and overflow retries require measured progress', async t => {
  const { runtime } = await fixture(t);
  const run = runtime.createRun({ sessionId: 'overflow', kind: 'mainagent', contextWindow: 200_000 });
  const originalText = 'large-tool-data '.repeat(8_000);
  const input = { provider: 'fixture', model: 'fixture', messages: [
    message('start'),
    { role: 'assistant', id: 'a', source: { kind: 'model', provider: 'fixture', model: 'fixture' }, content: [{ type: 'tool-call', id: 'call', name: 'Read', arguments: '{}' }] },
    { role: 'tool', id: 't', source: { kind: 'tool', callId: 'call' }, toolCallId: 'call', content: [{ type: 'text', text: originalText }] },
    ...Array.from({ length: 6 }, (_, i) => message(`recent ${i}`)),
  ] };
  const first = run.prepareRequest(input);
  assert.ok(!JSON.stringify(first).includes('[truncated for context space'));
  const shrunk = run.recoverOverflow(input, new Error('maximum context length is 10000 tokens'));
  assert.ok(shrunk); assert.ok(JSON.stringify(shrunk).includes('[truncated for context space'));
  assert.equal(shrunk.messages[2].toolCallId, 'call'); assert.equal(input.messages[2].content[0].text, originalText);
  assert.equal(run.recoverOverflow(input, new Error('maximum context length is 10000 tokens')), undefined);
  assert.equal(run.recoverOverflow(input, new Error('authentication failed')), undefined);
  const impossible = runtime.createRun({ sessionId: 'unsplittable', kind: 'chat', contextWindow: 200_000 });
  const userOnly = { ...input, messages: [message(originalText)] }; impossible.prepareRequest(userOnly);
  assert.equal(impossible.recoverOverflow(userOnly, new Error('maximum context length is 10000 tokens')), undefined);
});

test('corrupt persisted ledger fails enabling with explicit warning instead of dropping history silently', async t => {
  const { root, run } = await fixture(t); run.prepareRequest(request());
  const directory = join(root, (await readdir(root))[0]); await writeFile(join(directory, 'state.json'), '{"version":1,"blocks":[]}');
  const warnings = [], restored = createCompactionRuntime({ enabled: () => true, archiveRoot: root, onWarn: value => warnings.push(value) });
  assert.equal(restored.createRun({ sessionId: 'fixture-session', kind: 'chat' }).enabled, false);
  assert.match(warnings[0], /Invalid noa ledger/);
});

test('child runs inherit ledger and absolute archive paths without sharing mutable compression state', async t => {
  const { runtime, run } = await fixture(t), input = request(), ids = refs(run.prepareRequest(input));
  const parent = run.compress({ content: [{ startId: ids[0], endId: ids[2], summary }] });
  const child = runtime.createRun({ sessionId: 'child', kind: 'worker', parentSessionIds: ['fixture-session'] });
  const inherited = child.prepareRequest(input); assert.ok(inherited.messages[0].content[0].text.includes(JSON.stringify(parent.archives[0])));
  const childIds = refs(inherited); child.compress({ content: [{ startId: childIds[1], endId: childIds[2], summary }] });
  assert.equal(child.prepareRequest(input).messages.length, 9); assert.equal(run.prepareRequest(input).messages.length, 10);
});

test('successful Compress exchange is removed as a pair and provider input floor expires after compression', async t => {
  const { run } = await fixture(t), input = request();
  run.noteInputTokens(190_000);
  const view = run.prepareRequest(input); assert.equal(view.messages.length, input.messages.length + 1);
  const ids = refs(view); run.compress({ content: [{ startId: ids[0], endId: ids[2], summary }] }, 'compress-call');
  input.messages.push(
    { role: 'assistant', id: 'compress-assistant', source: { kind: 'model', provider: 'fixture', model: 'fixture' }, content: [{ type: 'tool-call', id: 'compress-call', name: 'Compress', arguments: '{}' }] },
    { role: 'tool', id: 'compress-result', source: { kind: 'tool', callId: 'compress-call' }, toolCallId: 'compress-call', content: [{ type: 'text', text: '{"blocks":["b1"]}' }] });
  const after = run.prepareRequest(input);
  assert.equal(after.messages.length, 10); assert.ok(!JSON.stringify(after.messages).includes('compress-call'));
  assert.ok(!JSON.stringify(after.messages).includes('Context emergency'));
});

test('raw fenced and stringified range arrays accepted by the core preserve model summaries', async t => {
  const { run } = await fixture(t), input = request(), ids = refs(run.prepareRequest(input));
  const content = JSON.stringify([{ startId: ids[0], endId: ids[2], summary }]);
  const result = run.compress('```json\n' + JSON.stringify({ content }) + '\n```');
  assert.equal(result.blocks.length, 1);
});

test('recover truncated range arrays and trailing commas without changing quoted summary text', async t => {
  const { runtime, run } = await fixture(t), input = request(), ids = refs(run.prepareRequest(input));
  const exact = summary + ' Keep the exact token sequence comma,} and escaped quote " in evidence.';
  const raw = '{"content":[' + JSON.stringify({ startId: ids[0], endId: ids[2], summary: exact }) + ', {"startId":"';
  const repaired = run.compress(raw); assert.equal(repaired.repairedArguments, true);
  assert.ok(run.prepareRequest(input).messages[0].content[0].text.includes(exact));
  const other = runtime.createRun({ sessionId: 'trailing', kind: 'chat' }), otherIds = refs(other.prepareRequest(input));
  const trailing = '{"content":[' + JSON.stringify({ startId: otherIds[0], endId: otherIds[2], summary: exact }) + ',],}';
  assert.equal(other.compress(trailing).repairedArguments, true);
  const broken = runtime.createRun({ sessionId: 'broken', kind: 'chat' }); broken.prepareRequest(input);
  assert.throws(() => broken.compress('{"content":[{"startId":"'), /before any complete range/);
});
