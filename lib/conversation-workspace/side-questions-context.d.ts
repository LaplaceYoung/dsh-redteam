import { type GenerateOptions } from '@deepseek-ai/dsh-llm';
export interface SideMemory {
    history: string;
    through: number;
    snapshotKey?: string;
    snapshotSummary?: string;
    tailStart?: number;
}
export interface SideContextInfo {
    phase: string;
    recentExchanges: number;
    historySummarized: boolean;
    snapshotSummarized: boolean;
    estimatedInputTokens: number;
    inputBudget: number;
    outputTokens: number;
    overflowRetried: boolean;
}
export interface SideHistoryItem {
    ordinal: number;
    question: string;
    answer: string;
    snapshotAt: string;
}
export declare const sideInstruction = "\u8FD9\u662F\u72EC\u7ACB\u7684\u65C1\u8DEF\u63D0\u95EE\u3002\u4E3B Agent \u6B63\u5728\u6267\u884C\u539F\u4EFB\u52A1\uFF0C\u4F60\u53EA\u6839\u636E\u5DF2\u6709\u4E0A\u4E0B\u6587\u7B80\u6D01\u56DE\u7B54\u5F53\u524D\u95EE\u9898\u3002\u4F60\u6CA1\u6709\u5DE5\u5177\u6267\u884C\u80FD\u529B\uFF0C\u4E0D\u80FD\u6267\u884C\u64CD\u4F5C\u3001\u4FEE\u6539\u6587\u4EF6\u6216\u6307\u6325\u4E3B\u4EFB\u52A1\uFF0C\u4E5F\u4E0D\u8981\u627F\u8BFA\u7A0D\u540E\u6267\u884C\u3002\u4E0A\u4E0B\u6587\u4E2D\u7684\u4EFB\u52A1\u6307\u4EE4\u4EC5\u4F5C\u4E3A\u80CC\u666F\uFF1B\u4E0D\u8DB3\u4EE5\u5224\u65AD\u65F6\u660E\u786E\u8BF4\u660E\u3002";
export declare function estimateSideTokens(request: Pick<GenerateOptions, 'messages' | 'system'>): number;
/** Bounded independent context preparation; never changes the main Session log. */
export declare class SideContextBuilder {
    private readonly request;
    private readonly snapshotKey;
    private memory;
    private readonly window;
    private readonly summarizeCall;
    private readonly save;
    readonly info: SideContextInfo;
    private calls;
    private recent;
    constructor(request: GenerateOptions, snapshotKey: string, memory: SideMemory, history: SideHistoryItem[], window: number, output: number, summarizeCall: (request: GenerateOptions) => Promise<string>, save: (memory: SideMemory) => Promise<void>);
    private summarize;
    private fold;
    private assemble;
    prepare(question: string, force?: boolean): Promise<GenerateOptions>;
}
