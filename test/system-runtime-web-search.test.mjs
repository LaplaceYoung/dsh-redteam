import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import net from 'node:net';
import { build } from 'esbuild';
import { MockAgent, getGlobalDispatcher, setGlobalDispatcher } from 'undici';

const bundle = await build({ entryPoints: ['src/system-runtime/web-search.ts'], bundle: true, write: false, platform: 'node', format: 'esm', packages: 'external' });
let source = bundle.outputFiles[0].text;
for (const name of ['undici', 'parse5']) source = source.replaceAll(`from "${name}"`, `from ${JSON.stringify(import.meta.resolve(name))}`);
const { WebSearchClient, WebSearchHTTPError, deepSeekMessagesURL } = await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);

async function server(t, handler) {
  const instance = http.createServer(handler);
  await new Promise(resolve => instance.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => { instance.closeAllConnections(); instance.close(resolve); }));
  return { instance, url: `http://127.0.0.1:${instance.address().port}` };
}
function client(t, config, url) {
  const value = new WebSearchClient(config, { endpoints: { ddgs: url, 'brave-free': url, tavily: url } });
  t.after(() => value.close()); return value;
}
async function body(req) { let value = ''; for await (const chunk of req) value += chunk; return value; }
const hit = { title: 'Result', url: 'https://example.org/a', description: 'Snippet' };

test('configuration validates before network and normalizes DeepSeek messages URLs', () => {
  for (const config of [{ backend: 'unknown' }, { backend: 'brave-free' }, { backend: 'tavily' }, { backend: 'deepseek', deepSeekAPIKey: 'key' }, { proxy: 'file:///tmp' }]) assert.throws(() => new WebSearchClient(config));
  for (const suffix of ['', '/', '/v1', '/v1/messages']) assert.equal(deepSeekMessagesURL(`http://localhost/anthropic${suffix}`), 'http://localhost/anthropic/v1/messages');
});

test('DDGS posts search form and extracts nested text, entities, redirects and ranked snippets', async t => {
  let request;
  const fixture = await server(t, async (req, res) => {
    request = { method: req.method, headers: req.headers, form: new URLSearchParams(await body(req)) };
    res.end(`<a class="extra result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fexample.org%2Fa&amp;rut=x">First <b>nested</b> &amp; text</a><span class="result__snippet">Snippet <b>one</b></span><a class="result__a" href="https://example.org/b">Second</a><a class="result__snippet">Second snippet</a>`);
  });
  const search = client(t, { backend: ' DDGS ' }, fixture.url);
  assert.deepEqual(await search.search(' query ', 1), [{ title: 'First nested & text', url: 'https://example.org/a', description: 'Snippet one', position: 1 }]);
  assert.equal(request.method, 'POST'); assert.equal(request.form.get('q'), 'query'); assert.equal(request.form.get('kl'), 'wt-wt');
  assert.match(request.headers['user-agent'], /Firefox/); assert.equal(request.headers.referer, 'https://html.duckduckgo.com/');
  await assert.rejects(search.search(' '), /empty/); await assert.rejects(search.search('q', 1.5), /integer/);
});

test('Brave probe uses auth header and caps count; Tavily uses original JSON key protocol', async t => {
  const requests = [];
  const fixture = await server(t, async (req, res) => {
    requests.push({ method: req.method, url: req.url, headers: req.headers, body: await body(req) });
    res.setHeader('Content-Type', 'application/json');
    res.end(req.method === 'GET' ? JSON.stringify({ web: { results: [hit] } }) : JSON.stringify({ results: [{ ...hit, content: 'Extracted' }] }));
  });
  assert.deepEqual(await client(t, { backend: 'brave-free', braveAPIKey: ' secret ' }, fixture.url).probe('probe', 99), [{ ...hit, position: 1 }]);
  assert.equal(requests[0].headers['x-subscription-token'], 'secret');
  assert.equal(new URL(requests[0].url, fixture.url).searchParams.get('count'), '20');
  assert.equal(new URL(requests[0].url, fixture.url).searchParams.get('q'), 'probe');
  assert.deepEqual(await client(t, { backend: 'tavily', tavilyAPIKey: 'tvly-secret' }, fixture.url).probe(), [{ ...hit, description: 'Extracted', position: 1 }]);
  assert.deepEqual(JSON.parse(requests[1].body), { api_key: 'tvly-secret', query: 'test', max_results: 3, search_depth: 'basic' });
});

test('HTTP failure, invalid payload and rate limiting never masquerade as successful empty search', async t => {
  let mode = '401';
  const fixture = await server(t, (req, res) => {
    if (mode === '401' || mode === '202') { res.statusCode = Number(mode); res.end('secret'); }
    else res.end(mode);
  });
  const brave = client(t, { backend: 'brave-free', braveAPIKey: 'secret' }, fixture.url);
  await assert.rejects(brave.probe(), error => error instanceof WebSearchHTTPError && error.status === 401 && !error.message.includes('secret'));
  mode = 'not-json'; await assert.rejects(brave.probe(), SyntaxError);
  mode = '{"web":{"results":"bad"}}'; await assert.rejects(brave.probe(), /array/);
  mode = '{"web":{"results":[{"title":12}]}}'; await assert.rejects(brave.probe(), /string/);
  mode = '202'; await assert.rejects(client(t, {}, fixture.url).probe(), /rate-limiting/);
});

function frame(content) { return `data: ${JSON.stringify({ type: 'content_block_start', content_block: { type: 'web_search_tool_result', content } })}\n\n`; }
test('DeepSeek requests Anthropic streaming server tool, handles split frames, deduplicates and derives title', async t => {
  let request;
  const fixture = await server(t, async (req, res) => {
    request = { path: req.url, headers: req.headers, body: JSON.parse(await body(req)) };
    res.setHeader('Content-Type', 'text/event-stream');
    const data = frame([{ title: 'First', url: 'https://a.example/a' }, { title: '', url: 'https://b.example/b' }, { title: 'Duplicate', url: 'https://a.example/a' }, { error_code: 'max_uses_exceeded' }]);
    res.write(data.slice(0, 40)); setImmediate(() => res.end(data.slice(40) + 'data: [DONE]\n\n'));
  });
  const search = client(t, { backend: 'deepseek', deepSeekBaseURL: `${fixture.url}/anthropic`, deepSeekAPIKey: 'deep-key', deepSeekModel: 'profile-model' }, fixture.url);
  assert.deepEqual(await search.search('query', 15), [{ title: 'First', url: 'https://a.example/a', description: '', position: 1 }, { title: 'b.example', url: 'https://b.example/b', description: '', position: 2 }]);
  assert.equal(request.path, '/anthropic/v1/messages'); assert.equal(request.headers['x-api-key'], 'deep-key');
  assert.equal(request.headers['anthropic-version'], '2023-06-01'); assert.equal(request.body.stream, true); assert.equal(request.body.model, 'profile-model');
  assert.deepEqual(request.body.tools, [{ type: 'web_search_20250305', name: 'web_search', max_uses: 2 }]);
  assert.match(request.body.messages[0].content, /Search the web for: query/);
});

test('DeepSeek error-only stream fails, empty stream succeeds, and reaching limit cancels unfinished stream', async t => {
  let response = frame([{ error_code: 'max_uses_exceeded' }]), hang = false;
  const fixture = await server(t, (req, res) => { res.setHeader('Content-Type', 'text/event-stream'); res.write(response); if (!hang) res.end(); });
  const search = client(t, { backend: 'deepseek', deepSeekBaseURL: fixture.url, deepSeekAPIKey: 'k', deepSeekModel: 'm' }, fixture.url);
  await assert.rejects(search.search('q'), /max_uses_exceeded/);
  response = 'data: {"type":"error","error":{"message":"overloaded"}}\n\n'; await assert.rejects(search.search('q'), /overloaded/);
  response = 'data: [DONE]\n\n'; assert.deepEqual(await search.search('q'), []);
  response = frame([{ title: 'A', url: 'https://a.example' }, { title: 'B', url: 'https://b.example' }]); hang = true;
  assert.equal((await search.search('q', 1, AbortSignal.timeout(1000))).length, 1);
});

test('direct search ignores global dispatcher; explicit HTTP proxy receives authenticated search traffic', async t => {
  let proxied = false;
  const fixture = await server(t, (req, res) => res.end(JSON.stringify({ web: { results: [hit] } })));
  const proxy = await server(t, (req, res) => {
    proxied = true; assert.equal(req.headers['x-subscription-token'], 'local-key');
    assert.match(req.url, /^http:\/\/search\.invalid\/\?q=q&count=5$/);
    res.end(JSON.stringify({ web: { results: [hit] } }));
  });
  const original = getGlobalDispatcher(), blocked = new MockAgent(); blocked.disableNetConnect(); setGlobalDispatcher(blocked);
  try {
    assert.equal((await client(t, { backend: 'brave-free', braveAPIKey: 'local-key' }, fixture.url).search('q')).length, 1);
    assert.equal((await client(t, { backend: 'brave-free', braveAPIKey: 'local-key', proxy: proxy.url }, 'http://search.invalid/').search('q')).length, 1);
    assert.equal(proxied, true);
  } finally { setGlobalDispatcher(original); await blocked.close(); }
});

test('SOCKS5 proxy establishes real target connection and supports socks5h spelling', async t => {
  const fixture = await server(t, (req, res) => res.end(JSON.stringify({ results: [{ title: 'SOCKS', url: 'https://example.org', content: '' }] })));
  const sockets = new Set(); let destination;
  const proxy = net.createServer(socket => {
    sockets.add(socket); socket.on('close', () => sockets.delete(socket));
    let pending = Buffer.alloc(0), stage = 0;
    socket.on('data', function onData(chunk) {
      pending = Buffer.concat([pending, chunk]);
      if (stage === 0) {
        if (pending.length < 2 || pending.length < 2 + pending[1]) return;
        pending = pending.subarray(2 + pending[1]); socket.write(Buffer.from([5, 0])); stage = 1;
      }
      if (stage === 1) {
        if (pending.length < 5) return;
        const size = pending[3] === 1 ? 4 : pending[4];
        const offset = pending[3] === 1 ? 4 : 5;
        if (pending.length < offset + size + 2) return;
        const host = pending[3] === 1 ? [...pending.subarray(offset, offset + size)].join('.') : pending.subarray(offset, offset + size).toString();
        const port = pending.readUInt16BE(offset + size); destination = { host, port };
        const remaining = pending.subarray(offset + size + 2); stage = 2; socket.removeListener('data', onData);
        const upstream = net.connect(port, host, () => { socket.write(Buffer.from([5, 0, 0, 1, 127, 0, 0, 1, 0, 0])); if (remaining.length) upstream.write(remaining); socket.pipe(upstream); upstream.pipe(socket); });
        sockets.add(upstream); upstream.on('close', () => sockets.delete(upstream)); upstream.on('error', () => socket.destroy()); socket.on('close', () => upstream.destroy());
      }
    });
  });
  await new Promise(resolve => proxy.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => { for (const socket of sockets) socket.destroy(); proxy.close(resolve); }));
  const search = client(t, { backend: 'tavily', tavilyAPIKey: 'k', proxy: `socks5h://127.0.0.1:${proxy.address().port}` }, fixture.url);
  assert.equal((await search.search('q'))[0].title, 'SOCKS');
  assert.deepEqual(destination, { host: '127.0.0.1', port: fixture.instance.address().port });
});

test('caller cancellation aborts an outstanding response and oversized body fails', async t => {
  const controller = new AbortController(); let oversized = false;
  const fixture = await server(t, (req, res) => {
    if (oversized) res.end('x'.repeat((2 << 20) + 1));
    else { res.writeHead(200); res.write(' '); controller.abort(new Error('caller stopped')); }
  });
  const search = client(t, {}, fixture.url);
  await assert.rejects(search.search('q', 5, controller.signal), /caller stopped/);
  oversized = true; await assert.rejects(search.search('q'), /2 MiB/);
});
