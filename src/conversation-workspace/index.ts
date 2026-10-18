import { dirname, join } from 'node:path';
import type { Context } from '@deepseek-ai/cordis';
import type { RedTeamStore } from '../store.js';
import { ConversationRuntime, type ConversationRuntimeOptions } from './conversations.js';
import { WorkspaceFiles, WorkspaceFileError, composeAgentMessage } from './files.js';
import { ChatMentionStore } from './mentions-store.js';
import { composeChatMentionMessage } from './files-mentions.js';
import { installSideQuestions, type SideParent, type SideQuestionsOptions } from './side-questions.js';

export interface ConversationWorkspaceOptions extends Pick<ConversationRuntimeOptions, 'profiles' | 'prepareRun' | 'resolveAgent' | 'resolveAgentProfile' | 'setupAgent' | 'bindTask' | 'onError'> {
  directory?: string;
  workspaceRoot?: string;
  /** Resolve pre-existing task main/worker native sessions not created by this service. */
  parentForSession?: SideQuestionsOptions['parentForSession'];
  modelIdentity?: SideQuestionsOptions['modelIdentity'];
}
export interface PreparedConversationDeletion { commit(): Promise<void>; rollback(): Promise<void> }

/** One host-owned instance; agent scopes only register tools against this instance. */
export async function createConversationWorkspace(ctx: Context, store: RedTeamStore, options: ConversationWorkspaceOptions) {
  const directory = options.directory ?? join(dirname(store.storagePath), 'conversation-workspace');
  const files = new WorkspaceFiles(options.workspaceRoot ?? join(dirname(store.storagePath), 'redteam'));
  await files.initialize();
  const mentions = new ChatMentionStore(store);
  const taskBlocked = new Set<string>(), operations = new Map<string, Set<Promise<void>>>();
  const deletions = new Map<string, Promise<PreparedConversationDeletion>>();
  const taskExists = (id: string) => {
    const state = store.snapshot();
    return !taskBlocked.has(id) && state.tasks.some(row => row.id === id) && !state.archives.some(row => row.taskId === id && ['archive_queued', 'archiving'].includes(row.state));
  };
  const acquireTaskOperation = async (id: string): Promise<() => void> => {
    if (taskBlocked.has(id)) throw new WorkspaceFileError('任务正在删除', 409);
    if (!taskExists(id)) throw new WorkspaceFileError('任务不存在或正在归档', 404);
    let release!: () => void;
    const pending = new Promise<void>(resolve => { release = resolve; });
    const active = operations.get(id) ?? new Set<Promise<void>>();
    active.add(pending); operations.set(id, active);
    return () => { active.delete(pending); if (!active.size) operations.delete(id); release(); };
  };
  const conversations = new ConversationRuntime(ctx, {
    ...options, storagePath: join(directory, 'conversations.json'), workspaceRoot: files.root, taskExists,
    prepareMessage: async (message, attachments, record) => {
      const text = await composeChatMentionMessage(message, ref => mentions.load(ref));
      const verified = await files.resolveAttachments(record.taskId ? 'task' : 'session', record.taskId ?? record.id, attachments);
      return composeAgentMessage(text, verified, record.cwd);
    },
    prepareSideQuestionDelete: id => sideQuestions.prepareParentDelete({ kind: 'conversation', id }),
  });
  await conversations.initialize();
  const parentExists = async (parent: SideParent): Promise<boolean> => {
    if (parent.kind === 'conversation') return (await conversations.list()).some(row => row.id === parent.id);
    if (!taskExists(parent.id) || taskBlocked.has(parent.id)) return false;
    if (parent.intentId) return store.snapshot().intents.some(row => row.id === parent.intentId && row.taskId === parent.id && !['stopped', 'exhausted', 'failed'].includes(row.state));
    if (parent.explorationId) return (await conversations.list({ taskId: parent.id })).some(row => row.id === parent.explorationId);
    return true;
  };
  const sideQuestions = await installSideQuestions(ctx, {
    directory, parentExists, modelIdentity: options.modelIdentity, onError: options.onError,
    prepareQuestion: (_parent, question) => composeChatMentionMessage(question, ref => mentions.load(ref)),
    parentForSession: async sessionId => {
      const row = (await conversations.list()).find(item => item.sessionId === sessionId);
      if (row) return row.taskId ? { kind: 'task', id: row.taskId, explorationId: row.id } : { kind: 'conversation', id: row.id };
      const external = await options.parentForSession?.(sessionId); if (external) return external;
      const intent = store.snapshot().intents.find(item => item.execution?.childSessionId === sessionId);
      return intent ? { kind: 'task', id: intent.taskId, intentId: intent.id } : undefined;
    },
  });
  const prepareTaskDelete = (taskId: string, settings: { deleteFiles?: boolean } = {}): Promise<PreparedConversationDeletion> => {
    const existing = deletions.get(taskId); if (existing) return existing;
    taskBlocked.add(taskId);
    const pending = (async () => {
      const prepared: PreparedConversationDeletion[] = [];
      try {
        await Promise.all(operations.get(taskId) ?? []);
        prepared.push(await sideQuestions.prepareTaskDelete(taskId));
        prepared.push(await conversations.prepareTaskDelete(taskId));
        if (settings.deleteFiles) prepared.push(await files.stageTaskDelete(taskId));
      } catch (error) {
        await Promise.all(prepared.map(item => item.rollback())); taskBlocked.delete(taskId); deletions.delete(taskId); throw error;
      }
      let committed = false;
      return {
        commit: async () => { if (committed) return; for (const item of prepared) await item.commit(); committed = true; taskBlocked.delete(taskId); deletions.delete(taskId); },
        rollback: async () => { if (committed) return; for (const item of [...prepared].reverse()) await item.rollback(); taskBlocked.delete(taskId); deletions.delete(taskId); },
      };
    })();
    deletions.set(taskId, pending); return pending;
  };
  const dispose = async () => { await sideQuestions.dispose(); await conversations.dispose(); };
  ctx.effect(() => dispose);
  return { conversations, sideQuestions, files, mentions, acquireTaskOperation, prepareTaskDelete, parentExists, dispose };
}
export type ConversationWorkspace = Awaited<ReturnType<typeof createConversationWorkspace>>;
export { installConversationWorkspaceTools } from './tools.js';
export { installConversationWorkspaceHttp, createConversationWorkspaceHandler } from './http.js';
export { ConversationRuntime } from './conversations.js';
export { WorkspaceFiles } from './files.js';
export { ChatMentionStore } from './mentions-store.js';
export { conversationHostDependencies, getConversationWorkspace, registerConversationPreset, isConversationWorkspaceAgent, conversationTaskForAgent, disposeConversationWorkspace } from './host.js';
