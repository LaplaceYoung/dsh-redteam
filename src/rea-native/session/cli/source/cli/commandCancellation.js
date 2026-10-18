import { currentInvocation } from '../../context.mjs';
export const withCommandCancellation = async operation => { const { signal } = currentInvocation(); signal.throwIfAborted(); return operation(signal); };
