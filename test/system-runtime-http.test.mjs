import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { build } from 'esbuild';
const built = await build({ entryPoints: ['src/system-runtime/http.ts'], bundle: true, write: false, platform: 'node', format: 'esm', packages: 'external' });
const code = built.outputFiles[0].text.replaceAll('import.meta.url', JSON.stringify(import.meta.url)).replace(/from\s+(["'])([^"']+)\1/g, (_m, _q, specifier) => `from ${JSON.stringify(import.meta.resolve(specifier))}`);
const { installSystemRuntimeHttp } = await import(`data:text/javascript;base64,${Buffer.from(code + '\n//# sourceURL=system-runtime-http.bundle.mjs').toString('base64')}`);

test('owner-only HTTP works before any Agent/tool installation and never returns saved search secrets', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'system-http-')); t.after(() => rm(dir, { recursive: true, force: true }));
  let handler;
  const ctx = { effect: () => {}, webServer: { register(route) { handler = route.handler; return () => {}; } } };
  const store = { storagePath: join(dir, 'store.json'), snapshot: () => ({ constraints: [] }) };
  const installation = installSystemRuntimeHttp(ctx, store, { profiles: { list: async () => ({ profiles: [], activeProfileId: null }) }, authenticate: request => request.headers.authorization === 'Bearer owner' ? true : request.headers.authorization ? 403 : 401 });
  await installation.ready; t.after(() => installation.dispose());
  const server = createServer((req, res) => { void handler(req, res); }); server.listen(0, '127.0.0.1'); await once(server, 'listening'); t.after(() => new Promise(resolve => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}/api/redteam/system`;
  const request = (path, method = 'GET', value, extra = {}) => fetch(base + path, { method, headers: { authorization: 'Bearer owner', ...(value === undefined ? {} : { 'content-type': 'application/json' }), ...extra }, body: value === undefined ? undefined : JSON.stringify(value) });
  assert.equal((await fetch(base + '/settings')).status, 401);
  assert.equal((await request('/settings', 'GET', undefined, { authorization: 'Bearer peer' })).status, 403);
  assert.equal((await request('/settings', 'PUT', { noa_compaction: true }, { origin: 'https://evil.invalid' })).status, 403);
  let response = await request('/settings'); const initial = await response.json(); assert.equal(initial.noa_compaction, false);
  response = await request('/settings', 'PUT', { brave_search_api_key: 'secret-value', web_search_enabled: true });
  const saved = await response.json(); assert.equal(response.status, 200); assert.equal(saved.brave_key_set, true); assert.equal(JSON.stringify(saved).includes('secret-value'), false);
  response = await request('/settings'); assert.equal(JSON.stringify(await response.json()).includes('secret-value'), false);
  assert.equal((await request('/settings', 'PUT', { global_proxy: 'http://local.invalid' })).status, 400);
  assert.equal((await request('/settings', 'PUT', { web_search_enabled: 'yes' })).status, 400);
  assert.equal((await request('/model-policy/unknown')).status, 404);
  assert.equal((await request('/model-health/reset', 'POST', {})).status, 200);
  assert.equal((await request('/web-search/test', 'POST', { unsupported: true })).status, 400);
  assert.equal((await request('/model-test/unknown', 'POST', {})).status, 404);
  assert.equal((await request('/settings', 'DELETE')).status, 405);
  const retry = await (await request('/model-retry')).json(); retry.connect = { attempts: 2, interval_ms: 100 };
  assert.equal((await request('/model-retry', 'PUT', retry)).status, 200);
  assert.equal((await (await request('/model-retry')).json()).connect.attempts, 2);
});

test('HTTP probe uses real local backend protocol and tests draft proxy without saving draft credentials', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'system-http-search-')); t.after(() => rm(dir, { recursive: true, force: true }));
  let usedKey;
  const backend = createServer((req, res) => { usedKey = req.headers['x-subscription-token']; res.end(JSON.stringify({ web: { results: [{ title: 'local', url: 'https://local.invalid', description: 'fixture' }] } })); });
  backend.listen(0, '127.0.0.1'); await once(backend, 'listening'); t.after(() => new Promise(resolve => backend.close(resolve)));
  let handler;
  const installation = installSystemRuntimeHttp({ effect: () => {}, webServer: { register(route) { handler = route.handler; return () => {}; } } }, { storagePath: join(dir, 'store.json'), snapshot: () => ({ constraints: [] }) }, {
    profiles: { list: async () => ({ profiles: [], activeProfileId: null }) }, authenticate: () => true,
    search: { endpoints: { 'brave-free': `http://127.0.0.1:${backend.address().port}/search` } },
  });
  await installation.ready; t.after(() => installation.dispose());
  await installation.runtime.settings.update({ web_search_backend: 'brave-free', brave_search_api_key: 'saved', web_search_proxy: 'http://127.0.0.1:1' });
  const server = createServer((req, res) => { void handler(req, res); }); server.listen(0, '127.0.0.1'); await once(server, 'listening'); t.after(() => new Promise(resolve => server.close(resolve)));
  const response = await fetch(`http://127.0.0.1:${server.address().port}/api/redteam/system/web-search/test`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ brave_search_api_key: 'draft' }) });
  assert.equal(response.status, 200); assert.equal((await response.json()).ok, true); assert.equal(usedKey, 'draft');
  assert.equal(installation.runtime.settings.searchConfig().braveAPIKey, 'saved');
  assert.equal(installation.runtime.settings.searchConfig().proxy, 'http://127.0.0.1:1');
});
