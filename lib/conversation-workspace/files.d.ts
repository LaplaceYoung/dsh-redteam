export declare const maxWorkspaceRead: number;
export declare const maxWorkspaceUpload: number;
export declare const maxChatUpload: number;
export declare class WorkspaceFileError extends Error {
    readonly status: number;
    constructor(message: string, status?: number);
}
export interface WorkspaceUpload {
    name: string;
    data: AsyncIterable<Uint8Array>;
}
export interface ChatAttachment {
    name: string;
    path: string;
    size: number;
    abs: string;
}
export type ChatUploadScope = 'task' | 'session' | 'staging';
export interface WorkspaceEntry {
    name: string;
    path: string;
    dir: boolean;
    size: number;
    mtime: number;
}
export interface WorkspaceRead {
    path: string;
    size: number;
    binary: boolean;
    too_large?: true;
    content?: string;
}
export interface TaskFileDeleteStage {
    deleted: boolean;
    commit(): Promise<void>;
    rollback(): Promise<void>;
}
/** The root is the actual agent working directory. All operations require initialization. */
export declare class WorkspaceFiles {
    readonly root: string;
    private initialized;
    private canonicalRoot;
    constructor(root: string);
    initialize(): Promise<void>;
    private rel;
    resolvePath(path: string, allowRoot?: boolean): Promise<string>;
    list(path?: string): Promise<{
        path: string;
        entries: WorkspaceEntry[];
    }>;
    read(path: string): Promise<WorkspaceRead>;
    write(path: string, content: string): Promise<{
        ok: true;
        path: string;
    }>;
    mkdir(path: string): Promise<{
        ok: true;
        path: string;
    }>;
    delete(path: string): Promise<{
        ok: true;
    }>;
    download(path: string): Promise<{
        name: string;
        size: number;
        stream: import("fs").ReadStream;
        contentDisposition: string;
    }>;
    private save;
    upload(directory: string, files: AsyncIterable<WorkspaceUpload>): Promise<{
        uploaded: number;
    }>;
    chatUpload(scope: ChatUploadScope, id: string, files: AsyncIterable<WorkspaceUpload>): Promise<{
        attachments: ChatAttachment[];
    }>;
    /** Re-read attachment paths at the user-input boundary; ignore client supplied size/absolute path. */
    resolveAttachments(scope: ChatUploadScope, id: string, attachments: readonly {
        path: string;
    }[]): Promise<ChatAttachment[]>;
    /** Caller first drains task operations. Only the task-owned directory is staged; SDK transcripts remain SDK-owned. */
    stageTaskDelete(taskId: string): Promise<TaskFileDeleteStage>;
}
export declare function composeAgentMessage(message: string, attachments: readonly ChatAttachment[], baseDir: string): string;
