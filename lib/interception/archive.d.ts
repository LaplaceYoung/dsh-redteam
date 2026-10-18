import type { TaskArchiveSupplement } from '../session-archive.js';
import type { RedTeamSnapshot } from '../types.js';
import { InterceptionRepository } from './repository.js';
/** Like native session logs, the live audit is retained; export is a complete independent backup. */
export declare class InterceptionArchive implements TaskArchiveSupplement {
    readonly repository: InterceptionRepository;
    constructor(repository: InterceptionRepository);
    capture(directory: string, taskId: string, _snapshot: RedTeamSnapshot): Promise<void>;
    restore(directory: string, taskId: string): Promise<void>;
    preflight(directory: string, taskId: string): Promise<void>;
}
/** Keep the existing session manifest marker and directory layout backward compatible. */
export declare function withInterceptionArchive(sessions: TaskArchiveSupplement, repository: InterceptionRepository): TaskArchiveSupplement;
