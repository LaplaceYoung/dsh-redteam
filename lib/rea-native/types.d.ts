/** JSON values preserve upstream Evidence without inventing narrower result contracts. */
export type JsonValue = null | boolean | number | string | JsonValue[] | {
    [key: string]: JsonValue;
};
export type JsonObject = {
    [key: string]: JsonValue;
};
export interface NativeEvidence {
    evidence_id: string;
    subject: null | {
        name: string;
        digest: {
            sha256: string;
        };
        local_path: string;
        format: string;
        architecture: string | null;
    };
    provider: {
        id: string;
        name: string;
        version: string | null;
    };
    operation: string;
    predicate_type: string;
    parameters: JsonObject;
    raw_result: JsonValue;
    normalized_result: JsonValue;
    confidence: 'observed' | 'derived' | 'inferred';
    authority: 'shipped-artifact' | 'controlled-replay' | 'historical-reference' | 'external-service' | 'analyst-inference';
    analysis_profile: JsonObject | null;
    environment: JsonObject | null;
    limitations: string[];
    relationship_coverage: JsonObject | null;
    locations: JsonObject[];
    evidence_links: string[];
}
export interface NativeAnalysisError extends Error {
    readonly _tag: string;
    readonly operation?: string;
    readonly issues?: readonly {
        path: readonly (string | number)[];
        reason: string;
        message?: string;
    }[];
    readonly reason?: string;
    readonly diagnostics?: unknown;
    readonly resource?: string;
    readonly reportedLimits?: unknown;
    readonly cleanupIncomplete?: boolean;
}
export type NativeResult<T = NativeEvidence> = {
    ok: true;
    value: T;
} | {
    ok: false;
    error: NativeAnalysisError;
};
export interface NativeInspectOptions {
    signal?: AbortSignal;
}
export interface NativePathInput {
    path: string;
}
export interface NativePeResourcesInput extends NativePathInput {
    max_file_bytes?: number;
    max_entries?: number;
}
export type NativeOperation = 'inspect_go_binary' | 'inspect_rust_binary' | 'inspect_pe_resources' | 'inspect_electron_fuses';
export interface NativeService {
    inspect(input: unknown, options?: NativeInspectOptions): Promise<NativeResult>;
    close?(): Promise<void>;
}
