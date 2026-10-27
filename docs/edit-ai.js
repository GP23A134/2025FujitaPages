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
      questions: { type: 'array', items: { type: 'string' } }
    },
    required: ['message', 'proposals', 'questions']
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
  let classLabelsById = new Map();
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
  const renderConversation = ({ scrollToBottom = false } = {}) => {
    const previousScrollTop = messages.scrollTop;
    classLabelsById = new Map(editor.getState().classes.map((item) => [item.id, item.label]));
    temporaryLabelsById = new Map(currentConversation.items
      .filter((item) => item.type === 'proposal')
      .flatMap((item) => item.proposal.operations || [])
      .filter((operation) => operation.type === 'addClass' && operation.temporaryId)
      .map((operation) => [operation.temporaryId, operation.label]));
    messages.replaceChildren();
    currentConversation.items.forEach((item) => {
      if (item.type === 'message') renderMessage(item);
      else if (item.type === 'proposal') renderProposalCard(item);
    });
    messages.scrollTop = scrollToBottom ? messages.scrollHeight : previousScrollTop;
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
  const compactScope = (scope) => ({
    mode: scope.mode || 'selected_scope',
    selectedIds: [...(scope.selectedIds || [])],
    editableIds: [...(scope.editableIds || [])],
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
      editableScopeIds: current.editableIds,
      addedOrChangedClasses: changedClasses,
      removedClassIds: removedClasses,
      addedRelations: current.relations.filter((item) => !beforeRelations.has(relationKey(item))),
      removedRelations: previous.relations.filter((item) => !afterRelations.has(relationKey(item))),
      currentScopeClassIds: current.classes.map(([id]) => id)
    };
  };
  const getPayloadSnapshot = () => {
    const selectedIds = editor.selectedIds;
    if (!selectedIds.length) return editor.getOverviewState();
    return editor.getScopedState(selectedIds);
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
    if (operation.type === 'moveClass') return `「${labelFor(operation.classId)}」を「${labelFor(operation.destinationId)}」へ移動`;
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
      document.getElementById('ai-preview-impact').textContent = `プレビューを作成できませんでした: ${message}`;
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
    const updateStatus = () => {
      statusLabel.textContent = item.status === 'previewed' ? '確認済み' : item.status === 'stale' ? '適用後の状態で再確認が必要' : '';
      card.className = `ai-proposal-card is-${item.status}`;
    };
    preview.addEventListener('click', () => {
      void showPreview(item, false).then(updateStatus).catch(reportPreviewError);
    });
    apply.addEventListener('click', () => {
      void showPreview(item, true).then(updateStatus).catch(reportPreviewError);
    });
    actions.append(preview, apply, statusLabel);
    card.append(actions);
    messages.append(card);
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
  const showPreview = async (proposalItem, applyRequested = false) => {
    const applyButton = document.getElementById('ai-apply-proposal');
    applyButton.disabled = true;
    previewPlan = null;
    const operations = proposalItem.proposal.operations;
    if (!operations.length) throw new Error('変更操作が残っていません。この提案は適用する内容がありません。');
    proposalItem.excludedOperationIndexes ||= new Set();
    document.getElementById('ai-preview-impact').textContent = '現在の階層に変更案を反映しています…';
    document.getElementById('ai-preview-before').replaceChildren();
    document.getElementById('ai-preview-after').replaceChildren();
    if (!previewDialog.open) previewDialog.showModal();
    await new Promise((resolve) => requestAnimationFrame(resolve));
    await verifyLoadedDataVersion();
    if (proposalItem.status !== 'stale' && proposalItem.baseDataHash !== await currentDataHash()) {
      throw new Error('提案作成後にデータが変更されています。最新状態で依頼し直してください。');
    }
    const expectedFingerprint = stateFingerprint();
    const proposedCandidate = editor.applyOperations(operations, expectedFingerprint, proposalItem.editableIds);
    const activeOperations = operations.filter((_, index) => !proposalItem.excludedOperationIndexes.has(index));
    const candidate = editor.applyOperations(activeOperations, expectedFingerprint, proposalItem.editableIds);
    const expectedBaseHash = await currentDataHash();
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
      return proposedCandidate.classes.find((item) => !beforeIds.has(item.id)
        && item.type === addition.classType && item.label === String(addition.label || '').trim()) || null;
    };
    const resolveProposedId = (reference) => proposedIds.has(reference) || beforeIds.has(reference)
      ? reference : addedClassForReference(reference)?.id || reference;
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
    appendTree(before, previewState(beforeState), affectedIds);
    appendTree(after, previewState(proposedDisplayState), affectedIds, {
      selectable: true,
      operationIndexesByClass,
      deletionOperationByClass,
      excludedOperationIndexes: proposalItem.excludedOperationIndexes,
      onToggle: (indexes, include) => {
        const previous = new Set(proposalItem.excludedOperationIndexes);
        indexes.forEach((index) => include
          ? proposalItem.excludedOperationIndexes.delete(index)
          : proposalItem.excludedOperationIndexes.add(index));
        void showPreview(proposalItem, false).catch((error) => {
          proposalItem.excludedOperationIndexes = previous;
          reportPreviewError(error);
          void showPreview(proposalItem, false).catch(reportPreviewError);
        });
      }
    });
    const activeParents = new Map(candidate.relations.map(({ child, parent }) => [child, parent]));
    const movedTargets = beforeState.classes.filter((item) => item.type === 'class'
      && beforeParents.get(item.id) !== activeParents.get(item.id));
    const movedTargetCount = movedTargets.reduce((sum, item) => sum + (beforeState.counts[item.id] || 0), 0);
    document.getElementById('ai-preview-impact').textContent = `選択中の変更 ${activeOperations.length}/${operations.length}件。対象クラス ${movedTargets.length}件、関連インスタンス ${movedTargetCount}件の分類先が変わります。変更後ツリーの選択で適用対象を切り替えられます。`;
    previewPlan = { proposalItem, operations: activeOperations.map((operation) => ({ ...operation })), candidate, expectedFingerprint, expectedBaseHash };
    applyButton.disabled = activeOperations.length === 0;
    if (applyRequested && activeOperations.length) applyButton.focus();
  };

  const validatePayload = (result, expectedHash) => {
    if (!result || typeof result !== 'object' || Array.isArray(result)) {
      throw new Error('AIの応答がJSONオブジェクトではありません。提案は適用できません。');
    }
    if (!Array.isArray(result.proposals) || !Array.isArray(result.questions)) {
      throw new Error('AIの応答に提案または確認事項の一覧がありません。もう一度依頼してください。');
    }
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
          ? 'これは階層クラスだけの範囲です。対象クラスの個別情報は含まれません。上位・中間クラスの追加・改名・移動・削除だけを提案し、対象クラスの操作は提案しないでください。'
          : 'この相談の範囲にあるクラスの提案だけを返してください。個別インスタンスデータと件数は含みません。')
    });
  };
  const makeLargeScopePlan = (userText, scope, conversation, baseDataHash) => {
    const selectedClasses = scope.selectedIds.map((id) => scope.classes.find((item) => item.id === id)).filter(Boolean);
    const isHierarchySelection = selectedClasses.length === scope.selectedIds.length
      && selectedClasses.length > 0
      && selectedClasses.every((item) => ['top', 'middle'].includes(item.type));
    if (!isHierarchySelection) return null;

    const hierarchyScope = editor.getHierarchyScopedState(scope.selectedIds);
    if (!hierarchyScope) return null;
    const hierarchyInstruction = 'この分割処理では上位・中間クラスの階層構造だけを検討してください。対象クラスの変更案は作らず、入力にない情報を推測しないでください。';
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
        selectedIds: [...scope.selectedIds],
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
        selectedIds: [...scope.selectedIds],
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
        selectedIds: [...scope.selectedIds],
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
  const validateSplitTaskOperations = (result, task) => {
    const editable = new Set(task.scope.editableIds);
    const classesById = new Map(task.scope.classes.map((item) => [item.id, item]));
    let discardedOperationCount = 0;
    result.proposals.forEach((proposal) => {
      const originalOperationCount = proposal.operations.length;
      const temporaryIds = new Set(proposal.operations
        .filter((operation) => operation.type === 'addClass' && operation.temporaryId)
        .map((operation) => operation.temporaryId));
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
        if (operation.type === 'moveClass' && !isDestination(operation.destinationId)) return false;
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
  const sendRequest = async (userText) => {
    if (isSending) return;
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
    let scope;
    try { scope = getPayloadSnapshot(); } catch (error) { setStatus(error.message, 'error'); return; }
    try { await verifyLoadedDataVersion(); }
    catch (error) { setStatus(error.message, 'error'); return; }
    let baseDataHash;
    try { baseDataHash = await currentDataHash(); }
    catch (error) { setStatus(error.message, 'error'); return; }
    const fingerprintBeforeRequest = stateFingerprint();
    const conversation = currentConversation;
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
    textInput.value = '';
    conversation.selectedIds = [...editor.selectedIds];
    conversation.items.push({ type: 'message', role: 'user', text: userText });
    if (splitTasks) conversation.items.push({ type: 'message', role: 'assistant', text: `選択範囲のクラスを省略せず、送信上限内で分割件数をできるだけ少なくした${splitTasks.length}件の依頼として送信します。各案は分割範囲と親階層の文脈を基準にします。分割した依頼は2件ずつ並行処理します。枝をまたぐ構造変更を適用した後は、必要に応じて再評価を依頼してください。` });
    conversation.updatedAt = Date.now();
    refreshConversationTitle(conversation);
    renderConversation({ scrollToBottom: true });
    setStatus(splitTasks ? `OpenAI APIに接続しています…（分割 0/${splitTasks.length}）` : 'OpenAI APIに接続しています…');
    isSending = true; sendButton.disabled = true; document.getElementById('ai-new-consultation').disabled = true;
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
        return { responseBody, result: JSON.parse(readResponseText(responseBody)) };
      };
      let result;
      let responseId = '';
      const proposalScopes = new Map();
      const proposalPreviewScopes = new Map();
      if (splitTasks) {
        result = { baseDataHash, message: '', proposals: [], questions: [] };
        const messagesFromParts = [];
        const splitWarnings = new Set();
        for (let offset = 0; offset < splitTasks.length; offset += 2) {
          const batch = splitTasks.slice(offset, offset + 2);
          setStatus(`OpenAI APIに接続しています…（分割 ${offset + 1}〜${offset + batch.length}/${splitTasks.length}）`);
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
            part.result.proposals.forEach((proposal) => {
              if (proposal.operations.length) {
                try {
                  editor.applyOperations(proposal.operations, fingerprintBeforeRequest, task.scope.editableIds);
                } catch (error) {
                  proposal.operations = [];
                  proposal.questions.push(`この案は選択範囲全体で適用可能と確認できなかったため、プレビュー対象から外しました。${error.message}`);
                }
              }
              result.proposals.push(proposal);
              proposalScopes.set(proposal.id, [...task.scope.editableIds]);
            proposalPreviewScopes.set(proposal.id, task.scope.classes.map((item) => item.id));
            });
          });
          if (stateFingerprint() !== fingerprintBeforeRequest) throw new Error('依頼中に編集データが変わりました。最新状態で再依頼してください。');
        }
        result.message = messagesFromParts.join('\n');
        result.questions.push(...splitWarnings);
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
        });
        if (stateFingerprint() !== fingerprintBeforeRequest) throw new Error('依頼中に編集データが変わりました。最新状態で再依頼してください。');
      }
      if (result.message) conversation.items.push({ type: 'message', role: 'assistant', text: result.message });
      result.questions.forEach((question) => conversation.items.push({ type: 'message', role: 'assistant', text: question }));
      result.proposals.forEach((proposal) => {
        if (proposal.questions.length) {
          proposal.questions.forEach((question) => conversation.items.push({ type: 'message', role: 'assistant', text: question }));
          return;
        }
        conversation.items.push({
          type: 'proposal',
          proposal,
          editableIds: proposalScopes.get(proposal.id) || [...scope.editableIds],
          previewClassIds: proposalPreviewScopes.get(proposal.id) || scope.classes.map((item) => item.id),
          baseDataHash,
          status: 'pending'
        });
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
