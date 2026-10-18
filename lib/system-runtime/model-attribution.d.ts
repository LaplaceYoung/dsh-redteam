import type { GenerateOptions } from '@deepseek-ai/dsh-llm';
import type { TaskModelSelection } from '../task-management/runtime-model.js';
export interface ModelCallAttribution {
    taskId: string;
    role: string;
    profileId?: string;
    sessionId?: string;
}
/** Called before native request construction, so outer recording hooks already see the actual route identity. */
export declare function setNativeModelAttribution(sessionId: string, selection: TaskModelSelection): void;
export declare function clearNativeModelAttribution(sessionId: string): void;
/** Hand-built Planner requests own their exact identity and do not overwrite their parent Agent. */
export declare function setModelRequestAttribution(request: GenerateOptions, selection: TaskModelSelection): void;
/** Merge this with the caller's existing observation identity; never replaces run/intent/exploration context. */
export declare function resolveModelCallAttribution(request: GenerateOptions): ModelCallAttribution | undefined;
