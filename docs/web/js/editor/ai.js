// AIへの相談、提案の検証・プレビュー・適用を行う。editor/main 相当の初期化後に読み込む。
// AI提案は表示・検証だけを行い、利用者が適用するまで編集データには触れない。
(() => {
  const editor = window.classEditorAI;
  if (!editor) return;

  const API_URL = 'https://api.openai.com/v1/responses';
  // Context tokenization varies by model and language; cap the serialized user payload conservatively.
  const MAX_REQUEST_CHARACTERS = 60000;

  const operationSchema = {
    type: 'object', additionalProperties: false,
    properties: {
      type: { type: 'string', enum: ['addClass', 'renameClass', 'moveClass', 'moveChildren', 'deleteClass'] },
      classType: { type: ['string', 'null'], enum: ['top', 'middle', null] },
      temporaryId: { type: ['string', 'null'] },
      label: { type: ['string', 'null'] },
      parentId: { type: ['string', 'null'] },
      classId: { type: ['string', 'null'] },
      destinationId: { type: ['string', 'null'] },
      from: { type: ['string', 'null'] },
      to: { type: ['string', 'null'] }
    },
    required: ['type', 'classType', 'temporaryId', 'label', 'parentId', 'classId', 'destinationId', 'from', 'to']
  };
  const responseSchema = {
    type: 'object', additionalProperties: false,
    properties: {
      message: { type: 'string' },
      proposals: {
        type: 'array', items: {
          type: 'object', additionalProperties: false,
          properties: {
            id: { type: 'string' }, title: { type: 'string' }, summary: { type: 'string' },
            reason: { type: 'string' }, questions: { type: 'array', items: { type: 'string' } },
            uncertainties: { type: 'array', items: { type: 'string' } },
            operations: { type: 'array', items: operationSchema }
          },
          required: ['id', 'title', 'summary', 'reason', 'questions', 'uncertainties', 'operations']
        }
      },
      questions: { type: 'array', items: { type: 'string' } },
      dataRequests: {
        type: 'array', items: {
          type: 'object', additionalProperties: false,
          properties: {
            classId: { type: ['string', 'null'] },
            className: { type: ['string', 'null'] },
            reason: { type: 'string' }
          },
          required: ['classId', 'className', 'reason']
        }
      }
    },
    required: ['message', 'proposals', 'questions', 'dataRequests']
  };

  const keyInput = document.getElementById('ai-api-key');
  const settingsDialog = document.getElementById('edit-settings-dialog');
  const keyGuidance = document.getElementById('ai-key-guidance');
  const updateKeyGuidance = () => { keyGuidance.hidden = Boolean(keyInput.value.trim()); };
  updateKeyGuidance();
  keyInput.addEventListener('input', updateKeyGuidance);
  document.getElementById('ai-open-settings').addEventListener('click', () => {
    settingsDialog.showModal();
    keyInput.focus();
  });
  const modelSelect = document.getElementById('ai-model');
  const settingsStatus = document.getElementById('ai-settings-status');
  let modelConfig = null;
  const systemPromptPromise = fetch('web/data/config/ai-system-prompt.md', { cache: 'no-store' })
    .then((response) => { if (!response.ok) throw new Error('AIプロンプトを読み込めません。'); return response.text(); })
    .then((prompt) => {
      const trimmedPrompt = prompt.trim();
      if (!trimmedPrompt) throw new Error('AIプロンプトが空です。');
      return trimmedPrompt;
    })
    .catch((error) => {
      settingsStatus.textContent = `${error.message}。AI補助を利用できません。`;
      settingsStatus.classList.add('is-error');
      return null;
    });
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
      const selected = config.models.find((item) => item.id === config.defaultModel);
      if (selected?.description) document.getElementById('ai-model-description').textContent = selected.description;
      return config;
    })
    .catch((error) => {
      modelSelect.disabled = true;
      settingsStatus.textContent = `${error.message}。AI補助を利用できません。`;
      settingsStatus.classList.add('is-error');
      return null;
    });
  modelSelect.addEventListener('change', () => {
    const selected = modelConfig?.models.find((item) => item.id === modelSelect.value);
    document.getElementById('ai-model-description').textContent = selected?.description || '選択したモデルを次の依頼から使用します。';
  });
  const messages = document.getElementById('ai-chat-messages');
  const status = document.getElementById('ai-status');
  const sendButton = document.getElementById('ai-send');
  const textInput = document.getElementById('ai-chat-input');
  const previewDialog = document.getElementById('ai-preview-dialog');
  const historyButton = document.getElementById('ai-show-history');
  const historyPopover = document.getElementById('ai-history-popover');
  const historyList = document.getElementById('ai-history-list');
  const usageSummary = document.getElementById('ai-usage-summary');
  const conversations = [];
  const sessionUsage = { requests: 0, inputTokens: 0, outputTokens: 0, costUsd: 0, costKnown: true };
  let currentConversation = null;
  let previewPlan = null;
  let sourceDataVersion = '';
  let isSending = false;
  let activeRequestController = null;
  let classLabelsById = new Map();
  let classTypesById = new Map();
  let temporaryLabelsById = new Map();

  const createConversation = (selectedIds = editor.selectedIds) => {
    const conversation = {
      id: `chat-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      title: '新しい相談',
      updatedAt: Date.now(),
      selectedIds: [...selectedIds],
      responseId: '',
      initialSnapshotSent: false,
      previousScope: null,
      localContext: '',
      items: [],
      status: '',
      usage: { requests: 0, inputTokens: 0, outputTokens: 0, costUsd: 0, costKnown: true }
    };
    conversations.unshift(conversation);
    return conversation;
  };
  currentConversation = createConversation();

  const formatUsd = (value) => `$${Number(value || 0).toFixed(6)}`;
  const selectedModelPricing = () => modelConfig?.models.find((item) => item.id === modelSelect.value);
  const updateUsageSummary = (note = '') => {
    if (!usageSummary) return;
    const current = currentConversation?.usage || { requests: 0, inputTokens: 0, outputTokens: 0, costUsd: 0, costKnown: true };
    const pricingAvailable = current.costKnown && sessionUsage.costKnown;
    const conversationCost = current.requests ? formatUsd(current.costUsd) : '$0.000000';
    const sessionCost = sessionUsage.requests ? formatUsd(sessionUsage.costUsd) : '$0.000000';
    const actual = `この相談: ${current.requests}回・入力 ${current.inputTokens.toLocaleString()} / 出力 ${current.outputTokens.toLocaleString()} tokens・${pricingAvailable ? conversationCost : '料金不明'}　|　このページ: ${sessionUsage.requests}回・${pricingAvailable ? sessionCost : '料金不明'}`;
    usageSummary.textContent = [actual, note].filter(Boolean).join('　');
  };
  const recordUsage = (responseBody) => {
    const usage = responseBody?.usage;
    if (!usage || !Number.isFinite(usage.input_tokens) || !Number.isFinite(usage.output_tokens)) return;
    const rates = selectedModelPricing();
    const inputTokens = usage.input_tokens;
    const outputTokens = usage.output_tokens;
    const cachedTokens = Math.min(inputTokens, Number(usage.input_tokens_details?.cached_tokens || 0));
    const ratesAvailable = rates && Number.isFinite(rates.inputUsdPerMillion) && Number.isFinite(rates.outputUsdPerMillion);
    const costUsd = ratesAvailable
      ? ((inputTokens - cachedTokens) * rates.inputUsdPerMillion
        + cachedTokens * (rates.cachedInputUsdPerMillion ?? rates.inputUsdPerMillion)
        + outputTokens * rates.outputUsdPerMillion) / 1_000_000
      : 0;
    [currentConversation.usage, sessionUsage].forEach((total) => {
      total.requests += 1;
      total.inputTokens += inputTokens;
      total.outputTokens += outputTokens;
      total.costUsd += costUsd;
      if (!ratesAvailable) total.costKnown = false;
    });
    updateUsageSummary();
  };
  const estimateTokensFromText = (text) => {
    let japanese = 0;
    let other = 0;
    for (const character of text) {
      if (/[\u3000-\u30ff\u3400-\u9fff\uf900-\ufaff]/u.test(character)) japanese += 1;
      else other += 1;
    }
    return Math.ceil(japanese * 1.5 + other / 4);
  };
  const estimateRequestCost = (inputs, systemPrompt) => {
    const rates = selectedModelPricing();
    if (!rates) return '料金目安を表示できません（モデル料金の設定なし）';
    const inputTokens = inputs.reduce((total, input) => total + estimateTokensFromText(input) + estimateTokensFromText(systemPrompt), 0);
    const inputUsd = inputTokens * rates.inputUsdPerMillion / 1_000_000;
    const outputCapUsd = inputs.length * 5000 * rates.outputUsdPerMillion / 1_000_000;
    const pricingDate = modelConfig?.pricingAsOf ? `料金単価 ${modelConfig.pricingAsOf} 時点。` : '';
    return `今回の概算: ${inputs.length}リクエスト、入力約${inputTokens.toLocaleString()} tokens。最大出力枠を使う想定で約${formatUsd(inputUsd + outputCapUsd)}（精度の低い目安。${pricingDate}会話履歴・JSON形式指定などを含まず、実額は異なります）`;
  };

  const setStatus = (text, kind = '') => {
    status.textContent = text;
    status.className = `ai-status${kind ? ` is-${kind}` : ''}`;
    if (currentConversation) currentConversation.status = text;
  };
  const appendSettingsLink = () => {
    status.append(document.createTextNode(' '));
    const link = document.createElement('button');
    link.type = 'button';
    link.className = 'ai-settings-inline-link';
    link.textContent = '設定へ';
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
  const renderMessage = (item) => {
    const bubble = document.createElement('article');
    bubble.className = `ai-message is-${item.role}`;
    const title = document.createElement('strong');
    title.textContent = item.role === 'user' ? 'あなた' : 'AI';
    const body = document.createElement('p');
    body.textContent = item.text;
    bubble.append(title, body);
    messages.append(bubble);
  };
  const updateHistoryList = () => {
    historyList.replaceChildren();
    const saved = conversations.filter((conversation) => conversation.items.some((item) => item.type === 'message' && item.role === 'user'));
    if (!saved.length) {
      const empty = document.createElement('p'); empty.className = 'ai-history-empty'; empty.textContent = '過去の相談はありません。';
      historyList.append(empty);
      return;
    }
    saved.forEach((conversation) => {
      const button = document.createElement('button'); button.type = 'button'; button.className = 'ai-history-item';
      button.classList.toggle('is-active', conversation.id === currentConversation.id);
      button.disabled = isSending;
      const title = document.createElement('span'); title.textContent = conversation.title;
      const updated = document.createElement('small');
      updated.textContent = new Intl.DateTimeFormat('ja-JP', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }).format(conversation.updatedAt);
      button.append(title, updated);
      button.addEventListener('click', () => activateConversation(conversation));
      historyList.append(button);
    });
  };
  const renderConversation = ({ scrollToBottom = false } = {}) => {
    const previousScrollTop = messages.scrollTop;
    const currentClasses = editor.getState().classes;
    classLabelsById = new Map(currentClasses.map((item) => [item.id, item.label]));
    classTypesById = new Map(currentClasses.map((item) => [item.id, item.type]));
    temporaryLabelsById = new Map(currentConversation.items
      .filter((item) => item.type === 'proposal')
      .flatMap((item) => item.proposal.operations || [])
      .filter((operation) => operation.type === 'addClass' && operation.temporaryId)
      .map((operation) => [operation.temporaryId, operation.label]));
    messages.replaceChildren();
    currentConversation.items.forEach((item) => {
      if (item.type === 'message') renderMessage(item);
      else if (item.type === 'proposal') renderProposalCard(item);
      else if (item.type === 'questions') renderQuestionQueue(item);
      else if (item.type === 'data-requests') renderDataRequest(item);
    });
    messages.scrollTop = scrollToBottom ? messages.scrollHeight : previousScrollTop;
    status.textContent = currentConversation.status || '';
    updateUsageSummary();
    updateHistoryList();
  };
  const activateConversation = (conversation) => {
    if (isSending || !conversation) return;
    currentConversation = conversation;
    editor.setSelectedIds(conversation.selectedIds);
    historyPopover.hidden = true;
    historyButton.setAttribute('aria-expanded', 'false');
    renderConversation();
  };
  const refreshConversationTitle = (conversation) => {
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
  const verifyLoadedDataVersion = async () => {
    const response = await fetch('data/input/current-class-data-version.txt', { cache: 'no-store' });
    if (!response.ok) throw new Error('クラスデータの版情報を確認できません。');
    const latest = (await response.text()).trim();
    if (!latest || !sourceDataVersion) throw new Error('クラスデータの版情報を取得できません。');
    if (latest !== sourceDataVersion) throw new Error('編集画面を開いた後にデータ版が更新されています。ページを再読み込みしてから依頼してください。');
  };
  const readResponseText = (response) => {
    if (typeof response.output_text === 'string') return response.output_text;
    for (const item of response.output || []) {
      for (const content of item.content || []) {
        if (content.type === 'output_text' && typeof content.text === 'string') return content.text;
      }
    }
    throw new Error('AIから読み取れるテキストが返りませんでした。もう一度依頼してください。');
  };
  const compactScope = (scope) => ({
    mode: scope.mode || 'selected_scope',
    selectedIds: [...(scope.selectedIds || [])],
    selectionRoots: [...(scope.selectionRoots || scope.selectedIds || [])],
    editableIds: [...(scope.editableIds || [])],
    sharedContextIds: [...(scope.sharedContextIds || [])],
    classes: scope.classes.map(({ id, type, label }) => [id, type, label]),
    relations: scope.relations.map(({ child, parent }) => [child, parent])
  });
  const diffScope = (before, after) => {
    const current = compactScope(after);
    if (!before) return { kind: 'initial_snapshot', data: current };
    const previous = compactScope(before);
    if (previous.mode !== current.mode) return { kind: 'initial_snapshot', data: current };
    const mapById = (items) => new Map(items.map((item) => [item[0], item]));
    const beforeClasses = mapById(previous.classes); const afterClasses = mapById(current.classes);
    const changedClasses = [...afterClasses.values()].filter((item) => JSON.stringify(item) !== JSON.stringify(beforeClasses.get(item[0])));
    const removedClasses = [...beforeClasses.keys()].filter((id) => !afterClasses.has(id));
    const relationKey = ([child, parent]) => `${child}\u0000${parent}`;
    const beforeRelations = new Set(previous.relations.map(relationKey));
    const afterRelations = new Set(current.relations.map(relationKey));
    return {
      kind: 'scope_and_data_diff',
      mode: current.mode,
      selectedIds: current.selectedIds,
      selectionRoots: current.selectionRoots,
      editableIds: current.editableIds,
      sharedContextIds: current.sharedContextIds,
      addedOrChangedClasses: changedClasses,
      removedClassIds: removedClasses,
      addedRelations: current.relations.filter((item) => !beforeRelations.has(relationKey(item))),
      removedRelations: previous.relations.filter((item) => !afterRelations.has(relationKey(item))),
      currentScopeClassIds: current.classes.map(([id]) => id)
    };
  };
  const getPayloadSnapshot = (additionalContextIds = []) => {
    const selectedIds = editor.selectedIds;
    if (!selectedIds.length) return null;
    const scope = editor.getScopedState(selectedIds);
    const selected = new Set(scope.editableIds);
    const knownIds = new Set(editor.getState().classes.map((item) => item.id));
    const sharedContextIds = [...new Set(additionalContextIds)].filter((id) => knownIds.has(id) && !selected.has(id));
    if (!sharedContextIds.length) return scope;
    const included = new Set([...selected, ...sharedContextIds]);
    const state = editor.getState();
    return {
      ...scope,
      sharedContextIds,
      classes: state.classes.filter((item) => included.has(item.id)),
      relations: state.relations.filter((item) => included.has(item.child) && included.has(item.parent)),
      counts: Object.fromEntries(state.classes.filter((item) => included.has(item.id)).map((item) => [item.id, state.counts[item.id] || 0]))
    };
  };
  const formatHttpError = (body, response) => {
    const apiMessage = body?.error?.message;
    if (response.status === 401) return 'APIキーを確認してください。認証に失敗しました。';
    if (response.status === 429) return 'APIの利用上限またはレート制限に達しました。時間をおいて再依頼してください。';
    if (/exceeds the context window/i.test(apiMessage || '')) {
      return 'この相談の履歴と対象範囲がモデルの入力上限を超えました。新しい相談を始めるか、上位クラス配下をさらに小さい範囲に分けてください。';
    }
    if (response.status === 400 && apiMessage) return `依頼を送信できませんでした: ${apiMessage}`;
    return apiMessage || `OpenAI APIへの接続に失敗しました（HTTP ${response.status}）。`;
  };
  const operationLabel = (operation) => {
    if (operation.type === 'addClass') return `${operation.classType === 'top' ? '上位' : '中間'}クラス「${operation.label}」を追加`;
    if (operation.type === 'renameClass') return `「${labelFor(operation.classId)}」を「${operation.label}」に改名`;
    if (operation.type === 'moveClass') {
      const sourceLabel = labelFor(operation.classId);
      return classTypesById.get(operation.classId) === 'top'
        ? `上位クラス「${sourceLabel}」を中間クラス化して「${labelFor(operation.destinationId)}」へ移動`
        : `「${sourceLabel}」を「${labelFor(operation.destinationId)}」へ移動`;
    }
    if (operation.type === 'moveChildren') return `「${labelFor(operation.from)}」の配下を「${labelFor(operation.to)}」へ移動`;
    if (operation.type === 'deleteClass') return `「${labelFor(operation.classId)}」を削除`;
    return '不明な操作';
  };
  const labelFor = (id) => {
    return temporaryLabelsById.get(id) || classLabelsById.get(id) || id || '未指定';
  };
  const excerpt = (value, limit = 180) => {
    const text = String(value || '');
    return text.length > limit ? `${text.slice(0, limit)}…` : text;
  };
  const reportPreviewError = (error) => {
    const message = error?.message || 'プレビューを作成できませんでした。';
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
  const renderProposalCard = (item) => {
    const proposal = item.proposal;
    const card = document.createElement('article'); card.className = `ai-proposal-card is-${item.status}`;
    const contentLabel = document.createElement('strong'); contentLabel.className = 'ai-proposal-label'; contentLabel.textContent = '変更内容';
    const summary = document.createElement('p'); summary.className = 'ai-proposal-summary'; summary.textContent = excerpt(proposal.summary || proposal.title);
    card.append(contentLabel, summary);

    const actions = document.createElement('div'); actions.className = 'ai-proposal-actions';
    const preview = document.createElement('button'); preview.type = 'button'; preview.className = 'ai-proposal-preview'; preview.textContent = 'プレビュー';
    const statusLabel = document.createElement('span'); statusLabel.className = 'ai-proposal-status';
    const statusText = { pending: '', previewed: '確認済み', stale: '適用後の状態で再確認が必要', applied: '適用済み', 'awaiting-answers': '確認事項への回答待ち', superseded: '回答を送信済み。更新後の案を確認してください。' };
    statusLabel.textContent = statusText[item.status] || '';
    const unavailable = ['applied', 'awaiting-answers', 'superseded'].includes(item.status);
    preview.disabled = unavailable || item.status === 'invalid';
    const updateStatus = () => {
      statusLabel.textContent = item.status === 'previewed' ? '確認済み' : item.status === 'stale' ? '適用後の状態で再確認が必要' : '';
      card.className = `ai-proposal-card is-${item.status}`;
    };
    preview.addEventListener('click', () => {
      void showPreview(item, false).then(updateStatus).catch(reportPreviewError);
    });
    actions.append(preview, statusLabel);
    card.append(actions);
    messages.append(card);
  };
  const renderQuestionQueue = (item) => {
    const details = document.createElement('details');
    details.className = 'ai-question-queue';
    details.open = Boolean(item.open);
    details.addEventListener('toggle', () => { item.open = details.open; });
    const summary = document.createElement('summary');
    const answeredCount = item.questions.filter((question) => question.answer?.trim()).length;
    summary.textContent = item.submitted
      ? `確認事項（${item.questions.length}件・回答送信済み）`
      : `確認事項（${item.questions.length}件・${answeredCount}件回答済み）`;
    details.append(summary);
    if (item.submitted) {
      const submitted = document.createElement('p');
      submitted.className = 'ai-question-complete';
      submitted.textContent = '回答をまとめてAIへ送りました。更新された提案を確認してください。';
      details.append(submitted);
      messages.append(details);
      return;
    }
    const question = item.questions[item.activeIndex] || item.questions[0];
    const content = document.createElement('div'); content.className = 'ai-question-content';
    const progress = document.createElement('p'); progress.className = 'ai-question-progress';
    progress.textContent = `質問 ${item.activeIndex + 1} / ${item.questions.length}`;
    content.append(progress);
    if (question.proposalTitle) {
      const context = document.createElement('p'); context.className = 'ai-question-context';
      context.textContent = `変更案「${question.proposalTitle}」について`;
      content.append(context);
    }
    const prompt = document.createElement('p'); prompt.className = 'ai-question-prompt'; prompt.textContent = question.text;
    const answer = document.createElement('textarea'); answer.rows = 2; answer.className = 'ai-question-answer';
    answer.placeholder = '回答を入力してください'; answer.value = question.answer || '';
    answer.setAttribute('aria-label', `質問 ${item.activeIndex + 1} への回答`);
    answer.addEventListener('input', () => { question.answer = answer.value; });
    content.append(prompt, answer);
    const actions = document.createElement('div'); actions.className = 'ai-question-actions';
    const previous = document.createElement('button'); previous.type = 'button'; previous.textContent = '前へ';
    previous.disabled = item.activeIndex === 0;
    previous.addEventListener('click', () => { item.activeIndex -= 1; renderConversation(); });
    const recommend = document.createElement('button'); recommend.type = 'button'; recommend.textContent = 'おすすめに任せる';
    recommend.addEventListener('click', () => { question.answer = 'おすすめに任せる'; renderConversation(); });
    const next = document.createElement('button'); next.type = 'button'; next.className = 'search-button';
    const isLast = item.activeIndex === item.questions.length - 1;
    next.textContent = isLast ? '回答をまとめて送る' : '次へ';
    next.disabled = Boolean(item.submitting);
    next.addEventListener('click', () => {
      question.answer = answer.value.trim();
      if (!question.answer) {
        answer.setCustomValidity('回答を入力するか、「おすすめに任せる」を選んでください。');
        answer.reportValidity();
        return;
      }
      answer.setCustomValidity('');
      if (!isLast) { item.activeIndex += 1; renderConversation(); return; }
      void submitQuestionAnswers(item);
    });
    actions.append(previous, recommend, next);
    content.append(actions);
    details.append(content);
    messages.append(details);
  };
  const renderDataRequest = (item) => {
    const card = document.createElement('article');
    card.className = `ai-data-request-card is-${item.status || 'pending'}`;
    const heading = document.createElement('strong');
    heading.textContent = '追加クラス情報の共有確認';
    card.append(heading);
    if (item.unresolved?.length) {
      const unresolved = document.createElement('p');
      unresolved.textContent = `クラスを特定できませんでした: ${item.unresolved.join('、')}。ツリーから該当クラスを選択して、改めて依頼してください。`;
      card.append(unresolved);
    }
    if (item.requests.length) {
      const note = document.createElement('p');
      note.textContent = '許可すると、次のクラス情報を今回のAI相談に追加で共有します。編集対象には追加されません。';
      card.append(note);
      const list = document.createElement('ul');
      item.requests.forEach(({ item: requestedClass, reason }) => {
        const row = document.createElement('li');
        const label = `${requestedClass.type === 'top' ? '上位' : requestedClass.type === 'middle' ? '中間' : '対象'}クラス「${requestedClass.label}」 (${requestedClass.id})`;
        row.textContent = reason ? `${label} — ${reason}` : label;
        list.append(row);
      });
      card.append(list);
      const actions = document.createElement('div');
      actions.className = 'ai-data-request-actions';
      const allow = document.createElement('button');
      allow.type = 'button';
      allow.className = 'search-button';
      allow.textContent = item.status === 'approved' ? '共有を許可しました' : '許可して共有';
      allow.disabled = Boolean(item.submitting) || item.status !== 'pending';
      allow.addEventListener('click', async () => {
        if (item.submitting || item.status !== 'pending') return;
        item.submitting = true;
        renderConversation();
        const approved = item.requests.map(({ item: requestedClass }) => requestedClass);
        const lines = approved.map(({ id, label }) => `${label} (${id})`).join('、');
        const succeeded = await sendRequest(`追加情報の共有を許可します。次のクラス情報を使って、前の依頼を続けてください: ${lines}`, approved.map(({ id }) => id));
        item.submitting = false;
        if (succeeded) item.status = 'approved';
        renderConversation();
      });
      const deny = document.createElement('button');
      deny.type = 'button';
      deny.textContent = '今回は共有しない';
      deny.disabled = Boolean(item.submitting) || item.status !== 'pending';
      deny.addEventListener('click', async () => {
        if (item.submitting || item.status !== 'pending') return;
        item.submitting = true;
        renderConversation();
        const succeeded = await sendRequest('追加クラス情報の共有は許可しません。現在の選択範囲だけで回答してください。');
        item.submitting = false;
        if (succeeded) item.status = 'denied';
        renderConversation();
      });
      actions.append(allow, deny);
      card.append(actions);
    }
    if (item.status === 'approved' || item.status === 'denied') {
      const status = document.createElement('p');
      status.className = 'ai-data-request-status';
      status.textContent = item.status === 'approved' ? '共有を許可しました。' : '共有しないことをAIへ伝えました。';
      card.append(status);
    }
    messages.append(card);
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
  const countHierarchyTargets = (state) => {
    const classesById = new Map(state.classes.map((item) => [item.id, item]));
    const children = new Map();
    state.relations.forEach(({ child, parent }) => {
      if (!children.has(parent)) children.set(parent, []);
      children.get(parent).push(child);
    });
    const totals = new Map(); const direct = new Map(); const visiting = new Set();
    const countFor = (id) => {
      if (totals.has(id)) return totals.get(id);
      if (visiting.has(id)) return 0;
      visiting.add(id);
      let total = 0; let directCount = 0;
      (children.get(id) || []).forEach((childId) => {
        if (classesById.get(childId)?.type === 'class') { total += 1; directCount += 1; }
        else if (classesById.get(childId)) total += countFor(childId);
      });
      visiting.delete(id);
      totals.set(id, total); direct.set(id, directCount);
      return total;
    };
    state.classes.filter((item) => item.type === 'top' || item.type === 'middle').forEach((item) => countFor(item.id));
    return { totals, direct };
  };
  const appendTree = (host, state, affectedIds = new Set(), options = {}) => {
    const classesById = new Map(state.classes.map((item) => [item.id, item]));
    const children = new Map(); const parentIds = new Set();
    state.relations.forEach(({ child, parent }) => {
      if (!children.has(parent)) children.set(parent, []);
      children.get(parent).push(child);
      parentIds.add(child);
    });
    const buildNode = (id, path = new Set()) => {
      const item = classesById.get(id);
      if (!item || path.has(id)) return null;
      const nextPath = new Set(path).add(id);
      const node = { id, label: item.label, type: item.type, previewDeleted: Boolean(item.previewDeleted), children: [], targets: [] };
      (children.get(id) || []).forEach((childId) => {
        const child = classesById.get(childId);
        if (!child) return;
        if (child.type === 'class') node.targets.push(child);
        else {
          const childNode = buildNode(childId, nextPath);
          if (childNode) node.children.push(childNode);
        }
      });
      return node;
    };
    const roots = state.classes.filter((item) => item.type === 'top' && !parentIds.has(item.id))
      .map((item) => buildNode(item.id)).filter(Boolean);
    host.classList.add('tree');
    const targetCountFor = (item) => state.counts?.[item.id] || 0;
    const countFor = (node) => node.targets.length + node.children.reduce((sum, child) => sum + countFor(child), 0);
    const indexesFor = (id) => Array.from(options.operationIndexesByClass?.get(id) || []);
    const makeToggle = (id, label) => {
      const indexes = indexesFor(id);
      if (!options.selectable || !indexes.length) return null;
      const checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.className = 'ai-preview-change-toggle';
      checkbox.checked = [...indexes].every((index) => !options.excludedOperationIndexes.has(index));
      checkbox.setAttribute('aria-label', `${label}の変更を適用する`);
      checkbox.addEventListener('click', (event) => event.stopPropagation());
      checkbox.addEventListener('change', () => options.onToggle?.(indexes, checkbox.checked));
      return checkbox;
    };
    window.renderHierarchyTree(host, roots, {
      countFor,
      targetCountFor,
      isOpen: () => true,
      displayId: () => '',
      decorateSummary: (summary, _content, node) => {
        if (options.countLabelFor) {
          const badge = summary.querySelector('.count-badge');
          const updateBadge = () => { badge.textContent = options.countLabelFor(node); };
          updateBadge();
          summary.parentElement?.addEventListener('toggle', updateBadge);
        }
        if (affectedIds.has(node.id)) {
          const indexes = indexesFor(node.id);
          summary.classList.add(indexes.length && indexes.some((index) => options.excludedOperationIndexes.has(index))
            ? 'is-ai-preview-excluded' : 'is-ai-preview-changed');
        }
        const checkbox = node.type === 'middle' ? null : makeToggle(node.id, node.label);
        if (checkbox) summary.prepend(checkbox);
        if (node.previewDeleted) {
          summary.classList.add('is-ai-preview-deleted');
          const note = document.createElement('span');
          note.className = 'ai-preview-deleted-label';
          const deleteIndex = options.deletionOperationByClass?.get(node.id);
          note.textContent = deleteIndex !== undefined && options.excludedOperationIndexes.has(deleteIndex) ? '削除しない' : '削除予定';
          summary.append(note);
        }
      },
      renderTarget: (item, _parent, depth) => {
        const li = document.createElement('li');
        li.style.setProperty('--tree-level-color', window.treeDepthColor(depth));
        const row = document.createElement('div');
        row.className = 'tree-leaf-class ai-preview-class';
        const indexes = indexesFor(item.id);
        if (affectedIds.has(item.id) && indexes.length) {
          const included = indexes.every((index) => !options.excludedOperationIndexes.has(index));
          if (included) row.classList.add('is-selected', 'is-ai-preview-changed');
          else row.classList.add('is-ai-preview-excluded');
        }
        if (options.selectable && indexes.length) {
          const included = indexes.every((index) => !options.excludedOperationIndexes.has(index));
          row.setAttribute('role', 'checkbox');
          row.setAttribute('aria-checked', String(included));
          row.setAttribute('aria-label', `${item.label}の変更を適用する`);
          row.tabIndex = 0;
          const toggle = () => options.onToggle?.(indexes, !included);
          row.addEventListener('click', toggle);
          row.addEventListener('keydown', (event) => {
            if (event.key !== ' ' && event.key !== 'Enter') return;
            event.preventDefault();
            toggle();
          });
        }
        const id = document.createElement('span');
        id.className = 'tree-leaf-id';
        const idSegment = String(item.id).split('/').pop();
        const idMatch = idSegment.match(/^([cmt])_0*(\d+)$/);
        id.textContent = idMatch ? `${idMatch[1]}_${Number(idMatch[2])}` : idSegment;
        const label = document.createElement('span');
        label.className = 'tree-leaf-label';
        label.textContent = item.label;
        row.append(id, label);
        li.append(row);
        return li;
      },
      afterRender: (container) => window.updateTreeTargetRowStarts(container)
    });
  };
  const updatePreviewSelection = (proposalItem, update) => {
    const previous = new Set(proposalItem.excludedOperationIndexes);
    update();
    void showPreview(proposalItem, false, true).catch((error) => {
      proposalItem.excludedOperationIndexes = previous;
      reportPreviewError(error);
      void showPreview(proposalItem, false, true).catch(reportPreviewError);
    });
  };
  const renderPreviewChangeList = (proposalItem) => {
    const list = document.getElementById('ai-preview-change-list');
    const rows = proposalItem.proposal.operations.map((operation, index) => {
      const excluded = proposalItem.excludedOperationIndexes.has(index);
      const row = document.createElement('li');
      row.className = `ai-preview-change-item${excluded ? ' is-excluded' : ''}`;
      const text = document.createElement('span'); text.className = 'ai-preview-change-text'; text.textContent = operationLabel(operation);
      const status = document.createElement('span'); status.className = 'ai-preview-change-status'; status.textContent = excluded ? '除外' : '適用';
      row.append(text, status);
      return row;
    });
    list.replaceChildren(...rows);
  };
  const showPreview = async (proposalItem, applyRequested = false, fastUpdate = false) => {
    const applyButton = document.getElementById('ai-apply-proposal');
    if (!fastUpdate) {
      applyButton.disabled = true;
      previewPlan = null;
    }
    const operations = proposalItem.proposal.operations;
    if (!operations.length) throw new Error('変更操作が残っていません。この提案は適用する内容がありません。');
    proposalItem.excludedOperationIndexes ||= new Set();
    if (!fastUpdate) {
      document.getElementById('ai-preview-summary').textContent = proposalItem.proposal.summary || proposalItem.proposal.title || '変更内容の説明はありません。';
      document.getElementById('ai-preview-reason').textContent = proposalItem.proposal.reason || '理由の記載はありません。';
      document.getElementById('ai-preview-uncertainties').textContent = proposalItem.proposal.uncertainties?.length
        ? proposalItem.proposal.uncertainties.join('、') : '特になし';
      document.getElementById('ai-preview-change-list').replaceChildren();
      const impact = document.getElementById('ai-preview-impact');
      impact.classList.add('is-loading');
      impact.textContent = 'プレビューを作成しています…';
      document.getElementById('ai-preview-before').replaceChildren();
      document.getElementById('ai-preview-after').replaceChildren();
      if (!previewDialog.open) previewDialog.showModal();
      await new Promise((resolve) => requestAnimationFrame(resolve));
      await verifyLoadedDataVersion();
      if (proposalItem.status !== 'stale' && proposalItem.baseDataHash !== await currentDataHash()) {
        throw new Error('提案作成後にデータが変更されています。最新状態で依頼し直してください。');
      }
    }
    const expectedFingerprint = fastUpdate ? previewPlan?.expectedFingerprint : stateFingerprint();
    if (!expectedFingerprint || stateFingerprint() !== expectedFingerprint) {
      throw new Error('プレビュー作成後にデータが変更されています。最新データで提案し直してください。');
    }
    const proposedCandidate = editor.applyOperations(operations, expectedFingerprint, proposalItem.editableIds, proposalItem.availableIds);
    const activeOperations = operations.filter((_, index) => !proposalItem.excludedOperationIndexes.has(index));
    const candidate = editor.applyOperations(activeOperations, expectedFingerprint, proposalItem.editableIds, proposalItem.availableIds);
    const expectedBaseHash = fastUpdate ? previewPlan.expectedBaseHash : await currentDataHash();
    if (proposalItem.status === 'stale') {
      proposalItem.baseDataHash = expectedBaseHash;
      proposalItem.status = 'previewed';
    } else if (proposalItem.status === 'pending') {
      proposalItem.status = 'previewed';
    }
    if (stateFingerprint() !== expectedFingerprint) throw new Error('プレビュー作成中にデータが変更されました。最新データで提案し直してください。');
    const beforeState = editor.getState();
    const beforeIds = new Set(beforeState.classes.map((item) => item.id));
    const beforeParents = new Map(beforeState.relations.map(({ child, parent }) => [child, parent]));
    const afterParents = new Map(proposedCandidate.relations.map(({ child, parent }) => [child, parent]));
    const proposedIds = new Set(proposedCandidate.classes.map((item) => item.id));
    const operationIds = new Set();
    const affectedIds = new Set();
    const operationIndexesByClass = new Map();
    const deletionOperationByClass = new Map();
    const addOperationClass = (id, index) => {
      if (!id) return;
      if (!operationIndexesByClass.has(id)) operationIndexesByClass.set(id, new Set());
      operationIndexesByClass.get(id).add(index);
      operationIds.add(id);
      affectedIds.add(id);
    };
    const addedClassForReference = (reference) => {
      const addition = operations.find((operation) => operation.type === 'addClass'
        && (operation.temporaryId === reference || `${proposalItem.proposal.id}/${operation.temporaryId}` === reference));
      if (!addition) return null;
      const convertedId = proposedCandidate.idRemaps?.get(reference)
        || proposedCandidate.idRemaps?.get(addition.temporaryId);
      if (convertedId) return proposedCandidate.classes.find((item) => item.id === convertedId) || null;
      return proposedCandidate.classes.find((item) => !beforeIds.has(item.id)
        && item.type === addition.classType && item.label === String(addition.label || '').trim()) || null;
    };
    const resolveProposedId = (reference) => proposedIds.has(reference) || beforeIds.has(reference)
      ? proposedCandidate.idRemaps?.get(reference) || reference
      : addedClassForReference(reference)?.id || proposedCandidate.idRemaps?.get(reference) || reference;
    operations.forEach((operation, index) => {
      if (operation.type === 'addClass') {
        addOperationClass(addedClassForReference(operation.temporaryId)?.id, index);
        return;
      }
      if (operation.type === 'moveChildren') {
        const from = resolveProposedId(operation.from); const to = resolveProposedId(operation.to);
        for (const id of new Set([...beforeParents.keys(), ...afterParents.keys()])) {
          if (beforeParents.get(id) === from && afterParents.get(id) === to) addOperationClass(id, index);
        }
        addOperationClass(from, index);
        return;
      }
      const id = resolveProposedId(operation.classId);
      addOperationClass(id, index);
      if (id !== operation.classId && beforeIds.has(operation.classId)) addOperationClass(operation.classId, index);
      if (operation.type === 'deleteClass') deletionOperationByClass.set(id, index);
    });
    for (const id of new Set([...beforeParents.keys(), ...afterParents.keys()])) {
      if (beforeParents.get(id) !== afterParents.get(id)) {
        operationIds.add(id);
        affectedIds.add(id);
      }
    }
    for (const item of proposedCandidate.classes) {
      const original = beforeState.classes.find((candidateItem) => candidateItem.id === item.id);
      if (!original || original.label !== item.label) {
        operationIds.add(item.id);
        affectedIds.add(item.id);
      }
    }
    const deletedIds = new Set(beforeState.classes.filter((item) => !proposedIds.has(item.id)
      && deletionOperationByClass.has(item.id)).map((item) => item.id));
    deletedIds.forEach((id) => { operationIds.add(id); affectedIds.add(id); });
    const proposedDisplayState = {
      classes: [...candidate.classes],
      relations: [...candidate.relations],
      counts: beforeState.counts
    };
    const displayedIds = new Set(proposedDisplayState.classes.map((item) => item.id));
    const excludedAdditions = proposedCandidate.classes.filter((item) => !beforeIds.has(item.id) && !displayedIds.has(item.id));
    excludedAdditions.forEach((item) => {
      proposedDisplayState.classes.push({ ...item, previewExcluded: true });
      displayedIds.add(item.id);
    });
    const excludedAdditionIds = new Set(excludedAdditions.map((item) => item.id));
    proposedCandidate.relations.forEach((relation) => {
      if (excludedAdditionIds.has(relation.child) && displayedIds.has(relation.parent)
        && !proposedDisplayState.relations.some((existing) => existing.child === relation.child)) {
        proposedDisplayState.relations.push({ ...relation });
      }
    });
    deletedIds.forEach((id) => {
      const removed = beforeState.classes.find((item) => item.id === id);
      if (removed && !displayedIds.has(id)) {
        proposedDisplayState.classes.push({ ...removed, previewDeleted: true });
        displayedIds.add(id);
      }
      const oldRelation = beforeState.relations.find((relation) => relation.child === id);
      if (oldRelation && displayedIds.has(oldRelation.parent)
        && !proposedDisplayState.relations.some((relation) => relation.child === id)) proposedDisplayState.relations.push(oldRelation);
    });
    const displayParents = new Map(proposedDisplayState.relations.map(({ child, parent }) => [child, parent]));
    const displayIds = new Set(proposedDisplayState.classes.map((item) => item.id));
    const addAncestors = (ids, parentByChild, validIds) => {
      for (const id of [...ids]) {
        let parent = parentByChild.get(id);
        while (parent && validIds.has(parent) && !ids.has(parent)) {
          ids.add(parent);
          parent = parentByChild.get(parent);
        }
      }
    };
    addAncestors(operationIds, beforeParents, beforeIds);
    addAncestors(operationIds, displayParents, displayIds);
    const before = document.getElementById('ai-preview-before'); const after = document.getElementById('ai-preview-after');
    const previewIds = operationIds;
    const previewState = (state) => ({
      classes: state.classes.filter((item) => previewIds.has(item.id)),
      relations: state.relations.filter(({ child, parent }) => previewIds.has(child) && previewIds.has(parent)),
      counts: beforeState.counts
    });
    const beforeHierarchyCounts = countHierarchyTargets(beforeState);
    const afterHierarchyCounts = countHierarchyTargets(candidate);
    const hierarchyCountLabel = (counts) => (node) => {
      const total = counts.totals.get(node.id) || 0;
      const direct = counts.direct.get(node.id) || 0;
      return `合計 ${total}件・直下 ${direct}件`;
    };
    appendTree(before, previewState(beforeState), affectedIds, {
      countLabelFor: hierarchyCountLabel(beforeHierarchyCounts)
    });
    appendTree(after, previewState(proposedDisplayState), affectedIds, {
      selectable: true,
      countLabelFor: hierarchyCountLabel(afterHierarchyCounts),
      operationIndexesByClass,
      deletionOperationByClass,
      excludedOperationIndexes: proposalItem.excludedOperationIndexes,
      onToggle: (indexes, include) => {
        updatePreviewSelection(proposalItem, () => {
          indexes.forEach((index) => include
            ? proposalItem.excludedOperationIndexes.delete(index)
            : proposalItem.excludedOperationIndexes.add(index));
        });
      }
    });
    renderPreviewChangeList(proposalItem);
    const operationCounts = { addClass: 0, renameClass: 0, move: 0, deleteClass: 0 };
    activeOperations.forEach((operation) => {
      if (operation.type === 'moveClass' || operation.type === 'moveChildren') operationCounts.move += 1;
      else if (Object.hasOwn(operationCounts, operation.type)) operationCounts[operation.type] += 1;
    });
    const impact = document.getElementById('ai-preview-impact');
    impact.classList.remove('is-loading');
    impact.textContent = `適用中 ${activeOperations.length}/${operations.length}件（追加 ${operationCounts.addClass}・改名 ${operationCounts.renameClass}・移動 ${operationCounts.move}・削除 ${operationCounts.deleteClass}）`;
    previewPlan = { proposalItem, operations: activeOperations.map((operation) => ({ ...operation })), candidate, expectedFingerprint, expectedBaseHash };
    applyButton.disabled = activeOperations.length === 0;
    if (applyRequested && activeOperations.length) applyButton.focus();
  };

  const validatePayload = (result, expectedHash) => {
    if (!result || typeof result !== 'object' || Array.isArray(result)) {
      throw new Error('AIの応答がJSONオブジェクトではありません。提案は適用できません。');
    }
    if (!Array.isArray(result.proposals) || !Array.isArray(result.questions) || !Array.isArray(result.dataRequests)) {
      throw new Error('AIの応答に提案または確認事項の一覧がありません。もう一度依頼してください。');
    }
    result.dataRequests = result.dataRequests.filter((request) => request && typeof request.reason === 'string'
      && ((typeof request.classId === 'string' && request.classId.trim())
        || (typeof request.className === 'string' && request.className.trim())))
      .map((request) => ({
        classId: typeof request.classId === 'string' ? request.classId.trim() : '',
        className: typeof request.className === 'string' ? request.className.trim() : '',
        reason: request.reason.trim()
      }));
    // The browser owns the data fingerprint; asking the model to echo it can
    // produce harmless character errors that incorrectly invalidate a proposal.
    result.baseDataHash = expectedHash;
    const proposalIds = new Set();
    result.proposals.forEach((proposal) => {
      if (!proposal || typeof proposal.title !== 'string' || !Array.isArray(proposal.operations)
        || !Array.isArray(proposal.questions) || !Array.isArray(proposal.uncertainties)
        || !proposal.id || proposalIds.has(proposal.id)) throw new Error('AIの提案形式が不正です。提案は適用できません。');
      proposalIds.add(proposal.id);
      proposal.operations.forEach((operation) => {
        if (!operation || !['addClass', 'renameClass', 'moveClass', 'moveChildren', 'deleteClass'].includes(operation.type)) throw new Error('許可されていない操作を含む提案です。適用できません。');
      });
    });
    result.proposals.forEach((proposal) => {
      const temporaryIds = new Map(proposal.operations.filter((operation) => operation.type === 'addClass' && operation.temporaryId)
        .map((operation) => [operation.temporaryId, `${proposal.id}/${operation.temporaryId}`]));
      proposal.operations.forEach((operation) => {
        ['temporaryId', 'parentId', 'classId', 'destinationId', 'from', 'to'].forEach((key) => {
          if (temporaryIds.has(operation[key])) operation[key] = temporaryIds.get(operation[key]);
        });
      });
    });
  };
  const resolveDataRequests = (requests, scope) => {
    const state = editor.getState();
    const byId = new Map(state.classes.map((item) => [item.id, item]));
    const selected = new Set(scope.editableIds);
    const alreadyShared = new Set(scope.sharedContextIds || []);
    const resolved = new Map();
    const unresolved = [];
    requests.forEach((request) => {
      let candidate = null;
      if (request.classId) {
        candidate = byId.get(request.classId);
        if (!candidate || (request.className && candidate.label !== request.className)) {
          unresolved.push(request.className || request.classId);
          return;
        }
      } else if (request.className) {
        const matches = state.classes.filter((item) => item.label === request.className);
        if (matches.length === 1) candidate = matches[0];
        else {
          unresolved.push(request.className);
          return;
        }
      }
      if (!candidate) {
        unresolved.push(request.classId || request.className || '指定されたクラス');
        return;
      }
      if (selected.has(candidate.id) || alreadyShared.has(candidate.id)) return;
      const previous = resolved.get(candidate.id);
      resolved.set(candidate.id, {
        item: candidate,
        reason: [previous?.reason, request.reason].filter(Boolean).join(' / ')
      });
    });
    return { requests: [...resolved.values()], unresolved: [...new Set(unresolved)] };
  };
  const buildUserContent = (userText, activeScope, conversation, baseDataHash, options = {}) => {
    const usePrevious = !options.forceSnapshot && conversation.initialSnapshotSent && conversation.responseId;
    const previousScope = usePrevious ? conversation.previousScope : null;
    return JSON.stringify({
      baseDataHash,
      request: userText,
      conversationContext: conversation.localContext || undefined,
      selectedScope: diffScope(previousScope, activeScope),
      instruction: options.instruction || (activeScope.mode === 'overview_summary'
        ? 'これは全体構造の要約です。個別対象クラス名は含みません。既存クラスの変更・移動・削除は提案せず、全体評価、確認事項、新しい上位・中間クラスの案だけを返してください。'
        : activeScope.mode === 'hierarchy_scope'
          ? 'これは階層クラスだけの範囲です。対象クラスの個別情報は含まれません。上位・中間クラスの追加・改名・移動・削除だけを提案してください。上位クラスを中間クラスへ移す場合は上位を中間化し、配下の親子関係を保ってください。対象クラスの操作は提案しないでください。'
          : 'この相談の範囲にあるクラスの提案だけを返してください。selectionRootsは選択操作の起点です。editableIdsが操作できる移動元の正確な一覧です。sharedContextIdsは利用者が追加共有を許可した参照専用クラスで、移動元・改名・削除の対象にできません。選択外の情報が必要ならdataRequestsにclassIdまたは正確なclassNameと理由を返し、利用者の許可を待ってください。上位クラスを中間クラスへ移す場合は上位を新しい中間クラスIDに変換し、配下の所属先だけを自動的に付け替えて親子関係を保つため、配下を別々に移動する操作は作らないでください。未掲載の配下を推測した別操作は提案しないでください。個別インスタンスデータと件数は含みません。')
    });
  };
  const makeLargeScopePlan = (userText, scope, conversation, baseDataHash) => {
    const selectionRoots = scope.selectionRoots || scope.selectedIds;
    const selectedRootClasses = selectionRoots.map((id) => scope.classes.find((item) => item.id === id)).filter(Boolean);
    const isHierarchySelection = selectedRootClasses.length === selectionRoots.length
      && selectedRootClasses.length > 0
      && selectedRootClasses.every((item) => ['top', 'middle'].includes(item.type));
    if (!isHierarchySelection) return null;

    const hierarchyScope = editor.getHierarchyScopedState(scope.selectedIds);
    if (!hierarchyScope) return null;
    const hierarchyInstruction = 'この分割処理では上位・中間クラスの階層構造だけを検討してください。selectionRootsの上位クラスは中間クラスへ移動できます。その場合は上位を中間化し、配下の親子関係を保って移動してください。対象クラスの変更案は作らず、入力にない情報を推測しないでください。';
    const hierarchyClasses = scope.classes.filter((item) => ['top', 'middle'].includes(item.type));
    const hierarchyChunkLimit = MAX_REQUEST_CHARACTERS;
    const parentByChild = new Map(scope.relations.map(({ child, parent }) => [child, parent]));
    const hierarchyById = new Map(hierarchyClasses.map((item) => [item.id, item]));
    const childrenByParent = new Map();
    scope.relations.forEach(({ child, parent }) => {
      if (!hierarchyById.has(child) || !hierarchyById.has(parent)) return;
      if (!childrenByParent.has(parent)) childrenByParent.set(parent, []);
      childrenByParent.get(parent).push(child);
    });
    const hierarchyEditableIds = new Set(hierarchyScope.editableIds);
    const buildHierarchyTask = (taskScope) => {
      const input = buildUserContent(userText, taskScope, conversation, baseDataHash, {
        forceSnapshot: true,
        instruction: hierarchyInstruction
      });
      return { kind: 'hierarchy', scope: taskScope, input };
    };
    const makeHierarchyTask = (editableIds) => {
      const includedIds = new Set(editableIds);
      editableIds.forEach((id) => {
        let parentId = parentByChild.get(id);
        const seen = new Set();
        while (parentId && hierarchyById.has(parentId) && !seen.has(parentId)) {
          seen.add(parentId);
          includedIds.add(parentId);
          parentId = parentByChild.get(parentId);
        }
      });
      const taskScope = {
        mode: 'hierarchy_scope',
        selectedIds: scope.selectedIds.filter((id) => includedIds.has(id)),
        selectionRoots: (scope.selectionRoots || scope.selectedIds).filter((id) => includedIds.has(id)),
        editableIds: [...editableIds],
        classes: hierarchyClasses.filter((item) => includedIds.has(item.id)),
        relations: scope.relations.filter(({ child, parent }) => includedIds.has(child) && includedIds.has(parent)),
        counts: {}
      };
      return buildHierarchyTask(taskScope);
    };
    const hierarchyTasks = [];
    const remainingHierarchyIds = new Set(hierarchyEditableIds);
    const collectRemainingSubtree = (id, collected = new Set()) => {
      if (!remainingHierarchyIds.has(id) || collected.has(id)) return collected;
      collected.add(id);
      (childrenByParent.get(id) || []).forEach((childId) => collectRemainingSubtree(childId, collected));
      return collected;
    };
    const partitionHierarchySubtree = (rootId) => {
      const subtreeIds = collectRemainingSubtree(rootId);
      if (!subtreeIds.size) return;
      const candidate = makeHierarchyTask([...subtreeIds]);
      if (candidate.input.length <= hierarchyChunkLimit) {
        hierarchyTasks.push(candidate);
        subtreeIds.forEach((id) => remainingHierarchyIds.delete(id));
        return;
      }

      // If a whole branch is too large, keep its root in one task and recurse into each child branch.
      if (remainingHierarchyIds.has(rootId)) {
        const rootTask = makeHierarchyTask([rootId]);
        if (rootTask.input.length > hierarchyChunkLimit) {
          throw new Error('上位・中間クラス1件と親階層の情報が大きく、対象クラスを加える余地がありません。さらに小さい範囲を選択してください。');
        }
        hierarchyTasks.push(rootTask);
        remainingHierarchyIds.delete(rootId);
      }
      (childrenByParent.get(rootId) || []).filter((id) => remainingHierarchyIds.has(id)).forEach(partitionHierarchySubtree);
    };
    hierarchyScope.selectedIds.forEach((id) => {
      if (remainingHierarchyIds.has(id)) partitionHierarchySubtree(id);
    });
    [...remainingHierarchyIds].forEach(partitionHierarchySubtree);

    // Pack small hierarchy branches together so they do not each require a separate API call.
    const packedHierarchyTasks = [];
    let pendingHierarchyScope = null;
    const mergeHierarchyScopes = (left, right) => {
      const classesById = new Map([...left.classes, ...right.classes].map((item) => [item.id, item]));
      const relationByKey = new Map([...left.relations, ...right.relations]
        .map((item) => [`${item.child}\u0000${item.parent}`, item]));
      return {
        mode: 'hierarchy_scope',
        selectedIds: [...new Set([...left.selectedIds, ...right.selectedIds])],
        selectionRoots: [...new Set([...(left.selectionRoots || []), ...(right.selectionRoots || [])])],
        editableIds: [...new Set([...left.editableIds, ...right.editableIds])],
        classes: [...classesById.values()],
        relations: [...relationByKey.values()],
        counts: {}
      };
    };
    hierarchyTasks.forEach((task) => {
      const candidateScope = pendingHierarchyScope ? mergeHierarchyScopes(pendingHierarchyScope, task.scope) : task.scope;
      const candidateTask = buildHierarchyTask(candidateScope);
      if (pendingHierarchyScope && candidateTask.input.length > hierarchyChunkLimit) {
        packedHierarchyTasks.push(buildHierarchyTask(pendingHierarchyScope));
        pendingHierarchyScope = task.scope;
      } else {
        pendingHierarchyScope = candidateScope;
      }
    });
    if (pendingHierarchyScope) packedHierarchyTasks.push(buildHierarchyTask(pendingHierarchyScope));
    hierarchyTasks.splice(0, hierarchyTasks.length, ...packedHierarchyTasks);

    const targetClasses = scope.classes.filter((item) => item.type === 'class' && scope.editableIds.includes(item.id));
    const targetInstruction = 'この分割範囲に含まれる対象クラスだけを評価してください。許可する操作は対象クラスの移動だけです。上位・中間クラスの追加・改名・移動・削除や、入力にない対象クラスの操作は提案しないでください。移動先は入力にある上位・中間クラスのIDだけを使ってください。';
    const targetTasks = [];
    const targetUnits = [];
    targetClasses.forEach((target) => {
      let parentId = parentByChild.get(target.id);
      let hierarchyTask = null;
      const seen = new Set();
      while (parentId && !seen.has(parentId)) {
        seen.add(parentId);
        hierarchyTask = hierarchyTasks.find((task) => task.scope.editableIds.includes(parentId)) || hierarchyTask;
        if (hierarchyById.get(parentId)?.type === 'middle' && hierarchyTask) break;
        parentId = parentByChild.get(parentId);
      }
      if (!hierarchyTask) hierarchyTask = hierarchyTasks.find((task) => task.scope.classes.some((item) => item.id === parentByChild.get(target.id)));
      if (!hierarchyTask) throw new Error('対象クラスの親階層を分割範囲に対応付けられませんでした。');
      targetUnits.push({ target, hierarchyTask });
    });

    const makeTargetScope = (units) => {
      const targets = units.map((unit) => unit.target);
      const targetIds = new Set(targets.map((item) => item.id));
      const hierarchyByIdLocal = new Map();
      units.forEach(({ hierarchyTask }) => hierarchyTask.scope.classes.forEach((item) => hierarchyByIdLocal.set(item.id, item)));
      const classes = [...hierarchyByIdLocal.values(), ...targets];
      const includedIds = new Set(classes.map((item) => item.id));
      return {
        mode: 'selected_scope',
        selectedIds: scope.selectedIds.filter((id) => includedIds.has(id)),
        selectionRoots: (scope.selectionRoots || scope.selectedIds).filter((id) => includedIds.has(id)),
        editableIds: [...targetIds],
        classes,
        relations: scope.relations.filter(({ child, parent }) => includedIds.has(child) && includedIds.has(parent)),
        counts: {}
      };
    };
    const buildTargetTask = (units) => {
      const taskScope = makeTargetScope(units);
      const input = buildUserContent(userText, taskScope, conversation, baseDataHash, {
        forceSnapshot: true,
        instruction: targetInstruction
      });
      return { kind: 'targets', scope: taskScope, input };
    };
    // Fill each target request as much as possible. Binary search finds the largest
    // contiguous batch that remains within the request limit, minimizing call count.
    let targetOffset = 0;
    while (targetOffset < targetUnits.length) {
      const remaining = targetUnits.length - targetOffset;
      let low = 1; let high = remaining; let bestSize = 0; let bestTask = null;
      while (low <= high) {
        const size = Math.floor((low + high) / 2);
        const candidate = buildTargetTask(targetUnits.slice(targetOffset, targetOffset + size));
        if (candidate.input.length <= MAX_REQUEST_CHARACTERS) {
          bestSize = size; bestTask = candidate; low = size + 1;
        } else high = size - 1;
      }
      if (!bestSize || !bestTask) {
        throw new Error('対象クラス1件と移動先候補だけでも送信上限を超えています。選択範囲を小さくするか、クラス名の長い範囲を分けてください。');
      }
      targetTasks.push(bestTask);
      targetOffset += bestSize;
    }
    const hierarchyCoverage = new Set(hierarchyTasks.flatMap((task) => task.scope.editableIds));
    const targetCoverage = new Set(targetTasks.flatMap((task) => task.scope.editableIds));
    if (hierarchyEditableIds.size !== hierarchyCoverage.size
      || [...hierarchyEditableIds].some((id) => !hierarchyCoverage.has(id))
      || targetClasses.length !== targetCoverage.size
      || targetClasses.some((item) => !targetCoverage.has(item.id))) {
      throw new Error('分割範囲に漏れがあるため、送信を中止しました。選択範囲を小さくして再度依頼してください。');
    }
    return [...hierarchyTasks, ...targetTasks];
  };
  const createLocalConversationContext = (userText, result) => {
    const lines = [`利用者の依頼: ${userText}`];
    if (result.message) lines.push(`回答: ${result.message}`);
    result.questions.forEach((question) => lines.push(`確認事項: ${question}`));
    result.dataRequests.forEach((request) => lines.push(`追加情報要求: ${request.className || request.classId}。理由: ${request.reason}`));
    result.proposals.forEach((proposal) => {
      lines.push(`変更案「${proposal.title}」: ${proposal.summary}。理由: ${proposal.reason}`);
      proposal.operations.forEach((operation) => lines.push(`操作: ${JSON.stringify(operation)}`));
    });
    return `${lines[0].slice(0, 500)}\n${lines.slice(1).join('\n').slice(-5500)}`;
  };
  const summarizeVisibleConversation = (conversation) => {
    const lines = [];
    conversation.items.forEach((item) => {
      if (item.type === 'message') lines.push(`${item.role === 'user' ? '利用者' : 'AI'}: ${item.text}`);
      if (item.type === 'proposal') {
        lines.push(`AI変更案「${item.proposal.title}」: ${item.proposal.summary}。理由: ${item.proposal.reason}`);
        item.proposal.operations.forEach((operation) => lines.push(`操作: ${JSON.stringify(operation)}`));
      }
    });
    return lines.join('\n').slice(-6000);
  };
  const summarizeSelectionContinuation = (conversation) => {
    const lines = ['選択範囲が更新されたため、以前のクラス情報は引き継がれていません。以下は依頼の意図と確認事項だけです。クラスの事実は今回のselectedScopeだけを使ってください。'];
    conversation.items.forEach((item) => {
      if (item.type === 'message' && item.role === 'user') {
        lines.push(`利用者の依頼・回答: ${item.text}`);
      } else if (item.type === 'questions') {
        item.questions.forEach((question) => {
          lines.push(`前回の確認事項: ${question.text}`);
          if (question.answer?.trim()) lines.push(`利用者の回答: ${question.answer.trim()}`);
        });
      } else if (item.type === 'data-requests') {
        item.requests.forEach(({ item: requestedClass, reason }) => {
          lines.push(`前回求められた追加情報: ${requestedClass.label} (${requestedClass.id})${reason ? `。理由: ${reason}` : ''}`);
        });
        item.unresolved?.forEach((name) => lines.push(`前回特定できなかった追加情報: ${name}`));
      }
    });
    return lines.join('\n').slice(-6000);
  };
  const validateSplitTaskOperations = (result, task) => {
    const editable = new Set(task.scope.editableIds);
    const classesById = new Map(task.scope.classes.map((item) => [item.id, item]));
    let discardedOperationCount = 0;
    result.proposals.forEach((proposal) => {
      const originalOperationCount = proposal.operations.length;
      const temporaryIds = new Set(proposal.operations
        .filter((operation) => operation.type === 'addClass' && operation.temporaryId)
        .map((operation) => operation.temporaryId));
      const temporaryTypeById = new Map(proposal.operations
        .filter((operation) => operation.type === 'addClass' && operation.temporaryId)
        .map((operation) => [operation.temporaryId, operation.classType]));
      const isDestination = (id) => {
        const item = classesById.get(id);
        return Boolean((item && ['top', 'middle'].includes(item.type)) || temporaryIds.has(id));
      };
      const allowed = proposal.operations.filter((operation) => {
        if (task.kind === 'targets') {
          const destination = classesById.get(operation.destinationId);
          return operation.type === 'moveClass'
            && editable.has(operation.classId)
            && classesById.get(operation.classId)?.type === 'class'
            && destination && ['top', 'middle'].includes(destination.type);
        }
        const sourceId = operation.classId || operation.from;
        if (['renameClass', 'moveClass', 'moveChildren', 'deleteClass'].includes(operation.type)
          && !editable.has(sourceId)) return false;
        if (operation.type === 'moveClass') {
          if (!isDestination(operation.destinationId)) return false;
          const sourceType = classesById.get(operation.classId)?.type
            || temporaryTypeById.get(operation.classId);
          const destinationType = classesById.get(operation.destinationId)?.type
            || temporaryTypeById.get(operation.destinationId);
          if (sourceType === 'top' && destinationType !== 'middle') return false;
        }
        if (operation.type === 'moveChildren' && !isDestination(operation.to)) return false;
        if (operation.type === 'addClass') {
          if (!['top', 'middle'].includes(operation.classType)) return false;
          if (operation.classType === 'top' && operation.parentId) return false;
          if (operation.classType === 'middle' && !isDestination(operation.parentId)) return false;
        }
        return ['addClass', 'renameClass', 'moveClass', 'moveChildren', 'deleteClass'].includes(operation.type);
      });
      discardedOperationCount += proposal.operations.length - allowed.length;
      proposal.operations = allowed;
      if (!proposal.operations.length && !proposal.questions.length) {
        proposal.questions.push('この分割範囲では適用可能な変更操作がありませんでした。');
      } else if (allowed.length < originalOperationCount) {
        proposal.uncertainties.push('分割範囲外の操作は安全確認のため除外しました。表示中の変更内容を確認してください。');
        proposal.summary = `分割範囲外の操作を除外した案です。${proposal.summary || proposal.title}`;
      }
    });
    return discardedOperationCount;
  };
  const sendRequest = async (userText, additionalContextIds = []) => {
    if (isSending) return false;
    const key = keyInput.value.trim();
    if (!key) { setStatus('設定欄にOpenAI APIキーを入力してください。', 'error'); keyInput.focus(); return; }
    if (!/^[\x21-\x7E]+$/.test(key)) {
      setStatus('APIキーに半角ASCII以外の文字が含まれています。キーを再コピーして入力してください。キーの前後や途中に空白・改行がないか確認してください。', 'error');
      keyInput.focus();
      return;
    }
    if (!await modelConfigPromise) { setStatus('モデル設定を読み込めないため依頼を送信できません。', 'error'); return; }
    const systemPrompt = await systemPromptPromise;
    if (!systemPrompt) { setStatus('AIプロンプトを読み込めないため依頼を送信できません。', 'error'); return; }
    const conversation = currentConversation;
    const currentSelectedIds = [...editor.selectedIds].sort();
    const previousSelectedIds = [...(conversation.selectedIds || [])].sort();
    const selectionChanged = JSON.stringify(currentSelectedIds) !== JSON.stringify(previousSelectedIds);
    const previouslySharedIds = selectionChanged ? [] : (conversation.previousScope?.sharedContextIds || []);
    let scope;
    try { scope = getPayloadSnapshot([...previouslySharedIds, ...additionalContextIds]); } catch (error) { setStatus(error.message, 'error'); return; }
    if (!scope) { setStatus('AIに相談するクラスを保持欄で選択してください。', 'error'); return; }
    try { await verifyLoadedDataVersion(); }
    catch (error) { setStatus(error.message, 'error'); return; }
    let baseDataHash;
    try { baseDataHash = await currentDataHash(); }
    catch (error) { setStatus(error.message, 'error'); return; }
    const fingerprintBeforeRequest = stateFingerprint();
    if (selectionChanged) {
      // 前回のクラス情報は破棄し、依頼意図と確認事項だけを次の選択範囲へ引き継ぐ。
      conversation.responseId = '';
      conversation.initialSnapshotSent = false;
      conversation.previousScope = null;
      conversation.localContext = summarizeSelectionContinuation(conversation);
    }
    const userContent = buildUserContent(userText, scope, conversation);
    let splitTasks = null;
    if (userContent.length > MAX_REQUEST_CHARACTERS) {
      conversation.localContext = conversation.localContext || summarizeVisibleConversation(conversation);
      try { splitTasks = makeLargeScopePlan(userText, scope, conversation, baseDataHash); }
      catch (error) { setStatus(error.message, 'error'); return; }
      if (!splitTasks?.length) {
        setStatus(`送信データが大きすぎます（約${userContent.length.toLocaleString()}文字）。上位クラスを選択して配下を分割するか、選択範囲を小さくしてください。入力文は保持しています。`, 'error');
        return;
      }
    }
    const requestInputs = splitTasks ? splitTasks.map((task) => task.input) : [userContent];
    const userMessageCount = conversation.items.filter((item) => item.type === 'message' && item.role === 'user').length;
    const longConversationNote = userMessageCount >= 7
      ? '会話が長くなっています。前のやりとりも利用量に影響するため、必要なら「＋」から新しい相談を始めてください。'
      : '';
    const preflightNote = [estimateRequestCost(requestInputs, systemPrompt), longConversationNote].filter(Boolean).join('　');
    updateUsageSummary(preflightNote);
    if (splitTasks?.length > 1 && !window.confirm(`この依頼は${splitTasks.length}回のAPIリクエストに分割されます。\n${preflightNote}\n\n続けますか？`)) {
      updateUsageSummary();
      return;
    }
    textInput.value = '';
    conversation.selectedIds = [...editor.selectedIds];
    conversation.items.push({ type: 'message', role: 'user', text: userText });
    conversation.updatedAt = Date.now();
    refreshConversationTitle(conversation);
    renderConversation({ scrollToBottom: true });
    updateUsageSummary(preflightNote);
    setStatus(splitTasks ? `OpenAI APIに接続しています…（1/${splitTasks.length}）` : 'OpenAI APIに接続しています…');
    isSending = true; sendButton.disabled = true; document.getElementById('ai-new-consultation').disabled = true;
    let requestSucceeded = false;
    try {
      activeRequestController = new AbortController();
      const sendApiRequest = async (input, previousResponseId = '') => {
        const body = {
          model: modelSelect.value,
          reasoning: { effort: 'low' },
          instructions: systemPrompt,
          input,
          text: { format: { type: 'json_schema', name: 'class_edit_proposals', strict: true, schema: responseSchema } },
          max_output_tokens: 5000,
          store: true
        };
        if (previousResponseId) body.previous_response_id = previousResponseId;
        const response = await fetch(API_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
          body: JSON.stringify(body),
          signal: activeRequestController.signal
        });
        const responseBody = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(formatHttpError(responseBody, response));
        recordUsage(responseBody);
        return { responseBody, result: JSON.parse(readResponseText(responseBody)) };
      };
      let result;
      let responseId = '';
      const proposalScopes = new Map();
      const proposalPreviewScopes = new Map();
      const proposalAvailableScopes = new Map();
      if (splitTasks) {
        result = { baseDataHash, message: '', proposals: [], questions: [], dataRequests: [] };
        const messagesFromParts = [];
        const splitWarnings = new Set();
        for (let offset = 0; offset < splitTasks.length; offset += 2) {
          const batch = splitTasks.slice(offset, offset + 2);
          setStatus(`OpenAI APIに接続しています…（${offset + 1}/${splitTasks.length}）`);
          const parts = await Promise.all(batch.map((task) => sendApiRequest(task.input)));
          parts.forEach((part, batchIndex) => {
            const index = offset + batchIndex;
            const task = splitTasks[index];
            validatePayload(part.result, baseDataHash);
            part.result.proposals.forEach((proposal, proposalIndex) => {
              proposal.id = `part${index + 1}_proposal${proposalIndex + 1}`;
            });
            const discardedOperationCount = validateSplitTaskOperations(part.result, task);
            if (discardedOperationCount) splitWarnings.add(`${discardedOperationCount}件の範囲外操作を除外しました。表示される変更案を確認してください。`);
            if (part.result.message) messagesFromParts.push(part.result.message);
            result.questions.push(...part.result.questions);
            result.dataRequests.push(...part.result.dataRequests);
            part.result.proposals.forEach((proposal) => {
              if (proposal.operations.length) {
                try {
                  editor.applyOperations(proposal.operations, fingerprintBeforeRequest, task.scope.editableIds, task.scope.classes.map((item) => item.id));
                } catch (error) {
                  proposal.operations = [];
                  proposal.questions.push(`この案は選択範囲全体で適用可能と確認できなかったため、プレビュー対象から外しました。${error.message}`);
                }
              }
              result.proposals.push(proposal);
              proposalScopes.set(proposal.id, [...task.scope.editableIds]);
            proposalPreviewScopes.set(proposal.id, task.scope.classes.map((item) => item.id));
            proposalAvailableScopes.set(proposal.id, task.scope.classes.map((item) => item.id));
            });
          });
          if (stateFingerprint() !== fingerprintBeforeRequest) throw new Error('依頼中に編集データが変わりました。最新状態で再依頼してください。');
        }
        result.message = messagesFromParts.join('\n');
        if (splitWarnings.size) result.message = [result.message, ...splitWarnings].filter(Boolean).join('\n');
        conversation.responseId = '';
        conversation.initialSnapshotSent = false;
        conversation.previousScope = null;
        conversation.localContext = createLocalConversationContext(userText, result);
      } else {
        const response = await sendApiRequest(userContent, conversation.responseId);
        result = response.result;
        responseId = response.responseBody.id || '';
        if (!responseId) throw new Error('会話IDを取得できませんでした。新しい相談からやり直してください。');
        validatePayload(result, baseDataHash);
        conversation.responseId = responseId;
        conversation.initialSnapshotSent = true;
        conversation.previousScope = scope;
        conversation.localContext = '';
        result.proposals.forEach((proposal) => {
          proposalScopes.set(proposal.id, [...scope.editableIds]);
          proposalPreviewScopes.set(proposal.id, scope.classes.map((item) => item.id));
          proposalAvailableScopes.set(proposal.id, scope.classes.map((item) => item.id));
        });
        if (stateFingerprint() !== fingerprintBeforeRequest) throw new Error('依頼中に編集データが変わりました。最新状態で再依頼してください。');
      }
      if (result.message) conversation.items.push({ type: 'message', role: 'assistant', text: result.message });
      const resolvedDataRequests = resolveDataRequests(result.dataRequests, scope);
      if (resolvedDataRequests.requests.length || resolvedDataRequests.unresolved.length) {
        conversation.items.push({ type: 'data-requests', ...resolvedDataRequests, status: 'pending', submitting: false });
      }
      const queuedQuestions = result.questions.map((question) => ({ text: question, proposalTitle: '', proposalId: '' }));
      const queuedProposalIds = [];
      result.proposals.forEach((proposal) => {
        if (proposal.questions.length) {
          proposal.questions.forEach((question) => queuedQuestions.push({ text: question, proposalTitle: proposal.title, proposalId: proposal.id }));
        }
        const awaitingAnswers = proposal.questions.length > 0;
        conversation.items.push({
          type: 'proposal',
          proposal,
          editableIds: proposalScopes.get(proposal.id) || [...scope.editableIds],
          availableIds: proposalAvailableScopes.get(proposal.id) || scope.classes.map((item) => item.id),
          previewClassIds: proposalPreviewScopes.get(proposal.id) || scope.classes.map((item) => item.id),
          baseDataHash,
          status: awaitingAnswers ? 'awaiting-answers' : 'pending'
        });
        if (awaitingAnswers) queuedProposalIds.push(proposal.id);
      });
      if (queuedQuestions.length) {
        conversation.items.push({
          type: 'questions',
          questions: queuedQuestions,
          proposalIds: [...new Set(queuedProposalIds)],
          activeIndex: 0,
          open: false,
          submitted: false,
          submitting: false
        });
      }
      conversation.updatedAt = Date.now();
      renderConversation();
      setStatus(result.proposals.length ? '提案を確認し、プレビューしてから適用してください。' : '変更案はありません。確認事項への回答や追加依頼を入力できます。');
      requestSucceeded = true;
    } catch (error) {
      setStatus(error.message || '接続に失敗しました。設定と通信状態を確認してください。', 'error');
    } finally {
      isSending = false; sendButton.disabled = false; document.getElementById('ai-new-consultation').disabled = false; activeRequestController = null;
    }
    return requestSucceeded;
  };

  document.getElementById('ai-new-consultation').addEventListener('click', () => {
    currentConversation = createConversation(editor.selectedIds);
    previewPlan = null;
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
    event.preventDefault(); const value = textInput.value.trim();
    if (!value) return;
    void sendRequest(value);
  });
  textInput.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
      event.preventDefault(); document.getElementById('ai-chat-form').requestSubmit();
    }
  });
  const closePreview = () => { previewDialog.close(); previewPlan = null; };
  previewDialog.addEventListener('close', () => {
    previewPlan = null;
    document.getElementById('ai-preview-impact').classList.remove('is-loading');
    document.getElementById('ai-apply-proposal').disabled = true;
  });
  previewDialog.addEventListener('click', (event) => {
    if (event.target !== previewDialog) return;
    const rect = previewDialog.getBoundingClientRect();
    const clickedOutside = event.clientX < rect.left || event.clientX > rect.right
      || event.clientY < rect.top || event.clientY > rect.bottom;
    if (clickedOutside) closePreview();
  });
  document.getElementById('ai-preview-close').addEventListener('click', closePreview);
  document.getElementById('ai-preview-select-all').addEventListener('click', () => {
    const item = previewPlan?.proposalItem;
    if (!item) return;
    updatePreviewSelection(item, () => item.excludedOperationIndexes.clear());
  });
  document.getElementById('ai-preview-exclude-all').addEventListener('click', () => {
    const item = previewPlan?.proposalItem;
    if (!item) return;
    updatePreviewSelection(item, () => {
      item.excludedOperationIndexes = new Set(item.proposal.operations.map((_, index) => index));
    });
  });
  document.getElementById('ai-apply-proposal').addEventListener('click', async () => {
    if (!previewPlan) return;
    try {
      await verifyLoadedDataVersion();
      const currentHash = await currentDataHash();
      if (currentHash !== previewPlan.expectedBaseHash) throw new Error('提案の作成後にデータが変更されました。最新データで提案し直してください。');
      const candidate = editor.applyOperations(previewPlan.operations, previewPlan.expectedFingerprint, previewPlan.proposalItem.editableIds, previewPlan.proposalItem.availableIds);
      editor.commitCandidate(candidate);
      previewPlan.proposalItem.status = 'applied';
      currentConversation.items.filter((item) => item.type === 'proposal' && item !== previewPlan.proposalItem && item.status !== 'applied')
        .forEach((item) => { item.status = 'stale'; });
      closePreview();
      document.getElementById('ai-apply-proposal').disabled = true;
      renderConversation();
      setStatus('提案を適用しました。必要なら最新状態について改めて依頼してください。');
    } catch (error) { setStatus(error.message, 'error'); }
  });
  window.aiAssistant = {
    onScopeChange() {
      if (currentConversation) currentConversation.selectedIds = [...editor.selectedIds];
    }
  };
  window.aiAssistant.onScopeChange();

  window.addEventListener('pagehide', () => {
    activeRequestController?.abort();
    keyInput.value = '';
    conversations.length = 0;
    currentConversation = null;
    messages.replaceChildren();
  });

  fetch('data/input/current-class-data-version.txt', { cache: 'no-store' })
    .then((response) => { if (!response.ok) throw new Error('データ版ファイルを取得できません。'); return response.text(); })
    .then((value) => { sourceDataVersion = value.trim(); if (!sourceDataVersion) throw new Error('データ版が空です。'); })
    .catch(() => {
      setStatus('データ版を確認できません。通信状態を確認してください。AI提案は確認できるまで送信できません。APIキーの確認・入力は', 'error');
      appendSettingsLink();
    });
})();
