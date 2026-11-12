// 編集画面の階層ツリー、検索・件数絞り込み、ツリー上の編集操作を担当する。
// ツリーの絞り込み・描画・ツリー上の編集操作
// ============================================================
let targetConnectorLayoutFrame = 0;
let treeExactCountValues = [0];
let treeExactSelectedCount = null;
let treeCountRangeTouched = false;
let treeRenderFrame = 0;
let treeSearchDebounceTimer = 0;
let treeHierarchyEditModeEnabled = false;
let activeTreeDragIds = [];
let temporaryTreeDragSelection = null;
let touchTreeDrag = { timer: 0, source: null, startX: 0, startY: 0, active: false, destination: null, ids: [] };
let treeDragHoverOpenTimer = 0;
let treeDragHoverOpenTarget = null;
let treeDragSummary = null;
let treeDragSummaryLabel = '';
let treeDragSummaryCount = 0;
let treeDragRootIds = [];
// 画面には選択中の条件だけ表示し、件数条件は一度設定した後もキーワード条件と併用する。
let treeCountFilterEnabled = false;
function scheduleTargetConnectorLayout() {
  if (targetConnectorLayoutFrame) return;
  targetConnectorLayoutFrame = requestAnimationFrame(() => {
    targetConnectorLayoutFrame = 0;
    const panel = document.getElementById('edit-tree-panel');
    if (!panel) return;
    window.updateTreeStickyOffsets(panel);
    window.updateTreeTargetRowStarts(panel);
  });
}
window.addEventListener('resize', scheduleTargetConnectorLayout);

let pendingTreeViewportAnchor = null;
function captureTreeViewportAnchor(details, closeAll = false) {
  pendingTreeViewportAnchor = null;
  const tree = document.getElementById('edit-tree');
  if (!tree) return;
  const toolbarBottom = document.querySelector('.edit-taskbar')?.getBoundingClientRect().bottom ?? 0;
  const treeFilter = document.getElementById('tree-filter');
  const filterBottom = treeFilter && !treeFilter.hidden ? treeFilter.getBoundingClientRect().bottom : 0;
  const visibleTop = Math.max(toolbarBottom, filterBottom) + 4;
  const visibleTopClass = [...tree.querySelectorAll('.tree-top-class > summary')]
    .map((element) => ({ element, bounds: element.getBoundingClientRect() }))
    .filter(({ bounds }) => bounds.bottom > visibleTop && bounds.top < window.innerHeight)
    .sort((a, b) => Math.abs(a.bounds.top - visibleTop) - Math.abs(b.bounds.top - visibleTop))[0]?.element;
  const anchor = closeAll
    ? visibleTopClass || details?.closest('.tree-top-class')?.querySelector(':scope > summary')
      || tree.querySelector('.tree-top-class > summary')
    : details?.querySelector(':scope > summary');
  if (!anchor) return;
  const bounds = anchor.getBoundingClientRect();
  pendingTreeViewportAnchor = {
    details,
    closeAll,
    anchor,
    top: bounds.top,
    visibleTop,
    visibleBottom: window.innerHeight
  };
}
function restoreTreeViewportAnchor(details) {
  const pending = pendingTreeViewportAnchor;
  if (!pending || (!pending.closeAll && pending.details !== details)) return;
  pendingTreeViewportAnchor = null;
  window.requestAnimationFrame(() => {
    const anchor = pending.anchor;
    if (!anchor?.isConnected || !anchor.getClientRects().length) return;
    const bounds = anchor.getBoundingClientRect();
    let difference = 0;
    if (bounds.bottom <= pending.visibleTop) difference = bounds.top - pending.top;
    else if (bounds.top >= pending.visibleBottom) difference = bounds.top - pending.top;
    if (difference) window.scrollBy(0, difference);
  });
}
document.getElementById('edit-tree')?.addEventListener('click', (event) => {
  const summary = event.target.closest('summary');
  const details = summary?.parentElement;
  if (!details?.matches('.tree-top-class, .tree-middle-class') || !details.open) return;
  if (event.target.closest('button, input, select, textarea, a')) return;
  captureTreeViewportAnchor(details);
}, true);

function renderTree() {
  const tree = document.getElementById('edit-tree');
  const previouslyOpenNodeIds = new Set(
    [...tree.querySelectorAll('.tree-top-class[open], .tree-middle-class[open]')]
      .map((details) => details.dataset.classId)
      .filter(Boolean)
  );
  targetButtonById.clear();
  middleCheckboxById.clear();
  topCheckboxById.clear();

  const filterType = document.getElementById('tree-filter-type').value;
  const filterQuery = document.getElementById('tree-filter-query').value;
  const minInput = document.getElementById('tree-filter-count-min');
  const maxInput = document.getElementById('tree-filter-count-max');
  treeExactCountValues = [...new Set(classes
    .filter((item) => classKind(item) === 'class')
    .map((item) => countTargetInstances(item.id)))].sort((a, b) => a - b);
  if (!treeExactCountValues.length) treeExactCountValues = [0];
  if (treeExactSelectedCount === null || !treeExactCountValues.includes(treeExactSelectedCount)) {
    treeExactSelectedCount = treeExactCountValues.reduce((nearest, value) =>
      Math.abs(value - (treeExactSelectedCount ?? 0)) < Math.abs(nearest - (treeExactSelectedCount ?? 0))
        ? value : nearest, treeExactCountValues[0]);
  }
  const exactInput = document.getElementById('tree-filter-count-exact-input');
  exactInput.min = '0';
  exactInput.max = String(treeExactCountValues.length - 1);
  exactInput.value = String(treeExactCountValues.indexOf(treeExactSelectedCount));
  document.getElementById('tree-filter-count-exact-value').textContent = `${treeExactSelectedCount}件`;
  const exactBubble = document.getElementById('tree-filter-count-exact-bubble');
  exactBubble.textContent = `${treeExactSelectedCount}件`;
  exactBubble.style.left = `clamp(1rem, ${(Number(exactInput.value) / Math.max(1, treeExactCountValues.length - 1)) * 100}%, calc(100% - 1rem))`;
  document.getElementById('tree-filter-count-exact-min').textContent = `${treeExactCountValues[0]}件`;
  document.getElementById('tree-filter-count-exact-max').textContent = `${treeExactCountValues.at(-1)}件`;
  minInput.max = String(treeExactCountValues.length - 1);
  maxInput.max = String(treeExactCountValues.length - 1);
  if (minInput.dataset.initialized !== 'true') {
    minInput.value = '0';
    maxInput.value = String(treeExactCountValues.length - 1);
    minInput.dataset.initialized = 'true';
    maxInput.dataset.initialized = 'true';
  } else {
    minInput.value = String(Math.min(Number(minInput.value), treeExactCountValues.length - 1));
    maxInput.value = String(Math.min(Number(maxInput.value), treeExactCountValues.length - 1));
  }
  const minRangeIndex = Math.min(Number(minInput.value), Number(maxInput.value));
  const maxRangeIndex = Math.max(Number(minInput.value), Number(maxInput.value));
  const rangeMinCount = treeExactCountValues[minRangeIndex] ?? treeExactCountValues[0];
  const rangeMaxCount = treeExactCountValues[maxRangeIndex] ?? treeExactCountValues.at(-1);
  document.getElementById('tree-filter-count-min-value').textContent = `${rangeMinCount}件`;
  document.getElementById('tree-filter-count-max-value').textContent = `${rangeMaxCount}件`;
  updateTreeRangeBubbles();
  const countMode = document.getElementById('tree-filter-count-mode').value;
  const exactCount = treeExactSelectedCount;
  // 件数条件は利用者が操作した後にのみ有効化し、初期表示で結果を隠さない。
  const countFilterActive = treeCountFilterEnabled && (countMode === 'exact'
    ? exactCount !== null
    : treeCountRangeTouched);
  const activeQuery = [...treeFilterKeywords, ...(filterQuery.trim() ? [filterQuery.trim()] : [])];
  const filterActive = activeQuery.length > 0 || countFilterActive;
  const clearFiltersButton = document.getElementById('clear-tree-filters');
  if (clearFiltersButton) clearFiltersButton.disabled = !filterActive;
  renderTreeFilterKeywords();
  const preserveHierarchy = filterActive;
  const effectiveSearchType = activeQuery.length ? filterType : 'class';
  const { targets: matchedTargets } = findTargetClasses(effectiveSearchType, activeQuery);
  const filteredTargets = matchedTargets.filter((target) =>
    (!countFilterActive || (countMode === 'exact'
      ? countTargetInstances(target.id) === exactCount
      : countTargetInstances(target.id) >= rangeMinCount
        && countTargetInstances(target.id) <= rangeMaxCount)));
  const allTargetCount = classes.filter((item) => classKind(item) === 'class').length;
  const filterHidesTargets = filteredTargets.length < allTargetCount;
  const filterCount = document.getElementById('tree-filter-count');
  filterCount.textContent = `${filteredTargets.length}件`;
  const selectFilteredButton = document.getElementById('select-filtered-targets');
  const clearFilteredButton = document.getElementById('clear-filtered-targets-selection');
  selectFilteredButton.hidden = !filterActive;
  clearFilteredButton.hidden = !filterActive;
  selectFilteredButton.textContent = `検索結果を選択（${filteredTargets.length}件）`;
  selectFilteredButton.title = `現在の検索・件数条件に一致した対象クラス${filteredTargets.length}件を選択に追加`;
  clearFilteredButton.title = `検索結果に一致した対象クラス${filteredTargets.length}件の選択だけを解除`;

  // 閲覧画面と同じ階層モデル・描画関数を使い、モードごとの差は操作UIに限定する。
  const targetIds = filterActive ? new Set(filteredTargets.map((target) => target.id)) : null;
  const model = window.buildTreeModel(data.classData, targetIds, preserveHierarchy);
  const openNodeIds = filterActive && filterHidesTargets && filteredTargets.length > 0
    ? window.treeAncestorIds(data.classData, targetIds)
    : new Set();
  const addTreeButton = (label, handler) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'tree-add-button';
    button.textContent = label;
    button.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      handler();
    });
    return button;
  };
  const addTreeRow = (label, handler, rowClass = '') => {
    const row = document.createElement('li');
    if (rowClass) row.classList.add(rowClass);
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'tree-add-button tree-add-row';
    button.textContent = `＋ ${label}`;
    button.addEventListener('click', handler);
    row.append(button);
    return row;
  };
  currentFilteredTargetIds = filterActive ? targetIds : null;
  const addMiddleClass = (parentId) => {
    const label = window.prompt('中間クラス名を入力してください');
    if (!label || !label.trim()) return;
    const isMovingHeldTargets = heldInstances.size > 0;
    const undoBefore = snapshotEditState();
    const item = createClass('middle', label);
    if (!item) return;
    addRelation(item.id, parentId);
    if (heldInstances.size) {
      const selectedIds = [...heldInstances.keys()];
      const selectedIdSet = new Set(selectedIds);
      data.classData.relations = data.classData.relations.filter((relation) => !selectedIdSet.has(relation.child));
      selectedIds.forEach((childId) => addRelation(childId, item.id));
      heldInstances.clear();
      logEditAction(`${item.label}を追加し、保持中のクラスを移動しました。`);
    } else {
      logEditAction(`中間クラス「${item.label}」を追加しました。`);
    }
    hasUnsavedChanges = true;
    recordEditHistory(undoBefore, '', isMovingHeldTargets ? '中間クラス作成と移動' : '中間クラス作成');
    render();
  };
  const addTopClass = () => {
    if (heldMiddleClasses.size) {
      const selected = [...heldMiddleClasses.values()];
      const selectedIds = new Set(selected.map((item) => item.id));
      const conflicts = selected.filter((item) => classes.some((candidate) =>
        classKind(candidate) === 'top' && candidate.label.trim() === item.label.trim()));
      if (conflicts.length) {
        logEditAction(`同じ名前の上位クラスがあるため上位化できません: ${conflicts.map((item) => item.label).join('、')}`, 'warn');
        return;
      }
      const children = buildChildrenMap();
      const countTargets = createTargetCounter(children);
      const summary = selected.map((item) => `・${item.label}（配下 ${countTargets(item.id)}件）`).join('\n');
      if (!window.confirm(`選択した中間クラスを、それぞれ独立した上位クラスに変更します。\n名前と配下のクラスは引き継ぎます。\n\n${summary}\n\n実行しますか？`)) return;

      const undoBefore = snapshotEditState();
      const promotedIds = new Map();
      selected.forEach((item) => {
        const oldId = item.id;
        const newId = allocateTemporaryClassId('top');
        promotedIds.set(oldId, newId);
        classById.delete(oldId);
        item.id = newId;
        item.type = 'top';
        classById.set(newId, item);
      });
      // 昇格対象自身の親（旧上位クラス）との関係は外し、配下からの
      // 参照だけ新しい上位クラスIDへ付け替える。
      data.classData.relations = data.classData.relations
        .filter((relation) => !selectedIds.has(relation.child))
        .map((relation) => ({ ...relation, parent: promotedIds.get(relation.parent) || relation.parent }));
      heldMiddleClasses.clear();
      heldDestinationId = '';
      hasUnsavedChanges = true;
      recordEditHistory(undoBefore, '', '中間クラスの上位化');
      logEditAction(`${selected.length}件の中間クラスを、それぞれ上位クラスに変更しました。`);
      render();
      return;
    }
    const label = window.prompt('上位クラス名を入力してください');
    if (!label || !label.trim()) return;
    const isMovingHeldTargets = heldInstances.size > 0;
    const undoBefore = snapshotEditState();
    const item = createClass('top', label);
    if (!item) return;
    if (heldInstances.size) {
      const selectedIds = [...heldInstances.keys()];
      const selectedIdSet = new Set(selectedIds);
      data.classData.relations = data.classData.relations.filter((relation) => !selectedIdSet.has(relation.child));
      selectedIds.forEach((childId) => addRelation(childId, item.id));
      heldInstances.clear();
      logEditAction(`${item.label}を追加し、保持中のクラスを移動しました。`);
    } else {
      logEditAction(`上位クラス「${item.label}」を追加しました。`);
    }
    hasUnsavedChanges = true;
    recordEditHistory(undoBefore, '', isMovingHeldTargets ? '上位クラス作成と移動' : '上位クラス作成');
    render();
  };
  const renderTarget = (item, _parent, depth) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'tree-add-button tree-leaf-class';
    button.dataset.instanceId = item.id;
    button.dataset.selectionId = item.id;
    button.dataset.selectionKind = 'target';
    button.dataset.dragClassId = item.id;
    button.draggable = true;
    button.title = 'クリックで選択・解除、Shift＋クリックで連続範囲を選択';
    button.style.setProperty('--tree-level-color', window.treeDepthColor(depth));
    const id = document.createElement('span');
    id.className = 'tree-leaf-id';
    id.textContent = displayClassId(item.id);
    const label = document.createElement('span');
    label.className = 'tree-leaf-label';
    label.textContent = window.treeLabel(item.label);
    const count = document.createElement('span');
    count.className = 'target-instance-count-badge';
    count.textContent = `(${countTargetInstances(item.id)}件)`;
    button.append(id, label, count);
    button.classList.toggle('is-selected', heldInstances.has(item.id));
    targetButtonById.set(item.id, button);
    button.addEventListener('click', (event) => {
      applyTreeSelectionRange(button, event, !heldInstances.has(item.id));
      button.classList.toggle('is-selected', heldInstances.has(item.id));
    });
    const li = document.createElement('li');
    li.style.setProperty('--tree-level-color', window.treeDepthColor(depth));
    li.append(button);
    const infoButton = document.createElement('button');
    infoButton.type = 'button';
    infoButton.className = 'tree-leaf-info-button';
    infoButton.textContent = 'i';
    infoButton.setAttribute('aria-label', `${item.label}に関連するインスタンスを表示`);
    infoButton.title = '関連インスタンスを表示';
    infoButton.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      showRelatedInstances(item);
    });
    li.append(infoButton);
    return li;
  };
  const decorateSummary = (summary, levelContent, node, depth) => {
    const item = classById.get(node.id);
    if (!item) return;
    const controls = document.createElement('div');
    controls.className = 'tree-summary-controls';
    controls.addEventListener('click', (event) => event.stopPropagation());
    const leadingControls = document.createElement('span');
    leadingControls.className = 'tree-summary-leading-controls';
    const trailingControls = document.createElement('span');
    trailingControls.className = 'tree-summary-trailing-controls';
    controls.append(leadingControls, trailingControls);
    summary.parentElement.append(controls);
    summary.dataset.dragClassId = item.id;
    summary.draggable = !isUnclassified(item);
    if (classKind(item) === 'middle') {
      const checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.className = 'tree-level-selection-checkbox';
      checkbox.checked = heldMiddleClasses.has(item.id);
      checkbox.dataset.selectionId = item.id;
      checkbox.dataset.selectionKind = 'middle';
      checkbox.title = '配下もまとめて選択・解除します。Shift＋クリックで連続範囲を選択します';
      checkbox.disabled = false;
      middleCheckboxById.set(item.id, checkbox);
      checkbox.setAttribute('aria-label', `${item.label}と配下を選択`);
      checkbox.addEventListener('click', (event) => { event.stopPropagation(); checkbox.dataset.shiftKey = String(event.shiftKey); });
      checkbox.addEventListener('change', (event) => applyTreeSelectionRange(checkbox, event, checkbox.checked));
      leadingControls.append(checkbox);
    }
    if (classKind(item) === 'top') {
      const checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.className = 'tree-level-selection-checkbox';
      checkbox.checked = heldTopClasses.has(item.id);
      checkbox.dataset.selectionId = item.id;
      checkbox.dataset.selectionKind = 'top';
      checkbox.title = '配下もまとめて選択・解除します。Shift＋クリックで連続範囲を選択します';
      checkbox.disabled = false;
      topCheckboxById.set(item.id, checkbox);
      checkbox.setAttribute('aria-label', isUnclassified(item)
        ? '未分類を選択（未分類自体は移動できません）'
        : `${item.label}と配下を選択`);
      checkbox.addEventListener('click', (event) => { event.stopPropagation(); checkbox.dataset.shiftKey = String(event.shiftKey); });
      checkbox.addEventListener('change', (event) => applyTreeSelectionRange(checkbox, event, checkbox.checked));
      leadingControls.append(checkbox);
    }
    if (classKind(item) === 'top' || classKind(item) === 'middle') {
      const actions = document.createElement('span');
      actions.className = 'tree-class-edit-actions';
      actions.addEventListener('click', (event) => event.stopPropagation());
      const selectDescendants = document.createElement('button');
      selectDescendants.type = 'button';
      selectDescendants.className = 'select-descendants-button tree-class-edit-button';
      selectDescendants.dataset.selectionRootId = item.id;
      selectDescendants.textContent = '配下を選択';
      selectDescendants.setAttribute('aria-label', `${item.label}の配下を選択・解除`);
      selectDescendants.title = '配下を選択。すべて選択済みの場合は解除';
      selectDescendants.addEventListener('click', (event) => {
        event.preventDefault();
        event.stopPropagation();
        const descendants = [...descendantIds(item.id)]
          .map((id) => classById.get(id))
          .filter(Boolean);
        const isSelected = (descendant) => {
          const kind = classKind(descendant);
          const selection = kind === 'class' ? heldInstances : kind === 'middle' ? heldMiddleClasses : heldTopClasses;
          return selection.has(descendant.id);
        };
        const clearSelection = descendants.length > 0 && descendants.every(isSelected);
        descendants.forEach((descendant) => {
          const kind = classKind(descendant);
          const selection = kind === 'class' ? heldInstances : kind === 'middle' ? heldMiddleClasses : heldTopClasses;
          if (clearSelection) selection.delete(descendant.id);
          else selection.set(descendant.id, descendant);
        });
        syncTreeSelectionAppearance();
        syncTargetButtonAvailability();
        renderInstances();
      });
      actions.append(selectDescendants);
      if (treeHierarchyEditModeEnabled && item.label !== '未分類') {
        const rename = document.createElement('button');
        rename.type = 'button';
        rename.className = 'rename-class-button tree-class-edit-button';
        rename.textContent = '名称変更';
        rename.setAttribute('aria-label', `${item.label}の名称変更`);
        rename.addEventListener('click', (event) => {
          event.preventDefault();
          event.stopPropagation();
          renameClass(item);
        });
        const remove = document.createElement('button');
        remove.type = 'button';
        remove.className = 'delete-class-button tree-class-edit-button';
        remove.textContent = '削除';
        remove.disabled = item.label === '未分類';
        remove.setAttribute('aria-label', `${item.label}を削除`);
        remove.addEventListener('click', (event) => {
          event.preventDefault();
          event.stopPropagation();
          deleteClass(item);
        });
        actions.append(rename, remove);
      }
      trailingControls.append(actions);
    }
    if (classKind(item) === 'middle') {
      // 中間クラスの「＋」は、保持中のクラスをこの中間クラスへ移動する操作。
      // 対象・中間・上位クラスの選択中に移動先として表示する。
      const moveButton = addTreeButton('＋', () => moveHeldToMiddle(item.id));
      moveButton.classList.add('move-held-button', 'move-held-middle-button');
      moveButton.dataset.destinationClassId = item.id;
      moveButton.hidden = heldMiddleClasses.has(item.id)
        || (!heldInstances.size && !heldMiddleClasses.size && !heldTopClasses.size);
      moveButton.setAttribute('aria-label', 'ここへ移動');
      moveButton.title = heldTopClasses.size
        ? '上位クラスを中間クラスに変換し、配下を保ってここへ移動'
        : '選択中のクラスをここへ移動';
      trailingControls.append(moveButton);
    }
    if (classKind(item) === 'top') {
      const isUnclassified = item.label === '未分類';
      // 未分類はクラスだけを受け入れ、他の上位クラスは保持中クラスを受け入れる。
      const addButton = addTreeButton('＋', () => {
        if (!isUnclassified) moveHeldClassesToTop(item.id);
        else moveHeldToTop(item.id);
      });
      // 中間クラス側の移動ボタンと同じスタイルを適用する。
      addButton.classList.add('move-held-button');
      if (!isUnclassified) {
        addButton.classList.add('move-held-middle-button');
        addButton.dataset.destinationClassId = item.id;
      }
      addButton.hidden = isUnclassified
        ? heldInstances.size === 0
        : heldMiddleClasses.size === 0 && heldTopClasses.size === 0 && heldInstances.size === 0;
      addButton.setAttribute('aria-label', 'ここへ移動');
      addButton.title = isUnclassified
        ? '保持中のクラスを未分類へ移動'
        : '保持中のクラスをここへ移動';
      trailingControls.append(addButton);
    }
  };
  window.renderHierarchyTree(tree, model, {
    displayId: displayClassId,
    targetCountFor: (item) => countTargetInstances(item.id),
    isOpen: (node) => openNodeIds.has(node.id) || previouslyOpenNodeIds.has(node.id),
    configureDetails: (details, node, depth) => {
      if (node.type === 'middle') details.style.setProperty('--middle-sticky-z', String(14 + depth));
    },
    onToggle: (details) => {
      if (!details.open) restoreTreeViewportAnchor(details);
    },
    decorateSummary,
    beforeChildren: (node, list) => {
      const item = classById.get(node.id);
      if (item && item.label !== '未分類') {
        list.append(addTreeRow('中間クラスを追加', () => addMiddleClass(item.id)));
      }
    },
    renderTarget,
    renderRootExtra: () => addTreeRow(
      heldMiddleClasses.size ? `選択した中間クラスを上位化（${heldMiddleClasses.size}件）` : '上位クラスを追加',
      addTopClass,
      'tree-root-add-row'
    ),
    afterChildren: () => scheduleTargetConnectorLayout(),
    afterRender: () => {
      syncTreeSelectionAppearance();
      scheduleTargetConnectorLayout();
    }
  });
}

// 選択済みの階層項目をまとめてドラッグし、別の上位・中間クラスへ移動する。
const editTree = document.getElementById('edit-tree');
const selectedTreeClassIds = () => [
  ...heldTopClasses.keys(), ...heldMiddleClasses.keys(), ...heldInstances.keys()
];
const syncTreeMoveButtonVisibility = () => {
  const hasSelection = heldInstances.size > 0 || heldMiddleClasses.size > 0 || heldTopClasses.size > 0;
  editTree.querySelectorAll('.move-held-button[data-destination-class-id]').forEach((button) => {
    button.hidden = !hasSelection || activeTreeDragIds.includes(button.dataset.destinationClassId);
  });
};
const showTreeDragSummary = (clientX = -10000, clientY = -10000) => {
  if (!treeDragSummary) {
    treeDragSummary = document.createElement('div');
    treeDragSummary.className = 'tree-drag-summary';
    treeDragSummary.setAttribute('role', 'status');
    treeDragSummary.setAttribute('aria-live', 'polite');
    document.body.append(treeDragSummary);
  }
  treeDragSummary.replaceChildren();
  const label = document.createElement('span');
  label.textContent = treeDragSummaryLabel;
  treeDragSummary.append(label);
  if (treeDragSummaryCount > 1) {
    const count = document.createElement('span');
    count.className = 'tree-drag-summary-count';
    count.textContent = String(treeDragSummaryCount);
    treeDragSummary.append(count);
  }
  treeDragSummary.hidden = false;
  treeDragSummary.style.left = `${clientX + 14}px`;
  treeDragSummary.style.top = `${clientY + 18}px`;
  treeDragSummary.style.transform = 'none';
};
const hideTreeDragSummary = () => {
  if (treeDragSummary) treeDragSummary.hidden = true;
};
const clearTreeDragSourceAppearance = () => {
  editTree.querySelectorAll('[data-drag-class-id].is-dragging').forEach((element) => element.classList.remove('is-dragging'));
  treeDragRootIds = [];
};
const clearTreeDragHoverOpen = () => {
  window.clearTimeout(treeDragHoverOpenTimer);
  treeDragHoverOpenTimer = 0;
  treeDragHoverOpenTarget = null;
};
const scheduleTreeDragHoverOpen = (destination) => {
  const details = destination?.parentElement;
  if (!details?.matches('.tree-top-class, .tree-middle-class') || details.open
    || activeTreeDragIds.includes(destination.dataset.dragClassId)) {
    clearTreeDragHoverOpen();
    return;
  }
  if (treeDragHoverOpenTarget === details) return;
  clearTreeDragHoverOpen();
  treeDragHoverOpenTarget = details;
  treeDragHoverOpenTimer = window.setTimeout(() => {
    treeDragHoverOpenTimer = 0;
    if (treeDragHoverOpenTarget !== details || !details.isConnected || activeTreeDragIds.includes(details.dataset.classId)) return;
    details.open = true;
    treeDragHoverOpenTarget = null;
  }, 650);
};
const beginTreeDrag = (id) => {
  const item = classById.get(id);
  const kind = item ? classKind(item) : null;
  if (!item || isUnclassified(item)) return false;
  const selection = kind === 'top' ? heldTopClasses : kind === 'middle' ? heldMiddleClasses : kind === 'class' ? heldInstances : null;
  if (!selection) return false;
  if (!selection.has(id)) {
    temporaryTreeDragSelection = {
      before: snapshotEditState(),
      historyLength: editUndoStack.length,
      hadUnsavedChanges: hasUnsavedChanges
    };
    heldInstances.clear();
    heldMiddleClasses.clear();
    heldTopClasses.clear();
    applyTreeSubtreeSelection([id], true);
    syncTargetButtonAvailability();
    renderInstances();
  } else {
    temporaryTreeDragSelection = null;
  }
  activeTreeDragIds = selectedTreeClassIds();
  const selectedTopIds = [...heldTopClasses.keys()].filter((selectedId) => !isUnclassified(classById.get(selectedId)));
  const belowSelectedTop = new Set(selectedTopIds.flatMap((selectedId) => [...descendantIds(selectedId)]));
  const selectedMiddleIds = [...heldMiddleClasses.keys()].filter((selectedId) => !belowSelectedTop.has(selectedId));
  const belowSelectedMiddle = new Set(selectedMiddleIds.flatMap((selectedId) => [...descendantIds(selectedId)]));
  const selectedTargetIds = [...heldInstances.keys()].filter((selectedId) =>
    !belowSelectedTop.has(selectedId) && !belowSelectedMiddle.has(selectedId));
  const dragRoots = [...selectedTopIds, ...selectedMiddleIds, ...selectedTargetIds];
  clearTreeDragSourceAppearance();
  treeDragRootIds = dragRoots;
  treeDragSummaryCount = dragRoots.length;
  treeDragSummaryLabel = dragRoots.length === 1
    ? String(classById.get(dragRoots[0])?.label || item.label)
    : '複数クラス';
  treeDragRootIds.forEach((rootId) => {
    editTree.querySelectorAll('[data-drag-class-id]').forEach((element) => {
      if (element.dataset.dragClassId === rootId) element.classList.add('is-dragging');
    });
  });
  syncTreeMoveButtonVisibility();
  showTreeDragSummary();
  return activeTreeDragIds.length > 0;
};
const finishTreeDrag = () => {
  clearTreeDragHoverOpen();
  hideTreeDragSummary();
  clearTreeDragSourceAppearance();
  if (!temporaryTreeDragSelection) return;
  if (editUndoStack.length > temporaryTreeDragSelection.historyLength) {
    editUndoStack.at(-1).before = temporaryTreeDragSelection.before;
  } else {
    restoreEditState(temporaryTreeDragSelection.before);
    hasUnsavedChanges = temporaryTreeDragSelection.hadUnsavedChanges;
    syncTreeSelectionAppearance();
    syncTargetButtonAvailability();
    renderInstances();
    render();
  }
  temporaryTreeDragSelection = null;
};
const setTreeDropTarget = (destination) => {
  editTree.querySelectorAll('.is-drop-target').forEach((element) => element.classList.remove('is-drop-target'));
  touchTreeDrag.destination = destination || null;
  destination?.classList.add('is-drop-target');
  scheduleTreeDragHoverOpen(destination);
};
const scrollTreeDuringDrag = (clientY) => {
  const edgeSize = 72;
  const maxScroll = 24;
  let delta = 0;
  if (clientY < edgeSize) {
    delta = -Math.ceil(maxScroll * Math.min(1, (edgeSize - clientY) / edgeSize));
  } else if (clientY > window.innerHeight - edgeSize) {
    delta = Math.ceil(maxScroll * Math.min(1, (clientY - (window.innerHeight - edgeSize)) / edgeSize));
  }
  if (delta) window.scrollBy({ top: delta, behavior: 'auto' });
};
const applyTreeDrop = (destination) => {
  const destinationItem = classById.get(destination?.dataset.dragClassId);
  if (!destinationItem) return;
  if (classKind(destinationItem) === 'middle') {
    moveHeldToMiddle(destinationItem.id);
  } else if (classKind(destinationItem) === 'top' && isUnclassified(destinationItem)) {
    if (heldMiddleClasses.size || heldTopClasses.size) {
      logEditAction('未分類には対象クラスだけを移動できます。', 'warn');
      return;
    }
    moveHeldToTop(destinationItem.id);
  } else if (classKind(destinationItem) === 'top') {
    if (heldTopClasses.size) moveHeldToMiddle(destinationItem.id);
    else moveHeldClassesToTop(destinationItem.id);
  }
};
editTree?.addEventListener('dragstart', (event) => {
  const source = event.target.closest('[data-drag-class-id]');
  const id = source?.dataset.dragClassId;
  if (!id || !beginTreeDrag(id)) {
    event.preventDefault();
    return;
  }
  event.dataTransfer.effectAllowed = 'move';
  event.dataTransfer.setData('text/plain', id);
  showTreeDragSummary(event.clientX, event.clientY);
  if (event.dataTransfer.setDragImage) {
    const transparentDragImage = document.createElement('canvas');
    transparentDragImage.width = 1;
    transparentDragImage.height = 1;
    transparentDragImage.style.cssText = 'position:fixed;left:-10000px;top:-10000px';
    document.body.append(transparentDragImage);
    event.dataTransfer.setDragImage(transparentDragImage, 0, 0);
    window.setTimeout(() => transparentDragImage.remove(), 0);
  }
  source.classList.add('is-dragging');
});
editTree?.addEventListener('dragend', (event) => {
  event.target.closest('[data-drag-class-id]')?.classList.remove('is-dragging');
  setTreeDropTarget(null);
  finishTreeDrag();
  activeTreeDragIds = [];
});
editTree?.addEventListener('dragover', (event) => {
  if (!activeTreeDragIds.length) return;
  event.preventDefault();
  const destination = event.target.closest('summary[data-drag-class-id]');
  event.dataTransfer.dropEffect = 'move';
  setTreeDropTarget(destination);
});
document.addEventListener('dragover', (event) => {
  if (!activeTreeDragIds.length) return;
  showTreeDragSummary(event.clientX, event.clientY);
  scrollTreeDuringDrag(event.clientY);
  if (!editTree.contains(event.target)) setTreeDropTarget(null);
});
editTree?.addEventListener('dragleave', (event) => {
  const destination = event.target.closest('summary[data-drag-class-id]');
  if (destination && !destination.contains(event.relatedTarget)) setTreeDropTarget(null);
});
editTree?.addEventListener('drop', (event) => {
  const destination = event.target.closest('summary[data-drag-class-id]');
  if (!destination || !activeTreeDragIds.length) return;
  event.preventDefault();
  event.stopPropagation();
  applyTreeDrop(destination);
  finishTreeDrag();
});
editTree?.addEventListener('touchstart', (event) => {
  if (event.touches.length !== 1) return;
  const source = event.target.closest('[data-drag-class-id]');
  const control = event.target.closest('input, button');
  if (control && control !== source) return;
  const id = source?.dataset.dragClassId;
  if (!id || !classById.has(id)) return;
  const touch = event.touches[0];
  touchTreeDrag.source = source;
  touchTreeDrag.startX = touch.clientX;
  touchTreeDrag.startY = touch.clientY;
  touchTreeDrag.active = false;
  touchTreeDrag.timer = window.setTimeout(() => {
    if (!touchTreeDrag.source?.isConnected || !beginTreeDrag(id)) return;
    touchTreeDrag.ids = [...activeTreeDragIds];
    touchTreeDrag.active = true;
    showTreeDragSummary(touch.clientX, touch.clientY);
    touchTreeDrag.source.classList.add('is-dragging');
    document.body.classList.add('is-tree-touch-dragging');
  }, 500);
}, { passive: true });
editTree?.addEventListener('touchmove', (event) => {
  if (!touchTreeDrag.source) return;
  const touch = event.touches[0];
  if (!touchTreeDrag.active) {
    if (Math.hypot(touch.clientX - touchTreeDrag.startX, touch.clientY - touchTreeDrag.startY) > 10) {
      window.clearTimeout(touchTreeDrag.timer);
      touchTreeDrag.source = null;
    }
    return;
  }
  event.preventDefault();
  scrollTreeDuringDrag(touch.clientY);
  showTreeDragSummary(touch.clientX, touch.clientY);
  const element = document.elementFromPoint(touch.clientX, touch.clientY);
  setTreeDropTarget(element?.closest('summary[data-drag-class-id]') || null);
}, { passive: false });
editTree?.addEventListener('touchend', (event) => {
  window.clearTimeout(touchTreeDrag.timer);
  if (touchTreeDrag.active) {
    event.preventDefault();
    if (touchTreeDrag.destination && touchTreeDrag.ids.length) applyTreeDrop(touchTreeDrag.destination);
    finishTreeDrag();
    touchTreeDrag.source?.classList.remove('is-dragging');
    document.body.classList.remove('is-tree-touch-dragging');
    setTreeDropTarget(null);
  }
  touchTreeDrag = { timer: 0, source: null, startX: 0, startY: 0, active: false, destination: null, ids: [] };
}, { passive: false });
editTree?.addEventListener('touchcancel', () => {
  window.clearTimeout(touchTreeDrag.timer);
  touchTreeDrag.source?.classList.remove('is-dragging');
  document.body.classList.remove('is-tree-touch-dragging');
  setTreeDropTarget(null);
  finishTreeDrag();
  touchTreeDrag = { timer: 0, source: null, startX: 0, startY: 0, active: false, destination: null, ids: [] };
});
editTree?.addEventListener('contextmenu', (event) => {
  if (touchTreeDrag.active) event.preventDefault();
});

window.addEventListener('class-editor-test-preferences-change', (event) => {
  if (event.detail && 'treeColorIntensity' in event.detail) renderTree();
});
function scheduleTreeRender() {
  if (treeRenderFrame) return;
  treeRenderFrame = requestAnimationFrame(() => {
    treeRenderFrame = 0;
    renderTree();
  });
}
