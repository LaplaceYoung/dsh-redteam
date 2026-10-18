import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { isAbsolute, join } from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { SESSION_FORMAT_VERSION, SessionId, SessionLogOffset, type SessionEvent, type SessionHeader } from '@deepseek-ai/dsh-session';
import { assertContiguous, assertVersion, materializeCreateHeader, validateStoredEvents, type SessionHandle, type SessionInspection, type SessionPersistence } from '@deepseek-ai/dsh-session-persistence';
import type Subagents from '@deepseek-ai/dsh-subagent';
import type { RedTeamSnapshot } from './types.js';

interface SessionArchiveIndex { format: 'dsh-redteam-sessions'; version: 1; taskId: string; ids: string[] }
export interface TaskArchiveSupplement {
  prepare?(taskId: string, operation: 'archive' | 'restore'): Promise<{ release(): Promise<void> }>;
  capture(directory: string, taskId: string, snapshot: RedTeamSnapshot, additionalSessionIds?: readonly string[]): Promise<void>;
  restore(directory: string, taskId: string): Promise<void>;
}

function record(value: unknown): value is Record<string, unknown> { return typeof value === 'object' && value !== null && !Array.isArray(value); }

function decode(value: unknown, expectedId: string): SessionInspection {
  if (!record(value) || !record(value.meta) || !Array.isArray(value.events)) throw new Error('invalid archived session');
  const meta = value.meta;
  if (meta.id !== expectedId || typeof meta.id !== 'string' || !meta.id || meta.version !== SESSION_FORMAT_VERSION || typeof meta.isSeeded !== 'boolean'
    || typeof meta.createdAt !== 'number' || !Number.isSafeInteger(meta.createdAt) || meta.createdAt < 0
    || 'seedLength' in meta || (meta.cwd !== undefined && (typeof meta.cwd !== 'string' || !isAbsolute(meta.cwd))) || (meta.parentSession !== undefined && typeof meta.parentSession !== 'string')
    || (meta.agentPreset !== undefined && typeof meta.agentPreset !== 'string') || (meta.origin !== undefined && meta.origin !== 'subagent')
    || (meta.delegationDepth !== undefined && (typeof meta.delegationDepth !== 'number' || !Number.isSafeInteger(meta.delegationDepth) || meta.delegationDepth < 0))) throw new Error(`invalid archived session header: ${expectedId}`);
  const cut = value.inheritedEventCount;
  if (typeof cut !== 'number' || !Number.isSafeInteger(cut) || cut < 0 || cut > value.events.length || (!meta.isSeeded && cut !== 0) || (meta.isSeeded && !meta.parentSession)) throw new Error(`invalid archived inherited event count: ${expectedId}`);
  const header = materializeCreateHeader(meta as unknown as SessionHeader);
  assertVersion(header);
  // The public storage validator admits the serialized event vocabulary and payloads.
  const events = validateStoredEvents(header, value.events as SessionEvent[]);
  assertContiguous(header.id, events, 0);
  if (header.isSeeded && (events[cut]?.type !== 'session/end-seed' || !('inherited' in events[cut].data) || events[cut].data.inherited !== true)) throw new Error(`invalid archived fork boundary: ${expectedId}`);
  return { meta: header, inheritedEventCount: SessionLogOffset(cut), events };
}

async function inspect(handle: SessionHandle): Promise<SessionInspection> {
  const { events } = await handle.read();
  return { meta: handle.header, inheritedEventCount: handle.inheritedEventCount, events };
}

function compatible(archived: SessionInspection, current: SessionInspection): void {
  if (!isDeepStrictEqual(archived.meta, current.meta) || archived.inheritedEventCount !== current.inheritedEventCount) throw new Error(`session restore header conflict: ${archived.meta.id}`);
  const shared = Math.min(archived.events.length, current.events.length);
  for (let index = 0; index < shared; index++) {
    if (!isDeepStrictEqual(archived.events[index], current.events[index])) throw new Error(`session restore event conflict: ${archived.meta.id} seq ${index}`);
  }
}

/** Back up logical sessions through DSH's public handles. The original logs stay
 * in the host: persistence has no public delete operation and parents may be shared.
 */
export class SessionArchiveRuntime implements TaskArchiveSupplement {
  constructor(private readonly persistence: SessionPersistence, private readonly subagents: Pick<Subagents, 'listDescendants'>) {}

  async capture(directory: string, taskId: string, snapshot: RedTeamSnapshot, additionalSessionIds: readonly string[] = []): Promise<void> {
    const ids = new Set<string>(additionalSessionIds);
    const workers = new Set<string>(additionalSessionIds);
    for (const intent of snapshot.intents) {
      if (intent.taskId !== taskId || !intent.execution) continue;
      workers.add(intent.execution.childSessionId);
      ids.add(intent.execution.childSessionId);
      ids.add(intent.execution.parentSessionId);
    }
    for (const finding of snapshot.findings) {
      if (finding.taskId !== taskId) continue;
      for (const retest of finding.retests ?? []) {
        if (retest.status === 'pending' || retest.status === 'running') throw new Error(`finding retest is still active: ${retest.id}`);
        if (retest.sessionId) { ids.add(retest.sessionId); workers.add(retest.sessionId); }
      }
    }
    await this.persistence.flush();
    for (const id of workers) {
      for (const descendant of await this.subagents.listDescendants(SessionId(id))) {
        if (descendant.kind === 'diagnostic') throw new Error(`cannot archive descendant ${descendant.id}: ${descendant.reason}`);
        if (descendant.mode === 'external') continue; // No local session exists by DSH contract.
        if (descendant.activity === 'running') throw new Error(`descendant session is still resident: ${descendant.id}`);
        ids.add(descendant.id);
      }
    }
    await mkdir(directory, { recursive: true });
    const ordered: string[] = [];
    // Set iteration also visits newly discovered fork ancestors.
    for (const id of ids) {
      const handle = await this.persistence.open(SessionId(id), 'read');
      let session: SessionInspection;
      try { session = await inspect(handle); } finally { await handle.close(); }
      if (session.meta.parentSession) ids.add(session.meta.parentSession);
      await writeFile(join(directory, `${ordered.length}.json`), JSON.stringify(session), { flag: 'wx', mode: 0o600 });
      ordered.push(id);
    }
    const index: SessionArchiveIndex = { format: 'dsh-redteam-sessions', version: 1, taskId, ids: ordered };
    await writeFile(join(directory, 'index.json'), JSON.stringify(index), { flag: 'wx', mode: 0o600 });
  }

  async restore(directory: string, taskId: string): Promise<void> {
    const index: unknown = JSON.parse(await readFile(join(directory, 'index.json'), 'utf8'));
    if (!record(index) || index.format !== 'dsh-redteam-sessions' || index.version !== 1 || index.taskId !== taskId || !Array.isArray(index.ids)
      || index.ids.some(id => typeof id !== 'string' || !id) || new Set(index.ids).size !== index.ids.length) throw new Error('invalid session archive index');
    const sessions: SessionInspection[] = [];
    for (const [position, id] of index.ids.entries()) sessions.push(decode(JSON.parse(await readFile(join(directory, `${position}.json`), 'utf8')), id as string));
    const ids = new Set(sessions.map(session => session.meta.id));
    if (sessions.some(session => session.meta.parentSession && !ids.has(session.meta.parentSession))) throw new Error('session archive is missing a fork ancestor');
    // Validate every session and existing prefix before creating any new sessions.
    for (const session of sessions) {
      if (!await this.persistence.stat(session.meta.id)) continue;
      const handle = await this.persistence.open(session.meta.id, 'read');
      try { compatible(session, await inspect(handle)); } finally { await handle.close(); }
    }
    for (const session of sessions) {
      const existing = await this.persistence.stat(session.meta.id);
      if (existing) {
        const reader = await this.persistence.open(session.meta.id, 'read');
        try {
          const current = await inspect(reader);
          compatible(session, current);
          if (current.events.length >= session.events.length) continue;
        } finally { await reader.close(); }
      }
      const writer = existing
        ? await this.persistence.open(session.meta.id, 'write')
        : await this.persistence.create(session.meta, { inheritedEventCount: session.inheritedEventCount });
      try {
        const current = await inspect(writer);
        compatible(session, current);
        await writer.append(session.events.slice(current.events.length));
        await writer.flush();
      } finally { await writer.close(); }
      const verified = await this.persistence.open(session.meta.id, 'read');
      try {
        const current = await inspect(verified);
        compatible(session, current);
        if (current.events.length < session.events.length) throw new Error(`session restore incomplete: ${session.meta.id}`);
      } finally { await verified.close(); }
    }
  }
}
