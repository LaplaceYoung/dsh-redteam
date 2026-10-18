import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile, readFile, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:http';
import { ResourcesRuntime, ResourceExecutionError } from '../lib/platform/resources.js';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js';
import { ListToolsRequestSchema, CallToolRequestSchema } from '@modelcontextprotocol/sdk/types.js';

async function fixture(t, options = {}) {
  const root = await mkdtemp(join(tmpdir(), 'platform-resources-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const runtime = new ResourcesRuntime({ root, ...options }); await runtime.init();
  return { root, runtime };
}
const exec = () => ({ signal: new AbortController().signal });

test('custom Python binding, arguments, environment, persistence, update and disabled state affect new runs', async t => {
  const { root, runtime } = await fixture(t);
  assert.ok(runtime.getPythonInterpreter(), 'real Python must be detected');
  await runtime.createCustomTool({ key: 'echo_params', kind: 'script', description: 'Echo parameters', agents: ['worker'], deferred: true,
    exec: { code: 'import json,sys,os\np=json.load(sys.stdin)\nprint(json.dumps({"params":p,"env":os.environ["TOOL_WORD"],"session":os.environ["LOCAL_FIXTURE"]}))' } });
  const hidden = await runtime.prepareTools({ agentKey: 'planner', mcpIds: [] }); assert.equal(hidden.tools.length, 0); await hidden.dispose();
  const first = await runtime.prepareTools({ agentKey: 'worker', mcpIds: [], env: { LOCAL_FIXTURE: 'session' } });
  assert.deepEqual(first.deferred, ['echo_params']);
  const value = JSON.parse(await first.tools[0].execute({ word: 'hello', list: [1, 2] }, exec()));
  assert.deepEqual(value, { params: { word: 'hello', list: [1, 2] }, env: 'hello', session: 'session' });
  await runtime.updateCustomTool('echo_params', { exec: { code: 'print("updated")' } });
  const next = await runtime.prepareTools({ agentKey: 'worker', mcpIds: [] });
  assert.equal((await next.tools[0].execute({}, exec())).trim(), 'updated');
  await runtime.updateCustomTool('echo_params', { enabled: false });
  const restarted = new ResourcesRuntime({ root }); await restarted.init();
  assert.equal((await restarted.prepareTools({ agentKey: 'worker', mcpIds: [] })).tools.length, 0);
  assert.deepEqual(await readdir(join(root, '.tools')), []);
  await first.dispose(); await next.dispose();
});

test('Python errors, timeout and caller cancellation are failures; temporary scripts are cleaned', async t => {
  const { root, runtime } = await fixture(t);
  await assert.rejects(runtime.testCustomTool({ kind: 'script', exec: { code: 'import sys\nprint("before error", flush=True)\nsys.exit(7)' } }, {}), error => error instanceof ResourceExecutionError && error.exitCode === 7 && error.output.includes('before error'));
  await assert.rejects(runtime.testCustomTool({ kind: 'script', exec: { code: 'import time\ntime.sleep(30)', timeout_ms: 50 } }, {}), { name: 'TimeoutError' });
  const controller = new AbortController();
  const pending = runtime.testCustomTool({ kind: 'script', exec: { code: 'import time\ntime.sleep(30)' } }, {}, { signal: controller.signal });
  setTimeout(() => controller.abort(), 50);
  await assert.rejects(pending, { name: 'AbortError' });
  assert.deepEqual(await readdir(join(root, '.tools')), []);
});

test('custom schema defaults reach Python while missing required arguments reject', async t => {
  const { runtime } = await fixture(t);
  await runtime.createCustomTool({ key: 'defaults', kind: 'script', agents: ['worker'], schema: { type: 'object', properties: { label: { type: 'string', default: 'fixture' }, count: { type: 'integer' } }, required: ['count'] }, exec: { code: 'import sys,json\nprint(json.dumps(json.load(sys.stdin)))' } });
  const prepared = await runtime.prepareTools({ agentKey: 'worker', mcpIds: [] });
  try {
    await assert.rejects(prepared.tools[0].execute({}, exec()), /count/);
    assert.deepEqual(JSON.parse(await prepared.tools[0].execute({ count: 2 }, exec())), { count: 2, label: 'fixture' });
  } finally { await prepared.dispose(); }
});

test('command uses host executor with quoted params; shell declarations only affect hints', async t => {
  let observed;
  const { runtime } = await fixture(t, { executeCommand: async (command, context) => { observed = { command, context }; return 'host output'; } });
  await runtime.createCustomTool({ key: 'fixture_cli', kind: 'shell', description: 'local fixture', agents: ['auto'] });
  await runtime.createCustomTool({ key: 'fixture_cmd', kind: 'command', exec: { command: 'printf %s {word}' }, agents: ['auto'] });
  const prepared = await runtime.prepareTools({ agentKey: 'auto', mcpIds: [] });
  assert.deepEqual(prepared.shellHints, ['- fixture_cli: local fixture']); assert.equal(prepared.tools.length, 1);
  assert.equal(await prepared.tools[0].execute({ word: "a'b" }, exec()), 'host output');
  assert.equal(observed.command, "printf %s 'a'\\''b'"); assert.equal(observed.context.timeoutMs, 120000);
  await prepared.dispose();
});

test('HTTP custom tools use templates, actual status/body, and explicit recording-proxy error', async t => {
  const server = createServer(async (req, res) => { const chunks = []; for await (const chunk of req) chunks.push(chunk); res.writeHead(418, { 'content-type': 'application/json' }); res.end(JSON.stringify({ path: req.url, header: req.headers['x-fixture'], body: Buffer.concat(chunks).toString() })); });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve)); t.after(() => new Promise(resolve => server.close(resolve)));
  const { root, runtime } = await fixture(t); const url = `http://127.0.0.1:${server.address().port}/{word}`;
  const value = await runtime.testCustomTool({ kind: 'http', exec: { url, method: 'POST', body: '{word}', headers: { 'x-fixture': '{word}' } } }, { word: 'local' });
  assert.equal(value.status, 418); assert.deepEqual(JSON.parse(value.body), { path: '/local', header: 'local', body: 'local' });
  await assert.rejects(runtime.testCustomTool({ kind: 'http', exec: { url, use_recording_proxy: true } }, {}), /not running/);
  assert.equal((await runtime.testCustomTool({ kind: 'http', exec: { url, method: ' get ', body: '', timeout_ms: -1 } }, { word: 'empty' })).status, 418);
  let globalProxyReads = 0;
  const scoped = new ResourcesRuntime({ root, recordingProxy: () => { globalProxyReads++; return { url: 'http://127.0.0.1:1' }; } });
  await assert.rejects(scoped.testCustomTool({ kind: 'http', exec: { url, use_recording_proxy: true } }, {}, { recordingProxy: () => undefined }), /not running/);
  assert.equal(globalProxyReads, 0, 'run-specific absent capture must not use another run global proxy');
});

const stdioSource = `import readline from 'node:readline';
const input = readline.createInterface({input:process.stdin});
input.on('line', line => {const r=JSON.parse(line); if(r.id===undefined)return;
let result;
if(r.method==='initialize')result={protocolVersion:r.params.protocolVersion,serverInfo:{name:'fixture',version:'1'},capabilities:{tools:{}}};
else if(r.method==='tools/list')result={tools:[{name:'echo',description:'fixture echo',inputSchema:{type:'object',properties:{word:{type:'string'}}}}]};
else if(r.method==='tools/call')result={content:[{type:'text',text:process.env.FIXTURE_PREFIX+':'+r.params.arguments.word}],isError:r.params.arguments.word==='fail'};
else result={}; process.stdout.write(JSON.stringify({jsonrpc:'2.0',id:r.id,result})+'\\n');});`;

test('stdio MCP discovery/cache and real tool calls respect per-run visibility and enabled state', async t => {
  const { root, runtime } = await fixture(t); const path = join(root, 'mcp-fixture.mjs'); await writeFile(path, stdioSource);
  const server = await runtime.saveMcp({ name: 'fixture', transport: 'stdio', command: process.execPath, args: [path], env: { FIXTURE_PREFIX: 'child' } });
  assert.equal((await runtime.discoverMcp(server.id))[0].name, 'echo');
  const restarted = new ResourcesRuntime({ root }); await restarted.init(); assert.equal(restarted.listMcp()[0].tools[0].description, 'fixture echo');
  const invisible = await runtime.prepareTools({ agentKey: 'worker', mcpIds: [] }); assert.equal(invisible.tools.length, 0);
  const prepared = await runtime.prepareTools({ agentKey: 'worker', mcpIds: [server.id] }); t.after(prepared.dispose);
  assert.deepEqual(prepared.serverTools, { fixture: ['mcp__fixture__echo'] });
  const value = await prepared.tools[0].execute({ word: 'hello' }, exec()); assert.equal(value.content[0].text, 'child:hello');
  await assert.rejects(prepared.tools[0].execute({ word: 'fail' }, exec()), ResourceExecutionError);
  await runtime.saveMcp({ id: server.id, enabled: false });
  assert.equal((await runtime.prepareTools({ agentKey: 'worker', mcpIds: [server.id] })).tools.length, 0);
});

test('MCP discovery cancellation closes transport and records failure without inventing cached tools', async t => {
  const { root, runtime } = await fixture(t); const path = join(root, 'slow-mcp.mjs');
  await writeFile(path, stdioSource.replace("else if(r.method==='tools/list')result=", "else if(r.method==='tools/list')return; else if(false)result="));
  const server = await runtime.saveMcp({ name: 'slow', transport: 'stdio', command: process.execPath, args: [path] });
  await assert.rejects(runtime.discoverMcp(server.id, AbortSignal.timeout(200)), { name: 'TimeoutError' });
  assert.deepEqual(runtime.listMcp()[0].tools, []);
  assert.ok(runtime.listMcp()[0].discoveryError);
});

function protocolServer(beforeList = async () => undefined) {
  const server = new Server({ name: 'http-fixture', version: '1' }, { capabilities: { tools: {} } });
  server.setRequestHandler(ListToolsRequestSchema, async () => { await beforeList(); return { tools: [{ name: 'echo', description: 'HTTP fixture', inputSchema: { type: 'object', properties: { word: { type: 'string' } } } }] }; });
  server.setRequestHandler(CallToolRequestSchema, async req => ({ content: [{ type: 'text', text: String(req.params.arguments.word) }] }));
  return server;
}
for (const mode of ['http', 'sse']) test(`${mode} MCP discovers and invokes local server with auth headers`, async t => {
  const sessions = new Map(); const all = []; const headers = [];
  const server = createServer(async (req, res) => {
    try {
      headers.push(req.headers.authorization);
      if (req.headers.authorization !== 'Bearer fixture') { res.writeHead(401); res.end(); return; }
      if (mode === 'http') {
        const protocol = protocolServer(); const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true }); all.push(protocol); await protocol.connect(transport); await transport.handleRequest(req, res);
      } else if (req.method === 'GET') {
        const protocol = protocolServer(); const transport = new SSEServerTransport('/messages', res); all.push(protocol); sessions.set(transport.sessionId, transport); await protocol.connect(transport);
      } else { const transport = sessions.get(new URL(req.url, 'http://localhost').searchParams.get('sessionId')); if (!transport) { res.writeHead(404); res.end(); } else await transport.handlePostMessage(req, res); }
    } catch (error) { res.writeHead(500); res.end(String(error)); }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(async () => { await Promise.all(all.map(s => s.close())); server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); });
  const { runtime } = await fixture(t);
  const saved = await runtime.saveMcp({ name: mode, transport: mode, url: `http://127.0.0.1:${server.address().port}/${mode}`, env: { Authorization: 'Bearer fixture' } });
  assert.equal((await runtime.discoverMcp(saved.id))[0].name, 'echo');
  const prepared = await runtime.prepareTools({ agentKey: 'worker', mcpIds: [saved.id] });
  try { assert.equal((await prepared.tools[0].execute({ word: mode }, exec())).content[0].text, mode); } finally { await prepared.dispose(); }
  assert.ok(headers.length >= 4); assert.ok(headers.every(h => h === 'Bearer fixture'));
});

test('serialized parallel updates persist every row and validation rejects malformed boundary input', async t => {
  const { root, runtime } = await fixture(t);
  await Promise.all(Array.from({ length: 12 }, (_, i) => runtime.createCustomTool({ key: `hint_${i}`, kind: 'shell' })));
  const restarted = new ResourcesRuntime({ root }); await restarted.init(); assert.equal(restarted.listTools().length, 12);
  await assert.rejects(runtime.createCustomTool({ key: 'bad', kind: 'http', exec: { url: 'http://localhost' } }), /schema/);
  await assert.rejects(runtime.saveMcp({ name: 'bad', transport: 'stdio' }), /command/);
  await assert.rejects(runtime.deleteMcp(99), /not found/);
  await runtime.createCustomTool({ key: 'after_failure', kind: 'shell' }); assert.equal(runtime.listTools().length, 13);
});

test('two runtime instances sharing one root serialize concurrent tools and MCP configuration without lost writes', async t => {
  const { root, runtime } = await fixture(t); const second = new ResourcesRuntime({ root }); await second.init();
  await Promise.all(Array.from({ length: 10 }, (_, i) => (i % 2 ? runtime : second).createCustomTool({ key: `scope_${i}`, kind: 'shell' })));
  await Promise.all(Array.from({ length: 10 }, (_, i) => (i % 2 ? second : runtime).saveMcp({ name: `scope_${i}`, transport: 'stdio', command: process.execPath })));
  assert.equal(runtime.listTools().length, 10); assert.equal(second.listTools().length, 10);
  assert.equal(new Set(runtime.listMcp().map(m => m.id)).size, 10); assert.equal(second.listMcp().length, 10);
  const persisted = JSON.parse(await readFile(join(root, 'platform-resources.json'), 'utf8'));
  assert.equal(persisted.tools.length, 10); assert.equal(persisted.mcps.length, 10); assert.equal(persisted.nextMcpId, 11);
});

test('MCP configuration update while discovery is pending rejects stale cache write', async t => {
  let started; const listing = new Promise(resolve => { started = resolve; });
  let release; const barrier = new Promise(resolve => { release = resolve; });
  const protocols = [];
  const server = createServer(async (req, res) => {
    const protocol = protocolServer(async () => { started(); await barrier; });
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
    protocols.push(protocol); await protocol.connect(transport); await transport.handleRequest(req, res);
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(async () => { release(); await Promise.all(protocols.map(p => p.close())); server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); });
  const { runtime } = await fixture(t);
  const saved = await runtime.saveMcp({ name: 'before', transport: 'http', url: `http://127.0.0.1:${server.address().port}/mcp` });
  const discovering = runtime.discoverMcp(saved.id);
  const rejected = assert.rejects(discovering, /configuration changed/);
  await listing; await runtime.saveMcp({ id: saved.id, name: 'after' }); release(); await rejected;
  assert.deepEqual(runtime.listMcp()[0].tools, []); assert.equal(runtime.listMcp()[0].name, 'after'); assert.equal(runtime.listMcp()[0].discoveryError, undefined);
});
