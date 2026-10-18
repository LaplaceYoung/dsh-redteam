import type { GenerateOptions } from '@deepseek-ai/dsh-llm';
import type { TaskModelSelection } from '../task-management/runtime-model.js';
export interface ModelCallAttribution { taskId: string; role: string; profileId?: string; sessionId?: string }
const requests = new WeakMap<GenerateOptions, ModelCallAttribution>();
const sessions = new Map<string, ModelCallAttribution>();
function identity(selection: TaskModelSelection, sessionId?: string): ModelCallAttribution {
  return { taskId: selection.taskId, role: selection.role, ...(selection.profileId === null ? {} : { profileId: selection.profileId }), ...(sessionId ? { sessionId } : {}) };
}
/** Called before native request construction, so outer recording hooks already see the actual route identity. */
export function setNativeModelAttribution(sessionId: string, selection: TaskModelSelection): void { sessions.set(sessionId, identity(selection, sessionId)); }
export function clearNativeModelAttribution(sessionId: string): void { sessions.delete(sessionId); }
/** Hand-built Planner requests own their exact identity and do not overwrite their parent Agent. */
export function setModelRequestAttribution(request: GenerateOptions, selection: TaskModelSelection): void { requests.set(request, identity(selection, request.sessionId)); }
/** Merge this with the caller's existing observation identity; never replaces run/intent/exploration context. */
export function resolveModelCallAttribution(request: GenerateOptions): ModelCallAttribution | undefined { return requests.get(request) ?? (request.sessionId ? sessions.get(request.sessionId) : undefined); }
