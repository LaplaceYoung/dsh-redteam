import { isIP } from 'node:net';
import type { FindingRecord, FindingsSnapshot } from './types.js';
import { FindingsError } from './types.js';

export interface FindingFilter {
  severity?: string; status?: string; vulnClass?: string; taskId?: string;
  query?: string; sort?: string; assetScope?: string;
}
export interface FindingPage<T> { items: T[]; total: number; page: number; pageSize: number }
export interface FindingListItem extends Omit<FindingRecord, 'report' | 'trafficBindings' | 'retests'> { trafficCount: number; taskDescription: string }
export interface FindingCounts { critical: number; high: number; medium: number; low: number }
export interface FindingGroup extends FindingCounts {
  taskId: string | null; taskName: string; taskDescription: string; taskStatus: string;
  count: number; lastFoundAt: string;
}
export interface FindingStatsAggregate extends FindingCounts { total: number; pending: number; vulnClasses: string[] }
export interface FindingStats extends FindingStatsAggregate {
  tasks: { id: string; name: string; description: string; count: number }[];
}
export interface FindingAssetNode extends FindingCounts {
  key: string; parent?: string; kind: string; label: string; assetId?: string; companyId?: string;
  self: number; total: number; lastFoundAt: string;
}
export interface FindingAssetTree {
  nodes: FindingAssetNode[]; findingTotal: number; truncated: boolean; droppedKinds: string[];
}
export const findingUnassignedTask = '__unassigned__';
export const findingUnassignedAsset = '__none__';
const counts = (): FindingCounts => ({ critical: 0, high: 0, medium: 0, low: 0 });
const rank = (severity: string): number => ({ critical: 4, high: 3, medium: 2, low: 1 }[severity] ?? 0);
const textCompare = (a: string, b: string): number => a < b ? -1 : a > b ? 1 : 0;
// Numeric ARTEX imports retain numeric ordering; native DSH identifiers are opaque strings.
const idCompare = (a: string, b: string): number => /^\d+$/.test(a) && /^\d+$/.test(b)
  ? (BigInt(a) < BigInt(b) ? -1 : BigInt(a) > BigInt(b) ? 1 : 0) : textCompare(a, b);
const timeCompare = (a: string, b: string): number => Date.parse(a) - Date.parse(b);
function increment(count: FindingCounts, severity: string): void {
  if (severity === 'critical' || severity === 'high' || severity === 'medium' || severity === 'low') count[severity]++;
}
const norm = (value?: string): string => value === 'all' ? '' : value ?? '';
function pagination(page: number, size: number, fallback: number): { page: number; pageSize: number } {
  return { page: Number.isSafeInteger(page) && page > 0 ? page : 1,
    pageSize: Number.isSafeInteger(size) && size > 0 ? Math.min(size, 100) : fallback };
}
function pageItems<T>(items: T[], page: number, pageSize: number): T[] {
  if (!items.length || page > Math.ceil(items.length / pageSize)) return [];
  return items.slice((page - 1) * pageSize, page * pageSize);
}
function filterBase(snapshot: FindingsSnapshot, filter: FindingFilter): FindingRecord[] {
  const taskIds = new Set(snapshot.tasks.map(task => task.id));
  const query = filter.query?.trim().toLowerCase();
  return snapshot.findings.filter(finding => {
    if (norm(filter.severity) && finding.severity !== filter.severity) return false;
    if (norm(filter.status) && finding.status !== filter.status) return false;
    if (norm(filter.vulnClass) && finding.vulnClass !== filter.vulnClass) return false;
    if (norm(filter.taskId)) {
      if (filter.taskId === findingUnassignedTask) { if (taskIds.has(finding.taskId)) return false; }
      else if (finding.taskId !== filter.taskId) return false;
    }
    if (!query) return true;
    const evidence = typeof finding.evidence === 'string' ? finding.evidence : JSON.stringify(finding.evidence);
    return [finding.name, finding.vulnClass, finding.summary, evidence, finding.report]
      .some(value => value?.toLowerCase().includes(query));
  });
}

/** Shared by list, grouped list and filtered export; search treats %, _ and backslash literally. */
export function filterFindings(snapshot: FindingsSnapshot, filter: FindingFilter = {}): FindingRecord[] {
  let items = filterBase(snapshot, filter);
  const scope = filter.assetScope?.trim();
  if (scope === findingUnassignedAsset) {
    const present = new Set(snapshot.assets.map(asset => asset.id));
    items = items.filter(finding => !finding.assetIds.some(id => present.has(id)));
  } else if (scope) {
    const tree = buildFindingAssetTree(snapshot, filter, 0);
    const included = new Set([scope]);
    const children = new Map<string, FindingAssetNode[]>();
    for (const node of tree.nodes) {
      const key = node.parent ?? '';
      if (!children.has(key)) children.set(key, []);
      children.get(key)!.push(node);
    }
    const queue = [scope];
    for (let i = 0; i < queue.length; i++) for (const child of children.get(queue[i]) ?? []) {
      if (!included.has(child.key)) { included.add(child.key); queue.push(child.key); }
    }
    const assetIds = new Set(tree.nodes.filter(node => included.has(node.key) && node.assetId).map(node => node.assetId!));
    items = items.filter(finding => finding.assetIds.some(id => assetIds.has(id)));
  }
  return items.sort((a, b) => (filter.sort === 'severity' ? rank(b.severity) - rank(a.severity) : 0)
    || timeCompare(b.createdAt, a.createdAt) || idCompare(b.id, a.id));
}

export function listFindingsPage(snapshot: FindingsSnapshot, filter: FindingFilter = {}, page = 1, pageSize = 20): FindingPage<FindingListItem> {
  const paging = pagination(page, pageSize, 20), items = filterFindings(snapshot, filter);
  const descriptions = new Map(snapshot.tasks.map(task => [task.id, task.description ?? '']));
  const listed = pageItems(items, paging.page, paging.pageSize).map(finding => {
    const { report, trafficBindings, retests, ...item } = finding;
    return { ...item, trafficCount: trafficBindings?.length ?? 0, taskDescription: descriptions.get(finding.taskId) ?? '' };
  });
  return { items: listed, total: items.length, ...paging };
}

export function listFindingGroups(snapshot: FindingsSnapshot, filter: FindingFilter = {}, page = 1, pageSize = 10): FindingPage<FindingGroup> & { findingTotal: number } {
  const paging = pagination(page, pageSize, 10), findings = filterFindings(snapshot, filter);
  const tasks = new Map(snapshot.tasks.map(task => [task.id, task]));
  const groups = new Map<string | null, FindingGroup>();
  const ranks = new Map<string | null, number>();
  for (const finding of findings) {
    const task = tasks.get(finding.taskId), id = task?.id ?? null;
    let group = groups.get(id);
    if (!group) {
      const terminal = task && ['done', 'failed', 'timeout'].includes(task.status);
      group = { ...counts(), taskId: id, taskName: task?.title ?? '', taskDescription: task?.description ?? '',
        taskStatus: task ? terminal ? task.status : task.queued ? 'queued' : task.status : '', count: 0, lastFoundAt: finding.createdAt };
      groups.set(id, group);
    }
    group.count++; increment(group, finding.severity);
    if (timeCompare(finding.createdAt, group.lastFoundAt) > 0) group.lastFoundAt = finding.createdAt;
    ranks.set(id, Math.max(ranks.get(id) ?? 0, rank(finding.severity)));
  }
  const items = [...groups.values()].sort((a, b) =>
    (filter.sort === 'severity' ? ranks.get(b.taskId)! - ranks.get(a.taskId)! : 0)
    || timeCompare(b.lastFoundAt, a.lastFoundAt)
    || (a.taskId === null ? 1 : b.taskId === null ? -1 : idCompare(b.taskId, a.taskId)));
  return { items: pageItems(items, paging.page, paging.pageSize), total: items.length, findingTotal: findings.length, ...paging };
}

/** Cold-archive aggregates are supplied by the archive owner, never guessed from dataCounts. */
export function findingStats(snapshot: FindingsSnapshot, archived: readonly FindingStatsAggregate[] = []): FindingStats {
  const stats: FindingStats = { ...counts(), total: snapshot.findings.length, pending: 0, vulnClasses: [], tasks: [] };
  const classes = new Set<string>();
  for (const finding of snapshot.findings) {
    increment(stats, finding.severity);
    if (finding.status === 'pending') stats.pending++;
    if (finding.vulnClass) classes.add(finding.vulnClass);
  }
  for (const cold of archived) {
    stats.total += cold.total; stats.pending += cold.pending;
    for (const severity of ['critical', 'high', 'medium', 'low'] as const) stats[severity] += cold[severity];
    for (const value of cold.vulnClasses) if (value) classes.add(value);
  }
  stats.vulnClasses = [...classes].sort(textCompare);
  // Missing tasks share the unassigned group and do not appear in task selection.
  // The options are not paginated, unlike the group view.
  const taskCounts = new Map<string, { count: number; last: string }>();
  for (const finding of snapshot.findings) {
    const item = taskCounts.get(finding.taskId);
    if (item) { item.count++; if (timeCompare(finding.createdAt, item.last) > 0) item.last = finding.createdAt; }
    else taskCounts.set(finding.taskId, { count: 1, last: finding.createdAt });
  }
  stats.tasks = snapshot.tasks.filter(task => taskCounts.has(task.id)).sort((a, b) =>
    timeCompare(taskCounts.get(b.id)!.last, taskCounts.get(a.id)!.last) || idCompare(b.id, a.id))
    .map(task => ({ id: task.id, name: task.title, description: task.description ?? '', count: taskCounts.get(task.id)!.count }));
  return stats;
}

/** ARTEX's catalog is DISTINCT vulnclass over real findings (db/findings.go), not a predefined taxonomy. */
export function listFindingVulnClasses(snapshot: FindingsSnapshot, archived: readonly FindingStatsAggregate[] = []): string[] {
  return findingStats(snapshot, archived).vulnClasses;
}

type Asset = FindingsSnapshot['assets'][number];
interface AssetRow {
  id: string; kind: string; companyId?: string; domain: string; rootDomain: string;
  ip: string; url: string; appName: string; host: string; port: number; label: string;
}
function assetRow(asset: Asset): AssetRow {
  const string = (key: string): string => typeof asset.metadata[key] === 'string' ? asset.metadata[key] : '';
  const domain = string('domain') || (['root_domain', 'subdomain', 'domain'].includes(asset.kind) ? asset.value : '');
  const ip = string('ip') || (asset.kind === 'ip' ? asset.value : '');
  const url = string('url') || (['endpoint', 'url'].includes(asset.kind) || (asset.kind === 'service' && asset.value.includes('://')) ? asset.value : '');
  const appName = string('app_name') || (asset.kind === 'app' ? asset.value : '');
  const rootDomain = string('root_domain');
  let host = domain, port = typeof asset.metadata.port === 'number' ? asset.metadata.port : 0;
  if (!host && url) {
    // Legacy assets may contain non-URLs. They retain their label without inventing a host.
    try { const parsed = new URL(url.includes('://') ? url : `http://${url}`); host = parsed.hostname.replace(/^\[|\]$/g, '');
      if (!port) port = parsed.port ? Number(parsed.port) : parsed.protocol === 'https:' ? 443 : parsed.protocol === 'http:' ? 80 : 0;
    } catch { /* Invalid URLs cannot form a host relation. */ }
  }
  host ||= ip;
  const label = asset.kind === 'service' && !url && host && port > 0 ? `${host}:${port}`
    : asset.kind === 'app' && appName ? appName : url || domain || ip || appName || rootDomain || asset.value || `a:${asset.id}`;
  return { id: asset.id, kind: asset.kind, companyId: asset.companyId, domain, rootDomain, ip, url, appName, host, port, label };
}

function loadTreeRows(snapshot: FindingsSnapshot, hits: FindingRecord[]): AssetRow[] {
  const wanted = new Set(hits.flatMap(hit => hit.assetIds));
  const all = snapshot.assets.map(assetRow), loaded = new Map(all.filter(row => wanted.has(row.id)).map(row => [row.id, row]));
  // Match ARTEX's four rounds of host completion; unrelated assets never enter parent selection.
  for (let round = 0; round < 4; round++) {
    const rows = [...loaded.values()];
    const have = (kind: string, value: string) => rows.some(row => row.kind === kind && (kind === 'service' ? row.host : kind === 'ip' ? row.ip : row.domain) === value);
    const service = new Set<string>(), domain = new Set<string>(), ips = new Set<string>(), roots = new Set<string>();
    for (const row of rows) {
      if (row.kind === 'service' || row.kind === 'endpoint') {
        if (row.kind === 'endpoint' && row.host && !have('service', row.host)) service.add(row.host);
        if (row.host && !have('subdomain', row.host) && !have('ip', row.host) && !have('root_domain', row.host))
          (isIP(row.host) ? ips : domain).add(row.host);
        if (row.ip && !have('ip', row.ip)) ips.add(row.ip);
      } else if (row.kind === 'subdomain' && row.rootDomain && !have('root_domain', row.rootDomain)) roots.add(row.rootDomain);
    }
    let added = 0;
    for (const row of all) if (!loaded.has(row.id) && (
      row.kind === 'service' && (service.has(row.domain) || service.has(row.ip))
      || row.kind === 'subdomain' && domain.has(row.domain)
      || row.kind === 'ip' && ips.has(row.ip)
      || row.kind === 'root_domain' && roots.has(row.domain))) { loaded.set(row.id, row); added++; }
    if (!added) break;
  }
  return [...loaded.values()];
}

export function buildFindingAssetTree(snapshot: FindingsSnapshot, filter: FindingFilter = {}, maxNodes = 3000): FindingAssetTree {
  const hits = filterBase(snapshot, filter), rows = loadTreeRows(snapshot, hits);
  const nodes = new Map<string, FindingAssetNode>();
  const roots = new Map<string, string>(), subs = new Map<string, string>(), ips = new Map<string, string>();
  const services = new Map<string, string>(), ports = new Map<string, string>();
  const makeNode = (key: string, kind: string, label: string): FindingAssetNode => ({ ...counts(), key, kind, label, self: 0, total: 0, lastFoundAt: '' });
  for (const row of rows) {
    const key = `a:${row.id}`;
    nodes.set(key, { ...makeNode(key, row.kind, row.label), assetId: row.id, companyId: row.companyId });
    if (row.kind === 'root_domain' && row.domain) roots.set(row.domain, key);
    if (row.kind === 'subdomain' && row.domain) subs.set(row.domain, key);
    if (row.kind === 'ip' && row.ip) ips.set(row.ip, key);
    if (row.kind === 'service' && row.host) { services.set(row.host, key); ports.set(`${row.host}|${row.port}`, key); }
  }
  for (const row of rows) if (row.kind === 'subdomain' && row.rootDomain && !roots.has(row.rootDomain)) {
    const key = `r:${row.rootDomain}`;
    roots.set(row.rootDomain, key); nodes.set(key, makeNode(key, 'root_domain', row.rootDomain));
  }
  for (const row of rows) {
    const node = nodes.get(`a:${row.id}`)!;
    const candidates = row.kind === 'subdomain' ? [roots.get(row.rootDomain)]
      : row.kind === 'service' ? [subs.get(row.domain), subs.get(row.host), ips.get(row.ip), ips.get(row.host), roots.get(row.rootDomain), roots.get(row.host)]
      : row.kind === 'endpoint' ? [ports.get(`${row.host}|${row.port}`), services.get(row.host), subs.get(row.host), subs.get(row.domain), ips.get(row.host), ips.get(row.ip), roots.get(row.rootDomain), roots.get(row.host)] : [];
    const parent = candidates.find(key => key && nodes.has(key));
    if (parent && parent !== node.key) node.parent = parent;
  }
  for (const node of [...nodes.values()]) if (!node.parent && node.companyId && ['root_domain', 'ip', 'app'].includes(node.kind)) {
    const company = snapshot.companies.find(item => item.id === node.companyId);
    if (!company) continue;
    const key = `c:${company.id}`;
    if (!nodes.has(key)) nodes.set(key, { ...makeNode(key, 'company', company.name || `企业 #${company.id}`), companyId: company.id });
    node.parent = key;
  }
  const none = makeNode(findingUnassignedAsset, 'none', '未关联资产');
  nodes.set(none.key, none);
  for (const hit of hits) {
    const touched = new Set<string>();
    for (const id of new Set(hit.assetIds)) {
      const direct = nodes.get(`a:${id}`);
      if (!direct) continue;
      direct.self++;
      for (let node: FindingAssetNode | undefined = direct; node && !touched.has(node.key); node = node.parent ? nodes.get(node.parent) : undefined) touched.add(node.key);
    }
    if (!touched.size) { none.self++; touched.add(none.key); }
    for (const key of touched) {
      const node = nodes.get(key)!;
      node.total++; increment(node, hit.severity);
      if (!node.lastFoundAt || timeCompare(hit.createdAt, node.lastFoundAt) > 0) node.lastFoundAt = hit.createdAt;
    }
  }
  const tree: FindingAssetTree = { nodes: [...nodes.values()].filter(node => node.total > 0).sort((a, b) =>
    (a.kind === 'none' ? 1 : b.kind === 'none' ? -1 : 0) || b.total - a.total || textCompare(a.label, b.label)),
    findingTotal: hits.length, truncated: false, droppedKinds: [] };
  if (maxNodes > 0) for (const kind of ['endpoint', 'service']) {
    if (tree.nodes.length <= maxNodes) break;
    tree.nodes = tree.nodes.filter(node => node.kind !== kind); tree.truncated = true; tree.droppedKinds.push(kind);
  }
  return tree;
}

/** Reverse reachability is task-local and returns all internal ancestor edges, irrespective of relation. */
export function findingLineage(snapshot: FindingsSnapshot, findingId: string): { nodes: FindingsSnapshot['nodes']; edges: FindingsSnapshot['edges'] } {
  const finding = snapshot.findings.find(item => item.id === findingId);
  if (!finding) throw new FindingsError('not_found', `finding not found: ${findingId}`);
  const empty = { nodes: [], edges: [] };
  if (!snapshot.tasks.some(task => task.id === finding.taskId)) return empty;
  const nodeId = finding.nodeId ?? finding.id;
  const nodes = snapshot.nodes.filter(node => node.taskId === finding.taskId);
  if (!nodes.some(node => node.id === nodeId)) return empty;
  const edges = snapshot.edges.filter(edge => edge.taskId === finding.taskId);
  const ancestors = new Set([nodeId]), queue = [nodeId];
  const incoming = new Map<string, string[]>();
  for (const edge of edges) { if (!incoming.has(edge.to)) incoming.set(edge.to, []); incoming.get(edge.to)!.push(edge.from); }
  for (let i = 0; i < queue.length; i++) for (const from of incoming.get(queue[i]) ?? []) {
    if (!ancestors.has(from)) { ancestors.add(from); queue.push(from); }
  }
  return { nodes: nodes.filter(node => ancestors.has(node.id)).sort((a, b) => idCompare(a.id, b.id)),
    edges: edges.filter(edge => ancestors.has(edge.from) && ancestors.has(edge.to)) };
}
