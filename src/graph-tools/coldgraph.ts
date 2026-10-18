import { createHash } from 'node:crypto';

/** Pure ARTEX coldgraph.go view. Node order replaces ARTEX's increasing numeric IDs. */
export interface ColdNode {
  id: string;
  kind: string;
  state?: string;
  contentVersion?: number;
}
export interface ColdEdge { from: string; to: string; relation: string }
export interface ColdBlock { members: string[]; anchors: string[] }
export interface StampOp { id: string; set: boolean; round?: number }
export type ColdStamps = ReadonlyMap<string, number | null | undefined>;

export function isLiveIntent(node: ColdNode): boolean {
  return node.kind === 'intent' && (node.state === 'open' || node.state === 'running' || node.state === 'paused');
}

export function foldableKind(kind: string): boolean {
  return kind === 'intent' || kind === 'fact';
}

export class ColdGraph {
  readonly nodes = new Map<string, ColdNode>();
  readonly children = new Map<string, string[]>();
  readonly parents = new Map<string, string[]>();

  constructor(nodes: readonly ColdNode[], edges: readonly ColdEdge[]) {
    for (const node of nodes) {
      if (node.kind !== 'digest') this.nodes.set(node.id, node);
    }
    for (const edge of edges) {
      if (edge.relation === 'covers' || !this.nodes.has(edge.from) || !this.nodes.has(edge.to)) continue;
      const children = this.children.get(edge.from) ?? [];
      children.push(edge.to);
      this.children.set(edge.from, children);
      const parents = this.parents.get(edge.to) ?? [];
      parents.push(edge.from);
      this.parents.set(edge.to, parents);
    }
  }

  hotSet(): Set<string> {
    const hot = new Set<string>();
    const live = [...this.nodes.values()].filter(isLiveIntent);
    const stack = live.map(node => node.id);
    while (stack.length) {
      const id = stack.pop()!;
      if (hot.has(id)) continue;
      hot.add(id);
      for (const parent of this.parents.get(id) ?? []) stack.push(parent);
    }
    // Only direct children of live intents stay hot; do not walk descendants.
    for (const node of live) {
      for (const child of this.children.get(node.id) ?? []) hot.add(child);
    }
    return hot;
  }

  structuralCold(hot: ReadonlySet<string> = this.hotSet()): Set<string> {
    return new Set([...this.nodes.values()].filter(node => foldableKind(node.kind) && !hot.has(node.id)).map(node => node.id));
  }

  computeStampOps(structCold: ReadonlySet<string>, stamps: ColdStamps, round: number): StampOp[] {
    const ops: StampOp[] = [];
    // Iteration over the snapshot makes ordering independent of UUID spelling.
    for (const id of this.nodes.keys()) {
      if (structCold.has(id) && stamps.get(id) == null) ops.push({ id, set: true, round });
      else if (!structCold.has(id) && stamps.get(id) != null) ops.push({ id, set: false });
    }
    // Stale entries must also be cleared, matching computeStampOps in Go.
    for (const [id, stamp] of stamps) {
      if (!this.nodes.has(id) && !structCold.has(id) && stamp != null) ops.push({ id, set: false });
    }
    return ops;
  }

  eligibleCold(structCold: ReadonlySet<string>, stamps: ColdStamps, round: number, R = 6): Set<string> {
    const eligible = new Set<string>();
    for (const id of this.nodes.keys()) {
      const stamp = stamps.get(id);
      if (structCold.has(id) && stamp != null && round - stamp >= R) eligible.add(id);
    }
    return eligible;
  }

  groupBlocks(eligible: ReadonlySet<string>, K = 2): ColdBlock[] {
    const ids = [...this.nodes.keys()].filter(id => eligible.has(id));
    const uf = new UnionFind(ids);
    for (const from of ids) {
      for (const to of this.children.get(from) ?? []) {
        if (eligible.has(to)) uf.union(from, to);
      }
    }
    const byParent = new Map<string, string[]>();
    // Snapshot the first-pass components: rescuing siblings must not absorb an
    // existing multi-node component, even when they have a shared parent.
    for (const component of uf.components()) {
      if (component.length !== 1) continue;
      const singleton = component[0];
      for (const parent of this.parents.get(singleton) ?? []) {
        const siblings = byParent.get(parent) ?? [];
        siblings.push(singleton);
        byParent.set(parent, siblings);
      }
    }
    for (const siblings of byParent.values()) {
      for (let i = 1; i < siblings.length; i++) uf.union(siblings[0], siblings[i]);
    }
    return uf.components().filter(members => members.length >= K).map(members => {
      const memberSet = new Set(members);
      const externalParents = new Set<string>();
      for (const member of members) {
        for (const parent of this.parents.get(member) ?? []) {
          if (!memberSet.has(parent)) externalParents.add(parent);
        }
      }
      return { members, anchors: [...this.nodes.keys()].filter(id => externalParents.has(id)) };
    });
  }

  /** Call on a fresh snapshot after compression, inside the committing transaction. */
  filterAtCommit(block: ColdBlock, K = 2): ColdBlock | null {
    const hot = this.hotSet();
    const members = block.members.filter(id => !hot.has(id));
    return members.length >= K ? { members, anchors: [...block.anchors] } : null;
  }
}

/** Blocks must be in graph input order, as returned by groupBlocks. */
export function blockSignature(block: ColdBlock, versions: ReadonlyMap<string, number>): string {
  const hash = createHash('sha256');
  for (const id of block.members) hash.update(`m:${id}:${versions.get(id) ?? 0};`);
  for (const id of block.anchors) hash.update(`a:${id}:${versions.get(id) ?? 0};`);
  return hash.digest('hex');
}

class UnionFind {
  private readonly parent: Map<string, string>;
  constructor(ids: readonly string[]) { this.parent = new Map(ids.map(id => [id, id])); }
  private find(id: string): string {
    while (this.parent.get(id)! !== id) {
      this.parent.set(id, this.parent.get(this.parent.get(id)!)!);
      id = this.parent.get(id)!;
    }
    return id;
  }
  union(a: string, b: string): void {
    const rootA = this.find(a), rootB = this.find(b);
    if (rootA !== rootB) this.parent.set(rootA, rootB);
  }
  components(): string[][] {
    const groups = new Map<string, string[]>();
    for (const id of this.parent.keys()) {
      const root = this.find(id);
      const members = groups.get(root) ?? [];
      members.push(id);
      groups.set(root, members);
    }
    return [...groups.values()];
  }
}
