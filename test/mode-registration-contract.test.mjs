import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { randomUUID } from 'node:crypto';
import yaml from 'js-yaml';
import { Context } from '@deepseek-ai/cordis';
import Loader from '@deepseek-ai/cordis-plugin-loader';
import AgentPresets from '@deepseek-ai/dsh-agent-preset-registry';
import { SessionStore, SessionId } from '@deepseek-ai/dsh-session';
import Agents from '@deepseek-ai/dsh-agent';
import SessionProjections from '@deepseek-ai/dsh-session-projection';
import SystemPrompt from '@deepseek-ai/dsh-system-prompt';
import Tools from '@deepseek-ai/dsh-tools';
import LlmRuntime from '@deepseek-ai/dsh-llm';
import AgentLoop from '@deepseek-ai/dsh-agent-loop';

// The packaged-host verifier covers the full installed composition. This test
// isolates the mode contract with a real loaded tool plugin, actual preset
// registry, Agent scopes, session projection and selection event persistence.
// Other preset toolsets are empty because this test checks selection, not their
// implementation. No registry, Loader, Agent or tool runtime is mocked.
test('redteam declaration participates in the native preset roster and blank-session selection', async t => {
  const schema = yaml.DEFAULT_SCHEMA.extend([new yaml.Type('tag:yaml.org,2002:js', { kind: 'scalar', construct: expression => ({ __jsExpr: expression }) })]);
  const patch = yaml.load(await readFile(new URL('../cordis.patch.yml', import.meta.url), 'utf8'), { schema });
  const row = patch.flatMap(operation => operation.insert ?? []).find(entry => entry.config?.id === 'redteam');
  assert.equal(row.name, '@deepseek-ai/dsh-agent-preset');
  const flatten = entries => entries.flatMap(entry => [entry, ...(Array.isArray(entry.config) ? flatten(entry.config) : [])]);
  assert.equal(flatten(row.config.plugins).some(entry => entry.id === 'redteam-agent'), true);

  const dir = await mkdtemp(join(tmpdir(), 'redteam-mode-contract-'));
  const toolPath = join(dir, 'mode-tool.mjs');
  await writeFile(toolPath, `export const inject=['tools'];
export function apply(ctx){ctx.effect(()=>ctx.tools.register({name:'mode_registration_probe',description:'Preset scoped fixture',parameters:{type:'object',properties:{}},output:{schema:{type:'object',properties:{mode:{type:'string'}},required:['mode']},render:(_args,value)=>[{type:'text',text:JSON.stringify(value)}]},execute:()=>({mode:'redteam'})}));}`);
  const app = new Context(), fibers = [], unregister = [];
  let handle;
  t.after(async () => {
    await handle?.dispose();
    for (const dispose of unregister.reverse()) await dispose();
    for (const fiber of fibers.reverse()) await fiber.dispose();
    await rm(dir, { recursive: true, force: true });
  });
  for (const [plugin, config] of [[SessionStore], [Agents], [SessionProjections], [SystemPrompt, {}], [Tools, { mode: 'native' }], [LlmRuntime], [AgentLoop, {}], [Loader, { baseUrl: new URL('../', import.meta.url).href }], [AgentPresets, { default: 'standard' }]]) fibers.push(await app.plugin(plugin, config));
  const registry = app.get('agentPresets');
  for (const [id, order] of [['standard', 1], ['ptc', 2], ['minimal', 3], ['cordis', 4]]) unregister.push(await registry.register({ id, order, plugins: [] }));
  unregister.push(await registry.register({ ...row.config, plugins: [{ id: 'mode-probe', name: pathToFileURL(toolPath).href }] }));
  const roster = await registry.remoteExportList();
  assert.deepEqual(roster.presets.map(item => item.id), ['standard', 'ptc', 'minimal', 'redteam', 'cordis']);
  assert.equal(roster.presets.some(item => item.broken !== undefined), false, JSON.stringify(roster));
  assert.equal(roster.presets.find(item => item.id === 'redteam').isDefault, false);

  handle = await app.get('agents').create({ sessionId: SessionId(randomUUID()), meta: { agentPreset: 'standard' }, setup: async ctx => { await registry.mount(ctx, 'standard'); } });
  const agent = handle.agent;
  assert.equal(app.get('tools').get('mode_registration_probe', agent), undefined);
  await registry.select(agent, 'redteam');
  assert.equal(registry.composedPreset(agent.ctx), 'redteam');
  assert.equal(app.get('sessionProjections').stateOf(agent.session, 'agentPreset'), 'redteam');
  const result = await app.get('tools').execute({ callId: randomUUID(), name: 'mode_registration_probe', arguments: {}, agent, signal: AbortSignal.timeout(5000) });
  assert.equal(result.isError, false);
  assert.deepEqual(result.value, { mode: 'redteam' });
  await registry.select(agent, 'ptc');
  assert.equal(registry.composedPreset(agent.ctx), 'ptc');
  assert.equal(app.get('tools').get('mode_registration_probe', agent), undefined);
  await registry.select(agent, 'redteam');
  agent.session.append('turn/start', { turn: 1 });
  await assert.rejects(registry.select(agent, 'minimal'), /already started/);
  assert.equal(registry.composedPreset(agent.ctx), 'redteam');
});
