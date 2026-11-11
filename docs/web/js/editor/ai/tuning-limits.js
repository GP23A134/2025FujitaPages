// 開発者設定とAIリクエスト処理で共有する分割・統合の調整範囲です。
export const AI_TUNING_LIMITS = Object.freeze({
  maxUnitsPerBatch: Object.freeze({ min: 1, max: 6, default: 4 }),
  optimizationSplitThreshold: Object.freeze({ min: 1, max: 30, default: 20 }),
  synthesisMaxRounds: Object.freeze({ min: 1, max: 12, default: 8 })
});
