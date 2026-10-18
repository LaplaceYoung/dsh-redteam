import { createReadStream } from 'node:fs';
import { createHash } from 'node:crypto';
import { link, lstat, mkdir, unlink } from 'node:fs/promises';
import { join } from 'node:path';
async function verify(path, body) {
    const info = await lstat(path);
    if (!info.isFile() || info.isSymbolicLink() || info.size !== body.length)
        throw new Error(`invalid incoming traffic blob: ${body.hash}`);
    const hash = createHash('sha256');
    for await (const chunk of createReadStream(path))
        hash.update(chunk);
    if (hash.digest('hex') !== body.hash)
        throw new Error(`incoming traffic checksum mismatch: ${body.hash}`);
}
async function remove(path) { try {
    await unlink(path);
}
catch (error) {
    if (error.code !== 'ENOENT')
        throw error;
} }
/** Python writes private incoming files. Promotion and row publication share the
 * same mutation lock as deletion, so GC never races a not-yet-indexed body. */
export function incomingTrafficRecord(input, incomingRoot, blobRoot) {
    const record = structuredClone(input);
    const incoming = [];
    for (const key of ['request', 'response']) {
        const part = record[key];
        if (!part || typeof part !== 'object' || !('bodyFile' in part))
            continue;
        if (typeof part.bodyFile !== 'string' || !/^[a-f0-9]{64}\.[a-zA-Z0-9_-]+\.bin$/.test(part.bodyFile)
            || !('bodySha256' in part) || typeof part.bodySha256 !== 'string' || !/^[a-f0-9]{64}$/.test(part.bodySha256)
            || !part.bodyFile.startsWith(`${part.bodySha256}.`) || !('bodyLength' in part) || typeof part.bodyLength !== 'number'
            || !Number.isSafeInteger(part.bodyLength) || part.bodyLength < 0)
            throw new Error('invalid incoming traffic body descriptor');
        incoming.push({ source: join(incomingRoot, part.bodyFile), hash: part.bodySha256, length: part.bodyLength });
        delete part.bodyFile;
    }
    const prepare = async () => {
        const created = [];
        const rollback = async () => {
            const results = await Promise.allSettled([...created, ...incoming.map(body => body.source)].map(remove));
            const errors = results.flatMap(result => result.status === 'rejected' ? [result.reason] : []);
            if (errors.length)
                throw new AggregateError(errors, 'traffic blob cleanup failed');
        };
        try {
            for (const body of incoming) {
                await verify(body.source, body);
                const shard = join(blobRoot, body.hash.slice(0, 2));
                await mkdir(shard, { recursive: true });
                const info = await lstat(shard);
                if (!info.isDirectory() || info.isSymbolicLink())
                    throw new Error('invalid traffic blob shard');
                const target = join(shard, `${body.hash}.bin`);
                try {
                    await link(body.source, target);
                    created.push(target);
                }
                catch (error) {
                    if (error.code !== 'EEXIST')
                        throw error;
                    await verify(target, body);
                }
                await remove(body.source);
            }
            return rollback;
        }
        catch (error) {
            try {
                await rollback();
            }
            catch (cleanup) {
                throw new AggregateError([error, cleanup], 'traffic blob promotion and cleanup failed');
            }
            throw error;
        }
    };
    return { record, prepare };
}
