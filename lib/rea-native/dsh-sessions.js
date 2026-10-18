import { HarnessError } from '@deepseek-ai/dsh-llm';
export class NativeReaSessions {
    sessions = new Map();
    disposed = false;
    disposal;
    get(agent, signal) {
        signal.throwIfAborted();
        if (!agent)
            throw new HarnessError('Native REA session operations require a DSH Agent', 'REA_AGENT_REQUIRED');
        if (this.disposed)
            throw new HarnessError('Native REA integration is disposed', 'REA_SESSION_CLOSED');
        let owned = this.sessions.get(agent.id);
        if (owned?.closed)
            throw new HarnessError('Native REA session is closing', 'REA_SESSION_CLOSED');
        if (!owned) {
            let entry;
            // The Agent accepts ownership before the asynchronous factory can start.
            agent.ctx.effect(() => () => this.closeOwned(agent.id, entry));
            entry = { closed: false, session: Promise.resolve().then(async () => {
                    const { createReaSession } = await import('@dsh-redteam/rea-native-session');
                    return createReaSession();
                }) };
            this.sessions.set(agent.id, entry);
            void entry.session.catch(() => { if (this.sessions.get(agent.id) === entry)
                this.sessions.delete(agent.id); });
            owned = entry;
        }
        return owned.session;
    }
    closeOwned(id, owned) {
        owned.closed = true;
        owned.closing ??= owned.session.then(session => session.close()).then(() => {
            if (this.sessions.get(id) === owned)
                this.sessions.delete(id);
        }).catch(cause => { owned.closing = undefined; throw cause; });
        return owned.closing;
    }
    async close(agentId) {
        const owned = this.sessions.get(agentId);
        if (owned)
            await this.closeOwned(agentId, owned);
    }
    dispose() {
        this.disposed = true;
        this.disposal ??= (async () => {
            const results = await Promise.allSettled([...this.sessions].map(([id, owned]) => this.closeOwned(id, owned)));
            const errors = results.flatMap(result => result.status === 'rejected' ? [result.reason] : []);
            if (errors.length) {
                this.disposal = undefined;
                throw new AggregateError(errors, 'REA Agent session cleanup failed');
            }
        })();
        return this.disposal;
    }
}
