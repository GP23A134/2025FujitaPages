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
      text: `前回の相談では追加クラス情報を要求しました${requested.length ? `（${[...new Set(requested)].join('、')}）` : ''}。履歴から再開したため、この要求は再実行されていません。`
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
            if (entry.type === 'work-duration' && Number.isFinite(entry.seconds)) return [entry];
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
