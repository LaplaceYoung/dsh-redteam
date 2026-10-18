import { type SessionPersistence } from '@deepseek-ai/dsh-session-persistence';
import type Subagents from '@deepseek-ai/dsh-subagent';
import type { RedTeamSnapshot } from './types.js';
export interface TaskArchiveSupplement {
    prepare?(taskId: string, operation: 'archive' | 'restore'): Promise<{
        release(): Promise<void>;
    }>;
    capture(directory: string, taskId: string, snapshot: RedTeamSnapshot, additionalSessionIds?: readonly string[]): Promise<void>;
    restore(directory: string, taskId: string): Promise<void>;
}
/** Back up logical sessions through DSH's public handles. The original logs stay
 * in the host: persistence has no public delete operation and parents may be shared.
 */
export declare class SessionArchiveRuntime implements TaskArchiveSupplement {
    private readonly persistence;
    private readonly subagents;
    constructor(persistence: SessionPersistence, subagents: Pick<Subagents, 'listDescendants'>);
    capture(directory: string, taskId: string, snapshot: RedTeamSnapshot, additionalSessionIds?: readonly string[]): Promise<void>;
    restore(directory: string, taskId: string): Promise<void>;
}
