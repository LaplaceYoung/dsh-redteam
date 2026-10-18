import type { Context } from '@deepseek-ai/cordis';
import type { Agent } from '@deepseek-ai/dsh-agent';
import { type Session, type SessionEvent } from '@deepseek-ai/dsh-session';
import type { RedTeamStore } from './store.js';
import type { Constraint, Intent } from './types.js';
import type { PlatformPrepareRun } from './platform/contracts.js';
export interface WorkerPlatformOptions {
    prepareRun?: PlatformPrepareRun;
    constraints?: (taskId: string) => Constraint[];
    /** Extra whole-intent model-error retries: zero selects 2 attempts / 3000 ms; -1 disables. */
    intentRetry?: () => {
        attempts: number;
        interval_ms: number;
    };
}
/**
 * Structural view of DSH's experimental Agent Teams service. The package is
 * supplied by the DSH host through the preset patch, so the plugin keeps the
 * host dependency optional for fixtures and older profiles.
 */
export interface WorkerAgentTeams {
    spawnTeammate(caller: Agent, request: {
        name: string;
        description: string;
        prompt: Array<{
            type: 'text';
            text: string;
        }>;
        context: 'fresh' | 'fork';
        provider: 'spawn' | 'fork';
        signal: AbortSignal;
    }): Promise<{
        member: {
            id: string;
            name: string;
            phase: string;
        };
    }>;
    sendMessage(caller: Agent, request: {
        target: string;
        content: Array<{
            type: 'text';
            text: string;
        }>;
        signal: AbortSignal;
    }): Promise<{
        messageId: string;
    }>;
    interrupt(caller: Agent, target: string): {
        previousStatus: string;
    };
}
export declare class WorkerRuntime {
    private readonly ctx;
    private readonly store;
    private readonly concurrency;
    private readonly platform;
    private readonly agentTeams?;
    private readonly children;
    private readonly lifetime;
    private readonly pendingStarts;
    private readonly pendingResults;
    private readonly resultErrors;
    private readonly eventQueues;
    private readonly platformRuns;
    private readonly timeoutTasks;
    private readonly executionSignals;
    private readonly modelFailures;
    private readonly retryCounts;
    private readonly retryJobs;
    /** Team allocates a child Session inside spawnTeammate, before that call returns. */
    private readonly pendingTeamStarts;
    private readonly removePlatformListener?;
    constructor(ctx: Pick<Context, 'subagents' | 'agents' | 'sessionQuery' | 'sessionPersistence'> & Partial<Pick<Context, 'root'>> & {
        agentTeams?: WorkerAgentTeams;
    }, store: RedTeamStore, concurrency: number, platform?: WorkerPlatformOptions, agentTeams?: WorkerAgentTeams);
    start(taskId: string, parent: Agent, signal: AbortSignal, provider?: 'spawn' | 'fork'): Promise<Intent | undefined>;
    private startChild;
    private workerTeamName;
    steer(intentId: string, message: string, parent: Agent, signal: AbortSignal): Promise<{
        intentId: string;
        childSessionId: string;
        messageId: string;
    }>;
    stop(intentId: string, parent: Agent, state?: 'paused' | 'failed' | 'open' | 'stopped'): Promise<Intent>;
    beginTaskTimeout(taskId: string): Promise<void>;
    observe(session: Session, event: SessionEvent): Promise<void>;
    private serialEvents;
    private applyEvent;
    private canRetry;
    private scheduleRetry;
    private cancelRetry;
    recover(intent: Intent, parent: Agent, signal: AbortSignal): Promise<void>;
    dispose(): Promise<void>;
    quiesceTask(taskId: string, state?: 'paused' | 'open' | 'stopped'): Promise<void>;
    private getIntent;
    private authorize;
}
