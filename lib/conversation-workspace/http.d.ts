import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Context } from '@deepseek-ai/cordis';
import type { ConversationWorkspace } from './index.js';
export interface ConversationWorkspaceHttpOptions {
    authenticate(request: IncomingMessage): boolean | 401 | 403 | Promise<boolean | 401 | 403>;
}
export declare function createConversationWorkspaceHandler(runtime: ConversationWorkspace, options: ConversationWorkspaceHttpOptions): (request: IncomingMessage, response: ServerResponse) => Promise<boolean>;
export declare function installConversationWorkspaceHttp(ctx: Context, runtime: ConversationWorkspace, options: ConversationWorkspaceHttpOptions): () => void;
