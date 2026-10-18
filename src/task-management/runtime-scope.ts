import type { Context } from '@deepseek-ai/cordis';
import { agentCarrier, type Agent } from '@deepseek-ai/dsh-agent';
import { carrierKeyOf, scopeChainOf, scopeOf, type ScopeKey } from '@deepseek-ai/dsh-scope';
import type { TaskLifecycleRuntime } from './integration.js';

const installations = new WeakMap<ScopeKey, TaskLifecycleRuntime>();

/** Scope identity comes from Cordis, never from task/session metadata or registration order. */
export function registerTaskLifecycleScope(ctx: Context, runtime: TaskLifecycleRuntime): () => void {
  const key = scopeOf(ctx);
  // Global installations remain usable directly but cannot identify a selected Agent's preset.
  if (key === undefined) return () => {};
  const current = installations.get(key);
  if (current && !current.disposed) throw new Error('task lifecycle already installed in this exact scope');
  installations.set(key, runtime);
  return () => { if (installations.get(key) === runtime) installations.delete(key); };
}

/** Resolve a live Agent's nearest exact/preset scope without creating any task binding. */
export function lifecycleForAgent(agent: Agent): TaskLifecycleRuntime | undefined {
  if (agent.ctx.get('agents')?.get(agent.id) !== agent) return;
  for (const key of scopeChainOf(carrierKeyOf(agentCarrier(agent)))) {
    const runtime = installations.get(key);
    if (runtime && !runtime.disposed) return runtime;
  }
}
