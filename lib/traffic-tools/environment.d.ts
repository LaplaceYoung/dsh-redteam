import type { Context } from '@deepseek-ai/cordis';
import type { RedTeamStore } from '../store.js';
import type { TrafficRuntime } from '../traffic.js';
/** Install the official shell tool against a private delegating executor.
 * shellEnv owns only DSH_* facts; DSH_SESSION_ID is generated from exec.agent.
 * Ordinary proxy/CA variables belong to ShellExecSpec.env, not that registry.
 */
export declare function installTrafficEnvironment(ctx: Context, store: RedTeamStore, traffic: TrafficRuntime): void;
