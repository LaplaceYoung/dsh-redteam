import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { build } from 'esbuild';

async function sourceModule(path) {
  const bundle = await build({ entryPoints: [path], bundle: true, write: false, platform: 'node', format: 'esm', packages: 'external' });
  const source = bundle.outputFiles[0].text.replace(/from "([^".][^"]*)"/g, (_all, specifier) => `from ${JSON.stringify(import.meta.resolve(specifier))}`);
  return import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);
}
const { createDeepSeekCredentialResolver } = await sourceModule('src/system-runtime/host-profile-adapter.ts');
const { WebSearchClient } = await sourceModule('src/system-runtime/web-search.ts');

function fixture({ provider = 'deepseek-official', value = {}, path = [], namespace = 'custom-provider-entry', metadata = {} } = {}) {
  const state = { activeProfileId: 'active', profiles: [{ id: 'active', provider, model: 'deepseek-model' }] };
  const values = new Map(), records = new Map(), environment = new Map();
  const refs = [], recordKeys = [], describeOptions = [];
  const section = { ns: namespace, value };
  const directory = [{ provider, settingsNs: namespace, settingsPath: path, ...metadata }];
  const services = {
    llm: { listConfigurableProviders: () => directory },
    settings: { describe: options => { describeOptions.push(options); return [section]; } },
    credentials: {
      resolve: async ref => { refs.push(ref); const value = values.get(ref); return value === undefined ? undefined : { value, source: 'fixture' }; },
      readRecord: async key => { recordKeys.push(key); return records.get(key); },
    },
    launchEnvironment: { get: name => { const value = environment.get(name); return value === undefined ? undefined : { value, source: 'process' }; } },
  };
  const resolve = createDeepSeekCredentialResolver({ get: name => services[name] }, { list: async () => state });
  return { resolve, state, values, records, environment, refs, recordKeys, describeOptions, section, directory, services };
}

test('official profile resolves exact apiKeyEnv contract, provider defaults and fresh rotations', async () => {
  const f = fixture(); f.values.set('DEEPSEEK_API_KEY', 'fixture-first');
  assert.deepEqual(await f.resolve(), { deepSeekBaseURL: 'https://api.deepseek.com/anthropic', deepSeekAPIKey: 'fixture-first', deepSeekModel: 'deepseek-model' });
  f.section.value = { apiKeyEnv: 'CUSTOM_KEY', baseURL: 'http://localhost/anthropic' };
  f.values.set('CUSTOM_KEY', 'fixture-rotated'); f.state.profiles[0].model = 'rotated-model';
  assert.deepEqual(await f.resolve(), { deepSeekBaseURL: 'http://localhost/anthropic', deepSeekAPIKey: 'fixture-rotated', deepSeekModel: 'rotated-model' });
  assert.deepEqual(f.refs, ['DEEPSEEK_API_KEY', 'CUSTOM_KEY']);
  assert.deepEqual(f.describeOptions, [{ redactSecrets: false }, { redactSecrets: false }]);
  assert.deepEqual(f.recordKeys, []);
});

test('official endpoint and no-credentials fallback use launcher snapshot, without arbitrary process reads', async () => {
  const f = fixture(); f.environment.set('DEEPSEEK_BASE_URL', 'http://localhost/messages-root'); f.environment.set('DEEPSEEK_API_KEY', 'launcher-key');
  await assert.rejects(f.resolve(), /no API key/); // Present credential service owns reference resolution.
  delete f.services.credentials;
  assert.equal((await f.resolve()).deepSeekAPIKey, 'launcher-key'); assert.equal((await f.resolve()).deepSeekBaseURL, 'http://localhost/messages-root');
});

test('Pi AI reads explicit ref first and never substitutes stored credentials for missing ref', async () => {
  const f = fixture({ provider: 'gateway', value: { providers: { gateway: { apiKeyEnv: 'EXPLICIT', baseURL: 'http://localhost/api' } } }, path: ['providers', 'gateway'] });
  f.records.set('llm-pi-ai/gateway', { kind: 'api-key', key: 'stored-key' });
  await assert.rejects(f.resolve(), /no API key/); assert.deepEqual(f.recordKeys, []);
  f.values.set('EXPLICIT', 'reference-key'); assert.equal((await f.resolve()).deepSeekAPIKey, 'reference-key');
  assert.deepEqual(f.recordKeys, []);
});

test('Pi AI record owner remains llm-pi-ai with renamed settings namespace; stored key wins native env', async () => {
  const f = fixture({ provider: 'deepseek', value: { providers: { deepseek: {} } }, path: ['providers', 'deepseek'], metadata: { defaultBaseURL: 'http://localhost/anthropic', nativeAuth: { env: ['FIRST_KEY', 'SECOND_KEY'], oauth: false } } });
  f.records.set('llm-pi-ai/deepseek', { kind: 'api-key', key: 'stored-key' }); f.values.set('FIRST_KEY', 'env-key');
  assert.equal((await f.resolve()).deepSeekAPIKey, 'stored-key'); assert.deepEqual(f.recordKeys, ['llm-pi-ai/deepseek']); assert.deepEqual(f.refs, []);
  f.records.delete('llm-pi-ai/deepseek'); f.values.delete('FIRST_KEY'); f.environment.set('SECOND_KEY', 'second-launcher-key');
  assert.equal((await f.resolve()).deepSeekAPIKey, 'second-launcher-key'); assert.deepEqual(f.refs, ['FIRST_KEY', 'SECOND_KEY']);
});

test('OAuth/account auth, missing active profile, unknown layouts and invalid key never become a fake API key', async () => {
  const f = fixture({ provider: 'gateway', value: { providers: { gateway: { baseURL: 'http://localhost' } } }, path: ['providers', 'gateway'], metadata: { nativeAuth: { env: ['FALLBACK'], oauth: true } } });
  f.records.set('llm-pi-ai/gateway', { kind: 'grant', payload: { token: 'opaque-fixture' } }); f.values.set('FALLBACK', 'must-not-fallback');
  await assert.rejects(f.resolve(), /OAuth grant/); assert.deepEqual(f.refs, []);
  await assert.rejects(fixture({ provider: 'deepseek-account' }).resolve(), /account authentication/);
  const missing = fixture(); missing.state.activeProfileId = null; await assert.rejects(missing.resolve(), /active global/);
  await assert.rejects(fixture({ provider: 'unknown' }).resolve(), /supported DSH/);
  const invalid = fixture({ value: { apiKeyEnv: 'secret\ninvalid' } });
  await assert.rejects(invalid.resolve(), error => /credential reference/.test(error.message) && !error.message.includes('secret'));
  const malformed = fixture(); malformed.values.set('DEEPSEEK_API_KEY', 'secret\ninvalid');
  await assert.rejects(malformed.resolve(), error => /header/.test(error.message) && !error.message.includes('secret'));
});

test('provider settings lookup and base URL errors propagate without guessing composite environment endpoints', async () => {
  const missing = fixture(); missing.section.ns = 'other'; await assert.rejects(missing.resolve(), /namespace/);
  const malformed = fixture({ value: { apiKeyEnv: 12 } }); await assert.rejects(malformed.resolve(), /apiKeyEnv must be a string/);
  const f = fixture({ provider: 'gateway', value: { providers: { gateway: {} } }, path: ['providers', 'gateway'], metadata: { baseURLEnv: ['AZURE_OPENAI_BASE_URL', 'AZURE_OPENAI_RESOURCE_NAME'] } });
  f.records.set('llm-pi-ai/gateway', { kind: 'api-key', key: 'local-key' }); f.environment.set('AZURE_OPENAI_RESOURCE_NAME', 'resource');
  await assert.rejects(f.resolve(), /explicit baseURL/);
  f.section.value.providers.gateway.baseURL = 'http://localhost'; assert.equal((await f.resolve()).deepSeekBaseURL, 'http://localhost');
  f.section.value.providers.gateway.baseURL = 'http://user:secret@localhost';
  await assert.rejects(f.resolve(), error => /without credentials/.test(error.message) && !error.message.includes('secret'));
});

test('resolved active profile drives a real local DeepSeek messages request', async t => {
  let received;
  const server = http.createServer(async (req, res) => {
    let body = ''; for await (const chunk of req) body += chunk;
    received = { path: req.url, key: req.headers['x-api-key'], body: JSON.parse(body) };
    res.setHeader('Content-Type', 'text/event-stream');
    res.end(`data: ${JSON.stringify({ type: 'content_block_start', content_block: { type: 'web_search_tool_result', content: [{ title: 'Local', url: 'https://example.org' }] } })}\n\n`);
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => { server.closeAllConnections(); server.close(resolve); }));
  const f = fixture({ value: { baseURL: `http://127.0.0.1:${server.address().port}/anthropic`, apiKeyEnv: 'LOCAL_SEARCH_KEY' } });
  f.values.set('LOCAL_SEARCH_KEY', 'local-fixture-key');
  const client = new WebSearchClient({ backend: 'deepseek', ...await f.resolve() });
  try { assert.equal((await client.probe())[0].title, 'Local'); } finally { await client.close(); }
  assert.equal(received.path, '/anthropic/v1/messages'); assert.equal(received.key, 'local-fixture-key'); assert.equal(received.body.model, 'deepseek-model');
});
