import { Cli, z } from 'incur';
import { createCli, cliConfigurationError } from './source/cli.js';
import { cliOperationFailurePayload } from './source/cliLogging.js';
import { invocationContext } from './context.mjs';
import { AnalysisInputError } from '../upstream/dist/domain/analysisErrorCore.js';
import { projectAnalysisError } from '../upstream/dist/domain/analysisErrorProjection.js';
import { evidenceSchema } from '../upstream/dist/domain/evidence.js';

const installationCommands = new Map([
  ['setup', 'Registers the separate REA CLI/MCP installation and bundled skill in other clients; DSH installs this native plugin through its plugin package configuration.'],
  ['update', 'Updates the separate rea-agents installation; update the DSH plugin package with its package manager instead.'],
  ['uninstall', 'Deletes separate REA client registrations, skills and optionally caches; remove the DSH plugin package/configuration instead.'],
]);
const empty = z.object({});
const inputSchema = schema => z.toJSONSchema((schema ?? empty).strict(), { io: 'input', target: 'draft-2020-12' });
const invalid = (name, issues) => projectAnalysisError(new AnalysisInputError(name, undefined, issues.map(issue => ({ path: issue.path, reason: 'invalid_value', message: issue.message }))));

/** Invoke original registered workflows without an argv parser, CLI process or MCP transport. */
export function createNativeCli({ environment = process.env, session } = {}) {
  const configurationError = cliConfigurationError(environment);
  if (configurationError) throw new Error(configurationError);
  const buildCommands = () => {
    const registered = Cli.toCommands.get(createCli(environment));
    const commands = new Map();
    const visit = (entries, prefix = '') => {
      for (const [name, entry] of entries) {
        const qualified = prefix + name;
        if ('_group' in entry) { visit(entry.commands, qualified + ' '); if (entry.root) commands.set(qualified, entry.root); }
        else if (!('_fetch' in entry)) commands.set(qualified, entry);
      }
    };
    visit(registered);
    return commands;
  };
  const commands = buildCommands();
  const get = (name, collection = commands) => {
    let command = collection.get(name);
    if (!command) throw new Error(`Unknown native CLI workflow: ${name}`);
    if ('_alias' in command) command = collection.get(command.target);
    if (!command?.run) throw new Error(`Native CLI workflow cannot resolve handler: ${name}`);
    return command;
  };
  return {
    commands: Object.freeze([...commands].filter(([, command]) => !('_alias' in command)).map(([name]) => name).sort()),
    describe(name) {
      const command = get(name);
      return { name, description: command.description, argsSchema: inputSchema(command.args), optionsSchema: inputSchema(command.options),
        classification: installationCommands.has(name) ? 'external-installation-management' : 'native-workflow',
        ...(installationCommands.has(name) ? { unavailableReason: installationCommands.get(name) } : {}) };
    },
    async invoke(name, input = {}, request = {}) {
      // Original registrations own one-shot services that permanently close after use.
      const command = get(name, buildCommands());
      if (installationCommands.has(name)) {
        const error = { code: 'REA_INSTALLATION_COMMAND_NOT_APPLICABLE', message: installationCommands.get(name), command: name };
        return { isError: true, value: error, error };
      }
      const args = (command.args ?? empty).strict().safeParse(input.args ?? {});
      const options = (command.options ?? empty).strict().safeParse(input.options ?? {});
      if (!args.success || !options.success) {
        const error = invalid(name, [...(!args.success ? args.error.issues.map(issue => ({ ...issue, path: ['args', ...issue.path] })) : []), ...(!options.success ? options.error.issues.map(issue => ({ ...issue, path: ['options', ...issue.path] })) : [])]);
        return { isError: true, value: error, error };
      }
      const signal = request.signal ?? new AbortController().signal;
      signal.throwIfAborted();
      const context = { signal, session, onProgress: request.onProgress, failed: false };
      return invocationContext.run(context, async () => {
        const value = await command.run({ args: args.data, options: options.data, format: 'json', formatExplicit: true });
        const error = cliOperationFailurePayload(value);
        const isError = context.failed || error !== undefined;
        if (session) {
          // The Frida command alone declares an Evidence wrapper; ordinary commands
          // return Evidence at the root. Never search arbitrary JSON for records.
          const candidate = name === 'instrument-with-frida' ? value?.evidence : value;
          const evidence = evidenceSchema.safeParse(candidate);
          if (evidence.success) {
            const recorded = session.recordEvidence(candidate);
            if (!recorded.ok) return { isError: true, value, error: projectAnalysisError(recorded.error.retainPartialObservation(candidate)) };
          }
        }
        return { isError, value, ...(error !== undefined ? { error } : {}) };
      });
    },
  };
}
