const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const test = require('node:test');
const { TextEncoder } = require('node:util');

const base = path.join(__dirname, '../web/js/editor/assistant');
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
