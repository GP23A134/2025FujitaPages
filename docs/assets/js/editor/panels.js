// 編集画面の保持パネル、選択状態、クラス移動操作を扱う。編集状態と共通操作関数は state.js で定義する。
// ツリーと保持中パネルの描画
// ============================================================
function findTargetClasses(searchType, query) {
  return window.findTargetMatches(data, searchType, query, 'OR');
}
function renameClass(item) {
  const nextLabel = window.prompt('新しいクラス名を入力してください。', item.label);
  if (!nextLabel || !nextLabel.trim() || nextLabel.trim() === item.label) return;
  if (hasClassLabelConflict(classKind(item), nextLabel, item.id)) {
    logEditAction(classLabelConflictMessage(classKind(item), nextLabel.trim()), 'warn');
    return;
  }
  const undoBefore = snapshotEditState();
  item.label = nextLabel.trim();
  hasUnsavedChanges = true;
  recordEditHistory(undoBefore, '', '名称変更');
  logEditAction(`クラス名を「${item.label}」に変更しました。`);
  render();
}
function deleteClass(item) {
  if (item.label === '未分類') return;
  if (!window.confirm(`「${item.label}」を削除しますか？所属するクラスは未分類へ移動します。`)) return;
  const undoBefore = snapshotEditState();
  const directChildren = data.classData.relations
    .filter((relation) => relation.parent === item.id)
    .map((relation) => relation.child);
  const parentId = data.classData.relations.find((relation) => relation.child === item.id)?.parent;
  const middleChildren = directChildren.filter((id) => classKind(classById.get(id)) === 'middle');
  const moved = moveClassMembersToUnclassified(item.id);
  data.classData.relations = data.classData.relations.filter((relation) => relation.child !== item.id && relation.parent !== item.id);
  if (middleChildren.length) {
    if (classKind(item) === 'top') {
      const { top } = ensureUnclassified();
      middleChildren.forEach((id) => {
        const child = classById.get(id);
        if (!child) return;
        child.type = 'top';
        addRelation(id, top.id);
      });
    } else {
      const parent = classById.get(parentId) || ensureUnclassified().top;
      middleChildren.forEach((id) => addRelation(id, parent.id));
    }
  }
  const index = classes.indexOf(item);
  if (index >= 0) classes.splice(index, 1);
  classById.delete(item.id);
  heldMiddleClasses.delete(item.id);
  heldTopClasses.delete(item.id);
  hasUnsavedChanges = true;
  recordEditHistory(undoBefore, '', '削除');
  const promotionMessage = middleChildren.length
    ? classKind(item) === 'top'
      ? `直下の中間クラス${middleChildren.length}件を上位クラスにしました。`
      : `直下の中間クラス${middleChildren.length}件を親クラスへ移動しました。`
    : '';
  logEditAction(`${item.label}を削除しました。${promotionMessage}${moved}件を未分類へ移動しました。`);
  render();
}
function render() {
  renderTree();
  renderInstances();
}
function renderInstances() {
  // 保持中のクラスがある場合だけサイドパネルと移動用ボタンを表示する。
  // 解除操作後もこの関数だけを呼べば、件数と表示状態を同期できる。
  const held = document.getElementById('held-instance-list');
  const panel = document.getElementById('held-panel');
  const count = document.getElementById('held-count');
  const kindLabel = document.getElementById('held-kind-label');
  const selectionKind = activeSelectionKind();
  const heldListView = document.getElementById('held-list-view');
  const destinationPicker = document.getElementById('held-destination-picker');
  const aiAssistantPanel = document.getElementById('ai-assistant-panel');
  const destinationList = document.getElementById('held-destination-list');
  const destinationSearch = document.getElementById('held-destination-search');
  const recentSection = document.getElementById('held-destination-recent');
  const recentList = document.getElementById('held-destination-recent-list');
  const applyDestination = document.getElementById('apply-held-destination');
  const historyAnchor = document.querySelector('.ai-history-anchor');
  const collapseToggle = document.getElementById('toggle-held-panel-collapse');
  const undoButton = document.getElementById('undo-edit');
  const redoButton = document.getElementById('redo-edit');
  const undoEntry = editUndoStack.at(-1);
  const redoEntry = editRedoStack.at(-1);
  undoButton.disabled = !undoEntry;
  undoButton.title = undoEntry ? `元に戻す: ${undoEntry.actionLabel}` : '元に戻す履歴はありません';
  redoButton.disabled = !redoEntry;
  redoButton.title = redoEntry ? `やり直す: ${redoEntry.actionLabel}` : 'やり直す履歴はありません';
  const showHeldList = heldPanelView === 'held' && !heldPanelCollapsed;
  heldListView.hidden = !showHeldList;
  destinationPicker.hidden = heldPanelCollapsed || heldPanelView !== 'destination';
  aiAssistantPanel.hidden = heldPanelCollapsed || heldPanelView !== 'chat';
  panel.classList.toggle('is-collapsed', heldPanelCollapsed);
  panel.hidden = heldPanelClosed;
  document.getElementById('toggle-tree-filter-open').hidden = !treeFilter?.hidden;
  collapseToggle.setAttribute('aria-expanded', heldPanelCollapsed ? 'false' : 'true');
  collapseToggle.title = heldPanelCollapsed ? '保持中欄を展開' : '保持中欄を折りたたむ';
  collapseToggle.setAttribute('aria-label', heldPanelCollapsed ? '保持欄を展開' : '保持欄を最小化');
  document.querySelectorAll('.held-destination-tab').forEach((tab) => {
    const isActive = tab.dataset.destinationKind === heldDestinationKind;
    tab.classList.toggle('is-active', isActive);
    tab.setAttribute('aria-selected', isActive ? 'true' : 'false');
  });
  if (kindLabel) kindLabel.textContent = heldPanelView === 'chat' ? 'AIチャット' : heldPanelView === 'destination' ? '移動先' : '保持中';
  document.querySelectorAll('.held-panel-mode-tab').forEach((tab) => {
    const isActive = !heldPanelClosed && tab.dataset.heldPanelView === heldPanelView;
    tab.classList.toggle('is-active', isActive);
    tab.setAttribute('aria-selected', String(isActive));
  });
  const heldCountText = `${heldInstances.size + heldMiddleClasses.size + heldTopClasses.size}件`;
  if (count) count.textContent = heldCountText;
  const toolbarHeldCount = document.getElementById('held-count-toolbar');
  if (toolbarHeldCount) toolbarHeldCount.textContent = heldCountText;
  if (historyAnchor) historyAnchor.hidden = heldPanelView !== 'chat';
  document.querySelectorAll('.move-held-button').forEach((button) => {
    button.hidden = heldInstances.size === 0;
  });
  document.querySelectorAll('.move-held-middle-button').forEach((button) => {
    // 上位・中間・クラスのいずれかを保持中なら移動先として表示する。
    const destinationIsSelected = heldMiddleClasses.has(button.dataset.destinationClassId)
      || heldTopClasses.has(button.dataset.destinationClassId);
    button.hidden = destinationIsSelected
      || (heldMiddleClasses.size === 0 && heldTopClasses.size === 0 && heldInstances.size === 0);
  });
  held.replaceChildren(...[...heldInstances.values()].map((instance) => {
    const item = document.createElement('div'); item.className = 'held-instance-item'; item.dataset.heldKind = 'target';
    const label = document.createElement('span');
    label.textContent = instance.label || '(ラベルなし)';
    const id = document.createElement('small');
    id.className = 'held-instance-id';
    id.textContent = instance.id.match(/(?:^|\/)((?:c|m|t)_\d+)$/)?.[1] || instance.id;
    item.append(id, label);
    const remove = document.createElement('button'); remove.type = 'button'; remove.textContent = '解除';
    remove.addEventListener('click', () => {
      heldInstances.delete(instance.id);
      targetButtonById.get(instance.id)?.classList.remove('is-selected');
      syncTargetButtonAvailability();
      renderInstances();
    });
    item.append(remove); return item;
  }), ...[...heldMiddleClasses.values()].map((middle) => {
    const item = document.createElement('div'); item.className = 'held-instance-item'; item.dataset.heldKind = 'middle';
    item.textContent = `中間: ${middle.label}`;
    const remove = document.createElement('button'); remove.type = 'button'; remove.textContent = '解除';
    remove.addEventListener('click', () => {
      heldMiddleClasses.delete(middle.id);
      const checkbox = middleCheckboxById.get(middle.id);
      if (checkbox) checkbox.checked = false;
      syncTargetButtonAvailability();
      renderInstances();
    });
    item.append(remove); return item;
  }), ...[...heldTopClasses.values()].map((top) => {
    const item = document.createElement('div'); item.className = 'held-instance-item'; item.dataset.heldKind = 'top';
    item.textContent = `上位: ${top.label}`;
    const remove = document.createElement('button'); remove.type = 'button'; remove.textContent = '解除';
    remove.addEventListener('click', () => {
      heldTopClasses.delete(top.id);
      const checkbox = topCheckboxById.get(top.id);
      if (checkbox) checkbox.checked = false;
      syncTargetButtonAvailability();
      renderInstances();
    });
    item.append(remove); return item;
  }));
  held.querySelectorAll('[data-held-kind]').forEach((item) => { item.hidden = item.dataset.heldKind !== heldKindView; });
  const heldKindCounts = { top: heldTopClasses.size, middle: heldMiddleClasses.size, target: heldInstances.size };
  document.querySelectorAll('[data-held-kind-count]').forEach((badge) => { badge.textContent = String(heldKindCounts[badge.dataset.heldKindCount] || 0); });
  if (!heldKindCounts[heldKindView]) {
    const empty = document.createElement('p'); empty.className = 'held-kind-empty'; empty.textContent = 'この種類の保持項目はありません。'; held.append(empty);
  }
  document.querySelectorAll('.held-kind-tab').forEach((tab) => {
    const selected = tab.dataset.heldKind === heldKindView;
    tab.classList.toggle('is-active', selected);
    tab.setAttribute('aria-selected', String(selected));
  });
  const destinationClasses = classes
    .filter((item) => classKind(item) === heldDestinationKind && item.label !== '未分類')
    .sort((a, b) => String(a.label || '').localeCompare(String(b.label || ''), 'ja'));
  const parentByChild = new Map();
  data.classData.relations.forEach(({ child, parent }) => {
    if (!parentByChild.has(child)) parentByChild.set(child, parent);
  });
  const hierarchyPath = (destination) => {
    const path = [];
    const seen = new Set();
    let currentId = destination.id;
    while (currentId && !seen.has(currentId)) {
      seen.add(currentId);
      const current = classById.get(currentId);
      if (!current) break;
      path.unshift(String(current.label || '(ラベルなし)'));
      currentId = parentByChild.get(currentId);
    }
    return path.join(' › ');
  };
  const searchTerm = destinationSearch.value.trim().toLocaleLowerCase();
  const matchesDestination = (destination) => {
    const visiblePath = heldDestinationKind === 'middle' ? hierarchyPath(destination) : '';
    return !searchTerm || `${destination.label || ''} ${displayClassId(destination.id)} ${visiblePath}`
      .toLocaleLowerCase().includes(searchTerm);
  };
  const makeDestinationOption = (destination, isRecent = false) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'held-destination-option';
    if (isRecent) button.classList.add('is-recent');
    button.classList.toggle('is-selected', heldDestinationId === destination.id);
    const name = document.createElement('span');
    name.className = 'held-destination-option-name';
    name.textContent = destination.label || '(ラベルなし)';
    const path = document.createElement('small');
    path.className = 'held-destination-option-path';
    path.textContent = hierarchyPath(destination);
    path.hidden = heldDestinationKind === 'top';
    button.append(name, path);
    button.setAttribute('aria-pressed', heldDestinationId === destination.id ? 'true' : 'false');
    button.addEventListener('click', () => {
      heldDestinationId = heldDestinationId === destination.id ? '' : destination.id;
      renderInstances();
    });
    return button;
  };
  const recentDestinations = recentHeldDestinationIds
    .map((id) => classById.get(id))
    .filter((item) => item && classKind(item) === heldDestinationKind && item.label !== '未分類' && matchesDestination(item));
  if (recentDestinations.length) {
    recentSection.hidden = false;
    recentList.replaceChildren(...recentDestinations.map((destination) => makeDestinationOption(destination, true)));
  } else {
    recentSection.hidden = true;
    recentList.replaceChildren();
  }
  const filteredDestinations = destinationClasses.filter(matchesDestination);
  destinationList.replaceChildren(...filteredDestinations.map((destination) => makeDestinationOption(destination)));
  if (!filteredDestinations.length) {
    const empty = document.createElement('p');
    empty.className = 'held-destination-empty';
    empty.textContent = destinationClasses.length ? '一致する移動先がありません。' : '移動先にできるクラスがありません。';
    destinationList.append(empty);
  }
  applyDestination.disabled = !heldDestinationId || !selectionKind;
  syncTargetButtonAvailability();
  window.aiAssistant?.onScopeChange?.();
}

function activeSelectionKind() {
  if (heldTopClasses.size) return 'top';
  if (heldMiddleClasses.size) return 'middle';
  if (heldInstances.size) return 'class';
  return null;
}

function syncTargetButtonAvailability() {
  targetButtonById.forEach((button) => {
    button.disabled = false;
    button.title = '';
  });
  middleCheckboxById.forEach((checkbox) => {
    checkbox.disabled = false;
  });
  topCheckboxById.forEach((checkbox) => {
    checkbox.disabled = false;
  });
}

function moveHeldClassesToTop(topId) {
  if (!heldMiddleClasses.size && !heldTopClasses.size && !heldInstances.size) return false;
  const movableTopEntries = [...heldTopClasses.entries()].filter(([, item]) => !isUnclassified(item));
  const unclassifiedEntries = [...heldTopClasses.entries()].filter(([, item]) => isUnclassified(item));
  const hasUnclassifiedSelection = unclassifiedEntries.length > 0;
  if (!heldMiddleClasses.size && !movableTopEntries.length && !heldInstances.size) {
    logEditAction('未分類は受け皿のため移動できません。', 'warn');
    return true;
  }
  const selectedMiddleIds = new Set(heldMiddleClasses.keys());
  const selectedTopIds = new Set(movableTopEntries.map(([id]) => id));
  const selectedTargetIds = new Set(heldInstances.keys());
  if (selectedMiddleIds.has(topId) || selectedTopIds.has(topId)) {
    logEditAction('移動先として選択中のクラスは指定できません。', 'warn');
    return true;
  }
  // 選択した階層の全子孫を確認し、移動先が自分の配下になる循環を防ぐ。
  const movingHierarchyIds = new Set([...selectedMiddleIds, ...selectedTopIds]);
  const descendants = new Set(movingHierarchyIds);
  const children = buildChildrenMap();
  const pending = [...movingHierarchyIds];
  while (pending.length) {
    const current = pending.pop();
    (children.get(current) || []).forEach((childId) => {
      if (descendants.has(childId)) return;
      descendants.add(childId);
      pending.push(childId);
    });
  }
  if (descendants.has(topId)) { logEditAction('選択クラスの配下には移動できません。', 'warn'); return true; }

  const undoBefore = snapshotEditState();
  const convertedIds = new Map();
  movableTopEntries.forEach(([, top]) => {
    const oldId = top.id;
    const newId = allocateTemporaryClassId('middle');
    convertedIds.set(oldId, newId);
    classById.delete(oldId);
    top.id = newId;
    top.type = 'middle';
    classById.set(newId, top);
  });
  const movingIds = new Set([...movingHierarchyIds, ...selectedTargetIds]);
  data.classData.relations = data.classData.relations
    .filter((relation) => !movingIds.has(relation.child))
    .map((relation) => ({ ...relation, parent: convertedIds.get(relation.parent) || relation.parent }));
  convertedIds.forEach((newId) => addRelation(newId, topId));
  selectedMiddleIds.forEach((middleId) => addRelation(middleId, topId));
  selectedTargetIds.forEach((targetId) => addRelation(targetId, topId));
  const movedCount = selectedMiddleIds.size + selectedTopIds.size + selectedTargetIds.size;
  heldMiddleClasses.clear();
  heldTopClasses.clear();
  unclassifiedEntries.forEach(([id, item]) => heldTopClasses.set(id, item));
  heldInstances.clear();
  heldDestinationId = '';
  hasUnsavedChanges = true;
  recordEditHistory(undoBefore, topId, 'クラス移動');
  logEditAction(`${selectedTopIds.size}件の上位クラスを中間クラス化し、合計${movedCount}件を移動しました。${hasUnclassifiedSelection ? '未分類は移動対象から除外しました。' : ''}`);
  render();
  return true;
}

function moveHeldToMiddle(middleId) {
  const movableTopEntries = [...heldTopClasses.entries()].filter(([, item]) => !isUnclassified(item));
  const unclassifiedEntries = [...heldTopClasses.entries()].filter(([, item]) => isUnclassified(item));
  const hasUnclassifiedSelection = unclassifiedEntries.length > 0;
  if (!heldMiddleClasses.size && !movableTopEntries.length && !heldInstances.size) {
    logEditAction('未分類は受け皿のため移動できません。', 'warn');
    return;
  }
  const selectedMiddleIds = new Set(heldMiddleClasses.keys());
  const selectedTopIds = new Set(movableTopEntries.map(([id]) => id));
  const selectedTargetIds = new Set(heldInstances.keys());
  const selectedIds = new Set([...selectedMiddleIds, ...selectedTopIds, ...selectedTargetIds]);
  if (!selectedIds.size) return;
  if (selectedIds.has(middleId) || [...selectedIds].some((id) => descendantIds(id).has(middleId))) {
    logEditAction('選択クラス自身またはその配下には移動できません。', 'warn');
    return;
  }

  const undoBefore = snapshotEditState();
  const convertedTopIds = new Map();
  movableTopEntries.forEach(([, top]) => {
    const oldId = top.id;
    const newId = allocateTemporaryClassId('middle');
    convertedTopIds.set(oldId, newId);
    classById.delete(oldId);
    top.id = newId;
    top.type = 'middle';
    classById.set(newId, top);
  });
  data.classData.relations = data.classData.relations
    .filter((relation) => !selectedIds.has(relation.child))
    .map((relation) => ({ ...relation, parent: convertedTopIds.get(relation.parent) || relation.parent }));
  selectedMiddleIds.forEach((id) => addRelation(id, middleId));
  selectedTargetIds.forEach((id) => addRelation(id, middleId));
  convertedTopIds.forEach((id) => addRelation(id, middleId));
  const movedCount = selectedIds.size;
  heldMiddleClasses.clear();
  heldTopClasses.clear();
  unclassifiedEntries.forEach(([id, item]) => heldTopClasses.set(id, item));
  heldInstances.clear();
  heldDestinationId = '';
  hasUnsavedChanges = true;
  recordEditHistory(undoBefore, middleId, 'クラス移動');
  logEditAction(`${movedCount}件を中間クラス「${classById.get(middleId)?.label || ''}」へ移動しました。上位クラスは中間クラスに変更しました。${hasUnclassifiedSelection ? '未分類は移動対象から除外しました。' : ''}`);
  render();
}

function moveHeldToTop(topId) {
  if (!heldInstances.size) { logEditAction('先にクラスを選択してください。', 'warn'); return; }
  const undoBefore = snapshotEditState();
  const selectedIds = new Set(heldInstances.keys());
  data.classData.relations = data.classData.relations.filter((relation) => !selectedIds.has(relation.child));
  selectedIds.forEach((child) => addRelation(child, topId));
  const movedCount = selectedIds.size;
  heldInstances.clear();
  heldDestinationId = '';
  hasUnsavedChanges = true;
  recordEditHistory(undoBefore, topId, 'クラス移動');
  logEditAction(`${movedCount}件を上位クラスへ直接移動しました。`);
  render();
}
// ============================================================
