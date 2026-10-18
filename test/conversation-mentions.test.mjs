import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
const built = await build({ entryPoints: ['src/conversation-workspace/mentions-store.ts'], bundle: true, platform: 'node', format: 'esm', write: false, packages: 'external' });
const { ChatMentionStore } = await import(`data:text/javascript;base64,${Buffer.from(built.outputFiles[0].text + '\n//# sourceURL=conversation-mentions.mjs').toString('base64')}`);
function fixture() {
  const state = { tasks: [{ id: 'task' }], companies: [{ id: 'company', name: '公司', description: '100% literal' }], scopes: [{ companyId: 'company', value: 'example.test' }],
    findings: [{ id: 'finding', taskId: 'task', vulnClass: 'SQL injection', severity: 'high', status: 'open', summary: 'evidence', assetIds: ['asset'] }],
    assets: [{ id: 'asset', taskId: 'task', kind: 'endpoint', value: 'https://example.test', companyId: 'company', metadata: { method: 'POST', url: 'https://example.test' } }] };
  return { state, mentions: new ChatMentionStore({ snapshot: () => structuredClone(state) }) };
}
test('mention snapshots resolve true typed identity and linked records, never supplied labels', async () => {
  const { mentions } = fixture();
  const finding = await mentions.load({ id: 'finding', kind: 'finding', name: 'forged' });
  assert.equal(finding.assets[0].id, 'asset');
  assert.equal((await mentions.load({ id: 'company', kind: 'company' })).scope[0].value, 'example.test');
  assert.equal((await mentions.load({ id: 'asset', kind: 'endpoint' })).company.name, '公司');
  assert.equal(await mentions.load({ id: 'asset', kind: 'ip' }), null);
  assert.equal(await mentions.load({ id: 'missing', kind: 'asset' }), null);
});
test('mention search uses literal substrings, typed asset labels, and bounded descriptions', () => {
  const { mentions, state } = fixture();
  assert.deepEqual(mentions.search({ query: '%' }).items.map(row => row.id), ['company']);
  assert.deepEqual(mentions.search({ query: '_' }).items, []);
  assert.equal(mentions.search({ scope: 'endpoint' }).items[0].label, 'POST https://example.test');
  assert.equal(mentions.search({ scope: 'asset' }).items[0].kind, 'endpoint');
  state.companies[0].description = '🙂'.repeat(300);
  assert.equal(Array.from(mentions.search({ scope: 'company' }).items[0].description).length, 240);
  assert.throws(() => mentions.search({ taskId: 'deleted' }), /任务不存在/);
});
test('mention paging has stable exact-first ordering and rejects a cursor from another search', () => {
  const { mentions, state } = fixture();
  state.companies = Array.from({ length: 44 }, (_, index) => ({ id: String(index + 1), name: '44 matching' }));
  const first = mentions.search({ query: '44', scope: 'company' });
  assert.equal(first.items.length, 20);
  assert.equal(first.items[0].id, '44');
  const second = mentions.search({ query: '44', scope: 'company', cursor: first.nextCursor });
  const third = mentions.search({ query: '44', scope: 'company', cursor: second.nextCursor });
  const ids = [...first.items, ...second.items, ...third.items].map(row => row.id);
  assert.equal(ids.length, 44); assert.equal(new Set(ids).size, 44); assert.equal(third.nextCursor, null);
  assert.throws(() => mentions.search({ query: 'changed', scope: 'company', cursor: first.nextCursor }), /游标/);
  assert.throws(() => mentions.search({ query: '44', scope: 'all', cursor: first.nextCursor }), /游标/);
  assert.throws(() => mentions.search({ cursor: '!' }), /游标/);
});
