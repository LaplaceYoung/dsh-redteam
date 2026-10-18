import { createHash } from 'node:crypto';
import type { GraphNode, RedTeamSnapshot } from '../types.js';

export function graphKind(node: GraphNode): string {
  if (node.kind === 'fact' && (node.data.hint === true || node.data.kind === 'strategic_hint')) return 'hint';
  if (node.kind === 'fact' && node.data.kind === 'digest') return 'digest';
  return node.kind;
}
export function graphState(node: GraphNode): string {
  if (typeof node.data.state === 'string') return node.data.state;
  if (typeof node.data.status === 'string') return node.data.status;
  return graphKind(node) === 'hint' ? 'active' : 'confirmed';
}
function stable(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => [key, stable(item)]));
  return value;
}
/** Bookkeeping cannot itself advance the content version. */
export function nodeFingerprint(node: GraphNode): string {
  const { content_version: _version, content_hash: _hash, cold_since_round: _stamp, ...data } = node.data;
  return createHash('sha256').update(JSON.stringify(stable({ kind: graphKind(node), label: node.label, data }))).digest('hex');
}
/** Old imported digests have no fingerprints; retain their existing read contract. */
export function digestIsCurrent(state: RedTeamSnapshot, digest: GraphNode): boolean {
  const fingerprints = digest.data.source_fingerprints;
  if (fingerprints === undefined) return true;
  if (!fingerprints || typeof fingerprints !== 'object' || Array.isArray(fingerprints)) return false;
  return Object.entries(fingerprints).every(([id, hash]) => {
    const node = state.nodes.find(node => node.taskId === digest.taskId && node.id === id);
    return node !== undefined && typeof hash === 'string' && nodeFingerprint(node) === hash;
  });
}
export function supersedeDigests(state: RedTeamSnapshot, ids: ReadonlySet<string>): void {
  for (const node of state.nodes) if (ids.has(node.id) && graphKind(node) === 'digest') node.data.state = 'superseded';
  state.edges = state.edges.filter(edge => edge.relation !== 'covers' || !ids.has(edge.from));
}
