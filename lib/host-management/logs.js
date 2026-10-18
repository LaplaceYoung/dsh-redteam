import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { randomUUID } from 'node:crypto';
/** One bounded durable journal per host installation, with a monotonic restart-safe cursor. */
export class ServiceLogs {
    path;
    retention;
    rows = [];
    sequence = 0;
    tail;
    failure;
    listeners = new Set();
    ready;
    constructor(path, retention = 20000) {
        this.path = path;
        this.retention = retention;
        this.ready = this.load();
        this.tail = this.ready;
    }
    async load() {
        let value;
        try {
            value = JSON.parse(await readFile(this.path, 'utf8'));
        }
        catch (error) {
            if (error.code === 'ENOENT')
                return;
            throw error;
        }
        if (!value || typeof value !== 'object' || !('sequence' in value) || !Number.isSafeInteger(value.sequence) || !('items' in value) || !Array.isArray(value.items))
            throw new Error('Invalid service log journal');
        let previous = 0;
        for (const row of value.items) {
            if (!row || !Number.isSafeInteger(row.seq) || row.seq <= previous || row.db_id !== row.seq || !['ts', 'level', 'tag', 'text'].every(key => typeof row[key] === 'string'))
                throw new Error('Invalid service log record');
            previous = row.seq;
        }
        if (Number(value.sequence) < previous)
            throw new Error('Invalid service log cursor');
        this.rows = value.items.slice(-this.retention);
        this.sequence = Number(value.sequence);
    }
    append(input) {
        const operation = this.tail.then(async () => {
            const row = { ...input, seq: this.sequence + 1, db_id: this.sequence + 1 };
            const rows = [...this.rows, row].slice(-this.retention);
            await mkdir(dirname(this.path), { recursive: true });
            const temp = `${this.path}.${randomUUID()}.tmp`;
            await writeFile(temp, JSON.stringify({ sequence: row.seq, items: rows }), 'utf8');
            await rename(temp, this.path);
            this.rows = rows;
            this.sequence = row.seq;
            this.failure = undefined;
            for (const listener of this.listeners)
                listener(structuredClone(row));
        });
        this.tail = operation.catch(error => { this.failure = error instanceof Error ? error : new Error(String(error)); });
        return operation;
    }
    async flush() { await this.tail; if (this.failure)
        throw this.failure; }
    async recent(since = 0, limit = 500) {
        await this.flush();
        const items = this.rows.filter(row => row.seq > since).slice(0, limit);
        return { items: structuredClone(items), cursor: items.at(-1)?.seq ?? since, latest: this.sequence, truncated: since > 0 && this.rows.length > 0 && since < this.rows[0].seq - 1 };
    }
    async history(before = 0, limit = 200) {
        await this.flush();
        const rows = this.rows.filter(row => !before || row.db_id < before);
        return { items: structuredClone(rows.slice(-limit)), has_more: rows.length > limit, retention: this.retention };
    }
    subscribe(listener) { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; }
}
