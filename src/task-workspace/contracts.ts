import type { RedTeamTask, Goal, Constraint, ScopeEntry, Company } from '../types.js';
import type { NewTaskInput, TaskCategory, TaskTemplate, TaskTemplateInput, TaskTemplatePatch } from '../task-management/index.js';
import type { TaskModelProfile, TaskModelProfileInput } from '../task-management/runtime-profiles.js';

export const TASK_WORKSPACE_PATH = '/api/redteam/task-workspace';
export interface TaskWorkspace {
  version: 1;
  tasks: RedTeamTask[];
  categories: Array<TaskCategory & { taskCount: number }>;
  templates: TaskTemplate[];
  goals: Goal[];
  constraints: Constraint[];
  scopes: ScopeEntry[];
  companies: Company[];
  profiles: Array<TaskModelProfile & { available: boolean; reason?: string }>;
  catalog: { providers: Array<{ id: string; name: string }>; models: Array<{ id: string; provider: string; name: string; reasoningEfforts: Array<{ id: string; name: string }> }> };
  agent: { sessionId: string | null; available: boolean; provider?: string; model?: string; error?: string };
  admission: { enabled: boolean; limit: number };
}
/** sessionId is the current sidebar scope, never an automatically chosen Agent. */
export type TaskWorkspaceAction = { sessionId?: string } & (
  | { action: 'task.create'; input: NewTaskInput }
  | { action: 'task.metadata'; taskId: string; patch: { title?: string; pinned?: boolean } }
  | { action: 'task.category'; taskIds: string[]; categoryId: string | null }
  | { action: 'task.start' | 'task.pause' | 'task.resume' | 'task.rerun'; taskId: string }
  | { action: 'task.delete'; taskId: string; deleteAssets?: boolean; deleteFindings?: boolean }
  | { action: 'category.create'; name: string }
  | { action: 'category.rename'; id: string; name: string }
  | { action: 'category.delete'; id: string }
  | { action: 'template.create'; input: TaskTemplateInput }
  | { action: 'template.update'; id: string; patch: TaskTemplatePatch }
  | { action: 'template.delete'; id: string }
  | { action: 'goal.create'; taskId: string; text: string; vulnClass?: string }
  | { action: 'goal.update'; taskId: string; id: string; text: string; vulnClass?: string }
  | { action: 'goal.delete'; taskId: string; id: string }
  | { action: 'constraint.create'; taskId: string; kind: 'allow' | 'deny'; text: string }
  | { action: 'constraint.update'; taskId: string; id: string; kind: 'allow' | 'deny'; text: string }
  | { action: 'constraint.delete'; taskId: string; id: string }
  | { action: 'chain.set'; taskId: string; profileIds: string[]; activeProfileId?: string | null }
  | { action: 'profile.upsert'; input: TaskModelProfileInput }
  | { action: 'profile.delete'; id: string }
);
export interface TaskWorkspaceResult { workspace: TaskWorkspace; taskId?: string }
export interface TaskWorkspaceError { error: string; code: string }
