import type { IncomingMessage, ServerResponse } from 'node:http';
import { createReadStream } from 'node:fs';
import { mkdtemp, open, rm, type FileHandle } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { WorkspaceFiles, WorkspaceFileError, maxChatUpload, maxWorkspaceUpload, type ChatUploadScope, type WorkspaceUpload } from './files.js';

export interface WorkspaceFilesHttpOptions {
  authenticate(request: IncomingMessage): Promise<void>;
  /** Checks task existence and holds the task deletion drain lease until upload completes. */
  acquireTaskOperation?(taskId: string): Promise<() => void>;
  prefix?: string;
}
interface SpoolFile { name: string; path: string }
/** Bounded-memory multipart parser. File bytes go directly to private temporary files. */
async function spoolMultipart(request: IncomingMessage, directory: string, limit: number): Promise<SpoolFile[]> {
  const type = request.headers['content-type'] ?? '';
  const match = /^multipart\/form-data\s*;.*\bboundary=(?:"([^"\r\n]+)"|([^;\s]+))/iu.exec(type);
  const boundary = match?.[1] ?? match?.[2];
  if (!boundary || boundary.length > 200 || /[^\x20-\x7e]/u.test(boundary)) throw new WorkspaceFileError('需要合法 multipart/form-data boundary');
  const first = Buffer.from(`--${boundary}`), delimiter = Buffer.from(`\r\n--${boundary}`);
  let buffer = Buffer.alloc(0), total = 0, state: 'first' | 'header' | 'body' | 'end' = 'first';
  let handle: FileHandle | undefined;
  const files: SpoolFile[] = [];
  const write = async (data: Uint8Array) => { if (handle && data.length) await handle.writeFile(data); };
  const process = async () => {
    while (true) {
      if (state === 'end') { buffer = Buffer.alloc(0); return; }
      if (state === 'first') {
        if (buffer.length < first.length + 2) return;
        if (!buffer.subarray(0, first.length).equals(first)) throw new WorkspaceFileError('multipart 起始边界无效');
        const suffix = buffer.subarray(first.length, first.length + 2).toString();
        if (suffix !== '\r\n' && suffix !== '--') throw new WorkspaceFileError('multipart 边界无效');
        buffer = buffer.subarray(first.length + 2); state = suffix === '--' ? 'end' : 'header';
      } else if (state === 'header') {
        const end = buffer.indexOf('\r\n\r\n');
        if (end === -1) { if (buffer.length > 65536) throw new WorkspaceFileError('multipart 头部过长'); return; }
        if (end > 65536) throw new WorkspaceFileError('multipart 头部过长');
        const headers = buffer.subarray(0, end).toString('utf8'); buffer = buffer.subarray(end + 4);
        const disposition = headers.split('\r\n').find(line => /^content-disposition:/iu.test(line));
        if (!disposition || !/^content-disposition:\s*form-data\s*;/iu.test(disposition)) throw new WorkspaceFileError('multipart Content-Disposition 无效');
        const field = /(?:^|;)\s*name="((?:\\.|[^"\\])*)"/u.exec(disposition)?.[1];
        const filename = /(?:^|;)\s*filename="((?:\\.|[^"\\])*)"/u.exec(disposition)?.[1];
        if (field === 'file' && filename !== undefined) {
          const name = filename.replace(/\\(["\\])/gu, '$1'), path = join(directory, String(files.length));
          handle = await open(path, 'wx', 0o600); files.push({ name, path });
        }
        state = 'body';
      } else {
        const index = buffer.indexOf(delimiter);
        if (index < 0) { const size = Math.max(0, buffer.length - delimiter.length - 2); await write(buffer.subarray(0, size)); buffer = buffer.subarray(size); return; }
        if (buffer.length < index + delimiter.length + 2) { await write(buffer.subarray(0, index)); buffer = buffer.subarray(index); return; }
        const suffix = buffer.subarray(index + delimiter.length, index + delimiter.length + 2).toString();
        if (suffix !== '\r\n' && suffix !== '--') { await write(buffer.subarray(0, index + 2)); buffer = buffer.subarray(index + 2); continue; }
        await write(buffer.subarray(0, index)); if (handle) { await handle.close(); handle = undefined; }
        buffer = buffer.subarray(index + delimiter.length + 2); state = suffix === '--' ? 'end' : 'header';
      }
    }
  };
  try {
    for await (const chunk of request.iterator({ destroyOnReturn: false })) {
      total += chunk.length; if (total > limit) throw new WorkspaceFileError('上传超出大小限制', 413);
      buffer = Buffer.concat([buffer, chunk]); await process();
    }
    // TypeScript cannot observe the state mutations inside process().
    if ((state as string) !== 'end') throw new WorkspaceFileError('multipart 上传不完整');
    if (!files.length) throw new WorkspaceFileError('缺少上传文件(表单字段 file)');
    return files;
  } finally { if (handle) await handle.close(); }
}
async function readJson(request: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = []; let size = 0;
  for await (const chunk of request.iterator({ destroyOnReturn: false })) { size += chunk.length; if (size > 16 << 20) throw new WorkspaceFileError('JSON 请求过大', 413); chunks.push(chunk); }
  try { const result: unknown = JSON.parse(Buffer.concat(chunks).toString('utf8')); if (!result || typeof result !== 'object' || Array.isArray(result)) throw new Error(); return result as Record<string, unknown>; }
  catch { throw new WorkspaceFileError('JSON 请求无效'); }
}
function stringField(body: Record<string, unknown>, key: string): string { const value = body[key]; if (typeof value !== 'string') throw new WorkspaceFileError(`${key} 必须是字符串`); return value; }
function send(response: ServerResponse, status: number, data: unknown) { response.writeHead(status, { 'content-type': 'application/json; charset=utf-8' }); response.end(JSON.stringify(data)); }

/** Returns false for another route; authentication is always performed before file or body access. */
export function createWorkspaceFilesHandler(files: WorkspaceFiles, options: WorkspaceFilesHttpOptions) {
  const prefix = options.prefix ?? '/api/redteam/conversation-workspace/files';
  return async (request: IncomingMessage, response: ServerResponse): Promise<boolean> => {
    const url = new URL(request.url ?? '/', 'http://localhost');
    if (!url.pathname.startsWith(`${prefix}/`)) return false;
    let release: (() => void) | undefined;
    try {
      await options.authenticate(request);
      const action = url.pathname.slice(prefix.length + 1), path = url.searchParams.get('path') ?? '';
      let result: unknown;
      if (request.method === 'GET' && action === 'list') result = await files.list(path);
      else if (request.method === 'GET' && action === 'read') result = await files.read(path);
      else if (request.method === 'GET' && action === 'download') {
        const download = await files.download(path);
        response.writeHead(200, { 'content-type': 'application/octet-stream', 'content-length': download.size, 'content-disposition': download.contentDisposition });
        await pipeline(download.stream, response); return true;
      } else if (request.method === 'POST' && (action === 'write' || action === 'mkdir')) {
        const body = await readJson(request), value = stringField(body, 'path');
        result = action === 'write' ? await files.write(value, stringField(body, 'content')) : await files.mkdir(value);
      } else if (request.method === 'DELETE' && action === 'delete') result = await files.delete(path);
      else if (request.method === 'POST' && (action === 'upload' || action === 'chat-upload')) {
        const scope = url.searchParams.get('scope') as ChatUploadScope, id = url.searchParams.get('id') ?? '';
        if (action === 'chat-upload') {
          if (!['task', 'session', 'staging'].includes(scope) || !/^[A-Za-z0-9_-]+$/u.test(id)) throw new WorkspaceFileError('scope 或 id 无效');
          if (scope === 'task') { if (!options.acquireTaskOperation) throw new WorkspaceFileError('任务上传需要删除生命周期保护', 503); release = await options.acquireTaskOperation(id); }
        }
        const temporary = await mkdtemp(join(tmpdir(), 'dsh-chat-upload-'));
        try {
          const saved = await spoolMultipart(request, temporary, action === 'upload' ? maxWorkspaceUpload : maxChatUpload);
          async function* inputs(): AsyncGenerator<WorkspaceUpload> { for (const file of saved) yield { name: file.name, data: createReadStream(file.path) }; }
          result = action === 'upload' ? await files.upload(path, inputs()) : await files.chatUpload(scope, id, inputs());
        } finally { await rm(temporary, { recursive: true, force: true }); }
      } else { send(response, 404, { error: '文件路由不存在' }); return true; }
      send(response, 200, result);
    } catch (error) {
      if (response.headersSent) response.destroy(error instanceof Error ? error : undefined);
      else {
        // Close rejected uploads without draining unbounded client bytes; preserve the HTTP error response.
        response.setHeader('connection', 'close');
        const code = (error as NodeJS.ErrnoException).code;
        const status = error instanceof WorkspaceFileError ? error.status : code === 'ENOENT' ? 404 : code === 'EISDIR' || code === 'ENOTDIR' ? 400 : typeof (error as { status?: unknown }).status === 'number' ? (error as { status: number }).status : 500;
        send(response, status, { error: error instanceof Error ? error.message : String(error) });
      }
    } finally { release?.(); }
    return true;
  };
}
