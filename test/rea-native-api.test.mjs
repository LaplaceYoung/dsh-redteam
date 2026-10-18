import assert from 'node:assert/strict';
import test, { after } from 'node:test';
import { build } from 'esbuild';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';

const directory = await mkdtemp(join(tmpdir(), 'rea-native-api-'));
after(() => rm(directory, { recursive: true, force: true }));
const output = join(directory, 'index.mjs');
await build({ entryPoints: [fileURLToPath(new URL('../src/rea-native/index.ts', import.meta.url))],
  outfile: output, bundle: true, platform: 'node', format: 'esm', target: 'node22' });
const { ReaNativeRuntime, isNativeOperation, nativeInputSchemas, evidenceFileCommands } = await import(pathToFileURL(output));

test('DSH native API routes each public operation and preserves upstream input errors', async () => {
  const runtime = new ReaNativeRuntime();
  try {
    for (const [method, operation] of [
      ['inspectGoBinary', 'inspect_go_binary'],
      ['inspectRustBinary', 'inspect_rust_binary'],
      ['inspectPeResources', 'inspect_pe_resources'],
      ['inspectElectronFuses', 'inspect_electron_fuses'],
    ]) {
      const result = await runtime[method]({ path: 'relative.bin' });
      assert.equal(result.ok, false);
      assert.equal(result.error._tag, 'AnalysisInputError');
      assert.equal(result.error.operation, operation);
      assert.equal(result.error.issues[0].reason, 'invalid_format');
      assert.equal(isNativeOperation(operation), true);
      assert.equal(nativeInputSchemas[operation].additionalProperties, false);
    }
    assert.equal(isNativeOperation('decompile'), false);
    assert.equal(typeof evidenceFileCommands.inspect_evidence_bundle.invoke, 'function');
    const unknownField = await runtime.invoke('inspect_go_binary', { path: 'relative.bin', execute: true });
    assert.equal(unknownField.ok, false);
    assert.equal(unknownField.error._tag, 'AnalysisInputError');
    assert.match(JSON.stringify(unknownField.error.issues), /execute/);
  } finally {
    await runtime.close();
  }
});
