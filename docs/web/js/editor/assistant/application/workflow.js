import { createConversationState, transitionConversation } from './conversation-state.js';
import { buildPlanInput } from '../features/planning/plan-input.js';
import { createBudgetGuard } from '../agent-runtime/budget-guard.js';
import { createEditorDataReader } from '../features/data-retrieval/editor-data-reader.js';
import { createPermissionGuard } from '../agent-runtime/permission-guard.js';
import { createToolDispatcher } from '../agent-runtime/tool-dispatcher.js';
import { createAgentRunLoop } from '../agent-runtime/run-loop.js';
import { buildAgentSystemPrompt } from '../prompts/agent-system-prompt.js';
import { PROPOSAL_RESPONSE_SCHEMA } from '../features/proposals/proposal-schema.js';
import { validateProposalResponse } from '../features/proposals/proposal-contract.js';

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
const parseResponse = (text) => {
  try { return JSON.parse(text); }
  catch {
    throw Object.assign(new Error('AIの提案が有効なJSONではありません。'), {
      code: 'INVALID_PROPOSAL_JSON', sourceModule: 'features/proposals/proposal-contract.js'
    });
  }
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
  editor, client, planningService, scopeApproval, getSettings,
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
  let lastResult = null;
  let lastAgentContext = null;
  let active = false;
  let activeController = null;
  let settingsInvalidated = false;
  const selectedAlternatives = new Map();
  const updateState = (next) => { state = next; onEvent({ type: 'state', state }); };
  const setStatus = (status) => {
    if (state?.status === status) return;
    updateState(transitionConversation(state, status, now()));
  };
  const emitProgress = (stage, detail = {}) => {
    reportProgress({ stage, ...detail });
    onEvent({ type: 'progress', stage, ...detail });
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

  async function applyScopeDecision(decision) {
    if (decision.choice === 'cancel') {
      setStatus('cancelled');
      return false;
    }
    if (decision.choice === 'allow') {
      decision.referenceIds.forEach((id) => grants.reference.add(id));
      decision.changeIds.forEach((id) => grants.change.add(id));
    } else if (decision.choice === 'original_scope') {
      setStatus('scope_denied');
      emitProgress('scope_denied');
      return false;
    }
    updateState({
      ...state,
      scopeGrants: { reference: [...grants.reference], change: [...grants.change] },
      updatedAt: now()
    });
    setStatus('planning');
    return true;
  }

  async function createPlan({ replan = false, signal } = {}) {
    if (replan) budgetGuard.countReplan();
    emitProgress('planning');
    let result;
    try {
      result = await planningService.createPlan({
        apiKey: currentApiKey,
        model: currentModel,
        planInput: buildPlanInput(state.request, currentCounts(), { instanceCount: currentCounts().instanceCount }),
        hierarchyIndexAvailable,
        signal,
        budgetGuard,
        onUsage: reportUsage
      });
    } catch (error) {
      throw withErrorSource(error, 'features/planning/planning-service.js');
    }
    plan = result.plan;
    onEvent({ type: 'plan', plan, usage: result.usage, counts: currentCounts() });
    return plan;
  }

  async function runAgent({ signal }) {
    const settings = state.settingsSnapshot;
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
    if (plan.dataNeeds.parentContext !== 'none') allowedTools.push('read_selected_class_details', 'read_class_details');
    if (plan.dataNeeds.instanceContext !== 'none') allowedTools.push('read_instance_context');
    const uniqueTools = [...new Set(allowedTools)];
    const loop = createAgentRunLoop({
      client,
      registry: reader.registry,
      dispatcher,
      budgetGuard,
      model: currentModel,
      apiKey: currentApiKey,
      systemInstruction: buildAgentSystemPrompt(plan),
      maxOutputTokens: settings['runtime.maxOutputTokens'],
      textFormat: { type: 'json_schema', name: 'class_edit_proposals', strict: true, schema: PROPOSAL_RESPONSE_SCHEMA },
      onUsage: reportUsage
    });
    let messages = [{ role: 'user', content: state.request }];
    const retries = settings['validation.maxRepairRetries'];
    for (let attempt = 0; ; attempt += 1) {
      emitProgress(attempt ? 'validating' : (uniqueTools.length ? 'retrieving' : 'analyzing'));
      let result;
      try { result = await loop.run({ messages, signal, allowedTools: uniqueTools, onProgress: emitProgress }); }
      catch (error) { throw withErrorSource(error, 'agent-runtime/run-loop.js'); }
      if (result.status === 'needs_scope_approval') {
        const decision = await askForScope({
          candidates: result.scopeRequest.candidates || [],
          allowReference: result.scopeRequest.scopeType === 'reference',
          allowChange: false,
          purpose: result.scopeRequest.purpose || '取得に追加の参照範囲が必要です。'
        });
        if (!await applyScopeDecision(decision)) return { status: state.status === 'cancelled' ? 'cancelled' : 'scope_blocked', scopeRequest: result.scopeRequest };
        if (decision.choice === 'original_scope' || !decision.referenceIds.length) {
          return { status: 'scope_blocked', scopeRequest: result.scopeRequest };
        }
        return { status: 'replan_required' };
      }
      const response = parseResponse(result.text);
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
        const candidates = reader.getScopeCandidates(validation.scopeRequests.map((item) => item.classId))
          .map((candidate) => {
            const request = validation.scopeRequests.find((item) => item.classId === candidate.id);
            return { ...candidate, needsReference: request.needsReference, needsChange: request.needsChange };
          });
        const needsReference = candidates.some((item) => item.needsReference);
        const needsChange = candidates.some((item) => item.needsChange);
        const decision = await askForScope({
          candidates, allowReference: needsReference, allowChange: needsChange,
          purpose: '変更案の検証で、選択範囲外のクラスを参照または変更対象に含める必要があります。'
        });
        if (!await applyScopeDecision(decision)) return { status: state.status === 'cancelled' ? 'cancelled' : 'scope_blocked', scopeRequest: { candidates } };
        if (decision.choice === 'allow' && (decision.referenceIds.length || decision.changeIds.length)) return { status: 'replan_required' };
        return { status: 'scope_blocked', scopeRequest: { candidates } };
      }
      if (validation.blocked.length && attempt < retries) {
        messages = [...result.messages, { role: 'user', content: JSON.stringify({
          validationErrors: validation.blocked,
          instruction: '無効な変更案を修正してください。範囲外の操作を除き、同じ前提のまま有効な独立案を返してください。'
        }) }];
        continue;
      }
      lastAgentContext = { loop, messages: result.messages, allowedTools: uniqueTools };
      return {
        ...validation,
        ...(result.budgetLimited ? { proposals: [], alternativeGroups: [] } : {}),
        budgetLimited: Boolean(result.budgetLimited),
        usage: result.usage,
        messages: result.messages
      };
    }
  }

  async function runPlan({ replan = false, signal } = {}) {
    if (replan) setStatus('planning');
    const currentPlan = await createPlan({ replan, signal });
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
    if (state.status !== 'planning') setStatus('planning');
    if (currentPlan.dataNeeds.hierarchyIndex || currentPlan.dataNeeds.selectedClassDetails
      || currentPlan.dataNeeds.parentContext !== 'none' || currentPlan.dataNeeds.instanceContext !== 'none') setStatus('retrieving');
    else setStatus('analyzing');
    const outcome = await runAgent({ signal });
    if (outcome.status === 'replan_required') return runPlan({ replan: true, signal });
    if (outcome.status === 'cancelled') return outcome;
    if (outcome.status === 'scope_blocked') {
      onEvent({ type: 'scope_blocked', scopeRequest: outcome.scopeRequest });
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
      emitProgress('waiting_for_review');
    } else {
      setStatus('completed');
      emitProgress('completed');
    }
    lastResult = outcome;
    onEvent({ type: 'result', result: outcome, plan: currentPlan, state });
    return { status: state.status, result: outcome, plan: currentPlan };
  }

  async function start({ request, apiKey, model, signal, referenceAllHierarchy = false }) {
    if (active) throw new Error('別のAI処理が実行中です。');
    active = true;
    const activeSignal = beginActive(signal);
    try {
      const settings = getSettings();
      selectedClassIds = [...(editor.selectedIds || [])];
      hierarchyIndexAvailable = referenceAllHierarchy === true;
      plan = null;
      lastResult = null;
      lastAgentContext = null;
      selectedAlternatives.clear();
      const referenceIds = new Set(selectedClassIds);
      if (hierarchyIndexAvailable) {
        editor.getState().classes.filter((item) => item.type === 'top' || item.type === 'middle')
          .forEach((item) => referenceIds.add(item.id));
      }
      grants = { reference: referenceIds, change: new Set(selectedClassIds) };
      state = createConversationState({
        id: crypto.randomUUID(),
        request,
        settingsSnapshot: settings,
        selectedClassIds
      });
      state = { ...state, scopeGrants: { reference: [...referenceIds], change: selectedClassIds } };
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
        onChange: (counters) => { state = { ...state, counters, updatedAt: now() }; onEvent({ type: 'state', state }); }
      });
      return await runPlan({ signal: activeSignal });
    } catch (error) {
      if (settingsInvalidated) {
        return await recoverAfterSettingsChange();
      }
      const canBudgetStop = error.status === 'budget_exhausted' || error.code?.includes('BUDGET') || error.code?.includes('LIMIT');
      try { setStatus(canBudgetStop ? 'budget_exhausted' : 'failed'); } catch { /* Terminal state may already be set. */ }
      emitProgress(canBudgetStop ? 'budget_exhausted' : 'failed', { note: error.message });
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
      onChange: (counters) => { state = { ...state, counters, updatedAt: now() }; onEvent({ type: 'state', state }); }
    });
  }

  function getPersistenceSnapshot() {
    if (!state) return null;
    return {
      state,
      plan,
      dataVersion: window.classEditorAssistant?.getDataVersion?.() || null,
      result: lastResult ? {
        message: lastResult.message,
        proposals: lastResult.proposals.filter((item) => !['applied', 'alternative_excluded'].includes(item.status)).map(({ proposal }) => proposal),
        alternativeGroups: lastResult.alternativeGroups || [],
        blocked: lastResult.blocked || []
      } : null
    };
  }

  async function resume(snapshot, { apiKey, model, signal } = {}) {
    if (active) throw new Error('別のAI処理が実行中です。');
    if (!snapshot?.state?.id || !snapshot.state.settingsSnapshot) throw new TypeError('再開データが不正です。');
    const saved = snapshot.state;
    selectedClassIds = Array.isArray(saved.selectedClassIds)
      ? saved.selectedClassIds.filter((id) => typeof id === 'string')
      : [...(saved.scopeGrants?.change || [])];
    state = {
      ...saved,
      status: ['needs_clarification', 'needs_proposal_review', 'budget_exhausted', 'scope_denied', 'cancelled', 'completed', 'failed'].includes(saved.status) ? saved.status : 'planning',
      counters: { responseRounds: 0, retrievalCalls: 0, replans: 0, inputTokensReserved: 0, inputTokensActual: 0, ...saved.counters }
    };
    if (state.counters.inputTokensReserved > 0) {
      state.counters.inputTokensActual += state.counters.inputTokensReserved;
      state.counters.inputTokensReserved = 0;
    }
    grants = { reference: new Set(saved.scopeGrants?.reference || []), change: new Set(saved.scopeGrants?.change || []) };
    plan = snapshot.plan || null;
    currentApiKey = apiKey || null;
    currentModel = model || null;
    lastAgentContext = null;
    lastResult = null;
    selectedAlternatives.clear();
    createBudgetForState();
    if (state.status === 'needs_proposal_review' && snapshot.result) {
      const currentVersion = window.classEditorAssistant?.getDataVersion?.() || null;
      if (snapshot.dataVersion === currentVersion) {
        const checked = validateProposalResponse({
          message: snapshot.result.message || '保存した変更案を再検証しました。',
          proposals: snapshot.result.proposals || [],
          alternativeGroups: snapshot.result.alternativeGroups || []
        }, {
          editor,
          referenceIds: [...grants.reference],
          changeIds: [...grants.change],
          allowedOperations: plan?.changeOperations || [],
          targetRenameEnabled: state.settingsSnapshot['proposals.targetClassRenameEnabled'],
          dataVersion: currentVersion
        });
        lastResult = { ...checked, blocked: [...(snapshot.result.blocked || []), ...checked.blocked] };
      }
      if (!lastResult?.proposals.length) {
        state = { ...state, status: 'planning' };
        updateState(state);
        onEvent({ type: 'resume_requires_replan', reason: 'データが更新されたか、保存した変更案を再検証できませんでした。' });
        if (!currentApiKey || !currentModel) return { status: state.status, requiresCredentials: true };
        active = true;
        try { return await runPlan({ replan: true, signal }); }
        finally { active = false; }
      }
      updateState(state);
      onEvent({ type: 'result', result: lastResult, plan, state });
      return { status: state.status, result: lastResult, resumed: true, requiresCredentials: !currentApiKey || !currentModel };
    }
    updateState(state);
    if (state.status === 'needs_clarification' && plan?.questions) onEvent({ type: 'questions', questions: plan.questions });
    if (state.status === 'budget_exhausted') {
      onEvent({ type: 'resume_requires_replan', reason: '上限に達した処理です。開発者設定で上限を調整し、新しい依頼として再実行してください。' });
      return { status: state.status, requiresNewRun: true };
    }
    if (['scope_denied', 'cancelled', 'completed', 'failed'].includes(state.status)) return { status: state.status, resumed: true };
    if (state.status === 'planning') {
      if (!currentApiKey || !currentModel) return { status: state.status, requiresCredentials: true };
      active = true;
      try { return await runPlan({ replan: true, signal }); }
      finally { active = false; }
    }
    return { status: state.status, resumed: true, requiresCredentials: !currentApiKey || !currentModel };
  }

  async function answerQuestions(answers, signal) {
    if (!state || state.status !== 'needs_clarification') throw new Error('回答を受け付ける確認待ち状態ではありません。');
    const formattedAnswers = formatAnswers(plan?.questions, answers);
    if (!formattedAnswers) throw new TypeError('各質問に回答してください。');
    state = { ...state, request: `${state.request}\n\n利用者の回答:\n${formattedAnswers}`, updatedAt: now() };
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
        if (await applyScopeDecision(decision) && decision.choice === 'allow' && decision.referenceIds.length) {
          budgetGuard.countReplan();
          await runPlan();
        }
        return { status: state.status };
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
      onEvent({ type: 'result', result: lastResult, plan, state });
      return { status: state.status, result: lastResult };
    } catch (error) {
      if (settingsInvalidated) return await recoverAfterSettingsChange();
      emitError(error);
      return { status: state.status, error };
    } finally { activeController = null; active = false; }
  }

  function applyProposal(item) {
    if (!state || state.status !== 'needs_proposal_review') throw new Error('変更案を適用できる確認待ち状態ではありません。');
    if (!lastResult?.proposals.includes(item)) throw new Error('この変更案は現在の確認対象ではありません。');
    if (item.proposal.questions.length) throw new Error('未回答の確認事項がある提案は適用できません。');
    const choiceGroup = lastResult.alternativeGroups.find((group) => group.proposalIds.includes(item.proposal.id));
    if (choiceGroup && selectedAlternatives.get(choiceGroup.id) !== item.proposal.id) throw new Error('代替案または競合案を明示的に選択してください。');
    const currentVersion = window.classEditorAssistant?.getDataVersion?.() || null;
    if (item.dataVersion && currentVersion && item.dataVersion !== currentVersion) throw new Error('データ版が変わりました。最新のデータで再計画してください。');
    const current = editor.getState();
    const fingerprint = JSON.stringify({ classes: current.classes, relations: current.relations });
    const candidate = editor.applyOperations(item.operations, fingerprint, item.editableIds, item.availableIds, item.operationPolicy);
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
    const choiceGroup = lastResult.alternativeGroups.find((group) => group.proposalIds.includes(item.proposal.id));
    if (choiceGroup && selectedAlternatives.get(choiceGroup.id) !== item.proposal.id) throw new Error('代替案または競合案を明示的に選択してください。');
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

  return Object.freeze({ start, resume, updateDeveloperSettings, answerQuestions, answerProposalQuestions, selectAlternative, preparePreview, applyProposal, finishReview, clearSecrets, getState, getPlan: () => plan, getPersistenceSnapshot });
}
