export const CHAT_SYSTEM_SETTINGS = Object.freeze([
  {
    key: 'chat.useNewSystem',
    type: 'boolean',
    defaultValue: true,
    label: 'エージェント形式を使う',
    description: 'オンでエージェント形式、オフで従来のAIチャットを使います。',
    developerVisible: false
  }
]);
