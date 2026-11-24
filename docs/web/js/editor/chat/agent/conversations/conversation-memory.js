import { normalizeJobCheckpoint } from '../application/job-loop.js';

const MAX_STAGE_COUNT = 40;
const MAX_STAGE_LABEL = 300;
const MAX_SELECTED_IDS_PER_STAGE = 500;
const MAX_SUMMARY = 1600;
const MAX_CONTEXT_CHARACTERS = 7000;

const text = (value, limit) => typeof value === 'string' ? value.trim().slice(0, limit) : '';
const ids = (value) => Array.isArray(value)
  ? [...new Set(value.filter((id) => typeof id === 'string' && id.length <= 256))].slice(0, MAX_SELECTED_IDS_PER_STAGE)
  : [];

export function normalizeConversationMemory(memory) {
  if (!memory || typeof memory !== 'object' || Array.isArray(memory) || memory.version !== 1) return null;
  const stages = Array.isArray(memory.stages) ? memory.stages.slice(-MAX_STAGE_COUNT).map((stage) => ({
    request: text(stage?.request, MAX_STAGE_LABEL),
    selectedIds: ids(stage?.selectedIds),
    status: ['running', 'completed', 'awaiting_user', 'interrupted', 'failed', 'stale'].includes(stage?.status) ? stage.status : 'interrupted',
    summary: text(stage?.summary, MAX_SUMMARY),
    dataVersion: text(stage?.dataVersion, 128),
    startedAt: Number.isFinite(stage?.startedAt) ? stage.startedAt : 0,
    completedAt: Number.isFinite(stage?.completedAt) ? stage.completedAt : null
  })).filter((stage) => stage.request) : [];
  return {
    version: 1,
    kind: memory.kind === 'classification_reorganization' ? 'classification_reorganization' : 'conversation',
    status: ['active', 'completed', 'stale', 'paused'].includes(memory.status) ? memory.status : 'active',
    rootIds: ids(memory.rootIds),
    dataVersion: text(memory.dataVersion, 128),
    policy: text(memory.policy, 3000),
    usage: {
      responseRounds: Number.isSafeInteger(memory.usage?.responseRounds) && memory.usage.responseRounds >= 0 ? memory.usage.responseRounds : 0,
      inputTokensActual: Number.isSafeInteger(memory.usage?.inputTokensActual) && memory.usage.inputTokensActual >= 0 ? memory.usage.inputTokensActual : 0,
      retrievalCalls: Number.isSafeInteger(memory.usage?.retrievalCalls) && memory.usage.retrievalCalls >= 0 ? memory.usage.retrievalCalls : 0,
      replans: Number.isSafeInteger(memory.usage?.replans) && memory.usage.replans >= 0 ? memory.usage.replans : 0
    },
    job: normalizeJobCheckpoint(memory.job),
    stages
  };
}

export function beginConversationStage(memory, { request, selectedIds = [], rootIds = selectedIds, dataVersion = '', kind = 'conversation' }) {
  const current = normalizeConversationMemory(memory) || {
    version: 1, kind, status: 'active', rootIds: ids(selectedIds), dataVersion: text(dataVersion, 128), policy: '',
    usage: { responseRounds: 0, inputTokensActual: 0, retrievalCalls: 0, replans: 0 }, job: null, stages: []
  };
  const startingReorganization = kind === 'classification_reorganization' && current.kind !== 'classification_reorganization';
  const versionChanged = Boolean(current.dataVersion && dataVersion && current.dataVersion !== dataVersion);
  const stages = (startingReorganization ? [] : current.stages).map((stage) => versionChanged && ['completed', 'awaiting_user'].includes(stage.status)
    ? { ...stage, status: 'stale' }
    : stage.status === 'running' ? { ...stage, status: 'interrupted' } : stage);
  stages.push({
    request: text(request, MAX_STAGE_LABEL), selectedIds: ids(selectedIds),
    status: 'running', summary: '', dataVersion: text(dataVersion, 128), startedAt: Date.now(), completedAt: null
  });
  const next = normalizeConversationMemory({
    ...current,
    kind: kind === 'classification_reorganization' || current.kind === 'classification_reorganization'
      ? 'classification_reorganization' : 'conversation',
    status: versionChanged ? 'stale' : 'active',
    dataVersion: text(dataVersion, 128),
    rootIds: startingReorganization ? ids(rootIds) : current.rootIds,
    stages
  });
  return { memory: next, stageIndex: next.stages.length - 1, versionChanged };
}

export function finishConversationStage(memory, stageIndex, { status = 'completed', summary = '', dataVersion = '' } = {}) {
  const current = normalizeConversationMemory(memory);
  if (!current || !Number.isInteger(stageIndex) || !current.stages[stageIndex]) return current;
  const stages = [...current.stages];
  stages[stageIndex] = {
    ...stages[stageIndex],
    status: ['completed', 'awaiting_user', 'interrupted', 'failed', 'stale'].includes(status) ? status : 'failed',
    summary: text(summary, MAX_SUMMARY),
    dataVersion: text(dataVersion || stages[stageIndex].dataVersion, 128),
    completedAt: Date.now()
  };
  return normalizeConversationMemory({ ...current, stages, status: 'active' });
}

export function rememberConversationPolicy(memory, request) {
  const current = normalizeConversationMemory(memory);
  if (!current) return current;
  const value = text(request, MAX_STAGE_LABEL);
  if (!/(?:方針|希望|できるだけ|できる限り|無理に|一つずつ|段階的|中点|中黒|接続詞|課題を|名称|名前|例示|件数|全部|全て|すべて)/u.test(value)) return current;
  const existing = current.policy.split('\n').filter(Boolean);
  if (existing.includes(value)) return current;
  return normalizeConversationMemory({ ...current, policy: [...existing, value].slice(-12).join('\n') });
}

export function recordConversationUsage(memory, counters) {
  const current = normalizeConversationMemory(memory);
  if (!current || !counters || typeof counters !== 'object') return current;
  return normalizeConversationMemory({
    ...current,
    usage: {
      responseRounds: Number.isSafeInteger(counters.responseRounds) ? counters.responseRounds : current.usage.responseRounds,
      inputTokensActual: Number.isSafeInteger(counters.inputTokensActual) ? counters.inputTokensActual : current.usage.inputTokensActual,
      retrievalCalls: Number.isSafeInteger(counters.retrievalCalls) ? counters.retrievalCalls : current.usage.retrievalCalls,
      replans: Number.isSafeInteger(counters.replans) ? counters.replans : current.usage.replans
    }
  });
}

export function recordJobCheckpoint(memory, checkpoint) {
  const current = normalizeConversationMemory(memory);
  if (!current) return current;
  return normalizeConversationMemory({ ...current, job: normalizeJobCheckpoint(checkpoint) });
}

export function getConversationJobAction(memory, request, dataVersion = '') {
  const current = normalizeConversationMemory(memory);
  const job = current?.job;
  const startsNewTask = /(?:別件|別の(?:相談|依頼|作業|話題)|新しい(?:相談|依頼|作業)|話題を(?:変え|切り替え)|別件として)/u.test(String(request || ''));
  if (startsNewTask) return 'new_task';
  if (['running', 'paused', 'interrupted'].includes(job?.status)) {
    return dataVersion && job.dataVersion === dataVersion ? 'resume' : 'stale';
  }
  if (job) return 'new';
  const lastStage = current?.stages.at(-1);
  if (!['interrupted', 'running'].includes(lastStage?.status)) return 'new';
  return dataVersion && lastStage.dataVersion === dataVersion ? 'resume_stage' : 'stale_stage';
}

export function completeConversationMemory(memory) {
  const current = normalizeConversationMemory(memory);
  return current ? normalizeConversationMemory({ ...current, status: 'completed' }) : null;
}

export function buildConversationContext(items, memory, { currentDataVersion = '' } = {}) {
  const safeMemory = normalizeConversationMemory(memory);
  const recent = (Array.isArray(items) ? items : []).slice(-8)
    .filter((item) => item?.type === 'message' && ['user', 'assistant'].includes(item.role) && typeof item.text === 'string')
    .map((item) => `${item.role === 'user' ? '利用者' : 'アシスタント'}: ${item.text.trim().slice(0, 420)}`);
  const context = [];
  let usedCharacters = 0;
  const append = (value, limit = MAX_CONTEXT_CHARACTERS - usedCharacters) => {
    const addition = text(value, Math.max(0, limit));
    if (!addition) return;
    context.push(addition);
    usedCharacters += addition.length + 2;
  };
  if (safeMemory) {
    const changed = safeMemory.dataVersion && currentDataVersion && safeMemory.dataVersion !== currentDataVersion;
    append(`作業メモ（アプリ保存）: 種別=${safeMemory.kind}、状態=${changed || safeMemory.status === 'stale' ? 'データ更新により要再確認' : safeMemory.status}。`);
    if (safeMemory.policy) append(`利用者の希望・方針: ${safeMemory.policy.slice(-2150)}`, 2200);
    if (safeMemory.stages.length) {
      const header = '段階の記録（処理済みの提案は利用者が合意・適用済みとは限らない）:';
      append(header);
      const remaining = Math.max(0, MAX_CONTEXT_CHARACTERS - usedCharacters - 1100);
      const perStage = Math.max(70, Math.floor(remaining / safeMemory.stages.length));
      safeMemory.stages.forEach((stage, index) => {
        const requestLimit = Math.max(36, Math.floor(perStage * 0.48));
        const summaryLimit = Math.max(30, perStage - requestLimit - 18);
        append(`${index + 1}. ${stage.request.slice(0, requestLimit)} [${stage.status}]${stage.summary ? ` ${stage.summary.slice(0, summaryLimit)}` : ''}`, perStage + 20);
      });
    }
    const pending = safeMemory.stages.filter((stage) => ['running', 'awaiting_user', 'interrupted', 'failed', 'stale'].includes(stage.status));
    if (pending.length) append(`再開・再確認が必要な段階数: ${pending.length}`);
  }
  if (recent.length) append(`直近の会話（意図と合意の確認に限る。クラスの事実は今回取得したデータで確認する）:\n${recent.join('\n')}`, 1100);
  return context.join('\n\n').slice(0, MAX_CONTEXT_CHARACTERS);
}

export function detectReorganizationRequest(request) {
  return /(?:分類体系|クラス体系|階層|クラス|分類).{0,24}(?:再編|再構成|整理|見直|組み替え)|(?:再編|再構成|見直).{0,24}(?:クラス|分類|階層)|(?:全体|全範囲|配下全体|一つずつ|段階的).{0,24}(?:分類|再編|整理|見直)/u.test(String(request || ''));
}

export function isReorganizationFinalizationRequest(request) {
  return /(?:最終|最後|全段階|全体|これまで|全部|すべて|全て).{0,24}(?:提案|案|統合|まとめ|実装)|(?:提案|案).{0,20}(?:まとめ|統合|最終)|ここまで.{0,12}(?:まとめ|統合|実装)|一括.{0,12}(?:提案|実装|適用)/u.test(String(request || ''));
}
