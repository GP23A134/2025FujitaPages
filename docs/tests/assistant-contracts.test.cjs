const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const test = require('node:test');

const loadModule = (relativePath, exports, prelude = '') => {
  const sourcePath = path.join(__dirname, '../web/js/editor/assistant', relativePath);
  const source = `${prelude}\n${fs.readFileSync(sourcePath, 'utf8')}`
    .replace(/^import .*;\s*$/gm, '')
    .replace(/^export /gm, '')
    .concat(`\nmodule.exports = { ${exports} };`);
  const sandboxModule = { exports: {} };
  vm.runInNewContext(source, { module: sandboxModule, exports: sandboxModule.exports, Object, Set, Map, JSON, TypeError, RangeError, Error });
  return sandboxModule.exports;
};

const { buildPlanInput } = loadModule('features/planning/plan-input.js', 'buildPlanInput');
const planContract = loadModule('features/planning/plan-contract.js', 'validatePlan, CHANGE_OPERATIONS, PLAN_STATUSES');
const validPlan = () => ({
  status: 'ready', taskType: 'change', summary: 'クラス階層を整理する',
  executionBrief: { objective: '分類を整理する', successCriteria: ['階層ルールを守る'], expectedResult: '検証済み提案' },
  steps: ['範囲を確認', '提案を検証'],
  dataNeeds: { hierarchyIndex: false, selectedClassDetails: true, parentContext: 'direct_parent', instanceContext: 'none' },
  scopeNeeds: { referenceBeyondSelection: false, changeBeyondSelection: false },
  changeOperations: ['move_middle_class'], questions: [], unsupportedParts: []
});

test('planning input contains only request and three-level count groups', () => {
  const result = buildPlanInput('  依頼文  ', {
    available: { top: 4, middle: 8, target: 12, classIds: ['secret'] },
    selected: { top: 1, middle: 2, target: 3, labels: ['秘密'] },
    hierarchy: [{ id: 'secret' }]
  });
  assert.deepEqual(JSON.parse(JSON.stringify(result)), {
    request: '依頼文',
    classCounts: { available: { top: 4, middle: 8, target: 12 }, selected: { top: 1, middle: 2, target: 3 } }
  });
});

test('planning input rejects missing, negative, and fractional counts', () => {
  assert.throws(() => buildPlanInput('依頼', { available: {}, selected: {} }), RangeError);
  assert.throws(() => buildPlanInput('依頼', {
    available: { top: -1, middle: 0, target: 0 }, selected: { top: 0, middle: 0, target: 0 }
  }), RangeError);
  assert.throws(() => buildPlanInput('依頼', {
    available: { top: 1.5, middle: 0, target: 0 }, selected: { top: 0, middle: 0, target: 0 }
  }), RangeError);
});

test('plan contract accepts supported operations and rejects forbidden data and settings', () => {
  assert.equal(planContract.validatePlan(validPlan()).valid, true);
  const withIds = { ...validPlan(), classIds: ['id-from-data'] };
  assert.equal(planContract.validatePlan(withIds).valid, false);
  const renameTarget = { ...validPlan(), changeOperations: ['rename_target_class'] };
  assert.equal(planContract.validatePlan(renameTarget).valid, false);
  assert.equal(planContract.validatePlan(renameTarget, { targetClassRenameEnabled: true }).valid, true);
  const instanceRequest = structuredClone(validPlan());
  instanceRequest.dataNeeds.instanceContext = 'instance_content';
  assert.equal(planContract.validatePlan(instanceRequest).valid, false);
  assert.equal(planContract.validatePlan(instanceRequest, { instanceInformationEnabled: true }).valid, true);
});

test('question confirmations allow at most four answer choices and require option IDs and labels', () => {
  const question = { id: 'q1', text: 'どちらを優先しますか？', options: [
    { id: 'a', label: '案A' }, { id: 'b', label: '案B' }, { id: 'c', label: '案C' }, { id: 'd', label: '案D' }
  ] };
  assert.equal(planContract.validatePlan({ ...validPlan(), status: 'needs_clarification', questions: [question] }).valid, true);
  const tooMany = { ...question, options: [...question.options, { id: 'e', label: '案E' }] };
  assert.equal(planContract.validatePlan({ ...validPlan(), status: 'needs_clarification', questions: [tooMany] }).valid, false);
  const duplicateIds = { ...question, options: [{ id: 'a', label: '案A' }, { id: 'a', label: '案B' }] };
  assert.equal(planContract.validatePlan({ ...validPlan(), status: 'needs_clarification', questions: [duplicateIds] }).valid, false);
});

test('plan contract does not expose target-class addition or deletion operations', () => {
  assert.ok(!planContract.CHANGE_OPERATIONS.includes('add_target_class'));
  assert.ok(!planContract.CHANGE_OPERATIONS.includes('delete_target_class'));
  assert.ok(planContract.PLAN_STATUSES.includes('partially_supported'));
});

test('the new chat system is the default and can be turned off', () => {
  const settings = loadModule('conversations/chat-system-settings.js', 'CHAT_SYSTEM_SETTINGS');
  assert.equal(settings.CHAT_SYSTEM_SETTINGS[0].key, 'chat.useNewSystem');
  assert.equal(settings.CHAT_SYSTEM_SETTINGS[0].defaultValue, true);
});

test('planning service sends only the prepared request and counts and validates the response', async () => {
  const serviceSourcePath = path.join(__dirname, '../web/js/editor/assistant/features/planning/planning-service.js');
  const source = fs.readFileSync(serviceSourcePath, 'utf8')
    .replace(/^import .*;\s*$/gm, '')
    .replace(/^export /gm, '')
    .concat('\nmodule.exports = { createPlanningService };');
  const sandboxModule = { exports: {} };
  const responsePlan = validPlan();
  let sentInput;
  let reportedUsage;
  let promptOptions;
  vm.runInNewContext(source, {
    module: sandboxModule,
    exports: sandboxModule.exports,
    PLAN_RESPONSE_SCHEMA: {},
    buildPlanSystemPrompt: (options) => { promptOptions = options; return 'fixed prompt'; },
    validatePlan: () => ({ valid: true, errors: [] }),
    JSON, Object, Number, TypeError, Error, SyntaxError
  });
  const service = sandboxModule.exports.createPlanningService({
    client: { request: async (args) => {
      sentInput = args.input;
      return { output: [{ content: [{ type: 'output_text', text: JSON.stringify(responsePlan) }] }], usage: { input_tokens: 19 } };
    } }
  });
  const planInput = buildPlanInput('依頼', {
    available: { top: 2, middle: 3, target: 4 }, selected: { top: 1, middle: 1, target: 2 }
  });
  const result = await service.createPlan({ apiKey: 'test-key', model: 'test-model', planInput, hierarchyIndexAvailable: true, onUsage: (event) => { reportedUsage = event; } });
  assert.deepEqual(JSON.parse(sentInput[1].content), JSON.parse(JSON.stringify(planInput)));
  assert.equal(sentInput[0].content, 'fixed prompt');
  assert.equal(promptOptions.hierarchyIndexAvailable, true);
  assert.equal(result.usage, 19);
  assert.equal(reportedUsage.model, 'test-model');
  assert.equal(reportedUsage.usage.input_tokens, 19);
  assert.deepEqual(result.plan, responsePlan);
});
