import { HarnessError } from '@deepseek-ai/dsh-llm';
import { defineTool } from '@deepseek-ai/dsh-tools';
import { PROMPT_CONTRACTS } from '@dsh-redteam/rea-native-session/prompts';
import { evidenceFileCommands, evidenceFileInputSchemas, invokeEvidenceFileCommand } from './rea-native/index.js';
import { reaToolContracts } from './rea-native/catalog/index.js';
import { NativeReaSessions } from './rea-native/dsh-sessions.js';
const fileOperations = Object.keys(evidenceFileCommands);
const operations = [...reaToolContracts.map(contract => contract.name), ...fileOperations];
const json = (value) => JSON.parse(JSON.stringify(value));
const jsonOutput = { schema: { type: 'json' }, render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }] };
const nativeOutput = { ...jsonOutput, presentationMeta: (_args, value) => {
        if (typeof value !== 'object' || value === null)
            return null;
        if ('toolResult' in value && typeof value.toolResult === 'object' && value.toolResult !== null && '_meta' in value.toolResult && value.toolResult._meta !== undefined)
            return json(value.toolResult._meta);
        if ('_meta' in value && value._meta !== undefined)
            return json(value._meta);
        return null;
    } };
export function installNativeRea(ctx, store) {
    const sessions = new NativeReaSessions();
    const failures = new Map();
    ctx.effect(() => () => sessions.dispose());
    // DSH errors have no successful value. Preserve the full REA failure in metadata.
    ctx.on('tools/execute', async (exec, next) => {
        try {
            const result = await next();
            const failure = failures.get(exec.token);
            return failure && result.isError ? { ...result, content: [{ type: 'text', text: JSON.stringify(failure.body) }], meta: failure.metadata } : result;
        }
        finally {
            failures.delete(exec.token);
        }
    });
    ctx.effect(() => ctx.tools.register(defineTool({
        name: 'redteam_rea_native_manifest',
        description: 'Discover 207 native REA operations, four compatible evidence-file commands and six guided prompts. Session operations retain evidence in the calling DSH Agent.',
        parameters: {}, output: jsonOutput,
        execute: async () => json({ native: true, upstreamVersion: '6.5.0', operations: [
                ...reaToolContracts.map(({ name, description, inputSchema, annotations, effects }) => ({ name, description, inputSchema, annotations, effects })),
                ...fileOperations.map(name => ({ name, inputSchema: evidenceFileInputSchemas[name] })),
            ], prompts: PROMPT_CONTRACTS.map(({ name, title, description, arguments: args }) => ({ name, title, description, arguments: args })), workflowManifest: 'redteam_rea_native_workflow_manifest' }),
    })));
    ctx.effect(() => ctx.tools.register(defineTool({
        name: 'redteam_rea_native',
        description: 'Execute native REA in the calling Agent session, retaining complete structured results, target provenance and errors. External engines keep their original requirements. Discover contracts with redteam_rea_native_manifest.',
        parameters: { task_id: { type: 'string', required: true }, operation: { type: 'string', required: true, enum: operations }, input: { type: 'json' } },
        output: nativeOutput,
        execute: async (args, exec) => {
            if (!store.snapshot().tasks.some(task => task.id === args.task_id))
                throw new Error('task not found or archived: ' + args.task_id);
            exec.signal.throwIfAborted();
            const fileOperation = fileOperations.find(operation => operation === args.operation);
            if (fileOperation) {
                const result = await invokeEvidenceFileCommand(fileOperation, args.input);
                if (!result.ok)
                    throw result.error;
                exec.signal.throwIfAborted();
                const evidence = await store.addEvidence({ taskId: args.task_id, provider: 'rea', command: args.operation, summary: 'REA native ' + args.operation, raw: result.value });
                return json({ evidenceId: evidence.id, operation: args.operation, native: true, result: result.value });
            }
            const session = await sessions.get(exec.agent, exec.signal);
            exec.signal.throwIfAborted();
            const toolResult = await session.invoke(args.operation, args.input, { signal: exec.signal });
            if (toolResult.isError) {
                failures.set(exec.token, { metadata: json({ ...toolResult._meta, rea: toolResult }), body: toolResult });
                const error = toolResult.structuredContent?.error;
                const code = typeof error === 'object' && error !== null && 'code' in error && typeof error.code === 'string' ? error.code : 'REA_TOOL_ERROR';
                throw new HarnessError(toolResult.content.map(block => block.text ?? '').join('\n'), code);
            }
            exec.signal.throwIfAborted();
            const evidence = await store.addEvidence({ taskId: args.task_id, provider: 'rea', command: args.operation, summary: 'REA native ' + args.operation, raw: toolResult });
            return json({ evidenceId: evidence.id, operation: args.operation, native: true, result: toolResult.structuredContent, toolResult });
        },
    })));
    ctx.effect(() => ctx.tools.register(defineTool({
        name: 'redteam_rea_native_prompt',
        description: 'Render one of six original REA guided prompts or complete its arguments against this Agent session.',
        parameters: { name: { type: 'string', required: true, enum: PROMPT_CONTRACTS.map(contract => contract.name) }, arguments: { type: 'json' }, action: { type: 'string', enum: ['render', 'complete'] }, argument: { type: 'string' }, value: { type: 'string' } },
        output: jsonOutput,
        execute: async (args, exec) => {
            const input = args.arguments ?? {};
            if (typeof input !== 'object' || input === null || Array.isArray(input) || Object.values(input).some(value => typeof value !== 'string'))
                throw new HarnessError('Prompt arguments must be an object of strings', 'INVALID_ARGS');
            const values = Object.fromEntries(Object.entries(input).map(([key, value]) => [key, String(value)]));
            const session = await sessions.get(exec.agent, exec.signal);
            if (args.action === 'complete') {
                if (!args.argument)
                    throw new HarnessError('Completion requires argument', 'INVALID_ARGS');
                return json(await session.completePrompt(args.name, args.argument, args.value ?? '', { arguments: values }, { signal: exec.signal }));
            }
            exec.signal.throwIfAborted();
            return json(await session.getPrompt(args.name, values));
        },
    })));
    ctx.effect(() => ctx.tools.register(defineTool({
        name: 'redteam_rea_native_close',
        description: 'Close this Agent REA session, cancel and await active operations, and release engines. Export evidence first if needed. A later call starts a fresh session.',
        parameters: {}, output: jsonOutput,
        execute: async (_args, exec) => {
            if (!exec.agent)
                throw new HarnessError('Native REA session operations require a DSH Agent', 'REA_AGENT_REQUIRED');
            await sessions.close(exec.agent.id);
            return { closed: true, agentId: exec.agent.id };
        },
    })));
    ctx.effect(() => ctx.tools.register(defineTool({
        name: 'redteam_rea_native_workflow_manifest',
        description: 'Discover original CLI workflow argument and option contracts. 150 domain workflows run directly in-process; three commands managing a separate REA installation are explicitly not applicable to the DSH package.',
        parameters: { command: { type: 'string' } }, output: jsonOutput,
        execute: async (args) => {
            const { createNativeCli } = await import('@dsh-redteam/rea-native-session/cli');
            const cli = createNativeCli();
            return json(args.command ? cli.describe(args.command) : { native: true, commands: cli.commands.map(name => cli.describe(name)) });
        },
    })));
    ctx.effect(() => ctx.tools.register(defineTool({
        name: 'redteam_rea_native_workflow',
        description: 'Execute an original REA domain workflow directly, preserving its args/options schema and sharing this Agent target and evidence with native tools. Discover input with redteam_rea_native_workflow_manifest. Installation-management commands are not applicable to DSH.',
        parameters: { task_id: { type: 'string', required: true }, command: { type: 'string', required: true }, args: { type: 'json' }, options: { type: 'json' } }, output: nativeOutput,
        execute: async (args, exec) => {
            if (!store.snapshot().tasks.some(task => task.id === args.task_id))
                throw new Error('task not found or archived: ' + args.task_id);
            const record = (value) => {
                if (value === undefined)
                    return {};
                if (value === null || typeof value !== 'object' || Array.isArray(value))
                    throw new HarnessError('Workflow args and options must be objects', 'INVALID_ARGS');
                return value;
            };
            const input = { args: record(args.args), options: record(args.options) };
            const session = await sessions.get(exec.agent, exec.signal);
            const workflowResult = await session.invokeCommand(args.command, input, { signal: exec.signal });
            if (workflowResult.isError) {
                failures.set(exec.token, { metadata: json({ reaCli: workflowResult, provenance: { untrusted_content: true, source: 'analysis_target' } }), body: workflowResult });
                const error = workflowResult.error;
                const code = typeof error === 'object' && error !== null && 'code' in error && typeof error.code === 'string' ? error.code : 'REA_WORKFLOW_ERROR';
                throw new HarnessError(JSON.stringify(workflowResult.error ?? workflowResult.value), code);
            }
            exec.signal.throwIfAborted();
            const evidence = await store.addEvidence({ taskId: args.task_id, provider: 'rea', command: args.command, summary: 'REA native workflow ' + args.command, raw: workflowResult });
            return json({ evidenceId: evidence.id, native: true, command: args.command, result: workflowResult.value, workflowResult, _meta: { provenance: { untrusted_content: true, source: 'analysis_target' } } });
        },
    })));
    return sessions;
}
