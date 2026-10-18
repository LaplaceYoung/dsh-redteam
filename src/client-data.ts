import type { GraphNode, RedTeamSnapshot } from './types.js';

export const nodeKinds: GraphNode['kind'][] = ['asset', 'intent', 'fact', 'finding', 'evidence'];
export const kindLabels: Record<GraphNode['kind'], string> = { asset: '资产', intent: '意图', fact: '事实', finding: '发现', evidence: '证据' };

export function matchesQuery(values: unknown[], query: string): boolean {
  const words = query.toLocaleLowerCase().trim().split(/\s+/).filter(Boolean);
  const text = values.map(value => typeof value === 'string' ? value : JSON.stringify(value)).join(' ').toLocaleLowerCase();
  return words.every(word => text.includes(word));
}

export function filterTask<T extends { taskId?: string }>(rows: T[], taskId: string): T[] {
  return taskId ? rows.filter(row => row.taskId === taskId) : rows;
}

/** Columns preserve the domain kind; every matching node remains reachable by scrolling. */
export function layoutGraph(nodes: GraphNode[]) {
  const columns = nodeKinds.filter(kind => nodes.some(node => node.kind === kind));
  const counts = new Map<string, number>();
  const positions = new Map<string, { x: number; y: number }>();
  for (const node of nodes) {
    const row = counts.get(node.kind) ?? 0;
    positions.set(node.id, { x: 18 + columns.indexOf(node.kind) * 200, y: 42 + row * 66 });
    counts.set(node.kind, row + 1);
  }
  return { columns, positions, width: Math.max(220, columns.length * 200 + 18), height: Math.max(124, ...[...counts.values()].map(count => count * 66 + 56)) };
}

export function graphRelations(snapshot: RedTeamSnapshot, node: GraphNode) {
  const nodes = new Map(snapshot.nodes.filter(item => item.taskId === node.taskId).map(item => [item.id, item]));
  return snapshot.edges.filter(edge => edge.taskId === node.taskId && (edge.from === node.id || edge.to === node.id)).map(edge => ({
    edge,
    direction: edge.from === node.id ? 'out' as const : 'in' as const,
    node: nodes.get(edge.from === node.id ? edge.to : edge.from),
    targetId: edge.from === node.id ? edge.to : edge.from,
  }));
}

export function graphRecord(snapshot: RedTeamSnapshot, node: GraphNode): unknown {
  const rows = node.kind === 'asset' ? snapshot.assets : node.kind === 'intent' ? snapshot.intents : node.kind === 'finding' ? snapshot.findings : node.kind === 'evidence' ? snapshot.evidence : [];
  return rows.find(row => row.id === node.id && row.taskId === node.taskId) ?? node.data;
}
