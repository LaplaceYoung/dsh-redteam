import type { RedTeamStore } from '../store.js';
import type { Asset, RedTeamSnapshot } from '../types.js';
export interface ParsedCompanyScope {
    kind: 'domain' | 'ip' | 'cidr' | 'icp' | 'keyword';
    value: string;
    raw: string;
    domain?: string;
    net?: string;
}
export interface ScopeParseResult {
    rules: ParsedCompanyScope[];
    invalid: number;
    errors: string[];
}
/** Request-shape/bounds errors reject the request; invalid individual rules are reported. */
export declare function parseCompanyScopeInputs(inputs: unknown[]): ScopeParseResult;
/** Shared insert-time attribution; callers mark the resulting ownership as scope-derived. */
export declare function attributedCompanyForAsset(state: Pick<RedTeamSnapshot, 'companies' | 'scopes'>, asset: Asset): string | undefined;
export declare function recomputeCompanyAttribution(state: RedTeamSnapshot): {
    updated: number;
    warnings: string[];
};
export declare class CompanyManagementRuntime {
    readonly store: RedTeamStore;
    constructor(store: RedTeamStore);
    list(): {
        scope: ({
            raw: string;
            reason: string;
            domain: string;
            id: string;
            company_id: string | undefined;
            kind: string;
        } | {
            raw: string;
            reason: string;
            net: string;
            id: string;
            company_id: string | undefined;
            kind: string;
        } | {
            raw: string;
            reason: string;
            value: string;
            id: string;
            company_id: string | undefined;
            kind: string;
        })[];
        asset_count: number;
        nkey: string;
        created_at: string;
        updated_at: string;
        logo?: string;
        id: string;
        name: string;
        description?: string;
        createdAt: string;
        updatedAt: string;
    }[];
    get(id: string): {
        company: {
            nkey: string;
            created_at: string;
            updated_at: string;
            logo?: string;
            id: string;
            name: string;
            description?: string;
            createdAt: string;
            updatedAt: string;
        };
        scope: ({
            raw: string;
            reason: string;
            domain: string;
            id: string;
            company_id: string | undefined;
            kind: string;
        } | {
            raw: string;
            reason: string;
            net: string;
            id: string;
            company_id: string | undefined;
            kind: string;
        } | {
            raw: string;
            reason: string;
            value: string;
            id: string;
            company_id: string | undefined;
            kind: string;
        })[];
    };
    create(input: {
        name: string;
        logo?: string;
        scope?: unknown[];
    }): Promise<{
        created: boolean;
        added: number;
        skipped: number;
        invalid: number;
        errors: string[];
        scope_added: number;
        scope_skipped: number;
        scope_invalid: number;
        scope_errors: string[];
        warnings: string[];
        scope: ({
            raw: string;
            reason: string;
            domain: string;
            id: string;
            company_id: string | undefined;
            kind: string;
        } | {
            raw: string;
            reason: string;
            net: string;
            id: string;
            company_id: string | undefined;
            kind: string;
        } | {
            raw: string;
            reason: string;
            value: string;
            id: string;
            company_id: string | undefined;
            kind: string;
        })[];
        asset_count: number;
        nkey: string;
        created_at: string;
        updated_at: string;
        logo?: string;
        id: string;
        name: string;
        description?: string;
        createdAt: string;
        updatedAt: string;
    }>;
    scope(id: string, input: {
        scope: unknown[];
        reset?: boolean;
        reason?: string;
    }): Promise<{
        added: number;
        skipped: number;
        invalid: number;
        errors: string[];
        scope: ({
            raw: string;
            reason: string;
            domain: string;
            id: string;
            company_id: string | undefined;
            kind: string;
        } | {
            raw: string;
            reason: string;
            net: string;
            id: string;
            company_id: string | undefined;
            kind: string;
        } | {
            raw: string;
            reason: string;
            value: string;
            id: string;
            company_id: string | undefined;
            kind: string;
        })[];
        warnings: string[];
    }>;
    delete(id: string, deleteAssets?: boolean): Promise<{
        ok: boolean;
        deleted: number;
        assets_deleted: number;
        warnings: string[];
    }>;
    reattribute(): Promise<{
        updated: number;
        warnings: string[];
        ok: boolean;
    }>;
    upsertFromSync(input: {
        name: string;
        roots: string[];
        source: string;
    }): Promise<{
        id: string;
        created: boolean;
        added: number;
        skipped: number;
        invalid: number;
        errors: string[];
        warnings: string[];
    }>;
}
