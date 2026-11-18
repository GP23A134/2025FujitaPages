// インスタンス情報は既定で無効。上限値は実データ・費用計測の調整候補です。
export const INSTANCE_SETTINGS = Object.freeze([
  { key: 'instances.enabled', type: 'boolean', defaultValue: false, label: 'インスタンス情報の読み取り' },
  { key: 'instances.includeId', type: 'boolean', defaultValue: false, label: 'インスタンスIDをAIへ送信' },
  { key: 'instances.perClassLimit', type: 'number', defaultValue: 10, min: 1, max: 100, step: 1, provisional: true, label: 'クラスごとの取得上限' },
  { key: 'instances.perTaskLimit', type: 'number', defaultValue: 500, min: 1, max: 5000, step: 1, provisional: true, label: '1依頼全体の取得上限' }
]);
