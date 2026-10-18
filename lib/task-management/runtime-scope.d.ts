import type { Context } from '@deepseek-ai/cordis';
import { type Agent } from '@deepseek-ai/dsh-agent';
import type { TaskLifecycleRuntime } from './integration.js';
/** Scope identity comes from Cordis, never from task/session metadata or registration order. */
export declare function registerTaskLifecycleScope(ctx: Context, runtime: TaskLifecycleRuntime): () => void;
/** Resolve a live Agent's nearest exact/preset scope without creating any task binding. */
export declare function lifecycleForAgent(agent: Agent): TaskLifecycleRuntime | undefined;
