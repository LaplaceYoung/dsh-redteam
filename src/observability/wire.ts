import { AsyncLocalStorage } from 'node:async_hooks';
import { Dispatcher, getGlobalDispatcher, setGlobalDispatcher } from 'undici';

interface Attempt { status?: number; request: Buffer[]; response: Buffer[]; error?: string; complete: boolean }
export interface WireCapture { attempts: Attempt[] }
export type WireRecord = { available: false; reason: string } | {
  available: true;
  /** Exact body bytes, including SSE framing; base64 preserves non-UTF8 error bodies. */
  attempts: { status?: number; requestBase64: string; responseBase64: string; requestText: string; responseText: string; error?: string; complete: boolean }[];
};
const active = new AsyncLocalStorage<WireCapture>();
let installed: { dispatcher: Dispatcher; previous: Dispatcher; references: number } | undefined;

class RecordingDispatcher extends Dispatcher {
  override close: Dispatcher['close'];
  override destroy: Dispatcher['destroy'];
  constructor(private readonly inner: Dispatcher) { super(); this.close = inner.close.bind(inner); this.destroy = inner.destroy.bind(inner); }
  override dispatch(options: Dispatcher.DispatchOptions, handler: Dispatcher.DispatchHandler): boolean {
    const capture = active.getStore();
    if (!capture) return this.inner.dispatch(options, handler);
    const attempt: Attempt = { request: [], response: [], complete: false }; capture.attempts.push(attempt);
    const body = options.body;
    let forwarded = options;
    if (typeof body === 'string' || body instanceof Uint8Array) attempt.request.push(Buffer.from(body));
    else if (body && typeof body === 'object' && Symbol.asyncIterator in body) {
      // Node fetch supplies its serialized body as an async iterator. Tee reads
      // instead of pre-consuming it, preserving demand, cancellation and bytes.
      const source = body as AsyncIterable<Uint8Array | string>;
      const wrappedBody = new Proxy(body, { get(target, property, receiver) {
        if (property === Symbol.asyncIterator) return async function* () { for await (const chunk of source) { attempt.request.push(Buffer.from(chunk)); yield chunk; } };
        const value = Reflect.get(target, property, receiver); return typeof value === 'function' ? value.bind(target) : value;
      } });
      forwarded = { ...options, body: wrappedBody };
    }
    const wrapped: Dispatcher.DispatchHandler = {
      onRequestStart: (controller, context) => handler.onRequestStart?.(controller, context),
      onRequestUpgrade: (controller, status, headers, socket) => handler.onRequestUpgrade?.(controller, status, headers, socket),
      onResponseStart: (controller, status, headers, message) => { attempt.status = status; handler.onResponseStart?.(controller, status, headers, message); },
      onResponseData: (controller, chunk) => { attempt.response.push(Buffer.from(chunk)); handler.onResponseData?.(controller, chunk); },
      onResponseEnd: (controller, trailers) => { attempt.complete = true; handler.onResponseEnd?.(controller, trailers); },
      onResponseError: (controller, error) => { attempt.error = error.message; handler.onResponseError?.(controller, error); },
      onResponseStarted: () => handler.onResponseStarted?.(),
      onBodySent: chunk => handler.onBodySent?.(chunk),
      onRequestSent: () => handler.onRequestSent?.(),
    };
    return this.inner.dispatch(forwarded, wrapped);
  }
}

/** Wrap the host's existing official proxy dispatcher; never close its connections. */
export function installWireCapture(): () => void {
  if (!installed) {
    const previous = getGlobalDispatcher(), dispatcher = new RecordingDispatcher(previous);
    setGlobalDispatcher(dispatcher); installed = { previous, dispatcher, references: 0 };
  }
  const owned = installed; owned.references++; let disposed = false;
  return () => {
    if (disposed) return; disposed = true;
    if (--owned.references === 0) {
      if (getGlobalDispatcher() === owned.dispatcher) setGlobalDispatcher(owned.previous);
      if (installed === owned) installed = undefined;
    }
  };
}

/** Bind iterator execution, not just iterator construction, to the call identity. */
export async function* observeWire<T>(capture: WireCapture | undefined, source: AsyncIterable<T>): AsyncGenerator<T> {
  if (!capture) { yield* source; return; }
  const iterator = source[Symbol.asyncIterator](); let completed = false;
  try {
    while (true) {
      const item = await active.run(capture, () => iterator.next());
      if (item.done) { completed = true; return; }
      yield item.value;
    }
  } finally { if (!completed && iterator.return) await active.run(capture, () => iterator.return!()); }
}
export function wireRecord(capture: WireCapture): WireRecord {
  if (!capture.attempts.length) return { available: false, reason: 'No request crossed the host global undici dispatcher (local adapter, pre-transport failure or an adapter-owned custom transport).' };
  return { available: true, attempts: capture.attempts.map(attempt => {
    const request = Buffer.concat(attempt.request), response = Buffer.concat(attempt.response);
    return { ...(attempt.status === undefined ? {} : { status: attempt.status }), requestBase64: request.toString('base64'), responseBase64: response.toString('base64'), requestText: request.toString('utf8'), responseText: response.toString('utf8'), complete: attempt.complete, ...(attempt.error ? { error: attempt.error } : {}) };
  }) };
}
