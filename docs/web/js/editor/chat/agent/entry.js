import { createEditorBridge } from './adapters/editor-bridge.js';
import { createProgressView } from './features/progress/progress-view.js?v=20261119-scope-flow-v1';
import { buildPlanInput } from './features/planning/plan-input.js?v=20261124-conversation-context-v1';
import { createOpenAIClient } from './adapters/openai-client.js?v=20261120-api-retries-v1';
import { createDataIdCodec, createIdMaskedClient } from './adapters/data-id-codec.js?v=20261120-id-pseudonyms-v2';
import { createPlanningService } from './features/planning/planning-service.js?v=20261125-structure-mode-v1';
import { createScopeApprovalView } from './features/scope-approval/scope-approval-view.js?v=20261120-denied-scope-fallback-v1';
import { createBudgetApprovalView } from './features/budget-approval/budget-approval-view.js?v=20261120-budget-limit-approval-v1';
import { createAssistantSettingsRegistry } from './settings/register-defaults.js';
import { createAssistantWorkflow } from './application/workflow.js?v=20261126-scope-root-reorg-v3';
import { createQuestionView } from './features/planning/question-view.js?v=20261118-white-question-card-v1';
import { createWorkflowView } from './features/progress/workflow-view.js?v=20261125-plan-chat-message-v1';
import { createProposalResultView } from './features/proposals/proposal-result-view.js?v=20261120-proposal-pagination-v1';
import { createSettingsView } from './settings/settings-view.js?v=20261119-developer-settings-layout-v2';
import { createHistoryService } from './conversations/history-service.js?v=20261124-conversation-context-v1';
import { beginConversationStage, buildConversationContext, completeConversationMemory, detectReorganizationRequest, finishConversationStage, getConversationJobAction, isReorganizationFinalizationRequest, recordConversationUsage, recordJobCheckpoint, rememberConversationPolicy } from './conversations/conversation-memory.js?v=20261125-job-resume-v1';
import { getAgentLegacyBridge } from '../integration/agent-legacy-bridge-registry.js?v=20261118-chat-bridge-registry-v1';
import { CHAT_EVENTS, dispatchChatEvent } from '../integration/chat-events.js?v=20261124-conversation-context-v1';

const statusElement = document.getElementById('ai-status');
if (window.classEditorAI && statusElement) {
  const errorNotice = document.getElementById('assistant-error-notice');
  const errorNoticeMessage = document.getElementById('assistant-error-notice-message');
  const showError = (error) => {
    if (error?.name === 'AbortError') return;
    const message = typeof error === 'string' ? error : error?.message;
    if (!message || !errorNotice || !errorNoticeMessage) return;
    errorNoticeMessage.textContent = message;
    errorNotice.hidden = false;
  };
  document.getElementById('assistant-error-notice-close')?.addEventListener('click', () => {
    errorNotice.hidden = true;
    errorNoticeMessage.textContent = '';
  });
  const editorBridge = createEditorBridge(window.classEditorAI, window.appData);
  const progressView = createProgressView(statusElement);
  const messages = document.getElementById('ai-chat-messages');
  const interactionDock = document.getElementById('assistant-interaction-dock');
  const scopeApproval = createScopeApprovalView(document.getElementById('assistant-scope-dialog'), window.classEditorAI, {
    messages,
    interactionDock
  });
  const budgetApproval = createBudgetApprovalView({ messages, interactionDock });
  const questionView = createQuestionView(document.getElementById('assistant-question-dialog'), { dock: interactionDock, messages });
  const settingsRegistry = createAssistantSettingsRegistry();
  const historyService = createHistoryService();
  const settingsStorageKey = 'classEditorAssistantDeveloperSettings-v1';
  let settings = settingsRegistry.defaults();
  try {
    const saved = JSON.parse(localStorage.getItem(settingsStorageKey) || '{}');
    // Migrate the previous default so existing sessions can also process large selections.
    if (saved['runtime.inputTokenCap'] === 30000) saved['runtime.inputTokenCap'] = 300000;
    if (saved['runtime.maxRetrievalCalls'] === 50) saved['runtime.maxRetrievalCalls'] = 200;
    const candidate = { ...settings, ...Object.fromEntries(settingsRegistry.list()
      .filter((item) => Object.hasOwn(saved, item.key)).map((item) => [item.key, saved[item.key]])) };
    if (settingsRegistry.validate(candidate).valid) settings = candidate;
  } catch { /* Use feature defaults when saved settings are unavailable or invalid. */ }
  // Legacy chat is no longer a selectable runtime. Its module remains loaded
  // because the current proposal preview is still provided through that bridge.
  settings['chat.useNewSystem'] = true;
  const syncChatSystemChoice = () => {
    document.querySelectorAll('[data-chat-mode-settings]').forEach((section) => {
      section.hidden = section.dataset.chatModeSettings !== 'agent';
    });
  };
  syncChatSystemChoice();
  const updateSetting = (key, value) => {
    if (!settingsRegistry.list().some((definition) => definition.key === key)) throw new Error(`未登録の開発者設定です: ${key}`);
    if (key === 'chat.useNewSystem' && value !== true) throw new Error('旧AIチャットへの切り替えは無効です。');
    const candidate = { ...settings, [key]: value };
    const validation = settingsRegistry.validate(candidate);
    if (!validation.valid) throw new Error(validation.errors.join(' '));
    settings = candidate;
    try { localStorage.setItem(settingsStorageKey, JSON.stringify(settings)); } catch { /* Settings remain active for this page. */ }
    if (key === 'conversations.persistAcrossTabs') {
      historyService.setPersistAcrossTabs(Boolean(value));
    }
    if (workflow) workflow.updateDeveloperSettings({ ...settings }).catch((error) => {
      showError(error);
    });
    settingsView.refresh(settings);
    syncChatSystemChoice();
  };
  const settingsContainer = document.getElementById('assistant-developer-settings');
  const settingsView = settingsContainer
    ? createSettingsView(settingsContainer, settingsRegistry, {
    getValue: (key) => settings[key],
    onChange: updateSetting
    })
    : Object.freeze({ refresh() {} });
  const client = createOpenAIClient();
  const planningService = createPlanningService({
    client,
    getDeveloperSettings: () => ({
      instanceInformationEnabled: settings['instances.enabled'],
      targetClassRenameEnabled: settings['proposals.targetClassRenameEnabled']
    })
  });
  let workflow;
  let activeHistory = null;
  let activeTurnStageIndex = -1;
  let activeTurnDataVersion = '';
  let activeTurnFinalizingReorganization = false;
  let activePlanMessageText = '';
  const historyPersistenceEnabled = () => Boolean(settings['conversations.persistAcrossTabs']);
  const trimHistoryItems = () => {
    if (!activeHistory || activeHistory.items.length <= 100) return;
    const first = activeHistory.items[0];
    activeHistory.items = [first, ...activeHistory.items.slice(-99)];
  };
  const publishHistory = () => {
    if (!activeHistory) return;
    activeHistory.updatedAt = Date.now();
    const title = activeHistory.items.find((item) => item.role === 'user')?.text || '新しい相談';
    activeHistory.title = title.replace(/\s+/g, ' ').trim().slice(0, 80) || '新しい相談';
    historyService.upsert(activeHistory, historyPersistenceEnabled());
    getAgentLegacyBridge()?.upsertHistory?.(activeHistory);
  };
  const addHistoryMessage = (role, text) => {
    const normalized = String(text || '').trim();
    if (!activeHistory || !normalized) return;
    activeHistory.items.push({ type: 'message', role, text: normalized });
    trimHistoryItems();
    publishHistory();
  };
  let proposalResultView;
  proposalResultView = createProposalResultView(messages, {
    onPreview: async (item, proposals, alternativeGroups, selectedAlternatives) => {
      try {
        workflow.preparePreview(item);
        const bridge = getAgentLegacyBridge();
        if (!bridge?.previewProposal) throw new Error('提案プレビューを利用できません。');
        await bridge.previewProposal({
          item,
          proposals,
          alternativeGroups,
          selectedAlternatives,
          onSelectAlternative: (groupId, proposalId) => {
            workflow.selectAlternative(groupId, proposalId);
            proposalResultView.selectAlternative(groupId, proposalId);
          },
          onDismiss: (sourceItem) => proposalResultView.markDismissed(sourceItem),
          onApply: (sourceItem, operationIndexes) => {
            workflow.applyProposal(sourceItem, operationIndexes);
            proposalResultView.markApplied(sourceItem);
            const group = alternativeGroups.find((candidate) => candidate.proposalIds.includes(sourceItem.proposal.id));
            if (group) proposalResultView.markAlternativeGroupExcluded(group.id, sourceItem.proposal.id);
          }
        });
      } catch (error) {
        if (error && typeof error === 'object' && !error.sourceModule) error.sourceModule = 'entry.js';
        console.error(`[assistant] ${error?.sourceModule || 'entry.js'}`, error);
        showError(error);
      }
    },
    onAnswerQuestions: async (proposal) => {
      const answers = await questionView.ask(proposal.questions, { submitLabel: '回答して案を再検討' });
      if (answers) {
        addHistoryMessage('user', typeof answers === 'string' ? answers : JSON.stringify(answers));
        await workflow.answerProposalQuestions(proposal.id, answers);
      }
    }
  });
  const workflowView = createWorkflowView(document.getElementById('assistant-results'), questionView, proposalResultView, {
    messages: document.getElementById('ai-chat-messages'),
    onError: showError,
    onAnswerQuestions: async (answers) => {
      addHistoryMessage('user', typeof answers === 'string' ? answers : JSON.stringify(answers));
      return workflow.answerQuestions(answers);
    }
  });
  workflow = createAssistantWorkflow({
    editor: window.classEditorAI,
    client,
    planningService,
    scopeApproval,
    budgetApproval,
    getSettings: () => ({ ...settings }),
    reportProgress: (detail) => dispatchChatEvent(CHAT_EVENTS.agentProgress, detail),
    reportUsage: ({ model, usage }) => dispatchChatEvent(CHAT_EVENTS.agentUsage, { model, usage }),
    onEvent: (event) => {
      workflowView.handle(event);
      if (event.type === 'state' && activeHistory && event.state?.counters) {
        activeHistory.workflowMemory = recordConversationUsage(activeHistory.workflowMemory, event.state.counters);
        publishHistory();
      } else if (event.type === 'job_checkpoint' && activeHistory) {
        activeHistory.workflowMemory = recordJobCheckpoint(activeHistory.workflowMemory, event.checkpoint);
        publishHistory();
      } else if (event.type === 'progress' && event.milestone && event.note) {
        addHistoryMessage('assistant', event.note);
      } else if (event.type === 'plan' && event.plan?.summary) {
        const planText = [event.plan.summary, ...(event.plan.unsupportedParts || []).map((part) =>
          `今回対応できない内容は「${part.description}」です。${part.reason}`)].join('\n\n');
        if (planText !== activePlanMessageText) addHistoryMessage('assistant', planText);
        activePlanMessageText = planText;
      } else if (event.type === 'questions') {
        const questions = (event.questions || []).map((question) => question.text).filter(Boolean);
        if (questions.length) addHistoryMessage('assistant', questions.join('\n'));
      } else if (event.type === 'unsupported') {
        // The complete supported/unsupported summary was recorded with the plan event.
      } else if (event.type === 'scope_blocked') {
        const message = event.scopeReason === 'approved_without_scope'
          ? '許可操作を受け取りましたが、許可対象を特定できず処理を保留しました。'
          : event.scopeReason === 'approved_scope_incomplete'
            ? '追加範囲の一部は許可されましたが、必要な範囲が不足しているため処理を保留しました。'
            : '追加範囲は許可されなかったため、依存する処理を保留しました。';
        addHistoryMessage('assistant', message);
      } else if (event.type === 'result') {
        const result = event.result;
        const stateById = new Map((window.classEditorAI?.getState?.().classes || []).map((item) => [item.id, item.label]));
        const operationNotes = (result?.proposals || []).flatMap((item) => (item.operations || []).map((operation) => {
          const label = (id) => stateById.get(id) || id || '不明';
          if (operation.type === 'moveClass') return `${label(operation.classId)} → ${label(operation.destinationId)}`;
          if (operation.type === 'renameClass') return `${label(operation.classId)} → ${operation.label}`;
          if (operation.type === 'addClass') return `${operation.label} を追加`;
          if (operation.type === 'deleteClass') return `${label(operation.classId)} を削除`;
          if (operation.type === 'promoteClass') return `${label(operation.classId)} を上位化`;
          return '';
        }).filter(Boolean));
        const operationSummary = operationNotes.length
          ? `変更候補${operationNotes.length}件: ${operationNotes.slice(0, 12).join('、')}${operationNotes.length > 12 ? '、ほか' : ''}` : '';
        const summaries = [result?.message, ...(result?.proposals || []).map((item) => item.proposal?.title || item.proposal?.summary), operationSummary]
          .filter((text) => typeof text === 'string' && text.trim());
        if (activeHistory && activeTurnStageIndex >= 0) {
          const hasPendingReview = (result?.proposals || []).some((item) => item.proposal?.questions?.length)
            || (result?.questions || []).length > 0;
          const workflowStatus = event.state?.status;
          const status = ['budget_exhausted', 'cancelled'].includes(workflowStatus) ? 'interrupted'
            : ['failed'].includes(workflowStatus) ? 'failed'
              : hasPendingReview || result?.jobPaused || ['needs_clarification', 'needs_scope_approval'].includes(workflowStatus)
                ? 'awaiting_user' : 'completed';
          activeHistory.workflowMemory = finishConversationStage(activeHistory.workflowMemory, activeTurnStageIndex, {
            status,
            summary: summaries.join('。 ').slice(0, 1600),
            dataVersion: activeTurnDataVersion
          });
          if (activeTurnFinalizingReorganization && status === 'completed') {
            activeHistory.workflowMemory = completeConversationMemory(activeHistory.workflowMemory);
          }
          activeTurnStageIndex = -1;
          activeTurnFinalizingReorganization = false;
          publishHistory();
        }
        if (summaries.length) addHistoryMessage('assistant', [...new Set(summaries)].join('\n'));
      } else if (event.type === 'error') {
        if (activeHistory && activeTurnStageIndex >= 0) {
          activeHistory.workflowMemory = finishConversationStage(activeHistory.workflowMemory, activeTurnStageIndex, {
            status: 'failed', summary: event.error?.message || '', dataVersion: activeTurnDataVersion
          });
          activeTurnStageIndex = -1;
          activeTurnFinalizingReorganization = false;
          publishHistory();
        }
        addHistoryMessage('assistant', event.error?.message || '処理中にエラーが発生しました。');
      } else if (event.type === 'proposal_applied') {
        addHistoryMessage('assistant', '変更案を適用しました。');
      }
    }
  });

  const requestInput = document.getElementById('ai-chat-input');
  const apiKeyInput = document.getElementById('ai-api-key');
  const modelSelect = document.getElementById('ai-model');
  const chatForm = document.getElementById('ai-chat-form');
  const promptExamplesRunningStages = new Set([
    'planning', 'retrieving', 'analyzing', 'validating'
  ]);
  window.addEventListener(CHAT_EVENTS.agentProgress, (event) => {
    chatForm?.classList.toggle('is-processing', promptExamplesRunningStages.has(event.detail?.stage));
  });
  let newSystemSubmitting = false;
  let activeRequestText = '';
  const sendButton = document.getElementById('ai-send');
  const setProcessingButton = (processing) => {
    chatForm?.setAttribute('aria-busy', String(processing));
    sendButton.disabled = false;
    sendButton.classList.toggle('is-cancel', processing);
    sendButton.textContent = processing ? '■' : '↑';
    sendButton.setAttribute('aria-label', processing ? '処理を中止' : '送信');
    sendButton.title = processing ? '処理を中止' : '送信';
  };
  const appendUserRequest = (text) => {
    const message = document.createElement('div');
    message.className = 'ai-message is-user';
    message.setAttribute('role', 'article');
    const author = document.createElement('strong');
    author.textContent = 'あなた';
    const body = document.createElement('div');
    body.className = 'ai-message-body';
    const content = document.createElement('p');
    content.textContent = text;
    body.append(content);
    message.append(author, body);
    messages.append(message);
    messages.scrollTop = messages.scrollHeight;
  };
  const expandSelectedHierarchy = (roots) => {
    const tree = window.classEditorAI?.getState?.();
    if (!tree || !Array.isArray(tree.classes) || !Array.isArray(tree.relations)) return [...new Set(roots || [])];
    const children = new Map();
    tree.relations.forEach(({ child, parent }) => {
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
    const available = new Set(tree.classes.map((item) => item.id));
    return [...found].filter((id) => available.has(id));
  };
  const restoreStoppedRequest = (request) => {
    const draft = requestInput.value.trim();
    requestInput.value = draft ? `${request}\n\n${draft}` : request;
    requestInput.dispatchEvent(new Event('input', { bubbles: true }));
    requestInput.focus();
  };
  const runNewSystem = async () => {
    if (newSystemSubmitting || workflow.isBusy()) {
      if (workflow.cancel() && activeRequestText) {
        restoreStoppedRequest(activeRequestText);
        activeRequestText = '';
      }
      return false;
    }
    if (!interactionDock.hidden) {
      statusElement.textContent = !interactionDock.hidden
        ? '表示中の確認に回答してから、次の依頼を送信してください。'
        : '処理中です。完了してから次の依頼を送信してください。';
      return false;
    }
    const request = requestInput.value.trim();
    if (!request) {
      showError('依頼内容を入力してください。');
      requestInput.focus();
      return false;
    }
    newSystemSubmitting = true;
    activeRequestText = request;
    activePlanMessageText = '';
    setProcessingButton(true);
    try {
      appendUserRequest(request);
      if (!activeHistory) activeHistory = {
        id: `agent-${globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`}`,
        title: request.replace(/\s+/g, ' ').slice(0, 80),
        updatedAt: Date.now(),
        selectedIds: [...(window.classEditorAI.selectedIds || [])],
        assistantMode: 'agent',
        workflowMemory: null,
        items: []
      };
      let previousMemory = activeHistory.workflowMemory;
      const currentDataVersion = window.classEditorAssistant?.getDataVersion?.() || '';
      const jobAction = getConversationJobAction(previousMemory, request, currentDataVersion);
      if (jobAction === 'stale' || jobAction === 'stale_stage') {
        activeHistory.workflowMemory = jobAction === 'stale'
          ? recordJobCheckpoint(activeHistory.workflowMemory, {
            ...previousMemory.job, status: 'stale', updatedAt: Date.now()
          })
          : finishConversationStage(previousMemory, previousMemory.stages.length - 1, {
            status: 'stale', dataVersion: currentDataVersion
          });
        addHistoryMessage('assistant', '作業データの版が保存時から変わっているため、保存済みジョブは続行できません。現在の対象範囲を確認し、新しい依頼として実行してください。');
        publishHistory();
        activeRequestText = '';
        requestInput.value = '';
        requestInput.dispatchEvent(new Event('input', { bubbles: true }));
        return true;
      }
      if (jobAction === 'new_task') {
        previousMemory = null;
        activeHistory.workflowMemory = null;
      }
      const resumeJob = jobAction === 'resume';
      const resumeStage = jobAction === 'resume_stage';
      const previousStage = previousMemory?.stages.at(-1) || null;
      const reorganizationTurn = previousMemory?.kind === 'classification_reorganization'
        || ['hierarchy_reorganization', 'hierarchy_deletion'].includes(previousMemory?.job?.kind)
        || detectReorganizationRequest(request);
      const finalizingReorganization = previousMemory?.kind === 'classification_reorganization'
        && isReorganizationFinalizationRequest(request);
      const visibleSelectedIds = [...(window.classEditorAI.selectedIds || [])];
      const scopeRoots = finalizingReorganization && previousMemory.rootIds.length
        ? [...new Set([...previousMemory.rootIds, ...visibleSelectedIds])]
        : (resumeJob || resumeStage) && previousMemory.rootIds.length ? previousMemory.rootIds : visibleSelectedIds;
      const selectedIds = resumeJob
        ? reorganizationTurn ? expandSelectedHierarchy(scopeRoots)
          : [...new Set([...(previousMemory.rootIds || []), ...previousMemory.job.scopeIds])]
        : resumeStage && !reorganizationTurn ? previousStage.selectedIds
        : reorganizationTurn ? expandSelectedHierarchy(scopeRoots) : visibleSelectedIds;
      const resumedReferenceIds = resumeJob && Array.isArray(previousMemory?.job?.metadata?.hierarchyIds)
        ? previousMemory.job.metadata.hierarchyIds : [];
      let priorContext = buildConversationContext(activeHistory.items, previousMemory, {
        currentDataVersion: window.classEditorAssistant?.getDataVersion?.() || ''
      });
      if (finalizingReorganization) priorContext = [priorContext,
        '利用者が再編結果の統合を求めています。作業メモの全完了段階を参照し、保存された分類方針を保って対象ルート全体を現在のクラスデータで再確認し、既存の提案形式で統合案を示してください。過去の会話は方針と進捗の根拠に限り、クラスの事実は必ず今回取得してください。'
      ].filter(Boolean).join('\n\n');
      const workflowRequest = resumeJob ? previousMemory.job.request : resumeStage ? previousStage.request : finalizingReorganization
        ? `${request}\n\n再編セッションの最終統合です。処理済み段階の希望と結果を踏まえ、対象ルート全体を現在のクラスデータで再確認して一貫した変更案を作成してください。現在の提案形式で提示し、編集データには適用しないでください。`
        : request;
      activeHistory.selectedIds = visibleSelectedIds;
      activeHistory.items.push({ type: 'message', role: 'user', text: request });
      trimHistoryItems();
      activeTurnDataVersion = window.classEditorAssistant?.getDataVersion?.() || '';
      const turn = beginConversationStage(activeHistory.workflowMemory, {
        request,
        selectedIds: scopeRoots,
        rootIds: scopeRoots,
        dataVersion: activeTurnDataVersion,
        kind: detectReorganizationRequest(request) ? 'classification_reorganization' : 'conversation'
      });
      activeHistory.workflowMemory = rememberConversationPolicy(turn.memory, request);
      activeTurnStageIndex = turn.stageIndex;
      activeTurnFinalizingReorganization = finalizingReorganization;
      publishHistory();
      requestInput.value = '';
      requestInput.dispatchEvent(new Event('input', { bubbles: true }));
      const outcome = await workflow.start({
        request: workflowRequest,
        continuationInput: resumeJob ? request : '',
        apiKey: apiKeyInput.value,
        model: modelSelect.value,
        conversationContext: priorContext,
        selectedClassIds: selectedIds,
        referenceClassIds: [...new Set([...resumedReferenceIds, ...(reorganizationTurn ? selectedIds : [])])],
        initialCounters: resumeJob || resumeStage || previousMemory?.kind === 'classification_reorganization' ? previousMemory.usage : null,
        jobCheckpoint: resumeJob ? previousMemory.job : null,
        referenceAllHierarchy: document.getElementById('ai-full-graph-scope')?.getAttribute('aria-checked') === 'true'
      });
      if (outcome?.status === 'cancelled' && activeTurnStageIndex >= 0) {
        activeHistory.workflowMemory = finishConversationStage(activeHistory.workflowMemory, activeTurnStageIndex, {
          status: 'interrupted', dataVersion: activeTurnDataVersion
        });
        activeTurnStageIndex = -1;
        activeTurnFinalizingReorganization = false;
        publishHistory();
      }
      if (outcome?.status === 'cancelled' && activeRequestText) {
        restoreStoppedRequest(activeRequestText);
        activeRequestText = '';
      }
      return true;
    } finally {
      newSystemSubmitting = false;
      activeRequestText = '';
      setProcessingButton(false);
    }
  };
  chatForm.addEventListener('submit', (event) => {
    if (!settings['chat.useNewSystem']) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    void runNewSystem().catch((error) => {
      if (error && typeof error === 'object' && !error.sourceModule) error.sourceModule = 'entry.js';
      console.error(`[assistant] ${error?.sourceModule || 'entry.js'}`, error);
      showError(error);
    });
  }, true);
  const restoredHistories = historyService.read(historyPersistenceEnabled());
  restoredHistories.forEach((record) => getAgentLegacyBridge()?.upsertHistory?.(record));
  window.addEventListener(CHAT_EVENTS.agentNewConversation, () => {
    activeHistory = null;
    activeTurnStageIndex = -1;
    activeTurnFinalizingReorganization = false;
  });
  window.addEventListener(CHAT_EVENTS.agentConversationActivated, (event) => {
    const record = historyService.read(historyPersistenceEnabled())
      .find((item) => item.id === event.detail?.conversationId);
    activeHistory = record || null;
    activeTurnStageIndex = -1;
    activeTurnFinalizingReorganization = false;
  });

  // Only counts and an internal data version cross this public boundary.
  window.classEditorAssistant = Object.freeze({
    getPlanningCounts: editorBridge.getCounts,
    getInstanceCount: editorBridge.getInstanceCount,
    buildPlanInput(request) {
      const counts = editorBridge.getCounts();
      const instanceCount = settings['instances.enabled'] ? editorBridge.getInstanceCount(window.classEditorAI.selectedIds) : undefined;
      return buildPlanInput(request, counts, { instanceCount });
    },
    createPlan({ apiKey, model, request, signal }) {
      const counts = editorBridge.getCounts();
      const instanceCount = settings['instances.enabled'] ? editorBridge.getInstanceCount(window.classEditorAI.selectedIds) : undefined;
      const planInput = buildPlanInput(request, counts, { instanceCount });
      const editorState = window.classEditorAI.getState();
      const instanceIds = (window.appData?.instanceData?.instances || []).map((item) => item.id);
      const maskedClient = createIdMaskedClient(client, createDataIdCodec(editorState.classes, instanceIds));
      return planningService.createPlan({ apiKey, model, planInput, signal, client: maskedClient });
    },
    getDataVersion: editorBridge.getDataVersion,
    requestScopeApproval: scopeApproval.request,
    getWorkflowState: workflow.getState,
    getSettings: () => ({ ...settings }),
    updateSetting(key, value) {
      updateSetting(key, value);
      return { ...settings };
    },
    reportProgress(detail) {
      dispatchChatEvent(CHAT_EVENTS.agentProgress, detail);
    }
  });
  window.addEventListener('pagehide', () => workflow.clearSecrets(), { once: true });
}
