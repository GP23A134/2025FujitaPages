// 実データとAPI費用を測るまでの運用候補値です。各項目は開発者設定から調整します。
export const RUNTIME_SETTINGS = Object.freeze([
  { key: 'runtime.maxResponseRounds', type: 'number', defaultValue: 30, min: 1, max: 300, provisional: true, label: 'AI応答回数上限', description: '質問への回答と再開を含む依頼全体の応答数です。' },
  { key: 'runtime.maxRetrievalCalls', type: 'number', defaultValue: 50, min: 1, max: 1000, provisional: true, label: '取得呼び出し上限', description: '成功・失敗・許可外要求を含む依頼全体の取得要求数です。' },
  { key: 'runtime.maxReplans', type: 'number', defaultValue: 5, min: 0, max: 100, provisional: true, label: '再計画上限', description: '初回計画後に行う再計画の回数です。' },
  { key: 'runtime.inputTokenCap', type: 'number', defaultValue: 30000, min: 1000, max: 300000, step: 1000, provisional: true, label: '累積入力トークン上限', description: 'すべてのAPI要求で再送する入力も含めた依頼全体の上限です。' },
  { key: 'runtime.maxOutputTokens', type: 'number', defaultValue: 5000, min: 256, max: 32000, step: 256, provisional: true, label: '1回のAI応答出力上限', description: '1回のモデル応答に対する最大出力です。' }
]);
