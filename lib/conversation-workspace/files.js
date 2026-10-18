import { constants } from 'node:fs';
import { lstat, mkdir, open, readdir, realpath, rename, rm, stat, link } from 'node:fs/promises';
import { basename, dirname, extname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { randomUUID } from 'node:crypto';
export const maxWorkspaceRead = 2 << 20;
export const maxWorkspaceUpload = 512 << 20;
export const maxChatUpload = 128 << 20;
export class WorkspaceFileError extends Error {
    status;
    constructor(message, status = 400) {
        super(message);
        this.status = status;
        this.name = 'WorkspaceFileError';
    }
}
function missing(error) { return error.code === 'ENOENT'; }
function safeName(name) {
    const value = basename(name.replaceAll('\\', '/'));
    if (!value || value === '.' || value === '..' || /[\x00-\x1f<>:"|?*]/u.test(value) || /[. ]$/u.test(value) || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/iu.test(value))
        throw new WorkspaceFileError('非法文件名');
    return value;
}
/** The root is the actual agent working directory. All operations require initialization. */
export class WorkspaceFiles {
    root;
    initialized = false;
    canonicalRoot = '';
    constructor(root) { this.root = resolve(root); }
    async initialize() { await mkdir(this.root, { recursive: true }); this.canonicalRoot = await realpath(this.root); this.initialized = true; }
    rel(path) { return relative(this.root, path).split(sep).join('/'); }
    async resolvePath(path, allowRoot = true) {
        if (!this.initialized)
            throw new Error('WorkspaceFiles.initialize() must complete before use');
        if (typeof path !== 'string' || /[\x00-\x1f]/u.test(path))
            throw new WorkspaceFileError('非法路径');
        const normalized = path.trim().replaceAll('\\', '/');
        if (isAbsolute(normalized) || /^[A-Za-z]:/u.test(normalized))
            throw new WorkspaceFileError('路径必须相对工作目录');
        const absolute = resolve(this.root, normalized);
        const rel = relative(this.root, absolute);
        if (rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel) || (!allowRoot && !rel))
            throw new WorkspaceFileError('路径不能越过或替换工作区根目录');
        if (await realpath(this.root) !== this.canonicalRoot)
            throw new WorkspaceFileError('工作目录已改变', 409);
        let current = this.root;
        for (const part of rel.split(sep).filter(Boolean)) {
            safeName(part);
            current = join(current, part);
            try {
                if ((await lstat(current)).isSymbolicLink())
                    throw new WorkspaceFileError('不允许通过符号链接访问工作区文件');
            }
            catch (error) {
                if (!missing(error))
                    throw error;
            }
        }
        return absolute;
    }
    async list(path = '') {
        const absolute = await this.resolvePath(path);
        if (!(await stat(absolute)).isDirectory())
            throw new WorkspaceFileError('不是目录');
        const entries = [];
        for (const entry of await readdir(absolute, { withFileTypes: true })) {
            const file = join(absolute, entry.name), info = await lstat(file);
            entries.push({ name: entry.name, path: this.rel(file), dir: info.isDirectory(), size: info.size, mtime: Math.trunc(info.mtimeMs) });
        }
        entries.sort((a, b) => Number(b.dir) - Number(a.dir) || (a.name.toLowerCase() < b.name.toLowerCase() ? -1 : a.name.toLowerCase() > b.name.toLowerCase() ? 1 : 0));
        return { path: this.rel(absolute), entries };
    }
    async read(path) {
        const absolute = await this.resolvePath(path, false);
        const handle = await open(absolute, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
        try {
            const info = await handle.stat();
            if (!info.isFile())
                throw new WorkspaceFileError('不是普通文件');
            const result = { path: this.rel(absolute), size: info.size, binary: true };
            if (info.size > maxWorkspaceRead)
                return { ...result, too_large: true };
            // Bound the read even when another process grows the file after stat.
            const buffer = Buffer.alloc(maxWorkspaceRead + 1);
            let size = 0;
            while (size < buffer.length) {
                const read = await handle.read(buffer, size, buffer.length - size, null);
                if (!read.bytesRead)
                    break;
                size += read.bytesRead;
            }
            if (size > maxWorkspaceRead)
                return { ...result, size, too_large: true };
            const data = buffer.subarray(0, size);
            if (data.includes(0))
                return { ...result, size };
            try {
                return { ...result, size, binary: false, content: new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(data) };
            }
            catch {
                return { ...result, size };
            }
        }
        finally {
            await handle.close();
        }
    }
    async write(path, content) {
        if (typeof content !== 'string')
            throw new WorkspaceFileError('content 必须是字符串');
        const absolute = await this.resolvePath(path, false);
        await mkdir(dirname(absolute), { recursive: true });
        await this.resolvePath(path, false);
        const handle = await open(absolute, constants.O_WRONLY | constants.O_CREAT | constants.O_TRUNC | (constants.O_NOFOLLOW ?? 0), 0o644);
        try {
            await handle.writeFile(content, 'utf8');
        }
        finally {
            await handle.close();
        }
        return { ok: true, path: this.rel(absolute) };
    }
    async mkdir(path) {
        const absolute = await this.resolvePath(path, false);
        await mkdir(absolute, { recursive: true });
        return { ok: true, path: this.rel(absolute) };
    }
    async delete(path) {
        const absolute = await this.resolvePath(path, false);
        await lstat(absolute);
        await rm(absolute, { recursive: true });
        return { ok: true };
    }
    async download(path) {
        const absolute = await this.resolvePath(path, false), handle = await open(absolute, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
        try {
            const info = await handle.stat();
            if (!info.isFile())
                throw new WorkspaceFileError('文件不存在', 404);
            const name = basename(absolute), fallback = name.replace(/["\\\r\n]/gu, '').replace(/[^\x20-\x7e]/gu, '_');
            return { name, size: info.size, stream: handle.createReadStream(), contentDisposition: `attachment; filename="${fallback}"; filename*=UTF-8''${encodeURIComponent(name).replace(/['()*]/gu, c => `%${c.charCodeAt(0).toString(16).toUpperCase()}`)}` };
        }
        catch (error) {
            await handle.close();
            throw error;
        }
    }
    async save(directory, files, limit, unique) {
        const absolute = await this.resolvePath(directory);
        try {
            if (!(await stat(absolute)).isDirectory())
                throw new WorkspaceFileError('目标目录不存在');
        }
        catch (error) {
            if (missing(error))
                throw new WorkspaceFileError('目标目录不存在');
            throw error;
        }
        const result = [];
        let total = 0;
        for await (const file of files) {
            const name = safeName(file.name), temp = join(absolute, `.upload-${randomUUID()}`);
            const handle = await open(temp, 'wx', 0o600);
            let size = 0;
            try {
                try {
                    for await (const chunk of file.data) {
                        total += chunk.byteLength;
                        size += chunk.byteLength;
                        if (total > limit)
                            throw new WorkspaceFileError('上传超出大小限制', 413);
                        await handle.writeFile(chunk);
                    }
                }
                finally {
                    await handle.close();
                }
                let dest = join(absolute, name);
                await this.resolvePath(this.rel(dest), false);
                if (unique) {
                    const ext = extname(name), stem = name.slice(0, name.length - ext.length);
                    for (let index = 0;; index++) {
                        dest = join(absolute, index ? `${stem}-${index}${ext}` : name);
                        try {
                            await link(temp, dest);
                            break;
                        }
                        catch (error) {
                            if (error.code !== 'EEXIST')
                                throw error;
                        }
                    }
                }
                else
                    await rename(temp, dest);
                result.push({ name: basename(dest), path: this.rel(dest), size, abs: dest });
            }
            finally {
                await rm(temp, { force: true });
            }
        }
        if (!result.length)
            throw new WorkspaceFileError('缺少上传文件(表单字段 file)');
        return result;
    }
    async upload(directory, files) { return { uploaded: (await this.save(directory, files, maxWorkspaceUpload, false)).length }; }
    async chatUpload(scope, id, files) {
        const folder = { task: 'tasks', session: 'sessions', staging: 'drafts' }[scope];
        if (!folder || !/^[A-Za-z0-9_-]+$/u.test(id))
            throw new WorkspaceFileError('scope 或 id 无效');
        const directory = `${folder}/${id}/uploads`;
        await this.mkdir(directory);
        const attachments = await this.save(directory, files, maxChatUpload, true);
        return { attachments: attachments.map(file => ({ ...file, path: `uploads/${file.name}` })) };
    }
    /** Re-read attachment paths at the user-input boundary; ignore client supplied size/absolute path. */
    async resolveAttachments(scope, id, attachments) {
        const folder = { task: 'tasks', session: 'sessions', staging: 'drafts' }[scope];
        if (!folder || !/^[A-Za-z0-9_-]+$/u.test(id))
            throw new WorkspaceFileError('scope 或 id 无效');
        const result = [];
        for (const attachment of attachments) {
            if (typeof attachment.path !== 'string' || !/^uploads\/[^/\\]+$/u.test(attachment.path))
                throw new WorkspaceFileError('附件必须位于当前会话 uploads 目录');
            const name = safeName(attachment.path.slice('uploads/'.length));
            const absolute = await this.resolvePath(`${folder}/${id}/uploads/${name}`, false), info = await stat(absolute);
            if (!info.isFile())
                throw new WorkspaceFileError('附件不是普通文件');
            result.push({ name, path: `uploads/${name}`, size: info.size, abs: absolute });
        }
        return result;
    }
    /** Caller first drains task operations. Only the task-owned directory is staged; SDK transcripts remain SDK-owned. */
    async stageTaskDelete(taskId) {
        if (!/^[A-Za-z0-9_-]+$/u.test(taskId))
            throw new WorkspaceFileError('非法任务 id');
        const sourceRelative = `tasks/${taskId}`, source = await this.resolvePath(sourceRelative, false);
        try {
            await lstat(source);
        }
        catch (error) {
            if (!missing(error))
                throw error;
            return { deleted: false, commit: async () => { }, rollback: async () => { } };
        }
        const stageRelative = `.delete-staging/task-${taskId}-${randomUUID()}`;
        await this.mkdir(stageRelative);
        const stage = await this.resolvePath(stageRelative, false), staged = join(stage, 'workspace');
        try {
            await rename(source, staged);
        }
        catch (error) {
            await rm(stage, { recursive: true });
            throw error;
        }
        let done = false, restored = false;
        return {
            deleted: true,
            commit: async () => {
                if (done)
                    return;
                const verified = await this.resolvePath(stageRelative, false);
                await rm(verified, { recursive: true });
                done = true;
            },
            rollback: async () => {
                if (done)
                    return;
                if (!restored) {
                    const verified = await this.resolvePath(sourceRelative, false);
                    try {
                        await lstat(verified);
                        throw new WorkspaceFileError('恢复任务文件的目标已经存在', 409);
                    }
                    catch (error) {
                        if (!missing(error))
                            throw error;
                    }
                    await this.resolvePath(`${stageRelative}/workspace`, false);
                    await mkdir(dirname(verified), { recursive: true });
                    await rename(staged, verified);
                    restored = true;
                }
                await rm(await this.resolvePath(stageRelative, false), { recursive: true });
                done = true;
            },
        };
    }
}
export function composeAgentMessage(message, attachments, baseDir) {
    if (!attachments.length)
        return message;
    for (const file of attachments) {
        if (!/^uploads\/[^/\\]+$/u.test(file.path) || safeName(file.path.slice('uploads/'.length)) !== file.name || !Number.isSafeInteger(file.size) || file.size < 0)
            throw new WorkspaceFileError('附件清单无效');
    }
    const humanBytes = (size) => size >= 1 << 20 ? `${(size / (1 << 20)).toFixed(1)} MB` : size >= 1 << 10 ? `${(size / (1 << 10)).toFixed(1)} KB` : `${size} B`;
    return message + '\n\n【用户上传的附件】(绝对路径，需要时用 Read/Bash 查看)：' + attachments.map(file => `\n- ${resolve(baseDir, file.path)}（${humanBytes(file.size)}）`).join('');
}
