export interface ReaPromptArgument {
  description: string;
  required: boolean;
  completion?: 'document' | 'procedure' | 'provider' | 'evidence' | 'capture' | 'manifest' | 'occurrence' | 'unknown';
}
export interface ReaPromptContract {
  name: string;
  title: string;
  description: string;
  objective: string;
  arguments: Record<string, ReaPromptArgument>;
  steps: Array<{ instruction: string; tools: string[] }>;
}
export const PROMPT_CONTRACTS: readonly ReaPromptContract[];
export function renderGuidedPrompt(contract: ReaPromptContract, arguments_: Record<string, string>): string;
