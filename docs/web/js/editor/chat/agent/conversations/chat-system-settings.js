export const CHAT_SYSTEM_SETTINGS = Object.freeze([
  {
    key: 'chat.useNewSystem',
    type: 'boolean',
    defaultValue: true,
    label: 'エージェント形式を使う',
    description: 'オフにすると従来のAIチャット形式に切り替わります。',
    // The legacy chat remains loaded only as a compatibility bridge for preview.
    developerVisible: false
  }
]);
