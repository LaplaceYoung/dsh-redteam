import { type ToolRunContext } from '@deepseek-ai/dsh-tools';
import { FindingsRuntime, type FindingsAccess } from './runtime.js';
import { type FindingsStore } from './types.js';
import type { ReportProvider } from './model.js';
import { FindingRetests, type RetestSessionProvider } from './retests.js';
export declare const replacedFindingToolNames: Set<string>;
export interface FindingsToolsOptions {
    reportProvider?: ReportProvider;
    reportProviderFor?: (exec: ToolRunContext) => ReportProvider;
    /** ARTEX reporter is triggered by report_finding; defaults on when a provider is configured. */
    automaticReports?: boolean;
    retestProvider?: RetestSessionProvider;
    retestProviderFor?: (exec: ToolRunContext) => RetestSessionProvider;
    trafficBindingEnabled?: () => boolean;
    resolveAccess?: (exec: ToolRunContext) => FindingsAccess;
    /** Host admission resumes/queues task after deepen; never launch a worker directly here. */
    admitTask?: (taskId: string, exec: ToolRunContext) => Promise<unknown>;
}
export declare function installFindingsReportTools(ctx: {
    tools: {
        register(tool: unknown): () => void;
    };
}, store: FindingsStore, options?: FindingsToolsOptions): {
    runtime: FindingsRuntime;
    retests: FindingRetests | undefined;
    dispose: () => void;
};
