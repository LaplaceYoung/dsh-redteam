import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { build } from 'esbuild';
import { Context } from '@deepseek-ai/cordis';
import { SessionId, SessionStore } from '@deepseek-ai/dsh-session';
import AgentRegistry from '@deepseek-ai/dsh-agent';
import AgentLoop from '@deepseek-ai/dsh-agent-loop';
import LlmRuntime, { LlmAdapter, createUserMessage } from '@deepseek-ai/dsh-llm';
import SystemPrompt from '@deepseek-ai/dsh-system-prompt';
import ToolRuntime, { defineTool } from '@deepseek-ai/dsh-tools';
import SessionProjections from '@deepseek-ai/dsh-session-projection';

// Compile the current platform sources in memory, independent of concurrent
// builds. Keep createRequire rooted at this real file rather than the data URL.
const bundled = await build({ stdin: { contents: "export { installPlatform } from './src/platform/index.ts'; export { RedTeamStore } from './src/store.ts';", resolveDir: process.cwd(), loader: 'ts' }, bundle: true, write: false, platform: 'node', format: 'esm', packages: 'external' });
const code = bundled.outputFiles[0].text.replaceAll('import.meta.url', JSON.stringify(import.meta.url)).replace(/from\s+(["'])([^"']+)\1/g, (_match, _quote, specifier) => `from ${JSON.stringify(import.meta.resolve(specifier))}`);
const { installPlatform, RedTeamStore } = await import(`data:text/javascript;base64,${Buffer.from(`${code}\n//# sourceURL=platform-integration-tests.bundle.mjs`).toString('base64')}`);

class ScriptedAdapter extends LlmAdapter {
  requests = [];
  responses = [];
  async resolveModel(provider, model) { return { provider, id: model, name: model }; }
  async *stream(request) {
    this.requests.push(request);
    assert.ok(this.responses.length, 'unexpected external model call');
    const response = this.responses.shift();
    if (response === 'done') {
      yield { type: 'text-delta', index: 0, text: 'Fixture completed' };
      yield { type: 'finish', reason: { kind: 'stop' } }; return;
    }
    for (const [index, call] of response.entries()) yield { type: 'tool-call-delta', index, id: randomUUID(), name: call.name, argumentsDelta: JSON.stringify(call.args) };
    yield { type: 'finish', reason: { kind: 'tool-calls' } };
  }
}
const calls = (name, args = {}) => [{ name, args }];
const requestNames = request => request.tools.map(t => t.name);
const requestSystem = request => request.messages.filter(m => m.role === 'system').map(m => typeof m.content === 'string' ? m.content : m.content.map(c => c.text ?? '').join('\n')).join('\n');
const resultText = result => result.content.filter(c => c.type === 'text').map(c => c.text).join('\n');

async function fixture(t, options = {}) {
  const root = await mkdtemp(join(tmpdir(), 'platform-integration-'));
  const store = new RedTeamStore(join(root, 'state.json'));
  const task = await store.createTask('Platform local fixture', 'VERIFY_LOCAL_PLATFORM_GOAL');
  const app = new Context(), fibers = [], adapter = new ScriptedAdapter(), performed = [];
  const ready = Promise.withResolvers();
  let installed, handle;
  t.after(async () => {
    await installed?.dispose(); await handle?.dispose();
    for (const fiber of fibers.reverse()) await fiber.dispose();
    await rm(root, { recursive: true, force: true });
  });
  const mount = async (plugin, config) => { fibers.push(await app.plugin(plugin, config)); };
  await mount(SessionStore); await mount(AgentRegistry); await mount(LlmRuntime);
  await mount(SystemPrompt, {}); await mount(ToolRuntime, { mode: 'native' });
  await mount(SessionProjections); await mount(AgentLoop, {});
  await mount(ctx => { ctx.inject(['llm', 'tools'], inner => {
    inner.llm.registerAdapter(['platform-fixture'], adapter);
    inner.tools.register(defineTool({ name: 'fixture_echo', description: 'Execute a harmless local fixture', parameters: { word: { type: 'string', required: true } },
      output: { schema: { type: 'json' }, render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }] },
      execute: args => { performed.push(args.word); return { echo: args.word }; },
    }));
  }); });
  handle = await app.get('agents').create({ sessionId: SessionId(randomUUID()), meta: { cwd: root }, agentOptions: { provider: 'platform-fixture', model: 'fixture-model' },
    setup: async ctx => { await ctx.plugin(inner => { inner.inject(['tools', 'systemPrompt', 'agents'], async scope => {
      try { installed = await installPlatform(scope, store, { schedulerIntervalMs: 0, ...options }); ready.resolve(); }
      catch (error) { ready.reject(error); }
    }); }); },
  });
  await ready.promise;
  assert.ok(installed, 'scoped Cordis installation must finish before management calls');
  const agent = handle.agent;
  const call = (name, action, payload = {}) => app.get('tools').execute({ callId: randomUUID(), name: `redteam_platform_${name}`, arguments: { action, payload }, agent, signal: AbortSignal.timeout(15000) });
  const ok = async (name, action, payload) => { const result = await call(name, action, payload); assert.equal(result.isError, false, resultText(result).slice(0, 3000)); return result.value; };
  const run = (key = 'mainagent', payload = {}) => ok('agents', 'run', { key, taskId: task.id, message: 'Run only the local fixture', ...payload });
  return { root, store, task, app, adapter, installed, agent, call, ok, run, performed };
}

test('scoped native management tools change the actual next-run prompt and version activation', { timeout: 25000 }, async t => {
  const f = await fixture(t);
  assert.equal(f.app.get('tools').get('redteam_platform_agents'), undefined, 'management must really be scoped to the owner Agent');
  assert.ok(f.app.get('tools').get('redteam_platform_agents', f.agent));
  const first = await f.ok('prompts', 'save', { key: 'mainagent', template: 'VERSION_A goal={{.Goal}}' });
  f.adapter.responses.push('done'); await f.run();
  assert.match(requestSystem(f.adapter.requests[0]), /VERSION_A goal=VERIFY_LOCAL_PLATFORM_GOAL/);
  const second = await f.ok('prompts', 'save', { key: 'mainagent', template: 'VERSION_B {{.Goal}}', activate: false });
  f.adapter.responses.push('done'); await f.run(); assert.match(requestSystem(f.adapter.requests[1]), /VERSION_A/);
  await f.ok('prompts', 'activate', { key: 'mainagent', version: second.version });
  f.adapter.responses.push('done'); await f.run(); assert.match(requestSystem(f.adapter.requests[2]), /VERSION_B VERIFY_LOCAL_PLATFORM_GOAL/);
  await f.ok('prompts', 'activate', { key: 'mainagent', version: first.version });
  f.adapter.responses.push('done'); await f.run(); assert.match(requestSystem(f.adapter.requests[3]), /VERSION_A/);
  assert.ok(f.adapter.requests.every(r => r.provider === 'platform-fixture' && r.model === 'fixture-model'));
});

test('tool binding and schema/description overrides affect real next-run tool execution', { timeout: 25000 }, async t => {
  const f = await fixture(t);
  const initialTools = await f.ok('tools', 'list');
  assert.ok(initialTools.some(tool => tool.key === 'fixture_echo'), 'first management list discovers global host tools before any run');
  assert.ok(initialTools.some(tool => tool.key === 'redteam_platform_agents'), 'first management list also discovers the caller scope local management tools');
  await f.ok('tools', 'update', { key: 'fixture_echo', patch: { description: 'Configured before first run' } });
  assert.equal(f.adapter.requests.length, 0, 'listing and configuring tools must not require an initialization model run');
  f.adapter.responses.push(calls('fixture_echo', { word: 'first' }), 'done'); await f.run();
  assert.ok(requestNames(f.adapter.requests[0]).includes('fixture_echo')); assert.deepEqual(f.performed, ['first']);
  assert.equal(f.adapter.requests[0].tools.find(tool => tool.name === 'fixture_echo').description, 'Configured before first run');
  const schema = structuredClone((await f.ok('tools', 'list')).find(tool => tool.key === 'fixture_echo').schema);
  schema.properties.word.default = 'configured-default';
  await f.ok('tools', 'update', { key: 'fixture_echo', patch: { description: 'Changed description', schema } });
  f.adapter.responses.push(calls('fixture_echo'), 'done'); await f.run();
  assert.equal(f.adapter.requests[2].tools.find(t => t.name === 'fixture_echo').description, 'Changed description');
  assert.deepEqual(f.performed, ['first', 'configured-default']);
  await f.ok('tools', 'update', { key: 'fixture_echo', patch: { agents: ['worker'] } });
  f.adapter.responses.push(calls('fixture_echo', { word: 'must-not-execute' }), 'done'); await f.run();
  assert.equal(requestNames(f.adapter.requests[4]).includes('fixture_echo'), false);
  assert.deepEqual(f.performed, ['first', 'configured-default'], 'hallucinating a hidden tool must not bypass the binding');
  await f.ok('tools', 'reset', { key: 'fixture_echo' });
  f.adapter.responses.push('done'); await f.run(); assert.ok(requestNames(f.adapter.requests[6]).includes('fixture_echo'));
});

test('maxTurns and wrapup change real model steps and reject budget exhaustion', { timeout: 25000 }, async t => {
  const f = await fixture(t);
  await f.ok('agents', 'update', { key: 'mainagent', patch: { maxTurns: 1 } });
  await f.ok('prompts', 'save_wrapup', { key: 'mainagent', prompt: 'WRAPUP_SAVE_VERIFIED_RESULT', maxTurns: 1 });
  f.adapter.responses.push(calls('fixture_echo', { word: 'regular-step' }), 'done'); await f.run();
  assert.equal(f.adapter.requests.length, 2);
  assert.doesNotMatch(requestSystem(f.adapter.requests[0]), /WRAPUP_SAVE_VERIFIED_RESULT/);
  assert.match(requestSystem(f.adapter.requests[1]), /WRAPUP_SAVE_VERIFIED_RESULT/);
  f.adapter.responses.push(calls('fixture_echo', { word: 'regular' }), calls('fixture_echo', { word: 'wrapup' }));
  const result = await f.call('agents', 'run', { key: 'mainagent', message: 'Exercise bounded local steps', taskId: f.task.id });
  assert.equal(result.isError, true); assert.match(resultText(result), /budget|exhausted/i);
  assert.equal(f.adapter.requests.length, 4, 'no third request is allowed after one regular step and one wrapup step');
});

test('Skill binding changes actual new-run discovery and usage stores the real run session', { timeout: 25000 }, async t => {
  const f = await fixture(t);
  await f.ok('skills', 'create', { name: 'fixture-guide', description: 'LOCAL_SKILL_DESCRIPTION', instructions: 'LOCAL_SKILL_BODY ${SKILL_DIR}' });
  await f.ok('visibility', 'set_agent', { key: 'mainagent', bindings: { skill: { 'fixture-guide': true } } });
  f.adapter.responses.push(calls('Skill', { name: 'fixture-guide', args: 'local-context' }), 'done');
  const run = await f.run();
  assert.match(f.adapter.requests[0].tools.find(t => t.name === 'Skill').description, /LOCAL_SKILL_DESCRIPTION/);
  assert.match(JSON.stringify(f.adapter.requests[1].messages), /LOCAL_SKILL_BODY/);
  const usage = await f.ok('skills', 'usage', { name: 'fixture-guide' });
  assert.equal(usage.length, 1); assert.equal(usage[0].agentKey, 'mainagent'); assert.equal(usage[0].taskId, f.task.id); assert.equal(usage[0].sessionId, run.sessionId);
  assert.equal(usage[0].argsLen, Buffer.byteLength('local-context'));
  await f.ok('visibility', 'set_agent', { key: 'mainagent', bindings: { skill: { 'fixture-guide': false } } });
  f.adapter.responses.push(calls('Skill', { name: 'fixture-guide' }), 'done'); await f.run();
  assert.doesNotMatch(f.adapter.requests[2].tools.find(t => t.name === 'Skill').description, /LOCAL_SKILL_DESCRIPTION/);
  assert.match(JSON.stringify(f.adapter.requests[3].messages), /not visible/);
  assert.equal((await f.ok('skills', 'usage', { name: 'fixture-guide' })).length, 1);
  f.adapter.responses.push(calls('Skill', { name: 'missing-procedure' }), 'done'); await f.run();
  assert.equal((await f.ok('skills', 'missing'))[0].skill, 'missing-procedure');
});

const stdioSource = `import readline from 'node:readline';
const input=readline.createInterface({input:process.stdin});
input.on('line', line => { const r=JSON.parse(line); if(r.id===undefined)return; let result;
if(r.method==='initialize')result={protocolVersion:r.params.protocolVersion,serverInfo:{name:'local',version:'1'},capabilities:{tools:{}}};
else if(r.method==='tools/list')result={tools:[{name:'echo',description:'LOCAL_MCP_ECHO',inputSchema:{type:'object',properties:{word:{type:'string'}},required:['word']}}]};
else if(r.method==='tools/call')result={content:[{type:'text',text:'LOCAL_MCP_RESULT:'+r.params.arguments.word}]};
else result={}; process.stdout.write(JSON.stringify({jsonrpc:'2.0',id:r.id,result})+'\\n'); });`;

test('local MCP is locked until actual Skill load, relocks on next run and unlocks from history replay', { timeout: 35000 }, async t => {
  const f = await fixture(t), path = join(f.root, 'stdio-mcp-fixture.mjs'); await writeFile(path, stdioSource);
  const server = await f.ok('mcp', 'save', { server: { name: 'local', transport: 'stdio', command: process.execPath, args: [path], enabled: true } });
  assert.equal(server.tools[0].name, 'echo', 'management save must perform actual protocol discovery');
  await f.ok('skills', 'create', { name: 'mcp-guide', description: 'Unlock local fixture', instructions: 'Call local fixture', mcps: ['local'] });
  await f.ok('visibility', 'set_agent', { key: 'mainagent', bindings: { skill: { 'mcp-guide': true }, mcp: { [server.id]: true } } });
  const remote = 'mcp__local__echo';
  f.adapter.responses.push(calls('ExecuteExtraTool', { name: remote, arguments: { word: 'locked' } }), calls('Skill', { name: 'mcp-guide' }), calls('ExecuteExtraTool', { name: remote, arguments: { word: 'unlocked' } }), 'done');
  await f.run();
  assert.equal(requestNames(f.adapter.requests[0]).includes(remote), false, 'deferred tool is not exposed as an ordinary initial schema');
  assert.match(JSON.stringify(f.adapter.requests[1].messages), /Skill-locked/);
  assert.match(JSON.stringify(f.adapter.requests[3].messages), /LOCAL_MCP_RESULT:unlocked/);
  f.adapter.responses.push(calls('ExecuteExtraTool', { name: remote, arguments: { word: 'new-run' } }), 'done'); await f.run();
  assert.match(JSON.stringify(f.adapter.requests[5].messages), /Skill-locked/);
  f.adapter.responses.push(calls('ExecuteExtraTool', { name: remote, arguments: { word: 'replayed' } }), 'done');
  await f.installed.run({ agentKey: 'mainagent', parent: f.agent, taskId: f.task.id, message: 'Replay known Skill and call local fixture', historySkills: ['mcp-guide'] });
  assert.match(JSON.stringify(f.adapter.requests[7].messages), /LOCAL_MCP_RESULT:replayed/);
  assert.equal((await f.ok('skills', 'usage', { name: 'mcp-guide' })).length, 1, 'history replay restores the gate without pretending to be a new Skill invocation');
  await f.ok('visibility', 'set_agent', { key: 'planner', bindings: { skill: { 'mcp-guide': true } } });
  const intercepted = [];
  const removeGuard = f.app.get('tools').guard(exec => { intercepted.push({ name: exec.name, agent: exec.agent?.id }); });
  const prepared = await f.installed.prepareRun({ agentKey: 'planner', taskId: f.task.id, parent: f.agent, baseTools: [], historySkills: ['mcp-guide'] });
  try {
    const result = await prepared.execute('ExecuteExtraTool', { name: remote, arguments: { word: 'planner-bridge' } }, randomUUID(), AbortSignal.timeout(10000));
    assert.equal(result.isError, false, resultText(result));
    assert.match(JSON.stringify(result.value), /LOCAL_MCP_RESULT:planner-bridge/);
    assert.equal(f.adapter.requests.length, 8, 'the Planner dispatch bridge must execute through DSH without starting an extra model loop');
    assert.ok(intercepted.some(call => call.name === remote && call.agent && call.agent !== f.agent.id), 'the real host guard must observe MCP execution in an owned child scope');
  } finally { removeGuard(); await prepared.dispose(); }
});

test('management failures and disposal are visible through native execute results', { timeout: 25000 }, async t => {
  const f = await fixture(t);
  const invalid = await f.call('prompts', 'save', { key: 'worker', template: '{{.NotARealVariable}}' });
  assert.equal(invalid.isError, true); assert.match(resultText(invalid), /Unknown/);
  await f.ok('agents', 'update', { key: 'mainagent', patch: { enabled: false } });
  const disabled = await f.call('agents', 'run', { key: 'mainagent', message: 'must not call a model' });
  assert.equal(disabled.isError, true); assert.match(resultText(disabled), /disabled/); assert.equal(f.adapter.requests.length, 0);
  await f.installed.dispose(); await f.installed.dispose();
  assert.equal(f.app.get('tools').get('redteam_platform_agents', f.agent), undefined);
  assert.equal((await f.call('agents', 'list')).isError, true);
});

test('Agent profile selection preserves the selected profile identity even when routes are identical', async t => {
  const resolved = [];
  const route = { provider: 'platform-fixture', model: 'shared-model' };
  const f = await fixture(t, { profileExists: () => true, resolveProfile: async id => { resolved.push(id); return route; } });
  await f.installed.agents.update('worker', { llmProfileId: 17 });
  assert.deepEqual(await f.installed.resolveAgentProfileSelection('worker'), { profileId: '17', route });
  await f.installed.agents.update('worker', { llmProfileId: 'another-profile' });
  assert.deepEqual(await f.installed.resolveAgentProfileSelection('worker'), { profileId: 'another-profile', route });
  assert.deepEqual(await f.installed.resolveAgentProfile('worker'), route);
  assert.deepEqual(resolved, [17, 'another-profile', 'another-profile']);
  assert.equal(await f.installed.resolveAgentProfileSelection('mainagent'), null);
  assert.equal(await f.installed.resolveAgentProfileSelection('missing-role'), null);
});

test('a nested run rebuilds inherited Skill tools with its own bindings and usage session', { timeout: 25000 }, async t => {
  const f = await fixture(t);
  await f.installed.skills.create({ name: 'parent-guide', description: 'PARENT_ONLY_GUIDE', instructions: 'Parent instructions' });
  await f.installed.skills.create({ name: 'child-guide', description: 'CHILD_ONLY_GUIDE', instructions: 'Child instructions' });
  await f.installed.agents.setVisibility('mainagent', { skill: { 'parent-guide': true } });
  await f.installed.agents.setVisibility('worker', { skill: { 'child-guide': true } });
  const parentRun = await f.installed.prepareRun({ agentKey: 'mainagent', parent: f.agent, taskId: f.task.id, sessionId: f.agent.id });
  const detach = parentRun.attach(f.agent.ctx, f.agent);
  let childRun;
  try {
    assert.match(f.agent.ctx.tools.get('Skill', f.agent).description, /PARENT_ONLY_GUIDE/);
    childRun = await f.installed.prepareRun({ agentKey: 'worker', parent: f.agent, taskId: f.task.id, sessionId: 'nested-worker-fixture' });
    assert.equal(childRun.tools.filter(tool => tool.name === 'Skill').length, 1);
    const skill = childRun.tools.find(tool => tool.name === 'Skill');
    assert.match(skill.description, /CHILD_ONLY_GUIDE/); assert.doesNotMatch(skill.description, /PARENT_ONLY_GUIDE/);
    const loaded = await childRun.execute('Skill', { name: 'child-guide' }, randomUUID(), AbortSignal.timeout(5000));
    assert.equal(loaded.isError, false, resultText(loaded));
    const denied = await childRun.execute('Skill', { name: 'parent-guide' }, randomUUID(), AbortSignal.timeout(5000));
    assert.equal(denied.isError, true); assert.match(resultText(denied), /not visible/);
    const usage = await f.installed.skills.usage('child-guide');
    assert.equal(usage.length, 1); assert.equal(usage[0].agentKey, 'worker'); assert.equal(usage[0].sessionId, 'nested-worker-fixture');
    assert.equal(f.adapter.requests.length, 0, 'preparing a nested run must not drive a model');
  } finally { await childRun?.dispose(); detach(); await parentRun.dispose(); }
});

test('main Agent binding updates the selected live parent on its first step and leaves unrelated Agents unchanged', { timeout: 30000 }, async t => {
  const f = await fixture(t);
  const removeHost = f.app.get('systemPrompt').section({ name: 'fixture-host-prompt', order: 0, text: 'UNBOUND_HOST_PROMPT', interpolate: false });
  const localCalls = [];
  const removeLocal = f.agent.ctx.tools.register(defineTool({ name: 'fixture_parent_local', description: 'Parent-owned local tool', parameters: { word: { type: 'string', required: true } },
    output: { schema: { type: 'json' }, render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }] }, execute: args => { localCalls.push(args.word); return { local: args.word }; },
  }));
  const other = await f.app.get('agents').create({ sessionId: SessionId(randomUUID()), agentOptions: { provider: 'platform-fixture', model: 'fixture-model' } });
  const follow = async (agent, responses = ['done']) => {
    f.adapter.responses.push(...responses);
    agent.followup(createUserMessage({ content: [{ type: 'text', text: 'Respond to this local fixture' }], source: { kind: 'user' } }));
    await agent.whenIdle();
    const ended = agent.session.snapshotEvents().filter(event => event.type === 'turn/end').at(-1);
    assert.equal(ended?.data.reason.kind, 'completed', JSON.stringify(ended?.data.reason));
  };
  let unbind;
  try {
    await follow(other.agent);
    const originalSystem = requestSystem(f.adapter.requests[0]), originalTools = requestNames(f.adapter.requests[0]);
    assert.match(originalSystem, /UNBOUND_HOST_PROMPT/); assert.ok(originalTools.includes('fixture_echo'));
    await f.ok('prompts', 'save', { key: 'mainagent', template: 'MAIN_BOUND_A {{.Goal}}' });
    unbind = f.installed.bindMainAgents(agent => agent.id === f.agent.id ? { taskId: f.task.id, role: 'mainagent' } : undefined);
    await follow(f.agent, [calls('redteam_platform_agents', { action: 'update', payload: { key: 'worker', patch: { enabled: false } } }), 'done']);
    assert.match(requestSystem(f.adapter.requests[1]), /MAIN_BOUND_A VERIFY_LOCAL_PLATFORM_GOAL/);
    assert.doesNotMatch(requestSystem(f.adapter.requests[1]), /UNBOUND_HOST_PROMPT/);
    assert.ok(requestNames(f.adapter.requests[1]).includes('fixture_parent_local'));
    assert.equal(requestNames(f.adapter.requests[1]).includes('redteam_platform_agents'), false);
    assert.equal(f.installed.agents.get('worker').enabled, true, 'a hallucinated local management call must be denied, not merely hidden from schemas');
    await f.ok('prompts', 'save', { key: 'mainagent', template: 'MAIN_BOUND_B {{.Goal}}' });
    await f.ok('tools', 'update', { key: 'fixture_echo', patch: { agents: ['worker'] } });
    const localSchema = structuredClone((await f.ok('tools', 'list')).find(tool => tool.key === 'fixture_parent_local').schema);
    localSchema.properties.word.default = 'LOCAL_CONFIGURED_DEFAULT';
    await f.ok('tools', 'update', { key: 'fixture_parent_local', patch: { description: 'LOCAL_CONFIGURED_DESCRIPTION', schema: localSchema } });
    await follow(f.agent, [calls('fixture_parent_local'), 'done']);
    assert.match(requestSystem(f.adapter.requests[3]), /MAIN_BOUND_B VERIFY_LOCAL_PLATFORM_GOAL/);
    assert.equal(requestNames(f.adapter.requests[3]).includes('fixture_echo'), false);
    assert.equal(f.adapter.requests[3].tools.find(tool => tool.name === 'fixture_parent_local').description, 'LOCAL_CONFIGURED_DESCRIPTION');
    assert.deepEqual(localCalls, ['LOCAL_CONFIGURED_DEFAULT']);
    assert.equal(f.agent.ctx.tools.get('fixture_parent_local', f.agent).description, 'Parent-owned local tool', 'detaching restores the original local registration');
    await follow(other.agent);
    assert.equal(requestSystem(f.adapter.requests[5]), originalSystem);
    assert.deepEqual(requestNames(f.adapter.requests[5]), originalTools);
  } finally { unbind?.(); removeLocal(); removeHost(); await other.dispose(); }
});
