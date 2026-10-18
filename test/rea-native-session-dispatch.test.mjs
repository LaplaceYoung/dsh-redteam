import test from 'node:test';
import assert from 'node:assert/strict';
import { NativeRegistrar, currentMcpRequestSignal } from '../src/rea-native/session/native-registrar.mjs';
import { createReaSession } from '../src/rea-native/session/runtime.mjs';
import { toolContract } from '../src/rea-native/session/upstream/dist/contracts/toolContracts.js';
import { PROMPT_CONTRACTS } from '../src/rea-native/session/upstream/dist/contracts/promptContracts.js';
import { toolRegistrationOptions } from '../src/rea-native/session/upstream/dist/server/toolRegistrationOptions.js';
import { createToolResultDelivery } from '../src/rea-native/session/upstream/dist/server/toolResult.js';
import { TARGET_CONTENT_RESULT_META } from '../src/rea-native/session/upstream/dist/server/toolResultEncoding.js';

const registrar = () => new NativeRegistrar({}, {}, undefined, createToolResultDelivery());
const goConfig = () => toolRegistrationOptions(toolContract('inspect_go_binary'));

test('native boundary rejects invalid input without running the handler and retains target provenance', async () => {
  const dispatch = registrar();
  let called = false;
  dispatch.registerTool('inspect_go_binary', goConfig(), () => { called = true; });
  const result = await dispatch.invoke('inspect_go_binary', { path: 5 });
  assert.equal(called, false);
  assert.equal(result.isError, true);
  assert.equal(result.structuredContent.error.code, 'invalid_request');
  assert.deepEqual(result._meta, TARGET_CONTENT_RESULT_META);
  await dispatch.close();
});

test('native boundary preserves unexpected handler failure and rejects malformed successful output', async () => {
  const failing = registrar();
  failing.registerTool('inspect_go_binary', goConfig(), () => { throw new Error('read failed for target'); });
  const failure = await failing.invoke('inspect_go_binary', { path: '/fixture' });
  assert.equal(failure.isError, true);
  assert.equal(failure.content[0].text, 'read failed for target');
  assert.deepEqual(failure._meta, TARGET_CONTENT_RESULT_META);
  const invalid = registrar();
  invalid.registerTool('inspect_go_binary', goConfig(), () => ({ content: [], structuredContent: { unexpected: true } }));
  const output = await invalid.invoke('inspect_go_binary', { path: '/fixture' });
  assert.equal(output.isError, true);
  assert.equal(output.structuredContent.error.code, 'unreadable_output');
  assert.deepEqual(output._meta, TARGET_CONTENT_RESULT_META);
  await Promise.all([failing.close(), invalid.close()]);
});

test('close cancels active calls, waits for their release and refuses subsequent work', async () => {
  const dispatch = registrar();
  let enter;
  const entered = new Promise(resolve => { enter = resolve; });
  let release;
  const released = new Promise(resolve => { release = resolve; });
  let signal;
  dispatch.registerTool('inspect_go_binary', goConfig(), async (_input, context) => {
    signal = context.mcpReq.signal;
    assert.equal(currentMcpRequestSignal(), signal);
    enter();
    await released;
    return { isError: true, content: [{ type: 'text', text: 'cancelled after releasing resource' }] };
  });
  const active = dispatch.invoke('inspect_go_binary', { path: '/fixture' });
  await entered;
  let closed = false;
  const closing = dispatch.close().then(() => { closed = true; });
  await Promise.resolve();
  assert.equal(signal.aborted, true);
  assert.equal(closed, false);
  await assert.rejects(dispatch.invoke('inspect_go_binary', {}), /session is closed/);
  release();
  assert.equal((await active).isError, true);
  await closing;
  assert.equal(closed, true);
});

test('request cancellation and progress propagate through native request context', async () => {
  const dispatch = registrar();
  const request = new AbortController();
  const progress = [];
  dispatch.registerTool('inspect_go_binary', goConfig(), async (_input, context) => {
    await context.mcpReq.notify({ params: { progressToken: context.mcpReq._meta.progressToken, progress: 1, message: 'read' } });
    request.abort();
    assert.equal(context.mcpReq.signal.aborted, true);
    return { isError: true, content: [{ type: 'text', text: 'cancelled' }] };
  });
  await dispatch.invoke('inspect_go_binary', { path: '/fixture' }, { signal: request.signal, onProgress: value => progress.push(value) });
  assert.deepEqual(progress, [{ progressToken: 'inspect_go_binary', progress: 1, message: 'read' }]);
  await dispatch.close();
});

test('real native registry describes all contracts, applies omitted arguments and renders every guided prompt', async () => {
  const session = await createReaSession();
  try {
    for (const name of session.operations) {
      const description = session.describeTool(name);
      assert.equal(description.name, name);
      assert.equal(description.inputSchema.type, 'object');
      assert.ok(description.outputSchema);
    }
    const bundle = await session.invoke('get_evidence_bundle');
    assert.notEqual(bundle.isError, true);
    assert.deepEqual(bundle.structuredContent.result.records, []);
    for (const contract of PROMPT_CONTRACTS) {
      const input = Object.fromEntries(Object.entries(contract.arguments).filter(([, argument]) => argument.required).map(([name]) => [name, `requested-${name}`]));
      const prompt = await session.getPrompt(contract.name, input);
      assert.equal(prompt.messages[0].role, 'user');
      assert.ok(prompt.messages[0].content.text.includes(contract.objective));
      for (const value of Object.values(input)) assert.ok(prompt.messages[0].content.text.includes(value));
    }
    const suggestions = await session.completePrompt('investigate_feature', 'provider_id', 'a');
    assert.deepEqual(suggestions.completion.values, ['auto']);
    const request = new AbortController(); request.abort();
    await assert.rejects(session.completePrompt('investigate_feature', 'provider_id', '', {}, { signal: request.signal }), { name: 'AbortError' });
    await assert.rejects(session.getPrompt('investigate_feature', {}), /Invalid/);
  } finally { await session.close(); }
});
