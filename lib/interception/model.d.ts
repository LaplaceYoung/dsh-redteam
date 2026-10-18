export type Action = 'allow' | 'deny' | 'ask';
export interface Rule {
    id: string;
    order: number;
    taskId?: string;
    name: string;
    enabled: boolean;
    priority: number;
    matchTarget: 'tool_name' | 'tool_input';
    matchType: 'string' | 'regex';
    pattern: string;
    action: Action;
    message: string;
    timeoutEnabled: boolean;
    timeoutSeconds: number;
    timeoutAction: 'allow' | 'deny';
    createdAt: string;
    updatedAt: string;
}
export type RuleInput = Omit<Rule, 'id' | 'order' | 'createdAt' | 'updatedAt'>;
export interface JudgeConfig {
    enabled: boolean;
    profileId: string | null;
    prompt: string;
    timeoutSeconds: number;
    failAction: Action;
    askTimeoutSeconds: number;
    askTimeoutAction: 'allow' | 'deny';
}
export declare const defaultJudgeConfig: () => JudgeConfig;
/** Native DSH aliases correspond to the original enabled tool roles, not every tool. */
export declare const defaultEnabledTools: string[];
export declare function validateRule(input: RuleInput): void;
export declare function validateJudge(config: JudgeConfig): void;
export declare function matchRule(rules: readonly Rule[], name: string, input: string, taskId?: string): Rule | undefined;
export declare function effectivePrompt(prompt: string): string;
export declare function parseVerdict(text: string): {
    action: Action;
    reason: string;
};
export interface ReviewInput {
    version: 4;
    working_directory?: string;
    background?: {
        source: 'user_message';
        text: string;
        truncated?: boolean;
    };
    tool_name: string;
    arguments: unknown;
}
export declare function reviewInput(name: string, input: unknown, environment?: {
    workingDirectory?: string;
    humanMessage?: string;
    worker?: boolean;
}): ReviewInput;
