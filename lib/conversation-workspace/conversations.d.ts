import type { Context } from '@deepseek-ai/cordis';
import type { Agent } from '@deepseek-ai/dsh-agent';
import type { PlatformPrepareRun } from '../platform/contracts.js';
import type { TaskModelRoute, TaskProfileResolver } from '../task-management/runtime-model.js';
export interface ConversationAttachment {
    name: string;
    path: string;
    size?: number;
}
export declare class ConversationError extends Error {
    readonly status: number;
    constructor(status: number, message: string);
}
declare module '@deepseek-ai/dsh-llm' {
    interface MessageSourceMap {
        'artex-conversation-user': {
            kind: 'artex-conversation-user';
            text: string;
            attachments: ConversationAttachment[];
        };
    }
}
export interface ConversationRecord {
    id: string;
    sessionId: string;
    agentKey: string;
    title: string;
    profileId: string | null;
    taskId?: string;
    segment?: number;
    cwd: string;
    pinnedAt: string | null;
    createdAt: string;
    updatedAt: string;
    deletedAt: string | null;
}
export interface CreateConversationInput {
    agentKey: string;
    title?: string;
    profileId?: string | null;
    taskId?: string;
    cwd?: string;
}
export interface ConversationTaskArchive {
    version: 1;
    conversations: ConversationRecord[];
}
export interface ConversationRuntimeOptions {
    storagePath: string;
    workspaceRoot: string;
    profiles: TaskProfileResolver;
    prepareRun: PlatformPrepareRun;
    resolveAgent(agentKey: string): boolean | Promise<boolean>;
    resolveAgentProfile?(agentKey: string): TaskModelRoute | null | Promise<TaskModelRoute | null>;
    taskExists?(taskId: string): boolean | Promise<boolean>;
    setupAgent?(ctx: Context, agent: Agent, parent?: Agent): void | Promise<void>;
    bindTask?(taskId: string, agent: Agent): void | (() => void) | Promise<void | (() => void)>;
    prepareMessage?(message: string, attachments: readonly ConversationAttachment[], record: Readonly<ConversationRecord>): string | Promise<string>;
    drainSideQuestions?(conversationId: string): void | Promise<void>;
    prepareSideQuestionDelete?(conversationId: string): Promise<{
        commit(): Promise<void>;
        rollback(): Promise<void>;
    }>;
    now?: () => Date;
    onError?(error: unknown): void;
}
/** Owns real DSH handles; the metadata file contains references, never a second transcript. */
export declare class ConversationRuntime {
    private readonly ctx;
    private readonly options;
    private state;
    private ready?;
    private tail;
    private readonly owned;
    private readonly runs;
    private readonly deletingTasks;
    private readonly sideDeletes;
    private closed;
    constructor(ctx: Context, options: ConversationRuntimeOptions);
    initialize(): Promise<void>;
    private serial;
    private now;
    private save;
    private record;
    private assertTaskOpen;
    private busy;
    list(filter?: {
        query?: string;
        taskId?: string;
    }): Promise<{
        pinned: boolean;
        running: boolean;
        id: string;
        sessionId: string;
        agentKey: string;
        title: string;
        profileId: string | null;
        taskId?: string;
        segment?: number;
        cwd: string;
        pinnedAt: string | null;
        createdAt: string;
        updatedAt: string;
        deletedAt: string | null;
    }[]>;
    get(id: string): Promise<{
        pinned: boolean;
        running: boolean;
        id: string;
        sessionId: string;
        agentKey: string;
        title: string;
        profileId: string | null;
        taskId?: string;
        segment?: number;
        cwd: string;
        pinnedAt: string | null;
        createdAt: string;
        updatedAt: string;
        deletedAt: string | null;
    }>;
    segments(taskId: string): Promise<{
        sessions: {
            pinned: boolean;
            running: boolean;
            id: string;
            sessionId: string;
            agentKey: string;
            title: string;
            profileId: string | null;
            taskId?: string;
            segment?: number;
            cwd: string;
            pinnedAt: string | null;
            createdAt: string;
            updatedAt: string;
            deletedAt: string | null;
        }[];
        current: number;
    }>;
    create(input: CreateConversationInput, parent?: Agent): Promise<ConversationRecord>;
    ensureMainSession(taskId: string, parent?: Agent): Promise<ConversationRecord>;
    private createRecord;
    update(id: string, patch: {
        title?: string;
        pinned?: boolean;
        profileId?: string | null;
    }): Promise<ConversationRecord>;
    private preparation;
    private open;
    recover(id: string, parent?: Agent): Promise<Agent>;
    send(id: string, message: string, options?: {
        parent?: Agent;
        signal?: AbortSignal;
        attachments?: ConversationAttachment[];
    }): Promise<{
        status: "accepted";
        id: string;
        sessionId: string;
        messageId: import("@deepseek-ai/dsh-llm").MessageId;
    }>;
    wait(id: string): Promise<void>;
    cancel(id: string): Promise<void>;
    messages(id: string, since?: number, limit?: number): Promise<{
        events: import("@deepseek-ai/dsh-session").SessionEvent[];
        cursor: number;
        hasMore: boolean;
        running: boolean;
    }>;
    private release;
    private remove;
    delete(id: string): Promise<void>;
    deleteMany(ids: string[]): Promise<({
        id: string;
        ok: boolean;
        error?: undefined;
    } | {
        id: string;
        ok: boolean;
        error: string;
    })[]>;
    prepareTaskDelete(taskId: string): Promise<{
        commit: () => Promise<void>;
        rollback: () => Promise<void>;
    }>;
    drainTask(taskId: string): Promise<void>;
    quiesceTask(taskId: string): Promise<void>;
    exportTaskArchive(taskId: string): Promise<ConversationTaskArchive>;
    private archiveRows;
    preflightTaskArchive(taskId: string, data: unknown): Promise<void>;
    restoreTaskArchive(taskId: string, data: unknown): Promise<void>;
    dispose(): Promise<void>;
}
