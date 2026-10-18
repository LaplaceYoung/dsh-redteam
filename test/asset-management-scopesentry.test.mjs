import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { build } from 'esbuild';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
const built = await build({ stdin: { contents: "export {ScopeSentryRuntime,scopeSentryAssets} from './src/asset-management/scopesentry.ts'; export {GraphAssetRuntime} from './src/graph-tools/assets.ts'; export {RedTeamStore} from './src/store.ts';", resolveDir: process.cwd(), loader: 'ts' }, bundle: true, write: false, packages: 'external', platform: 'node', format: 'esm', target: 'node22' });
const code = built.outputFiles[0].text.replace(/from\s+(["'])([^"']+)\1/g, (_match, _quote, specifier) => `from ${JSON.stringify(import.meta.resolve(specifier))}`);
const { ScopeSentryRuntime, scopeSentryAssets, GraphAssetRuntime, RedTeamStore } = await import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`);

const secret = 'fixture-api-key-do-not-echo';
async function fixture(t, handler = () => ({ list: [] }), sinkOverride) {
  const dir = await mkdtemp(join(tmpdir(), 'scopesentry-test-')), path = join(dir, 'state.json.scopesentry.json');
  const calls = [], headers = [], connections = new Map(), servers = new Set(), runtimes = [];
  const store = new RedTeamStore(join(dir, 'state.json')); await store.load();
  const graph = new GraphAssetRuntime(store), companies = new Map(); let reattributed = 0;
  const sink = sinkOverride ?? {
    insertAssets: assets => graph.insertAssets('global', assets),
    upsertCompany: async input => { companies.set(input.name, input); },
    recomputeAttribution: async () => { reattributed++; },
  };
  let rejectHttp;
  const http = createServer(async (req, res) => {
    try {
      headers.push(req.headers['x-api-key']);
      if (rejectHttp) { res.writeHead(rejectHttp, { 'content-type': 'text/plain' }); res.end(`X-API-Key: ${secret}`); return; }
      if (req.headers['x-api-key'] !== secret) { res.writeHead(403); res.end('bad API key'); return; }
      let body;
      if (req.method === 'POST') { const chunks = []; for await (const chunk of req) chunks.push(chunk); body = JSON.parse(Buffer.concat(chunks).toString()); }
      let transport = connections.get(req.headers['mcp-session-id']);
      if (!transport && body?.method === 'initialize') {
        const server = new Server({ name: 'scopesentry-fixture', version: '1' }, { capabilities: { tools: {} } });
        server.setRequestHandler(ListToolsRequestSchema, async request => request.params?.cursor ? { tools: [{ name: 'list_tasks', inputSchema: { type: 'object' } }] } : { tools: [{ name: 'list_projects_data', inputSchema: { type: 'object' } }, { name: 'get_project', inputSchema: { type: 'object' } }, { name: 'list_assets', inputSchema: { type: 'object' } }], nextCursor: 'second-page' });
        server.setRequestHandler(CallToolRequestSchema, async (request, extra) => {
          calls.push(request.params);
          const result = await handler(request.params.name, request.params.arguments, extra);
          return result?.content ? result : { content: [{ type: 'text', text: JSON.stringify(result) }] };
        });
        transport = new StreamableHTTPServerTransport({ sessionIdGenerator: randomUUID, onsessioninitialized: id => connections.set(id, transport), enableJsonResponse: true });
        servers.add(server); await server.connect(transport);
      }
      if (!transport) { res.writeHead(404); res.end('missing session'); return; }
      await transport.handleRequest(req, res, body);
    } catch (error) { if (!res.headersSent) res.writeHead(500); res.end(String(error)); }
  });
  await new Promise(resolve => http.listen(0, '127.0.0.1', resolve));
  const url = `http://127.0.0.1:${http.address().port}/mcp`;
  const runtime = new ScopeSentryRuntime(path, sink); runtimes.push(runtime);
  t.after(async () => {
    for (const item of runtimes) await item.dispose();
    for (const server of servers) await server.close();
    http.closeAllConnections(); await new Promise(resolve => http.close(resolve));
    await rm(dir, { recursive: true, force: true });
  });
  return { runtime, store, graph, path, sink, companies, calls, headers, url, get reattributed() { return reattributed; }, rejectHttp(status) { rejectHttp = status; }, other() { const other = new ScopeSentryRuntime(path, sink); runtimes.push(other); return other; }, configure: () => runtime.configure({ url, api_key: secret }) };
}

test('placeholder, redacted durable configuration, real MCP discovery and project/task pagination', { timeout: 15000 }, async t => {
  const f = await fixture(t, (name, args) => name === 'list_projects_data' ? { result: { All: [{ id: 'project-2', name: 'second' }] }, tag: { All: 1 } } : { list: [{ name: 'task-3' }] });
  await f.runtime.ready();
  assert.equal((await f.runtime.status()).exists, false);
  assert.equal((await f.runtime.configure({})).configured, false);
  assert.equal(f.headers.length, 0);
  const configured = await f.configure();
  assert.equal(configured.configured, true); assert.equal(configured.reachable, true); assert.equal(configured.hasApiKey, true);
  assert.deepEqual(configured.tools, ['list_projects_data', 'get_project', 'list_assets', 'list_tasks']);
  assert.equal(JSON.stringify(configured).includes(secret), false);
  assert.equal(JSON.parse(await readFile(f.path, 'utf8')).apiKey, secret);
  assert.deepEqual(await f.runtime.projects({ page: 2, size: 25, search: 'query' }), { projects: [{ id: 'project-2', name: 'second' }], tag: { All: 1 } });
  assert.deepEqual(await f.runtime.tasks({ page: 3, size: 10 }), { tasks: [{ name: 'task-3' }] });
  assert.deepEqual(f.calls.map(call => call.arguments), [{ pageIndex: 2, pageSize: 25, search: 'query' }, { pageIndex: 3, pageSize: 10 }]);
  assert.equal(f.headers.every(value => value === secret), true);
  await f.other().configure({ api_key: '', enabled: false });
  const before = f.headers.length;
  assert.equal((await f.runtime.status()).enabled, false); assert.equal(f.headers.length, before);
  await assert.rejects(f.runtime.tasks(), error => error.status === 503);
});

test('real MCP assets map into the real global graph store and repeated sync preserves IDs', { timeout: 15000 }, async t => {
  const f = await fixture(t, (name, args) => {
    if (name === 'get_project') return { name: 'Fixture Company', target: 'example.test\n\nexample.org\n' };
    assert.deepEqual(args.filter, { project: ['project-1'] });
    const rows = args.asset_type === 'subdomain' ? [
      { host: 'a.example.test', type: 'A', value: ['192.0.2.1'], ip: ['192.0.2.1'] },
      { host: 'b.example.test', type: 'A', value: ['192.0.2.2'], ip: ['192.0.2.2'] },
      { host: 'c.example.test', type: 'CNAME', value: ['a.example.test'], ip: ['192.0.2.1'] },
    ] : args.asset_type === 'app' ? [{ name: 'Fixture App', category: 'web', description: 'Observed app', icp: 'ICP-123' }] : [
      { service: 'http', url: 'https://a.example.test/', ip: '192.0.2.1', title: 'Home', status: 200, products: ['nginx'], icon: '123' },
      { domain: 'b.example.test', ip: '192.0.2.2', service: 'ssh', port: '22' },
    ];
    return { list: rows.slice((args.pageIndex - 1) * args.pageSize, args.pageIndex * args.pageSize) };
  });
  await f.configure();
  const request = { dimension: 'project', targets: ['project-1'], create_company: true, page_size: 2 };
  const first = await f.runtime.sync(request);
  assert.equal(first.ok, true); assert.equal(first.partial, false);
  assert.deepEqual(first.synced, { subdomain: 3, ip: 3, app: 1, service: 2 });
  assert.deepEqual(f.companies.get('Fixture Company'), { name: 'Fixture Company', roots: ['example.test', 'example.org'], source: 'scopesentry:Fixture Company' });
  assert.equal(f.reattributed, 1);
  const before = f.store.snapshot().assets.map(asset => asset.id).sort();
  await f.runtime.sync(request);
  assert.deepEqual(f.store.snapshot().assets.map(asset => asset.id).sort(), before);
  const rows = f.store.snapshot().assets;
  assert.equal(rows.find(asset => asset.kind === 'app').metadata.app_icp, 'ICP-123');
  assert.equal(rows.find(asset => asset.metadata.service_name === 'ssh').metadata.port, 22);
  assert.equal(rows.find(asset => asset.metadata.url === 'https://a.example.test').metadata.status_code, 200);
  assert.deepEqual(f.calls.filter(call => call.name === 'list_assets' && call.arguments.asset_type === 'subdomain').slice(0, 2).map(call => call.arguments.pageIndex), [1, 2]);
});

test('page failures, malformed data and per-item write errors remain visible partial outcomes', { timeout: 15000 }, async t => {
  const f = await fixture(t, (_name, args) => {
    assert.deepEqual(args.filter, { task: ['task-name'] });
    if (args.asset_type === 'subdomain' && args.pageIndex === 1) return { list: [{ host: 'discard.example.test' }] };
    if (args.asset_type === 'subdomain') return { isError: true, content: [{ type: 'text', text: `upstream denied X-API-Key: ${secret}` }] };
    if (args.asset_type === 'asset') return { list: args.pageIndex === 1 ? [{ service: 'ssh', ip: '192.0.2.1', port: 'not-a-port' }] : [] };
    return { list: args.pageIndex === 1 ? [{ name: 'Still saved' }, { name: 42 }] : [] };
  });
  await f.configure();
  const result = await f.runtime.sync({ dimension: 'task', targets: ['task-name'], page_size: 1 });
  assert.equal(result.ok, false); assert.equal(result.partial, true);
  assert.ok(result.errors.some(error => error.includes('fetch failed')));
  assert.ok(result.errors.some(error => error.includes('port')));
  assert.ok(result.errors.some(error => error.includes('name must be text')));
  assert.equal(JSON.stringify(result).includes(secret), false);
  assert.equal(f.store.snapshot().assets.some(asset => asset.value === 'discard.example.test'), false);
});

test('bad project/task envelopes and HTTP authentication errors reject without leaking secrets', { timeout: 15000 }, async t => {
  const f = await fixture(t, name => name === 'list_tasks' ? { wrong: [] } : { content: [{ type: 'text', text: 'not JSON' }] });
  await f.configure();
  await assert.rejects(f.runtime.tasks(), error => error.status === 502 && /tasks must be an array/.test(error.message));
  await assert.rejects(f.runtime.projects(), error => error.status === 502 && /invalid JSON/.test(error.message));
  f.rejectHttp(403);
  await assert.rejects(f.runtime.tasks(), error => error.status === 502 && error.upstreamStatus === 403 && !JSON.stringify(error).includes(secret) && !error.message.includes(secret));
  const status = await f.runtime.status();
  assert.equal(status.reachable, false); assert.match(status.error, /403/); assert.equal(JSON.stringify(status).includes(secret), false);
});

test('5000-row guard limits ingestion and reports truncation without claiming full results', { timeout: 15000 }, async t => {
  let ingested = 0;
  const f = await fixture(t, (_name, args) => ({ list: Array.from({ length: 500 }, (_, index) => ({ name: `app-${args.pageIndex}-${index}` })) }), {
    insertAssets: async assets => { ingested += assets.length; return { results: assets.map((asset, index) => ({ index, id: String(index), type: asset.type })), errors: [] }; },
    upsertCompany: async () => { throw new Error('not requested'); }, recomputeAttribution: async () => { throw new Error('not requested'); },
  });
  await f.configure();
  const result = await f.runtime.sync({ dimension: 'task', targets: ['one'], asset_types: ['app'], page_size: 500 });
  assert.equal(ingested, 5000); assert.equal(f.calls.length, 10);
  assert.equal(result.partial, true); assert.match(result.warnings[0], /5000/);
});

test('configuration validation, query redaction and concurrent file instances preserve updates', { timeout: 15000 }, async t => {
  const f = await fixture(t);
  await assert.rejects(f.runtime.configure({ url: 'file:///tmp/secret' }), error => error.status === 400);
  await assert.rejects(f.runtime.configure({ url: 'https://user:password@example.test/' }), error => error.status === 400);
  await assert.rejects(f.runtime.configure({ api_key: 'bad\nheader' }), error => error.status === 400);
  assert.throws(() => f.runtime.projects({ page: 0 }), error => error.status === 400);
  await Promise.all([f.runtime.configure({ url: f.url }), f.other().configure({ api_key: secret })]);
  assert.equal((await f.runtime.status()).configured, true);
  const view = await f.runtime.configure({ url: f.url + '?token=private-query' });
  assert.equal(view.url.includes('private-query'), false);
  await writeFile(f.path, '{broken');
  await assert.rejects(f.runtime.ready(), error => error.status === 500);
});

test('caller cancellation aborts a real outstanding MCP call and dispose closes active work', { timeout: 15000 }, async t => {
  let entered = Promise.withResolvers();
  const f = await fixture(t, async (_name, _args, extra) => {
    entered.resolve();
    await new Promise(resolve => { extra.signal.addEventListener('abort', resolve, { once: true }); if (extra.signal.aborted) resolve(); });
    return { list: [] };
  });
  await f.configure();
  const controller = new AbortController(), reason = new Error('cancel sync');
  const pending = f.runtime.tasks({}, controller.signal);
  await entered.promise; controller.abort(reason);
  await assert.rejects(pending, error => error === reason);
  entered = Promise.withResolvers();
  const second = f.runtime.tasks();
  await entered.promise;
  const disposed = f.runtime.dispose();
  await assert.rejects(second, /disposed/);
  await disposed;
  await assert.rejects(f.runtime.status(), /disposed/);
});

test('mapping rejects malformed foreign fields and preserves non-HTTP service identity', () => {
  assert.deepEqual(scopeSentryAssets('service', { domain: 'host.test', ip: '192.0.2.10', port: '443', service: 'tls' }), [{ type: 'service', domain: 'host.test', ip: '192.0.2.10', port: 443, service_name: 'tls' }]);
  assert.deepEqual(scopeSentryAssets('service', { service: 'http' }), []);
  assert.throws(() => scopeSentryAssets('subdomain', { host: 'a.test', ip: [42] }), /string array/);
});
