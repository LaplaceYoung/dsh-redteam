import type { RedTeamSnapshot, RedTeamTask } from './types.js';
import type { TaskArchiveSupplement } from './session-archive.js';
export interface ArchiveRecord {
    id: string;
    taskId: string;
    state: 'queued' | 'failed' | 'archive_queued' | 'archiving' | 'archive_failed' | 'ready' | 'restore_queued' | 'restoring' | 'restore_failed' | 'delete_queued' | 'deleting' | 'delete_failed';
    progress: number;
    phase?: string;
    error?: string;
    warnings?: string[];
    formatVersion?: number;
    archivePath?: string;
    sha256?: string;
    originalSize?: number;
    compressedSize?: number;
    taskTitle?: string;
    taskGoal?: string;
    originalStatus?: RedTeamTask['status'];
    dataCounts?: Record<string, number>;
    createdAt: string;
    updatedAt: string;
}
export interface ArchiveStore {
    readonly storagePath: string;
    load(): Promise<void>;
    snapshot(): RedTeamSnapshot;
    transaction<T>(mutator: (snapshot: RedTeamSnapshot) => T): Promise<T>;
}
export interface ArchiveFile {
    root: string;
    path: string;
}
export interface ArchiveOptions {
    dataDir: string;
    fileRoots?: Record<string, string>;
    sessions?: TaskArchiveSupplement;
    trafficBodies?: TaskArchiveSupplement;
    lifecycle: {
        quiesce(taskId: string): Promise<void>;
        files?(taskId: string, snapshot: RedTeamSnapshot): Promise<ArchiveFile[]>;
    };
}
export declare class ArchiveRuntime {
    private readonly store;
    private readonly options;
    private readonly root;
    private readonly roots;
    constructor(store: ArchiveStore, options: ArchiveOptions);
    private serial;
    private job;
    private patch;
    private source;
    private staged;
    private packagePath;
    private rollback;
    archive(taskId: string): Promise<ArchiveRecord>;
    private runArchive;
    private archiveQuiesced;
    restore(id: string): Promise<string[]>;
    private runRestore;
    private restoreLocked;
    delete(id: string): Promise<void>;
    private runDelete;
    /** Resolve journaled file moves before resuming durable queued operations. */
    recover(): Promise<void>;
}
