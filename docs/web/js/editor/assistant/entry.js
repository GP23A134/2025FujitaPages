import { createEditorBridge } from './adapters/editor-bridge.js';
import { createProgressView } from './features/progress/progress-view.js';
import { buildPlanInput } from './features/planning/plan-input.js';
import { createOpenAIClient } from './adapters/openai-client.js';
import { createPlanningService } from './features/planning/planning-service.js';
import { createScopeApprovalView } from './features/scope-approval/scope-approval-view.js';
import { createAssistantSettingsRegistry } from './settings/register-defaults.js';
import { createAssistantWorkflow } from './application/workflow.js';
import { createQuestionView } from './features/planning/question-view.js';
import { createWorkflowView } from './features/progress/workflow-view.js';
import { createProposalResultView } from './features/proposals/proposal-result-view.js';
import { createProposalPreviewView } from './features/proposals/proposal-preview-view.js';
import { createSettingsView } from './settings/settings-view.js';
import { createSessionService } from './conversations/session-service.js';

const statusElement = document.getElementById('ai-status');
if (window.classEditorAI && statusElement) {
  const editorBridge = createEditorBridge();
  createProgressView(statusElement);
  const scopeApproval = createScopeApprovalView(document.getElementById('assistant-scope-dialog'), window.classEditorAI, {
    messages: document.getElementById('ai-chat-messages')
  });
  const questionView = createQuestionView(document.getElementById('assistant-question-dialog'));
  const settingsRegistry = createAssistantSettingsRegistry();
  const sessionService = createSessionService();
  const settingsStorageKey = 'classEditorAssistantDeveloperSettings-v1';
  let settings = settingsRegistry.defaults();
  try {
    const saved = JSON.parse(localStorage.getItem(settingsStorageKey) || '{}');
    const candidate = { ...settings, ...Object.fromEntries(settingsRegistry.list()
      .filter((item) => Object.hasOwn(saved, item.key)).map((item) => [item.key, saved[item.key]])) };
    if (settingsRegistry.validate(candidate).valid) settings = candidate;
  } catch { /* Use feature defaults when saved settings are unavailable or invalid. */ }
  const syncChatSystemChoice = () => {
    document.querySelectorAll('[name="ai-chat-system-mode"]').forEach((radio) => {
      radio.checked = (radio.value === 'agent') === Boolean(settings['chat.useNewSystem']);
    });
  };
  syncChatSystemChoice();
  const updateSetting = (key, value) => {
    if (!settingsRegistry.list().some((definition) => definition.key === key)) throw new Error(`未登録の開発者設定です: ${key}`);
    const candidate = { ...settings, [key]: value };
    const validation = settingsRegistry.validate(candidate);
    if (!validation.valid) throw new Error(validation.errors.join(' '));
    settings = candidate;
    try { localStorage.setItem(settingsStorageKey, JSON.stringify(settings)); } catch { /* Settings remain active for this page. */ }
    if (key === 'conversations.persistAcrossTabs') {
      const snapshot = workflow?.getPersistenceSnapshot?.();
      if (snapshot) sessionService.save(snapshot, Boolean(value));
      else if (!value) sessionService.clear();
    }
    if (workflow) workflow.updateDeveloperSettings({ ...settings }).catch((error) => {
      statusElement.textContent = error.message;
    });
    settingsView.refresh(settings);
    syncChatSystemChoice();
  };
  let settingsContainer = document.getElementById('assistant-developer-settings');
  if (!settingsContainer) {
    const settingsHost = document.querySelector('#test-settings-dialog .edit-settings-section')
      || document.getElementById('test-settings-dialog');
    if (settingsHost) {
      settingsContainer = document.createElement('div');
      settingsContainer.id = 'assistant-developer-settings';
      settingsContainer.className = 'assistant-developer-settings';
      settingsContainer.setAttribute('aria-label', '新AI処理の調整');
      settingsHost.append(settingsContainer);
      console.warn('[assistant] entry.js: 設定欄がHTMLにないため、開発者設定ダイアログに補完しました。');
    }
  }
  const settingsView = settingsContainer
    ? createSettingsView(settingsContainer, settingsRegistry, {
    getValue: (key) => settings[key],
    onChange: updateSetting
    })
    : Object.freeze({ refresh() {} });
  if (!settingsContainer) console.error('[assistant] entry.js: 開発者設定欄を作成できません。設定UIを初期化せず、チャットを継続します。');
  document.querySelectorAll('[name="ai-chat-system-mode"]').forEach((radio) => {
    radio.addEventListener('change', () => {
      if (radio.checked) updateSetting('chat.useNewSystem', radio.value === 'agent');
    });
  });
  const client = createOpenAIClient();
  const planningService = createPlanningService({
    client,
    getDeveloperSettings: () => ({
      instanceInformationEnabled: settings['instances.enabled'],
      targetClassRenameEnabled: settings['proposals.targetClassRenameEnabled']
    })
  });
  let workflow;
  let proposalResultView;
  const previewView = createProposalPreviewView(document.getElementById('assistant-proposal-dialog'), {
    onApply: async (item) => {
      workflow.applyProposal(item);
      proposalResultView.markApplied(item.proposal.id);
    }
  });
  proposalResultView = createProposalResultView(document.getElementById('assistant-results'), {
    onSelectAlternative: (groupId, proposalId) => workflow.selectAlternative(groupId, proposalId),
    onPreview: (item) => {
      const states = workflow.preparePreview(item);
      item.candidate = states.after;
      previewView.show(item, states.before, states.after);
    },
    onAnswerQuestions: async (proposal) => {
      const answers = await questionView.ask(proposal.questions, { submitLabel: '回答して案を再検討' });
      if (answers) await workflow.answerProposalQuestions(proposal.id, answers);
    },
    onFinishReview: () => workflow.finishReview()
  });
  const workflowView = createWorkflowView(document.getElementById('assistant-results'), questionView, proposalResultView, {
    messages: document.getElementById('ai-chat-messages'),
    onAnswerQuestions: (answers) => workflow.answerQuestions(answers)
  });
  workflow = createAssistantWorkflow({
    editor: window.classEditorAI,
    client,
    planningService,
    scopeApproval,
    getSettings: () => ({ ...settings }),
    reportProgress: (detail) => window.dispatchEvent(new CustomEvent('assistant:progress', { detail })),
    reportUsage: ({ model, usage }) => window.dispatchEvent(new CustomEvent('assistant-api-usage', { detail: { model, usage } })),
    onEvent: (event) => {
      workflowView.handle(event);
      const snapshot = workflow?.getPersistenceSnapshot?.();
      if (snapshot) {
        const pending = !['completed', 'cancelled', 'failed', 'scope_denied'].includes(snapshot.state.status);
        if (pending) sessionService.save(snapshot, Boolean(settings['conversations.persistAcrossTabs']));
        else sessionService.clear();
      }
      if (event.type === 'resume_requires_replan') statusElement.textContent = event.reason;
    }
  });

  const resumeButton = document.getElementById('assistant-resume');
  const requestInput = document.getElementById('ai-chat-input');
  const apiKeyInput = document.getElementById('ai-api-key');
  const modelSelect = document.getElementById('ai-model');
  const chatForm = document.getElementById('ai-chat-form');
  const promptExamplesRunningStages = new Set([
    'planning', 'retrieving', 'analyzing', 'validating',
    'waiting_for_scope_approval', 'waiting_for_answer'
  ]);
  window.addEventListener('assistant:progress', (event) => {
    chatForm?.classList.toggle('is-processing', promptExamplesRunningStages.has(event.detail?.stage));
  });
  let newSystemSubmitting = false;
  const runNewSystem = async () => {
    if (newSystemSubmitting) return false;
    const request = requestInput.value.trim();
    if (!request) {
      statusElement.textContent = '依頼内容を入力してください。';
      requestInput.focus();
      return false;
    }
    newSystemSubmitting = true;
    const sendButton = document.getElementById('ai-send');
    const wasSendDisabled = sendButton.disabled;
    sendButton.disabled = true;
    try {
      await workflow.start({
        request,
        apiKey: apiKeyInput.value,
        model: modelSelect.value,
        referenceAllHierarchy: document.getElementById('ai-full-graph-scope')?.getAttribute('aria-checked') === 'true'
      });
      return true;
    } finally {
      newSystemSubmitting = false;
      sendButton.disabled = wasSendDisabled;
    }
  };
  chatForm.addEventListener('submit', (event) => {
    if (!settings['chat.useNewSystem']) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    void runNewSystem().catch((error) => {
      if (error && typeof error === 'object' && !error.sourceModule) error.sourceModule = 'entry.js';
      console.error(`[assistant] ${error?.sourceModule || 'entry.js'}`, error);
      statusElement.textContent = error.message;
    });
  }, true);
  const savedSession = sessionService.read(Boolean(settings['conversations.persistAcrossTabs']));
  resumeButton.hidden = !savedSession;
  resumeButton.addEventListener('click', async () => {
    const saved = sessionService.read(Boolean(settings['conversations.persistAcrossTabs']));
    if (!saved) { resumeButton.hidden = true; return; }
    resumeButton.disabled = true;
    try {
      const resumed = await workflow.resume(saved, { apiKey: apiKeyInput.value, model: modelSelect.value });
      resumeButton.hidden = !resumed.requiresCredentials;
      requestInput.value = saved.state.request;
    } catch (error) {
      if (error && typeof error === 'object' && !error.sourceModule) error.sourceModule = 'entry.js';
      console.error(`[assistant] ${error?.sourceModule || 'entry.js'}`, error);
      statusElement.textContent = error.message;
    } finally { resumeButton.disabled = false; }
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
      window.dispatchEvent(new CustomEvent('assistant:progress', { detail }));
    }
  });
  window.addEventListener('pagehide', () => workflow.clearSecrets(), { once: true });
}
