let bridge = null;

// The editor's classic scripts use this small compatibility surface; chat modules use getChatUiBridge().
window.editorChatIntegration = Object.freeze({
  onProposalHistoryChange: (...args) => bridge?.onProposalHistoryChange?.(...args),
  onScopeChange: (...args) => bridge?.onScopeChange?.(...args)
});

export function registerChatUiBridge(value) {
  if (!value || typeof value.previewProposal !== 'function' || typeof value.upsertHistory !== 'function'
    || typeof value.onProposalHistoryChange !== 'function' || typeof value.onScopeChange !== 'function') {
    throw new TypeError('新旧チャット接続の必須機能がありません。');
  }
  bridge = value;
  return () => {
    if (bridge === value) bridge = null;
  };
}

export function getChatUiBridge() {
  return bridge;
}
