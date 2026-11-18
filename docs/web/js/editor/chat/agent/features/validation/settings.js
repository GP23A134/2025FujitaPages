// 初回の提案は再試行回数に含めず、修正依頼の回数だけを数えます。
export const VALIDATION_SETTINGS = Object.freeze([
  {
    key: 'validation.maxRepairRetries',
    type: 'number',
    defaultValue: 2,
    min: 0,
    max: 20,
    label: '提案の修正再試行上限',
    step: 1,
    description: '階層や重複など、提案を修正して解決できる検証問題への再試行回数です。'
  }
]);
