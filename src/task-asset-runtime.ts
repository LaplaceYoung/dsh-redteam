import { BlockList, isIP } from 'node:net';
import { randomUUID } from 'node:crypto';
import type { Asset, RedTeamSnapshot } from './types.js';
import { normalizeTaskRule, type TaskRuleInput, type TaskAssetRule } from './task-management/index.js';

export interface GlobalAssetRule extends Omit<TaskAssetRule, 'taskId' | 'action'> { builtin: boolean }
export interface AssetCandidates { domains: string[]; ips: string[]; urls: string[] }
export type AssetPolicyState = Pick<RedTeamSnapshot, 'assets' | 'taskAssetRules' | 'assetInterceptRules'>;
type Rule = Pick<TaskRuleInput, 'kind' | 'pattern' | 'enabled' | 'note'> & { id?: string };
export interface AssetGateDecision { allowed: boolean; reason: string; ruleId?: string; matchedValue?: string }
export class TaskAssetPolicyError extends Error {
  readonly code = 'asset_policy_denied';
  constructor(message: string, readonly hits: Array<{ assetId?: string; label: string; decision: AssetGateDecision }> = []) { super(message); this.name = 'TaskAssetPolicyError'; }
}
const labels: Record<string, string> = { exact_domain: '域名(全等)', exact_ip: 'IP(全等)', exact_url: 'URL(全等)', fuzzy_domain: '域名(模糊)', fuzzy_ip: 'IP(模糊)', fuzzy_url: 'URL(模糊)', cidr: 'CIDR 网段' };

/** Called only for a missing persisted collection. An existing empty list is intentional. */
export function initialGlobalAssetRules(now = new Date()): GlobalAssetRule[] {
  return [ ['.gov','[内置] 政府网站 (.gov)'], ['.gov.cn','[内置] 政府网站 (.gov.cn)'], ['.edu','[内置] 教育网站 (.edu)'], ['.edu.cn','[内置] 教育网站 (.edu.cn)'] ].map(([pattern,note]) => ({ id: randomUUID(), enabled: true, kind: 'fuzzy_domain', pattern, note, builtin: true, createdAt: now.toISOString(), updatedAt: now.toISOString() }));
}
export function validateGlobalAssetRules(value: unknown): void {
  if (!Array.isArray(value)) throw new Error('assetInterceptRules must be an array');
  for (const row of value) {
    if (!row || typeof row !== 'object') throw new Error('invalid global asset rule');
    const { id, kind, pattern, enabled, note, builtin, createdAt, updatedAt } = row;
    if (typeof id !== 'string' || !id || typeof pattern !== 'string' || typeof enabled !== 'boolean' || typeof note !== 'string' || typeof builtin !== 'boolean' || typeof createdAt !== 'string' || typeof updatedAt !== 'string') throw new Error('invalid global asset rule fields');
    if (kind !== 'exact_domain' && kind !== 'exact_ip' && kind !== 'exact_url' && kind !== 'fuzzy_domain' && kind !== 'fuzzy_ip' && kind !== 'fuzzy_url' && kind !== 'cidr') throw new Error('invalid global asset rule kind');
    normalizeTaskRule({ kind, pattern, enabled, note, action: 'block' });
  }
}
function ruleReason(rule: Rule): string { return `命中资产拦截规则 [${labels[rule.kind] ?? rule.kind}: ${rule.pattern}]${rule.note.trim() ? `（${rule.note.trim()}）` : ''}`; }

/** ARTEX uses substring matching for fuzzy rules, never glob or regex matching. */
export function matchAssetRules(rules: readonly Rule[], candidates: AssetCandidates): { rule: Rule; value: string } | undefined {
  for (const rule of rules) {
    const pattern = rule.pattern.trim(); if (!rule.enabled || !pattern) continue;
    let value: string | undefined;
    switch (rule.kind) {
      case 'exact_domain': value = candidates.domains.find(d => d.trim().toLowerCase() === pattern.toLowerCase()); break;
      case 'exact_ip': value = candidates.ips.find(ip => ip.trim() === pattern); break;
      case 'exact_url': value = candidates.urls.find(url => url.trim() === pattern); break;
      case 'fuzzy_domain': value = candidates.domains.find(d => d && d.toLowerCase().includes(pattern.toLowerCase())); break;
      case 'fuzzy_ip': value = candidates.ips.find(ip => ip && ip.includes(pattern)); break;
      case 'fuzzy_url': value = candidates.urls.find(url => url && url.toLowerCase().includes(pattern.toLowerCase())); break;
      case 'cidr': {
        const [network,bits,extra] = pattern.split('/'); const family = isIP(network);
        if (extra !== undefined || !family || bits === undefined || !/^\d+$/.test(bits) || Number(bits) > (family === 4 ? 32 : 128)) break;
        const block = new BlockList(); block.addSubnet(network, Number(bits), family === 4 ? 'ipv4' : 'ipv6');
        value = candidates.ips.find(ip => { const clean = ip.trim(), version = isIP(clean); return version !== 0 && block.check(clean, version === 4 ? 'ipv4' : 'ipv6'); }); break;
      }
    }
    if (value !== undefined) return { rule, value };
  }
  return undefined;
}
export function evaluateAssetGate(blockRules: readonly Rule[], allowRules: readonly Rule[], candidates: AssetCandidates): AssetGateDecision {
  const blocked = matchAssetRules(blockRules,candidates);
  if (blocked) return { allowed: false, reason: ruleReason(blocked.rule), ruleId: blocked.rule.id, matchedValue: blocked.value };
  if (allowRules.some(rule => rule.enabled) && !matchAssetRules(allowRules,candidates)) return { allowed: false, reason: '不在任务允许(白名单)范围内，不允许测试' };
  return { allowed: true, reason: '' };
}

/** The generic DSH asset kind/value pair maps to ARTEX's typed fields. Metadata
 * carries additional ARTEX fields: domain/root_domain/bound_domains/ip/service_ip/url.
 * No DNS lookups or guessed domain expansion participates in policy matching.
 */
export function assetCandidates(asset: Pick<Asset, 'kind' | 'value' | 'metadata'>): AssetCandidates {
  const candidates: AssetCandidates = { domains: [], ips: [], urls: [] };
  const add = (list: string[], value: unknown) => { if (typeof value === 'string' && value.trim()) list.push(value.trim()); };
  if (['domain','root_domain','subdomain'].includes(asset.kind)) add(candidates.domains,asset.value);
  if (asset.kind === 'ip') add(candidates.ips,asset.value);
  if (['url','service','endpoint','http','https'].includes(asset.kind) && /^(?:[a-z][a-z0-9+.-]*:)?\/\//i.test(asset.value)) add(candidates.urls,asset.value);
  add(candidates.domains,asset.metadata.domain); add(candidates.domains,asset.metadata.root_domain);
  if (Array.isArray(asset.metadata.bound_domains)) for (const domain of asset.metadata.bound_domains) add(candidates.domains,domain);
  add(candidates.ips,asset.metadata.ip); add(candidates.ips,asset.metadata.service_ip); add(candidates.urls,asset.metadata.url);
  for (const url of candidates.urls) {
    // Preserve original IPv6 spelling for exact_ip, as Go url.URL.Hostname does.
    const authority = /^(?:[a-z][a-z0-9+.-]*:)?\/\/([^/?#]*)/i.exec(url)?.[1]; if (!authority) continue;
    const hostPort = authority.slice(authority.lastIndexOf('@')+1);
    const host = hostPort.startsWith('[') ? /^\[([^\]]+)\](?::\d*)?$/.exec(hostPort)?.[1] : /^([^:]+)(?::\d*)?$/.exec(hostPort)?.[1];
    if (host) add(isIP(host) ? candidates.ips : candidates.domains,host);
  }
  return candidates;
}
export function listGlobalAssetRules(state: Pick<AssetPolicyState, 'assetInterceptRules'>): GlobalAssetRule[] {
  return structuredClone(state.assetInterceptRules).reverse().sort((a,b) => Number(b.builtin)-Number(a.builtin) || b.createdAt.localeCompare(a.createdAt));
}
export function taskAssetGate(state: AssetPolicyState, taskId: string, candidates: AssetCandidates): AssetGateDecision {
  const rules = state.taskAssetRules.filter(rule => rule.taskId === taskId);
  return evaluateAssetGate([...listGlobalAssetRules(state), ...rules.filter(rule => rule.action !== 'allow')], rules.filter(rule => rule.action === 'allow'), candidates);
}
export function assertAssetInsertionAllowed(state: AssetPolicyState, asset: Pick<Asset, 'taskId' | 'kind' | 'value' | 'metadata'>): void {
  const decision = taskAssetGate(state, asset.taskId, assetCandidates(asset));
  if (!decision.allowed) throw new TaskAssetPolicyError(`资产 [${asset.kind}] ${asset.value} ${decision.reason}，已禁止插入`, [{ label: asset.value, decision }]);
}
export function intentAssetIds(input: Record<string,unknown>): string[] {
  const values = [input.assetIds,input.asset_ids].filter(value => value !== undefined);
  for (const value of values) if (!Array.isArray(value) || value.some(id => typeof id !== 'string' || !id.trim())) throw new Error('asset_ids / assetIds 必须为资产 ID 字符串数组');
  return [...new Set(values.flatMap(value => value as string[]))];
}
export function assertIntentAssetsAllowed(state: AssetPolicyState, taskId: string, input: Record<string,unknown>): void {
  const ids = new Set(intentAssetIds(input)); if (!ids.size) return;
  // Match global assets by ID; narrowing lookup to the task would weaken the gate.
  const hits = state.assets.filter(asset => ids.has(asset.id)).flatMap(asset => {
    const decision = taskAssetGate(state,taskId,assetCandidates(asset));
    return decision.allowed ? [] : [{ assetId: asset.id, label: `资产#${asset.id}[${asset.kind}] ${asset.value}`, decision }];
  });
  if (hits.length) throw new TaskAssetPolicyError(`意图绑定的资产未通过测试范围校验，请停止对相关资产进行测试：\n${hits.map(hit => ` - ${hit.label} → ${hit.decision.reason}`).join('\n')}`,hits);
}
