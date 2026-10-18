import { Cli, z } from "incur";
import { exportWebScripts } from "../../../upstream/dist/application/WebScriptExportService.js";
import { ArtifactReaderFailure } from "../../../upstream/dist/artifacts/ArtifactReader.js";
import { ArtifactResourceScope } from "../../../upstream/dist/artifacts/ArtifactResourceScope.js";
import { CLI_COMMANDS } from "../cliCommandNames.js";
import { logCliCommand } from "../cliLogging.js";
import { analysisErrorWithCleanupFailure } from "../../../upstream/dist/domain/analysisErrorCleanup.js";
import { projectAnalysisError } from "../../../upstream/dist/domain/analysisErrorProjection.js";
import { ProviderCleanupError } from "../../../upstream/dist/domain/providerCleanupError.js";
/** Register the local captured-script export CLI workflow. */
export const registerWebScriptCommands = (cli, logger) => {
    cli.command(CLI_COMMANDS.exportWebScripts, {
        description: "Export retained website scripts into an absent directory for static JavaScript analysis",
        args: z.object({
            capturePath: z
                .string()
                .describe("Absolute path to saved page or scenario capture JSON"),
            outputDirectory: z
                .string()
                .describe("Absolute absent directory for verified scripts and manifest"),
        }),
        run: ({ args }) => logCliCommand(logger, CLI_COMMANDS.exportWebScripts, async () => {
            const resources = new ArtifactResourceScope();
            const result = await exportWebScripts({
                capture_path: args.capturePath,
                output_directory: args.outputDirectory,
            }, resources);
            try {
                await resources.close();
            }
            catch (cause) {
                const cleanup = ArtifactReaderFailure.cleanupObservation(cause, "Web script export resources");
                const failure = new ProviderCleanupError("web-script-export", cleanup.resources, { reason: cleanup.reason }, { cause, operation: "export_web_scripts" });
                const error = result.ok
                    ? failure
                    : analysisErrorWithCleanupFailure(result.error, failure, "export_web_scripts");
                return {
                    error: "Script export failed",
                    ...projectAnalysisError(error),
                };
            }
            return result.ok
                ? result.value
                : {
                    error: "Script export failed",
                    ...projectAnalysisError(result.error),
                };
        }),
    });
};
