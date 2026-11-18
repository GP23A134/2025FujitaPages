import { createEditorBridge } from './adapters/editor-bridge.js';
import { createProgressView } from './features/progress/progress-view.js?v=20261118-integration-events-v1';
import { buildPlanInput } from './features/planning/plan-input.js';
import { createOpenAIClient } from './adapters/openai-client.js';
import { createPlanningService } from './features/planning/planning-service.js?v=20261117-request-aware-prompts-v1';
import { createScopeApprovalView } from './features/scope-approval/scope-approval-view.js?v=20261116-stop-processing-v1';
import { createAssistantSettingsRegistry } from './settings/register-defaults.js';
import { createAssistantWorkflow } from './application/workflow.js?v=20261118-move-preflight-v1';
import { createQuestionView } from './features/planning/question-view.js?v=20261116-agent-interaction-dock-v2';
import { createWorkflowView } from './features/progress/workflow-view.js?v=20261118-agent-error-banner-v1';
import { createProposalResultView } from './features/proposals/proposal-result-view.js?v=20261118-preview-alternative-selection-v1';
import { createSettingsView } from './settings/settings-view.js?v=20261116-setting-errors-v1';
import { createHistoryService } from './conversations/history-service.js';
import { getAgentLegacyBridge } from '../integration/agent-legacy-bridge-registry.js?v=20261118-chat-bridge-registry-v1';
import { CHAT_EVENTS, dispatchChatEvent } from '../integration/chat-events.js?v=20261118-chat-events-v1';

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
  const requestProcessingPreflight = (estimate, signal) => new Promise((resolve) => {
    const dialog = document.getElementById('assistant-processing-preflight-dialog');
    const summary = document.getElementById('assistant-processing-preflight-summary');
    if (!dialog || !summary) { resolve(false); return; }
    if (signal?.aborted) { resolve(false); return; }
    const limitNotice = estimate.retrievalLimitExceeded
      ? ` 推定取得回数が設定上限（${estimate.retrievalLimit.toLocaleString('ja-JP')}回）を超えるため、この範囲では処理を開始できません。対象範囲を絞るか、開発者設定の取得呼び出し上限を見直してください。`
      : estimate.retrievalLimit
        ? ` 取得呼び出し上限は${estimate.retrievalLimit.toLocaleString('ja-JP')}回です。`
        : '';
    summary.textContent = `選択対象のクラス ${estimate.targetClassCount.toLocaleString('ja-JP')}件、参照する階層候補 ${estimate.hierarchyClassCount.toLocaleString('ja-JP')}件です。この後の移動案判定では、データ取得は最低${estimate.retrievalPages.toLocaleString('ja-JP')}ページ、AI応答は最低${estimate.minimumResponses.toLocaleString('ja-JP')}回を見込みます。${limitNotice}`;
    const continueButton = document.getElementById('assistant-processing-preflight-continue');
    if (continueButton) continueButton.disabled = Boolean(estimate.retrievalLimitExceeded);
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      signal?.removeEventListener('abort', onAbort);
      resolve(dialog.returnValue === 'continue');
    };
    const closeWith = (value) => { if (dialog.open) dialog.close(value); };
    const onAbort = () => closeWith('cancel');
    dialog.addEventListener('close', finish, { once: true });
    document.getElementById('assistant-processing-preflight-continue')?.addEventListener('click', () => closeWith('continue'), { once: true });
    document.getElementById('assistant-processing-preflight-cancel')?.addEventListener('click', () => closeWith('cancel'), { once: true });
    document.getElementById('assistant-processing-preflight-close')?.addEventListener('click', () => closeWith('cancel'), { once: true });
    signal?.addEventListener('abort', onAbort, { once: true });
    dialog.showModal();
  });
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
  const historyPersistenceEnabled = () => Boolean(settings['conversations.persistAcrossTabs']);
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
    publishHistory();
  };
  let proposalResultView;
  proposalResultView = createProposalResultView(messages, {
    onPreview: async (item, proposals, alternativeGroup, selectedAlternativeId) => {
      try {
        workflow.preparePreview(item);
        const bridge = getAgentLegacyBridge();
        if (!bridge?.previewProposal) throw new Error('提案プレビューを利用できません。');
        await bridge.previewProposal({
          item,
          proposals,
          alternativeGroup,
          selectedAlternativeId,
          onSelectAlternative: (groupId, proposalId) => {
            workflow.selectAlternative(groupId, proposalId);
            proposalResultView.selectAlternative(groupId, proposalId);
          },
          onDismiss: (sourceItem) => proposalResultView.markDismissed(sourceItem),
          onApply: (sourceItem, operationIndexes) => {
            workflow.applyProposal(sourceItem, operationIndexes);
            proposalResultView.markApplied(sourceItem);
            if (alternativeGroup) proposalResultView.markAlternativeGroupExcluded(alternativeGroup.id, sourceItem.proposal.id);
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
    requestProcessingPreflight,
    getSettings: () => ({ ...settings }),
    reportProgress: (detail) => dispatchChatEvent(CHAT_EVENTS.agentProgress, detail),
    reportUsage: ({ model, usage }) => dispatchChatEvent(CHAT_EVENTS.agentUsage, { model, usage }),
    onEvent: (event) => {
      workflowView.handle(event);
      if (event.type === 'progress' && event.milestone && event.note) {
        addHistoryMessage('assistant', event.note);
      } else if (event.type === 'plan' && event.plan?.summary) {
        addHistoryMessage('assistant', event.plan.summary);
      } else if (event.type === 'questions') {
        const questions = (event.questions || []).map((question) => question.text).filter(Boolean);
        if (questions.length) addHistoryMessage('assistant', questions.join('\n'));
      } else if (event.type === 'unsupported') {
        addHistoryMessage('assistant', event.plan?.unsupportedParts?.map((part) => part.reason).filter(Boolean).join('\n')
          || 'この依頼は現在の機能では対応できません。');
      } else if (event.type === 'scope_blocked') {
        addHistoryMessage('assistant', '続行に追加の範囲許可が必要です。');
      } else if (event.type === 'result') {
        const result = event.result;
        const summaries = [result?.message, ...(result?.proposals || []).map((item) => item.proposal?.title || item.proposal?.summary)]
          .filter((text) => typeof text === 'string' && text.trim());
        if (summaries.length) addHistoryMessage('assistant', [...new Set(summaries)].join('\n'));
      } else if (event.type === 'error') {
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
    setProcessingButton(true);
    try {
      appendUserRequest(request);
      activeHistory = {
        id: `agent-${globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`}`,
        title: request.replace(/\s+/g, ' ').slice(0, 80),
        updatedAt: Date.now(),
        selectedIds: [...(window.classEditorAI.selectedIds || [])],
        assistantMode: 'agent',
        items: [{ type: 'message', role: 'user', text: request }]
      };
      publishHistory();
      requestInput.value = '';
      requestInput.dispatchEvent(new Event('input', { bubbles: true }));
      const outcome = await workflow.start({
        request,
        apiKey: apiKeyInput.value,
        model: modelSelect.value,
        referenceAllHierarchy: document.getElementById('ai-full-graph-scope')?.getAttribute('aria-checked') === 'true'
      });
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
  historyService.read(historyPersistenceEnabled()).forEach((record) => getAgentLegacyBridge()?.upsertHistory?.(record));

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
      return planningService.createPlan({ apiKey, model, planInput, signal });
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
