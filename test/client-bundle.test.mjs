import test from 'node:test';
import assert from 'node:assert/strict';
import { loadClientModule } from './client-module.mjs';

test('client bundle registers a DSH lazy module with the redteam tab entry', async () => {
  const { definition, exported: exports } = await loadClientModule();
  assert.equal(definition.id, 'dsh-redteam');
  assert.equal(typeof exports.apply, 'function');
  assert.deepEqual(Array.from(exports.inject), ['betterSidebar']);
  const tabs = [];
  exports.apply({ betterSidebar: { registerTab(tab) { tabs.push(tab); return () => {}; } }, effect(effect) { return effect(); } });
  assert.deepEqual(tabs.map((tab) => tab.id), ['dsh-redteam:tasks', 'dsh-redteam:assets', 'dsh-redteam:findings', 'dsh-redteam:traffic', 'dsh-redteam:activity', 'dsh-redteam:report', 'dsh-redteam:approvals', 'dsh-redteam:asset-management', 'dsh-redteam:system', 'dsh-redteam:observability', 'dsh-redteam:conversations', 'dsh-redteam:platform', 'dsh-redteam:host']);
});
