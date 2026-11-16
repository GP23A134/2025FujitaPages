const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const test = require('node:test');
const { TextEncoder } = require('node:util');
const { randomUUID } = require('node:crypto');
const workflowLogs = [];

const base = path.join(__dirname, '../web/js/editor/assistant');
function evaluate(relativePath, exportNames, stubs = {}) {
  const source = fs.readFileSync(path.join(base, relativePath), 'utf8')
    .replace(/^import .*;\s*$/gm, '')
    .replace(/^export /gm, '')
    .concat(`\nmodule.exports = { ${exportNames} };`);
  const sandboxModule = { exports: {} };
  vm.runInNewContext(source, {
    module: sandboxModule, exports: sandboxModule.exports, Object, Set, Map, Date, JSON, Number,
    TypeError, RangeError, Error, SyntaxError, structuredClone, TextEncoder, crypto: { randomUUID },
    AbortController,
    window: { classEditorAssistant: { getDataVersion: () => 'data-v1' } },
    console: { error: (...args) => workflowLogs.push(args) },
    ...stubs
  });
  return sandboxModule.exports;
}
const { createConversationState, transitionConversation } = evaluate('application/conversation-state.js', 'createConversationState, transitionConversation');
const { buildPlanInput } = evaluate('features/planning/plan-input.js', 'buildPlanInput');
const { createAssistantWorkflow } = evaluate('application/workflow.js', 'createAssistantWorkflow', {
  createConversationState, transitionConversation, buildPlanInput,
  createBudgetGuard: ({ state, limits, onChange }) => {
    const counters = { ...state.counters };
    return {
      countReplan() { counters.replans += 1; onChange(counters); },
      assertResponseAllowed() {},
      reserveInput() { return { id: 1, estimate: 1 }; },
      reconcileInput() { return { overBudget: false }; },
      countResponse() { counters.responseRounds += 1; onChange(counters); },
      countRetrieval() { counters.retrievalCalls += 1; onChange(counters); },
      getCounters: () => ({ ...counters })
    };
  },
  createEditorDataReader: () => ({ registry: { names: () => [], definitions: () => [] } }),
  createPermissionGuard: () => ({}),
  createToolDispatcher: () => ({}),
  createAgentRunLoop: ({ systemInstruction }) => ({ run: async () => ({ text: JSON.stringify({ message: systemInstruction, proposals: [], alternativeGroups: [] }), messages: [] }) }),
  buildAgentSystemPrompt: () => 'agent prompt',
  PROPOSAL_RESPONSE_SCHEMA: {},
  validateProposalResponse: () => ({ message: '完了', proposals: [], alternativeGroups: [], blocked: [] })
});

const classState = {
  classes: [{ id: 'top-secret-id', type: 'top', label: '秘密名' }, { id: 'target-id', type: 'class', label: '対象' }],
  relations: [{ child: 'target-id', parent: 'top-secret-id' }],
  counts: { 'top-secret-id': 1, 'target-id': 0 }
};
const plan = (overrides = {}) => ({
  status: 'ready', taskType: 'read_only', summary: '範囲を確認',
  executionBrief: { objective: '必要な情報を確認する', successCriteria: [], expectedResult: '回答' },
  steps: ['確認'],
  dataNeeds: { hierarchyIndex: false, selectedClassDetails: false, parentContext: 'none', instanceContext: 'none' },
  scopeNeeds: { referenceBeyondSelection: false, changeBeyondSelection: false },
  changeOperations: [], questions: [], unsupportedParts: [], ...overrides
});
function harness(planSequence) {
  const events = [];
  const planInputs = [];
  const editor = { selectedIds: ['target-id'], getState: () => classState };
  const settings = {
    'runtime.inputTokenCap': 30000, 'runtime.maxResponseRounds': 30, 'runtime.maxRetrievalCalls': 50, 'runtime.maxReplans': 5,
    'runtime.maxOutputTokens': 5000, 'dataRetrieval.pageAndIdLimit': 100, 'validation.maxRepairRetries': 2,
    'instances.enabled': false, 'proposals.targetClassRenameEnabled': false
  };
  let index = 0;
  const workflow = createAssistantWorkflow({
    editor,
    client: { request: async () => ({}) },
    planningService: { createPlan: async ({ apiKey, model, planInput }) => {
      assert.equal(apiKey, 'secret-api-key');
      assert.equal(model, 'model-x');
      planInputs.push(planInput);
      const nextPlan = planSequence[Math.min(index++, planSequence.length - 1)];
      if (nextPlan instanceof Error) throw nextPlan;
      return { plan: nextPlan, usage: 9 };
    } },
    getSettings: () => settings,
    onEvent: (event) => events.push(event),
    reportProgress() {}
  });
  return { workflow, events, planInputs };
}

test('ready read-only workflow completes without exposing IDs or API keys to planning state', async () => {
  const { workflow, planInputs } = harness([plan()]);
  const result = await workflow.start({ request: '調べて', apiKey: 'secret-api-key', model: 'model-x' });
  assert.equal(result.status, 'completed', result.error?.stack || JSON.stringify(result.error));
  assert.deepEqual(JSON.parse(JSON.stringify(planInputs[0])), {
    request: '調べて',
    classCounts: { available: { top: 1, middle: 0, target: 1 }, selected: { top: 0, middle: 0, target: 1 } }
  });
  const stateText = JSON.stringify(workflow.getState());
  assert.equal(stateText.includes('secret-api-key'), false);
  assert.equal(stateText.includes('top-secret-id'), false);
});

test('unsupported plans stop before running the agent', async () => {
  const unsupported = plan({ status: 'unsupported', unsupportedParts: [{ description: '削除', reason: '対象外' }] });
  const { workflow, events } = harness([unsupported]);
  const result = await workflow.start({ request: '対象を削除', apiKey: 'secret-api-key', model: 'model-x' });
  assert.equal(result.status, 'unsupported');
  assert.equal(events.some((event) => event.type === 'result'), false);
});

test('scope intent in a plan does not request an unrestricted scope expansion', async () => {
  const firstPlan = plan({ scopeNeeds: { referenceBeyondSelection: true, changeBeyondSelection: false } });
  const { workflow, planInputs } = harness([firstPlan, plan()]);
  const result = await workflow.start({ request: '配置を確認', apiKey: 'secret-api-key', model: 'model-x' });
  assert.equal(result.status, 'completed', result.error?.stack || JSON.stringify(result.error));
  assert.equal(planInputs.length, 1);
  assert.equal(workflow.getState().counters.replans, 0);
});

test('workflow errors expose their source module in the console and error event', async () => {
  const planningError = Object.assign(new Error('計画検証に失敗しました'), {
    code: 'INVALID_PLAN', sourceModule: 'features/planning/plan-contract.js'
  });
  const { workflow, events } = harness([planningError]);
  const result = await workflow.start({ request: '調べて', apiKey: 'secret-api-key', model: 'model-x' });
  assert.equal(result.status, 'failed');
  const errorEvent = events.find((event) => event.type === 'error');
  assert.equal(errorEvent.error.sourceModule, 'features/planning/plan-contract.js');
  assert.ok(workflowLogs.some(([label]) => label.includes('features/planning/plan-contract.js')));
});

test('clarification answers update the request and trigger a counted replan', async () => {
  const questionPlan = plan({ status: 'needs_clarification', questions: [{ id: 'q1', text: 'どちらを優先しますか？' }] });
  const { workflow, planInputs } = harness([questionPlan, plan()]);
  assert.equal((await workflow.start({ request: '整理して', apiKey: 'secret-api-key', model: 'model-x' })).status, 'needs_clarification');
  assert.equal((await workflow.answerQuestions('名称を優先')).status, 'completed');
  assert.equal(planInputs.length, 2);
  assert.match(planInputs[1].request, /利用者の回答:\n名称を優先/);
  assert.equal(workflow.getState().counters.replans, 1);
});

test('restores a clarification checkpoint without credentials and preserves its counters', async () => {
  const questionPlan = plan({ status: 'needs_clarification', questions: [{ id: 'q1', text: 'どちらを優先しますか？' }] });
  const first = harness([questionPlan]);
  await first.workflow.start({ request: '整理して', apiKey: 'secret-api-key', model: 'model-x' });
  const snapshot = first.workflow.getPersistenceSnapshot();
  assert.equal(JSON.stringify(snapshot).includes('secret-api-key'), false);

  const resumed = harness([plan()]);
  assert.equal((await resumed.workflow.resume(snapshot, { apiKey: 'secret-api-key', model: 'model-x' })).status, 'needs_clarification');
  assert.equal(resumed.workflow.getState().counters.replans, 0);
  assert.equal((await resumed.workflow.answerQuestions('上位分類を優先')).status, 'completed');
  assert.equal(resumed.workflow.getState().counters.replans, 1);
});
