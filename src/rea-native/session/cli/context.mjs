import { AsyncLocalStorage } from 'node:async_hooks';
export const invocationContext = new AsyncLocalStorage();
export const currentInvocation = () => {
  const context = invocationContext.getStore();
  if (!context) throw new Error('Native CLI workflow requires an invocation context');
  return context;
};
export const markFailure = () => { currentInvocation().failed = true; };
export const reportProgress = async update => { await currentInvocation().onProgress?.(update); };
