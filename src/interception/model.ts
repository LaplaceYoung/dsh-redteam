import { RE2 } from 're2-wasm';
import { JudgeContextBoundary, JudgeOutputContract, DefaultJudgePrompt } from './prompt.js';

export type Action = 'allow' | 'deny' | 'ask';
export interface Rule {
  id: string; order: number; taskId?: string; name: string; enabled: boolean; priority: number;
  matchTarget: 'tool_name' | 'tool_input'; matchType: 'string' | 'regex'; pattern: string;
  action: Action; message: string; timeoutEnabled: boolean; timeoutSeconds: number; timeoutAction: 'allow' | 'deny';
  createdAt: string; updatedAt: string;
}
export type RuleInput = Omit<Rule, 'id' | 'order' | 'createdAt' | 'updatedAt'>;
export interface JudgeConfig {
  enabled: boolean; profileId: string | null; prompt: string; timeoutSeconds: number; failAction: Action;
  askTimeoutSeconds: number; askTimeoutAction: 'allow' | 'deny';
}
export const defaultJudgeConfig = (): JudgeConfig => ({ enabled: false, profileId: null, prompt: '', timeoutSeconds: 15, failAction: 'allow', askTimeoutSeconds: 300, askTimeoutAction: 'deny' });
/** Native DSH aliases correspond to the original enabled tool roles, not every tool. */
export const defaultEnabledTools = ['Bash', 'WebFetch', 'web_search', 'shell_open', 'shell_send', 'Write', 'Edit', 'MultiEdit', 'bash', 'pwsh', 'web_fetch', 'write_file', 'edit_file', 'apply_patch'];
export function validateRule(input: RuleInput): void {
  if (typeof input.name !== 'string' || !input.name || typeof input.pattern !== 'string' || !input.pattern) throw new Error('Rule name and pattern are required');
  if (!['tool_name', 'tool_input'].includes(input.matchTarget) || !['string', 'regex'].includes(input.matchType)) throw new Error('Invalid rule match target/type');
  if (!['allow', 'deny', 'ask'].includes(input.action)) throw new Error('Invalid rule action');
  if (!Number.isSafeInteger(input.priority) || !Number.isSafeInteger(input.timeoutSeconds)) throw new Error('Rule priority and timeoutSeconds must be integers');
  if (typeof input.enabled !== 'boolean' || typeof input.timeoutEnabled !== 'boolean' || typeof input.message !== 'string') throw new Error('Invalid rule fields');
  if (!['allow', 'deny'].includes(input.timeoutAction)) throw new Error('Invalid timeout action');
  if (input.taskId !== undefined && (typeof input.taskId !== 'string' || !input.taskId)) throw new Error('Invalid taskId');
  if (input.matchType === 'regex') new RE2(input.pattern, 'u');
}
export function validateJudge(config: JudgeConfig): void {
  if (typeof config.enabled !== 'boolean' || typeof config.prompt !== 'string' || !(config.profileId === null || typeof config.profileId === 'string' && config.profileId)) throw new Error('Invalid judge settings');
  if (!['allow', 'deny', 'ask'].includes(config.failAction) || !['allow', 'deny'].includes(config.askTimeoutAction)) throw new Error('Invalid judge action');
  if (!Number.isSafeInteger(config.timeoutSeconds) || !Number.isSafeInteger(config.askTimeoutSeconds)) throw new Error('Judge timeouts must be integers');
}
export function matchRule(rules: readonly Rule[], name: string, input: string, taskId?: string): Rule | undefined {
  return rules.filter(r => r.enabled && (r.taskId === undefined || r.taskId === taskId)).sort((a, b) => b.priority - a.priority || a.order - b.order).find(rule => {
    const subject = rule.matchTarget === 'tool_name' ? name : input;
    return rule.matchType === 'regex' ? new RE2(rule.pattern, 'u').test(subject) : subject.includes(rule.pattern);
  });
}
export function effectivePrompt(prompt: string): string {
  let value = prompt.trim() ? prompt : DefaultJudgePrompt;
  if (!value.includes(JudgeContextBoundary)) value += '\n\n' + JudgeContextBoundary;
  if (!value.includes(JudgeOutputContract)) value += '\n\n' + JudgeOutputContract;
  return value;
}
export function parseVerdict(text: string): { action: Action; reason: string } {
  let value = text.trim();
  if (value.startsWith('```') && value.endsWith('```') && value.length > 6) {
    value = value.slice(3, -3).trim();
    if (!value.startsWith('{') && value.includes('\n')) value = value.slice(value.indexOf('\n') + 1).trim();
  }
  // Exactly two JSON string properties also detects duplicate keys, unlike JSON.parse alone.
  const string = '"(?:[^"\\\\\u0000-\u001f]|\\\\(?:["\\\\/bfnrt]|u[0-9a-fA-F]{4}))*"';
  const pattern = new RegExp(`^\\{\\s*(${string})\\s*:\\s*(${string})\\s*,\\s*(${string})\\s*:\\s*(${string})\\s*\\}$`);
  const parts = pattern.exec(value);
  if (!parts) throw new Error('Invalid judge JSON envelope');
  const keys = [JSON.parse(parts[1]), JSON.parse(parts[3])];
  if (new Set(keys).size !== 2 || !keys.includes('decision') || !keys.includes('comment')) throw new Error('Invalid judge JSON fields');
  const parsed: { decision: string; comment: string } = JSON.parse(value);
  const reason = parsed.comment.trim();
  const explanation = /^实际操作：([\s\S]*?)；成功后的后果：([\s\S]*?)；命中规则：([\s\S]*)$/.exec(reason);
  if (!['allow', 'ask', 'deny'].includes(parsed.decision) || Buffer.byteLength(reason) > 2400 || !explanation || explanation.slice(1).some(x => !x.trim())) throw new Error('Invalid judge decision or explanation');
  return { action: parsed.decision as Action, reason };
}
export interface ReviewInput { version: 4; working_directory?: string; background?: { source: 'user_message'; text: string; truncated?: boolean }; tool_name: string; arguments: unknown }
export function reviewInput(name: string, input: unknown, environment: { workingDirectory?: string; humanMessage?: string; worker?: boolean } = {}): ReviewInput {
  const encoded = JSON.stringify(input);
  if (encoded === undefined) throw new Error('Tool arguments are not valid JSON');
  const result: ReviewInput = { version: 4, tool_name: name, arguments: JSON.parse(encoded) };
  if (environment.workingDirectory) result.working_directory = environment.workingDirectory;
  if (!environment.worker && environment.humanMessage?.trim()) {
    const original = Buffer.from(environment.humanMessage); let cut = original.subarray(0, 4000).toString('utf8');
    if (original.length > 4000 && cut.endsWith('\ufffd')) cut = cut.slice(0, -1);
    result.background = { source: 'user_message', text: cut, ...(original.length > 4000 ? { truncated: true } : {}) };
  }
  return result;
}
