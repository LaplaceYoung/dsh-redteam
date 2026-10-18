import { createHash, randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { FindingsError } from './types.js';
const roles = ['baseline', 'proof', 'verification', 'supporting'];
export function assertRole(role) { if (!roles.includes(role))
    throw new FindingsError('invalid', `invalid traffic role: ${role}`); }
export function sha256(bytes) { return createHash('sha256').update(bytes).digest('hex'); }
export function verifyBody(body) {
    const bytes = Buffer.from(body.bodyBase64, 'base64');
    if (bytes.length !== body.length || sha256(bytes) !== body.sha256)
        throw new FindingsError('integrity', 'evidence body hash or length mismatch');
    return bytes;
}
export function normalizeTrafficRefs(refs) {
    const seen = new Set();
    return refs.flatMap(ref => {
        if (typeof ref.trafficId !== 'string' || !ref.trafficId.trim())
            throw new FindingsError('invalid', 'trafficId is required');
        const id = ref.trafficId.trim(), role = ref.role ?? 'supporting';
        assertRole(role);
        if (ref.note !== undefined && typeof ref.note !== 'string')
            throw new FindingsError('invalid', 'traffic note must be text');
        if (seen.has(id))
            return [];
        seen.add(id);
        return [{ trafficId: id, role, note: ref.note ?? '' }];
    });
}
function object(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value))
        throw new FindingsError('invalid', 'traffic message is unavailable');
    return value;
}
async function captureBody(value, storagePath) {
    const message = object(value);
    let body;
    if (typeof message.bodySha256 === 'string') {
        const hash = message.bodySha256;
        if (!/^[a-f0-9]{64}$/.test(hash))
            throw new FindingsError('invalid', 'invalid traffic blob hash');
        body = await readFile(join(dirname(storagePath), 'redteam', 'traffic', '_blobs', 'sha256', hash.slice(0, 2), `${hash}.bin`));
        if (sha256(body) !== hash)
            throw new FindingsError('integrity', 'source traffic blob hash mismatch');
    }
    else if (typeof message.bodyBase64 === 'string') {
        body = Buffer.from(message.bodyBase64, 'base64');
        if (body.toString('base64') !== message.bodyBase64)
            throw new FindingsError('invalid', 'invalid traffic body base64');
    }
    else if (typeof message.body === 'string')
        body = Buffer.from(message.body);
    else if (message.bodyLength === 0)
        body = Buffer.alloc(0);
    else
        throw new FindingsError('unavailable', 'original traffic body is unavailable');
    if (message.bodyLength !== undefined && message.bodyLength !== body.length)
        throw new FindingsError('integrity', 'source traffic body length mismatch');
    if (typeof message.startLine !== 'string')
        throw new FindingsError('unavailable', 'original HTTP start line is unavailable');
    let headers;
    if (Array.isArray(message.headerFields))
        headers = message.headerFields.map(pair => {
            if (!Array.isArray(pair) || pair.length !== 2 || pair.some(item => typeof item !== 'string'))
                throw new FindingsError('invalid', 'invalid HTTP header fields');
            return `${pair[0]}: ${pair[1]}`;
        });
    else
        headers = Object.entries(object(message.headers)).map(([key, val]) => {
            if (typeof val !== 'string')
                throw new FindingsError('invalid', 'invalid HTTP header');
            return `${key}: ${val}`;
        });
    return { head: [message.startLine, ...headers].join('\r\n'), bodyBase64: body.toString('base64'), sha256: sha256(body), length: body.length };
}
export async function prepareTrafficBinding(row, ref, storagePath) {
    const request = await captureBody(row.request, storagePath), response = await captureBody(row.response, storagePath);
    const content = { sourceTrafficId: row.id, url: row.url, method: row.method, status: row.status, capturedAt: row.capturedAt ?? row.createdAt, request, response };
    const at = new Date().toISOString();
    return { id: randomUUID(), role: ref.role, note: ref.note, position: 0, createdAt: at,
        snapshot: { ...content, id: sha256(Buffer.from(JSON.stringify(content))), createdAt: at } };
}
export function readEvidenceBody(binding, side, offset = 0, limit = 8192) {
    if (side !== 'request' && side !== 'response')
        throw new FindingsError('invalid', 'side must be request or response');
    if (!Number.isSafeInteger(offset) || offset < 0 || !Number.isSafeInteger(limit) || limit < 1 || limit > 262144)
        throw new FindingsError('invalid', 'offset must be nonnegative and limit must be 1..262144');
    const body = binding.snapshot[side], bytes = verifyBody(body), part = bytes.subarray(offset, offset + limit);
    return { offset, length: part.length, total: bytes.length, nextOffset: offset + part.length, eof: offset + part.length >= bytes.length, base64: part.toString('base64'), sha256: body.sha256, head: body.head };
}
