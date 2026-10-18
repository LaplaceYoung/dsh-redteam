import type { RedTeamSnapshot } from './types.js';
import type { TaskArchiveSupplement } from './session-archive.js';
/** Traffic blobs are content-addressed and shared across tasks. Always copy them;
 * archiving or retrying a restore must never remove another task's evidence.
 */
export declare class TrafficArchiveRuntime implements TaskArchiveSupplement {
    private readonly root;
    constructor(root: string);
    private path;
    private verifyShard;
    capture(directory: string, taskId: string, snapshot: RedTeamSnapshot): Promise<void>;
    restore(directory: string, taskId: string): Promise<void>;
}
