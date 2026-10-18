import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { Context } from '@deepseek-ai/cordis';
import ToolRuntime, { defineTool } from '@deepseek-ai/dsh-tools';
import SystemPrompt from '@deepseek-ai/dsh-system-prompt';
import { AgentsRuntime } from '../lib/platform/agents.js';

async function fixture(t, options = {}) {
  const root = await mkdtemp(join(tmpdir(), 'platform-agents-'));
  const runtime = new AgentsRuntime({ root, ...options }); await runtime.load();
  t.after(() => rm(root, { recursive: true, force: true })); return { root, runtime };
}
const definition = (name = 'lookup') => ({ name, description: 'Original description', parameters: { type: 'object', properties: { count: { type: 'integer', default: 3 }, text: { type: 'string', default: 'original' }, active: { type: 'boolean', default: true } }, required: [] }, output: { schema: {}, render: value => value }, execute: async args => args, isConcurrencySafe: () => true });

test('builtin roles are protected and custom edits/config survive restart without resetting unrelated fields', async t => {
  const { runtime, root } = await fixture(t, { profileExists: id => id === 'primary' });
  assert.deepEqual(runtime.list().map(a => a.key), ['goals', 'planner', 'mainagent', 'worker', 'auto', 'pentest']);
  await assert.rejects(runtime.delete('worker'), /Builtin/);
  await assert.rejects(runtime.update('worker', { name: 'changed' }), /protected/);
  await runtime.create({ key: 'reviewer', name: 'Reviewer' });
  await runtime.update('reviewer', { maxTurns: 8, runSeconds: 90, llmProfileId: 'primary', interactiveShell: true });
  await runtime.update('reviewer', { triggerMergeMode: 'none', triggerRunMode: 'parallel' });
  await assert.rejects(runtime.update('reviewer', { maxTurns: 20, llmProfileId: 'missing' }), /profile/);
  assert.equal(runtime.get('reviewer').maxTurns, 8);
  assert.equal(runtime.resolve('reviewer').config.runSeconds, 90);
  const restarted = new AgentsRuntime({ root }); await restarted.load();
  assert.equal(restarted.get('reviewer').llmProfileId, 'primary');
  assert.equal(restarted.get('reviewer').triggerMergeMode, 'none');
  await restarted.update('reviewer', { llmProfileId: null });
  assert.equal(restarted.get('reviewer').maxTurns, 8);
  await restarted.update('reviewer', { enabled: false });
  assert.throws(() => restarted.resolve('reviewer'), /disabled/);
});

test('prompt save/activation/reset affects subsequent resolves and preserves old snapshots', async t => {
  const { runtime, root } = await fixture(t);
  const initial = runtime.resolve('planner', { Goal: 'first goal' });
  assert.match(initial.systemPrompt, /first goal/);
  const draft = await runtime.savePrompt('planner', { template: 'Target={{.Goal}} {{if .AssetSummary}}Assets={{.AssetSummary}}{{else}}No assets{{end}} at {{.Now}}', activate: false });
  assert.equal(runtime.resolve('planner', { Goal: 'first goal' }).systemPrompt, initial.systemPrompt);
  await runtime.activatePrompt('planner', draft.version);
  assert.equal(runtime.resolve('planner', { Goal: 'new goal', AssetSummary: '', Now: 'clock' }).systemPrompt, 'Target=new goal No assets at clock');
  assert.equal(runtime.resolve('planner', { Goal: 'new goal', AssetSummary: '3 hosts', Now: 'clock' }).systemPrompt, 'Target=new goal Assets=3 hosts at clock');
  assert.match(initial.systemPrompt, /first goal/);
  assert.throws(() => runtime.resolve('planner', { Goal: 'missing assets' }), /Missing prompt variable/);
  await assert.rejects(runtime.savePrompt('planner', { template: '{{.Unknown}}' }), /Unknown/);
  await assert.rejects(runtime.savePrompt('planner', { template: '{{if .Goal}}broken' }), /Unclosed/);
  assert.match(runtime.preview('planner', 'preview {{.Goal}}', { Goal: 'sample' }), /preview sample/);
  const restarted = new AgentsRuntime({ root }); await restarted.load();
  assert.equal(restarted.get('planner').currentPromptVersion, draft.version);
  await restarted.resetPrompt('planner');
  assert.match(restarted.resolve('planner', { Goal: 'reset goal' }).systemPrompt, /reset goal/);
  assert.equal(restarted.versions('planner').length, 3);
});

test('concurrent prompt writes allocate unique versions and atomic file contains all versions', async t => {
  const { runtime, root } = await fixture(t);
  await runtime.create({ key: 'custom', name: 'Custom' });
  const saved = await Promise.all(Array.from({ length: 12 }, (_, i) => runtime.savePrompt('custom', { template: `Prompt ${i}` })));
  assert.deepEqual(saved.map(p => p.version), Array.from({ length: 12 }, (_, i) => i + 2));
  const state = JSON.parse(await readFile(join(root, 'agents.json'), 'utf8'));
  assert.equal(state.agents.find(a => a.config.key === 'custom').prompts.length, 13);
  assert.equal(runtime.resolve('custom').systemPrompt, 'Prompt 11');
});

test('ordinary and task-timeout settlement prompts and budgets are independent', async t => {
  const { runtime } = await fixture(t);
  const before = runtime.resolve('worker');
  assert.notEqual(before.wrapup.prompt, before.taskTimeoutWrapup.prompt);
  await runtime.saveWrapup('worker', { prompt: 'save your results', maxTurns: 4 });
  await runtime.saveWrapup('worker', { prompt: 'task ended', maxTurns: 2 }, 'task_timeout');
  await runtime.saveWrapup('worker', { prompt: 'run ended' });
  const after = runtime.resolve('worker');
  assert.deepEqual(after.wrapup, { prompt: 'run ended', maxTurns: 4 });
  assert.deepEqual(after.taskTimeoutWrapup, { prompt: 'task ended', maxTurns: 2 });
  await runtime.resetWrapup('worker');
  assert.deepEqual(runtime.resolve('worker').wrapup, before.wrapup);
  assert.equal(runtime.resolve('worker').taskTimeoutWrapup.prompt, 'task ended');
});

test('tool edit changes visible schema and real handler defaults; reset restores binding and handler metadata', async t => {
  const { runtime, root } = await fixture(t); const original = definition();
  await runtime.seedTools([original], ['worker']);
  assert.equal(runtime.resolve('auto').tools.length, 0);
  const old = runtime.resolve('worker').tools[0];
  const schema = structuredClone(original.parameters); schema.properties.count.default = 7; schema.properties.text.description = 'Edited help';
  await runtime.updateTool('lookup', { description: 'Edited', schema, agents: ['worker', 'auto'] });
  const actual = runtime.resolve('auto').tools[0];
  assert.equal(actual.description, 'Edited'); assert.equal(actual.parameters.properties.count.default, 7);
  assert.deepEqual(await actual.execute({ text: '', active: false, count: null }, {}), { text: 'original', active: false, count: 7 });
  assert.deepEqual(await actual.execute({ count: 0, text: 'provided' }, {}), { count: 0, text: 'provided', active: true });
  assert.equal((await old.execute({}, {})).count, 3);
  assert.equal(actual.isConcurrencySafe({}), true); assert.equal(actual.output.schema, original.output.schema);
  const invalid = structuredClone(schema); invalid.properties.count.type = 'string';
  await assert.rejects(runtime.updateTool('lookup', { schema: invalid }), /structure/);
  const restarted = new AgentsRuntime({ root }); await restarted.load(); await restarted.seedTools([original], ['worker']);
  assert.equal(restarted.resolve('auto').tools[0].description, 'Edited');
  await restarted.resetTool('lookup'); assert.equal(restarted.resolve('auto').tools.length, 0);
  assert.equal((await restarted.resolve('worker').tools[0].execute({}, {})).count, 3);
  await restarted.updateTool('lookup', { enabled: false }); assert.equal(restarted.resolve('worker').tools.length, 0);
});

test('resource visibility distinguishes missing and explicit deny; copy/delete preserve referential integrity', async t => {
  const { runtime } = await fixture(t);
  await runtime.create({ key: 'source', name: 'Source' });
  assert.equal(runtime.isVisible('source', 'mcp', 'server', true), true);
  await runtime.setVisibility('source', { mcp: { server: false }, skill: { research: true } });
  assert.equal(runtime.isVisible('source', 'mcp', 'server', true), false);
  await runtime.seedTools([definition()], ['source']);
  await runtime.copy('source', { key: 'copy', name: 'Copy' });
  assert.equal(runtime.isVisible('copy', 'skill', 'research'), true);
  assert.equal(runtime.isVisible('copy', 'mcp', 'server', true), false);
  assert.equal(runtime.resolve('copy').tools.length, 1);
  await runtime.setResourceAgents('mcp', 'server', { copy: true });
  assert.deepEqual(runtime.resourceAgents('mcp', 'server').find(a => a.agentKey === 'copy'), { agentKey: 'copy', enabled: true, explicit: true });
  await runtime.delete('source'); assert.deepEqual(runtime.listTools()[0].agents, ['copy']);
  await runtime.removeResource('skill', 'research'); assert.equal(runtime.isVisible('copy', 'skill', 'research'), false);
});

test('per-task tool instances take precedence and unknown host tools pass through', async t => {
  const { runtime } = await fixture(t); const shared = definition();
  await runtime.seedTools([shared], ['worker']);
  const taskLocal = { ...shared, execute: async args => ({ ...args, owner: 'task' }) };
  const host = definition('external');
  const result = runtime.resolve('worker', {}, [taskLocal, host]);
  assert.equal(result.tools.length, 2); assert.equal((await result.tools[0].execute({}, {})).owner, 'task'); assert.equal(result.tools[1], host);
  assert.equal(runtime.resolve('worker', {}, [host], { injectCatalog: false }).tools.length, 1);
});

test('DSH registry accepts configured defaults before required argument validation and preserves typed handler rejection', async t => {
  const { runtime } = await fixture(t);
  const bodies = [];
  const tool = defineTool({ name: 'default_fixture', description: 'Local defaults fixture', parameters: { count: { type: 'integer', required: true }, text: { type: 'string', required: true } }, output: { schema: { type: 'json' }, render: (args, value) => [{ type: 'text', text: `${args.count}:${JSON.stringify(value)}` }] }, execute: async args => { bodies.push(args); return args; } });
  await runtime.seedTools([tool], ['worker']);
  const schema = structuredClone(tool.parameters); schema.properties.count.default = 7; schema.properties.text.default = 'configured';
  await runtime.updateTool(tool.name, { schema });
  const app = new Context(), prompt = await app.plugin(SystemPrompt, {}), tools = await app.plugin(ToolRuntime, { mode: 'native' });
  const plugin = await app.plugin({ inject: ['tools'], apply: ctx => { for (const definition of runtime.resolve('worker').tools) ctx.effect(() => ctx.tools.register(definition)); } });
  t.after(async () => { await plugin.dispose(); await tools.dispose(); await prompt.dispose(); });
  const call = arguments_ => app.get('tools').execute({ callId: randomUUID(), name: tool.name, arguments: arguments_, signal: AbortSignal.timeout(3000) });
  for (const input of [{}, { count: null, text: '' }]) { const result = await call(input); assert.equal(result.isError, false, JSON.stringify(result)); assert.deepEqual(result.value, { count: 7, text: 'configured' }); assert.match(result.content[0].text, /^7:/); }
  const explicit = await call({ count: 0, text: 'provided' }); assert.equal(explicit.isError, false); assert.deepEqual(explicit.value, { count: 0, text: 'provided' });
  assert.equal((await call({ count: 'wrong type', text: 'provided' })).isError, true);
  assert.equal(bodies.length, 3);
});

test('copying a builtin keeps its prompt variable catalog and schema property names cannot be erased', async t => {
  const { runtime } = await fixture(t);
  await runtime.copy('planner', { key: 'copy_planner', name: 'Copy planner' });
  assert.match(runtime.resolve('copy_planner', { Goal: 'copied goal' }).systemPrompt, /copied goal/);
  const tool = definition(); tool.parameters.properties.description = { type: 'string' };
  await runtime.seedTools([tool], ['worker']);
  const bad = structuredClone(tool.parameters); delete bad.properties.description;
  await assert.rejects(runtime.updateTool(tool.name, { schema: bad }), /structure/);
});

test('multiple runtime instances sharing a directory serialize writes and immediately share committed state', async t => {
  const { runtime, root } = await fixture(t), peer = new AgentsRuntime({ root }); await peer.load();
  await Promise.all([runtime.create({ key: 'first', name: 'First' }), peer.create({ key: 'second', name: 'Second' })]);
  assert.equal(peer.get('first').name, 'First'); assert.equal(runtime.get('second').name, 'Second');
  const writes = await Promise.all(Array.from({ length: 12 }, (_, index) => (index % 2 ? runtime : peer).savePrompt('first', { template: `version ${index}` })));
  assert.deepEqual(writes.map(p => p.version), Array.from({ length: 12 }, (_, i) => i + 2));
  await Promise.all([runtime.update('first', { runSeconds: 20 }), peer.update('first', { maxTurns: 9 })]);
  assert.equal(runtime.get('first').maxTurns, 9); assert.equal(peer.get('first').runSeconds, 20);
  assert.equal(JSON.parse(await readFile(join(root, 'agents.json'), 'utf8')).agents.find(a => a.config.key === 'first').prompts.length, 13);
});

test('Go-template pipes, parenthesized functions, variables, range assignment and named templates render independently', async t => {
  const { runtime } = await fixture(t);
  const template = '{{define "line"}}[{{.}}]{{end}}{{$goal := .Goal | printf "%s!"}}{{$last := "none"}}{{range $i, $entry := .AssetSummary}}{{$last = $entry}}{{if eq $i 0}}{{continue}}{{end}}{{template "line" $entry}}{{end}}{{$goal}} last={{$last}} {{if and (ne .Goal "") (eq (len .Goal) 4)}}YES{{else if eq .Goal ""}}EMPTY{{else}}NO{{end}}';
  await runtime.savePrompt('planner', { template });
  assert.equal(runtime.resolve('planner', { Goal: 'goal', AssetSummary: ['first', 'second', 'third'] }).systemPrompt, '[second][third]goal! last=third YES');
  assert.equal(runtime.resolve('planner', { Goal: '', AssetSummary: [] }).systemPrompt, '! last=none EMPTY');
  const ordered = '{{range $key, $value := .AssetSummary}}{{$key}}={{$value}};{{else}}empty{{end}}';
  assert.equal(runtime.preview('planner', ordered, { AssetSummary: { z: 'last', a: 'first' } }), 'a=first;z=last;');
  assert.equal(runtime.preview('planner', '{{.Goal | printf "%q" | printf "value=%s"}}', { Goal: 'quoted' }), 'value="quoted"');
  assert.equal(runtime.preview('planner', ' A {{- /* trim */ -}} B {{printf "}}"}}'), ' AB }}');
  assert.equal(runtime.preview('planner', '{{block "default" .Goal}}Goal={{.}}{{end}}', { Goal: 'one' }), 'Goal=one');
  await assert.rejects(runtime.savePrompt('planner', { template: '{{$missing = .Goal}}' }), /undefined/i);
  await assert.rejects(runtime.savePrompt('planner', { template: '{{.Unknown | printf "%s"}}' }), /Unknown prompt variable/);
  await assert.rejects(runtime.savePrompt('planner', { template: '{{printf "%s" (.Unknown)}}' }), /Unknown prompt variable/);
  await assert.rejects(runtime.savePrompt('planner', { template: '{{if .Goal}}{{$x := "local"}}{{end}}{{$x}}' }), /Undefined template variable/);
});

test('Go-template range variable arity, scope, short-circuit, with and break follow observable contracts', async t => {
  const { runtime } = await fixture(t);
  assert.equal(runtime.preview('planner', '{{range $item := .AssetSummary}}{{$item}}{{if eq $item "b"}}{{break}}{{end}}{{end}}', { AssetSummary: ['a', 'b', 'c'] }), 'ab');
  assert.equal(runtime.preview('planner', '{{$x := "outer"}}{{with $v := .AssetSummary}}{{$x := "inner"}}{{$v.label}} {{$x}} {{$.Goal}}{{end}} {{$x}}', { Goal: 'root', AssetSummary: { label: 'inside' } }), 'inside inner root outer');
  assert.equal(runtime.preview('planner', '{{or true (index .Goal 999)}} {{and false (index .Goal 999)}}', { Goal: 'x' }), 'true false');
  assert.equal(runtime.preview('planner', '{{range $i := 3}}{{$i}}{{end}} {{printf "%04d %.2f" 7 1.25}}', {}), '012 0007 1.25');
  assert.throws(() => runtime.preview('planner', '{{define "isolated"}}{{$x}}{{end}}'), /Undefined template variable/);
});
