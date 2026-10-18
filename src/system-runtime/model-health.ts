import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { ReasoningEffortId, type GenerateOptions, type LlmFailure, type StreamChunk } from '@deepseek-ai/dsh-llm';

export interface PoolProfile {
  id: string; name: string; provider: string; model: string;
  maxTokens?: number; reasoningEffort?: string;
}
export interface PoolProfileSource {
  list(): Promise<{ profiles: PoolProfile[]; activeProfileId: string | null }>;
}
export interface RetryRule { attempts: number; interval_ms: number }
export interface ModelRetryPolicy {
  connect: RetryRule; empty: RetryRule; stream: RetryRule; breaker: RetryRule; intent: RetryRule;
}
export interface ProfilePoolPolicy {
  priority: number; excluded: boolean; ratePerSecond: number; ratePerMinute: number; windowTokens: number;
  retry: Pick<ModelRetryPolicy, 'connect' | 'empty' | 'stream'>;
}
export interface ModelHealthState {
  fails: number; trips: number; openUntil: number; lastError: string; lastAt: number;
}
interface DurableState {
  version: 1;
  health: Record<string, ModelHealthState>;
  profiles: Record<string, ProfilePoolPolicy>;
  retry: ModelRetryPolicy;
}
interface SharedRegistry {
  state: DurableState; writes: Promise<void>;
  limiterLocks: Map<string, Promise<void>>; requests: Map<string, number[]>; retryAfter: Map<string, number>;
  decoratedRequests: WeakSet<GenerateOptions>; roundRobin: number;
}
// Health belongs to the installation path, not an Agent's scoped DSH service.
const registries = new Map<string, Promise<SharedRegistry>>();
export type ModelStream = (options: GenerateOptions) => AsyncIterable<StreamChunk>;
export interface PoolSelection {
  profileId: string;
  bound?: boolean;
  enabled: boolean;
  bindFallback: boolean;
}
export interface ModelHealthOptions {
  storagePath: string;
  profiles: PoolProfileSource;
  /** Dispatches through the actual DSH runtime; never a model-catalog lookup. */
  stream: ModelStream;
  now?: () => number;
  sleep?: (milliseconds: number, signal?: AbortSignal) => Promise<void>;
}
const rule = (): RetryRule => ({ attempts: 0, interval_ms: 0 });
const defaults = (): ModelRetryPolicy => ({ connect: rule(), empty: rule(), stream: rule(), breaker: rule(), intent: rule() });
const profileDefaults = (): ProfilePoolPolicy => ({ priority: 0, excluded: false, ratePerSecond: 0, ratePerMinute: 0, windowTokens: 0, retry: { connect: rule(), empty: rule(), stream: rule() } });
const cleanHealth = (): ModelHealthState => ({ fails: 0, trips: 0, openUntil: 0, lastError: '', lastAt: 0 });
const clone = <T>(value: T): T => structuredClone(value);
function object(value: unknown, label: string): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new TypeError(`${label} must be an object`);
  return value as Record<string, unknown>;
}
function integer(value: unknown, label: string, min = 0, max = Number.MAX_SAFE_INTEGER): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < min || value > max) throw new TypeError(`${label} must be an integer in [${min}, ${max}]`);
  return value;
}
function parseRule(value: unknown): RetryRule {
  const input = object(value, 'retry rule');
  return { attempts: integer(input.attempts, 'attempts', -1, 20), interval_ms: integer(input.interval_ms, 'interval_ms', 0, 3_600_000) };
}
function parseRetry(value: unknown): ModelRetryPolicy {
  const input = object(value, 'retry policy');
  return { connect: parseRule(input.connect), empty: parseRule(input.empty), stream: parseRule(input.stream), breaker: parseRule(input.breaker), intent: parseRule(input.intent) };
}
function parseProfilePolicy(value: unknown): ProfilePoolPolicy {
  const input = object(value, 'profile pool policy'), retry = object(input.retry, 'profile retry');
  if (typeof input.excluded !== 'boolean') throw new TypeError('excluded must be boolean');
  return { priority: integer(input.priority, 'priority', -Number.MAX_SAFE_INTEGER), excluded: input.excluded,
    ratePerSecond: integer(input.ratePerSecond, 'ratePerSecond'), ratePerMinute: integer(input.ratePerMinute, 'ratePerMinute'),
    windowTokens: integer(input.windowTokens, 'windowTokens'), retry: { connect: parseRule(retry.connect), empty: parseRule(retry.empty), stream: parseRule(retry.stream) } };
}
function parseState(value: unknown): DurableState {
  const input = object(value, 'model health state');
  if (input.version !== 1) throw new Error('unsupported model health state version');
  const health: DurableState['health'] = Object.create(null), profiles: DurableState['profiles'] = Object.create(null);
  for (const [id, value] of Object.entries(object(input.health, 'health'))) {
    const entry = object(value, `health ${id}`);
    if (typeof entry.lastError !== 'string') throw new TypeError('invalid health lastError');
    health[id] = { fails: integer(entry.fails, 'fails'), trips: integer(entry.trips, 'trips'), openUntil: integer(entry.openUntil, 'openUntil'), lastError: entry.lastError, lastAt: integer(entry.lastAt, 'lastAt') };
  }
  for (const [id, value] of Object.entries(object(input.profiles, 'profiles'))) profiles[id] = parseProfilePolicy(value);
  return { version: 1, health, profiles, retry: parseRetry(input.retry) };
}
async function pause(milliseconds: number, signal?: AbortSignal): Promise<void> {
  signal?.throwIfAborted();
  await new Promise<void>((resolve, reject) => {
    const abort = () => { clearTimeout(timer); reject(signal?.reason); };
    const timer = setTimeout(() => { signal?.removeEventListener('abort', abort); resolve(); }, milliseconds);
    signal?.addEventListener('abort', abort, { once: true });
  });
}
const hardCodes = new Set(['AUTH', 'QUOTA', 'ACCOUNT_QUOTA', 'MISSING_CREDENTIAL', 'INVALID_CREDENTIAL', 'MODEL_NOT_FOUND', 'NO_ADAPTER']);
const transientCodes = new Set(['RATE_LIMIT', 'NETWORK', 'TIMEOUT', 'SERVER_ERROR', 'EMPTY_RESPONSE', 'STREAM_INTERRUPTED', 'UNKNOWN']);
/** DSH exposes typed status/code facts; provider message text is diagnostic only. */
export function classifyModelFailure(failure: LlmFailure, signal?: AbortSignal): 'hard' | 'transient' | 'none' {
  if (signal?.aborted || ['ABORTED', 'CANCELLED', 'CONTEXT_WINDOW_EXCEEDED', 'IMAGE_OFFLOAD_REQUIRED'].includes(failure.code)) return 'none';
  if (hardCodes.has(failure.code)) return 'hard';
  if (failure.status !== undefined) {
    if ([401, 402, 403, 404].includes(failure.status)) return 'hard';
    if ([408, 429].includes(failure.status) || failure.status >= 500) return 'transient';
    return 'none';
  }
  return transientCodes.has(failure.code) ? 'transient' : 'none';
}
function diagnostic(failure: LlmFailure): string {
  // Never copy a provider response body into persisted health: it can echo credentials.
  return `${failure.code}${failure.status === undefined ? '' : ` (HTTP ${failure.status})`}`;
}
function mergedRule(local: RetryRule, global: RetryRule): RetryRule {
  return { attempts: local.attempts === 0 ? global.attempts : local.attempts, interval_ms: local.interval_ms === 0 ? global.interval_ms : local.interval_ms };
}
function failureChunk(failure: LlmFailure): StreamChunk { return { type: 'finish', reason: { kind: 'error', failure } }; }
function requestTokens(options: GenerateOptions): number {
  // Same conservative byte heuristic as ARTEX; attachment bytes are owned by DSH.
  return Math.floor(Buffer.byteLength(JSON.stringify({ system: options.system, messages: options.messages, tools: options.tools })) * 2 / 7);
}

/** One shared instance per installation: rebuilds of a task's chain retain limiter and breaker state. */
export class ModelHealthRuntime {
  private get state(): DurableState { return this.shared.state; }
  private set state(value: DurableState) { this.shared.state = value; }
  private get writes(): Promise<void> { return this.shared.writes; }
  private set writes(value: Promise<void>) { this.shared.writes = value; }
  private get limiterLocks() { return this.shared.limiterLocks; }
  private get requests() { return this.shared.requests; }
  private get retryAfter() { return this.shared.retryAfter; }
  private get decoratedRequests() { return this.shared.decoratedRequests; }
  private get roundRobin() { return this.shared.roundRobin; }
  private set roundRobin(value: number) { this.shared.roundRobin = value; }
  private readonly now: () => number;
  private readonly sleep: (milliseconds: number, signal?: AbortSignal) => Promise<void>;
  private constructor(private readonly options: ModelHealthOptions, private readonly shared: SharedRegistry) { this.now = options.now ?? Date.now; this.sleep = options.sleep ?? pause; }
  static async open(options: ModelHealthOptions): Promise<ModelHealthRuntime> {
    const storagePath = resolve(options.storagePath), key = process.platform === 'win32' ? storagePath.toLowerCase() : storagePath;
    let pending = registries.get(key);
    if (!pending) {
      pending = (async (): Promise<SharedRegistry> => {
        let state: DurableState = { version: 1, health: Object.create(null), profiles: Object.create(null), retry: defaults() };
        try { state = parseState(JSON.parse(await readFile(storagePath, 'utf8'))); }
        catch (error) { if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) throw error; }
        // ARTEX restores only unexpired cooling windows, not historical degradation.
        const now = options.now?.() ?? Date.now();
        for (const [id, health] of Object.entries(state.health)) if (health.openUntil <= now) delete state.health[id];
        return { state, writes: Promise.resolve(), limiterLocks: new Map(), requests: new Map(), retryAfter: new Map(), decoratedRequests: new WeakSet(), roundRobin: 0 };
      })();
      registries.set(key, pending);
    }
    try { return new ModelHealthRuntime({ ...options, storagePath }, await pending); }
    catch (error) { if (registries.get(key) === pending) registries.delete(key); throw error; }
  }
  private persist(): Promise<void> {
    const data = JSON.stringify(this.state, null, 2);
    const write = async () => {
      await mkdir(dirname(this.options.storagePath), { recursive: true });
      const temporary = `${this.options.storagePath}.${randomUUID()}.tmp`;
      try { await writeFile(temporary, data, { encoding: 'utf8', mode: 0o600 }); await rename(temporary, this.options.storagePath); }
      finally { await unlink(temporary).catch((error: NodeJS.ErrnoException) => { if (error.code !== 'ENOENT') throw error; }); }
    };
    const result = this.writes.then(write);
    this.writes = result.catch(() => {});
    return result;
  }
  private async profile(id: string): Promise<PoolProfile> {
    const profile = (await this.options.profiles.list()).profiles.find(p => p.id === id);
    if (!profile) throw new Error(`model profile not found: ${id}`);
    return profile;
  }
  profilePolicy(id: string): ProfilePoolPolicy { return clone(this.state.profiles[id] ?? profileDefaults()); }
  retryPolicy(): ModelRetryPolicy { return clone(this.state.retry); }
  resolvedRetry(id: string): ModelRetryPolicy {
    const local = this.profilePolicy(id).retry, global = this.state.retry;
    return { connect: mergedRule(local.connect, global.connect), empty: mergedRule(local.empty, global.empty), stream: mergedRule(local.stream, global.stream), breaker: clone(global.breaker), intent: clone(global.intent) };
  }
  async setProfilePolicy(id: string, policy: ProfilePoolPolicy): Promise<ProfilePoolPolicy> {
    await this.profile(id); this.state.profiles[id] = parseProfilePolicy(policy); await this.persist(); return this.profilePolicy(id);
  }
  async setRetryPolicy(policy: ModelRetryPolicy): Promise<ModelRetryPolicy> {
    this.state.retry = parseRetry(policy); await this.persist(); return this.retryPolicy();
  }
  health(id: string): ModelHealthState { return clone(this.state.health[id] ?? cleanHealth()); }
  async reset(id?: string): Promise<void> {
    if (id !== undefined) { await this.profile(id); delete this.state.health[id]; this.retryAfter.delete(id); }
    else { this.state.health = Object.create(null); this.retryAfter.clear(); }
    await this.persist();
  }
  /** Called after successful profile deletion, retaining other profile IDs unchanged. */
  async forget(id: string): Promise<void> {
    delete this.state.health[id]; delete this.state.profiles[id]; this.requests.delete(id); this.retryAfter.delete(id); await this.persist();
  }
  async status() {
    const { profiles, activeProfileId } = await this.options.profiles.list(), now = this.now();
    const chain = profiles.map(profile => {
      const health = this.health(profile.id), policy = this.profilePolicy(profile.id);
      return { profile_id: profile.id, name: profile.name, provider: profile.provider, model: profile.model,
        active: profile.id === activeProfileId, priority: policy.priority, excluded: policy.excluded,
        state: health.openUntil > now ? 'tripped' : health.fails > 0 ? 'degraded' : 'ok', fails: health.fails, trips: health.trips,
        cooldown_secs: Math.max(0, Math.ceil((health.openUntil - now) / 1000)), last_error: health.lastError,
        last_at: health.lastAt ? new Date(health.lastAt).toISOString() : null, policy };
    });
    chain.sort((a, b) => Number(b.active) - Number(a.active) || b.priority - a.priority || a.profile_id.localeCompare(b.profile_id));
    return { chain, retry: this.retryPolicy() };
  }
  private async pass(id: string): Promise<void> {
    if (this.state.health[id]) { delete this.state.health[id]; await this.persist(); }
  }
  private async trip(id: string, failure: LlmFailure, hard: boolean): Promise<void> {
    const state = this.health(id), policy = this.state.retry.breaker;
    state.fails++; state.lastError = diagnostic(failure); state.lastAt = this.now();
    const threshold = policy.attempts === 0 ? 3 : Math.max(0, policy.attempts);
    if (hard || (threshold > 0 && state.fails >= threshold)) {
      state.trips++; state.fails = 0;
      state.openUntil = this.now() + (policy.interval_ms || [60_000, 300_000, 1_800_000][Math.min(state.trips - 1, 2)]);
    }
    this.state.health[id] = state; await this.persist();
  }
  private async acquire(id: string, signal?: AbortSignal): Promise<void> {
    const previous = this.limiterLocks.get(id) ?? Promise.resolve();
    const current = previous.then(async () => {
      for (;;) {
        signal?.throwIfAborted();
        const now = this.now(), policy = this.profilePolicy(id);
        const times = (this.requests.get(id) ?? []).filter(time => time > now - 60_000);
        let until = this.retryAfter.get(id) ?? 0;
        for (const [limit, window] of [[policy.ratePerSecond, 1000], [policy.ratePerMinute, 60_000]]) {
          const inWindow = times.filter(time => time > now - window);
          if (limit > 0 && inWindow.length >= limit) until = Math.max(until, inWindow[inWindow.length - limit] + window);
        }
        if (until <= now) { times.push(now); this.requests.set(id, times); return; }
        await this.sleep(until - now, signal);
      }
    });
    const settled = current.catch(() => {});
    this.limiterLocks.set(id, settled);
    try { await current; } finally { if (this.limiterLocks.get(id) === settled) this.limiterLocks.delete(id); }
  }
  private async chain(selection: PoolSelection, tokens: number, tried: readonly string[] = [], advanceRotation = true): Promise<PoolProfile[]> {
    const { profiles, activeProfileId } = await this.options.profiles.list();
    const head = profiles.find(p => p.id === selection.profileId);
    if (!head) throw new Error(`model profile not found: ${selection.profileId}`);
    if (!selection.enabled || (selection.bound && !selection.bindFallback)) return tried.includes(head.id) ? [] : [head];
    const remaining = profiles.filter(p => p.id !== head.id && !this.profilePolicy(p.id).excluded);
    remaining.sort((a, b) => Number(b.id === activeProfileId) - Number(a.id === activeProfileId) || this.profilePolicy(b.id).priority - this.profilePolicy(a.id).priority || a.id.localeCompare(b.id));
    const n = this.roundRobin;
    if (advanceRotation) this.roundRobin++;
    const usable = [head, ...remaining].filter(profile => {
      const policy = this.profilePolicy(profile.id);
      return !tried.includes(profile.id) && this.health(profile.id).openUntil <= this.now() && (policy.windowTokens === 0 || policy.windowTokens >= tokens);
    });
    if (!usable.length) return tried.length ? [] : [head];
    const rank = (p: PoolProfile) => p.id === head.id ? 'head' : p.id === activeProfileId ? 'active' : String(this.profilePolicy(p.id).priority);
    const ordered: PoolProfile[] = [];
    for (let i = 0; i < usable.length;) {
      let end = i + 1;
      while (end < usable.length && rank(usable[end]) === rank(usable[i])) end++;
      const group = usable.slice(i, end), offset = n % group.length;
      ordered.push(...group.slice(offset), ...group.slice(0, offset)); i = end;
    }
    return ordered;
  }
  /** Native Agent hooks call this before request header/model source are committed. */
  async selectProfile(selection: PoolSelection, tried: readonly string[] = [], estimatedTokens = 0, advanceRotation = true): Promise<PoolProfile | null> {
    return (await this.chain(selection, estimatedTokens, tried, advanceRotation))[0] ?? null;
  }
  /** One failed logical attempt, after same-provider retries, shared by all task routers. */
  async recordFailure(profileId: string, failure: LlmFailure, outputCommitted: boolean, signal?: AbortSignal): Promise<boolean> {
    const category = classifyModelFailure(failure, signal);
    if (category === 'none' || outputCommitted) return false;
    await this.trip(profileId, failure, category === 'hard');
    return true;
  }
  private route(options: GenerateOptions, profile: PoolProfile, head: boolean): GenerateOptions {
    if (head && options.provider === profile.provider && options.model === profile.model) return options;
    const { maxTokens: _max, reasoningEffort: _reason, ...rest } = options;
    return { ...rest, provider: profile.provider, model: profile.model,
      ...(profile.maxTokens === undefined ? {} : { maxTokens: profile.maxTokens }),
      ...(profile.reasoningEffort === undefined ? {} : { reasoningEffort: ReasoningEffortId(profile.reasoningEffort) }) };
  }
  /** DSH waterfall seam: preserves the frozen request and adapter/source identity. */
  async *decorateStream(options: GenerateOptions, profileId: string, next: () => AsyncIterable<StreamChunk>, recordHealth = true): AsyncGenerator<StreamChunk> {
    if (this.decoratedRequests.has(options)) { yield* next(); return; }
    const profile = await this.profile(profileId);
    if (profile.provider !== options.provider || profile.model !== options.model) throw new Error(`profile ${profileId} does not own request route`);
    this.decoratedRequests.add(options);
    try { yield* this.stream(options, { profileId, enabled: false, bindFallback: false }, () => next(), recordHealth); }
    finally { this.decoratedRequests.delete(options); }
  }
  /** No replay after any chunk is delivered, including block-start and usage. */
  async *stream(options: GenerateOptions, selection: PoolSelection, dispatch: ModelStream = this.options.stream, recordHealth = true): AsyncGenerator<StreamChunk> {
    const chain = await this.chain(selection, requestTokens(options));
    let last: LlmFailure | undefined;
    for (const profile of chain) {
      const request = this.route(options, profile, profile.id === selection.profileId), retry = this.resolvedRetry(profile.id);
      const counters = { connect: 0, empty: 0, stream: 0 };
      for (;;) {
        await this.acquire(profile.id, request.signal);
        let emitted = false, ended = false, failure: LlmFailure | undefined;
        // Middleware exceptions are not provider failures in DSH; deliberately propagate them.
        for await (const chunk of dispatch(request)) {
          if (chunk.type === 'finish') {
            ended = true;
            if (chunk.reason.kind === 'error') {
              failure = chunk.reason.failure;
              if (!emitted && classifyModelFailure(failure, request.signal) !== 'none') break;
              yield chunk; return;
            }
            if (chunk.reason.kind === 'aborted') { yield chunk; return; }
            await this.pass(profile.id);
          }
          emitted = true; yield chunk;
        }
        if (!failure && ended) return;
        if (!failure) failure = { code: 'STREAM_INTERRUPTED', message: 'Model stream ended without a terminal finish' };
        if (emitted) { yield failureChunk(failure); return; }
        const classification = classifyModelFailure(failure, request.signal);
        if (classification === 'none') { yield failureChunk(failure); return; }
        const after = failure.providerRetryAfterMs;
        if (after !== undefined && Number.isFinite(after) && after > 0) this.retryAfter.set(profile.id, this.now() + after);
        const layer = failure.code === 'EMPTY_RESPONSE' ? 'empty' : failure.code === 'STREAM_INTERRUPTED' ? 'stream' : 'connect';
        const rule = retry[layer], attempts = rule.attempts === 0 ? (layer === 'connect' ? 3 : 2) : Math.max(0, rule.attempts);
        if (classification === 'transient' && counters[layer] < attempts) {
          const delay = rule.interval_ms || Math.min(500 * 2 ** counters[layer], 4000);
          counters[layer]++; await this.sleep(delay, request.signal); continue;
        }
        if (recordHealth) await this.trip(profile.id, failure, classification === 'hard');
        last = failure; break;
      }
    }
    // Preserve the final provider's quota/auth/status identity for the existing task-chain resolver.
    yield failureChunk(last ?? { code: 'POOL_EXHAUSTED', message: 'All model profiles are unavailable' });
  }
  /** A real, bounded completion. Never declares success from catalog membership. */
  async probe(profileId: string, signal?: AbortSignal): Promise<{ ok: boolean; profile_id: string; elapsed_ms: number; response: string; failure?: LlmFailure }> {
    const profile = await this.profile(profileId), start = this.now();
    const timeout = AbortSignal.timeout(30_000), combined = signal ? AbortSignal.any([signal, timeout]) : timeout;
    const options: GenerateOptions = { provider: profile.provider, model: profile.model, messages: [{ role: 'user', content: [{ type: 'text', text: 'Reply with OK.' }] }], maxTokens: 16, signal: combined };
    await this.acquire(profileId, combined);
    const textBlocks = new Map<number, string>();
    let failure: LlmFailure | undefined, finished = false;
    for await (const chunk of this.options.stream(options)) {
      if (chunk.type === 'text-delta') textBlocks.set(chunk.index, (textBlocks.get(chunk.index) ?? '') + chunk.text);
      if (chunk.type === 'block-end' && chunk.block.type === 'text') textBlocks.set(chunk.index, chunk.block.text);
      if (chunk.type === 'finish') {
        finished = true;
        if (chunk.reason.kind === 'error' || chunk.reason.kind === 'aborted') failure = chunk.reason.failure;
      }
    }
    const response = [...textBlocks.values()].join('');
    if (!finished) failure = { code: 'STREAM_INTERRUPTED', message: 'Connectivity probe ended without a terminal finish' };
    else if (!failure && !response.trim()) failure = { code: 'EMPTY_RESPONSE', message: 'Connectivity probe completed without response text' };
    if (failure) { const category = classifyModelFailure(failure, combined); if (category !== 'none') await this.trip(profileId, failure, category === 'hard'); }
    else await this.pass(profileId);
    return { ok: failure === undefined, profile_id: profileId, elapsed_ms: this.now() - start, response, ...(failure ? { failure } : {}) };
  }
}
