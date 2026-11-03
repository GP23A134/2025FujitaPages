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
    const renderMessage = (item) => {
      const bubble = document.createElement('article');
      bubble.className = `ai-message is-${item.role}`;
      if (item.responseGroupId) bubble.dataset.responseGroupId = item.responseGroupId;
      const title = document.createElement('strong');
      title.textContent = item.role === 'user' ? 'あなた' : 'AI';
      const body = document.createElement('p');
      body.textContent = item.text;
      bubble.append(title, body);
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
          conversation.title = trimmedTitle.slice(0, 80);
          conversation.titleIsCustom = true;
          conversation.updatedAt = Date.now();
          const result = persistSavedConversations();
          if (result !== true) {
            conversation.title = previousTitle;
            conversation.titleIsCustom = previousCustomTitle;
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
