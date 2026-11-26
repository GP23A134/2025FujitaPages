// 提案操作の表示名と件数バッジを生成します。画面状態はgetterで受け取ります。
const operationLegendCategories = [
  { key: 'addClass', label: '追加', className: 'is-add' },
  { key: 'move', label: '移動', className: 'is-move' },
  { key: 'renameClass', label: '改名', className: 'is-rename' },
  { key: 'deleteClass', label: '削除', className: 'is-delete' }
];

export function createProposalFormatters({ labelFor, getClassType }) {
  const operationLabel = (operation) => {
    if (operation.type === 'addClass') return `${operation.classType === 'top' ? '上位' : '中間'}クラス「${operation.label}」を追加`;
    if (operation.type === 'renameClass') return `「${labelFor(operation.classId)}」を「${operation.label}」に改名`;
    if (operation.type === 'moveClass') {
      const sourceLabel = labelFor(operation.classId);
      return getClassType(operation.classId) === 'top'
        ? `上位クラス「${sourceLabel}」を中間クラス化して「${labelFor(operation.destinationId)}」へ移動`
        : `「${sourceLabel}」を「${labelFor(operation.destinationId)}」へ移動`;
    }
    if (operation.type === 'moveChildren') return `「${labelFor(operation.from)}」の配下を「${labelFor(operation.to)}」へ移動`;
    if (operation.type === 'promoteClass') return `中間クラス「${labelFor(operation.classId)}」を上位クラス化`;
    if (operation.type === 'deleteClass') return `「${labelFor(operation.classId)}」を削除`;
    return '不明な操作';
  };

  const operationCategory = (operation) => {
    if (operation?.type === 'addClass') return { key: 'addClass', label: '追加', className: 'is-add' };
    if (operation?.type === 'renameClass') return { key: 'renameClass', label: '改名', className: 'is-rename' };
    if (operation?.type === 'moveClass') return { key: 'moveClass', label: '移動', className: 'is-move' };
    if (operation?.type === 'moveChildren') return { key: 'moveChildren', label: '移動', className: 'is-move' };
    if (operation?.type === 'promoteClass') return { key: 'promoteClass', label: '上位化', className: 'is-move' };
    if (operation?.type === 'deleteClass') return { key: 'deleteClass', label: '削除', className: 'is-delete' };
    return { key: 'other', label: 'その他', className: 'is-other' };
  };

  const renderOperationCountBadges = (operations, className, { hideZero = false } = {}) => {
    const counts = new Map(operationLegendCategories.map(({ key }) => [key, 0]));
    operations.forEach((operation) => {
      const category = operationCategory(operation);
      const countKey = ['moveClass', 'moveChildren', 'promoteClass'].includes(category.key) ? 'move' : category.key;
      if (counts.has(countKey)) counts.set(countKey, counts.get(countKey) + 1);
    });
    return operationLegendCategories.filter(({ key }) => !hideZero || counts.get(key) > 0).map(({ key, label, className: categoryClass }) => {
      const badge = document.createElement('span');
      badge.className = `${className} ${categoryClass}`;
      badge.textContent = `${label}（${counts.get(key)}件）`;
      return badge;
    });
  };

  const excerpt = (value, limit = 180) => {
    const text = String(value || '');
    return text.length > limit ? `${text.slice(0, limit)}…` : text;
  };

  return Object.freeze({ operationLabel, renderOperationCountBadges, excerpt });
}
