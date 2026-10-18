import type { GraphNode, RedTeamSnapshot } from './types.js';

/** Keep graph views of domain records consistent with their authoritative rows. */
export function syncRecordGraph(state: RedTeamSnapshot): void {
  const nodes = new Map(state.nodes.map((node) => [node.id, node]));
  const put = (node: GraphNode) => {
    const previous = nodes.get(node.id);
    nodes.set(node.id, { ...node, data: { ...previous?.data, ...node.data } });
  };
  for (const asset of state.assets) put({ id: asset.id, taskId: asset.taskId, kind: 'asset', label: asset.value, data: { kind: asset.kind, source: asset.source, metadata: asset.metadata } });
  for (const evidence of state.evidence) put({ id: evidence.id, taskId: evidence.taskId, kind: 'evidence', label: evidence.summary, data: { provider: evidence.provider, target: evidence.target, command: evidence.command } });
  for (const intent of state.intents) put({ id: intent.id, taskId: intent.taskId, kind: 'intent', label: intent.summary, data: { state: intent.state, worker: intent.worker, input: intent.input, output: intent.output } });
  for (const finding of state.findings) put({ id: finding.id, taskId: finding.taskId, kind: 'finding', label: finding.summary, data: { severity: finding.severity, status: finding.status, vulnClass: finding.vulnClass } });
  state.nodes = [...nodes.values()];

  const relations = new Set(state.edges.map((edge) => JSON.stringify([edge.taskId, edge.from, edge.to, edge.relation])));
  for (const finding of state.findings) {
    if (finding.intentId && state.intents.some(intent => intent.id === finding.intentId && intent.taskId === finding.taskId)) {
      const key = JSON.stringify([finding.taskId, finding.intentId, finding.id, 'yields']);
      if (!relations.has(key)) {
        state.edges.push({ id: `finding:${finding.id}:yields:${finding.intentId}`, taskId: finding.taskId, from: finding.intentId, to: finding.id, relation: 'yields' });
        relations.add(key);
      }
    }
    for (const [ids, relation] of [[finding.assetIds, 'affects'], [finding.evidenceIds, 'supported_by']] as const) {
      for (const to of ids) {
        const key = JSON.stringify([finding.taskId, finding.id, to, relation]);
        if (relations.has(key)) continue;
        state.edges.push({ id: `finding:${finding.id}:${relation}:${to}`, taskId: finding.taskId, from: finding.id, to, relation });
        relations.add(key);
      }
    }
  }
}
