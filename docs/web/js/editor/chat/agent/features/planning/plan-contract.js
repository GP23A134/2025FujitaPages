// AIの計画出力をアプリ内部で扱う前に検査する契約です。
export const PLAN_STATUSES = Object.freeze([
  'ready',
  'needs_clarification',
  'partially_supported',
  'unsupported'
]);

export const TASK_TYPES = Object.freeze(['read_only', 'change', 'mixed']);
export const PARENT_CONTEXTS = Object.freeze(['none', 'direct_parent', 'ancestor_chain']);
export const INSTANCE_CONTEXTS = Object.freeze(['none', 'membership_summary', 'instance_content']);
export const CHANGE_OPERATIONS = Object.freeze([
  'move_target_class',
  'move_middle_class',
  'move_top_class',
  'promote_middle_class',
  'delete_middle_class',
  'delete_top_class',
  'merge_classes',
  'add_top_class',
  'add_middle_class',
  'rename_top_class',
  'rename_middle_class',
  'rename_target_class'
]);

const isRecord = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const isString = (value) => typeof value === 'string' && value.trim().length > 0;
const isEnumValue = (value, values) => values.includes(value);
const hasOnlyKeys = (value, allowed) => Object.keys(value).every((key) => allowed.includes(key));

/**
 * Validates the stable planner contract. Authorization and effective workflow
 * status must still be recomputed by the application layer.
 * @returns {{ valid: boolean, errors: string[] }}
 */
export function validatePlan(plan, { instanceInformationEnabled = false, targetClassRenameEnabled = false } = {}) {
  const errors = [];
  if (!isRecord(plan)) return { valid: false, errors: ['計画はオブジェクトである必要があります。'] };
  if (!hasOnlyKeys(plan, ['status', 'taskType', 'executionMode', 'summary', 'executionBrief', 'steps', 'dataNeeds', 'scopeNeeds', 'changeOperations', 'questions', 'unsupportedParts'])) {
    errors.push('計画にスキーマ外の項目があります。');
  }

  if (!isEnumValue(plan.status, PLAN_STATUSES)) errors.push('statusが未定義です。');
  if (!isEnumValue(plan.taskType, TASK_TYPES)) errors.push('taskTypeが未定義です。');
  if (plan.executionMode !== undefined && !isEnumValue(plan.executionMode, ['standard', 'reorganization', 'deletion'])) errors.push('executionModeが未定義です。');
  if (!isString(plan.summary)) errors.push('summaryは空でない文字列が必要です。');
  const brief = plan.executionBrief;
  if (!isRecord(brief)
    || !hasOnlyKeys(brief, ['objective', 'successCriteria', 'expectedResult'])
    || !isString(brief.objective)
    || !Array.isArray(brief.successCriteria)
    || brief.successCriteria.some((criterion) => !isString(criterion))
    || !isString(brief.expectedResult)) {
    errors.push('executionBriefにはobjective、successCriteria、expectedResultが必要です。');
  }
  if (!Array.isArray(plan.steps) || plan.steps.some((step) => !isString(step))) errors.push('stepsは工程文字列の配列が必要です。');

  const needs = plan.dataNeeds;
  if (!isRecord(needs)) {
    errors.push('dataNeedsが必要です。');
  } else {
    if (!hasOnlyKeys(needs, ['hierarchyIndex', 'selectedClassDetails', 'parentContext', 'instanceContext'])) errors.push('dataNeedsに未定義の取得要件があります。');
    if (typeof needs.hierarchyIndex !== 'boolean') errors.push('dataNeeds.hierarchyIndexはbooleanが必要です。');
    if (typeof needs.selectedClassDetails !== 'boolean') errors.push('dataNeeds.selectedClassDetailsはbooleanが必要です。');
    if (!isEnumValue(needs.parentContext, PARENT_CONTEXTS)) errors.push('dataNeeds.parentContextが未定義です。');
    if (!isEnumValue(needs.instanceContext, INSTANCE_CONTEXTS)) errors.push('dataNeeds.instanceContextが未定義です。');
    if (!instanceInformationEnabled && needs.instanceContext !== 'none') errors.push('インスタンス情報が無効な設定で要求されています。');
  }

  const scope = plan.scopeNeeds;
  if (!isRecord(scope)
    || !hasOnlyKeys(scope, ['referenceBeyondSelection', 'changeBeyondSelection'])
    || typeof scope.referenceBeyondSelection !== 'boolean'
    || typeof scope.changeBeyondSelection !== 'boolean') {
    errors.push('scopeNeedsは参照・変更範囲のbooleanを含む必要があります。');
  }

  if (!Array.isArray(plan.changeOperations)
    || plan.changeOperations.some((operation) => !isEnumValue(operation, CHANGE_OPERATIONS))) {
    errors.push('changeOperationsに未対応または不明な操作があります。');
  } else if (!targetClassRenameEnabled && plan.changeOperations.includes('rename_target_class')) {
    errors.push('対象クラス名の変更が開発者設定で無効です。');
  }
  if (Array.isArray(plan.changeOperations)) {
    const hasDeletion = plan.changeOperations.some((operation) => ['delete_top_class', 'delete_middle_class'].includes(operation));
    if (hasDeletion && !['deletion', 'reorganization'].includes(plan.executionMode)) errors.push('削除操作を含む計画はexecutionMode=deletionまたはreorganizationが必要です。');
    if (plan.executionMode === 'deletion' && !hasDeletion) errors.push('削除ジョブには削除操作が必要です。');
  }

  if (!Array.isArray(plan.questions) || plan.questions.some((question) => !isRecord(question)
    || !hasOnlyKeys(question, ['id', 'text', 'options']) || !isString(question.id) || !isString(question.text)
    || !Array.isArray(question.options) || question.options.length > 4
    || question.options.some((option, index) => !isRecord(option) || !hasOnlyKeys(option, ['id', 'label'])
      || !isString(option.id) || !option.id.trim() || !isString(option.label) || !option.label.trim()
      || question.options.findIndex((item) => item?.id === option.id) !== index))) {
    errors.push('questionsはid・text・最大4件のoptionsを持つ質問オブジェクトの配列が必要です。');
  }
  if (!Array.isArray(plan.unsupportedParts) || plan.unsupportedParts.some((part) => !isRecord(part)
    || !hasOnlyKeys(part, ['description', 'reason']) || !isString(part.description) || !isString(part.reason))) {
    errors.push('unsupportedPartsはdescriptionとreasonを持つ配列が必要です。');
  }
  if (Object.hasOwn(plan, 'classIds') || Object.hasOwn(plan, 'hierarchy') || Object.hasOwn(plan, 'classNames')) {
    errors.push('計画出力にクラスID・名称・階層データは含められません。');
  }

  return { valid: errors.length === 0, errors };
}
