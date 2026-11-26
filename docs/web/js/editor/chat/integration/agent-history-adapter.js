// 新AIの会話レコードを、移行用画面が表示できる会話状態へ投影します。
export function upsertAgentHistoryRecord({ record, getConversations, createConversation, updateHistoryList }) {
  if (!record || typeof record.id !== 'string' || !Array.isArray(record.items)) return false;
  const conversations = getConversations();
  let conversation = conversations.find((item) => item.id === record.id);
  if (!conversation) {
    conversation = {
      ...createConversation(Array.isArray(record.selectedIds) ? record.selectedIds : []),
      id: record.id,
      saved: false,
      assistantMode: 'agent'
    };
  }
  conversation.assistantMode = 'agent';
  conversation.title = typeof record.title === 'string' && record.title.trim() ? record.title : '新しい相談';
  conversation.titleIsCustom = false;
  conversation.updatedAt = Number.isFinite(record.updatedAt) ? record.updatedAt : Date.now();
  conversation.selectedIds = Array.isArray(record.selectedIds) ? [...record.selectedIds] : [];
  conversation.workflowMemory = record.workflowMemory && typeof record.workflowMemory === 'object'
    ? record.workflowMemory : null;
  conversation.items = record.items.filter((item) => item?.type === 'message'
    && ['user', 'assistant'].includes(item.role) && typeof item.text === 'string')
    .map(({ type, role, text }) => ({ type, role, text }));
  conversation.status = '';
  conversation.workflowStatus = '';
  conversation.splitMemory = null;
  updateHistoryList();
  return true;
}
