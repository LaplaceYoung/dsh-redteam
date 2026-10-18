/** A compatibility declaration travels with a package source supplied by an operator. */
export interface VersionCompatibilityManifest {
    packageName?: string;
    packageVersion?: string;
    runtimeVersion: string;
    dataSchemaVersion?: string;
    compatibleWith?: string[];
    migrateFrom?: string[];
    rollback?: boolean;
}
export interface VersionCommandResult {
    exitCode: number;
    stdout: string;
    stderr: string;
}
export interface DshPluginVersionOptions {
    /** The installed DSH launcher (the .cmd file is supported on Windows). */
    cliPath?: string;
    profile: string;
    packageName: string;
    runtimeVersion?: string;
    /** A registry spec or an explicit local directory/.tgz. It is never inferred. */
    source?: string;
    cwd?: string;
    env?: NodeJS.ProcessEnv;
    commandTimeoutMs?: number;
    execute?: (args: string[], options: {
        cwd: string;
        env: NodeJS.ProcessEnv;
        timeoutMs: number;
    }) => Promise<VersionCommandResult>;
}
export interface VersionEvent {
    operation: 'check' | 'apply' | 'rollback';
    phase: 'started' | 'command' | 'completed' | 'failed';
    at: string;
    target?: string;
    exitCode?: number;
    message?: string;
}
/**
 * Adapter for the DSH rc.2 public plugin command. It only manages the profile
 * named by the caller; it never uses the reserved desktop profile implicitly.
 */
export declare class DshPluginVersions {
    private running;
    private readonly listeners;
    private current;
    private readonly options;
    constructor(options: DshPluginVersionOptions);
    private emit;
    status(): VersionEvent | {
        operation: string;
        phase: string;
        at: string;
        message: string;
    };
    stream(listener: (event: VersionEvent) => void): () => boolean;
    private run;
    check(input?: {
        force?: boolean;
    }): Promise<Record<string, unknown>>;
    private target;
    apply(input: unknown): Promise<{
        ok: boolean;
        operation: string;
        rollback: boolean;
        target: string;
        local: boolean;
        compatibility: VersionCompatibilityManifest | undefined;
        exitCode: number;
        diagnostics: string;
    }>;
    rollback(input?: unknown): Promise<{
        ok: boolean;
        operation: string;
        rollback: boolean;
        target: string;
        local: boolean;
        compatibility: VersionCompatibilityManifest;
        exitCode: number;
        diagnostics: string;
        note: string;
    }>;
}
export declare const createDshPluginVersions: (options: DshPluginVersionOptions) => DshPluginVersions;
