const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const test = require('node:test');
const { TextEncoder } = require('node:util');
const { randomUUID } = require('node:crypto');
const workflowLogs = [];
const agentRunResponseQueue = [];
const agentProgressQueue = [];

const base = path.join(__dirname, '../web/js/editor/chat/agent');
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
const { createTaskController } = evaluate('application/task-controller.js', 'createTaskController');
const taskStateModule = evaluate('application/task-state.js', 'createTaskState, normalizeTaskState, recordTaskAction, recordTaskCriterion, stopTask, completeTask, resumeTask, proposeTaskAction, authorizeTaskAction');
const readerOptions = [];
const agentRunOptions = [];
const targetMoveProcessorOptions = [];
const { createAssistantWorkflow } = evaluate('application/workflow.js', 'createAssistantWorkflow', {
  createConversationState, transitionConversation, buildPlanInput, ...taskStateModule,
  createTaskController,
  createDataIdCodec: () => ({}),
  createIdMaskedClient: (client) => client,
  createTargetMoveBatchProcessor: (options) => {
    targetMoveProcessorOptions.push(options);
    return { run: async () => {
      options.onProgress({ stage: 'retrieving', tool: 'read_hierarchy_index' });
      return {
        text: JSON.stringify({ message: 'バッチごとに移動候補を確認しました。', proposals: [], alternativeGroups: [] }),
        messages: [],
        completionEvidence: {
          expectedCount: 1, processedCount: 1, missingCount: 0, unresolvedCount: 0,
          scopeComplete: true, resultValidated: true
        }
      };
    } };
  },
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
  createEditorDataReader: (options) => { readerOptions.push(options); return { registry: { names: () => [], definitions: () => [] } }; },
  createPermissionGuard: () => ({}),
  createToolDispatcher: () => ({}),
  createAgentRunLoop: ({ systemInstruction }) => ({ run: async (options) => {
    agentRunOptions.push(options);
    agentProgressQueue.splice(0).forEach((detail) => options.onProgress?.(detail));
    return agentRunResponseQueue.shift()
      || { text: JSON.stringify({ message: systemInstruction, proposals: [], alternativeGroups: [] }), messages: [] };
  } }),
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
  const progressReports = [];
  const planInputs = [];
  const planningOptions = [];
  readerOptions.length = 0;
  agentRunOptions.length = 0;
  targetMoveProcessorOptions.length = 0;
  agentRunResponseQueue.length = 0;
  agentProgressQueue.length = 0;
  const editor = { selectedIds: ['target-id'], getState: () => classState };
  const settings = {
    'runtime.inputTokenCap': 300000, 'runtime.maxResponseRounds': 30, 'runtime.maxRetrievalCalls': 200, 'runtime.maxReplans': 5,
    'runtime.maxOutputTokens': 5000, 'dataRetrieval.pageAndIdLimit': 100, 'validation.maxRepairRetries': 2,
    'instances.enabled': false, 'proposals.targetClassRenameEnabled': false
  };
  let index = 0;
  const workflow = createAssistantWorkflow({
    editor,
    client: { request: async () => ({}) },
    planningService: { createPlan: async ({ apiKey, model, planInput, hierarchyIndexAvailable }) => {
      assert.equal(apiKey, 'secret-api-key');
      assert.equal(model, 'model-x');
      planInputs.push(planInput);
      planningOptions.push({ hierarchyIndexAvailable });
      const nextPlan = planSequence[Math.min(index++, planSequence.length - 1)];
      if (nextPlan instanceof Error) throw nextPlan;
      return { plan: nextPlan, usage: 9 };
    } },
    getSettings: () => settings,
    onEvent: (event) => events.push(event),
    reportProgress: (detail) => progressReports.push(detail)
  });
  return { workflow, events, planInputs, planningOptions, progressReports };
}

test('full-hierarchy toggle makes the index available to planning without enabling retrieval automatically', async () => {
  const { workflow, events, planningOptions } = harness([plan()]);
  await workflow.start({ request: '選択クラスの配置を確認', apiKey: 'secret-api-key', model: 'model-x', referenceAllHierarchy: true });
  assert.equal(planningOptions[0].hierarchyIndexAvailable, true);
  assert.deepEqual([...readerOptions[0].getReferenceScope()].sort(), ['target-id', 'top-secret-id']);
  assert.equal(agentRunOptions[0].allowedTools.length, 0);
  const finalState = events.filter((event) => event.type === 'state').at(-1).state;
  assert.equal(finalState.scopeGrants.change.includes('top-secret-id'), false);
  assert.equal(finalState.scopeGrants.change.includes('target-id'), true);
});

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

test('a plan that requires data cannot complete without runtime evidence', async () => {
  const dataPlan = plan({ dataNeeds: { hierarchyIndex: false, selectedClassDetails: true, parentContext: 'none', instanceContext: 'none' } });
  const { workflow } = harness([dataPlan]);
  const result = await workflow.start({ request: '対象を確認', apiKey: 'secret-api-key', model: 'model-x' });
  assert.equal(result.status, 'failed');
  assert.equal(workflow.getState().taskState.criteriaResults.every((item) => item.status !== 'passed'), true);
});

test('ancestor-chain plans complete only when the full selected chain matches current approved hierarchy', async () => {
  const taskPlan = plan({ dataNeeds: { hierarchyIndex: false, selectedClassDetails: false, parentContext: 'ancestor_chain', instanceContext: 'none' } });
  const { workflow } = harness([taskPlan]);
  agentRunResponseQueue.push({
    text: JSON.stringify({ message: '祖先経路を確認しました', proposals: [], alternativeGroups: [] }), messages: [],
    retrievalEvidence: [{ tool: 'read_ancestor_chains', arguments: { classIds: ['target-id'] }, ok: true,
      data: { dataVersion: 'data-v1', notFoundIds: [], items: [{ classId: 'target-id', rootReached: true, ancestors: [{ id: 'top-secret-id' }] }] } }]
  });
  const result = await workflow.start({ request: '親階層を確認', apiKey: 'secret-api-key', model: 'model-x', referenceClassIds: ['top-secret-id'] });
  assert.equal(result.status, 'completed');
  assert.equal(result.result.completionEvidence.basis, 'application_verified_tool_results');
});

test('expanded-scope plans require a full inventory of the approved scope before completion', async () => {
  const taskPlan = plan({ scopeNeeds: { referenceBeyondSelection: true, changeBeyondSelection: false } });
  const { workflow } = harness([taskPlan]);
  agentRunResponseQueue.push({
    text: JSON.stringify({ message: '範囲を確認しました', proposals: [], alternativeGroups: [] }), messages: [],
    retrievalEvidence: [{ tool: 'read_reference_scope', arguments: { cursor: null, includeParentContext: true }, ok: true,
      data: { dataVersion: 'data-v1', totalCount: 2, nextCursor: null, items: [
        { id: 'top-secret-id', parentId: null }, { id: 'target-id', parentId: 'top-secret-id' }
      ] } }]
  });
  const result = await workflow.start({ request: '全範囲を確認', apiKey: 'secret-api-key', model: 'model-x', referenceClassIds: ['top-secret-id'] });
  assert.equal(result.status, 'completed');
  assert.equal(result.result.completionEvidence.basis, 'application_verified_tool_results');
});

test('an explicit estimated move request cannot fall through to the read-only review path', async () => {
  const movePlan = plan({
    summary: '目的語の配下への移動案を作成します',
    executionBrief: { objective: '対象を目的語へ移す', successCriteria: [], expectedResult: '移動案と理由' }
  });
  const { workflow, progressReports } = harness([movePlan]);
  agentProgressQueue.push({ stage: 'retrieving', tool: 'read_hierarchy_index' });
  const result = await workflow.start({ request: '目的語に該当する対象クラスを目的語の配下へ移す案を出してください。推定でもよい。', apiKey: 'secret-api-key', model: 'model-x', referenceAllHierarchy: true });
  assert.equal(result.status, 'completed', result.error?.stack || JSON.stringify(result.error));
  assert.equal(workflow.getPlan().taskType, 'mixed');
  assert.deepEqual([...workflow.getPlan().changeOperations], ['move_target_class']);
  assert.equal(workflow.getPlan().dataNeeds.hierarchyIndex, true);
  assert.equal(targetMoveProcessorOptions.length, 1);
  assert.equal(targetMoveProcessorOptions[0].plan.taskType, 'mixed');
  assert.equal(agentRunOptions.length, 0);
  assert.ok(progressReports.some((event) => event.stage === 'retrieving' && event.tool === 'read_hierarchy_index'));
});

test('retries an unreadable proposal response with a JSON-only repair request', async () => {
  const { workflow } = harness([plan()]);
  agentRunResponseQueue.push(
    { text: 'Here is my analysis, but no JSON.', messages: [{ role: 'user', content: 'request' }] },
    { text: JSON.stringify({ message: '確認しました。', proposals: [], alternativeGroups: [] }), messages: [] }
  );
  const result = await workflow.start({ request: '調べて', apiKey: 'secret-api-key', model: 'model-x' });
  assert.equal(result.status, 'completed', result.error?.stack || JSON.stringify(result.error));
  assert.equal(agentRunOptions.length, 2);
  assert.match(agentRunOptions[1].messages.at(-1).content, /有効な提案JSON/);
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
  assert.equal(result.status, 'failed');
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

test('workflow exposes transcript-oriented interaction without checkpoint resume APIs', () => {
  const { workflow } = harness([]);
  assert.equal(typeof workflow.start, 'function');
  assert.equal(typeof workflow.answerQuestions, 'function');
  assert.equal('resume' in workflow, false);
  assert.equal('getPersistenceSnapshot' in workflow, false);
});

test('common task controller selects one compatible route and passes runtime context through', async () => {
  const seen = [];
  const routes = [
    'chunked_read_only', 'target_move', 'hierarchy_reorganization', 'hierarchy_deletion', 'agent_runtime'
  ].map((id) => ({ id, matches: ({ route }) => route === id, run: (context, options) => { seen.push([id, context.route, options]); return id; } }));
  const controller = createTaskController(routes);
  const selected = controller.select({ route: 'hierarchy_deletion' });
  assert.equal(selected.id, 'hierarchy_deletion');
  assert.equal(await selected.run({ attempt: 2 }), 'hierarchy_deletion');
  assert.deepEqual(seen, [['hierarchy_deletion', 'hierarchy_deletion', { attempt: 2 }]]);
});
