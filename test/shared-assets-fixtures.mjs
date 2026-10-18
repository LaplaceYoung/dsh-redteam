import { build } from 'esbuild';
const bundle = await build({ stdin: { contents: `
  export { RedTeamStore } from './src/store.ts';
  export { ArchiveRuntime } from './src/archives.ts';
  export * from './src/shared-assets.ts';
  export * from './src/task-management/deletion.ts';
  export { TaskLifecycleRuntime } from './src/task-management/integration.ts';
`, resolveDir: process.cwd(), loader: 'ts' }, bundle: true, platform: 'node', format: 'esm', packages: 'external', write: false });
const code = bundle.outputFiles[0].text.replace(/from\s+(["'])([^"']+)\1/g, (_match, _quote, specifier) => `from ${JSON.stringify(import.meta.resolve(specifier))}`);
export const { RedTeamStore, ArchiveRuntime, assetTaskIds, associateTaskAsset, taskAssets, taskAssetReferences, detachTaskAssets, restoreTaskAssets, remapTaskAssetReferences, deleteManagedTaskData, TaskLifecycleRuntime } = await import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`);
