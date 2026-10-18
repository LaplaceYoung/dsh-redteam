import type { TaskArchiveSupplement } from '../session-archive.js';
import type { ConversationRecord } from './conversations.js';
interface ArchiveParticipant {
    exportTaskArchive(taskId: string): Promise<unknown>;
    preflightTaskArchive(taskId: string, data: unknown): Promise<void>;
    restoreTaskArchive(taskId: string, data: unknown): Promise<void>;
}
export interface ConversationArchiveWorkspace {
    conversations: Omit<ArchiveParticipant, 'exportTaskArchive'> & {
        exportTaskArchive(taskId: string): Promise<{
            version: 1;
            conversations: ConversationRecord[];
        }>;
    };
    sideQuestions: ArchiveParticipant;
    prepareTaskDelete(taskId: string): Promise<{
        rollback(): Promise<void>;
    }>;
}
/** Metadata is retained like native DSH logs. The operation lease drains writers
 * and remains held through the owning task transaction, not just capture(). */
export declare function withConversationArchive(sessions: TaskArchiveSupplement, workspace: ConversationArchiveWorkspace): TaskArchiveSupplement;
export {};
