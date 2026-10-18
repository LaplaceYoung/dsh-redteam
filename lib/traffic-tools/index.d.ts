import type { Context } from '@deepseek-ai/cordis';
import type { RedTeamStore } from '../store.js';
import type { TrafficRuntime } from '../traffic.js';
import { TrafficQuery } from './query.js';
export { TrafficQuery } from './query.js';
export type { TrafficFilter, TrafficSearch, TrafficMessage } from './query.js';
/** Original ARTEX lookup names plus DSH page/detail/statistics surfaces. */
export declare function installTrafficTools(ctx: Pick<Context, 'tools' | 'effect'>, store: RedTeamStore, runtime?: TrafficRuntime): TrafficQuery;
