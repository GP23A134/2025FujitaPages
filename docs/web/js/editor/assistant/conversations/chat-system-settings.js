export const CHAT_SYSTEM_SETTINGS = Object.freeze([
  {
    key: 'chat.useNewSystem',
    type: 'boolean',
    defaultValue: true,
    label: '新しいチャットシステムを使う',
    description: '有効時は通常の送信操作を新システムへ接続します。無効にすると従来のチャットへ戻ります。'
  }
]);
