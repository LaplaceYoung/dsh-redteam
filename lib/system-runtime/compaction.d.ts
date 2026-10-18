import type { Context } from '@deepseek-ai/cordis';
import type { Agent } from '@deepseek-ai/dsh-agent';
import type { GenerateOptions, ToolSchema } from '@deepseek-ai/dsh-llm';
export type CompactionAgentKind = 'planner' | 'worker' | 'mainagent' | 'chat';
export interface CompactionRunOptions {
    sessionId: string;
    kind: CompactionAgentKind;
    contextWindow?: number;
    parentSessionIds?: string[];
}
export interface CompactionRuntimeOptions {
    enabled: () => boolean;
    /** Explicit persistent directory, normally <workspace>/noa. */
    archiveRoot: string;
    onWarn?: (message: string) => void;
}
interface Block {
    id: string;
    keys: string[];
    summary: string;
    archive: string;
    tier: number;
    callId?: string;
}
interface Ledger {
    version: 1;
    refs: Record<string, string>;
    blocks: Block[];
    nextRef: number;
    nextBlock: number;
}
export declare const compressToolSchema: ToolSchema;
declare class SessionLedger {
    readonly root: string;
    state: Ledger;
    constructor(base: string, session: string);
    save(state?: Ledger): void;
}
/** One run owns a fixed setting snapshot and the most recent provider-visible ref view. */
export declare class NoaCompactionRun {
    readonly enabled: boolean;
    readonly options: CompactionRunOptions;
    private readonly ledger?;
    private lastView;
    private failures;
    private lastNudgeTokens;
    private lastUserKey;
    private viewBlockCounter;
    private emergencyWindow;
    private lastSentTokens;
    private providerInputTokens;
    private providerAtBlock;
    private readonly window;
    constructor(enabled: boolean, options: CompactionRunOptions, ledger?: SessionLedger | undefined);
    /** Provider usage is a raise-only floor, invalidated after a successful compression. */
    noteInputTokens(inputTokens: number): void;
    /** Call at the provider adapter boundary; never mutate the frozen DSH request/log. */
    prepareRequest(request: GenerateOptions): GenerateOptions;
    /** Retry only when provider-confirmed overflow yields a strictly smaller request that fits. */
    recoverOverflow(request: GenerateOptions, error: unknown): GenerateOptions | undefined;
    compress(input: unknown, callId?: string): {
        blocks: string[];
        reclaimedTokens: number;
        archives: string[];
        repairedArguments?: true;
    };
    /** Register through the actual agent-scoped DSH ToolRuntime. Projection is a separate provider boundary. */
    attach(_ctx: Context, agent: Agent): () => void;
}
export declare function createCompactionRuntime(options: CompactionRuntimeOptions): {
    createRun(run: CompactionRunOptions, enabled?: boolean): NoaCompactionRun;
};
export {};
