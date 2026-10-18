/** ARTEX task_context.go/task_llm.go contracts. Persist each returned state atomically. */
export interface TaskLLMProfile {
  profileId: string;
  position: number;
  status: 'ready' | 'quota_exhausted';
  lastError: string;
  exhaustedAt: string | null;
}
export interface TaskLLMChainState {
  profiles: TaskLLMProfile[];
  activeProfileId: string | null;
  legacyProfileId: string | null;
  revision: number;
}
export interface TaskLLMTransition {
  previousProfileId: string;
  nextProfileId: string | null;
  chainExhausted: boolean;
  advanced: boolean;
  stale: boolean;
}
export function emptyTaskLLMChain(): TaskLLMChainState {
  return { profiles: [], activeProfileId: null, legacyProfileId: null, revision: 0 };
}

/** Call inside the host transaction with its authoritative profile registry. Terminal tasks may edit chains. */
export function replaceTaskLLMProfiles(
  state: TaskLLMChainState, profileIds: readonly string[], availableProfileIds: ReadonlySet<string>,
  activeProfileId: string | null = null,
): TaskLLMChainState {
  const seen = new Set<string>();
  for (const id of profileIds) {
    if (typeof id !== 'string' || !id.trim() || seen.has(id)) throw new Error(`invalid or duplicate LLM profile id ${id}`);
    if (!availableProfileIds.has(id)) throw new Error(`LLM profile ${id} not found`);
    seen.add(id);
  }
  const active = profileIds.length === 0 ? null : (activeProfileId ?? profileIds[0]);
  if (active !== null && !seen.has(active)) throw new Error(`active LLM profile ${active} is not in the task chain`);
  return {
    profiles: profileIds.map((profileId, position) => ({ profileId, position, status: 'ready', lastError: '', exhaustedAt: null })),
    activeProfileId: active, legacyProfileId: active, revision: state.revision + 1,
  };
}

function truncateUTF8(value: string, maxBytes: number): string {
  // TextEncoder replaces unpaired surrogates, matching Go's ToValidUTF8 boundary.
  const valid = new TextDecoder().decode(new TextEncoder().encode(value));
  let result = '', bytes = 0;
  for (const character of valid) {
    const length = new TextEncoder().encode(character).length;
    if (bytes + length > maxBytes) break;
    result += character; bytes += length;
  }
  return result;
}

/** Use the revision captured at model selection. Omit only for legacy, non-snapshot callers. */
export function markTaskLLMProfileQuotaExhausted(
  state: TaskLLMChainState, profileId: string, reason: string, now: Date, revision?: number,
): { state: TaskLLMChainState; transition: TaskLLMTransition } {
  const transition: TaskLLMTransition = {
    previousProfileId: profileId, nextProfileId: null, chainExhausted: false, advanced: false, stale: false,
  };
  if (revision !== undefined && revision !== state.revision) {
    transition.stale = true;
    return { state, transition };
  }
  const entry = state.profiles.find(p => p.profileId === profileId);
  if (!entry) return { state, transition };
  if (state.activeProfileId === null) {
    transition.chainExhausted = true;
    return { state, transition };
  }
  const profiles = state.profiles.map(p => p === entry && p.status !== 'quota_exhausted'
    ? { ...p, status: 'quota_exhausted' as const, lastError: truncateUTF8(reason.trim(), 1000), exhaustedAt: now.toISOString() }
    : p);
  if (state.activeProfileId !== profileId) {
    transition.nextProfileId = state.activeProfileId;
    return { state: { ...state, profiles }, transition };
  }
  const next = profiles.filter(p => p.position > entry.position && p.status === 'ready').sort((a, b) => a.position - b.position)[0];
  transition.nextProfileId = next?.profileId ?? null;
  transition.chainExhausted = next === undefined;
  transition.advanced = true;
  return {
    state: { profiles, activeProfileId: transition.nextProfileId, legacyProfileId: transition.nextProfileId, revision: state.revision + 1 },
    transition,
  };
}

export function taskLLMChainView(state: TaskLLMChainState): {
  profileIds: string[]; failoverState: 'default' | 'ready' | 'chain_exhausted'; failoverReason: string;
} {
  let latest: TaskLLMProfile | undefined;
  for (const profile of state.profiles) {
    if (profile.exhaustedAt !== null && (latest === undefined || Date.parse(profile.exhaustedAt) > Date.parse(latest.exhaustedAt!))) latest = profile;
  }
  const activeReady = state.profiles.some(p => p.profileId === state.activeProfileId && p.status === 'ready');
  return {
    profileIds: state.profiles.map(p => p.profileId),
    failoverState: state.profiles.length === 0 ? 'default' : activeReady ? 'ready' : 'chain_exhausted',
    failoverReason: latest?.lastError ?? '',
  };
}

/** The host evaluates credentials/provider construction; this module never stores API keys. */
export interface TaskLLMProfileAvailability {
  id: string; name: string; format: string; model: string; available: boolean; reason?: string;
}
export interface TaskLLMResolution {
  profileId?: string; name: string; format: string; model: string;
  source: 'agent_binding' | 'task_chain' | 'global_profile' | 'environment' | 'global';
  available: boolean; reason?: string;
  /** Non-null only for task-chain selections, hence the only path that may mutate failover state. */
  failoverProfileId: string | null;
  revision: number;
}
export interface TaskLLMResolutionInput {
  state: TaskLLMChainState;
  agentBinding: TaskLLMProfileAvailability | null;
  profiles: ReadonlyMap<string, TaskLLMProfileAvailability>;
  globalProfile: TaskLLMProfileAvailability | null;
  environment: { name: string; format: string; model: string } | null;
}
/** A loader error must propagate before invoking this function; missing and invalid providers are distinct from I/O failure. */
export function resolveTaskRoleLLM(input: TaskLLMResolutionInput): TaskLLMResolution {
  const { state } = input;
  const fromProfile = (p: TaskLLMProfileAvailability | undefined, source: TaskLLMResolution['source']): TaskLLMResolution => ({
    profileId: p?.id, name: p?.name ?? '', format: p?.format ?? '', model: p?.model ?? '',
    source, available: p?.available ?? false, reason: p ? p.reason : 'LLM 配置不存在',
    failoverProfileId: source === 'task_chain' ? state.activeProfileId : null, revision: state.revision,
  });
  if (input.agentBinding?.available) return fromProfile(input.agentBinding, 'agent_binding');
  if (state.profiles.length > 0) {
    if (state.activeProfileId === null) return {
      name: '', format: '', model: '', source: 'task_chain', available: false,
      reason: '任务 LLM 配置链额度已耗尽', failoverProfileId: null, revision: state.revision,
    };
    return fromProfile(input.profiles.get(state.activeProfileId), 'task_chain');
  }
  if (input.globalProfile?.available) return fromProfile(input.globalProfile, 'global_profile');
  if (input.environment !== null) return {
    ...input.environment, name: input.environment.name || '全局配置', source: 'environment', available: true,
    failoverProfileId: null, revision: state.revision,
  };
  return { name: '', format: '', model: '', source: 'global', available: false, reason: '没有可用的 LLM 配置', failoverProfileId: null, revision: state.revision };
}

const nonFailoverHTTPStatus = /(?:status(?:\s+code)?|http(?:\s+status)?)\s*[=:]?\s*(?:401|403|5\d\d)\b/;
const transientQuotaLimit = /(?:\b(?:rpm|tpm|rpd|qps)\b|quota[_\s-]*metric|rate[_\s-]*limit|too many requests|(?:requests?|tokens?)\s+(?:per|\/)\s*(?:second|minute)|(?:per|\/)\s*(?:second|minute)\s+(?:requests?|tokens?)|generate[_\s-]*requests[_\s-]*per[_\s-]*(?:minute|second)|tokens?[_\s-]*per[_\s-]*(?:minute|second))/;
export function isQuotaExhaustedMessage(message: string): boolean {
  const lower = message.toLowerCase();
  if (nonFailoverHTTPStatus.test(lower) || transientQuotaLimit.test(lower)) return false;
  return [
    'insufficient_quota', 'quota_exceeded', 'quota exceeded', 'quota exhausted',
    'exceeded your current quota', 'billing_hard_limit_reached', 'billing hard limit',
    'billing_not_active', 'credit balance', 'insufficient credit', 'insufficient balance',
    'balance is too low', 'payment required', 'status 402', '余额不足', '额度不足', '额度已用尽', '欠费', 'resource_exhausted',
  ].some(marker => lower.includes(marker));
}

/** Only use after persisting the quota transition. Replaying committed output could duplicate tool side effects. */
export function taskLLMReplayDecision(transition: TaskLLMTransition, outputCommitted: boolean): {
  replay: boolean; emitTransition: boolean;
} {
  return {
    replay: !outputCommitted && (transition.stale || transition.nextProfileId !== null),
    emitTransition: transition.advanced && !transition.stale,
  };
}
