const requests = new WeakMap();
const sessions = new Map();
function identity(selection, sessionId) {
    return { taskId: selection.taskId, role: selection.role, ...(selection.profileId === null ? {} : { profileId: selection.profileId }), ...(sessionId ? { sessionId } : {}) };
}
/** Called before native request construction, so outer recording hooks already see the actual route identity. */
export function setNativeModelAttribution(sessionId, selection) { sessions.set(sessionId, identity(selection, sessionId)); }
export function clearNativeModelAttribution(sessionId) { sessions.delete(sessionId); }
/** Hand-built Planner requests own their exact identity and do not overwrite their parent Agent. */
export function setModelRequestAttribution(request, selection) { requests.set(request, identity(selection, request.sessionId)); }
/** Merge this with the caller's existing observation identity; never replaces run/intent/exploration context. */
export function resolveModelCallAttribution(request) { return requests.get(request) ?? (request.sessionId ? sessions.get(request.sessionId) : undefined); }
