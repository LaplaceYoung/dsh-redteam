import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { TaskArchiveSupplement } from '../session-archive.js';
import type { ConversationRecord } from './conversations.js';

interface ArchiveParticipant {
  exportTaskArchive(taskId: string): Promise<unknown>;
  preflightTaskArchive(taskId: string, data: unknown): Promise<void>;
  restoreTaskArchive(taskId: string, data: unknown): Promise<void>;
}
export interface ConversationArchiveWorkspace {
  conversations: Omit<ArchiveParticipant, 'exportTaskArchive'> & {
    exportTaskArchive(taskId: string): Promise<{ version: 1; conversations: ConversationRecord[] }>;
  };
  sideQuestions: ArchiveParticipant;
  prepareTaskDelete(taskId: string): Promise<{ rollback(): Promise<void> }>;
}
interface Bundle {
  format: 'dsh-redteam-conversations'; version: 1; taskId: string;
  conversations: unknown; sideQuestions: unknown;
}

async function readBundle(directory: string, taskId: string): Promise<Bundle | undefined> {
  let raw: string;
  try { raw = await readFile(join(directory, 'conversations.json'), 'utf8'); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return; throw error; }
  const value: unknown = JSON.parse(raw);
  if (!value || typeof value !== 'object' || !('format' in value) || value.format !== 'dsh-redteam-conversations'
    || !('version' in value) || value.version !== 1 || !('taskId' in value) || value.taskId !== taskId
    || !('conversations' in value) || !('sideQuestions' in value)) throw new Error('Invalid conversation workspace archive');
  return value as Bundle;
}

/** Metadata is retained like native DSH logs. The operation lease drains writers
 * and remains held through the owning task transaction, not just capture(). */
export function withConversationArchive(sessions: TaskArchiveSupplement, workspace: ConversationArchiveWorkspace): TaskArchiveSupplement {
  return {
    async prepare(taskId, operation) {
      const conversation = await workspace.prepareTaskDelete(taskId);
      let inner: { release(): Promise<void> } | undefined;
      try { inner = await sessions.prepare?.(taskId, operation); }
      catch (error) { await conversation.rollback(); throw error; }
      return { async release() { try { await inner?.release(); } finally { await conversation.rollback(); } } };
    },
    async capture(directory, taskId, snapshot, additionalSessionIds = []) {
      const conversations = await workspace.conversations.exportTaskArchive(taskId);
      const sideQuestions = await workspace.sideQuestions.exportTaskArchive(taskId);
      await sessions.capture(directory, taskId, snapshot, [...new Set([...additionalSessionIds, ...conversations.conversations.map(row => row.sessionId)])]);
      const data: Bundle = { format: 'dsh-redteam-conversations', version: 1, taskId, conversations, sideQuestions };
      await mkdir(directory, { recursive: true });
      await writeFile(join(directory, 'conversations.json'), JSON.stringify(data), { flag: 'wx', mode: 0o600 });
    },
    async restore(directory, taskId) {
      const data = await readBundle(directory, taskId);
      if (data) {
        await workspace.conversations.preflightTaskArchive(taskId, data.conversations);
        await workspace.sideQuestions.preflightTaskArchive(taskId, data.sideQuestions);
      }
      await sessions.restore(directory, taskId);
      if (data) {
        await workspace.conversations.restoreTaskArchive(taskId, data.conversations);
        await workspace.sideQuestions.restoreTaskArchive(taskId, data.sideQuestions);
      }
    },
  };
}
