import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { build } from 'esbuild';
const bundle = await build({ entryPoints: ['src/system-runtime/settings.ts'], bundle: true, write: false, platform: 'node', format: 'esm', packages: 'external' });
const { SystemSettingsStore, selectPromptConstraints } = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString('base64')}`);

test('settings persist partial updates and expose only key presence', async t => {
  const root = await mkdtemp(join(tmpdir(), 'system-settings-')); t.after(() => rm(root, { recursive: true, force: true }));
  const path = join(root, 'settings.json'), store = new SystemSettingsStore(path);
  const initial = await store.load();
  assert.equal(initial.web_search_backend, 'ddgs'); assert.equal(initial.web_search_enabled, false);
  assert.equal(initial.constraints_inject_worker, true); assert.equal(initial.noa_compaction, false);
  const saved = await store.update({ brave_search_api_key: 'brave-secret', tavily_search_api_key: 'tavily-secret', web_search_proxy: ' http://127.0.0.1:8000 ', web_search_enabled: true });
  assert.equal(saved.brave_key_set, true); assert.equal(JSON.stringify(saved).includes('secret'), false);
  await store.update({ brave_search_api_key: null, web_search_backend: 'tavily' });
  assert.equal(store.searchConfig().braveAPIKey, 'brave-secret');
  assert.equal(store.searchConfig().proxy, 'http://127.0.0.1:8000');
  const restored = new SystemSettingsStore(path); await restored.load();
  assert.equal(restored.searchConfig().tavilyAPIKey, 'tavily-secret');
  await restored.update({ brave_search_api_key: '', tavily_search_api_key: '', web_search_proxy: '' });
  assert.equal(restored.snapshot().brave_key_set, false); assert.equal(restored.snapshot().tavily_key_set, false);
  assert.equal((await readFile(path, 'utf8')).includes('secret'), false);
});

test('concurrent independent settings stores preserve unrelated updates and reject invalid input atomically', async t => {
  const root = await mkdtemp(join(tmpdir(), 'system-settings-')); t.after(() => rm(root, { recursive: true, force: true }));
  const path = join(root, 'settings.json'), a = new SystemSettingsStore(path), b = new SystemSettingsStore(path);
  await Promise.all([a.load(), b.load()]);
  await Promise.all([a.update({ llm_pool_enabled: true }), b.update({ constraints_inject_planner: false })]);
  assert.equal(a.snapshot().constraints_inject_planner, false);
  assert.equal(b.snapshot().llm_pool_enabled, true);
  await a.load(); assert.equal(a.snapshot().llm_pool_enabled, true); assert.equal(a.snapshot().constraints_inject_planner, false);
  for (const patch of [{ global_proxy: 'http://localhost' }, { web_search_backend: 'unknown' }, { web_search_proxy: 'file:///secret' }, { noa_compaction: 'true' }, { toString: 'bad' }]) assert.throws(() => a.update(patch));
  assert.equal(a.snapshot().noa_compaction, false);
  await writeFile(path, '{ broken'); await assert.rejects(() => b.load(), SyntaxError);
});

test('constraint switches apply per role on next read without changing stored constraints or scopes', () => {
  const settings = { constraints_inject_planner: true, constraints_inject_worker: true };
  const rows = [{ taskId: 'a', kind: 'deny', text: 'no write' }, { taskId: 'b', kind: 'allow', text: 'other' }, { taskId: 'a', kind: 'allow', text: 'read only' }];
  assert.deepEqual(selectPromptConstraints(settings, rows, 'a', 'planner').map(x => x.text), ['read only', 'no write']);
  settings.constraints_inject_planner = false;
  assert.deepEqual(selectPromptConstraints(settings, rows, 'a', 'planner'), []);
  assert.equal(selectPromptConstraints(settings, rows, 'a', 'worker').length, 2);
  assert.equal(rows.length, 3); assert.equal(rows[0].text, 'no write');
});
