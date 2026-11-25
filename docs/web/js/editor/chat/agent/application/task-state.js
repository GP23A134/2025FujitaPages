const MAX_TEXT = 4000;
const MAX_ITEMS = 200;
const text = (value, limit = MAX_TEXT) => typeof value === 'string' ? value.trim().slice(0, limit) : '';
const stringList = (value, limit = MAX_ITEMS) => Array.isArray(value)
  ? [...new Set(value.filter((item) => typeof item === 'string' && item.length <= 512))].slice(0, limit) : [];

export const TASK_ACTIONS = Object.freeze([
  'inspect_scope', 'use_existing_structure', 'design_structure', 'place_items',
  'validate', 'revise_structure', 'ask_user', 'complete'
]);

const ACTION_RULES = Object.freeze({
  inspect_scope: { requiredInput: [], needsScope: true },
  use_existing_structure: { requiredInput: [], needsScope: true, structureMode: 'existing' },
  design_structure: { requiredInput: [], needsScope: true, structureMode: 'design' },
  place_items: { requiredInput: ['targetIds'], needsScope: true },
  validate: { requiredInput: ['artifact'], needsScope: false },
  revise_structure: { requiredInput: ['validationFindings'], needsScope: true, structureMode: 'design' },
  ask_user: { requiredInput: ['question'], needsScope: false },
  complete: { requiredInput: [], needsScope: false }
});

const TASK_STATUSES = ['running', 'awaiting_user', 'completed', 'stopped', 'stale'];

export function createTaskState({ id, objective, completionCriteria = [], scopeIds = [], dataVersion = '', structureMode = 'existing' }) {
  if (typeof id !== 'string' || !id.trim() || !text(objective)) throw new TypeError('タスクIDと目的が必要です。');
  if (!['existing', 'design'].includes(structureMode)) throw new TypeError('構造モードが不正です。');
  return {
    version: 1, id: text(id, 128), objective: text(objective), completionCriteria: stringList(completionCriteria),
    criteriaResults: stringList(completionCriteria).map((criterion) => ({ criterion, status: 'pending', evidence: null })),
    scopeIds: stringList(scopeIds), dataVersion: text(dataVersion, 128), structureMode,
    confirmedFacts: [], unfinishedItems: [], actionHistory: [], nextAction: null,
    awaitingUserInput: null, iterationCount: 0, status: 'running', stopReason: '', updatedAt: Date.now()
  };
}

export function normalizeTaskState(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || value.version !== 1
    || typeof value.id !== 'string' || !text(value.objective)) return null;
  const mode = ['existing', 'design'].includes(value.structureMode) ? value.structureMode : null;
  if (!mode) return null;
  const nextAction = value.nextAction && TASK_ACTIONS.includes(value.nextAction.action)
    ? { action: value.nextAction.action, input: value.nextAction.input && typeof value.nextAction.input === 'object' ? value.nextAction.input : {} }
    : null;
  return {
    version: 1, id: text(value.id, 128), objective: text(value.objective),
    completionCriteria: stringList(value.completionCriteria), scopeIds: stringList(value.scopeIds),
    criteriaResults: stringList(value.completionCriteria).map((criterion) => {
      const saved = Array.isArray(value.criteriaResults) ? value.criteriaResults.find((item) => item?.criterion === criterion) : null;
      return {
        criterion,
        status: ['passed', 'failed'].includes(saved?.status) ? saved.status : 'pending',
        evidence: saved?.evidence && typeof saved.evidence === 'object' ? saved.evidence : null
      };
    }),
    dataVersion: text(value.dataVersion, 128), structureMode: mode,
    confirmedFacts: Array.isArray(value.confirmedFacts) ? value.confirmedFacts.slice(-MAX_ITEMS) : [],
    unfinishedItems: stringList(value.unfinishedItems),
    actionHistory: Array.isArray(value.actionHistory) ? value.actionHistory.slice(-MAX_ITEMS) : [],
    nextAction, awaitingUserInput: value.awaitingUserInput && typeof value.awaitingUserInput === 'object' ? value.awaitingUserInput : null,
    iterationCount: Number.isSafeInteger(value.iterationCount) && value.iterationCount >= 0 ? value.iterationCount : 0,
    status: TASK_STATUSES.includes(value.status) ? value.status : 'running', stopReason: text(value.stopReason, 1000),
    updatedAt: Number.isFinite(value.updatedAt) ? value.updatedAt : Date.now()
  };
}

// Selection is only a proposal. The caller must authorize and execute the action separately.
export function proposeTaskAction(task, action, input = {}) {
  const current = normalizeTaskState(task);
  if (!current || current.status !== 'running' || !TASK_ACTIONS.includes(action)) return null;
  if (action === 'design_structure' && current.structureMode !== 'design') return null;
  if (action === 'use_existing_structure' && current.structureMode !== 'existing') return null;
  if (action === 'complete' && current.unfinishedItems.length > 0) return null;
  return normalizeTaskState({ ...current, nextAction: { action, input }, updatedAt: Date.now() });
}

// The AI may propose an action; only application-owned context can authorize it.
export function authorizeTaskAction(task, proposal, { allowedActions = TASK_ACTIONS, scopeIds, dataVersion, maxIterations = 100 } = {}) {
  const current = normalizeTaskState(task);
  const action = proposal?.action;
  const input = proposal?.input;
  if (!current || current.status !== 'running' || !TASK_ACTIONS.includes(action)) return { allowed: false, reason: 'invalid_task_or_action' };
  if (!allowedActions.includes(action)) return { allowed: false, reason: 'action_not_enabled' };
  if (current.dataVersion && dataVersion !== current.dataVersion) return { allowed: false, reason: 'data_version_changed' };
  if (current.iterationCount >= maxIterations) return { allowed: false, reason: 'iteration_limit' };
  if (!input || typeof input !== 'object' || Array.isArray(input)) return { allowed: false, reason: 'invalid_action_input' };
  const rule = ACTION_RULES[action];
  if (rule.structureMode && current.structureMode !== rule.structureMode) return { allowed: false, reason: 'structure_mode_mismatch' };
  if (rule.requiredInput.some((key) => !(key in input))) return { allowed: false, reason: 'missing_action_input' };
  if (rule.needsScope) {
    const currentScope = stringList(scopeIds === undefined ? current.scopeIds : scopeIds);
    const requestedIds = action === 'place_items' ? stringList(input.targetIds) : currentScope;
    if (!requestedIds.length || requestedIds.some((id) => !currentScope.includes(id))) return { allowed: false, reason: 'scope_violation' };
  }
  if (action === 'complete' && (current.unfinishedItems.length || current.awaitingUserInput)) return { allowed: false, reason: 'task_incomplete' };
  return { allowed: true, action, input };
}

export function recordTaskAction(task, { action, input = {}, outcome = 'completed', evidence = null } = {}) {
  const current = normalizeTaskState(task);
  if (!current || !TASK_ACTIONS.includes(action) || current.status !== 'running') return null;
  const proposed = proposeTaskAction(current, action, input);
  if (!proposed) return null;
  return normalizeTaskState({
    ...proposed,
    actionHistory: [...current.actionHistory, { action, input, outcome: text(outcome, 120), evidence, at: Date.now() }].slice(-MAX_ITEMS),
    iterationCount: current.iterationCount + 1,
    nextAction: null,
    updatedAt: Date.now()
  });
}

export function stopTask(task, { reason, awaitingUserInput = null, unfinishedItems } = {}) {
  const current = normalizeTaskState(task);
  if (!current || !['running', 'awaiting_user'].includes(current.status)) return null;
  return normalizeTaskState({
    ...current,
    status: awaitingUserInput ? 'awaiting_user' : 'stopped',
    awaitingUserInput,
    unfinishedItems: unfinishedItems === undefined ? current.unfinishedItems : unfinishedItems,
    nextAction: awaitingUserInput ? { action: 'ask_user', input: awaitingUserInput } : null,
    stopReason: text(reason, 1000), updatedAt: Date.now()
  });
}

export function resumeTask(task, { dataVersion, scopeIds } = {}) {
  const current = normalizeTaskState(task);
  if (!current || !['awaiting_user', 'stopped'].includes(current.status)) return null;
  if (dataVersion !== undefined && current.dataVersion && current.dataVersion !== dataVersion) {
    return normalizeTaskState({ ...current, status: 'stale', stopReason: 'data_version_changed', nextAction: null, updatedAt: Date.now() });
  }
  if (scopeIds !== undefined && JSON.stringify(stringList(scopeIds)) !== JSON.stringify(current.scopeIds)) return null;
  return normalizeTaskState({ ...current, status: 'running', awaitingUserInput: null, stopReason: '', nextAction: null, updatedAt: Date.now() });
}

export function completeTask(task) {
  const current = normalizeTaskState(task);
  if (!current || current.status !== 'running' || current.unfinishedItems.length || current.awaitingUserInput
    || current.criteriaResults.length !== current.completionCriteria.length
    || current.criteriaResults.some((result) => result.status !== 'passed')) return null;
  return normalizeTaskState({ ...current, status: 'completed', nextAction: { action: 'complete', input: {} }, updatedAt: Date.now() });
}

export function recordTaskCriterion(task, criterion, evidence, status = 'passed') {
  const current = normalizeTaskState(task);
  if (!current || current.status !== 'running' || !current.completionCriteria.includes(criterion)
    || !['passed', 'failed'].includes(status) || !evidence || typeof evidence !== 'object' || Array.isArray(evidence)) return null;
  const criteriaResults = current.criteriaResults.map((result) => result.criterion === criterion
    ? { criterion, status, evidence } : result);
  return normalizeTaskState({ ...current, criteriaResults, updatedAt: Date.now() });
}
