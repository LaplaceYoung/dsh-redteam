import type { IncomingMessage, ServerResponse } from 'node:http';
import { WorkspaceFiles } from './files.js';
export interface WorkspaceFilesHttpOptions {
    authenticate(request: IncomingMessage): Promise<void>;
    /** Checks task existence and holds the task deletion drain lease until upload completes. */
    acquireTaskOperation?(taskId: string): Promise<() => void>;
    prefix?: string;
}
/** Returns false for another route; authentication is always performed before file or body access. */
export declare function createWorkspaceFilesHandler(files: WorkspaceFiles, options: WorkspaceFilesHttpOptions): (request: IncomingMessage, response: ServerResponse) => Promise<boolean>;
