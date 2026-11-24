export const CHAT_EVENTS = Object.freeze({
  agentProgress: 'assistant:progress',
  agentUsage: 'assistant-api-usage',
  agentNewConversation: 'assistant:new-conversation',
  agentConversationActivated: 'assistant:conversation-activated'
});

export function dispatchChatEvent(name, detail) {
  if (!Object.values(CHAT_EVENTS).includes(name)) throw new TypeError('未登録のチャットイベントです。');
  window.dispatchEvent(new CustomEvent(name, { detail }));
}
