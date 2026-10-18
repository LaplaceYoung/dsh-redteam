import { AsyncLocalStorage } from 'node:async_hooks';
import { CATALOG_IDENTITY } from './upstream/dist/catalogIdentity.js';
import { AnalysisInputError, AnalysisOutputError } from './upstream/dist/domain/analysisErrorCore.js';
import { toolReturnsTargetContent } from './upstream/dist/contracts/toolEffects.js';
import { TARGET_CONTENT_RESULT_META } from './upstream/dist/server/toolResultEncoding.js';

const currentSignal = new AsyncLocalStorage();
export const currentMcpRequestSignal = () => currentSignal.getStore();

/** The upstream registrations call functions here; no SDK server or transport exists. */
export class NativeRegistrar {
  tools = new Map();
  prompts = new Map();
  catalogIdentity = CATALOG_IDENTITY;
  #active = new Set();
  #closing = false;
  #abort = new AbortController();
  server = {
    onclose: undefined,
    getClientVersion: () => ({ name: 'dsh-native', version: '6.5.0-dsh.1' }),
    getNegotiatedProtocolVersion: () => undefined,
    getClientCapabilities: () => ({}),
  };

  constructor(_info, _options, recordEvidence, delivery) {
    this.recordEvidence = recordEvidence;
    this.delivery = delivery;
  }

  registerTool(name, config, callback) {
    if (this.tools.has(name)) throw new Error(`Duplicate native operation: ${name}`);
    const item = { config, callback };
    this.tools.set(name, item);
    return { update: update => Object.assign(item, update), remove: () => this.tools.delete(name) };
  }

  registerPrompt(name, config, callback) {
    if (this.prompts.has(name)) throw new Error(`Duplicate native prompt: ${name}`);
    const item = { config, callback };
    this.prompts.set(name, item);
    return { update: update => { const { callback: next, ...config } = update; Object.assign(item.config, config); if (next) item.callback = next; },
      remove: () => this.prompts.delete(name) };
  }

  async #run(options, callback) {
    if (this.#closing) throw new Error('REA native session is closed');
    const signal = options.signal ? AbortSignal.any([options.signal, this.#abort.signal]) : this.#abort.signal;
    const work = currentSignal.run(signal, () => callback(signal));
    this.#active.add(work);
    try { return await work; } finally { this.#active.delete(work); }
  }

  runNative(callback, options = {}) {
    return this.#run(options, callback);
  }

  drain() {
    return NativeRegistrar.prototype.close.call(this);
  }

  describeTool(name) {
    const registered = this.tools.get(name);
    if (!registered) throw new Error(`Unknown REA native operation: ${name}`);
    const { title, description, annotations, inputSchema, outputSchema } = registered.config;
    return { name, title, description, annotations,
      inputSchema: inputSchema['~standard'].jsonSchema.input({ target: 'draft-2020-12' }),
      ...(outputSchema ? { outputSchema: outputSchema['~standard'].jsonSchema.output({ target: 'draft-2020-12' }) } : {}),
    };
  }

  async invoke(name, input, options = {}) {
    const registered = this.tools.get(name);
    if (!registered) throw new Error(`Unknown REA native operation: ${name}`);
    const targetContent = toolReturnsTargetContent(name);
    return this.#run(options, async signal => {
      try {
      const parsed = await registered.config.inputSchema['~standard'].validate(input ?? {});
      if (parsed.issues) return this.delivery.toErrorToolResult(new AnalysisInputError(name, undefined,
        parsed.issues.map(issue => ({ path: (issue.path ?? []).map(part => typeof part === 'object' ? part.key : part),
          reason: 'invalid_value', message: issue.message }))), targetContent);
      const context = { mcpReq: { signal,
        ...(options.onProgress ? { _meta: { progressToken: name } } : {}),
        notify: async notification => { if (options.onProgress) await options.onProgress(notification.params); },
      } };
      const result = await registered.callback(parsed.value, context);
      if (!result.isError && registered.config.outputSchema) {
        const output = await registered.config.outputSchema['~standard'].validate(result.structuredContent);
        if (output.issues) return this.delivery.toErrorToolResult(new AnalysisOutputError(name,
          `Native handler returned output outside the upstream contract: ${output.issues.map(issue => issue.message).join('; ')}`), targetContent);
      }
      // Unlike MCP text framing, DSH can retain the complete structured error.
      return result;
      } catch (cause) {
        // Match the SDK's unexpected-handler-error result, retaining target provenance.
        return { isError: true, content: [{ type: 'text', text: cause instanceof Error ? cause.message : String(cause) }],
          ...(targetContent ? { _meta: TARGET_CONTENT_RESULT_META } : {}) };
      }
    });
  }

  async getPrompt(name, input = {}) {
    const registered = this.prompts.get(name);
    if (!registered) throw new Error(`Unknown REA native prompt: ${name}`);
    return this.#run({}, async () => {
    const parsed = await registered.config.argsSchema['~standard'].validate(input ?? {});
    if (parsed.issues) throw new AnalysisInputError(name, undefined, parsed.issues.map(issue => ({
      path: issue.path ?? [], reason: 'invalid_value', message: issue.message,
    })));
    return registered.callback(parsed.value);
    });
  }

  async completePrompt(name, argument, value, context = {}, options = {}) {
    const registered = this.prompts.get(name);
    if (!registered) throw new Error(`Unknown REA native prompt: ${name}`);
    return this.#run(options, async signal => {
      signal.throwIfAborted();
      const wrapped = registered.config.argsSchema.shape[argument];
      const field = wrapped?.type === 'optional' ? wrapped.def.innerType : wrapped;
      const complete = field?.[Symbol.for('mcp.completable')]?.complete;
      if (!complete) return { completion: { values: [], hasMore: false } };
      const suggestions = await complete(value, context);
      signal.throwIfAborted();
      return { completion: { values: suggestions.map(String).slice(0, 100), total: suggestions.length, hasMore: suggestions.length > 100 } };
    });
  }

  async close() {
    this.#closing = true;
    this.#abort.abort();
    await Promise.allSettled([...this.#active]);
  }
}
