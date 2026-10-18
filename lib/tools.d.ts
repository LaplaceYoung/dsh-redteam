import type { RedTeamStore } from './store.js';
import { ArtexWorkflow } from './artex.js';
import { ReaRuntime } from './rea.js';
import { TrafficRuntime } from './traffic.js';
import type { WorkerRuntime } from './workers.js';
import { type NotificationDispatcher } from './notifications.js';
import type { ArchiveRuntime } from './archives.js';
export declare function registerRedTeamTools(ctx: {
    tools: {
        register(tool: unknown): () => void;
    };
}, store: RedTeamStore, workflow: ArtexWorkflow, rea: ReaRuntime, traffic: TrafficRuntime, workers: WorkerRuntime, notifications: NotificationDispatcher, archives: ArchiveRuntime, options?: {
    omitTools?: ReadonlySet<string>;
}): () => void;
