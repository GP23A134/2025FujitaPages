// AI提案は表示・検証だけを行い、利用者が適用するまで編集データには触れない。
(() => {
  const editor = window.classEditorAI;
  if (!editor) return;

  const API_URL = 'https://api.openai.com/v1/responses';

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
      baseDataHash: { type: 'string' },
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
      questions: { type: 'array', items: { type: 'string' } }
    },
    required: ['baseDataHash', 'message', 'proposals', 'questions']
  };

  const keyInput = document.getElementById('ai-api-key');
  const modelSelect = document.getElementById('ai-model');
  const settingsStatus = document.getElementById('ai-settings-status');
  let modelConfig = null;
  const systemPromptPromise = fetch('data/web/ai-system-prompt.md', { cache: 'no-store' })
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
  const modelConfigPromise = fetch('data/web/ai-models.json', { cache: 'no-store' })
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
  const conversations = [];
  let currentConversation = null;
  let previewPlan = null;
  let sourceDataVersion = '';
  let isSending = false;
  let activeRequestController = null;

  const createConversation = (selectedIds = editor.selectedIds) => {
    const conversation = {
      id: `chat-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      title: '新しい相談',
      updatedAt: Date.now(),
      selectedIds: [...selectedIds],
      responseId: '',
      initialSnapshotSent: false,
      previousScope: null,
      items: [],
      status: ''
    };
    conversations.unshift(conversation);
    return conversation;
  };
  currentConversation = createConversation();

  const setStatus = (text, kind = '') => {
    status.textContent = text;
    status.className = `ai-status${kind ? ` is-${kind}` : ''}`;
    if (currentConversation) currentConversation.status = text;
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
  const renderConversation = () => {
    messages.replaceChildren();
    currentConversation.items.forEach((item) => {
      if (item.type === 'message') renderMessage(item);
      else if (item.type === 'proposal') renderProposalCard(item);
    });
    messages.scrollTop = messages.scrollHeight;
    status.textContent = currentConversation.status || '';
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
  const diffScope = (before, after) => {
    if (!before) return { kind: 'initial_snapshot', data: after };
    const mapById = (items) => new Map(items.map((item) => [item.id, item]));
    const beforeClasses = mapById(before.classes); const afterClasses = mapById(after.classes);
    const changedClasses = [...afterClasses.values()].filter((item) => JSON.stringify(item) !== JSON.stringify(beforeClasses.get(item.id)));
    const removedClasses = [...beforeClasses.keys()].filter((id) => !afterClasses.has(id));
    const relationKey = ({ child, parent }) => `${child}\u0000${parent}`;
    const beforeRelations = new Set(before.relations.map(relationKey));
    const afterRelations = new Set(after.relations.map(relationKey));
    const beforeCounts = before.counts || {}; const afterCounts = after.counts || {};
    const changedCounts = Object.fromEntries(Object.entries(afterCounts).filter(([id, count]) => beforeCounts[id] !== count));
    return {
      kind: 'scope_and_data_diff',
      selectedIds: after.selectedIds,
      editableScopeIds: after.editableIds,
      addedOrChangedClasses: changedClasses,
      removedClassIds: removedClasses,
      addedRelations: after.relations.filter((item) => !beforeRelations.has(relationKey(item))),
      removedRelations: before.relations.filter((item) => !afterRelations.has(relationKey(item))),
      changedAggregateCounts: changedCounts,
      currentScopeClassIds: after.classes.map((item) => item.id)
    };
  };
  const getPayloadSnapshot = () => {
    const selectedIds = editor.selectedIds;
    if (!selectedIds.length) throw new Error('ツリーで対象にするクラスを選択してください。');
    return editor.getScopedState(selectedIds);
  };
  const formatHttpError = (body, response) => {
    const apiMessage = body?.error?.message;
    if (response.status === 401) return 'APIキーを確認してください。認証に失敗しました。';
    if (response.status === 429) return 'APIの利用上限またはレート制限に達しました。時間をおいて再依頼してください。';
    if (response.status === 400 && apiMessage) return `依頼を送信できませんでした: ${apiMessage}`;
    return apiMessage || `OpenAI APIへの接続に失敗しました（HTTP ${response.status}）。`;
  };
  const operationLabel = (operation) => {
    if (operation.type === 'addClass') return `${operation.classType === 'top' ? '上位' : '中間'}クラス「${operation.label}」を追加`;
    if (operation.type === 'renameClass') return `「${labelFor(operation.classId)}」を「${operation.label}」に改名`;
    if (operation.type === 'moveClass') return `「${labelFor(operation.classId)}」を「${labelFor(operation.destinationId)}」へ移動`;
    if (operation.type === 'moveChildren') return `「${labelFor(operation.from)}」の配下を「${labelFor(operation.to)}」へ移動`;
    if (operation.type === 'deleteClass') return `「${labelFor(operation.classId)}」を削除`;
    return '不明な操作';
  };
  const labelFor = (id) => {
    const temporary = currentConversation.items.filter((item) => item.type === 'proposal')
      .flatMap((item) => item.proposal.operations || [])
      .find((operation) => operation.type === 'addClass' && operation.temporaryId === id);
    if (temporary) return temporary.label;
    return editor.getState().classes.find((item) => item.id === id)?.label || id || '未指定';
  };
  const excerpt = (value, limit = 180) => {
    const text = String(value || '');
    return text.length > limit ? `${text.slice(0, limit)}…` : text;
  };
  const renderProposalCard = (item) => {
    const proposal = item.proposal;
    const card = document.createElement('article'); card.className = `ai-proposal-card is-${item.status}`;
    const contentLabel = document.createElement('strong'); contentLabel.className = 'ai-proposal-label'; contentLabel.textContent = '変更内容';
    const summary = document.createElement('p'); summary.className = 'ai-proposal-summary'; summary.textContent = excerpt(proposal.summary || proposal.title);
    const reasonLabel = document.createElement('strong'); reasonLabel.className = 'ai-proposal-label'; reasonLabel.textContent = '理由';
    const reason = document.createElement('p'); reason.className = 'ai-proposal-reason'; reason.textContent = excerpt(proposal.reason);
    card.append(contentLabel, summary, reasonLabel, reason);

    const details = document.createElement('details'); details.className = 'ai-proposal-details';
    const detailsSummary = document.createElement('summary'); detailsSummary.textContent = '詳細を見る';
    const detailBody = document.createElement('div'); detailBody.className = 'ai-proposal-detail-body';
    if (proposal.summary && proposal.summary !== summary.textContent) {
      const fullContent = document.createElement('p'); fullContent.textContent = proposal.summary; detailBody.append(fullContent);
    }
    if (proposal.reason && proposal.reason !== reason.textContent) {
      const fullReason = document.createElement('p'); fullReason.textContent = proposal.reason; detailBody.append(fullReason);
    }
    const operations = document.createElement('ul');
    proposal.operations.forEach((operation) => { const row = document.createElement('li'); row.textContent = operationLabel(operation); operations.append(row); });
    if (operations.childElementCount) detailBody.append(operations);
    if (proposal.uncertainties.length) {
      const note = document.createElement('p'); note.className = 'ai-proposal-uncertainty'; note.textContent = `不確かな点: ${proposal.uncertainties.join('、')}`; detailBody.append(note);
    }
    details.append(detailsSummary, detailBody);
    card.append(details);

    const actions = document.createElement('div'); actions.className = 'ai-proposal-actions';
    const preview = document.createElement('button'); preview.type = 'button'; preview.className = 'ai-proposal-preview'; preview.textContent = 'プレビュー';
    const apply = document.createElement('button'); apply.type = 'button'; apply.className = 'search-button ai-proposal-apply'; apply.textContent = '適用';
    const statusLabel = document.createElement('span'); statusLabel.className = 'ai-proposal-status';
    const statusText = { pending: '', previewed: '確認済み', stale: '適用後の状態で再確認が必要', applied: '適用済み' };
    statusLabel.textContent = statusText[item.status] || '';
    const unavailable = item.status === 'applied';
    preview.disabled = unavailable || item.status === 'invalid';
    apply.disabled = unavailable || item.status === 'invalid';
    preview.addEventListener('click', () => {
      void showPreview(item, false).catch((error) => setStatus(error.message, 'error'));
    });
    apply.addEventListener('click', () => {
      void showPreview(item, true).catch((error) => setStatus(error.message, 'error'));
    });
    actions.append(preview, apply, statusLabel);
    card.append(actions);
    messages.append(card);
  };
  const appendTree = (host, state, affectedIds = new Set()) => {
    const classesById = new Map(state.classes.map((item) => [item.id, item]));
    const children = new Map(); const parentIds = new Set();
    state.relations.forEach(({ child, parent }) => { if (!children.has(parent)) children.set(parent, []); children.get(parent).push(child); parentIds.add(child); });
    const roots = state.classes.filter((item) => item.type === 'top' && !parentIds.has(item.id));
    const rootList = document.createElement('ul'); rootList.className = 'ai-tree-list';
    const buildNode = (id, path = new Set()) => {
      const item = classesById.get(id); if (!item || path.has(id)) return null;
      const li = document.createElement('li');
      const row = document.createElement('span'); row.className = 'ai-tree-node';
      if (affectedIds.has(id)) row.classList.add('is-changed');
      row.textContent = `${item.label} (${item.type === 'top' ? '上位' : item.type === 'middle' ? '中間' : '対象'})`;
      li.append(row);
      const descendants = (children.get(id) || []).map((child) => buildNode(child, new Set(path).add(id))).filter(Boolean);
      if (descendants.length) { const nested = document.createElement('ul'); nested.className = 'ai-tree-list'; nested.append(...descendants); li.append(nested); }
      return li;
    };
    roots.sort((a, b) => a.label.localeCompare(b.label, 'ja')).map((item) => buildNode(item.id)).filter(Boolean).forEach((item) => rootList.append(item));
    host.replaceChildren(rootList);
  };
  const showPreview = async (proposalItem, applyRequested = false) => {
    const applyButton = document.getElementById('ai-apply-proposal');
    applyButton.disabled = true;
    previewPlan = null;
    const operations = proposalItem.proposal.operations;
    if (!operations.length) throw new Error('変更操作が残っていません。この提案は適用する内容がありません。');
    await verifyLoadedDataVersion();
    if (proposalItem.status !== 'stale' && proposalItem.baseDataHash !== await currentDataHash()) {
      throw new Error('提案作成後にデータが変更されています。最新状態で依頼し直してください。');
    }
    const expectedFingerprint = stateFingerprint();
    const candidate = editor.applyOperations(operations, expectedFingerprint, proposalItem.editableIds);
    const expectedBaseHash = await currentDataHash();
    if (proposalItem.status === 'stale') {
      proposalItem.baseDataHash = expectedBaseHash;
      proposalItem.status = 'previewed';
    } else if (proposalItem.status === 'pending') {
      proposalItem.status = 'previewed';
    }
    renderConversation();
    if (stateFingerprint() !== expectedFingerprint) throw new Error('プレビュー作成中にデータが変更されました。最新データで提案し直してください。');
    const operationIds = new Set();
    operations.forEach((operation) => ['classId', 'destinationId', 'from', 'to'].forEach((key) => { if (operation[key]) operationIds.add(operation[key]); }));
    candidate.classes.filter((item) => !editor.getState().classes.some((old) => old.id === item.id)).forEach((item) => operationIds.add(item.id));
    const beforeState = editor.getState();
    const before = document.getElementById('ai-preview-before'); const after = document.getElementById('ai-preview-after');
    appendTree(before, beforeState, operationIds); appendTree(after, candidate, operationIds);
    const beforeParents = new Map(beforeState.relations.map(({ child, parent }) => [child, parent]));
    const afterParents = new Map(candidate.relations.map(({ child, parent }) => [child, parent]));
    const movedTargets = beforeState.classes.filter((item) => item.type === 'class'
      && beforeParents.get(item.id) !== afterParents.get(item.id));
    const movedTargetCount = movedTargets.reduce((sum, item) => sum + (editor.getState().counts[item.id] || 0), 0);
    document.getElementById('ai-preview-impact').textContent = `操作 ${operations.length}件。対象クラス ${movedTargets.length}件、関連インスタンス ${movedTargetCount}件の分類先が変わります。インスタンス自体は変更しません。`;
    const opList = document.getElementById('ai-preview-operations'); opList.replaceChildren();
    operations.forEach((operation, index) => {
      const row = document.createElement('div'); row.className = 'ai-preview-operation';
      const label = document.createElement('span'); label.textContent = operationLabel(operation);
      row.append(label);
      if (operation.type === 'moveClass') {
        const select = document.createElement('select'); select.setAttribute('aria-label', `「${labelFor(operation.classId)}」の移動先`);
        candidate.classes.filter((item) => ['top', 'middle'].includes(item.type) && item.id !== operation.classId)
          .forEach((item) => { const option = document.createElement('option'); option.value = item.id; option.textContent = `${item.label} (${item.type === 'top' ? '上位' : '中間'})`; option.selected = item.id === operation.destinationId; select.append(option); });
        select.addEventListener('change', () => {
          operations[index].destinationId = select.value;
          void showPreview(proposalItem, applyRequested).catch((error) => setStatus(error.message, 'error'));
        });
        row.append(select);
        const keep = document.createElement('button'); keep.type = 'button'; keep.className = 'held-action-button';
        keep.textContent = 'このクラスは移動しない';
        keep.addEventListener('click', () => {
          operations.splice(index, 1);
          void showPreview(proposalItem, applyRequested).catch((error) => setStatus(error.message, 'error'));
        });
        row.append(keep);
      }
      opList.append(row);
    });
    previewPlan = { proposalItem, operations: operations.map((operation) => ({ ...operation })), candidate, expectedFingerprint, expectedBaseHash };
    applyButton.disabled = false;
    if (!previewDialog.open) previewDialog.showModal();
    if (applyRequested) applyButton.focus();
  };

  const validatePayload = (result, expectedHash) => {
    if (!result || typeof result !== 'object' || result.baseDataHash !== expectedHash
      || !Array.isArray(result.proposals) || !Array.isArray(result.questions)) throw new Error('AIの提案形式またはデータ版が不正です。提案は適用できません。');
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
  const sendRequest = async (userText) => {
    if (isSending) return;
    const key = keyInput.value.trim();
    if (!key) { setStatus('設定欄にOpenAI APIキーを入力してください。', 'error'); keyInput.focus(); return; }
    if (!await modelConfigPromise) { setStatus('モデル設定を読み込めないため依頼を送信できません。', 'error'); return; }
    const systemPrompt = await systemPromptPromise;
    if (!systemPrompt) { setStatus('AIプロンプトを読み込めないため依頼を送信できません。', 'error'); return; }
    let scope;
    try { scope = getPayloadSnapshot(); } catch (error) { setStatus(error.message, 'error'); return; }
    try { await verifyLoadedDataVersion(); }
    catch (error) { setStatus(error.message, 'error'); return; }
    let baseDataHash;
    try { baseDataHash = await currentDataHash(); }
    catch (error) { setStatus(error.message, 'error'); return; }
    const fingerprintBeforeRequest = stateFingerprint();
    const conversation = currentConversation;
    const contextPayload = diffScope(conversation.initialSnapshotSent ? conversation.previousScope : null, scope);
    const userContent = JSON.stringify({
      baseDataHash,
      request: userText,
      selectedScope: contextPayload,
      instruction: 'この相談の範囲にあるクラスの提案だけを返してください。個別インスタンス情報はありません。'
    });
    textInput.value = '';
    conversation.selectedIds = [...editor.selectedIds];
    conversation.items.push({ type: 'message', role: 'user', text: userText });
    conversation.updatedAt = Date.now();
    refreshConversationTitle(conversation);
    renderConversation();
    setStatus('OpenAI APIに接続しています…');
    isSending = true; sendButton.disabled = true; document.getElementById('ai-new-consultation').disabled = true;
    try {
      const body = {
        model: modelSelect.value,
        reasoning: { effort: 'low' },
        instructions: systemPrompt,
        input: userContent,
        text: { format: { type: 'json_schema', name: 'class_edit_proposals', strict: true, schema: responseSchema } },
        max_output_tokens: 5000,
        store: true
      };
      if (conversation.responseId) body.previous_response_id = conversation.responseId;
      activeRequestController = new AbortController();
      const response = await fetch(API_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
        body: JSON.stringify(body),
        signal: activeRequestController.signal
      });
      const responseBody = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(formatHttpError(responseBody, response));
      if (stateFingerprint() !== fingerprintBeforeRequest) throw new Error('依頼中に編集データが変わりました。最新状態で再依頼してください。');
      const result = JSON.parse(readResponseText(responseBody));
      validatePayload(result, baseDataHash);
      conversation.responseId = responseBody.id || '';
      if (!conversation.responseId) throw new Error('会話IDを取得できませんでした。新しい相談からやり直してください。');
      conversation.initialSnapshotSent = true;
      conversation.previousScope = scope;
      if (result.message) conversation.items.push({ type: 'message', role: 'assistant', text: result.message });
      result.questions.forEach((question) => conversation.items.push({ type: 'message', role: 'assistant', text: question }));
      result.proposals.forEach((proposal) => {
        if (proposal.questions.length) {
          proposal.questions.forEach((question) => conversation.items.push({ type: 'message', role: 'assistant', text: question }));
          return;
        }
        conversation.items.push({ type: 'proposal', proposal, editableIds: [...scope.editableIds], baseDataHash, status: 'pending' });
      });
      conversation.updatedAt = Date.now();
      renderConversation();
      setStatus(result.proposals.length ? '提案を確認し、プレビューしてから適用してください。' : '変更案はありません。確認事項への回答や追加依頼を入力できます。');
    } catch (error) {
      setStatus(error.message || '接続に失敗しました。設定と通信状態を確認してください。', 'error');
    } finally {
      isSending = false; sendButton.disabled = false; document.getElementById('ai-new-consultation').disabled = false; activeRequestController = null;
    }
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
    if (event.key === 'Enter' && event.shiftKey && !event.isComposing) {
      event.preventDefault(); document.getElementById('ai-chat-form').requestSubmit();
    }
  });
  const closePreview = () => { previewDialog.close(); previewPlan = null; };
  previewDialog.addEventListener('close', () => {
    previewPlan = null;
    document.getElementById('ai-apply-proposal').disabled = true;
  });
  document.getElementById('ai-preview-close').addEventListener('click', closePreview);
  document.getElementById('ai-preview-cancel').addEventListener('click', closePreview);
  document.getElementById('ai-apply-proposal').addEventListener('click', async () => {
    if (!previewPlan) return;
    try {
      await verifyLoadedDataVersion();
      const currentHash = await currentDataHash();
      if (currentHash !== previewPlan.expectedBaseHash) throw new Error('提案の作成後にデータが変更されました。最新データで提案し直してください。');
      const candidate = editor.applyOperations(previewPlan.operations, previewPlan.expectedFingerprint, previewPlan.proposalItem.editableIds);
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
    .catch((error) => setStatus(`${error.message}。編集画面は利用できますが、AI提案はデータ版を確認できるまで送信できません。`, 'error'));
})();
