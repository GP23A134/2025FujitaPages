// 一依頼の進行状態と遷移だけを管理します。ここに永続化用の再開データは保持しません。
export const WORKFLOW_STATUSES = Object.freeze([
  'planning',
  'needs_clarification',
  'needs_scope_approval',
  'scope_denied',
  'retrieving',
  'analyzing',
  'validating',
  'needs_proposal_review',
  'budget_exhausted',
  'completed',
  'cancelled',
  'failed'
]);

const transitions = Object.freeze({
  planning: ['needs_clarification', 'needs_scope_approval', 'retrieving', 'analyzing', 'budget_exhausted', 'completed', 'cancelled', 'failed', 'scope_denied'],
  needs_clarification: ['planning', 'cancelled', 'failed'],
  needs_scope_approval: ['planning', 'retrieving', 'analyzing', 'cancelled', 'failed', 'scope_denied'],
  retrieving: ['planning', 'analyzing', 'needs_scope_approval', 'needs_proposal_review', 'validating', 'budget_exhausted', 'cancelled', 'failed', 'scope_denied'],
  analyzing: ['planning', 'validating', 'needs_clarification', 'needs_scope_approval', 'needs_proposal_review', 'budget_exhausted', 'cancelled', 'failed', 'scope_denied'],
  validating: ['planning', 'needs_proposal_review', 'needs_clarification', 'budget_exhausted', 'completed', 'cancelled', 'failed'],
  needs_proposal_review: ['planning', 'needs_scope_approval', 'completed', 'cancelled', 'failed', 'scope_denied'],
  budget_exhausted: ['planning', 'cancelled'],
  completed: [],
  cancelled: [],
  failed: ['planning', 'cancelled']
});

export function createConversationState({ id, request, settingsSnapshot, selectedClassIds = [], createdAt = new Date().toISOString() }) {
  if (!id || typeof id !== 'string') throw new TypeError('会話IDが必要です。');
  if (typeof request !== 'string' || !request.trim()) throw new TypeError('依頼文が必要です。');
  if (!settingsSnapshot || typeof settingsSnapshot !== 'object' || Array.isArray(settingsSnapshot)) {
    throw new TypeError('設定スナップショットが必要です。');
  }

  return {
    id,
    request: request.trim(),
    status: 'planning',
    settingsSnapshot: structuredClone(settingsSnapshot),
    selectedClassIds: [...new Set(selectedClassIds.filter((id) => typeof id === 'string'))],
    counters: { responseRounds: 0, retrievalCalls: 0, replans: 0, inputTokensReserved: 0, inputTokensActual: 0 },
    scopeGrants: { reference: [], change: [] },
    artifacts: [],
    proposals: [],
    createdAt,
    updatedAt: createdAt
  };
}

export function transitionConversation(state, nextStatus, now = new Date().toISOString()) {
  if (!state || !WORKFLOW_STATUSES.includes(state.status)) throw new TypeError('有効な会話状態ではありません。');
  if (!WORKFLOW_STATUSES.includes(nextStatus)) throw new TypeError(`不明なワークフロー状態です: ${nextStatus}`);
  if (!transitions[state.status].includes(nextStatus)) {
    throw new Error(`許可されていない状態遷移です: ${state.status} -> ${nextStatus}`);
  }
  return { ...state, status: nextStatus, updatedAt: now };
}

export function incrementConversationCounter(state, counter, amount = 1) {
  if (!Object.hasOwn(state?.counters || {}, counter)) throw new TypeError(`不明なカウンターです: ${counter}`);
  if (!Number.isFinite(amount) || amount < 0) throw new RangeError('カウンター増分は0以上の数値が必要です。');
  return { ...state, counters: { ...state.counters, [counter]: state.counters[counter] + amount } };
}
