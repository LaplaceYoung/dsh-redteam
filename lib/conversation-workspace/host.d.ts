import type { Context } from '@deepseek-ai/cordis';
import type { Agent } from '@deepseek-ai/dsh-agent';
import type { RedTeamStore } from '../store.js';
import type { PlatformPrepareRun } from '../platform/contracts.js';
import { type ConversationWorkspace, type ConversationWorkspaceOptions } from './index.js';
/** Register only after the selected preset has installed all of its real tools. */
export interface ConversationPresetCapabilities extends Pick<ConversationWorkspaceOptions, 'profiles' | 'resolveAgent' | 'resolveAgentProfile' | 'bindTask'> {
    prepareRun: PlatformPrepareRun;
}
export interface ConversationHostOptions extends Pick<ConversationWorkspaceOptions, 'directory' | 'workspaceRoot' | 'parentForSession' | 'modelIdentity' | 'onError'> {
}
export declare const conversationHostDependencies: readonly ["agents", "agentPresets", "tools", "llm", "sessionQuery", "sessionPersistence", "sessionProjections"];
/** These Agents already receive an explicit Platform run; do not auto-attach another one. */
export declare function isConversationWorkspaceAgent(agent: Agent): boolean;
export declare function conversationTaskForAgent(agent: Agent): {
    taskId: string;
    agentKey: string;
} | undefined;
/** Synchronous registration cannot await (and thereby deadlock) preset activation. */
export declare function registerConversationPreset(ctx: Context, store: RedTeamStore, capabilities: ConversationPresetCapabilities): () => void;
/** Safe from either UI or preset startup; only conversation execution acquires a preset. */
export declare function getConversationWorkspace(ctx: Context, store: RedTeamStore, options?: ConversationHostOptions): Promise<ConversationWorkspace>;
/** Explicit plugin/host shutdown; normal Agent disposal never closes the workspace. */
export declare function disposeConversationWorkspace(ctx: Context, store: RedTeamStore): Promise<void>;
