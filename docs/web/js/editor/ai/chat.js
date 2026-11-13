// 会話表示用の履歴をブラウザーの保存領域へ保存・復元します。
// APIキーや送信時だけ必要な一時状態は、このストアへ渡しません。
export const createConversationStore = ({ conversations, savedConversationsKey, boundSplitChunkCache,
    MAX_CACHED_SPLIT_SUMMARY_CHARACTERS, MAX_CACHED_SPLIT_FOLLOWUP_CHARACTERS, logProblem = () => {} }) => {
  const archiveDataRequest = (item) => {
    const requested = [
      ...(item.requests || []).map(({ item: requestedClass }) => requestedClass?.label || requestedClass?.id),
      ...(item.candidateGroups || []).flatMap((group) => (group.candidates || []).map(({ item: candidate }) => candidate?.label || candidate?.id))
    ].filter(Boolean);
    return {
      type: 'message', role: 'assistant',
      text: `前回の相談では追加クラス情報の共有を求めていました${requested.length ? `（${[...new Set(requested)].join('、')}）` : ''}。追加共有の仕組みは現在利用できません。必要なクラスを含む範囲を選択して、改めて依頼してください。`
    };
  };
  const restoreSavedConversations = () => {
    try {
      const stored = JSON.parse(localStorage.getItem(savedConversationsKey) || '[]');
      if (!Array.isArray(stored)) return [];
      return stored.filter((item) => item && typeof item.id === 'string' && Array.isArray(item.items))
        .map((item) => ({
          id: item.id,
          title: typeof item.title === 'string' ? item.title : '保存した相談',
          titleIsCustom: Boolean(item.titleIsCustom),
          updatedAt: Number.isFinite(item.updatedAt) ? item.updatedAt : Date.now(),
          selectedIds: Array.isArray(item.selectedIds) ? item.selectedIds.filter((id) => typeof id === 'string') : [],
          responseId: '', initialSnapshotSent: false, previousScope: null, localContext: '',
          splitMemory: item.splitMemory && typeof item.splitMemory === 'object'
            && typeof item.splitMemory.baseDataHash === 'string'
            && typeof item.splitMemory.summaryText === 'string'
            ? {
              baseDataHash: item.splitMemory.baseDataHash,
              selectedIds: Array.isArray(item.splitMemory.selectedIds) ? item.splitMemory.selectedIds.filter((id) => typeof id === 'string') : [],
              sharedContextIds: Array.isArray(item.splitMemory.sharedContextIds) ? item.splitMemory.sharedContextIds.filter((id) => typeof id === 'string') : [],
              mode: typeof item.splitMemory.mode === 'string' ? item.splitMemory.mode : 'selected_scope',
              scopeCoverage: item.splitMemory.scopeCoverage === 'all_classes' ? 'all_classes' : 'selected_classes',
              model: typeof item.splitMemory.model === 'string' ? item.splitMemory.model : '',
              chunkCache: Array.isArray(item.splitMemory.chunkCache) ? item.splitMemory.chunkCache
                .filter((entry) => entry && typeof entry.key === 'string' && entry.result && typeof entry.result === 'object')
                .map((entry) => ({ key: entry.key, result: entry.result }))
                .reduce((bounded, entry) => boundSplitChunkCache([...bounded, entry]), []) : [],
              summaryText: item.splitMemory.summaryText.slice(0, MAX_CACHED_SPLIT_SUMMARY_CHARACTERS),
              followupContext: typeof item.splitMemory.followupContext === 'string'
                ? item.splitMemory.followupContext.slice(-MAX_CACHED_SPLIT_FOLLOWUP_CHARACTERS) : ''
            } : null,
          items: item.items.flatMap((entry) => {
            if (!entry || typeof entry !== 'object') return [];
            if (entry.type === 'data-requests') return [archiveDataRequest(entry)];
            if (entry.type === 'proposal') return [{ ...entry, status: 'invalid' }];
            if (entry.type === 'questions') return [{ ...entry, submitting: false }];
            if (entry.type === 'message' && ['user', 'assistant'].includes(entry.role)) return [entry];
            if (entry.type === 'workflow-status' && typeof entry.text === 'string') return [entry];
            if (entry.type === 'scope-summary' && Array.isArray(entry.classes)) return [entry];
            return [];
          }),
          status: '',
          usage: { requests: 0, inputTokens: 0, outputTokens: 0, costUsd: 0, costKnown: true },
          saved: true,
          restoredFromStorage: true
        }));
    } catch (error) {
      logProblem('会話履歴の復元', error);
      return [];
    }
  };
  const persistSavedConversations = () => {
    const saved = conversations.filter((conversation) => conversation.saved).map((conversation) => ({
      id: conversation.id,
      title: conversation.title,
      titleIsCustom: Boolean(conversation.titleIsCustom),
      updatedAt: conversation.updatedAt,
      selectedIds: conversation.selectedIds,
      splitMemory: conversation.splitMemory ? {
        ...conversation.splitMemory,
        scopeCoverage: conversation.splitMemory.scopeCoverage === 'all_classes' ? 'all_classes' : 'selected_classes',
        chunkCache: boundSplitChunkCache(conversation.splitMemory.chunkCache || []),
        summaryText: String(conversation.splitMemory.summaryText || '').slice(0, MAX_CACHED_SPLIT_SUMMARY_CHARACTERS),
        followupContext: String(conversation.splitMemory.followupContext || '').slice(-MAX_CACHED_SPLIT_FOLLOWUP_CHARACTERS)
      } : null,
      items: conversation.items
    }));
    try {
      localStorage.setItem(savedConversationsKey, JSON.stringify(saved));
      return true;
    } catch (error) {
      logProblem('会話履歴の保存', error);
      return { message: '相談を保存できませんでした。ブラウザーの保存容量を確認してください。' };
    }
  };
    return { restoreSavedConversations, persistSavedConversations };
};

// 会話メッセージと保存済み履歴一覧のDOM描画を担当します。
// 送信判断やデータ変更は行わず、必要な状態や操作はコールバック経由で受け取ります。
export const createConversationView = ({
    messages,
    historyList,
    getConversations,
    getCurrentConversation,
    isSending,
    activateConversation,
    persistSavedConversations,
    setStatus
  }) => {
    const appendInlineText = (parent, text) => {
      const parts = String(text).split(/(\*\*[^*]+\*\*)/g);
      parts.forEach((part) => {
        if (part.startsWith('**') && part.endsWith('**')) {
          const strong = document.createElement('strong');
          strong.textContent = part.slice(2, -2);
          parent.append(strong);
        } else if (part) parent.append(document.createTextNode(part));
      });
    };
    const renderAssistantText = (body, text) => {
      const lines = String(text || '').replace(/\r\n?/g, '\n').split('\n');
      let index = 0;
      while (index < lines.length) {
        while (index < lines.length && !lines[index].trim()) index += 1;
        if (index >= lines.length) break;
        const heading = lines[index].match(/^#{1,3}\s+(.+)$/);
        if (heading) {
          const title = document.createElement('strong');
          title.className = 'ai-message-heading';
          appendInlineText(title, heading[1].trim());
          body.append(title);
          index += 1;
          continue;
        }
        const firstBullet = lines[index].match(/^\s*[-*・]\s+(.+)$/);
        const firstNumber = lines[index].match(/^\s*\d+[.)、]\s+(.+)$/);
        if (firstBullet || firstNumber) {
          const ordered = Boolean(firstNumber);
          const list = document.createElement(ordered ? 'ol' : 'ul');
          while (index < lines.length) {
            const match = lines[index].match(ordered ? /^\s*\d+[.)、]\s+(.+)$/ : /^\s*[-*・]\s+(.+)$/);
            if (!match) break;
            const item = document.createElement('li');
            appendInlineText(item, match[1].trim());
            list.append(item);
            index += 1;
          }
          body.append(list);
          continue;
        }
        const paragraphLines = [];
        while (index < lines.length && lines[index].trim()) {
          if (/^#{1,3}\s+/.test(lines[index]) || /^\s*(?:[-*・]|\d+[.)、])\s+/.test(lines[index])) break;
          paragraphLines.push(lines[index].trim());
          index += 1;
        }
        if (!paragraphLines.length) { index += 1; continue; }
        const paragraph = document.createElement('p');
        appendInlineText(paragraph, paragraphLines.join(' '));
        body.append(paragraph);
      }
    };
    const renderMessage = (item) => {
      const bubble = document.createElement('article');
      bubble.className = `ai-message is-${item.role}`;
      if (item.responseGroupId) bubble.dataset.responseGroupId = item.responseGroupId;
      const title = document.createElement('strong');
      title.textContent = item.role === 'user' ? 'あなた' : 'AI';
      const body = document.createElement(item.role === 'assistant' ? 'div' : 'p');
      body.className = 'ai-message-body';
      if (item.role === 'assistant') renderAssistantText(body, item.text);
      else body.textContent = item.text;
      bubble.append(title);
      bubble.append(body);
      messages.append(bubble);
    };

    const updateHistoryList = () => {
      historyList.replaceChildren();
      const conversations = getConversations();
      const currentConversation = getCurrentConversation();
      const saved = conversations.filter((conversation) => conversation.items.some((item) => item.type === 'message' && item.role === 'user'));
      if (!saved.length) {
        const empty = document.createElement('p'); empty.className = 'ai-history-empty'; empty.textContent = '過去の相談はありません。';
        historyList.append(empty);
        return;
      }
      saved.forEach((conversation) => {
        const row = document.createElement('div'); row.className = 'ai-history-entry';
        const button = document.createElement('button'); button.type = 'button'; button.className = 'ai-history-item';
        button.classList.toggle('is-active', conversation.id === currentConversation.id);
        button.disabled = isSending();
        const title = document.createElement('span'); title.textContent = conversation.title;
        const updated = document.createElement('small');
        updated.textContent = new Intl.DateTimeFormat('ja-JP', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }).format(conversation.updatedAt);
        button.append(title, updated);
        button.addEventListener('click', () => activateConversation(conversation));
        const saveButton = document.createElement('button'); saveButton.type = 'button';
        saveButton.className = 'ai-history-save';
        saveButton.textContent = conversation.saved ? '保存済み' : '保存';
        saveButton.setAttribute('aria-pressed', String(Boolean(conversation.saved)));
        saveButton.disabled = isSending();
        saveButton.addEventListener('click', () => {
          const wasSaved = Boolean(conversation.saved);
          conversation.saved = !wasSaved;
          const result = persistSavedConversations();
          if (result !== true) {
            conversation.saved = wasSaved;
            setStatus(result.message || '相談を保存できませんでした。ブラウザーの保存領域を確認してください。', 'error');
          } else if (conversation === getCurrentConversation()) {
            setStatus(conversation.saved ? 'この相談をブラウザーに保存しました。' : '保存を解除しました。');
          }
          updateHistoryList();
        });
        const renameButton = document.createElement('button'); renameButton.type = 'button';
        renameButton.className = 'ai-history-rename'; renameButton.textContent = '名前';
        renameButton.title = '相談名を変更';
        renameButton.disabled = isSending();
        renameButton.addEventListener('click', () => {
          const nextTitle = window.prompt('相談名', conversation.title);
          if (nextTitle === null) return;
          const trimmedTitle = nextTitle.trim();
          if (!trimmedTitle) return;
          const previousTitle = conversation.title;
          const previousCustomTitle = conversation.titleIsCustom;
          const previousUpdatedAt = conversation.updatedAt;
          conversation.title = trimmedTitle.slice(0, 80);
          conversation.titleIsCustom = true;
          conversation.updatedAt = Date.now();
          const result = persistSavedConversations();
          if (result !== true) {
            conversation.title = previousTitle;
            conversation.titleIsCustom = previousCustomTitle;
            conversation.updatedAt = previousUpdatedAt;
            setStatus(result.message || '相談名を保存できませんでした。', 'error');
          }
          updateHistoryList();
        });
        row.append(button, renameButton, saveButton);
        historyList.append(row);
      });
    };

    return { renderMessage, updateHistoryList };
};
