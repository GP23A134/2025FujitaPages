const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const test = require('node:test');
const { TextEncoder } = require('node:util');

const base = path.join(__dirname, '../web/js/editor/chat/agent');
function load(relativePath, exportNames, stubs = {}) {
  const source = fs.readFileSync(path.join(base, relativePath), 'utf8')
    .replace(/^import .*;\s*$/gm, '')
    .replace(/^export /gm, '')
    .concat(`\nmodule.exports = { ${exportNames} };`);
  const sandboxModule = { exports: {} };
  vm.runInNewContext(source, { module: sandboxModule, exports: sandboxModule.exports, TextEncoder, Object, Set, Map, JSON, TypeError, RangeError, Error, ...stubs });
  return sandboxModule.exports;
}

const { createToolRegistry } = load('agent-runtime/tool-registry.js', 'createToolRegistry');
const { createPermissionGuard } = load('agent-runtime/permission-guard.js', 'createPermissionGuard');
const { createBudgetGuard, estimateInputTokens } = load('agent-runtime/budget-guard.js', 'createBudgetGuard, estimateInputTokens');
const { createToolDispatcher } = load('agent-runtime/tool-dispatcher.js', 'createToolDispatcher');
const { createAgentRunLoop } = load('agent-runtime/run-loop.js', 'createAgentRunLoop');
const baseState = { counters: { responseRounds: 0, retrievalCalls: 0, replans: 0, inputTokensReserved: 0, inputTokensActual: 0 } };

test('tool registry exposes only registered functions and rejects duplicates', () => {
  const registry = createToolRegistry();
  registry.register({ name: 'read_items', description: 'read items', parameters: { type: 'object' }, permission: 'reference', execute: async () => [] });
  assert.equal(registry.names().join(','), 'read_items');
  assert.equal(registry.definitions().map(({ name }) => name).join(','), 'read_items');
  assert.throws(() => registry.register({ name: 'read_items', description: 'duplicate', parameters: {}, execute() {} }), /重複/);
});

test('permission guard rejects writes and IDs outside the approved read scope', () => {
  const guard = createPermissionGuard({ getReferenceScope: () => ['a'], getChangeScope: () => ['b'] });
  assert.throws(() => guard.assertToolAllowed({ permission: 'write' }, {}), (error) => error.code === 'TOOL_NOT_READ_ONLY');
  assert.throws(() => guard.assertToolAllowed({ permission: 'reference' }, { classId: 'b' }), (error) => error.code === 'SCOPE_DENIED');
  assert.equal(guard.assertToolAllowed({ permission: 'reference' }, { classId: 'a' }), true);
  assert.equal(guard.canChange('b'), true);
});

test('input token budget reserves conservatively and reconciles only its own request', () => {
  const guard = createBudgetGuard({
    state: baseState,
    limits: { inputTokenCap: 2000, maxResponseRounds: 4, maxRetrievalCalls: 3, maxReplans: 2 }
  });
  const first = guard.reserveInput({ input: 'hello' });
  const second = guard.reserveInput({ input: 'こんにちは' });
  assert.equal(guard.getCounters().inputTokensReserved, first.estimate + second.estimate);
  guard.reconcileInput(first, 23);
  assert.equal(guard.getCounters().inputTokensActual, 23);
  assert.equal(guard.getCounters().inputTokensReserved, second.estimate);
  guard.reconcileInput(second, null);
  assert.equal(guard.getCounters().inputTokensReserved, second.estimate);
  assert.ok(estimateInputTokens('日本語') > 0);
});

test('token budget stops before sending and detects actual usage overrun', () => {
  const guard = createBudgetGuard({ state: baseState, limits: { inputTokenCap: 260, maxResponseRounds: 4, maxRetrievalCalls: 3, maxReplans: 2 } });
  assert.throws(() => guard.reserveInput({ text: 'x'.repeat(100) }), (error) => error.code === 'INPUT_TOKEN_BUDGET');

  const secondGuard = createBudgetGuard({ state: baseState, limits: { inputTokenCap: 300, maxResponseRounds: 4, maxRetrievalCalls: 3, maxReplans: 2 } });
  const reservation = secondGuard.reserveInput('short');
  assert.equal(secondGuard.reconcileInput(reservation, 301).overBudget, true);
});

test('input budget reserves a final response and supports releasing its probe', () => {
  const guard = createBudgetGuard({ state: baseState, limits: { inputTokenCap: 1000, maxResponseRounds: 4, maxRetrievalCalls: 3, maxReplans: 2 } });
  assert.throws(() => guard.reserveInput('small request', { reserveForInput: 'x'.repeat(800) }),
    (error) => error.code === 'INPUT_TOKEN_FINALIZATION_REQUIRED' && error.status === 'budget_soft_stop');
  const reservation = guard.reserveInput('small request');
  guard.releaseInput(reservation);
  assert.equal(guard.getCounters().inputTokensReserved, 0);
});

test('agent loop compacts prior tool-call history into retrieved-data context', async () => {
  const requests = [];
  const registry = { definitions: () => [{ name: 'read_items' }], names: () => ['read_items'] };
  const dispatcher = { dispatch: async () => ({ ok: true, data: { items: [{ id: 'c1', label: '項目' }] } }), takeScopeRequest: () => null };
  const budgetGuard = createBudgetGuard({ state: baseState, limits: { inputTokenCap: 10000, maxResponseRounds: 4, maxRetrievalCalls: 3, maxReplans: 2 } });
  const loop = createAgentRunLoop({
    client: { request: async (request) => {
      requests.push(request);
      if (requests.length === 1) return { output: [{ type: 'function_call', name: 'read_items', arguments: '{}', call_id: 'call1' }], usage: { input_tokens: 20 } };
      return { output: [{ content: [{ type: 'output_text', text: '{"message":"完了","proposals":[],"alternativeGroups":[]}' }] }], usage: { input_tokens: 20 } };
    } },
    registry, dispatcher, budgetGuard, model: 'test', apiKey: 'secret', systemInstruction: 'system', maxOutputTokens: 100, textFormat: {}
  });
  await loop.run({ messages: [{ role: 'user', content: '確認する' }] });
  assert.equal(requests.length, 2);
  assert.equal(requests[1].input.some((item) => item.type === 'function_call'), false);
  assert.match(requests[1].input.at(-1).content, /取得済みデータ.*read_items/s);
  assert.match(requests[1].input.at(-1).content, /項目/);
});

test('agent loop returns app-verifiable successful and failed retrieval records', async () => {
  let requestCount = 0;
  const loop = createAgentRunLoop({
    client: { request: async () => ++requestCount === 1
      ? { output: [
        { type: 'function_call', name: 'read_items', arguments: '{"cursor":null}', call_id: 'ok' },
        { type: 'function_call', name: 'read_items', arguments: '{"cursor":"bad"}', call_id: 'failed' }
      ], usage: { input_tokens: 10 } }
      : { output: [{ content: [{ type: 'output_text', text: '{"message":"確認","proposals":[],"alternativeGroups":[]}' }] }], usage: { input_tokens: 10 } } },
    registry: { definitions: () => [{ name: 'read_items' }], names: () => ['read_items'] },
    dispatcher: { dispatch: async (_name, rawArgs) => JSON.parse(rawArgs).cursor === 'bad'
      ? { ok: false, error: { code: 'INVALID_CURSOR' } }
      : { ok: true, data: { items: [{ id: 'x' }], totalCount: 1, nextCursor: null } }, takeScopeRequest: () => null },
    budgetGuard: createBudgetGuard({ state: baseState, limits: { inputTokenCap: 10000, maxResponseRounds: 4, maxRetrievalCalls: 4, maxReplans: 2 } }),
    model: 'test', apiKey: 'secret', systemInstruction: 'system', maxOutputTokens: 100, textFormat: {}
  });
  const result = await loop.run({ messages: [{ role: 'user', content: '確認' }] });
  assert.equal(result.retrievalEvidence.length, 2);
  assert.equal(result.retrievalEvidence[0].ok, true);
  assert.equal(result.retrievalEvidence[0].data.totalCount, 1);
  assert.equal(result.retrievalEvidence[1].ok, false);
  assert.equal(result.retrievalEvidence[1].errorCode, 'INVALID_CURSOR');
});

test('agent loop finalizes with tools disabled when a retrieval request would consume the final-response reserve', async () => {
  const requests = [];
  const loop = createAgentRunLoop({
    client: { request: async (request) => {
      requests.push(request);
      return { output: [{ content: [{ type: 'output_text', text: '{"message":"取得範囲を報告","proposals":[],"alternativeGroups":[]}' }] }], usage: { input_tokens: 10 } };
    } },
    registry: { definitions: () => [{ name: 'read_items' }], names: () => ['read_items'] },
    dispatcher: { dispatch: async () => { throw new Error('取得は呼ばない'); } },
    budgetGuard: {
      assertResponseAllowed() {},
      reserveInput(_input, options) {
        if (options?.reserveForInput) throw Object.assign(new Error('reserve'), { code: 'INPUT_TOKEN_FINALIZATION_REQUIRED' });
        return { id: 1 };
      },
      reconcileInput() { return { overBudget: false }; },
      countResponse() {}, getCounters: () => ({})
    },
    model: 'test', apiKey: 'secret', systemInstruction: 'system', maxOutputTokens: 100, textFormat: {}
  });
  const result = await loop.run({ messages: [{ role: 'user', content: '確認する' }] });
  assert.equal(requests.length, 1);
  assert.equal(Object.hasOwn(requests[0], 'tools'), false);
  assert.equal(result.budgetLimited, true);
  assert.match(result.text, /取得範囲を報告/);
});

test('request, retrieval, and replan counters stop at their task-level limits', () => {
  const guard = createBudgetGuard({ state: baseState, limits: { inputTokenCap: 10000, maxResponseRounds: 1, maxRetrievalCalls: 1, maxReplans: 1 } });
  guard.assertResponseAllowed();
  guard.countResponse();
  assert.throws(() => guard.assertResponseAllowed(), (error) => error.code === 'RESPONSE_LIMIT');
  guard.countRetrieval();
  assert.throws(() => guard.countRetrieval(), (error) => error.code === 'RETRIEVAL_LIMIT');
  guard.countReplan();
  assert.throws(() => guard.countReplan(), (error) => error.code === 'REPLAN_LIMIT');
});

test('dispatcher counts attempts and blocks out-of-scope reads before calling the tool', async () => {
  const registry = createToolRegistry();
  let executionCount = 0;
  registry.register({ name: 'read_items', description: 'read items', parameters: {}, permission: 'reference', execute: async () => { executionCount += 1; return []; } });
  const budget = createBudgetGuard({ state: baseState, limits: { inputTokenCap: 10000, maxResponseRounds: 4, maxRetrievalCalls: 4, maxReplans: 2 } });
  const dispatcher = createToolDispatcher({
    registry,
    permissionGuard: createPermissionGuard({ getReferenceScope: () => ['inside'] }),
    budgetGuard: budget,
    getScopeCandidates: (ids) => ids.map((id) => ({ id, label: 'Outside' }))
  });
  const denied = await dispatcher.dispatch('read_items', '{"classId":"outside"}');
  assert.equal(denied.error.code, 'SCOPE_DENIED');
  assert.deepEqual(JSON.parse(JSON.stringify(dispatcher.takeScopeRequest().candidates)), [{ id: 'outside', label: 'Outside' }]);
  assert.equal(executionCount, 0);
  assert.equal(budget.getCounters().retrievalCalls, 1);
});
