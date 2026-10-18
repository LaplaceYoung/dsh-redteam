import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { randomUUID, createHash } from 'node:crypto';
import { crc32 } from 'node:zlib';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { Context } from '@deepseek-ai/cordis';
import { SessionStore, SessionId } from '@deepseek-ai/dsh-session';
import AgentRegistry from '@deepseek-ai/dsh-agent';
import AgentLoop from '@deepseek-ai/dsh-agent-loop';
import LlmRuntime from '@deepseek-ai/dsh-llm';
import SystemPrompt from '@deepseek-ai/dsh-system-prompt';
import ToolRuntime from '@deepseek-ai/dsh-tools';
import SessionProjections from '@deepseek-ai/dsh-session-projection';
import { RedTeamStore } from '../lib/store.js';
import { installNativeRea } from '../lib/rea-native-integration.js';

const targetMeta = { provenance: { untrusted_content: true, source: 'analysis_target' } };
const question = {
  question: 'What produced this observed resource?', domain: 'provenance', severity: 'medium',
  required_authority: 'shipped-artifact', required_confidence: 'observed', required_environment: null,
  recommended_probes: [], relationships: [],
};

// AgentRegistry and AgentLoop construct real, idle DSH agents. No model request is needed.
async function setup(t) {
  const dir = await mkdtemp(join(tmpdir(), 'redteam-native-rea-'));
  const store = new RedTeamStore(join(dir, 'state.json'));
  const task = await store.createTask('Native evidence', 'Validate an audited fixture');
  const app = new Context();
  const fibers = [];
  const handles = [];
  let controller;
  t.after(async () => {
    for (const handle of handles.reverse()) await handle.dispose();
    for (const fiber of fibers.reverse()) await fiber.dispose();
    await rm(dir, { recursive: true, force: true });
  });
  const mount = async (plugin, config) => { fibers.push(await app.plugin(plugin, config)); };
  await mount(SessionStore);
  await mount(AgentRegistry);
  await mount(LlmRuntime);
  await mount(SystemPrompt, {});
  await mount(ToolRuntime, { mode: 'native' });
  await mount(SessionProjections);
  await mount(AgentLoop, {});
  await mount(ctx => { ctx.inject(['tools'], inner => { controller = installNativeRea(inner, store); }); });
  assert.ok(controller);
  const createAgent = async () => {
    const handle = await app.get('agents').create({ sessionId: SessionId(randomUUID()), meta: { cwd: dir } });
    handles.push(handle);
    return handle;
  };
  const call = (agent, name, args, signal = AbortSignal.timeout(120_000)) => app.get('tools').execute({
    callId: randomUUID(), name, arguments: args, ...(agent ? { agent } : {}), signal,
  });
  const native = (agent, operation, input, signal) => call(agent, 'redteam_rea_native', {
    task_id: task.id, operation, ...(input === undefined ? {} : { input }),
  }, signal);
  const success = async (agent, operation, input) => {
    const result = await native(agent, operation, input);
    assert.equal(result.isError, false, JSON.stringify(result));
    return result.value;
  };
  const bundle = async agent => (await success(agent, 'get_evidence_bundle')).toolResult.structuredContent.result;
  return { dir, app, store, task, controller, createAgent, call, native, success, bundle };
}

function resourcePe() {
  const bytes = Buffer.alloc(640);
  bytes.write('MZ'); bytes.writeUInt32LE(128, 60);
  bytes.write('PE\0\0', 128); bytes.writeUInt16LE(0x8664, 132);
  bytes.writeUInt16LE(1, 134); bytes.writeUInt16LE(240, 148);
  bytes.writeUInt16LE(0x20b, 152); bytes.writeBigUInt64LE(0x140000000n, 176);
  bytes.writeUInt32LE(4096, 184); bytes.writeUInt32LE(512, 188);
  bytes.writeUInt32LE(8192, 208); bytes.writeUInt32LE(512, 212);
  bytes.writeUInt32LE(16, 260); bytes.writeUInt32LE(4096, 280); bytes.writeUInt32LE(128, 284);
  bytes.write('.rsrc', 392); bytes.writeUInt32LE(128, 400); bytes.writeUInt32LE(4096, 404);
  bytes.writeUInt32LE(128, 408); bytes.writeUInt32LE(512, 412); bytes.writeUInt32LE(0x40000040, 428);
  for (const [offset, id, target] of [[512, 10, 0x80000018], [536, 7, 0x80000030], [560, 1033, 72]]) {
    bytes.writeUInt16LE(1, offset + 14); bytes.writeUInt32LE(id, offset + 16); bytes.writeUInt32LE(target, offset + 20);
  }
  bytes.writeUInt32LE(4192, 584); bytes.writeUInt32LE(5, 588); bytes.write('HELLO', 608);
  return bytes;
}

async function inspectPe(fixture, agent) {
  const path = join(fixture.dir, 'resource.exe');
  const bytes = resourcePe();
  await writeFile(path, bytes);
  const response = await fixture.native(agent, 'inspect_pe_resources', { path });
  assert.equal(response.isError, false, JSON.stringify(response));
  const value = response.value;
  assert.equal(value.native, true);
  assert.deepEqual(value.result, value.toolResult.structuredContent, 'legacy result remains the Evidence envelope');
  assert.equal(value.result.subject.digest.sha256, createHash('sha256').update(bytes).digest('hex'));
  assert.equal(value.result.normalized_result.resources[0].payload.location.offset, 608);
  assert.equal(value.result.normalized_result.resources[0].payload.sha256, '3733cd977ff8eb18b987357e22ced99f46097f31ecb239e878ae63760e83e4d5');
  assert.deepEqual(value.toolResult._meta, targetMeta);
  assert.deepEqual(response.meta.provenance, value.toolResult._meta.provenance);
  assert.deepEqual(fixture.store.snapshot().evidence.find(row => row.id === value.evidenceId).raw, value.toolResult);
  return value.result;
}

test('DSH manifest discovers 211 native operations and 6 prompts; file commands require no Agent', { timeout: 180_000 }, async t => {
  const f = await setup(t);
  const manifest = await f.call(undefined, 'redteam_rea_native_manifest', {});
  assert.equal(manifest.isError, false, JSON.stringify(manifest));
  assert.equal(manifest.value.operations.length, 211);
  assert.equal(new Set(manifest.value.operations.map(row => row.name)).size, 211);
  assert.equal(manifest.value.prompts.length, 6);
  assert.ok(manifest.value.operations.every(operation => operation.inputSchema.type === 'object'));
  const source = resolve('src/rea-native/evidence/fixtures/bundle.json');
  const checked = await f.success(undefined, 'validate_evidence_bundle_file', { path: source });
  assert.equal(checked.result.total, 5);
  assert.deepEqual(f.store.snapshot().evidence[0].raw, checked.result);
  const output = join(f.dir, 'export.json');
  await f.success(undefined, 'export_evidence_bundle_file', { source, output });
  assert.equal(JSON.parse(await readFile(output, 'utf8')).records.length, 5);
  const duplicate = await f.native(undefined, 'export_evidence_bundle_file', { source, output });
  assert.equal(duplicate.isError, true, 'export must not silently overwrite existing files');
  assert.equal(f.store.snapshot().evidence.length, 2, 'failed operations must not create success evidence');
  const missingAgent = await f.native(undefined, 'get_evidence_bundle');
  assert.equal(missingAgent.isError, true);
  assert.equal(missingAgent.error.info.code, 'REA_AGENT_REQUIRED');
});

test('real DSH Agents isolate PE Evidence and unknown revisions and transfer only through explicit import', { timeout: 180_000 }, async t => {
  const f = await setup(t);
  const left = (await f.createAgent()).agent;
  const right = (await f.createAgent()).agent;
  assert.notEqual(left.id, right.id);
  const evidence = await inspectPe(f, left);
  assert.equal((await f.bundle(left)).records.length, 1);
  assert.deepEqual((await f.bundle(right)).records, []);
  const head = (await f.success(left, 'record_unknown', { ...question, supporting_evidence_ids: [evidence.evidence_id] })).result.result;
  assert.equal(head.status, 'open');
  assert.equal(head.revision, 1);
  const update = {
    unknown_id: head.unknown_id, expected_revision: head.revision, status: 'blocked', severity: head.severity,
    supporting_evidence_ids: head.supporting_evidence_ids, contradicting_evidence_ids: head.contradicting_evidence_ids,
    required_authority: head.required_authority, required_confidence: head.required_confidence,
    required_environment: head.required_environment, recommended_probes: head.recommended_probes,
    relationships: head.relationships, resolution: head.resolution,
  };
  const updated = (await f.success(left, 'update_unknown', update)).result.result;
  assert.equal(updated.revision, 2);
  assert.equal(updated.status, 'blocked');
  assert.equal(updated.previous_revision_digest, head.revision_digest);
  assert.equal((await f.success(left, 'list_unknowns')).result.result.total, 1);
  assert.equal((await f.success(right, 'list_unknowns')).result.result.total, 0);
  const beforeFailure = f.store.snapshot().evidence.length;
  const conflict = await f.native(left, 'update_unknown', update);
  assert.equal(conflict.isError, true);
  assert.equal(conflict.meta.rea.isError, true);
  assert.ok(conflict.meta.rea.structuredContent.error);
  assert.equal(f.store.snapshot().evidence.length, beforeFailure);
  const path = join(f.dir, 'session-evidence.json');
  const exported = (await f.success(left, 'export_evidence_bundle', { path })).result.result;
  assert.equal(exported.records, 3);
  assert.equal(exported.unknowns, 2);
  assert.deepEqual((await f.bundle(right)).records, []);
  assert.deepEqual((await f.success(right, 'import_evidence_bundle', { path })).result.result, { imported: 3, unknowns_added: 2, total: 3 });
  assert.deepEqual(await f.bundle(right), await f.bundle(left));
});

test('DSH error path preserves original structured errors and target metadata, and all six prompts render', { timeout: 180_000 }, async t => {
  const f = await setup(t);
  const agent = (await f.createAgent()).agent;
  const session = await f.controller.get(agent, AbortSignal.timeout(120_000));
  const input = { path: 23 };
  const expected = await session.invoke('inspect_pe_resources', input);
  const invalid = await f.native(agent, 'inspect_pe_resources', input);
  assert.equal(invalid.isError, true);
  assert.equal(invalid.value, undefined, 'upstream failure cannot become a successful DSH value');
  assert.equal(invalid.error.info.code, 'invalid_request');
  assert.deepEqual(invalid.meta.rea, expected);
  assert.deepEqual(JSON.parse(invalid.content[0].text), expected);
  assert.deepEqual(invalid.meta.rea._meta, targetMeta);
  assert.deepEqual(invalid.meta.provenance, expected._meta.provenance);
  assert.equal(f.store.snapshot().evidence.length, 0);
  const manifest = await f.call(agent, 'redteam_rea_native_manifest', {});
  for (const prompt of manifest.value.prompts) {
    const args = Object.fromEntries(Object.entries(prompt.arguments).filter(([, contract]) => contract.required).map(([name]) => [name, `requested-${name}`]));
    const rendered = await f.call(agent, 'redteam_rea_native_prompt', { name: prompt.name, arguments: args });
    assert.equal(rendered.isError, false, JSON.stringify(rendered));
    assert.deepEqual(rendered.value, await session.getPrompt(prompt.name, args));
    assert.equal(rendered.value.messages[0].role, 'user');
    for (const value of Object.values(args)) assert.ok(rendered.value.messages[0].content.text.includes(value));
  }
  const completed = await f.call(agent, 'redteam_rea_native_prompt', { name: 'investigate_feature', action: 'complete', argument: 'provider_id', value: 'a' });
  assert.equal(completed.isError, false, JSON.stringify(completed));
  assert.deepEqual(completed.value.completion.values, ['auto']);
  const invalidPrompt = await f.call(agent, 'redteam_rea_native_prompt', { name: 'investigate_feature', arguments: { feature: 7 } });
  assert.equal(invalidPrompt.isError, true);
  assert.equal(invalidPrompt.error.info.code, 'INVALID_ARGS');
  assert.deepEqual((await f.bundle(agent)).records, [], 'prompts and failures do not invent analysis Evidence');
});

test('native close resets only its Agent; real Agent disposal releases its session and awaits cleanup', { timeout: 180_000 }, async t => {
  const f = await setup(t);
  const leftHandle = await f.createAgent();
  const rightHandle = await f.createAgent();
  await inspectPe(f, leftHandle.agent);
  await inspectPe(f, rightHandle.agent);
  const leftSession = await f.controller.get(leftHandle.agent, AbortSignal.timeout(120_000));
  const closed = await f.call(leftHandle.agent, 'redteam_rea_native_close', {});
  assert.equal(closed.isError, false, JSON.stringify(closed));
  assert.deepEqual(closed.value, { closed: true, agentId: leftHandle.agent.id });
  await assert.rejects(leftSession.invoke('get_evidence_bundle'), /closed/);
  assert.deepEqual((await f.bundle(leftHandle.agent)).records, []);
  assert.equal((await f.bundle(rightHandle.agent)).records.length, 1);
  const rightSession = await f.controller.get(rightHandle.agent, AbortSignal.timeout(120_000));
  const originalClose = rightSession.close.bind(rightSession);
  const resourceClosed = Promise.withResolvers();
  const release = Promise.withResolvers();
  // Gate only the asynchronous release boundary; the real native close runs first.
  rightSession.close = async () => { await originalClose(); resourceClosed.resolve(); await release.promise; };
  let disposed = false;
  const disposing = rightHandle.dispose().then(() => { disposed = true; });
  try {
    await resourceClosed.promise;
    assert.equal(disposed, false, 'AgentHandle.dispose must await the registered async cleanup');
    await assert.rejects(rightSession.invoke('get_evidence_bundle'), /closed/);
  } finally { release.resolve(); }
  await disposing;
  assert.equal(disposed, true);
  assert.equal(f.app.get('agents').get(rightHandle.agent.id), undefined);
  assert.deepEqual((await f.bundle(leftHandle.agent)).records, []);
});

test('DSH cancellation reaches the native request and prevents success persistence', { timeout: 180_000 }, async t => {
  const f = await setup(t);
  const agent = (await f.createAgent()).agent;
  const session = await f.controller.get(agent, AbortSignal.timeout(120_000));
  const invoke = session.invoke.bind(session);
  const entered = Promise.withResolvers();
  const release = Promise.withResolvers();
  const abort = new AbortController();
  let nativeSignal;
  // Hold the dispatch boundary deterministically, then call the actual native handler.
  session.invoke = async (operation, input, request) => {
    nativeSignal = request.signal;
    entered.resolve();
    await release.promise;
    return invoke(operation, input, request);
  };
  const active = f.native(agent, 'get_evidence_bundle', undefined, abort.signal);
  try {
    await entered.promise;
    assert.equal(nativeSignal.aborted, false);
    abort.abort(new Error('integration fixture cancelled'));
    assert.equal(nativeSignal.aborted, true);
  } finally { release.resolve(); }
  const cancelled = await active;
  assert.equal(cancelled.isError, true);
  assert.equal(cancelled.error.message, 'integration fixture cancelled', JSON.stringify(cancelled));
  assert.equal(cancelled.value, undefined);
  assert.equal(f.store.snapshot().evidence.length, 0, 'cancelled call must not create a success row');
  session.invoke = invoke;
  assert.deepEqual((await f.bundle(agent)).records, []);
  const preCancelled = new AbortController(); preCancelled.abort();
  const before = f.store.snapshot().evidence.length;
  const rejected = await f.native(agent, 'get_evidence_bundle', undefined, preCancelled.signal);
  assert.equal(rejected.isError, true);
  assert.equal(rejected.error.info.name, 'AbortError');
  assert.equal(f.store.snapshot().evidence.length, before);
});

test('DSH exposes 153 CLI workflow contracts and shares real ZIP Evidence with native tools', { timeout: 180_000 }, async t => {
  const f = await setup(t);
  const left = (await f.createAgent()).agent;
  const right = (await f.createAgent()).agent;
  const manifest = await f.call(left, 'redteam_rea_native_workflow_manifest', {});
  assert.equal(manifest.isError, false, JSON.stringify(manifest));
  const commands = manifest.value.commands;
  assert.equal(commands.length, 153);
  assert.equal(new Set(commands.map(command => command.name)).size, 153);
  assert.equal(commands.filter(command => command.classification === 'native-workflow').length, 150);
  assert.deepEqual(commands.filter(command => command.classification === 'external-installation-management').map(command => command.name).sort(), ['setup', 'uninstall', 'update']);
  const description = await f.call(left, 'redteam_rea_native_workflow_manifest', { command: 'inspect-artifact' });
  assert.equal(description.isError, false, JSON.stringify(description));
  assert.equal(description.value.argsSchema.type, 'object');
  assert.equal(description.value.optionsSchema.properties.integrityPolicy.default, 'fail');
  const path = join(f.dir, 'workflow.zip');
  const name = Buffer.from('note.txt');
  const data = Buffer.from('known workflow artifact');
  const local = Buffer.alloc(30);
  local.writeUInt32LE(0x04034b50); local.writeUInt16LE(20, 4);
  local.writeUInt32LE(crc32(data), 14); local.writeUInt32LE(data.length, 18); local.writeUInt32LE(data.length, 22); local.writeUInt16LE(name.length, 26);
  const central = Buffer.alloc(46);
  central.writeUInt32LE(0x02014b50); central.writeUInt16LE(20, 4); central.writeUInt16LE(20, 6);
  central.writeUInt32LE(crc32(data), 16); central.writeUInt32LE(data.length, 20); central.writeUInt32LE(data.length, 24); central.writeUInt16LE(name.length, 28);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50); end.writeUInt16LE(1, 8); end.writeUInt16LE(1, 10);
  end.writeUInt32LE(central.length + name.length, 12); end.writeUInt32LE(local.length + name.length + data.length, 16);
  await writeFile(path, Buffer.concat([local, name, data, central, name, end]));
  const workflow = (command, args, options) => f.call(left, 'redteam_rea_native_workflow', {
    task_id: f.task.id, command, args, ...(options === undefined ? {} : { options }),
  });
  const inspected = await workflow('inspect-artifact', { path });
  assert.equal(inspected.isError, false, JSON.stringify(inspected));
  assert.equal(inspected.value.workflowResult.isError, false);
  assert.deepEqual(inspected.value.result, inspected.value.workflowResult.value);
  assert.deepEqual(inspected.meta.provenance, inspected.value._meta.provenance);
  assert.deepEqual(inspected.meta.provenance, targetMeta.provenance);
  const retained = await f.bundle(left);
  assert.ok(retained.records.some(record => record.evidence_id === inspected.value.result.evidence_id), 'CLI Evidence must be in the original native-tool ledger');
  assert.deepEqual((await f.bundle(right)).records, []);
  const nativeInspection = await f.success(left, 'inspect_artifact');
  const inventory = nativeInspection.result.normalized_result.substeps[0].evidence.normalized_result;
  assert.ok(inventory.occurrences.some(item => item.logical_path === 'note.txt'));
  assert.ok(inventory.nodes.some(item => item.sha256 === createHash('sha256').update(data).digest('hex')));
  const session = await f.controller.get(left, AbortSignal.timeout(120_000));
  const invalidInput = { args: { path }, options: { integrityPolicy: 'invalid-policy' } };
  const expected = await session.invokeCommand('inspect-artifact', invalidInput);
  const before = f.store.snapshot().evidence.length;
  const invalid = await workflow('inspect-artifact', invalidInput.args, invalidInput.options);
  assert.equal(invalid.isError, true);
  assert.equal(invalid.value, undefined);
  assert.equal(invalid.error.info.code, 'invalid_request');
  assert.deepEqual(invalid.meta.reaCli, expected);
  assert.deepEqual(invalid.meta.provenance, targetMeta.provenance);
  assert.deepEqual(JSON.parse(invalid.content[0].text), expected);
  assert.equal(f.store.snapshot().evidence.length, before);
});

