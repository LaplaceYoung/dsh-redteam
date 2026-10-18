import type { GenerateOptions, LlmFailure, LlmProviderInfo, StreamChunk } from '@deepseek-ai/dsh-llm';
import type { RedTeamStore } from '../store.js';
import type { ModelHealthRuntime } from '../system-runtime/model-health.js';
import { setModelRequestAttribution } from '../system-runtime/model-attribution.js';
import { isQuotaExhaustedMessage, markTaskLLMProfileQuotaExhausted, taskLLMReplayDecision, type TaskLLMTransition } from './llm-chain.js';

export type TaskModelRole = 'mainagent' | 'planner' | 'worker' | 'goals' | 'reporter' | 'retester';
export type TaskModelRoute = Pick<GenerateOptions, 'provider' | 'model' | 'maxTokens' | 'reasoningEffort'>;
export interface TaskProfileSelection { profileId: string; route: TaskModelRoute }
export interface TaskModelPoolAttempt { triedProfileIds: string[]; estimatedTokens?: number }
export interface TaskProfileResolver {
  /** Resolve from the host's authoritative configuration, not from an inferred profile id. */
  resolveProfile(profileId: string): TaskModelRoute | null | Promise<TaskModelRoute | null>;
  resolveBinding(taskId: string, role: TaskModelRole): TaskModelRoute | null | Promise<TaskModelRoute | null>;
  resolveGlobal?(): TaskModelRoute | null | Promise<TaskModelRoute | null>;
  /** Atomic identity plus route prevents same-route profiles from sharing the wrong health state. */
  resolveBindingSelection?(taskId: string, role: TaskModelRole): TaskProfileSelection | null | Promise<TaskProfileSelection | null>;
  resolveGlobalSelection?(): TaskProfileSelection | null | Promise<TaskProfileSelection | null>;
}
export interface TaskModelService {
  listProviders(): readonly LlmProviderInfo[];
  stream(request: GenerateOptions): AsyncIterable<StreamChunk>;
}
interface TaskModelSelectionBase {
  taskId: string; role: TaskModelRole;
  profileId: string | null; revision: number;
  source: 'agent_binding' | 'task_chain' | 'global_profile' | 'parent';
  /** Original profile remains the head when a global pool selects a backup. */
  poolHeadProfileId?: string;
}
export type TaskModelSelection = TaskModelSelectionBase & (
  { available: true; route: TaskModelRoute; reason?: never; chainExhausted?: never }
  | { available: false; route?: never; reason: string; chainExhausted: boolean }
);
export interface TaskModelFailureResult {
  handled: boolean;
  replay: boolean;
  transition?: TaskLLMTransition;
}
export interface TaskModelRouterOptions {
  now?: () => Date;
  /** Called only after an actual advance was durably committed. */
  onTransition?: (selection: TaskModelSelection, transition: TaskLLMTransition, failure: unknown) => void | Promise<void>;
  modelHealth?: ModelHealthRuntime;
  poolSettings?: () => { llm_pool_enabled: boolean; llm_pool_bind_fallback: boolean };
}
export class TaskModelRuntimeError extends Error {
  readonly routerHandled = true;
  constructor(
    message: string, public readonly taskId: string, public readonly outputCommitted: boolean,
    public readonly chainExhausted: boolean, cause?: unknown,
  ) { super(message, { cause }); this.name = 'TaskModelRuntimeError'; }
}

function failureFacts(failure: unknown): { message: string; code?: string; status?: number } {
  if (failure !== null && typeof failure === 'object') {
    // LlmError keeps status in its detached .failure payload rather than on Error.
    if ('failure' in failure && failure.failure !== null && typeof failure.failure === 'object'
      && 'code' in failure && 'code' in failure.failure && failure.code === failure.failure.code) return failureFacts(failure.failure);
    return {
      message: 'message' in failure && typeof failure.message === 'string' ? failure.message : String(failure),
      code: 'code' in failure && typeof failure.code === 'string' ? failure.code : undefined,
      status: 'status' in failure && typeof failure.status === 'number' ? failure.status : undefined,
    };
  }
  return { message: String(failure) };
}
function quotaFailure(failure: unknown): boolean {
  const facts = failureFacts(failure);
  // rc2's canonical failure code is authoritative; its generic adapter-error code
  // still needs ARTEX's narrow wording classifier for unclassified providers.
  if (facts.status === 401 || facts.status === 403 || (facts.status !== undefined && facts.status >= 500)) return false;
  if (facts.code === 'QUOTA' || facts.code === 'ACCOUNT_QUOTA') return true;
  if (facts.code && !['UNKNOWN', 'UNKNOWN_ERROR', 'ADAPTER_ERROR'].includes(facts.code)) return false;
  return isQuotaExhaustedMessage(facts.message);
}

/** Metadata may be buffered, but any delivered model/tool content closes the replay window. */
export function taskModelChunkCommitsOutput(chunk: StreamChunk): boolean {
  switch (chunk.type) {
    case 'text-delta': case 'reasoning-delta': return chunk.text !== '';
    case 'tool-call-delta': return chunk.name !== undefined || chunk.argumentsDelta !== '';
    case 'block-start': return chunk.blockType !== 'text' && chunk.blockType !== 'reasoning';
    case 'block-end': return chunk.block.type === 'text' || chunk.block.type === 'reasoning' ? chunk.block.text !== '' : true;
    case 'finish': return chunk.reason.kind !== 'error' && chunk.reason.kind !== 'aborted';
    case 'usage': return false;
  }
}

/** Hand-built Planner requests use stream(); loop-owned requests use selectRoute()/recordFailure() in Agent hooks. */
export class TaskModelRouter {
  constructor(
    private readonly store: Pick<RedTeamStore, 'snapshot' | 'transaction'>,
    private readonly llm: TaskModelService,
    private readonly resolver: TaskProfileResolver,
    private readonly options: TaskModelRouterOptions = {},
  ) {}

  private chain(taskId: string) {
    const task = this.store.snapshot().tasks.find(row => row.id === taskId);
    if (!task) throw new Error(`task not found: ${taskId}`);
    if (!task.llmChain) throw new Error(`task LLM chain not initialized: ${taskId}`);
    return task.llmChain;
  }
  private available(route: TaskModelRoute | null): route is TaskModelRoute {
    return route !== null && !!route.provider.trim() && !!route.model.trim() && this.llm.listProviders().some(p => p.id === route.provider);
  }
  private async baseRoute(taskId: string, parent: TaskModelRoute, role: TaskModelRole): Promise<TaskModelSelection> {
    const chain = this.chain(taskId);
    const bindingSelection = this.resolver.resolveBindingSelection ? await this.resolver.resolveBindingSelection(taskId, role) : null;
    const binding = this.resolver.resolveBindingSelection ? bindingSelection?.route ?? null : await this.resolver.resolveBinding(taskId, role);
    if (this.available(binding)) return { available: true, taskId, role, route: { ...binding }, profileId: bindingSelection?.profileId ?? null, revision: chain.revision, source: 'agent_binding' };
    if (chain.profiles.length > 0) {
      if (chain.activeProfileId === null) return { available: false, taskId, role, profileId: null, revision: chain.revision, source: 'task_chain', reason: `task ${taskId} LLM profile chain exhausted`, chainExhausted: true };
      const route = await this.resolver.resolveProfile(chain.activeProfileId);
      if (!this.available(route)) return { available: false, taskId, role, profileId: chain.activeProfileId, revision: chain.revision, source: 'task_chain', reason: `LLM profile ${chain.activeProfileId} is missing, invalid, or its provider is not registered`, chainExhausted: false };
      return { available: true, taskId, role, route: { ...route }, profileId: chain.activeProfileId, revision: chain.revision, source: 'task_chain' };
    }
    const globalSelection = this.resolver.resolveGlobalSelection ? await this.resolver.resolveGlobalSelection() : null;
    const global = this.resolver.resolveGlobalSelection ? globalSelection?.route : await this.resolver.resolveGlobal?.();
    if (global && this.available(global)) return { available: true, taskId, role, route: { ...global }, profileId: globalSelection?.profileId ?? null, revision: chain.revision, source: 'global_profile' };
    if (!this.available(parent)) return { available: false, taskId, role, profileId: null, revision: chain.revision, source: 'parent', reason: 'Parent Agent provider/model is missing or its provider is not registered', chainExhausted: false };
    return { available: true, taskId, role, route: { ...parent }, profileId: null, revision: chain.revision, source: 'parent' };
  }

  private poolSelection(selection: TaskModelSelection) {
    const settings = this.options.poolSettings?.() ?? { llm_pool_enabled: false, llm_pool_bind_fallback: false };
    return { profileId: selection.poolHeadProfileId ?? selection.profileId!, bound: selection.source !== 'global_profile', enabled: settings.llm_pool_enabled, bindFallback: settings.llm_pool_bind_fallback };
  }
  async selectRoute(taskId: string, parent: TaskModelRoute, role: TaskModelRole, attempt?: TaskModelPoolAttempt): Promise<TaskModelSelection> {
    const selected = await this.baseRoute(taskId, parent, role);
    if (!selected.available || selected.profileId === null || !this.options.modelHealth) return selected;
    const profile = await this.options.modelHealth.selectProfile(this.poolSelection(selected), attempt?.triedProfileIds, attempt?.estimatedTokens, attempt !== undefined);
    if (!profile) return { ...selected, available: false, route: undefined, reason: 'LLM failover pool exhausted', chainExhausted: false };
    const route = profile.id === selected.profileId ? selected.route : await this.resolver.resolveProfile(profile.id);
    if (!this.available(route)) return { ...selected, available: false, route: undefined, reason: `LLM profile ${profile.id} is unavailable`, chainExhausted: false };
    return { ...selected, route: { ...route }, profileId: profile.id, poolHeadProfileId: selected.profileId };
  }

  /** Never changes the frozen request's route; actual failover happens in selectRoute. */
  decorateStream(request: GenerateOptions, selection: TaskModelSelection, next: () => AsyncIterable<StreamChunk>): AsyncIterable<StreamChunk> {
    return selection.profileId !== null && this.options.modelHealth
      ? this.options.modelHealth.decorateStream(request, selection.profileId, next, false) : next();
  }

  async recordFailure(selection: TaskModelSelection, failure: LlmFailure | unknown, outputCommitted: boolean, attempt?: TaskModelPoolAttempt): Promise<TaskModelFailureResult> {
    if (!selection.available) throw new Error('cannot record provider failure for an unavailable task model selection');
    let poolHandled = false;
    if (selection.profileId !== null && this.options.modelHealth) {
      const facts = failureFacts(failure);
      const normalized: LlmFailure = { ...facts, code: facts.code ?? 'UNKNOWN' };
      poolHandled = await this.options.modelHealth.recordFailure(selection.profileId, normalized, outputCommitted);
      if (poolHandled && attempt && !attempt.triedProfileIds.includes(selection.profileId)) attempt.triedProfileIds.push(selection.profileId);
    }
    const isTaskHead = selection.source === 'task_chain' && (selection.poolHeadProfileId === undefined || selection.poolHeadProfileId === selection.profileId);
    if (selection.profileId === null || !isTaskHead || !quotaFailure(failure)) {
      const next = poolHandled && attempt && this.options.modelHealth
        ? await this.options.modelHealth.selectProfile(this.poolSelection(selection), attempt.triedProfileIds, attempt.estimatedTokens, false) : null;
      return { handled: poolHandled, replay: next !== null };
    }
    const profileId = selection.profileId;
    let transition: TaskLLMTransition;
    try {
      transition = await this.store.transaction(state => {
        const task = state.tasks.find(row => row.id === selection.taskId);
        if (!task) throw new Error(`task not found: ${selection.taskId}`);
        if (!task.llmChain) throw new Error(`task LLM chain not initialized: ${selection.taskId}`);
        const result = markTaskLLMProfileQuotaExhausted(task.llmChain, profileId, failureFacts(failure).message, this.options.now?.() ?? new Date(), selection.revision);
        task.llmChain = result.state;
        return result.transition;
      });
    } catch (cause) {
      throw new TaskModelRuntimeError(`cannot persist task ${selection.taskId} LLM quota failure: ${failureFacts(cause).message}`, selection.taskId, outputCommitted, false, cause);
    }
    const decision = taskLLMReplayDecision(transition, outputCommitted);
    if (decision.emitTransition) await this.options.onTransition?.(selection, transition, failure);
    return { handled: true, replay: decision.replay, transition };
  }

  async *stream(taskId: string, role: TaskModelRole, request: GenerateOptions, parent: TaskModelRoute = request, beforeDispatch?: () => Promise<void>): AsyncIterable<StreamChunk> {
    const attempt: TaskModelPoolAttempt = { triedProfileIds: [], estimatedTokens: Math.floor(Buffer.byteLength(JSON.stringify({ system: request.system, messages: request.messages, tools: request.tools })) * 2 / 7) };
    while (true) {
      request.signal?.throwIfAborted();
      const selected = await this.selectRoute(taskId, parent, role, attempt);
      if (!selected.available) throw new TaskModelRuntimeError(selected.reason, taskId, false, selected.chainExhausted);
      request.signal?.throwIfAborted();
      // Drop old-route optional controls: an effort supported by the parent may
      // not exist on the task route. Do not mutate frozen loop-owned requests.
      const { provider: _provider, model: _model, maxTokens: _maxTokens, reasoningEffort: _effort, ...content } = request;
      const dispatched: GenerateOptions = { ...content, ...selected.route };
      setModelRequestAttribution(dispatched, selected);
      await beforeDispatch?.();
      request.signal?.throwIfAborted();
      let committed = false, failed = false;
      let failure: unknown;
      let failureChunk: Extract<StreamChunk, { type: 'finish' }> | undefined;
      const pending: StreamChunk[] = [];
      let iterator: AsyncIterator<StreamChunk> | undefined;
      let ended = false;
      try {
        try { iterator = this.decorateStream(dispatched, selected, () => this.llm.stream(dispatched))[Symbol.asyncIterator](); }
        catch (cause) { failure = cause; failed = true; }
        while (iterator && !failed) {
          request.signal?.throwIfAborted();
          let step: IteratorResult<StreamChunk>;
          // Only provider iteration belongs to failover. Consumer errors and
          // cleanup failures propagate without being mistaken for provider quota.
          try { step = await iterator.next(); }
          catch (cause) { failure = cause; failed = true; break; }
          request.signal?.throwIfAborted();
          if (step.done) { ended = true; break; }
          const chunk = step.value;
          if (chunk.type === 'finish' && chunk.reason.kind === 'error') {
            failure = chunk.reason.failure; failureChunk = chunk; failed = true; break;
          }
          if (chunk.type === 'finish' && chunk.reason.kind === 'aborted') {
            yield* pending; yield chunk; return;
          }
          if (!committed && !taskModelChunkCommitsOutput(chunk)) { pending.push(chunk); continue; }
          if (!committed) { committed = true; yield* pending; pending.length = 0; }
          yield chunk;
        }
      } finally {
        if (iterator && !ended) await iterator.return?.();
      }
      request.signal?.throwIfAborted();
      if (!failed) { yield* pending; return; }
      const result = await this.recordFailure(selected, failure, committed, attempt);
      if (!result.handled) {
        yield* pending;
        if (failureChunk) { yield failureChunk; return; }
        throw failure;
      }
      if (result.replay) continue;
      throw new TaskModelRuntimeError(failureFacts(failure).message, taskId, committed, result.transition?.chainExhausted ?? false, failure);
    }
  }
}
