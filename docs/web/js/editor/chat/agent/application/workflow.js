import { createConversationState, transitionConversation } from './conversation-state.js?v=20261124-conversation-context-v1';
import { createTaskState, normalizeTaskState, recordTaskAction, recordTaskCriterion, stopTask, completeTask, resumeTask, authorizeTaskAction } from './task-state.js?v=20261125-design-destination-action-v1';
import { buildPlanInput } from '../features/planning/plan-input.js?v=20261124-conversation-context-v1';
import { createBudgetGuard } from '../agent-runtime/budget-guard.js';
import { createEditorDataReader } from '../features/data-retrieval/editor-data-reader.js?v=20261125-verified-retrieval-v1';
import { createChunkedReadOnlyReview } from '../features/data-retrieval/chunked-read-only-review.js?v=20261120-denied-scope-fallback-v1';
import { createTargetMoveBatchProcessor } from '../features/proposals/target-move-batch.js?v=20261125-generic-intent-v1';
import { createHierarchyReorganizationJob } from '../features/proposals/hierarchy-reorganization-job.js?v=20261125-design-destination-action-v1';
import { createHierarchyDeletionJob } from '../features/proposals/hierarchy-deletion-job.js?v=20261125-structured-jobs-v4';
import { createPermissionGuard } from '../agent-runtime/permission-guard.js';
import { createToolDispatcher } from '../agent-runtime/tool-dispatcher.js';
import { createAgentRunLoop } from '../agent-runtime/run-loop.js?v=20261125-verified-retrieval-v1';
import { buildAgentSystemPrompt } from '../prompts/agent-system-prompt.js?v=20261125-scope-chain-tools-v1';
import { PROPOSAL_RESPONSE_SCHEMA } from '../features/proposals/proposal-schema.js';
import { validateProposalResponse } from '../features/proposals/proposal-contract.js';
import { createDataIdCodec, createIdMaskedClient } from '../adapters/data-id-codec.js?v=20261120-id-pseudonyms-v2';
import { createTaskController } from './task-controller.js?v=20261125-task-controller-v1';

const now = () => new Date().toISOString();
const withErrorSource = (error, sourceModule) => {
  if (error && typeof error === 'object' && !error.sourceModule) error.sourceModule = sourceModule;
  return error;
};
const countsFor = (classes, ids) => {
  const selected = new Set(ids);
  const counts = { top: 0, middle: 0, target: 0 };
  classes.forEach((item) => {
    if (!selected.has(item.id)) return;
    const level = item.type === 'class' ? 'target' : item.type;
    if (Object.hasOwn(counts, level)) counts[level] += 1;
  });
  return counts;
};
const allClassCounts = (classes) => countsFor(classes, classes.map((item) => item.id));
const expandScopeDescendants = (classes, relations, roots) => {
  const children = new Map();
  relations.forEach(({ child, parent }) => {
    if (!children.has(parent)) children.set(parent, []);
    children.get(parent).push(child);
  });
  const found = new Set();
  const pending = [...new Set(roots || [])];
  while (pending.length) {
    const id = pending.pop();
    if (found.has(id)) continue;
    found.add(id);
    pending.push(...(children.get(id) || []));
  }
  const available = new Set(classes.map((item) => item.id));
  return [...found].filter((id) => available.has(id));
};
const resolveNamedHierarchyRoots = (request, classes) => {
  const normalizedRequest = String(request || '').normalize('NFC');
  const candidates = (classes || []).filter((item) => ['top', 'middle'].includes(item.type)
    && typeof item.label === 'string' && item.label.trim()
    && normalizedRequest.includes(item.label.trim().normalize('NFC')));
  if (!candidates.length) return [];
  const longestLength = Math.max(...candidates.map((item) => item.label.trim().normalize('NFC').length));
  return candidates.filter((item) => item.label.trim().normalize('NFC').length === longestLength);
};
const parseResponse = (text) => {
  try { return JSON.parse(text); }
  catch {
    throw Object.assign(new Error('AIの提案が有効なJSONではありません。'), {
      code: 'INVALID_PROPOSAL_JSON', sourceModule: 'features/proposals/proposal-contract.js'
    });
  }
};
const explicitlyRequestsMoveProposal = (request, plannedText = '') => {
  const requestText = String(request || '');
  const planText = String(plannedText || '');
  const combined = `${requestText}\n${planText}`;
  const negated = /移動案.{0,16}(?:不要|出さない|作らない|求めない)|移動(?:は|を)?(?:しない|行わない|させない|したくない)|変更しない/;
  if (negated.test(combined)) return false;
  return /移動案|移す案|移動を提案|移動させて(?:ほしい|ください)|移動して(?:ほしい|ください)|移して(?:ほしい|ください)/.test(requestText)
    || /移動案|移す案|移動を提案/.test(planText);
};
const usesBatchedTargetMove = (plan) => plan?.changeOperations?.length === 1
  && plan.changeOperations[0] === 'move_target_class'
  && plan.dataNeeds?.selectedClassDetails
  && plan.dataNeeds?.hierarchyIndex
  && plan.dataNeeds?.instanceContext === 'none';
const verifyAgentRetrieval = (plan, evidence, selectedIds, allowedIds, editorState) => {
  const records = (evidence || []).filter((item) => item?.ok === true);
  const liveVersion = window.classEditorAssistant?.getDataVersion?.() || null;
  const versions = new Set(records.map((item) => item.data?.dataVersion));
  if (!liveVersion || (records.length && (versions.size !== 1 || !versions.has(liveVersion)))) return null;
  const completePages = (tool) => {
    const pages = records.filter((item) => item.tool === tool);
    if (!pages.length || pages.some((item) => item.data?.nextCursor)) return null;
    const items = pages.flatMap((item) => Array.isArray(item.data?.items) ? item.data.items : []);
    const totals = pages.map((item) => item.data?.totalCount);
    if (totals.some((count) => !Number.isSafeInteger(count)) || new Set(totals).size !== 1
      || items.length !== totals[0] || new Set(items.map((item) => item.id)).size !== items.length) return null;
    return { pages, items, totalCount: totals[0] };
  };
  const needs = plan.dataNeeds || {};
  const noDataRequired = !needs.hierarchyIndex && !needs.selectedClassDetails
    && needs.parentContext === 'none' && needs.instanceContext === 'none';
  if (plan.scopeNeeds?.changeBeyondSelection || (noDataRequired && plan.changeOperations?.length)) return null;
  const details = completePages('read_selected_class_details');
  const index = completePages('read_hierarchy_index');
  if (needs.hierarchyIndex) {
    const expectedHierarchy = (editorState?.classes || [])
      .filter((item) => ['top', 'middle'].includes(item.type) && allowedIds?.has(item.id))
      .map((item) => item.id).sort();
    const actualHierarchy = index?.items.map((item) => item.id).sort() || [];
    if (!index || JSON.stringify(actualHierarchy) !== JSON.stringify(expectedHierarchy)) return null;
  }
  if (needs.selectedClassDetails && (!details || details.pages[0].data.notFoundIds?.length
    || details.items.length !== new Set(selectedIds).size
    || [...new Set(selectedIds)].some((id) => !details.items.some((item) => item.id === id)))) return null;
  const referenceScope = completePages('read_reference_scope');
  if (plan.scopeNeeds?.referenceBeyondSelection) {
    const expected = [...(allowedIds || [])].sort();
    const actual = referenceScope?.items.map((item) => item.id).sort() || [];
    const selected = new Set(selectedIds || []);
    if (!referenceScope || !expected.some((id) => !selected.has(id))
      || JSON.stringify(actual) !== JSON.stringify(expected)) return null;
  }
  if (needs.parentContext === 'direct_parent') {
    const parentPages = records.filter((item) => ['read_selected_class_details', 'read_class_details'].includes(item.tool));
    const parentItems = parentPages.flatMap((item) => item.data?.items || []);
    if (!parentPages.length || parentPages.some((item) => item.arguments?.includeParentContext !== true)
      || new Set(parentItems.map((item) => item.id)).size !== new Set(selectedIds).size
      || parentPages.some((item) => item.data?.notFoundIds?.length)
      || [...new Set(selectedIds)].some((id) => !parentItems.some((item) => item.id === id))) return null;
    const parents = new Map((editorState?.relations || []).map(({ child, parent }) => [child, parent]));
    if (parentItems.some((item) => (item.parentId || null) !== (parents.get(item.id) || null))) return null;
  }
  if (needs.parentContext === 'ancestor_chain') {
    const chains = records.filter((item) => item.tool === 'read_ancestor_chains');
    const byId = new Map((editorState?.classes || []).map((item) => [item.id, item]));
    const parentByChild = new Map((editorState?.relations || []).map(({ child, parent }) => [child, parent]));
    const returned = chains.flatMap((item) => item.data?.items || []);
    const returnedIds = returned.map((item) => item.classId).sort();
    const expectedIds = [...new Set(selectedIds)].sort();
    if (!chains.length || chains.some((item) => item.data?.notFoundIds?.length)
      || JSON.stringify(returnedIds) !== JSON.stringify(expectedIds)) return null;
    for (const chain of returned) {
      const expectedAncestors = [];
      let parentId = parentByChild.get(chain.classId) || null;
      const seen = new Set([chain.classId]);
      while (parentId && !seen.has(parentId)) {
        seen.add(parentId);
        expectedAncestors.push(parentId);
        parentId = parentByChild.get(parentId) || null;
      }
      const ancestors = Array.isArray(chain.ancestors) ? chain.ancestors : [];
      if (!chain.rootReached || parentId || JSON.stringify(ancestors.map((item) => item.id)) !== JSON.stringify(expectedAncestors)
        || ancestors.some((item) => !allowedIds?.has(item.id) || !byId.has(item.id))) return null;
    }
  }
  if (needs.instanceContext !== 'none') {
    const instances = records.filter((item) => item.tool === 'read_instance_context');
    const expectedTargets = new Set((selectedIds || []).filter((id) => allowedIds?.has(id)));
    const covered = new Set(instances.flatMap((item) => Array.isArray(item.arguments?.classIds) ? item.arguments.classIds : []));
    if (!instances.length || instances.some((item) => item.data?.notFoundIds?.length
      || item.arguments?.context !== needs.instanceContext
      || (item.data?.items || []).some((entry) => entry.isPartial || entry.returnedCount < entry.totalCount))
      || [...expectedTargets].some((id) => !covered.has(id))) return null;
  }
  const allItems = records.flatMap((item) => Array.isArray(item.data?.items) ? item.data.items : []);
  const scopedItems = allItems.flatMap((item) => item.classId
    ? [{ id: item.classId }, ...(item.ancestors || []).map((ancestor) => ({ id: ancestor.id }))] : [item]);
  if (scopedItems.some((item) => !allowedIds?.has(item.id))
    || allItems.some((item) => item.parentId && !allowedIds?.has(item.parentId))) return null;
  const data = records.flatMap((item) => Array.isArray(item.data?.items) ? item.data.items : []);
  return {
    expectedCount: (needs.hierarchyIndex ? index.totalCount : 0) + (needs.selectedClassDetails ? details.totalCount : 0),
    processedCount: data.length,
    missingCount: 0,
    unresolvedCount: 0,
    scopeComplete: true,
    resultValidated: true,
    basis: 'application_verified_tool_results'
  };
};
const hasHierarchyDeletion = (plan) => plan?.changeOperations?.some((operation) =>
  operation === 'delete_top_class' || operation === 'delete_middle_class') === true;
const structureModeOf = (plan) => plan?.structureMode
  || (plan?.executionMode === 'reorganization' ? 'design' : 'existing');
const correctMoveProposalPlan = (candidate, request) => {
  const brief = candidate.executionBrief || {};
  const plannedText = [candidate.summary, brief.objective, brief.expectedResult].join('\n');
  if (!explicitlyRequestsMoveProposal(request, plannedText)) return candidate;
  if (candidate.taskType !== 'read_only' && candidate.changeOperations.includes('move_target_class')
    && candidate.dataNeeds.hierarchyIndex && candidate.dataNeeds.selectedClassDetails) return candidate;
  return {
    ...candidate,
    taskType: 'mixed',
    dataNeeds: { ...candidate.dataNeeds, hierarchyIndex: true, selectedClassDetails: true },
    scopeNeeds: { ...candidate.scopeNeeds, referenceBeyondSelection: true },
    changeOperations: [...new Set([...candidate.changeOperations, 'move_target_class'])]
  };
};
const formatAnswers = (questions, answers) => {
  if (typeof answers === 'string') return answers.trim();
  const answerById = new Map((answers || []).map((answer) => [answer.questionId, answer]));
  return (questions || []).map((question) => {
    const answer = answerById.get(question.id);
    if (!answer) return null;
    const kind = answer.optionId ? '選択した候補' : '自由入力';
    return `- ${question.text}\n  ${kind}: ${answer.text}`;
  }).filter(Boolean).join('\n');
};

export function createAssistantWorkflow({
  editor, client, planningService, scopeApproval, budgetApproval, getSettings,
  reportProgress = () => {}, onEvent = () => {}, reportUsage = () => {}
}) {
  if (!editor?.getState || !client?.request || !planningService?.createPlan) throw new TypeError('Workflowの依存関係が不足しています。');
  let state = null;
  let plan = null;
  let grants = { reference: new Set(), change: new Set() };
  let budgetGuard = null;
  let selectedClassIds = [];
  let hierarchyIndexAvailable = false;
  let currentApiKey = null;
  let currentModel = null;
  let activeClient = client;
  let idCodec = createDataIdCodec();
  let lastResult = null;
  let lastAgentContext = null;
  let active = false;
  let activeController = null;
  let settingsInvalidated = false;
  let deniedReferenceIds = new Set();
  let deniedChangeIds = new Set();
  const selectedAlternatives = new Map();
  const updateState = (next) => { state = next; onEvent({ type: 'state', state }); };
  const setStatus = (status) => {
    if (state?.status === status) return;
    let next = transitionConversation(state, status, now());
    const actionByStatus = {
      retrieving: 'inspect_scope', analyzing: 'inspect_scope',
      needs_scope_approval: 'ask_user', needs_clarification: 'ask_user'
    };
    const action = actionByStatus[status];
    const taskState = normalizeTaskState(next.taskState);
    if (action && taskState?.status === 'running') {
      const input = action === 'ask_user'
        ? { question: status === 'needs_scope_approval' ? '追加参照を許可しますか' : '依頼内容を確認してください', workflowStatus: status }
        : { scopeIds: taskState.scopeIds, workflowStatus: status };
      const authorization = authorizeTaskAction(taskState, { action, input }, {
        scopeIds: taskState.scopeIds, dataVersion: taskState.dataVersion
      });
      if (!authorization.allowed) throw Object.assign(new Error(`タスク行動を許可できません: ${authorization.reason}`), { code: 'TASK_ACTION_DENIED' });
      next = { ...next, taskState: recordTaskAction(taskState, { action, input, outcome: 'entered' }) };
    }
    if (['needs_scope_approval', 'needs_clarification'].includes(status)) {
      const currentTask = normalizeTaskState(next.taskState);
      if (currentTask?.status === 'running') next = {
        ...next,
        taskState: stopTask(currentTask, {
          reason: status,
          awaitingUserInput: { reason: status === 'needs_scope_approval' ? 'scope_approval' : 'clarification' }
        })
      };
    }
    updateState(next);
  };
  const emitProgress = (stage, detail = {}) => {
    const payload = stage && typeof stage === 'object'
      ? { ...stage, ...detail }
      : { stage, ...detail };
    reportProgress(payload);
    onEvent({ type: 'progress', ...payload });
  };
  const emitError = (error) => {
    const sourceModule = error?.sourceModule || 'application/workflow.js';
    const code = error?.code || 'WORKFLOW_ERROR';
    globalThis.console?.error?.(`[assistant] ${sourceModule} (${code})`, error);
    onEvent({ type: 'error', error: { code, message: error?.message || String(error), sourceModule } });
  };
  const beginActive = (externalSignal) => {
    const controller = new AbortController();
    activeController = controller;
    if (externalSignal) {
      if (externalSignal.aborted) controller.abort(externalSignal.reason);
      else externalSignal.addEventListener('abort', () => controller.abort(externalSignal.reason), { once: true });
    }
    return controller.signal;
  };
  function cancel() {
    if (!active) return false;
    const reason = Object.assign(new Error('処理を中止しました。'), { name: 'AbortError' });
    activeController?.abort(reason);
    scopeApproval?.cancel?.();
    budgetApproval?.cancel?.();
    return true;
  }
  const recoverAfterSettingsChange = async () => {
    settingsInvalidated = false;
    if (state.status !== 'planning') setStatus('planning');
    createBudgetForState();
    return runPlan({ replan: true });
  };

  function currentCounts() {
    const classes = editor.getState().classes;
    const included = new Set([...grants.reference, ...grants.change]);
    const counts = {
      available: allClassCounts(classes),
      selected: countsFor(classes, included)
    };
    if (state?.settingsSnapshot['instances.enabled']) {
      const memberships = window.appData?.instanceClassData?.relations || [];
      const children = new Map();
      editor.getState().relations.forEach(({ child, parent }) => {
        if (!children.has(parent)) children.set(parent, []);
        children.get(parent).push(child);
      });
      const targetIds = new Set();
      const pending = [...included];
      const visited = new Set();
      const byId = new Map(classes.map((item) => [item.id, item]));
      while (pending.length) {
        const id = pending.pop();
        if (visited.has(id)) continue;
        visited.add(id);
        if (byId.get(id)?.type === 'class') targetIds.add(id);
        else pending.push(...(children.get(id) || []));
      }
      counts.instanceCount = new Set(memberships.filter((relation) => targetIds.has(relation.class)).map((relation) => relation.instance)).size;
    }
    return {
      ...counts
    };
  }

  async function askForScope({ candidates, allowReference, allowChange, purpose }) {
    if (!scopeApproval?.request) return { choice: 'original_scope', referenceIds: [], changeIds: [] };
    setStatus('needs_scope_approval');
    emitProgress('waiting_for_scope_approval', { scopeSummary: purpose });
    return scopeApproval.request({
      candidates,
      allowReference,
      allowChange,
      purpose,
      processSummary: plan?.executionBrief?.objective || ''
    });
  }

  function getProposalScopeCandidates(scopeRequests, getCandidates) {
    const details = getCandidates(scopeRequests.map((item) => item.classId));
    return details.map((candidate) => {
      const request = scopeRequests.find((item) => item.classId === candidate.id);
      const needsChange = Boolean(request.needsChange && grants.change.has(candidate.id));
      if (request.needsChange && !needsChange) deniedChangeIds.add(candidate.id);
      return {
        ...candidate,
        needsReference: Boolean(request.needsReference),
        needsChange
      };
    }).filter((item) => (item.needsReference && !deniedReferenceIds.has(item.id))
      || (item.needsChange && !deniedChangeIds.has(item.id)));
  }

  async function applyScopeDecision(decision, { continueInPlace = false } = {}) {
    if (decision.choice === 'cancel') {
      setStatus('cancelled');
      emitProgress('cancelled');
      return 'cancel';
    }
    if (decision.choice !== 'allow') {
      setStatus('analyzing');
      emitProgress('analyzing', { note: '追加参照は許可されなかったため、許可済みの範囲だけで続けています。' });
      return 'denied';
    }
    decision.referenceIds.forEach((id) => grants.reference.add(id));
    const selectedScope = new Set(selectedClassIds);
    decision.changeIds.filter((id) => selectedScope.has(id)).forEach((id) => grants.change.add(id));
    let nextState = {
      ...state,
      scopeGrants: { reference: [...grants.reference], change: [...grants.change] },
      updatedAt: now()
    };
    const taskState = normalizeTaskState(nextState.taskState);
    if (taskState?.status === 'awaiting_user') {
      const resumedTask = resumeTask(taskState, {
        scopeIds: nextState.selectedClassIds,
        dataVersion: window.classEditorAssistant?.getDataVersion?.() || ''
      });
      if (!resumedTask) throw Object.assign(new Error('参照許可の待機中に対象データが更新されたため、タスクを再開できません。'), {
        code: 'DATA_VERSION_CHANGED', sourceModule: 'application/task-state.js'
      });
      nextState = { ...nextState, taskState: resumedTask };
    }
    updateState(nextState);
    setStatus(continueInPlace ? 'retrieving' : 'planning');
    return 'allow';
  }

  function failScopeContinuation(reason) {
    if (reason === 'denied') return;
    const note = reason === 'approved_scope_incomplete'
      ? '許可された範囲だけでは必要な情報が不足しています。'
      : '許可操作を受け取りましたが、許可対象を特定できませんでした。';
    setStatus('failed');
    emitProgress('failed', { note });
  }

  async function createPlan({ replan = false, signal } = {}) {
    if (replan) budgetGuard.countReplan();
    emitProgress('planning');
    let result;
    try {
      result = await planningService.createPlan({
        apiKey: currentApiKey,
        model: currentModel,
        client: activeClient,
        planInput: buildPlanInput(state.request, currentCounts(), {
          instanceCount: currentCounts().instanceCount,
          conversationContext: state.conversationContext
        }),
        hierarchyIndexAvailable,
        signal,
        budgetGuard,
        onUsage: reportUsage
      });
    } catch (error) {
      throw withErrorSource(error, 'features/planning/planning-service.js');
    }
    plan = correctMoveProposalPlan(result.plan, state.request);
    onEvent({ type: 'plan', plan, usage: result.usage, counts: currentCounts() });
    return plan;
  }

  async function runAgent({ signal }) {
    const settings = state.settingsSnapshot;
    const contextualRequest = state.conversationContext
      ? `${state.request}\n\n会話の継続情報（利用者の意図・合意した方針・進捗。クラスの事実ではない）:\n${state.conversationContext}`
      : state.request;
    const jobRequest = state.continuationInput
      ? `${contextualRequest}\n\n再開時の追加指示:\n${state.continuationInput}`
      : contextualRequest;
    if (plan.dataNeeds.instanceContext !== 'none' && !settings['instances.enabled']) {
      throw Object.assign(new Error('インスタンス情報が無効なため、計画を続けられません。'), { code: 'INSTANCE_CONTEXT_DISABLED' });
    }
    const reader = createEditorDataReader({
      editor,
      getReferenceScope: () => [...grants.reference],
      getSelectedIds: () => [...selectedClassIds],
      getDataVersion: () => window.classEditorAssistant?.getDataVersion?.(),
      pageLimit: settings['dataRetrieval.pageAndIdLimit'],
      idLimit: settings['dataRetrieval.pageAndIdLimit'],
      appData: window.appData,
      instanceInformationEnabled: settings['instances.enabled'],
      instancePerClassLimit: settings['instances.perClassLimit'],
      instancePerTaskLimit: settings['instances.perTaskLimit'],
      includeInstanceIds: settings['instances.includeId'],
      plannedInstanceContext: plan.dataNeeds.instanceContext
    });
    const chunkedReview = plan.taskType === 'read_only'
      && plan.dataNeeds.selectedClassDetails
      && !plan.dataNeeds.hierarchyIndex
      && plan.dataNeeds.parentContext !== 'ancestor_chain'
      && plan.dataNeeds.instanceContext === 'none'
      && plan.changeOperations.length === 0;
    const chunkedReviewRunner = chunkedReview ? createChunkedReadOnlyReview({
      reader, client: activeClient, budgetGuard, model: currentModel, apiKey: currentApiKey,
      request: contextualRequest, plan,
      pageLimit: settings['dataRetrieval.pageAndIdLimit'],
      maxOutputTokens: settings['runtime.maxOutputTokens'],
      signal, onProgress: emitProgress, onUsage: reportUsage
    }) : null;
    const hierarchyReorganization = structureModeOf(plan) === 'design'
      || state.jobCheckpoint?.kind === 'hierarchy_reorganization';
    const hierarchyDeletion = (structureModeOf(plan) === 'existing' && hasHierarchyDeletion(plan))
      || state.jobCheckpoint?.kind === 'hierarchy_deletion';
    const batchedTargetMove = !hierarchyReorganization && (usesBatchedTargetMove(plan)
      || (state.jobCheckpoint?.kind === 'target_move' && plan.changeOperations.includes('move_target_class')));
    const continueTargetReviewWithinGrantedScope = async () => {
      const fallbackPlan = {
        ...plan,
        executionBrief: {
          objective: '追加共有を使わず、選択済みクラスの名称だけで確認できる範囲を評価する。',
          successCriteria: ['許可済みの選択クラスだけを使う', '親子関係や移動先を推測しない', '変更案を作らず判断できない点を示す']
        },
        dataNeeds: { ...plan.dataNeeds, selectedClassDetails: true, hierarchyIndex: false, parentContext: 'none', instanceContext: 'none' },
        changeOperations: []
      };
      const fallbackRunner = createChunkedReadOnlyReview({
        reader, client: activeClient, budgetGuard, model: currentModel, apiKey: currentApiKey,
        request: `${contextualRequest}\n\n追加範囲の共有は拒否されました。許可済みの選択クラスの名称だけを使って確認を続け、親子関係や移動先を推測せず、変更案は作成しないでください。`,
        plan: fallbackPlan,
        pageLimit: settings['dataRetrieval.pageAndIdLimit'],
        maxOutputTokens: settings['runtime.maxOutputTokens'],
        signal, onProgress: emitProgress, onUsage: reportUsage
      });
      const fallback = await fallbackRunner.run({ includeParentContext: false });
      if (state.jobCheckpoint?.kind === 'target_move') {
        const endedAt = Date.now();
        const closedJob = {
          ...state.jobCheckpoint,
          status: 'failed',
          updatedAt: endedAt,
          completedAt: endedAt,
          metadata: { ...state.jobCheckpoint.metadata, terminalReason: 'reference_scope_denied' }
        };
        state = { ...state, jobCheckpoint: closedJob };
        onEvent({ type: 'job_checkpoint', checkpoint: closedJob });
      }
      const parsed = JSON.parse(fallback.text);
      parsed.message += '\n\n追加範囲は拒否されたため、選択済みクラスの名称だけで確認を続けました。親子関係と移動先候補は使わず、移動案は作成していません。';
      return { status: 'scope_limited', result: { ...parsed, blocked: [] } };
    };
    let loop = null;
    let uniqueTools = [];
    let targetMoveProcessor = null;
    let hierarchyReorganizationJob = null;
    let hierarchyDeletionJob = null;
    const resolveRuntimeScopeRequest = async (scopeRequest) => {
      const candidates = (scopeRequest.candidates || []).filter((item) => !deniedReferenceIds.has(typeof item === 'string' ? item : item.id));
      if (!candidates.length) return 'deny';
      const decision = await askForScope({
        candidates,
        allowReference: scopeRequest.scopeType === 'reference',
        allowChange: false,
        purpose: scopeRequest.purpose || '取得に追加の参照範囲が必要です。'
      });
      if (decision.choice === 'allow') return await applyScopeDecision(decision, { continueInPlace: true });
      if (decision.choice === 'cancel') return await applyScopeDecision(decision);
      candidates.forEach((item) => deniedReferenceIds.add(typeof item === 'string' ? item : item.id));
      return await applyScopeDecision(decision);
    };
    if (batchedTargetMove) {
      targetMoveProcessor = createTargetMoveBatchProcessor({
        reader, client: activeClient, budgetGuard, model: currentModel, apiKey: currentApiKey,
        request: jobRequest, plan,
        maxOutputTokens: settings['runtime.maxOutputTokens'],
        maxRetries: settings['proposals.moveDecisionRetries'], signal,
        jobCheckpoint: state.jobCheckpoint,
        dataVersion: window.classEditorAssistant?.getDataVersion?.() || '',
        jobRequest: state.request,
        jobScopeIds: editor.getState().classes.filter((item) => item.type === 'class' && selectedClassIds.includes(item.id)).map((item) => item.id),
        jobSelectedIds: [...selectedClassIds],
        jobHierarchyIds: editor.getState().classes.filter((item) => ['top', 'middle'].includes(item.type) && grants.reference.has(item.id)).map((item) => item.id),
        onCheckpoint: (checkpoint) => {
          state = { ...state, jobCheckpoint: checkpoint };
          onEvent({ type: 'job_checkpoint', checkpoint });
        },
        onProgress: emitProgress, onUsage: reportUsage
      });
    } else if (hierarchyReorganization) {
      const selectedSet = new Set(selectedClassIds);
      const classes = editor.getState().classes;
      hierarchyReorganizationJob = createHierarchyReorganizationJob({
        reader, client: activeClient, budgetGuard, model: currentModel, apiKey: currentApiKey,
        request: jobRequest, plan, maxOutputTokens: settings['runtime.maxOutputTokens'], signal,
        jobCheckpoint: state.jobCheckpoint,
        dataVersion: window.classEditorAssistant?.getDataVersion?.() || '',
        jobRequest: state.request,
        continuationInput: state.continuationInput,
        jobScopeIds: [...selectedClassIds],
        jobTargetIds: classes.filter((item) => item.type === 'class' && selectedSet.has(item.id)).map((item) => item.id),
        jobSelectedIds: [...selectedClassIds],
        jobHierarchyIds: classes.filter((item) => ['top', 'middle'].includes(item.type) && grants.reference.has(item.id)).map((item) => item.id),
        onCheckpoint: (checkpoint) => {
          state = { ...state, jobCheckpoint: checkpoint };
          onEvent({ type: 'job_checkpoint', checkpoint });
        },
        onProgress: emitProgress, onUsage: reportUsage
      });
    } else if (hierarchyDeletion) {
      const classes = editor.getState().classes;
      hierarchyDeletionJob = createHierarchyDeletionJob({
        reader, client: activeClient, budgetGuard, model: currentModel, apiKey: currentApiKey,
        request: jobRequest, plan, maxOutputTokens: settings['runtime.maxOutputTokens'], signal,
        jobCheckpoint: state.jobCheckpoint,
        dataVersion: window.classEditorAssistant?.getDataVersion?.() || '',
        jobRequest: state.request,
        continuationInput: state.continuationInput,
        jobScopeIds: [...selectedClassIds],
        jobSelectedIds: [...selectedClassIds],
        jobHierarchyIds: classes.filter((item) => ['top', 'middle'].includes(item.type) && grants.reference.has(item.id)).map((item) => item.id),
        onCheckpoint: (checkpoint) => {
          state = { ...state, jobCheckpoint: checkpoint };
          onEvent({ type: 'job_checkpoint', checkpoint });
        },
        onProgress: emitProgress, onUsage: reportUsage
      });
    } else if (!chunkedReview) {
      const permissionGuard = createPermissionGuard({ getReferenceScope: () => [...grants.reference] });
      const dispatcher = createToolDispatcher({
        registry: reader.registry,
        permissionGuard,
        budgetGuard,
        getScopeCandidates: reader.getScopeCandidates
      });
      const allowedTools = [];
      if (plan.dataNeeds.hierarchyIndex) allowedTools.push('read_hierarchy_index', 'read_direct_children', 'read_class_details');
      if (plan.dataNeeds.selectedClassDetails) allowedTools.push('read_selected_class_details', 'read_direct_children', 'read_class_details');
      if (plan.dataNeeds.parentContext === 'direct_parent') allowedTools.push('read_selected_class_details', 'read_class_details');
      if (plan.dataNeeds.parentContext === 'ancestor_chain') allowedTools.push('read_ancestor_chains');
      if (plan.scopeNeeds.referenceBeyondSelection) allowedTools.push('read_reference_scope');
      if (plan.dataNeeds.instanceContext !== 'none') allowedTools.push('read_instance_context');
      uniqueTools = [...new Set(allowedTools)];
      loop = createAgentRunLoop({
        client: activeClient,
        registry: reader.registry,
        dispatcher,
        budgetGuard,
        model: currentModel,
        apiKey: currentApiKey,
        systemInstruction: buildAgentSystemPrompt(plan, { conversationContext: state.conversationContext }),
        maxOutputTokens: settings['runtime.maxOutputTokens'],
        textFormat: { type: 'json_schema', name: 'class_edit_proposals', strict: true, schema: PROPOSAL_RESPONSE_SCHEMA },
        onUsage: reportUsage,
        onScopeRequest: resolveRuntimeScopeRequest
      });
    }
    const executionController = createTaskController([
      { id: 'chunked_read_only', matches: () => chunkedReview, run: () => chunkedReviewRunner.run() },
      { id: 'target_move', matches: () => Boolean(targetMoveProcessor), run: () => targetMoveProcessor.run() },
      { id: 'hierarchy_reorganization', matches: () => Boolean(hierarchyReorganizationJob), run: () => hierarchyReorganizationJob.run() },
      { id: 'hierarchy_deletion', matches: () => Boolean(hierarchyDeletionJob), run: () => hierarchyDeletionJob.run() },
      { id: 'agent_runtime', matches: () => true, run: (__, options) => loop.run(options) }
    ]);
    const executionRoute = executionController.select({ plan, checkpoint: state.jobCheckpoint });
    let messages = [{ role: 'user', content: state.request }];
    const retries = settings['validation.maxRepairRetries'];
    for (let attempt = 0; ; attempt += 1) {
      emitProgress(attempt ? 'validating' : (uniqueTools.length ? 'retrieving' : 'analyzing'));
      let result;
      try {
        result = await executionRoute.run({ messages, signal, allowedTools: uniqueTools, onProgress: emitProgress });
      } catch (error) {
        if (targetMoveProcessor && error?.scopeRequest) {
          const candidates = (error.scopeRequest.candidates || []).filter((item) => !deniedReferenceIds.has(item.id));
          if (!candidates.length) {
            return await continueTargetReviewWithinGrantedScope();
          }
          const decision = await askForScope({
            candidates,
            allowReference: true,
            allowChange: false,
            purpose: error.scopeRequest.purpose || '移動先を確認するため追加の階層参照が必要です。'
          });
          const scopeDecision = await applyScopeDecision(decision);
          if (scopeDecision === 'cancel') return { status: 'cancelled' };
          if (scopeDecision === 'allow') return { status: 'replan_required' };
          candidates.forEach((item) => deniedReferenceIds.add(item.id));
          return await continueTargetReviewWithinGrantedScope();
        }
        throw withErrorSource(error, executionRoute.id === 'chunked_read_only'
          ? 'features/data-retrieval/chunked-read-only-review.js'
          : executionRoute.id === 'target_move' ? 'features/proposals/target-move-batch.js'
            : executionRoute.id === 'hierarchy_reorganization' ? 'features/proposals/hierarchy-reorganization-job.js'
              : executionRoute.id === 'hierarchy_deletion' ? 'features/proposals/hierarchy-deletion-job.js'
                : 'agent-runtime/run-loop.js');
      }
      if (result.status === 'stale_job') return { status: 'stale_job', message: result.message };
      if (result.status === 'needs_user_input') return { status: 'job_needs_input', message: result.message, checkpoint: result.checkpoint };
      if (result.status === 'cancelled') return { status: 'cancelled' };
      if (result.status === 'needs_scope_approval') {
        const decision = await askForScope({
          candidates: result.scopeRequest.candidates || [],
          allowReference: result.scopeRequest.scopeType === 'reference',
          allowChange: false,
          purpose: result.scopeRequest.purpose || '取得に追加の参照範囲が必要です。'
        });
        const scopeDecision = await applyScopeDecision(decision);
        if (scopeDecision === 'cancel') return {
          status: state.status === 'cancelled' ? 'cancelled' : 'scope_blocked',
          scopeRequest: result.scopeRequest,
          scopeReason: decision.choice === 'allow' ? 'approved_without_scope' : 'denied'
        };
        if (scopeDecision === 'denied') {
          const deniedIds = (result.scopeRequest.candidates || []).map((item) => typeof item === 'string' ? item : item.id);
          deniedIds.forEach((id) => deniedReferenceIds.add(id));
          if (targetMoveProcessor) {
            return await continueTargetReviewWithinGrantedScope();
          }
          if (chunkedReview) {
            result = await chunkedReviewRunner.run({ includeParentContext: false });
            if (result.status === 'needs_scope_approval') {
              return {
                status: 'scope_limited',
                result: {
                  message: '許可された範囲の詳細を取得できず、この依頼は続行できませんでした。',
                  proposals: [], alternativeGroups: [], blocked: []
                }
              };
            }
          }
        }
        if (scopeDecision === 'denied' && chunkedReview) {
          // The selected records can still be reviewed without disclosing parent classes.
        } else if (decision.choice === 'original_scope' || !decision.referenceIds.length) {
          if (targetMoveProcessor) return await continueTargetReviewWithinGrantedScope();
          if (!chunkedReview) {
            messages = [{ role: 'user', content: `${state.request}\n\n追加参照は許可されていません。許可済みの情報だけを使い、範囲外を推測せずに回答してください。` }];
            continue;
          }
        }
        if (scopeDecision === 'allow') return { status: 'replan_required' };
      }
      let response;
      try {
        response = parseResponse(result.text);
      } catch (error) {
        if (attempt >= retries) {
          error.message = 'AIの応答を提案JSONとして読み取れませんでした。再試行上限に達したため処理を停止しました。';
          throw error;
        }
        messages = [...(result.messages || messages), { role: 'user', content: JSON.stringify({
          instruction: '直前の応答は有効な提案JSONとして読み取れませんでした。取得済みデータと依頼を保ち、指定されたJSONスキーマに一致する完全なJSONだけを返してください。Markdownや説明文を付けないでください。'
        }) }];
        continue;
      }
      let validation;
      try {
        validation = validateProposalResponse(response, {
          editor,
          referenceIds: [...grants.reference],
          changeIds: [...grants.change],
          allowedOperations: plan.changeOperations,
          targetRenameEnabled: settings['proposals.targetClassRenameEnabled'],
          dataVersion: window.classEditorAssistant?.getDataVersion?.() || null
        });
      } catch (error) {
        throw withErrorSource(error, 'features/proposals/proposal-contract.js');
      }
      if (validation.scopeRequests?.length) {
        const candidates = getProposalScopeCandidates(validation.scopeRequests, reader.getScopeCandidates);
        if (!candidates.length) {
          const externalChangeRequested = validation.scopeRequests.some((item) => item.needsChange && deniedChangeIds.has(item.classId));
          validation.blocked.push({ proposalId: null, reason: externalChangeRequested
            ? '選択範囲外のクラスを変更対象に含める提案は対象外のため、保留しました。'
            : '追加参照が許可されていないため、範囲外の提案を保留しました。' });
          validation.scopeRequests = [];
          break;
        }
        const needsReference = candidates.some((item) => item.needsReference);
        const needsChange = candidates.some((item) => item.needsChange);
        const decision = await askForScope({
          candidates, allowReference: needsReference, allowChange: needsChange,
          purpose: '変更案の検証に選択範囲外クラスの参照が必要です。選択範囲外クラスは変更対象に追加しません。'
        });
        const scopeDecision = await applyScopeDecision(decision);
        if (scopeDecision === 'cancel') return { status: 'cancelled' };
        if (scopeDecision === 'denied') {
          candidates.filter((item) => item.needsReference).forEach((item) => deniedReferenceIds.add(item.id));
          candidates.filter((item) => item.needsChange).forEach((item) => deniedChangeIds.add(item.id));
          if (attempt < retries) {
            messages = [...(result.messages || messages), { role: 'user', content: JSON.stringify({
              deniedScope: candidates.map((item) => item.label || item.id),
              instruction: '利用者は追加参照を許可しませんでした。許可済みの情報だけを使い、追加範囲が必要な操作は提案せず、可能な独立案だけを返してください。範囲外を推測しないでください。'
            }) }];
            continue;
          }
          validation.blocked.push({ proposalId: null, reason: '追加参照が許可されなかったため、範囲外の提案を保留しました。' });
          validation.scopeRequests = [];
          break;
        }
        if (decision.choice === 'allow' && (decision.referenceIds.length || decision.changeIds.length)) return { status: 'replan_required' };
        return { status: 'scope_blocked', scopeRequest: { candidates },
          scopeReason: decision.choice === 'allow' ? 'approved_without_scope' : 'denied' };
      }
      if (validation.blocked.length && attempt < retries) {
        messages = [...result.messages, { role: 'user', content: JSON.stringify({
          validationErrors: validation.blocked,
          instruction: '無効な変更案を修正してください。範囲外の操作を除き、同じ前提のまま有効な独立案を返してください。'
        }) }];
        continue;
      }
      lastAgentContext = chunkedReview || targetMoveProcessor ? null : {
        loop,
        messages: result.messages,
        allowedTools: uniqueTools,
        getScopeCandidates: reader.getScopeCandidates
      };
      return {
        ...validation,
        ...(result.budgetLimited ? { proposals: [], alternativeGroups: [] } : {}),
        budgetLimited: Boolean(result.budgetLimited),
        completionEvidence: result.completionEvidence || verifyAgentRetrieval(plan,
          result.retrievalEvidence, selectedClassIds, grants.reference, editor.getState()),
        usage: result.usage,
        messages: result.messages
      };
    }
  }

  async function runPlan({ replan = false, signal } = {}) {
    if (replan) setStatus('planning');
    if (!selectedClassIds.length && editor.selectedIds?.length) {
      const available = new Set(editor.getState().classes.map((item) => item.id));
      selectedClassIds = [...new Set(editor.selectedIds.filter((id) => available.has(id)))];
      selectedClassIds.forEach((id) => { grants.reference.add(id); grants.change.add(id); });
      hierarchyIndexAvailable = hierarchyIndexAvailable || selectedClassIds.some((id) =>
        editor.getState().classes.some((item) => item.id === id && ['top', 'middle'].includes(item.type)));
      const taskState = normalizeTaskState(state.taskState);
      state = {
        ...state, selectedClassIds: [...selectedClassIds],
        scopeGrants: { reference: [...grants.reference], change: [...grants.change] },
        taskState: taskState ? normalizeTaskState({ ...taskState, scopeIds: selectedClassIds, updatedAt: Date.now() }) : state.taskState,
        updatedAt: now()
      };
      updateState(state);
    }
    if (!selectedClassIds.length && !state.jobCheckpoint && /クラス|分類|階層|配下|再編|整理/.test(String(state.request || ''))) {
      const namedRoots = resolveNamedHierarchyRoots(state.request, editor.getState().classes);
      if (namedRoots.length !== 1) {
        const names = namedRoots.map((item) => `「${item.label}」`).join('、');
        plan = { status: 'needs_clarification', questions: [{
          id: 'target-scope',
          text: namedRoots.length
            ? `対象名が複数の階層クラスに一致しました（${names}）。対象を画面で選択するか、親クラス名を含めて指定してください。`
            : '対象となる階層クラス名を特定できませんでした。対象クラスを画面で選択するか、現在の名称を依頼文に含めてください。'
        }] };
        setStatus('needs_clarification');
        onEvent({ type: 'questions', questions: plan.questions });
        emitProgress('waiting_for_answer');
        return { status: 'needs_clarification', questions: plan.questions };
      }
      selectedClassIds = expandScopeDescendants(editor.getState().classes, editor.getState().relations, [namedRoots[0].id]);
      selectedClassIds.forEach((id) => { grants.reference.add(id); grants.change.add(id); });
      hierarchyIndexAvailable = true;
      const taskState = normalizeTaskState(state.taskState);
      state = {
        ...state,
        selectedClassIds: [...selectedClassIds],
        scopeGrants: { reference: [...grants.reference], change: [...grants.change] },
        taskState: taskState ? normalizeTaskState({ ...taskState, scopeIds: selectedClassIds, updatedAt: Date.now() }) : state.taskState,
        updatedAt: now()
      };
      updateState(state);
    }
    let currentPlan = await createPlan({ replan, signal });
    if (!['unsupported', 'needs_clarification'].includes(currentPlan.status)
      && ((structureModeOf(currentPlan) === 'existing' && hasHierarchyDeletion(currentPlan)) || state.jobCheckpoint?.kind === 'hierarchy_deletion')) {
      const tree = editor.getState();
      selectedClassIds = expandScopeDescendants(tree.classes, tree.relations, selectedClassIds);
      selectedClassIds.forEach((id) => { grants.reference.add(id); grants.change.add(id); });
      state = {
        ...state,
        selectedClassIds: [...selectedClassIds],
        scopeGrants: { reference: [...grants.reference], change: [...grants.change] },
        updatedAt: now()
      };
      updateState(state);
      currentPlan = {
        ...currentPlan,
        structureMode: 'existing',
        taskType: 'mixed',
        changeOperations: [...new Set([...(currentPlan.changeOperations || []), ...(state.jobCheckpoint?.metadata?.deleteOperations || []), 'move_target_class', 'move_middle_class'])],
        dataNeeds: { ...currentPlan.dataNeeds, hierarchyIndex: true, selectedClassDetails: true }
      };
      plan = currentPlan;
      onEvent({ type: 'plan', plan: currentPlan, counts: currentCounts() });
    }
    if (!['unsupported', 'needs_clarification'].includes(currentPlan.status)
      && (structureModeOf(currentPlan) === 'design' || state.jobCheckpoint?.kind === 'hierarchy_reorganization')) {
      const tree = editor.getState();
      selectedClassIds = expandScopeDescendants(tree.classes, tree.relations, selectedClassIds);
      selectedClassIds.forEach((id) => { grants.reference.add(id); grants.change.add(id); });
      state = {
        ...state,
        selectedClassIds: [...selectedClassIds],
        scopeGrants: { reference: [...grants.reference], change: [...grants.change] },
        updatedAt: now()
      };
      updateState(state);
      const reorganizationOperations = [
        'move_target_class', 'move_middle_class', 'add_top_class', 'add_middle_class',
        'rename_top_class', 'rename_middle_class', 'delete_top_class', 'delete_middle_class'
      ];
      currentPlan = {
        ...currentPlan,
        structureMode: 'design',
        taskType: 'mixed',
        changeOperations: [...new Set([...(currentPlan.changeOperations || []), ...reorganizationOperations])],
        dataNeeds: { ...currentPlan.dataNeeds, hierarchyIndex: true, selectedClassDetails: true }
      };
      plan = currentPlan;
      onEvent({ type: 'plan', plan: currentPlan, counts: currentCounts() });
    }
    if (state.jobCheckpoint?.kind === 'target_move'
      && !['unsupported', 'needs_clarification'].includes(currentPlan.status)) {
      currentPlan = {
        ...currentPlan,
        taskType: 'mixed',
        changeOperations: [...new Set([...(currentPlan.changeOperations || []), 'move_target_class'])],
        dataNeeds: { ...currentPlan.dataNeeds, hierarchyIndex: true, selectedClassDetails: true }
      };
      plan = currentPlan;
    }
    const taskState = normalizeTaskState(state.taskState);
    if (taskState && !['unsupported', 'needs_clarification'].includes(currentPlan.status)) {
      state = {
        ...state,
        taskState: normalizeTaskState({
          ...taskState,
          scopeIds: selectedClassIds,
          structureMode: structureModeOf(currentPlan),
          completionCriteria: [
            '対象範囲の確認を完了する',
            currentPlan.changeOperations?.length ? '要求された変更操作を検証する' : '依頼された調査結果を確認する',
            '処理対象の漏れと範囲外操作がないことを確認する'
          ],
          updatedAt: Date.now()
        }),
        updatedAt: now()
      };
      updateState(state);
    }
    if (currentPlan.status === 'unsupported') {
      setStatus('completed');
      emitProgress('completed');
      onEvent({ type: 'unsupported', plan: currentPlan });
      return { status: 'unsupported', plan: currentPlan };
    }
    if (currentPlan.status === 'needs_clarification') {
      setStatus('needs_clarification');
      emitProgress('waiting_for_answer');
      onEvent({ type: 'questions', questions: currentPlan.questions });
      return { status: state.status, plan: currentPlan };
    }
    if (usesBatchedTargetMove(currentPlan)) {
      const classes = editor.getState().classes;
      const selected = new Set(selectedClassIds);
      const selectedDetailCount = classes.filter((item) => selected.has(item.id)).length;
      const targetClassCount = classes.filter((item) => item.type === 'class' && selected.has(item.id)).length;
      const hierarchyClassCount = classes.filter((item) => item.type === 'top' || item.type === 'middle').length;
      const pageLimit = Math.max(1, Number(getSettings()['dataRetrieval.pageAndIdLimit']) || 100);
      const selectedDetailsPages = Math.ceil(selectedDetailCount / pageLimit);
      const hierarchyPages = targetClassCount ? Math.ceil(hierarchyClassCount / pageLimit) : 0;
      const retrievalPages = selectedDetailsPages + hierarchyPages;
      const retrievalLimit = Number(getSettings()['runtime.maxRetrievalCalls']) || 0;
      const retrievalLimitExceeded = retrievalLimit > 0 && retrievalPages > retrievalLimit;
      if (retrievalLimitExceeded) throw Object.assign(
        new Error(`移動案の処理に必要なデータ取得は最低${retrievalPages.toLocaleString('ja-JP')}回ですが、設定上限は${retrievalLimit.toLocaleString('ja-JP')}回です。選択範囲を絞るか、開発者設定の取得呼び出し上限を見直してください。`),
        { code: 'RETRIEVAL_LIMIT', sourceModule: 'application/workflow.js' }
      );
    }
    if (state.status !== 'planning') setStatus('planning');
    if (currentPlan.dataNeeds.hierarchyIndex || currentPlan.dataNeeds.selectedClassDetails
      || currentPlan.dataNeeds.parentContext !== 'none' || currentPlan.dataNeeds.instanceContext !== 'none') setStatus('retrieving');
    else setStatus('analyzing');
    const outcome = await runAgent({ signal });
    if (outcome.status === 'replan_required') return runPlan({ replan: true, signal });
    if (outcome.status === 'job_needs_input') {
      if (state.status === 'retrieving' || state.status === 'planning') setStatus('analyzing');
      if (state.status !== 'validating') setStatus('validating');
      setStatus('needs_clarification');
      const result = { message: outcome.message, proposals: [], alternativeGroups: [], jobPaused: true };
      lastResult = result;
      onEvent({ type: 'result', result, plan: currentPlan, state });
      emitProgress('waiting_for_answer');
      return { status: 'needs_clarification', result, plan: currentPlan };
    }
    if (outcome.status === 'stale_job') {
      if (state.status === 'planning' || state.status === 'retrieving') setStatus('analyzing');
      if (state.status !== 'validating') setStatus('validating');
      if (state.jobCheckpoint) {
        state = { ...state, jobCheckpoint: { ...state.jobCheckpoint, status: 'stale', updatedAt: Date.now() } };
        onEvent({ type: 'job_checkpoint', checkpoint: state.jobCheckpoint });
      }
      setStatus('failed');
      const result = { message: outcome.message, proposals: [], alternativeGroups: [] };
      lastResult = result;
      onEvent({ type: 'result', result, plan: currentPlan, state });
      emitProgress('failed');
      return { status: 'stale', result, plan: currentPlan };
    }
    if (outcome.status === 'cancelled') return outcome;
    if (outcome.status === 'scope_limited') {
      if (state.status === 'retrieving' || state.status === 'planning') setStatus('analyzing');
      if (state.status !== 'validating') setStatus('validating');
      setStatus('failed');
      lastResult = outcome.result;
      onEvent({ type: 'result', result: outcome.result, plan: currentPlan, state });
      emitProgress('failed', { note: '追加参照が許可されず、依頼範囲を完了できませんでした。' });
      return { status: 'failed', result: outcome.result, plan: currentPlan };
    }
    if (outcome.status === 'scope_blocked') {
      failScopeContinuation(outcome.scopeReason || 'denied');
      onEvent({ type: 'scope_blocked', scopeRequest: outcome.scopeRequest, scopeReason: outcome.scopeReason || 'denied' });
      return outcome;
    }
    if (state.status === 'retrieving') setStatus('analyzing');
    setStatus('validating');
    if (outcome.budgetLimited) {
      setStatus('budget_exhausted');
      emitProgress('budget_exhausted');
      lastResult = outcome;
      onEvent({ type: 'result', result: outcome, plan: currentPlan, state });
      return { status: state.status, result: outcome, plan: currentPlan };
    }
    if (outcome.proposals?.length) {
      setStatus('needs_proposal_review');
      const taskState = normalizeTaskState(state.taskState);
      if (taskState) state = { ...state, taskState: stopTask(taskState, {
        reason: 'proposal_review_required', awaitingUserInput: { reason: 'proposal_review' },
        unfinishedItems: ['提案内容の利用者確認']
      }) };
    } else {
      const taskState = normalizeTaskState(state.taskState);
      if (taskState) {
        let verifiedTask = normalizeTaskState({ ...taskState, unfinishedItems: [] });
        const evidence = outcome.completionEvidence || (() => {
          const needs = currentPlan.dataNeeds || {};
          const scope = currentPlan.scopeNeeds || {};
          const noDataRequired = !needs.hierarchyIndex && !needs.selectedClassDetails
            && needs.parentContext === 'none' && needs.instanceContext === 'none';
          const noExpandedScope = !scope.referenceBeyondSelection && !scope.changeBeyondSelection;
          const noChangesRequired = !(currentPlan.changeOperations || []).length;
          if (!noDataRequired || !noExpandedScope || !noChangesRequired) return null;
          return {
            expectedCount: 0,
            processedCount: 0,
            missingCount: 0,
            unresolvedCount: 0,
            scopeComplete: true,
            resultValidated: true,
            basis: 'plan_requires_no_data_or_scope_expansion'
          };
        })();
        const completeEvidence = evidence?.scopeComplete === true && evidence?.resultValidated === true
          && evidence.unresolvedCount === 0 && !outcome.budgetLimited && !outcome.blocked?.length;
        if (completeEvidence) {
          for (const criterion of verifiedTask.completionCriteria) {
            verifiedTask = recordTaskCriterion(verifiedTask, criterion, { ...evidence, verifiedAt: Date.now() }) || verifiedTask;
          }
          verifiedTask = normalizeTaskState({
            ...verifiedTask,
            confirmedFacts: [...verifiedTask.confirmedFacts, { ...evidence, verifiedAt: Date.now() }]
          });
        }
        const completedTask = completeEvidence ? completeTask(verifiedTask) : null;
        if (completedTask) {
          setStatus('completed');
          state = { ...state, taskState: completedTask };
        } else {
          setStatus('failed');
          state = { ...state, taskState: stopTask(verifiedTask, {
          reason: 'completion_criteria_unverified',
          unfinishedItems: verifiedTask.completionCriteria.filter((criterion) =>
            !verifiedTask.criteriaResults.some((result) => result.criterion === criterion && result.status === 'passed'))
          }) };
        }
      } else setStatus('completed');
    }
    lastResult = outcome;
    onEvent({ type: 'result', result: outcome, plan: currentPlan, state });
    emitProgress('completed');
    return { status: state.status, result: outcome, plan: currentPlan };
  }

  async function start({ request, continuationInput = '', apiKey, model, signal, referenceAllHierarchy = false, conversationContext = '', selectedClassIds: selectedClassIdsOverride = null, referenceClassIds: referenceClassIdsOverride = null, initialCounters = null, jobCheckpoint = null }) {
    if (active) throw new Error('別のAI処理が実行中です。');
    active = true;
    const activeSignal = beginActive(signal);
    try {
      const settings = getSettings();
      const editorState = editor.getState();
      const instanceIds = (window.appData?.instanceData?.instances || []).map((item) => item.id);
      idCodec = createDataIdCodec(editorState.classes, instanceIds);
      activeClient = createIdMaskedClient(client, idCodec);
      const validClassIds = new Set(editorState.classes.map((item) => item.id));
      selectedClassIds = Array.isArray(selectedClassIdsOverride)
        ? [...new Set(selectedClassIdsOverride.filter((id) => typeof id === 'string' && validClassIds.has(id)))]
        : [...(editor.selectedIds || [])];
      let unresolvedTargetQuestion = null;
      if (!selectedClassIds.length && !jobCheckpoint && /クラス|分類|階層|配下|再編|整理/.test(String(request || ''))) {
        const namedRoots = resolveNamedHierarchyRoots(request, editorState.classes);
        if (namedRoots.length === 1) {
          selectedClassIds = expandScopeDescendants(editorState.classes, editorState.relations, [namedRoots[0].id]);
        } else {
          const names = namedRoots.map((item) => `「${item.label}」`).join('、');
          unresolvedTargetQuestion = namedRoots.length
            ? `対象名が複数の階層クラスに一致しました（${names}）。対象を画面で選択してから、もう一度依頼してください。`
            : '対象となる階層クラス名を特定できませんでした。対象クラスを画面で選択するか、現在の名称を依頼文に含めてください。';
        }
      }
      deniedReferenceIds = new Set();
      deniedChangeIds = new Set();
      const extraReferenceIds = Array.isArray(referenceClassIdsOverride)
        ? [...new Set(referenceClassIdsOverride.filter((id) => typeof id === 'string' && validClassIds.has(id)))] : [];
      hierarchyIndexAvailable = referenceAllHierarchy === true || extraReferenceIds.length > 0
        || selectedClassIds.some((id) => editorState.classes.some((item) => item.id === id && ['top', 'middle'].includes(item.type)));
      plan = null;
      lastResult = null;
      lastAgentContext = null;
      selectedAlternatives.clear();
      const referenceIds = new Set(selectedClassIds);
      if (hierarchyIndexAvailable) {
        if (referenceAllHierarchy === true) {
          editor.getState().classes.filter((item) => item.type === 'top' || item.type === 'middle')
            .forEach((item) => referenceIds.add(item.id));
        } else extraReferenceIds.forEach((id) => referenceIds.add(id));
      }
      grants = { reference: referenceIds, change: new Set(selectedClassIds) };
      state = createConversationState({
        id: crypto.randomUUID(),
        request,
        settingsSnapshot: settings,
        selectedClassIds,
        conversationContext,
        initialCounters
      });
      state = {
        ...state,
        taskState: createTaskState({
          id: state.id, objective: request,
          completionCriteria: ['依頼された確認・提案範囲を処理する', '提案がある場合は利用者確認待ちとして保持する'],
          scopeIds: selectedClassIds, dataVersion: window.classEditorAssistant?.getDataVersion?.() || '', structureMode: 'existing'
        }),
        scopeGrants: { reference: [...referenceIds], change: selectedClassIds }, jobCheckpoint, continuationInput
      };
      currentApiKey = apiKey;
      currentModel = model;
      updateState(state);
      budgetGuard = createBudgetGuard({
        state,
        limits: {
          inputTokenCap: settings['runtime.inputTokenCap'],
          maxResponseRounds: settings['runtime.maxResponseRounds'],
          maxRetrievalCalls: settings['runtime.maxRetrievalCalls'],
          maxReplans: settings['runtime.maxReplans']
        },
        onChange: (counters) => { state = { ...state, counters, updatedAt: now() }; onEvent({ type: 'state', state }); },
        onResponseLimit: (detail) => budgetApproval?.request?.(detail),
        onInputLimit: (detail) => budgetApproval?.request?.(detail)
      });
      if (unresolvedTargetQuestion) {
        plan = { status: 'needs_clarification', questions: [{ id: 'target-scope', text: unresolvedTargetQuestion }] };
        setStatus('needs_clarification');
        onEvent({ type: 'questions', questions: plan.questions });
        emitProgress('waiting_for_answer');
        return { status: 'needs_clarification', questions: plan.questions };
      }
      return await runPlan({ signal: activeSignal });
    } catch (error) {
      if (settingsInvalidated) {
        return await recoverAfterSettingsChange();
      }
      if (error?.name === 'AbortError') {
        try { setStatus('cancelled'); } catch { /* A scope response may already have cancelled the workflow. */ }
        emitProgress('cancelled');
        return { status: 'cancelled' };
      }
      const canBudgetStop = error.status === 'budget_exhausted' || error.code?.includes('BUDGET') || error.code?.includes('LIMIT');
      try { setStatus(canBudgetStop ? 'budget_exhausted' : 'failed'); } catch { /* Terminal state may already be set. */ }
      emitProgress(canBudgetStop ? 'budget_exhausted' : 'failed', { note: error.message });
      if (canBudgetStop) {
        const result = {
          message: `${error.message}\n\n上限に達する前にクラス確認結果は確定していません。`,
          proposals: [], alternativeGroups: [], blocked: [], budgetLimited: true
        };
        lastResult = result;
        onEvent({ type: 'result', result, plan, state });
        return { status: state?.status || 'budget_exhausted', result, error };
      }
      emitError(error);
      return { status: state?.status || 'failed', error };
    } finally {
      activeController = null;
      active = false;
    }
  }

  async function updateDeveloperSettings(nextSettings) {
    if (!state || !nextSettings) return { updated: false };
    const prior = state.settingsSnapshot;
    const restricted = (prior['instances.enabled'] && !nextSettings['instances.enabled'])
      || (prior['instances.includeId'] && !nextSettings['instances.includeId'])
      || (prior['proposals.targetClassRenameEnabled'] && !nextSettings['proposals.targetClassRenameEnabled'])
      || (Number(nextSettings['dataRetrieval.pageAndIdLimit']) < Number(prior['dataRetrieval.pageAndIdLimit']))
      || (Number(nextSettings['instances.perClassLimit']) < Number(prior['instances.perClassLimit']))
      || (Number(nextSettings['instances.perTaskLimit']) < Number(prior['instances.perTaskLimit']));
    if (!restricted) return { updated: false, reason: 'この会話では開始時の設定を維持します。' };
    state = { ...state, settingsSnapshot: { ...nextSettings }, updatedAt: now() };
    plan = null;
    lastResult = null;
    lastAgentContext = null;
    selectedAlternatives.clear();
    onEvent({ type: 'settings_invalidated', state });
    if (active) {
      settingsInvalidated = true;
      activeController?.abort();
      return { updated: true, replanning: true };
    }
    if (!currentApiKey || !currentModel || ['completed', 'cancelled', 'failed'].includes(state.status)) {
      state = { ...state, status: 'planning' };
      updateState(state);
      return { updated: true, requiresCredentials: !currentApiKey || !currentModel };
    }
    if (state.status !== 'planning') setStatus('planning');
    createBudgetForState();
    active = true;
    const activeSignal = beginActive();
    try { return await runPlan({ replan: true, signal: activeSignal }); }
    catch (error) {
      const canBudgetStop = error.status === 'budget_exhausted' || error.code?.includes('BUDGET') || error.code?.includes('LIMIT');
      try { setStatus(canBudgetStop ? 'budget_exhausted' : 'failed'); } catch { /* Keep the most recent state when it is terminal. */ }
      emitError(error);
      return { status: state.status, error };
    } finally { activeController = null; active = false; }
  }

  function createBudgetForState() {
    const settings = state.settingsSnapshot;
    budgetGuard = createBudgetGuard({
      state,
      limits: {
        inputTokenCap: settings['runtime.inputTokenCap'],
        maxResponseRounds: settings['runtime.maxResponseRounds'],
        maxRetrievalCalls: settings['runtime.maxRetrievalCalls'],
        maxReplans: settings['runtime.maxReplans']
      },
      onChange: (counters) => { state = { ...state, counters, updatedAt: now() }; onEvent({ type: 'state', state }); },
      onResponseLimit: (detail) => budgetApproval?.request?.(detail),
      onInputLimit: (detail) => budgetApproval?.request?.(detail)
    });
  }

  async function answerQuestions(answers, signal) {
    if (!state || state.status !== 'needs_clarification') throw new Error('回答を受け付ける確認待ち状態ではありません。');
    const formattedAnswers = formatAnswers(plan?.questions, answers);
    if (!formattedAnswers) throw new TypeError('各質問に回答してください。');
    state = { ...state, request: `${state.request}\n\n利用者の回答:\n${formattedAnswers}`, updatedAt: now() };
    const taskState = normalizeTaskState(state.taskState);
    if (taskState?.status === 'awaiting_user') {
      const currentDataVersion = window.classEditorAssistant?.getDataVersion?.() || '';
      const resumedTask = resumeTask(taskState, { scopeIds: state.selectedClassIds, dataVersion: currentDataVersion });
      if (!resumedTask) throw new Error('対象範囲が変わったため、このタスク状態を再開できません。');
      state = { ...state, taskState: resumedTask };
    }
    setStatus('planning');
    active = true;
    const activeSignal = beginActive(signal);
    try {
      budgetGuard.countReplan();
      return await runPlan({ signal: activeSignal });
    } catch (error) {
      if (settingsInvalidated) return await recoverAfterSettingsChange();
      const canBudgetStop = error.status === 'budget_exhausted' || error.code?.includes('BUDGET') || error.code?.includes('LIMIT');
      try { setStatus(canBudgetStop ? 'budget_exhausted' : 'failed'); } catch { /* Terminal state may already be set. */ }
      emitProgress(canBudgetStop ? 'budget_exhausted' : 'failed', { note: error.message });
      emitError(error);
      return { status: state?.status || 'failed', error };
    } finally { activeController = null; active = false; }
  }

  async function answerProposalQuestions(proposalId, answers, signal) {
    if (!state || state.status !== 'needs_proposal_review' || active) throw new Error('個別提案の回答を受け付けられません。');
    const prior = lastResult?.proposals.find((item) => item.proposal.id === proposalId);
    if (!prior || !prior.proposal.questions.length) throw new Error('この提案には回答待ちの質問がありません。');
    const formattedAnswers = formatAnswers(prior.proposal.questions, answers);
    if (!formattedAnswers) throw new TypeError('各質問に回答してください。');
    if (!lastAgentContext) {
      state = { ...state, request: `${state.request}\n\n提案「${prior.proposal.title}」への回答:\n${formattedAnswers}`, updatedAt: now() };
      setStatus('planning');
      active = true;
      try { budgetGuard.countReplan(); return await runPlan({ signal }); }
      finally { active = false; }
    }
    active = true;
    const activeSignal = beginActive(signal);
    try {
      const messages = [...lastAgentContext.messages, {
        role: 'user',
        content: JSON.stringify({
          proposalId,
          questions: prior.proposal.questions,
          answers: Array.isArray(answers) ? answers : [{ questionId: prior.proposal.questions[0]?.id, optionId: null, text: formattedAnswers }],
          instruction: 'この提案とその依存操作だけを再検討してください。提案IDを維持してください。他の独立提案は変更しないでください。'
        })
      }];
      emitProgress('analyzing', { note: `提案「${prior.proposal.title}」を再検討しています` });
      const regenerated = await lastAgentContext.loop.run({ messages, signal: activeSignal, allowedTools: lastAgentContext.allowedTools, onProgress: emitProgress });
      if (regenerated.status === 'needs_scope_approval') {
        const decision = await askForScope({
          candidates: regenerated.scopeRequest.candidates || [], allowReference: true, allowChange: false,
          purpose: regenerated.scopeRequest.purpose || '回答を反映するため追加の参照範囲が必要です。'
        });
        const scopeDecision = await applyScopeDecision(decision);
        if (scopeDecision === 'cancel') return { status: 'cancelled' };
        if (scopeDecision === 'allow' && decision.referenceIds.length) {
          budgetGuard.countReplan();
          return await runPlan({ signal: activeSignal });
        }
        (regenerated.scopeRequest.candidates || []).forEach((item) => deniedReferenceIds.add(typeof item === 'string' ? item : item.id));
        state = {
          ...state,
          request: `${state.request}\n\n提案「${prior.proposal.title}」への回答:\n${formattedAnswers}\n追加参照は許可されていないため、許可済み範囲だけで再検討してください。`,
          updatedAt: now()
        };
        setStatus('planning');
        budgetGuard.countReplan();
        return await runPlan({ signal: activeSignal });
      }
      const regeneratedResponse = parseResponse(regenerated.text);
      const checked = validateProposalResponse(regeneratedResponse, {
        editor,
        referenceIds: [...grants.reference],
        changeIds: [...grants.change],
        allowedOperations: plan.changeOperations,
        targetRenameEnabled: state.settingsSnapshot['proposals.targetClassRenameEnabled'],
        dataVersion: window.classEditorAssistant?.getDataVersion?.() || null
      });
      if (checked.scopeRequests.length) {
        const candidates = getProposalScopeCandidates(checked.scopeRequests, lastAgentContext.getScopeCandidates);
        let scopeDecision = 'denied';
        if (candidates.length) {
          const needsReference = candidates.some((item) => item.needsReference);
          const needsChange = candidates.some((item) => item.needsChange);
          const decision = await askForScope({
            candidates,
            allowReference: needsReference,
            allowChange: needsChange,
            purpose: '回答後の変更案に選択範囲外クラスの参照が必要です。選択範囲外クラスは変更対象に追加しません。'
          });
          scopeDecision = await applyScopeDecision(decision);
          if (scopeDecision === 'cancel') return { status: 'cancelled' };
        }
        if (scopeDecision === 'denied') {
          candidates.filter((item) => item.needsReference).forEach((item) => deniedReferenceIds.add(item.id));
          candidates.filter((item) => item.needsChange).forEach((item) => deniedChangeIds.add(item.id));
          const externalChangeRequested = checked.scopeRequests.some((item) => item.needsChange && deniedChangeIds.has(item.classId));
          checked.blocked.push({ proposalId, reason: externalChangeRequested
            ? '選択範囲外のクラスを変更対象に含める提案は対象外のため、この提案を保留しました。'
            : '追加参照が許可されなかったため、この提案の範囲外操作を保留しました。' });
          checked.scopeRequests = [];
        } else {
          const permissionsGranted = checked.scopeRequests.every((item) =>
            (!item.needsReference || grants.reference.has(item.classId))
            && (!item.needsChange || grants.change.has(item.classId) || deniedChangeIds.has(item.classId)));
          if (!permissionsGranted) {
            const scopeRequest = { candidates };
            failScopeContinuation('approved_scope_incomplete');
            onEvent({ type: 'scope_blocked', scopeRequest, scopeReason: 'approved_scope_incomplete' });
            return { status: 'scope_blocked', scopeRequest, scopeReason: 'approved_scope_incomplete' };
          }
        }
        state = {
          ...state,
          request: `${state.request}\n\n提案「${prior.proposal.title}」への回答:\n${formattedAnswers}`,
          updatedAt: now()
        };
        if (scopeDecision === 'allow') {
          budgetGuard.countReplan();
          return await runPlan({ signal: activeSignal });
        }
      }
      const replacement = checked.proposals.find((item) => item.proposal.id === proposalId);
      const preserved = lastResult.proposals.filter((item) => item.proposal.id !== proposalId);
      lastResult = {
        ...lastResult,
        message: regeneratedResponse.message || lastResult.message,
        proposals: replacement ? [...preserved, replacement] : preserved,
        blocked: [...lastResult.blocked, ...checked.blocked,
          ...(!replacement ? [{ proposalId, reason: '回答後の再検討で有効な更新案が返されませんでした。' }] : [])],
        alternativeGroups: [
          ...lastResult.alternativeGroups.filter((group) => !group.proposalIds.includes(proposalId)),
          ...checked.alternativeGroups.filter((group) => group.proposalIds.includes(proposalId))
        ]
      };
      lastAgentContext = { ...lastAgentContext, messages: regenerated.messages };
      if (state.status === 'analyzing' || state.status === 'retrieving') setStatus('needs_proposal_review');
      onEvent({ type: 'result', result: lastResult, plan, state });
      return { status: state.status, result: lastResult };
    } catch (error) {
      if (settingsInvalidated) return await recoverAfterSettingsChange();
      emitError(error);
      return { status: state.status, error };
    } finally { activeController = null; active = false; }
  }

  function applyProposal(item, selectedOperationIndexes = null) {
    if (!state || state.status !== 'needs_proposal_review') throw new Error('変更案を適用できる確認待ち状態ではありません。');
    if (!lastResult?.proposals.includes(item)) throw new Error('この変更案は現在の確認対象ではありません。');
    if (item.proposal.questions.length) throw new Error('未回答の確認事項がある提案は適用できません。');
    const choiceGroup = lastResult.alternativeGroups.find((group) => group.proposalIds.includes(item.proposal.id));
    if (choiceGroup && selectedAlternatives.get(choiceGroup.id) !== item.proposal.id) throw new Error('代替案または競合案を明示的に選択してください。');
    const currentVersion = window.classEditorAssistant?.getDataVersion?.() || null;
    if (item.dataVersion && currentVersion && item.dataVersion !== currentVersion) throw new Error('データ版が変わりました。最新のデータで再計画してください。');
    const operationIndexes = selectedOperationIndexes === null
      ? item.operations.map((_, index) => index)
      : [...new Set(selectedOperationIndexes)];
    if (!operationIndexes.length || operationIndexes.some((index) => !Number.isSafeInteger(index) || index < 0 || index >= item.operations.length)) {
      throw new Error('プレビューで選択された変更内容が不正です。');
    }
    const operations = operationIndexes.map((index) => item.operations[index]);
    const current = editor.getState();
    const fingerprint = JSON.stringify({ classes: current.classes, relations: current.relations });
    const candidate = editor.applyOperations(operations, fingerprint, item.editableIds, item.availableIds, item.operationPolicy);
    editor.commitCandidate(candidate, { assistantConversationId: state.id, assistantProposalId: item.proposal.id });
    item.status = 'applied';
    if (choiceGroup) lastResult.proposals.filter((other) => choiceGroup.proposalIds.includes(other.proposal.id)
      && other !== item).forEach((other) => { other.status = 'alternative_excluded'; });
    const nextVersion = window.classEditorAssistant?.getDataVersion?.() || null;
    lastResult.proposals.filter((other) => !other.status).forEach((other) => { other.dataVersion = nextVersion; });
    if (lastResult.proposals.every((other) => ['applied', 'alternative_excluded'].includes(other.status))) finishReview();
    onEvent({ type: 'proposal_applied', proposalId: item.proposal.id });
    return { proposalId: item.proposal.id, applied: true };
  }

  function preparePreview(item) {
    if (!lastResult?.proposals.includes(item)) throw new Error('この変更案は現在の確認対象ではありません。');
    if (item.proposal.questions.length) throw new Error('確認待ちの質問があるため、先に回答してください。');
    const current = editor.getState();
    const fingerprint = JSON.stringify({ classes: current.classes, relations: current.relations });
    const candidate = editor.applyOperations(item.operations, fingerprint, item.editableIds, item.availableIds, item.operationPolicy);
    return { before: current, after: candidate };
  }

  function finishReview() {
    if (!state || state.status !== 'needs_proposal_review') return false;
    setStatus('completed');
    emitProgress('completed');
    return true;
  }

  function clearSecrets() {
    currentApiKey = null;
    currentModel = null;
  }

  function getState() {
    if (!state) return null;
    return state;
  }

  function selectAlternative(groupId, proposalId) {
    const group = lastResult?.alternativeGroups.find((item) => item.id === groupId);
    if (!group || !group.proposalIds.includes(proposalId)) throw new Error('代替案グループまたは選択肢が見つかりません。');
    selectedAlternatives.set(groupId, proposalId);
  }

  return Object.freeze({ start, cancel, updateDeveloperSettings, answerQuestions, answerProposalQuestions, selectAlternative, preparePreview, applyProposal, finishReview, clearSecrets, getState, isBusy: () => active, getPlan: () => plan });
}
