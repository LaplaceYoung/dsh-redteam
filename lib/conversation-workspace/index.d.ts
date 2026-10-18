import type { Context } from '@deepseek-ai/cordis';
import type { RedTeamStore } from '../store.js';
import { ConversationRuntime, type ConversationRuntimeOptions } from './conversations.js';
import { WorkspaceFiles } from './files.js';
import { ChatMentionStore } from './mentions-store.js';
import { type SideParent, type SideQuestionsOptions } from './side-questions.js';
export interface ConversationWorkspaceOptions extends Pick<ConversationRuntimeOptions, 'profiles' | 'prepareRun' | 'resolveAgent' | 'resolveAgentProfile' | 'setupAgent' | 'bindTask' | 'onError'> {
    directory?: string;
    workspaceRoot?: string;
    /** Resolve pre-existing task main/worker native sessions not created by this service. */
    parentForSession?: SideQuestionsOptions['parentForSession'];
    modelIdentity?: SideQuestionsOptions['modelIdentity'];
}
export interface PreparedConversationDeletion {
    commit(): Promise<void>;
    rollback(): Promise<void>;
}
/** One host-owned instance; agent scopes only register tools against this instance. */
export declare function createConversationWorkspace(ctx: Context, store: RedTeamStore, options: ConversationWorkspaceOptions): Promise<{
    conversations: ConversationRuntime;
    sideQuestions: import("./side-questions.js").SideQuestionService;
    files: WorkspaceFiles;
    mentions: ChatMentionStore;
    acquireTaskOperation: (id: string) => Promise<() => void>;
    prepareTaskDelete: (taskId: string, settings?: {
        deleteFiles?: boolean;
    }) => Promise<PreparedConversationDeletion>;
    parentExists: (parent: SideParent) => Promise<boolean>;
    dispose: () => Promise<void>;
}>;
export type ConversationWorkspace = Awaited<ReturnType<typeof createConversationWorkspace>>;
export { installConversationWorkspaceTools } from './tools.js';
export { installConversationWorkspaceHttp, createConversationWorkspaceHandler } from './http.js';
export { ConversationRuntime } from './conversations.js';
export { WorkspaceFiles } from './files.js';
export { ChatMentionStore } from './mentions-store.js';
export { conversationHostDependencies, getConversationWorkspace, registerConversationPreset, isConversationWorkspaceAgent, conversationTaskForAgent, disposeConversationWorkspace } from './host.js';
