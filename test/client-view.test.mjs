import test from 'node:test';
import assert from 'node:assert/strict';
import { loadClientModule } from './client-module.mjs';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { filterTask, graphRelations, layoutGraph, matchesQuery } from '../lib/client-data.js';
import { clientFixture } from './client-fixtures.mjs';

async function tabs() {
  const { exported } = await loadClientModule();
  const tabs = [];
  exported.apply({ effect(effect) { return effect(); }, betterSidebar: { registerTab(tab) { tabs.push(tab); return () => {}; } } });
  return new Map(tabs.map(tab => [tab.id, tab]));
}
function render(tab, snapshot) { return renderToStaticMarkup(React.createElement(tab.component, { visible: false, tab: { type: tab.id, meta: { snapshot } } })); }

test('graph layout keeps all 120 nodes reachable and separates kinds', () => {
  const nodes = Array.from({ length: 120 }, (_, index) => ({ id: `n${index}`, taskId: 't', kind: index % 2 ? 'asset' : 'intent', label: `node ${index}`, data: {} }));
  const layout = layoutGraph(nodes);
  assert.equal(layout.positions.size, 120);
  assert.notEqual(layout.positions.get('n0').x, layout.positions.get('n1').x);
  assert.ok(layout.height > layout.positions.get('n119').y + 46);
  assert.equal(new Set([...layout.positions.values()].map(position => `${position.x},${position.y}`)).size, 120);
});

test('task filtering and multiword search do not expose records from another task', () => {
  const data = clientFixture();
  assert.equal(filterTask(data.traffic, 'task-a').length, 44);
  assert.equal(filterTask(data.traffic, 'task-b')[0].id, 'traffic-44');
  assert.equal(matchesQuery(['GET', 'http://local.example.test/path/7'], 'get PATH/7'), true);
  assert.equal(matchesQuery(['GET', 'http://local.example.test/path/7'], 'POST PATH/7'), false);
});

test('graph relation details identify direction and resolve actual node labels', () => {
  const data = clientFixture();
  const relations = graphRelations(data, data.nodes[1]);
  assert.deepEqual(relations.map(item => [item.direction, item.edge.relation, item.node.label]), [['out', 'affects', 'local.example.test'], ['out', 'supported_by', '本地响应样例']]);
  assert.equal(graphRelations(data, data.nodes[0])[0].direction, 'in');
});

test('actual client module renders accessible graph and complete record browsers', async () => {
  const registered = await tabs();
  const data = clientFixture();
  const graph = render(registered.get('dsh-redteam:assets'), data);
  assert.match(graph, /aria-label="筛选任务"/);
  assert.match(graph, /role="button"[^>]*aria-label="资产：local.example.test"/);
  assert.match(graph, /aria-label="图例"/);
  assert.match(graph, /class="rt-edge-label"/);
  assert.match(graph, /role="group"[^>]*aria-label="可滚动资产图"/);
  const findings = render(registered.get('dsh-redteam:findings'), data);
  assert.match(findings, /fixture-response-body/);
  assert.match(findings, /关联资产/);
  const traffic = render(registered.get('dsh-redteam:traffic'), data);
  assert.match(traffic, /fixture-body-0/);
  assert.match(traffic, /下一页/);
  assert.equal((traffic.match(/class="rt-card"/g) ?? []).length, 40);
  const activity = render(registered.get('dsh-redteam:activity'), data);
  assert.match(activity, /样例审批事件/);
  assert.match(activity, /fixture-tool-result/);
  const report = render(registered.get('dsh-redteam:report'), data);
  assert.match(report, /REPORT_END_MARKER/);
  assert.match(report, /下载 Markdown/);
});
