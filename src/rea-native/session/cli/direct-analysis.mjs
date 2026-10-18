import { currentInvocation } from './context.mjs';
import { parseConfig } from '../upstream/dist/config/parseConfig.js';
import * as binary from '../upstream/dist/composition/binary.js';
import * as analysis from '../upstream/dist/application/DirectAnalysis.js';
import { runSessionStatus } from '../upstream/dist/application/DirectAnalysisStatus.js';

// One-shot workflow cleanup must not release the DSH-owned aggregate.
const borrowedSessions = new WeakMap();
const borrow = session => {
  let borrowed = borrowedSessions.get(session);
  if (!borrowed) {
    borrowed = new Proxy(session, { get(target, key) {
      if (key === 'close') return async () => ({ ok: true, value: undefined });
      const value = Reflect.get(target, key, target);
      return typeof value === 'function' ? value.bind(target) : value;
    } });
    borrowedSessions.set(session, borrowed);
  }
  return borrowed;
};
export const createDirectAnalysis = environment => {
  const injected = () => currentInvocation().session;
  const dependencies = {
    readConfiguration: () => parseConfig(environment),
    createBinarySession: async (config, logger) => injected() ? borrow(injected()) : binary.createBinarySession(config, logger, environment),
    createManagedBinarySession: async () => injected() ? borrow(injected()) : binary.createManagedBinarySession(),
    createArtifactBinarySession: async () => injected() ? borrow(injected()) : binary.createArtifactBinarySession(environment),
  };
  return {
    runDirectAnalysis: (path, tool, input, options = {}) => analysis.runDirectAnalysis(dependencies, path, tool, input, { ...options, signal: currentInvocation().signal }),
    runProviderAnalysis: (path, tool, input, logger) => analysis.runProviderAnalysis(dependencies, path, tool, input, logger, currentInvocation().signal),
    runSessionStatus: logger => runSessionStatus(dependencies, logger),
  };
};
