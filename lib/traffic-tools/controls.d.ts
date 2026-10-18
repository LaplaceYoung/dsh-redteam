import type { Context } from '@deepseek-ai/cordis';
import type { TrafficRuntime } from '../traffic.js';
/** Settings affect subsequent worker commands and new upstream connections. */
export declare function installTrafficControls(ctx: Pick<Context, 'tools' | 'effect'>, traffic: TrafficRuntime): void;
