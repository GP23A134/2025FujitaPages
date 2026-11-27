// 移行中のチャット画面ホストです。履歴表示、旧プレビュー画面、新AIとの互換接続を担当します。
// AI依頼の計画・通信・実行は agent/entry.js と agent/application/workflow.js が担当します。
import { filterPromptExamples } from './prompt-examples.js?v=20261126-prompt-conversation-flow-v1';
import { createResponseHandler } from '../domain/proposals/proposal-engine.js?v=20261126-shared-proposal-engine-v1';
import { createConversationStore } from './conversation/conversation-store.js?v=20261126-legacy-history-store-v1';
import { createConversationView } from './conversation/conversation-view.js?v=20261126-conversation-view-v1';
import { createProposalPreview } from '../agent/features/proposals/proposal-preview.js?v=20261127-preview-fixed-navigation-v1';
import { createRequestProgress } from './proposals/request-progress.js?v=20261112-zero-second-display-v1';
import { createProposalPreviewController } from './proposals/proposal-preview-controller.js?v=20261126-preview-controller-v1';
import { createProposalFormatters } from './proposals/proposal-formatters.js?v=20261126-proposal-formatters-v1';
import { reconcilePendingProposalAdditions } from '../domain/proposals/proposal-history-reconciler.js?v=20261126-proposal-history-reconciler-v1';
import { createProposalView } from './proposals/proposal-view.js?v=20261112-conflict-alternatives-v1';
import { createConversationRenderer } from './conversation/conversation-renderer.js?v=20261111-ai-chat-renderer-v1';
import { createChatUiBridge } from '../integration/chat-ui-bridge.js?v=20261126-typed-run-notices-v1';
import { registerChatUiBridge } from '../integration/chat-ui-bridge-registry.js?v=20261126-chat-ui-bridge-v1';
import { CHAT_EVENTS } from '../integration/chat-events.js?v=20261124-conversation-context-v1';

(() => {
  const editor = window.classEditorAI;
  if (!editor) return;
  const logAiProblem = (stage, error, level = 'error', context = {}) => {
    if (error?.name === 'AbortError') return;
    const detail = {
      name: error?.name || 'Error',
      message: error?.message || String(error || '原因不明のエラー')
    };
    if (error?.stack) detail.stack = error.stack;
    Object.assign(detail, context);
    console[level](`[AIチャット] ${stage}`, detail);
  };
  window.addEventListener('error', (event) => {
    if (!event.filename?.includes('/web/js/editor/chat/')) return;
    logAiProblem(`未処理の実行時エラー (${event.filename}:${event.lineno || 0}:${event.colno || 0})`, event.error || event.message);
  });
  window.addEventListener('unhandledrejection', (event) => {
    logAiProblem('未処理の非同期エラー', event.reason);
  });
  const yieldToBrowser = () => new Promise((resolve) => window.setTimeout(resolve, 0));

  const MAX_CACHED_SPLIT_SUMMARY_CHARACTERS = 24000;
  const MAX_CACHED_SPLIT_FOLLOWUP_CHARACTERS = 8000;
  const MAX_CACHED_SPLIT_CHUNK_CHARACTERS = 450000;
  const boundSplitChunkCache = (entries) => {
    const bounded = [];
    let size = 0;
    for (const entry of [...entries].reverse()) {
      const serialized = JSON.stringify(entry);
      if (size + serialized.length > MAX_CACHED_SPLIT_CHUNK_CHARACTERS) continue;
      bounded.unshift(entry);
      size += serialized.length;
      if (bounded.length >= 120) break;
    }
    return bounded;
  };
  // ここでの上限はAPIスキーマの上限です。応答トークンの上限は依頼種別ごとに別途設定します。
  const AI_OUTPUT_LIMITS = { proposals: 30, questions: 3, operationsPerProposal: 40, uncertaintiesPerProposal: 5,
    chunkFindingsPerCategory: 3, comparisonFindingsPerCategory: 8 };
  let refreshResponseOutputLimits = () => {};
  const keyInput = document.getElementById('ai-api-key');
  try { localStorage.removeItem('fujita.ai-api-key-v1'); } catch { /* Remove any key saved by an earlier build. */ }
  const fullGraphScopeToggle = document.getElementById('ai-full-graph-scope');
  const settingsDialog = document.getElementById('ai-chat-settings-dialog');
  const keyGuidance = document.getElementById('ai-key-guidance');
  const updateKeyGuidance = () => { keyGuidance.hidden = Boolean(keyInput.value.trim()); };
  updateKeyGuidance();
  keyInput.addEventListener('input', () => {
    updateKeyGuidance();
  });
  document.getElementById('ai-open-settings').addEventListener('click', () => {
    settingsDialog.showModal();
    keyInput.focus();
  });
  document.getElementById('close-ai-chat-settings').addEventListener('click', () => settingsDialog.close());
  settingsDialog.addEventListener('click', (event) => {
    if (event.target === settingsDialog) settingsDialog.close();
  });
  const modelSelect = document.getElementById('ai-model');
  const settingsStatus = document.getElementById('ai-settings-status');
  const currentModelLabel = document.getElementById('ai-current-model');
  let modelConfig = null;
  const updateCurrentModelLabel = () => {
    const selected = modelConfig?.models.find((item) => item.id === modelSelect.value);
    currentModelLabel.textContent = selected ? `使用モデル：${selected.label || selected.id}` : 'モデル未選択';
    currentModelLabel.title = selected
      ? [`使用モデル：${selected.label || selected.id}`, selected.description].filter(Boolean).join('\n')
      : 'モデル未選択';
  };
  // AI requests use the agent chat. This module remains for conversation,
  // history and proposal-preview UI integration.
  const systemPromptPromise = Promise.resolve('');
  const proposalFreedomPromptPromise = () => Promise.resolve('');
  const evaluationPromptPromise = Promise.resolve('');
  const synthesisPromptPromise = Promise.resolve('');
  const modelConfigPromise = fetch('web/data/config/ai-models.json', { cache: 'no-store' })
    .then((response) => { if (!response.ok) throw new Error('モデル設定ファイルを読み込めません。'); return response.json(); })
    .then((config) => {
      if (!Array.isArray(config.models) || !config.models.length || !config.models.some((item) => item.id === config.defaultModel)) {
        throw new Error('モデル設定ファイルの形式が正しくありません。');
      }
      modelConfig = config;
      modelSelect.replaceChildren(...config.models.map((item) => {
        const option = document.createElement('option');
        option.value = item.id;
        option.textContent = item.label || item.id;
        if (item.description) option.title = item.description;
        return option;
      }));
      modelSelect.value = config.defaultModel;
      updateCurrentModelLabel();
      const selected = config.models.find((item) => item.id === config.defaultModel);
      if (selected?.description) document.getElementById('ai-model-description').textContent = selected.description;
      window.dispatchEvent(new CustomEvent('class-editor-model-capabilities-change', {
        detail: { maxOutputTokens: selected?.maxOutputTokens || 128000 }
      }));
      return config;
    })
    .catch((error) => {
      logAiProblem('モデル設定の読み込み', error);
      modelSelect.disabled = true;
      updateCurrentModelLabel();
      settingsStatus.textContent = `${error.message}。AI補助を利用できません。`;
      settingsStatus.classList.add('is-error');
      return null;
    });
  modelSelect.addEventListener('change', () => {
    const selected = modelConfig?.models.find((item) => item.id === modelSelect.value);
    document.getElementById('ai-model-description').textContent = selected?.description || '選択したモデルを次の依頼から使用します。';
    updateCurrentModelLabel();
    window.dispatchEvent(new CustomEvent('class-editor-model-capabilities-change', {
      detail: { maxOutputTokens: selected?.maxOutputTokens || 128000 }
    }));
  });
  const messages = document.getElementById('ai-chat-messages');
  const status = document.getElementById('ai-status');
  const textInput = document.getElementById('ai-chat-input');
  const promptExamplesList = document.getElementById('ai-prompt-examples-list');
  const promptExamplesById = new Map();
  let currentConversation = null;
  let promptHistoryHasAssistantReply = false;
  const readAiTuningValue = (key, fallback, minimum, maximum) => {
    try {
      const saved = JSON.parse(localStorage.getItem('classEditorTestPreferences') || '{}');
      const value = Number(saved[key]);
      if (Number.isInteger(value) && value >= minimum && value <= maximum) return value;
    } catch {}
    return fallback;
  };
  const isFullGraphScopeEnabled = () => fullGraphScopeToggle.getAttribute('aria-checked') === 'true';
  const defaultPromptExamples = [
    { id: 'common-summary', category: '相談を始める', title: '選択範囲を要約', prompt: '選択範囲に含まれるクラスを要約してください。上位・中間・対象クラスのまとまりや分類の特徴を説明し、入力から判断できないことは推測で補わないでください。', showWhen: { always: true } },
    { id: 'hierarchy-evaluate-conversation', category: '相談を始める', title: '選択範囲を評価', prompt: '選択範囲の上位クラスを中心に、配下の中間クラスと対象クラスを確認し、役割分担・重複・分類の抜けを評価してください。根拠となるクラス名と親子関係を挙げて説明してください。まずは評価にとどめて変更案を作らず、次に検討する判断があれば質問してください。入力から分からないことは推測で補わないでください。', showWhen: { always: true } },
    { id: 'common-classification-check', category: '相談を始める', title: '分類先を見直す', prompt: '選択範囲のクラス名と現在の親子関係を確認し、既存の分類先を使って分類先を見直してください。まず相談として、役割のずれや重なり、移動を検討できるクラス・移動先・理由を示してください。名称や階層だけでは判断できない候補は不確かさと保留理由を説明してください。この最初の返答では実行用の変更案や操作を作らず、編集データも変更しないでください。最後に、どの候補を変更案にするか利用者に尋ねてください。後続の依頼では、会話で利用者が合意した候補だけを対象に、現在の親子関係を再確認して変更案を作成してください。合意が曖昧な候補は含めず、必要な点を質問してください。', showWhen: { always: true } },
    { id: 'common-similar-classes', category: '相談を始める', title: '似た役割のクラスを探す', prompt: '選択範囲のクラス名と現在の親子関係を比べ、役割が似ているクラスや重なりの可能性がある組を示してください。似ている根拠と違いを説明し、名前が似ているだけで同じ意味だと決めつけないでください。', showWhen: { always: true } },
    { id: 'common-next-review', category: '相談を始める', title: '次に見直す点を整理', prompt: '選択範囲を確認し、根拠から分かったことと判断できないことを分けて整理してください。そのうえで、次に確認するとよい論点を優先度順に示してください。編集案は作らず、入力にない情報は推測で補わないでください。', showWhen: { always: true } }
  ];
  let availablePromptExamples = defaultPromptExamples;
  let lastRenderedPromptExamples = null;
  let lastPromptExampleContext = '';
  const renderPromptExamples = (examples = availablePromptExamples, options = {}) => {
    if (typeof options.priorAssistantReply === 'boolean') promptHistoryHasAssistantReply = options.priorAssistantReply;
    const state = editor.getState();
    const selectedIds = editor.selectedIds;
    const classesById = new Map(state.classes.map((item) => [item.id, item]));
    const parentByChild = new Map(state.relations.map(({ child, parent }) => [child, parent]));
    const selectionRoots = editor.getScopedState(selectedIds).selectionRoots || selectedIds;
    const selectedClasses = selectionRoots.map((id) => classesById.get(id)).filter(Boolean);
    const selectedTypes = new Set(selectedClasses.map((item) => item.type === 'class' ? 'target' : item.type));
    const selectedParents = new Set(selectionRoots.map((id) => parentByChild.get(id) ?? null));
    const unclassifiedId = state.classes.find((item) => item.type === 'top' && item.label === '未分類')?.id;
    const belongsToUnclassified = (id) => {
      const seen = new Set();
      let currentId = id;
      while (currentId && !seen.has(currentId)) {
        if (currentId === unclassifiedId) return true;
        seen.add(currentId);
        currentId = parentByChild.get(currentId);
      }
      return false;
    };
    const context = {
      selectedCount: selectionRoots.length,
      selectedTypes,
      differentParents: selectedParents.size > 1,
      unclassifiedSelected: Boolean(unclassifiedId && selectionRoots.some(belongsToUnclassified)),
      fullGraph: isFullGraphScopeEnabled(),
      priorAssistantReply: promptHistoryHasAssistantReply,
      isolatedParentWithMultipleChildren: (() => {
        if (selectionRoots.length !== 1 || !['top', 'middle'].includes(selectedClasses[0]?.type)
          || selectedClasses[0].label === '未分類') return false;
        const selectedParent = selectedClasses[0];
        const parentId = parentByChild.get(selectedParent.id) ?? null;
        const hasPeer = state.classes.some((item) => item.type === selectedParent.type && item.id !== selectedParent.id
          && item.label !== '未分類' && (parentByChild.get(item.id) ?? null) === parentId);
        if (hasPeer) return false;
        const childType = selectedParent.type === 'top' ? 'middle' : 'class';
        const children = state.relations.filter(({ child, parent }) => parent === selectedParent.id
          && classesById.get(child)?.type === childType).length;
        return children >= 2;
      })()
    };
    const contextKey = JSON.stringify({
      selectedCount: context.selectedCount,
      selectedTypes: [...context.selectedTypes].sort(),
      differentParents: context.differentParents,
      unclassifiedSelected: context.unclassifiedSelected,
      fullGraph: context.fullGraph,
      priorAssistantReply: context.priorAssistantReply,
      isolatedParentWithMultipleChildren: context.isolatedParentWithMultipleChildren
    });
    if (lastRenderedPromptExamples === examples && lastPromptExampleContext === contextKey) return;
    promptExamplesById.clear();
    const groupedExamples = new Map();
    filterPromptExamples(examples, context).forEach((example) => {
      if (!example || typeof example.id !== 'string' || typeof example.title !== 'string'
        || typeof example.prompt !== 'string' || !example.id.trim() || !example.title.trim() || !example.prompt.trim()) return;
      const category = typeof example.category === 'string' && example.category.trim() ? example.category : 'その他';
      if (!groupedExamples.has(category)) groupedExamples.set(category, []);
      groupedExamples.get(category).push(example);
    });
    const fragment = document.createDocumentFragment();
    groupedExamples.forEach((categoryExamples, category) => {
      const group = document.createElement('div');
      group.className = 'ai-prompt-example-group';
      const label = document.createElement('span');
      label.className = 'ai-prompt-example-category';
      label.textContent = category;
      group.append(label);
      categoryExamples.forEach((example) => {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'ai-prompt-example';
        button.dataset.promptExample = example.id;
        button.textContent = example.title;
        promptExamplesById.set(example.id, example.prompt);
        group.append(button);
      });
      fragment.append(group);
    });
    promptExamplesList.replaceChildren(fragment);
    lastRenderedPromptExamples = examples;
    lastPromptExampleContext = contextKey;
  };
  renderPromptExamples(defaultPromptExamples);
  fetch(new URL('../../../../data/config/ai-prompt-examples.json', import.meta.url), { cache: 'no-store' })
    .then((response) => {
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return response.json();
    })
    .then((examples) => {
      if (!Array.isArray(examples)) throw new Error('Invalid prompt examples format');
      availablePromptExamples = examples;
      renderPromptExamples();
    })
    .catch((error) => {
      console.warn('[AIチャット] プロンプト例を読み込めませんでした', error);
    });
  promptExamplesList.addEventListener('click', (event) => {
    const button = event.target.closest('[data-prompt-example]');
    const prompt = promptExamplesById.get(button?.dataset.promptExample);
    if (!prompt) return;
    textInput.value = prompt;
    textInput.dispatchEvent(new Event('input', { bubbles: true }));
    textInput.focus();
  });
  const updateScopePlaceholder = () => {
    textInput.placeholder = isFullGraphScopeEnabled()
      ? '全上位・中間クラスの構造について相談'
      : '保持欄で選択したクラスについて相談';
  };
  fullGraphScopeToggle.addEventListener('click', () => {
    fullGraphScopeToggle.setAttribute('aria-checked', String(!isFullGraphScopeEnabled()));
    renderPromptExamples();
    updateScopePlaceholder();
  });
  updateScopePlaceholder();
  const resizeChatInput = () => {
    textInput.style.height = 'auto';
    const maxHeight = 160;
    textInput.style.height = `${Math.min(textInput.scrollHeight, maxHeight)}px`;
    textInput.style.overflowY = textInput.scrollHeight > maxHeight ? 'auto' : 'hidden';
  };
  textInput.addEventListener('input', resizeChatInput);
  resizeChatInput();
  const previewDialog = document.getElementById('ai-preview-dialog');
  const historyButton = document.getElementById('ai-show-history');
  const historyPopover = document.getElementById('ai-history-popover');
  const historyList = document.getElementById('ai-history-list');
  document.getElementById('ai-chat-settings').addEventListener('click', () => {
    historyPopover.hidden = true;
    historyButton.setAttribute('aria-expanded', 'false');
    settingsDialog.showModal();
  });
  const usageSummary = document.getElementById('ai-usage-summary');
  const conversations = [];
  const savedConversationsKey = 'fujita.ai-saved-conversations-v1';
  const conversationStore = createConversationStore({
    conversations,
    savedConversationsKey,
    boundSplitChunkCache,
    MAX_CACHED_SPLIT_SUMMARY_CHARACTERS,
    MAX_CACHED_SPLIT_FOLLOWUP_CHARACTERS,
    logProblem: logAiProblem
  });
  conversations.push(...conversationStore.restoreSavedConversations());
  const persistSavedConversations = () => conversationStore.persistSavedConversations();
  const sessionUsage = { requests: 0, inputTokens: 0, outputTokens: 0, costUsd: 0, costKnown: true };
  try {
    localStorage.removeItem('fujita.ai-audit-log-v1');
    localStorage.removeItem('fujita.ai-audit-actor-v1');
  } catch {}
  let editorAssistantHost = null;
  let closePreview = () => {};
  let proposalPreview = null;
  let proposalView = null;
  let conversationRenderer = null;
  const requestProgress = createRequestProgress({ messages, getCurrentConversation: () => currentConversation });
  let sourceDataVersion = '';
  let classLabelsById = new Map();
  let classTypesById = new Map();
  let temporaryLabelsById = new Map();
  let sourceDataVersionPromise = null;

  const createConversation = (selectedIds = editor.selectedIds) => {
    const conversation = {
      id: `chat-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      title: '新しい相談',
      titleIsCustom: false,
      updatedAt: Date.now(),
      selectedIds: [...selectedIds],
      responseId: '',
      initialSnapshotSent: false,
      previousScope: null,
      localContext: '',
      splitMemory: null,
      responseMode: 'proposal',
      items: [],
      status: '',
      workflowStatus: '',
      usage: { requests: 0, inputTokens: 0, outputTokens: 0, costUsd: 0, costKnown: true },
      saved: false,
      restoredFromStorage: false
    };
    conversations.unshift(conversation);
    return conversation;
  };
  currentConversation = createConversation();

  const formatUsd = (value) => `$${Number(value || 0).toFixed(6)}`;
  const selectedModelPricing = (modelId = modelSelect.value) => modelConfig?.models.find((item) => item.id === modelId);
  const updateUsageSummary = () => {
    if (!usageSummary) return;
    const sessionCost = sessionUsage.requests ? formatUsd(sessionUsage.costUsd) : '$0.000000';
    const label = document.createElement('span');
    label.className = 'ai-usage-label';
    label.textContent = '合計';
    const amount = document.createElement('strong');
    amount.className = 'ai-usage-cost';
    amount.textContent = sessionUsage.costKnown ? sessionCost : '料金不明';
    const details = document.createElement('span');
    details.className = 'ai-usage-detail';
    details.textContent = `入力 ${sessionUsage.inputTokens.toLocaleString()} / 出力 ${sessionUsage.outputTokens.toLocaleString()} tokens`;
    const requests = document.createElement('span');
    requests.className = 'ai-usage-requests';
    requests.textContent = `送信 ${sessionUsage.requests}回`;
    usageSummary.replaceChildren(label, amount, details, requests);
  };
  const recordUsage = (responseBody, { modelId = modelSelect.value, includeConversation = true } = {}) => {
    const usage = responseBody?.usage;
    if (!usage || !Number.isFinite(usage.input_tokens) || !Number.isFinite(usage.output_tokens)) return;
    const rates = selectedModelPricing(modelId);
    const inputTokens = usage.input_tokens;
    const outputTokens = usage.output_tokens;
    const inputDetails = usage.input_tokens_details || {};
    const cachedTokens = Math.min(inputTokens, Number(inputDetails.cached_tokens || 0));
    const cacheWriteTokens = Math.min(inputTokens - cachedTokens, Number(inputDetails.cache_write_tokens || 0));
    const ratesAvailable = rates?.pricingVerified === true
      && Number.isFinite(rates.inputUsdPerMillion) && Number.isFinite(rates.outputUsdPerMillion)
      && Number.isFinite(rates.cachedInputUsdPerMillion) && Number.isFinite(rates.cacheWriteUsdPerMillion);
    const costUsd = ratesAvailable
      ? ((inputTokens - cachedTokens - cacheWriteTokens) * rates.inputUsdPerMillion
        + cachedTokens * (rates.cachedInputUsdPerMillion ?? rates.inputUsdPerMillion)
        + cacheWriteTokens * rates.cacheWriteUsdPerMillion
        + outputTokens * rates.outputUsdPerMillion) / 1_000_000
      : 0;
    const totals = includeConversation ? [currentConversation?.usage, sessionUsage] : [sessionUsage];
    totals.filter(Boolean).forEach((total) => {
      total.requests += 1;
      total.inputTokens += inputTokens;
      total.outputTokens += outputTokens;
      total.costUsd += costUsd;
      if (!ratesAvailable) total.costKnown = false;
    });
    updateUsageSummary();
  };
  window.addEventListener(CHAT_EVENTS.agentUsage, (event) => {
    const { model, usage } = event.detail || {};
    void modelConfigPromise.then(() => recordUsage({ usage }, { modelId: model, includeConversation: false }));
  });
  const setStatus = (text, kind = '') => {
    status.textContent = text;
    status.className = `ai-status${kind ? ` is-${kind}` : ''}`;
    if (currentConversation) currentConversation.status = text;
  };  const appendSettingsLink = () => {
    status.append(document.createTextNode(' '));
    const link = document.createElement('button');
    link.type = 'button';
    link.className = 'ai-settings-inline-link';
    link.textContent = 'AI設定へ';
    link.addEventListener('click', () => {
      settingsDialog.showModal();
      keyInput.focus();
    });
    status.append(link);
  };
  const makeMessage = (role, text) => {
    const item = { type: 'message', role, text };
    currentConversation.items.push(item);
    currentConversation.updatedAt = Date.now();
    renderConversation();
    return item;
  };
  const conversationView = createConversationView({
    messages,
    historyList,
    getConversations: () => conversations,
    getCurrentConversation: () => currentConversation,
    isSending: () => document.getElementById('ai-chat-form')?.getAttribute('aria-busy') === 'true',
    activateConversation: (conversation) => activateConversation(conversation),
    persistSavedConversations,
    setStatus
  });
  const renderMessage = (item) => conversationView.renderMessage(item);
  const updateHistoryList = () => conversationView.updateHistoryList();
  const renderConversation = (options = {}) => conversationRenderer.render(options);
  const activateConversation = (conversation) => {
    if (document.getElementById('ai-chat-form')?.getAttribute('aria-busy') === 'true' || !conversation) return;
    currentConversation = conversation;
    if (conversation.assistantMode === 'agent') {
      window.dispatchEvent(new CustomEvent(CHAT_EVENTS.agentConversationActivated, { detail: { conversationId: conversation.id } }));
    }
    editor.setSelectedIds(conversation.selectedIds);
    if (conversation.restoredFromStorage && conversation.assistantMode !== 'agent') {
      conversation.localContext = summarizeVisibleConversation(conversation);
      conversation.restoredFromStorage = false;
      conversation.status = '保存済み相談を再開しました。次の依頼には現在のクラス情報を使います。以前の変更案は適用できません。';
    }
    historyPopover.hidden = true;
    historyButton.setAttribute('aria-expanded', 'false');
    renderConversation();
  };
  const refreshConversationTitle = (conversation) => {
    if (conversation.titleIsCustom) return;
    const firstRequest = conversation.items.find((item) => item.type === 'message' && item.role === 'user');
    if (!firstRequest) return;
    const normalized = firstRequest.text.replace(/\s+/g, ' ').trim();
    conversation.title = normalized.length > 32 ? `${normalized.slice(0, 32)}…` : normalized;
    conversation.updatedAt = Date.now();
    updateHistoryList();
  };
  const stableState = () => {
    const state = editor.getState();
    return {
      classes: state.classes.map(({ id, type, label }) => ({ id, type, label })),
      relations: state.relations.map(({ child, parent }) => ({ child, parent }))
    };
  };
  const stateFingerprint = () => JSON.stringify(stableState());
  const digest = async (value) => {
    if (!globalThis.crypto?.subtle) throw new Error('安全なデータ版を作れません。HTTPSまたはlocalhostで編集画面を開いてください。');
    const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
    return [...new Uint8Array(bytes)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
  };
  const currentDataHash = async () => digest(JSON.stringify({ version: sourceDataVersion, state: stableState() }));
  const fetchPublishedDataVersion = async () => {
    const response = await fetch('web/data/generated/class-data.js', { cache: 'no-store' });
    if (!response.ok) throw new Error('クラスデータの版情報を確認できません。');
    const source = await response.text();
    const match = source.match(/"classDataVersion"\s*:\s*"([a-f0-9]{64})"/i);
    if (!match) throw new Error('クラスデータの版情報を取得できません。');
    return match[1];
  };
  const verifyLoadedDataVersion = async () => {
    if (sourceDataVersionPromise) await sourceDataVersionPromise;
    if (window.appData?.workspaceMeta?.kind === 'uploaded') return;
    const latest = await fetchPublishedDataVersion();
    if (!latest || !sourceDataVersion) throw new Error('クラスデータの版情報を取得できません。');
    if (latest !== sourceDataVersion) throw new Error('編集画面を開いた後にデータ版が更新されています。ページを再読み込みしてから依頼してください。');
  };
  const normalizeQuestionForDeduplication = (value) => String(value || '')
    .normalize('NFKC')
    .toLocaleLowerCase('ja-JP')
    .replace(/[\s\p{P}\p{S}]/gu, '')
    .replace(/(?:について)?(?:教えてください|教えて下さい|お聞かせください|でしょうか|ですか|ますか|ください)$/u, '');
  const questionSimilarity = (left, right) => {
    const grams = (value) => new Set(value.length < 3 ? [value] : Array.from({ length: value.length - 2 }, (_, index) => value.slice(index, index + 3)));
    const leftGrams = grams(left);
    const rightGrams = grams(right);
    let common = 0;
    leftGrams.forEach((gram) => { if (rightGrams.has(gram)) common += 1; });
    return (2 * common) / (leftGrams.size + rightGrams.size || 1);
  };
  const deduplicateQuestions = (questions) => {
    const unique = [];
    const normalized = [];
    (questions || []).forEach((question) => {
      if (typeof question !== 'string' || !question.trim()) return;
      const key = normalizeQuestionForDeduplication(question);
      if (normalized.some((existing) => existing === key
        || (Math.min(existing.length, key.length) >= 10 && questionSimilarity(existing, key) >= 0.88))) return;
      normalized.push(key);
      unique.push(question.trim());
    });
    return unique;
  };
  const labelFor = (id) => temporaryLabelsById.get(id) || classLabelsById.get(id) || id || '未指定';
  const { operationLabel, renderOperationCountBadges, excerpt } = createProposalFormatters({
    labelFor,
    getClassType: (id) => classTypesById.get(id)
  });  const renderPreviewTypeLegend = (operations) => {
    const badges = renderOperationCountBadges(operations, 'ai-preview-type-legend-item');
    badges.forEach((badge) => badge.setAttribute('role', 'listitem'));
    document.getElementById('ai-preview-type-legend').replaceChildren(
      ...badges
    );
  };
  const reportPreviewError = (error) => {
    const message = error?.message || 'プレビューを作成できませんでした。';
    logAiProblem('変更案プレビューの作成', error);
    setStatus(message, 'error');
    if (previewDialog.open) {
      const impact = document.getElementById('ai-preview-impact');
      impact.classList.remove('is-loading');
      impact.textContent = `プレビューを作成できませんでした: ${message}`;
      document.getElementById('ai-preview-before').replaceChildren();
      document.getElementById('ai-preview-after').replaceChildren();
      document.getElementById('ai-apply-proposal').disabled = true;
    }
  };
  const submitQuestionAnswers = async (item) => {
    if (item.submitting || item.submitted) return;
    item.submitting = true;
    item.open = false;
    renderConversation();
    setStatus('確認事項への回答をまとめて送信しています…');
    const answerLines = item.questions.map((question, index) => {
      const context = question.proposalTitle ? `（変更案「${question.proposalTitle}」）` : '';
      return `${index + 1}. ${question.text}${context}\n回答: ${question.answer.trim()}`;
    });
    const succeeded = await sendRequest(`確認事項への回答です。以下をまとめて反映し、同じ点を再質問せず、必要なら前提を明記して変更案を更新してください。\n\n${answerLines.join('\n\n')}`);
    item.submitting = false;
    if (succeeded) {
      item.submitted = true;
      item.proposalIds.forEach((id) => {
        const proposalItem = currentConversation.items.find((entry) => entry.type === 'proposal' && entry.proposal.id === id);
        if (proposalItem && proposalItem.status === 'awaiting-answers') proposalItem.status = 'superseded';
      });
    }
    renderConversation();
  };
  proposalPreview = createProposalPreview({
    editor,
    previewDialog,
    closePreview: () => closePreview(),
    getCurrentConversation: () => currentConversation,
    getClassLabelsById: () => classLabelsById,
    getClassTypesById: () => classTypesById,
    getTemporaryLabelsById: () => temporaryLabelsById,
    operationLabel,
    labelFor,
    renderPreviewTypeLegend,
    reportPreviewError,
    stateFingerprint,
    currentDataHash,
    verifyLoadedDataVersion,
    renderConversation,
    setStatus,
  });
  proposalView = createProposalView({
    messages,
    getProposalPreview: () => proposalPreview,
    renderConversation,
    reportPreviewError,
    renderOperationCountBadges,
    excerpt
  });
  conversationRenderer = createConversationRenderer({
    messages,
    status,
    getCurrentConversation: () => currentConversation,
    getClasses: () => editor.getState().classes,
    beforeRender: (conversation, currentClasses) => {
      classLabelsById = new Map(currentClasses.map((item) => [item.id, item.label]));
      classTypesById = new Map(currentClasses.map((item) => [item.id, item.type]));
      temporaryLabelsById = new Map(conversation.items
        .filter((item) => item.type === 'proposal')
        .flatMap((item) => item.proposal.operations || [])
        .filter((operation) => operation.type === 'addClass' && operation.temporaryId)
        .map((operation) => [operation.temporaryId, operation.label]));
    },
    renderMessage,
    renderProposalQueue: (...args) => proposalView.renderQueue(...args),
    submitQuestionAnswers: (item) => submitQuestionAnswers(item),
    requestProgress,
    updateUsageSummary,
    updateHistoryList,
    persistSavedConversations
  });
  const summarizeVisibleConversation = (conversation) => {
    const lines = [];
    conversation.items.forEach((item) => {
      if (item.type === 'message' && item.role === 'user') lines.push(`利用者の依頼・確認済み方針: ${item.text}`);
      if (item.type === 'questions') {
        item.questions.forEach((question) => {
          if (question.answer?.trim()) lines.push(`利用者が回答した希望・方針: ${question.answer.trim()}`);
        });
      }
    });
    return lines.join('\n').slice(-6000);
  };
  const putWorkflowStatusAfter = (conversation, anchor, text) => {
    const anchorIndex = conversation.items.indexOf(anchor);
    if (anchorIndex < 0) return;
    const existing = conversation.items[anchorIndex + 1];
    const statusItem = { type: 'workflow-status', text };
    if (existing?.type === 'workflow-status') conversation.items[anchorIndex + 1] = statusItem;
    else conversation.items.splice(anchorIndex + 1, 0, statusItem);
  };
  const putWorkflowStatusAfterLatestQuestion = (conversation, text) => {
    const latestQuestion = [...conversation.items].reverse().find((item) => item.type === 'message' && item.role === 'user');
    if (latestQuestion) putWorkflowStatusAfter(conversation, latestQuestion, text);
  };
  const responseHandler = createResponseHandler({
    editor,
    AI_OUTPUT_LIMITS,
    deduplicateQuestions
  });
  const sendRequest = async () => {
    setStatus(window.classEditorAssistant
      ? '旧AI処理は停止中です。新AI側で送信を処理できませんでした。ページを再読み込みしてください。'
      : '新AIチャットを初期化できませんでした。ページを再読み込みしてください。', 'error');
    return false;
  };
  document.getElementById('ai-new-consultation').addEventListener('click', () => {
    if (document.getElementById('ai-chat-form')?.getAttribute('aria-busy') === 'true') return;
    currentConversation = createConversation(editor.selectedIds);
    window.dispatchEvent(new CustomEvent(CHAT_EVENTS.agentNewConversation));
    proposalPreview.clear();
    renderConversation();
    textInput.focus();
  });
  historyButton.addEventListener('click', () => {
    historyPopover.hidden = !historyPopover.hidden;
    historyButton.setAttribute('aria-expanded', String(!historyPopover.hidden));
    if (!historyPopover.hidden) updateHistoryList();
  });
  document.addEventListener('click', (event) => {
    if (!event.target.closest('.ai-history-anchor')) { historyPopover.hidden = true; historyButton.setAttribute('aria-expanded', 'false'); }
  });
  document.getElementById('ai-toggle-key-visibility').addEventListener('click', (event) => {
    const button = event.currentTarget; const visible = keyInput.type === 'password';
    keyInput.type = visible ? 'text' : 'password'; button.textContent = visible ? '伏せ字' : '表示';
    button.setAttribute('aria-pressed', String(visible));
  });
  document.getElementById('ai-chat-form').addEventListener('submit', (event) => {
    event.preventDefault();
    if (document.getElementById('ai-chat-form')?.getAttribute('aria-busy') === 'true') return;
    const value = textInput.value.trim();
    if (!value) return;
    void sendRequest(value);
  });
  textInput.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && !event.shiftKey && !event.isComposing && !event.repeat) {
      event.preventDefault(); document.getElementById('ai-chat-form').requestSubmit();
    }
  });
  const applyLegacyProposal = async () => {
    const applyConversation = currentConversation;
    const applyStartedAt = Date.now();
    const previousWorkflowStatus = applyConversation.workflowStatus;
    let applySucceeded = false;
    applyConversation.isThinking = true;
    applyConversation.thinkingStartedAt = applyStartedAt;
    applyConversation.thinkingStage = '変更適用中';
    applyConversation.thinkingProgress = '';
    applyConversation.workflowStatus = '';
    renderConversation();
    const stopApplyTimer = requestProgress.startThinkingTimer(applyConversation);
    try {
      const applied = await proposalPreview.applyCurrentProposal();
      if (!applied) return;
      applySucceeded = true;
      reconcilePendingProposalAdditions({ appliedProposal: applied.currentProposal, conversation: currentConversation, responseHandler });
      renderConversation();
      if (applied.nextProposal) {
        setStatus('提案を適用しました。次の未判断案を確認しています。');
        await proposalPreview.transitionPreview(() => proposalPreview.showPreview(applied.nextProposal));
        renderConversation();
      } else {
        closePreview();
        document.getElementById('ai-apply-proposal').disabled = true;
        setStatus('提案を適用しました。必要なら最新状態について改めて依頼してください。');
      }
    } catch (error) { logAiProblem('変更案の適用', error); setStatus(error.message, 'error'); }
    finally {
      stopApplyTimer();
      applyConversation.isThinking = false;
      applyConversation.thinkingStage = '';
      applyConversation.thinkingStartedAt = null;
      applyConversation.workflowStatus = applySucceeded ? '' : previousWorkflowStatus;
      if (applySucceeded) putWorkflowStatusAfterLatestQuestion(applyConversation, '変更の適用を完了しました');
      renderConversation();
    }
  };
  const previewController = createProposalPreviewController({
    previewDialog,
    proposalPreview,
    getBridge: () => editorAssistantHost,
    renderConversation,
    setStatus,
    reportPreviewError,
    applyLegacyProposal
  });
  closePreview = previewController.closePreview;
  editorAssistantHost = createChatUiBridge({
    editor,
    getCurrentConversation: () => currentConversation,
    getConversations: () => conversations,
    createConversation,
    currentDataHash,
    getPreview: () => proposalPreview,
    getPreviewDialog: () => previewDialog,
    closePreview,
    renderConversation,
    updateHistoryList,
    persistSavedConversations,
    renderPromptExamples,
    reportPreviewError,
    setStatus
  });
  registerChatUiBridge(editorAssistantHost);
  editorAssistantHost.onScopeChange();

  window.addEventListener('pagehide', () => {
    keyInput.value = '';
    conversations.length = 0;
    currentConversation = null;
    messages.replaceChildren();
  });

  sourceDataVersionPromise = window.appData?.workspaceMeta?.kind === 'uploaded'
    ? digest(JSON.stringify(window.appData.workspaceMeta.importedData || window.appData))
      .then((value) => { sourceDataVersion = `uploaded-${value}`; })
    : fetchPublishedDataVersion()
      .then((value) => { sourceDataVersion = value; })
    .catch((error) => {
      logAiProblem('クラスデータ版の読み込み', error);
      setStatus('データ版を確認できません。通信状態を確認してください。AI提案は確認できるまで送信できません', 'error');
      appendSettingsLink();
      sourceDataVersion = '';
    });
})();
