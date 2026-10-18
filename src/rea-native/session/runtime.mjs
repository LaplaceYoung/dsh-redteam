import { parseConfig } from './upstream/dist/config/parseConfig.js';
import { createBinarySession } from './upstream/dist/composition/binary.js';
import { createServer } from './upstream/dist/server/createServer.js';
import { createOptionalObservationFactories, loadOptionalObservationProviders } from './upstream/dist/composition/optionalObservationProviders.js';
import { silentLogger } from './upstream/dist/logger.js';
import { createToolResultDelivery } from './upstream/dist/server/toolResult.js';
import { projectAnalysisError } from './upstream/dist/domain/analysisErrorProjection.js';
export { projectAnalysisError };

/** Each call owns its provider routers, active target, evidence and runtime resources. */
export async function createReaSession(options = {}) {
  const environment = { ...process.env, ...options.environment };
  const parsed = parseConfig(environment);
  if (!parsed.ok) throw parsed.error;
  const session = createBinarySession(parsed.value, silentLogger, environment);
  const optional = await loadOptionalObservationProviders(createOptionalObservationFactories(environment));
  let dispatcher;
  try {
    dispatcher = createServer({ kind: 'session', session }, { environment, logger: silentLogger,
      ...optional, delivery: createToolResultDelivery(parsed.value.mcpMaxResponseBytes) });
  } catch (cause) {
    const results = await Promise.allSettled([
      Promise.resolve().then(() => session.close({ retainProviderDocuments: true }))
        .then(result => { if (!result.ok) throw result.error; }),
      Promise.resolve().then(() => optional.browserScenarioCapture?.close?.()),
    ]);
    const failures = results.flatMap(result => result.status === 'rejected' ? [result.reason] : []);
    if (failures.length) throw new AggregateError([cause, ...failures], 'Native session startup and cleanup failed');
    throw cause;
  }
  let closing;
  let cli;
  let queue = Promise.resolve();
  // CLI workflows can open and mutate the same target as registered tools.
  // Serialize both surfaces while tracking queued work for cancellation/close.
  const enqueue = callback => {
    const work = queue.then(callback);
    queue = work.then(() => undefined, () => undefined);
    return work;
  };
  const getCli = () => cli ??= import('./cli/runtime.mjs').then(({ createNativeCli }) => createNativeCli({ environment, session }));
  return {
    operations: Object.freeze([...dispatcher.tools.keys()]),
    prompts: Object.freeze([...dispatcher.prompts.keys()]),
    describeTool: name => dispatcher.describeTool(name),
    invoke: (name, input, request = {}) => dispatcher.runNative(signal => enqueue(() => {
      signal.throwIfAborted();
      return dispatcher.invoke(name, input, { ...request, signal });
    }), request),
    describeCommand: async name => (await getCli()).describe(name),
    listCommands: async () => (await getCli()).commands,
    invokeCommand: (name, input, request = {}) => dispatcher.runNative(signal => enqueue(async () => {
      signal.throwIfAborted();
      return (await getCli()).invoke(name, input, { ...request, signal });
    }), request),
    getPrompt: (name, input) => dispatcher.getPrompt(name, input),
    completePrompt: (name, argument, value, context, request) => dispatcher.completePrompt(name, argument, value, context, request),
    status: () => session.status(),
    close() {
      closing ??= (async () => {
        await dispatcher.drain();
        const results = await Promise.allSettled([
          dispatcher.close(), optional.browserScenarioCapture?.close?.(),
          session.close({ retainProviderDocuments: true }).then(result => { if (!result.ok) throw result.error; }),
        ]);
        const failures = results.flatMap(result => result.status === 'rejected' ? [result.reason] : []);
        if (failures.length) { closing = undefined; throw new AggregateError(failures, 'Native session cleanup failed'); }
      })();
      return closing;
    },
  };
}
