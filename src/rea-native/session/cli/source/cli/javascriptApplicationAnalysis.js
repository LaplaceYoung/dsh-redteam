import { reportProgress } from '../../context.mjs';
import { JAVASCRIPT_APPLICATION_PROVIDER } from "../../../upstream/dist/application/InvestigationProviders.js";
import { createProgressReporter } from "../../../upstream/dist/application/ProgressReporter.js";
import { ArtifactReaderFailure } from "../../../upstream/dist/artifacts/ArtifactReader.js";
import { ArtifactResourceScope } from "../../../upstream/dist/artifacts/ArtifactResourceScope.js";
import { analysisErrorWithCleanupFailure } from "../../../upstream/dist/domain/analysisErrorCleanup.js";
import { projectAnalysisError } from "../../../upstream/dist/domain/analysisErrorProjection.js";
import { ProviderCleanupError } from "../../../upstream/dist/domain/providerCleanupError.js";
/** Execute the shared one-shot CLI boundary for static JavaScript analysis. */
export const runCliJavaScriptApplicationAnalysis = async (input, signal) => {
    const { analyzeJavaScriptApplication } = await import("../../../upstream/dist/application/javascript/JavaScriptApplicationService.js");
    const progress = createProgressReporter(async (update) => {
        await reportProgress(update);
    }, { minimumIntervalMs: 0 });
    const resources = new ArtifactResourceScope();
    const result = await analyzeJavaScriptApplication(input, resources, {
        progress,
        ...(signal === undefined ? {} : { signal }),
    });
    try {
        await resources.close();
    }
    catch (cause) {
        const cleanup = ArtifactReaderFailure.cleanupObservation(cause, "JavaScript application resources");
        const failure = new ProviderCleanupError(JAVASCRIPT_APPLICATION_PROVIDER.id, cleanup.resources, { reason: cleanup.reason }, { cause, operation: "analyze_javascript_application" });
        return cliError(result.ok
            ? failure
            : analysisErrorWithCleanupFailure(result.error, failure, "analyze_javascript_application"));
    }
    return result.ok ? result.value : cliError(result.error);
};
const cliError = (error) => ({
    error: "JavaScript application analysis failed",
    ...projectAnalysisError(error),
});
