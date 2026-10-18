import type { Asset, RedTeamSnapshot } from './types.js';
import { type TaskRuleInput, type TaskAssetRule } from './task-management/index.js';
export interface GlobalAssetRule extends Omit<TaskAssetRule, 'taskId' | 'action'> {
    builtin: boolean;
}
export interface AssetCandidates {
    domains: string[];
    ips: string[];
    urls: string[];
}
export type AssetPolicyState = Pick<RedTeamSnapshot, 'assets' | 'taskAssetRules' | 'assetInterceptRules'>;
type Rule = Pick<TaskRuleInput, 'kind' | 'pattern' | 'enabled' | 'note'> & {
    id?: string;
};
export interface AssetGateDecision {
    allowed: boolean;
    reason: string;
    ruleId?: string;
    matchedValue?: string;
}
export declare class TaskAssetPolicyError extends Error {
    readonly hits: Array<{
        assetId?: string;
        label: string;
        decision: AssetGateDecision;
    }>;
    readonly code = "asset_policy_denied";
    constructor(message: string, hits?: Array<{
        assetId?: string;
        label: string;
        decision: AssetGateDecision;
    }>);
}
/** Called only for a missing persisted collection. An existing empty list is intentional. */
export declare function initialGlobalAssetRules(now?: Date): GlobalAssetRule[];
export declare function validateGlobalAssetRules(value: unknown): void;
/** ARTEX uses substring matching for fuzzy rules, never glob or regex matching. */
export declare function matchAssetRules(rules: readonly Rule[], candidates: AssetCandidates): {
    rule: Rule;
    value: string;
} | undefined;
export declare function evaluateAssetGate(blockRules: readonly Rule[], allowRules: readonly Rule[], candidates: AssetCandidates): AssetGateDecision;
/** The generic DSH asset kind/value pair maps to ARTEX's typed fields. Metadata
 * carries additional ARTEX fields: domain/root_domain/bound_domains/ip/service_ip/url.
 * No DNS lookups or guessed domain expansion participates in policy matching.
 */
export declare function assetCandidates(asset: Pick<Asset, 'kind' | 'value' | 'metadata'>): AssetCandidates;
export declare function listGlobalAssetRules(state: Pick<AssetPolicyState, 'assetInterceptRules'>): GlobalAssetRule[];
export declare function taskAssetGate(state: AssetPolicyState, taskId: string, candidates: AssetCandidates): AssetGateDecision;
export declare function assertAssetInsertionAllowed(state: AssetPolicyState, asset: Pick<Asset, 'taskId' | 'kind' | 'value' | 'metadata'>): void;
export declare function intentAssetIds(input: Record<string, unknown>): string[];
export declare function assertIntentAssetsAllowed(state: AssetPolicyState, taskId: string, input: Record<string, unknown>): void;
export {};
