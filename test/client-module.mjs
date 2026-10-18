import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

// These Node tests exercise the shipped lazy-module contract and graph/record
// views. Native control rendering is covered by the workspace/approval browser
// tests; fail explicitly if one of those controls is rendered in this fixture.
export async function loadClientModule() {
  let definition;
  vm.runInNewContext(await readFile(new URL('../lib/client.js', import.meta.url), 'utf8'), {
    window: { __ModuleLoader__: { load(value) { definition = value; } } },
  });
  const require = createRequire(import.meta.url);
  const hostControls = new Proxy({}, { get: (_target, name) => () => { throw new Error(`Native control ${String(name)} requires its browser fixture`); } });
  const exported = definition.factory(name => name === '@deepseek-ai/dsh-client-ui-primitives' ? hostControls : require(name));
  return { definition, exported };
}
