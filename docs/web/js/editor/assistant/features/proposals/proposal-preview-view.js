function hierarchyTree(state, seeds) {
  const classes = new Map(state.classes.map((item) => [item.id, item]));
  const children = new Map();
  const childIds = new Set();
  for (const { child, parent } of state.relations) {
    if (!children.has(parent)) children.set(parent, []);
    children.get(parent).push(child);
    childIds.add(child);
  }
  const visible = new Set(Array.from(seeds || []).filter((id) => classes.has(id)));
  for (const id of [...visible]) {
    let parent = state.relations.find((relation) => relation.child === id)?.parent;
    const seen = new Set([id]);
    while (parent && !seen.has(parent)) {
      visible.add(parent);
      seen.add(parent);
      parent = state.relations.find((relation) => relation.child === parent)?.parent;
    }
  }
  const build = (id, seen = new Set()) => {
    if (seen.has(id)) return null;
    const item = classes.get(id);
    if (!item) return null;
    const nextSeen = new Set(seen).add(id);
    const li = document.createElement('li');
    li.dataset.classType = item.type;
    const label = document.createElement('span');
    label.textContent = item.label;
    li.append(label);
    const nested = (children.get(id) || []).filter((childId) => visible.has(childId)).map((childId) => build(childId, nextSeen)).filter(Boolean);
    if (nested.length) {
      const ul = document.createElement('ul');
      ul.append(...nested);
      li.append(ul);
    }
    return li;
  };
  const root = document.createElement('ul');
  root.className = 'assistant-preview-tree';
  const roots = state.classes.filter((item) => item.type === 'top' && !childIds.has(item.id) && visible.has(item.id));
  root.append(...roots.map((item) => build(item.id)).filter(Boolean));
  return root;
}

export function createProposalPreviewView(dialog, { onApply, onClose = () => {} }) {
  const title = dialog.querySelector('[data-proposal-preview-title]');
  const summary = dialog.querySelector('[data-proposal-preview-summary]');
  const operationList = dialog.querySelector('[data-proposal-preview-operations]');
  const before = dialog.querySelector('[data-proposal-preview-before]');
  const after = dialog.querySelector('[data-proposal-preview-after]');
  const apply = dialog.querySelector('[data-proposal-preview-apply]');
  const closeButtons = [...dialog.querySelectorAll('[data-proposal-preview-close]')];
  let current = null;

  const closeDialog = () => {
    current = null;
    dialog.close();
    onClose();
  };
  closeButtons.forEach((button) => button.addEventListener('click', closeDialog));
  dialog.addEventListener('cancel', (event) => { event.preventDefault(); closeDialog(); });
  apply.addEventListener('click', async () => {
    if (!current) return;
    apply.disabled = true;
    try {
      await onApply(current);
      closeDialog();
    } catch (error) {
      if (error && typeof error === 'object' && !error.sourceModule) error.sourceModule = 'features/proposals/proposal-preview-view.js';
      console.error(`[assistant] ${error?.sourceModule || 'features/proposals/proposal-preview-view.js'}`, error);
      summary.textContent = error.message;
    } finally { apply.disabled = false; }
  });

  function show(item, beforeState, afterState) {
    current = item;
    title.textContent = item.proposal.title;
    summary.textContent = `${item.proposal.summary}。${item.proposal.reason}`;
    operationList.replaceChildren();
    const labels = new Map(beforeState.classes.map((entry) => [entry.id, entry.label]));
    const afterLabels = new Map(afterState.classes.map((entry) => [entry.id, entry.label]));
    const seeds = new Set();
    for (const operation of item.proposal.operations) {
      const row = document.createElement('li');
      const targetId = operation.target?.classId;
      const targetLabel = operation.label || (targetId ? labels.get(targetId) : null) || operation.tempId || '';
      const parentId = operation.newParent?.classId;
      const parentLabel = parentId ? labels.get(parentId) || afterLabels.get(parentId) : '';
      const operationLabel = ({
        move_target_class: '対象クラス移動', move_middle_class: '中間クラス移動', move_top_class: '上位クラス移動',
        promote_middle_class: '中間クラスを上位化', delete_middle_class: '中間クラス削除', delete_top_class: '上位クラス削除',
        add_top_class: '上位クラス追加', add_middle_class: '中間クラス追加',
        rename_top_class: '上位クラス名変更', rename_middle_class: '中間クラス名変更'
      })[operation.type] || operation.type;
      row.textContent = `${operationLabel}: ${targetLabel}${parentLabel ? ` → ${parentLabel}` : ''}`;
      operationList.append(row);
      [targetId, parentId].filter(Boolean).forEach((id) => seeds.add(id));
      if (operation.tempId) seeds.add(operation.tempId);
    }
    for (const [temporaryId, actualId] of item.candidate.idRemaps || []) {
      if (seeds.has(temporaryId)) { seeds.delete(temporaryId); seeds.add(actualId); }
    }
    before.replaceChildren(hierarchyTree(beforeState, seeds));
    after.replaceChildren(hierarchyTree(afterState, seeds));
    dialog.showModal();
  }
  return Object.freeze({ show, close: closeDialog });
}
