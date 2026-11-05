// 選択範囲と全体参照設定に合わせて、プロンプト例を絞り込みます。
export const filterPromptExamples = (examples, context) => examples.filter((example) => {
  const condition = example?.showWhen;
  if (!condition || condition.always) return true;
  if (condition.fullGraph && !context.fullGraph) return false;
  if (Number.isFinite(condition.minSelected) && context.selectedCount < condition.minSelected) return false;
  if (condition.selectionTypes?.some((type) => !context.selectedTypes.has(type))) return false;
  if (condition.differentParents && !context.differentParents) return false;
  return true;
});
