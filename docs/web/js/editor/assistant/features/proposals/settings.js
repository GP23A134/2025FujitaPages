export const PROPOSAL_SETTINGS = Object.freeze([
  { key: 'proposals.targetClassRenameEnabled', type: 'boolean', defaultValue: false, label: '対象クラス名の変更を許可' },
  { key: 'proposals.moveDecisionRetries', type: 'number', defaultValue: 2, min: 0, max: 20, step: 1,
    label: '移動先判断の再試行上限', description: '移動先判断の応答が不正な場合に、同じバッチを再依頼する回数です。' }
]);
