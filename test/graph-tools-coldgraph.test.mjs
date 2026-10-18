import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { ColdGraph, blockSignature } from '../lib/graph-tools/coldgraph.js';

const intent = (id, state = 'done') => ({ id: String(id), kind: 'intent', state });
const fact = id => ({ id: String(id), kind: 'fact', state: 'confirmed' });
const edge = (from, to, relation = 'yields') => ({ from: String(from), to: String(to), relation });
const stamps = (...ids) => new Map(ids.map(id => [String(id), 1]));
const sorted = set => [...set].sort();

// Independent topology expectations from ARTEX agent/coldgraph_test.go.
test('ARTEX snapshot 1: any live branch retains ancestors, but a settled sibling leaf is cold', () => {
  const graph = new ColdGraph([intent(1), intent(2), fact(3), intent(4, 'running')], [edge(1, 2, 'derived_from'), edge(2, 3), edge(2, 4, 'derived_from')]);
  assert.deepEqual(sorted(graph.hotSet()), ['1', '2', '4']);
  assert.deepEqual([...graph.structuralCold()], ['3']);
  assert.deepEqual(graph.groupBlocks(graph.eligibleCold(graph.structuralCold(), stamps(3), 100)), []);
});

test('ARTEX snapshot 2: fully settled connected chain becomes one block', () => {
  const graph = new ColdGraph([intent(1), intent(2), fact(3), intent(4)], [edge(1, 2, 'derived_from'), edge(2, 3), edge(2, 4, 'derived_from')]);
  assert.deepEqual([...graph.hotSet()], []);
  assert.deepEqual(graph.groupBlocks(graph.eligibleCold(graph.structuralCold(), stamps(1, 2, 3, 4), 100)), [{ members: ['1', '2', '3', '4'], anchors: [] }]);
});

test('ARTEX debounce: exactly six rounds required, null and absent stamps never qualify', () => {
  const graph = new ColdGraph([intent(1), fact(2), fact(3), fact(4)], [edge(1, 2)]);
  const cold = graph.structuralCold();
  const clock = new Map([['1', 98], ['2', 98], ['3', null]]);
  assert.deepEqual([...graph.eligibleCold(cold, clock, 100)], []);
  assert.deepEqual([...graph.eligibleCold(cold, clock, 104)], ['1', '2']);
  assert.deepEqual([...graph.eligibleCold(cold, new Map([['1', 0]]), 6)], ['1'], 'round zero is a real stamp');
});

test('ARTEX flat fanout: settled hot hub anchors four cold leaves without becoming a member', () => {
  const graph = new ColdGraph([intent(50, 'exhausted'), intent(77, 'running'), ...[51, 52, 53, 54].map(fact)], [edge(50, 77, 'derived_from'), ...[51, 52, 53, 54].map(id => edge(50, id))]);
  assert.deepEqual(sorted(graph.hotSet()), ['50', '77']);
  assert.deepEqual(graph.groupBlocks(graph.eligibleCold(graph.structuralCold(), stamps(51, 52, 53, 54), 100)), [{ members: ['51', '52', '53', '54'], anchors: ['50'] }]);
});

test('ARTEX singleton: a lone cold leaf under an ancestor-hot settled hub stays unfolded', () => {
  const graph = new ColdGraph([intent(50), intent(77, 'running'), fact(51)], [edge(50, 77, 'derived_from'), edge(50, 51)]);
  assert.deepEqual([...graph.structuralCold()], ['51']);
  assert.deepEqual(graph.groupBlocks(graph.eligibleCold(graph.structuralCold(), stamps(51), 100)), []);
});

test('ARTEX stamps: stamp first cooling, preserve age, clear revived and stale entries', () => {
  const graph = new ColdGraph([fact(1), fact(2), intent(3, 'running')], []);
  const result = graph.computeStampOps(graph.structuralCold(), new Map([['2', 5], ['3', 4], ['removed', 1]]), 10);
  assert.deepEqual(result, [{ id: '1', set: true, round: 10 }, { id: '3', set: false }, { id: 'removed', set: false }]);
});

test('ARTEX signature: exact member and anchor encoding, both version changes invalidate body', () => {
  const block = { members: ['12', '28', '41'], anchors: ['50'] };
  const versions = new Map([['12', 0], ['28', 0], ['41', 0], ['50', 0]]);
  const original = blockSignature(block, versions);
  assert.equal(original, createHash('sha256').update('m:12:0;m:28:0;m:41:0;a:50:0;').digest('hex'));
  assert.equal(original, blockSignature(block, new Map()));
  versions.set('28', 1);
  assert.notEqual(original, blockSignature(block, versions));
  versions.set('28', 0);
  versions.set('50', 1);
  assert.notEqual(original, blockSignature(block, versions));
});

test('sibling rescue does not merge pre-existing components and preserves append order', () => {
  const nodes = [intent('hub-z'), intent('hub-a'), intent('live', 'paused'), fact('z-first'), fact('a-second'), fact('y-third'), fact('b-fourth')];
  const edges = [edge('hub-z', 'live'), edge('hub-a', 'live'), edge('hub-z', 'z-first'), edge('hub-z', 'a-second'), edge('z-first', 'a-second'), edge('hub-z', 'y-third'), edge('hub-a', 'y-third'), edge('hub-z', 'b-fourth')];
  const graph = new ColdGraph(nodes, edges);
  const expected = [{ members: ['z-first', 'a-second'], anchors: ['hub-z'] }, { members: ['y-third', 'b-fourth'], anchors: ['hub-z', 'hub-a'] }];
  assert.deepEqual(graph.groupBlocks(new Set(['b-fourth', 'y-third', 'a-second', 'z-first'])), expected);
  assert.deepEqual(new ColdGraph(nodes, [...edges].reverse()).groupBlocks(graph.structuralCold()), expected);
});

test('live intents retain only direct children; special kinds and digest causality never fold', () => {
  const nodes = [intent('live', 'open'), fact('child'), fact('grandchild'), fact('cold'), ...['goal', 'finding', 'hint', 'begin', 'digest'].map(kind => ({ id: kind, kind }))];
  const graph = new ColdGraph(nodes, [edge('live', 'child'), edge('child', 'grandchild'), edge('cold', 'digest'), edge('digest', 'live'), edge('live', 'cold', 'covers'), edge('missing', 'cold')]);
  assert.deepEqual(sorted(graph.hotSet()), ['child', 'live']);
  assert.deepEqual([...graph.structuralCold()], ['grandchild', 'cold']);
  assert.deepEqual(graph.groupBlocks(graph.structuralCold()), []);
});

test('cyclic and deep causal chains terminate and mark every live ancestor', () => {
  const nodes = Array.from({ length: 15000 }, (_, i) => intent(String(i), i === 14999 ? 'paused' : 'done'));
  const edges = nodes.slice(1).map((node, i) => edge(String(i), node.id));
  edges.push(edge('14999', '0'));
  const graph = new ColdGraph(nodes, edges);
  assert.equal(graph.hotSet().size, 15000);
  assert.equal(graph.structuralCold().size, 0);
});

test('ARTEX commit recheck drops revived members, preserves anchors, skips blocks below K', () => {
  const block = { members: ['a', 'b', 'c'], anchors: ['old-anchor'] };
  const graph = new ColdGraph([intent('a', 'running'), fact('b'), fact('c')], []);
  assert.deepEqual(graph.filterAtCommit(block), { members: ['b', 'c'], anchors: ['old-anchor'] });
  const revived = new ColdGraph([intent('a', 'running'), fact('b'), fact('c')], [edge('a', 'b')]);
  assert.equal(revived.filterAtCommit(block), null);
  assert.deepEqual(block, { members: ['a', 'b', 'c'], anchors: ['old-anchor'] });
});
