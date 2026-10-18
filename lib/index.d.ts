import type { Context } from '@deepseek-ai/cordis';
import { type NotificationOptions } from './notifications.js';
export declare const name = "dsh-redteam";
export interface RedTeamConfig {
    surface?: 'ui' | 'agent' | 'all';
    storagePath?: string;
    dataDir?: string;
    reaCommand?: string;
    trafficCommand?: string;
    plannerConcurrency?: number;
    taskConcurrency?: number;
    taskConcurrencyEnabled?: boolean;
    notifications?: NotificationOptions;
}
export declare function apply(ctx: Context, config?: RedTeamConfig): Promise<void>;
export { ArtexWorkflow } from './artex.js';
export { ReaRuntime } from './rea.js';
export { RedTeamStore } from './store.js';
export { TrafficRuntime } from './traffic.js';
