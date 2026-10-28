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
let heldListResizeObserver = null;
let heldPageSizeUpdateScheduled = false;
function syncHeldPageSize() {
  const held = document.getElementById('held-instance-list');
  if (!held || held.clientHeight <= 0) return;
  const table = held.querySelector('.held-instance-table:not([hidden])');
  const headerHeight = table?.tHead?.getBoundingClientRect().height || 30;
  const rows = [...(table?.tBodies[0]?.rows || [])];
  const rowHeight = rows.length
    ? rows.reduce((total, row) => total + row.getBoundingClientRect().height, 0) / rows.length
    : 34;
  const nextPageSize = Math.max(1, Math.min(50, Math.floor((held.clientHeight - headerHeight - 4) / rowHeight)));
  if (nextPageSize === HELD_PAGE_SIZE) return;
  HELD_PAGE_SIZE = nextPageSize;
  renderInstances();
}
function observeHeldListSize(held) {
  if (!heldListResizeObserver && typeof ResizeObserver !== 'undefined') {
    heldListResizeObserver = new ResizeObserver(() => {
      if (heldPageSizeUpdateScheduled) return;
      heldPageSizeUpdateScheduled = true;
      requestAnimationFrame(() => {
        heldPageSizeUpdateScheduled = false;
        syncHeldPageSize();
      });
    });
    heldListResizeObserver.observe(held);
  }
  if (!heldPageSizeUpdateScheduled) {
    heldPageSizeUpdateScheduled = true;
    requestAnimationFrame(() => {
      heldPageSizeUpdateScheduled = false;
      syncHeldPageSize();
    });
  }
}
function renderInstances() {
  // 保持中のクラスがある場合だけサイドパネルと移動用ボタンを表示する。
  // 解除操作後もこの関数だけを呼べば、件数と表示状態を同期できる。
  const held = document.getElementById('held-instance-list');
  observeHeldListSize(held);
  const heldPagination = document.getElementById('held-pagination');
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
  const destinationMoveHint = document.getElementById('held-destination-move-hint');
  const movingTopClasses = [...heldTopClasses.values()].some((item) => !isUnclassified(item));
  const convertsTopToMiddle = heldDestinationKind === 'middle' && movingTopClasses;
  if (destinationMoveHint) {
    destinationMoveHint.hidden = !convertsTopToMiddle;
    destinationMoveHint.textContent = convertsTopToMiddle
      ? '上位クラスを中間クラスに変換し、配下の階層を保って移動します。'
      : '';
  }
  applyDestination.textContent = convertsTopToMiddle ? '上位を中間化して移動' : '選択先へ移動';
  applyDestination.title = convertsTopToMiddle
    ? '選択した上位クラスを中間化し、配下を保って移動'
    : '選択中のクラスを選択先へ移動';
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
  const selectionSummary = document.getElementById('edit-selection-summary');
  if (selectionSummary) {
    const total = heldInstances.size + heldMiddleClasses.size + heldTopClasses.size;
    selectionSummary.textContent = `選択 ${total}件（上位 ${heldTopClasses.size}・中間 ${heldMiddleClasses.size}・対象 ${heldInstances.size}）`;
    selectionSummary.setAttribute('aria-label', `選択中 ${total}件。上位クラス ${heldTopClasses.size}件、中間クラス ${heldMiddleClasses.size}件、対象クラス ${heldInstances.size}件`);
  }
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
  const heldKindCounts = { top: heldTopClasses.size, middle: heldMiddleClasses.size, target: heldInstances.size };
  document.querySelectorAll('[data-held-kind-count]').forEach((badge) => {
    badge.textContent = String(heldKindCounts[badge.dataset.heldKindCount] || 0);
  });
  const makeHeldTable = (kind, rows) => {
    const lastPage = Math.max(0, Math.ceil(rows.length / HELD_PAGE_SIZE) - 1);
    heldPageByKind[kind] = Math.min(heldPageByKind[kind] || 0, lastPage);
    const page = heldPageByKind[kind];
    const visibleRows = rows.slice(page * HELD_PAGE_SIZE, (page + 1) * HELD_PAGE_SIZE);
    const table = document.createElement('table');
    table.className = 'held-instance-table';
    table.dataset.heldKind = kind;
    table.hidden = kind !== heldKindView;
    const head = document.createElement('thead');
    const headerRow = document.createElement('tr');
    ['ID', 'クラス名', '操作'].forEach((text) => {
      const cell = document.createElement('th');
      cell.scope = 'col';
      cell.textContent = text;
      headerRow.append(cell);
    });
    head.append(headerRow);
    const body = document.createElement('tbody');
    visibleRows.forEach(({ item, remove }) => {
      const row = document.createElement('tr');
      const idCell = document.createElement('td');
      idCell.className = 'held-instance-table-id';
      idCell.textContent = item.id.match(/(?:^|\/)((?:c|m|t)_\d+)$/)?.[1] || item.id;
      const labelCell = document.createElement('td');
      labelCell.textContent = item.label || '(ラベルなし)';
      const actionCell = document.createElement('td');
      actionCell.className = 'held-instance-table-action';
      const button = document.createElement('button');
      button.type = 'button';
      button.textContent = '解除';
      button.title = remove.title || `${item.label || 'クラス'}を解除`;
      button.addEventListener('click', remove.run);
      actionCell.append(button);
      row.append(idCell, labelCell, actionCell);
      body.append(row);
    });
    table.append(head, body);
    return table;
  };
  held.replaceChildren(
    makeHeldTable('top', [...heldTopClasses.values()].map((item) => ({
      item,
      remove: { title: `${item.label}と配下の選択を解除`, run: () => {
        applyTreeSubtreeSelection([item.id], false);
        syncTargetButtonAvailability();
        renderInstances();
      } }
    }))),
    makeHeldTable('middle', [...heldMiddleClasses.values()].map((item) => ({
      item,
      remove: { title: `${item.label}と配下の選択を解除`, run: () => {
        applyTreeSubtreeSelection([item.id], false);
        syncTargetButtonAvailability();
        renderInstances();
      } }
    }))),
    makeHeldTable('target', [...heldInstances.values()].map((item) => ({
      item,
      remove: { run: () => {
        heldInstances.delete(item.id);
        syncTreeSelectionAppearance();
        syncTargetButtonAvailability();
        renderInstances();
      } }
    })))
  );
  heldPagination.replaceChildren();
  Object.entries({ top: heldTopClasses.size, middle: heldMiddleClasses.size, target: heldInstances.size }).forEach(([kind, total]) => {
    if (!total) return;
    const page = heldPageByKind[kind] || 0;
    const pageCount = Math.ceil(total / HELD_PAGE_SIZE);
    const start = page * HELD_PAGE_SIZE + 1;
    const end = Math.min((page + 1) * HELD_PAGE_SIZE, total);
    const navigation = document.createElement('nav');
    navigation.className = 'held-pagination';
    navigation.hidden = kind !== heldKindView;
    navigation.setAttribute('aria-label', `${kind === 'top' ? '上位クラス' : kind === 'middle' ? '中間クラス' : '対象クラス'}一覧のページ`);
    const previous = document.createElement('button');
    previous.type = 'button';
    previous.textContent = '前へ';
    previous.disabled = page === 0;
    previous.addEventListener('click', () => {
      heldPageByKind[kind] = Math.max(0, page - 1);
      renderInstances();
    });
    const status = document.createElement('span');
    status.setAttribute('aria-live', 'polite');
    status.textContent = `${start}–${end}件 / ${total}件　${page + 1} / ${pageCount}ページ`;
    const next = document.createElement('button');
    next.type = 'button';
    next.textContent = '次へ';
    next.disabled = page >= pageCount - 1;
    next.addEventListener('click', () => {
      heldPageByKind[kind] = Math.min(pageCount - 1, page + 1);
      renderInstances();
    });
    navigation.append(previous, status, next);
    heldPagination.append(navigation);
  });
  if (!heldKindCounts[heldKindView]) {
    const empty = document.createElement('p');
    empty.className = 'held-kind-empty';
    empty.textContent = 'この種類の保持項目はありません。';
    held.append(empty);
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

  // 親クラスの選択で配下も保持されるが、移動時は選択された最上位だけを付け替え、
  // その配下の親子関係を保つ。別に選択された枝だけを個別の移動対象にする。
  const belowSelectedTop = new Set();
  selectedTopIds.forEach((id) => descendantIds(id).forEach((descendantId) => belowSelectedTop.add(descendantId)));
  const movingMiddleIds = new Set([...selectedMiddleIds].filter((id) => !belowSelectedTop.has(id)));
  const belowMovingMiddle = new Set();
  movingMiddleIds.forEach((id) => descendantIds(id).forEach((descendantId) => belowMovingMiddle.add(descendantId)));
  const movingTargetIds = new Set([...selectedTargetIds].filter((id) =>
    !belowSelectedTop.has(id) && !belowMovingMiddle.has(id)));
  const movingRootIds = new Set([...selectedTopIds, ...movingMiddleIds, ...movingTargetIds]);

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
    .filter((relation) => !movingRootIds.has(relation.child))
    .map((relation) => ({ ...relation, parent: convertedTopIds.get(relation.parent) || relation.parent }));
  movingMiddleIds.forEach((id) => addRelation(id, middleId));
  movingTargetIds.forEach((id) => addRelation(id, middleId));
  convertedTopIds.forEach((id) => addRelation(id, middleId));
  const movedCount = movingRootIds.size;
  heldMiddleClasses.clear();
  heldTopClasses.clear();
  unclassifiedEntries.forEach(([id, item]) => heldTopClasses.set(id, item));
  heldInstances.clear();
  heldDestinationId = '';
  hasUnsavedChanges = true;
  recordEditHistory(undoBefore, middleId, 'クラス移動');
  logEditAction(`${movedCount}件を中間クラス「${classById.get(middleId)?.label || ''}」へ移動しました。上位クラスは中間クラスに変更し、配下の階層は維持しました。${hasUnclassifiedSelection ? '未分類は移動対象から除外しました。' : ''}`);
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
