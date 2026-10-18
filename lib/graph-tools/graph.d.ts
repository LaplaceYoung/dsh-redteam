import type { RedTeamStore } from '../store.js';
import type { RedTeamSnapshot } from '../types.js';
export { graphKind } from './digest-state.js';
export interface FactInput {
    summary?: string;
    detail?: string;
    evidence?: string;
    confidence?: string;
    intent_id?: string;
    asset_ids?: string[];
    data?: Record<string, unknown>;
}
export interface TrafficRef {
    traffic_id: string;
    role?: string;
    note?: string;
}
export interface HintInput {
    text?: string;
    summary?: string;
    asset_ids?: string[];
    traffic_refs?: TrafficRef[];
    data?: Record<string, unknown>;
}
export interface GraphRuntimeOptions {
    /** Resolve the actual setting; ARTEX defaults to rejecting automatic traffic binding. */
    trafficBindingEnabled?: () => boolean;
    notifyHint?: (taskId: string, texts: string[]) => void | Promise<void>;
}
export declare const terminalSourceStates: Set<string>;
export declare function graphOwners(state: RedTeamSnapshot, taskId: string): string[];
/** ARTEX graph contracts on the store's durable node/edge records. */
export declare class GraphRuntime {
    private readonly store;
    private readonly options;
    constructor(store: RedTeamStore, options?: GraphRuntimeOptions);
    listFacts(taskId: string, args?: {
        limit?: number;
        before?: string | number;
        q?: string;
    }): {
        next_before?: string | undefined;
        facts: {
            summary: string;
            summary_truncated?: boolean | undefined;
            id: string;
            state: string;
        }[];
        total: number;
        has_more: boolean;
    };
    listFindings(taskId: string, args?: {
        severity?: string;
        status?: string;
    }): {
        intent_id?: string | undefined;
        task_id: string;
        finding_id: string;
        finding_node_id: string;
        traffic_count: number;
        vulnclass: unknown;
        severity: unknown;
        id: string;
        state: string;
        summary: string;
    }[];
    nodeDetail(taskId: string, id: string): {
        finding_id?: string | undefined;
        finding_node_id?: string | undefined;
        traffic_count?: number | undefined;
        traffic_ids?: string[] | undefined;
        id: string;
        task_id: string;
        kind: string;
        state: string;
        payload: {
            id?: string | undefined;
            taskId?: string | undefined;
            provider?: "worker" | "traffic" | "rea" | "artex" | undefined;
            command?: string;
            target?: string;
            summary: string;
            raw?: unknown;
            createdAt?: string | undefined;
            vulnclass?: string | undefined;
            vulnClass?: string | undefined;
            severity?: "critical" | "high" | "medium" | "low" | "info" | undefined;
            evidenceIds?: string[] | undefined;
            assetIds?: string[] | undefined;
            status?: import("../findings-reports/types.js").FindingStatus | undefined;
            name?: string;
            nodeId?: string;
            intentId?: string;
            worker?: string;
            evidence?: unknown;
            report?: string;
            evidenceVersion?: number;
            reportEvidenceVersion?: number;
            trafficBindings?: import("../findings-reports/types.js").TrafficBinding[];
            retests?: import("../findings-reports/types.js").FindingRetest[];
            output?: Record<string, unknown> | undefined;
            text?: undefined;
            mode?: undefined;
        };
        anchors: {};
    } | {
        id: string;
        task_id: string;
        kind: string;
        state: "open" | "met" | "deleted";
        payload: {
            text: string;
            vulnclass: string | undefined;
            mode?: undefined;
        };
    } | {
        id: string;
        task_id: string;
        kind: string;
        state: string;
        payload: {
            text: string;
            mode: "allow" | "deny";
            vulnclass?: undefined;
        };
    };
    expandDigest(taskId: string, id: string): {
        members: ({
            confidence?: string | undefined;
            id: string;
            state: string;
            summary: string;
        } | {
            id: string;
            missing: boolean;
        })[];
        id: string;
        state: string;
        body: unknown;
    };
    recordFact(taskId: string, args: FactInput & {
        facts?: FactInput[];
    }, worker?: string): Promise<{
        errors?: Record<string, string> | undefined;
        ids: (string | 0)[];
        id?: undefined;
        message?: undefined;
    } | {
        id: string | 0;
        message: string;
    }>;
    addHint(taskId: string, args: HintInput & {
        hints?: HintInput[];
    }): Promise<{
        errors?: Record<string, string> | undefined;
        ids: (string | 0)[];
        id?: undefined;
        message?: undefined;
    } | {
        id: string | 0;
        message: string;
    }>;
    overview(taskId: string): {
        coverage: {
            note: string;
            status?: string | undefined;
            denominator: number;
            tested: number;
            pct: number | null;
            by_type: {
                type: string;
                total: number;
                tested: number;
            }[];
            host_count: number;
            scope_rows: number;
        } | {
            host_count: number;
        };
        related_tasks: {
            summary_truncated?: boolean | undefined;
            node_stats: Record<string, number>;
            task: {
                description: string;
                goal: string;
                status: import("../task-management/index.js").ManagedTaskStatus;
            };
            goals: {
                id: string;
                state: "open" | "met" | "deleted";
                text: string;
            }[];
            hints: {
                id: string;
                state: string;
                text: string;
            }[];
            facts: number;
            findings: number;
            recent_findings: {
                summary: string;
                vulnclass: unknown;
                severity: unknown;
                id: string;
                state: string;
            }[];
            recent_facts: {
                confidence?: string | undefined;
                from_intent?: string | undefined;
                summary: string;
                id: string;
                state: string;
            }[];
            recent_intent_results: {
                result_summary?: string | undefined;
                summary: string;
                yields?: string[] | undefined;
                parents?: string[] | undefined;
                asset_ids?: string[] | undefined;
                id: string;
                state: import("../types.js").IntentState;
            }[];
            asset_scope: {
                company_id?: string | undefined;
                kind: "cidr" | "root_domain" | "subdomain" | "ip" | "company" | "icp" | "keyword";
                source: "agent" | "human" | "auto";
                value: string;
            }[];
            asset_scope_count: number;
            asset_coverage: {
                note: string;
                status?: string | undefined;
                denominator: number;
                tested: number;
                pct: number | null;
                by_type: {
                    type: string;
                    total: number;
                    tested: number;
                }[];
                host_count: number;
                scope_rows: number;
            } | {
                host_count: number;
            };
        }[];
        task: {
            description: string;
            goal: string;
        };
        goals: {
            id: string;
            state: "open" | "met" | "deleted";
            text: string;
        }[];
        hints: {
            traffic_refs?: {} | undefined;
            id: string;
            state: string;
            text: string;
        }[];
        open_intents: {
            yields?: string[] | undefined;
            parents?: string[] | undefined;
            asset_ids?: string[] | undefined;
            id: string;
            summary: string;
            state: import("../types.js").IntentState;
        }[];
        frontier_open: number;
        running_intents: {
            yields?: string[] | undefined;
            parents?: string[] | undefined;
            asset_ids?: string[] | undefined;
            id: string;
            summary: string;
            state: import("../types.js").IntentState;
        }[];
        done_intents_total: number;
        recent_done_intents: {
            yields?: string[] | undefined;
            parents?: string[] | undefined;
            asset_ids?: string[] | undefined;
            id: string;
            summary: string;
            state: import("../types.js").IntentState;
        }[];
        facts: number;
        findings_total: number;
        recent_facts: {
            confidence?: string | undefined;
            from_intent?: string | undefined;
            id: string;
            state: string;
            summary: string;
        }[];
        finding_list: {
            confidence?: string | undefined;
            from_intent?: string | undefined;
            id: string;
            state: string;
            summary: string;
        }[];
    };
    private coverage;
    private relatedOverview;
}
