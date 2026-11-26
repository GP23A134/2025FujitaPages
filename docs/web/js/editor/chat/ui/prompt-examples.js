// 選択範囲に合う依頼例だけを残します。AI送信処理には依存しません。
export const filterPromptExamples = (examples, context) => examples.filter((example) => {
  const condition = example?.showWhen;
  if (!condition || condition.always) return true;
  if (condition.unclassified && !context.unclassifiedSelected) return false;
  if (condition.fullGraph && !context.fullGraph) return false;
  if (Number.isFinite(condition.minSelected) && context.selectedCount < condition.minSelected) return false;
  if (condition.selectionTypes?.some((type) => !context.selectedTypes.has(type))) return false;
  if (condition.differentParents && !context.differentParents) return false;
  return true;
});
