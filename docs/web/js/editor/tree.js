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
  const tree = document.getElementById('edit-tree');
  if (!tree) return;
  const toolbarBottom = document.querySelector('.edit-taskbar')?.getBoundingClientRect().bottom ?? 0;
  const treeFilter = document.getElementById('tree-filter');
  const filterBottom = treeFilter && !treeFilter.hidden ? treeFilter.getBoundingClientRect().bottom : 0;
  const visibleTop = Math.max(toolbarBottom, filterBottom) + 4;
  const candidates = [...tree.querySelectorAll('.tree-top-class > summary, .tree-middle-class > summary, .tree-leaf-class')]
    .map((element) => ({ element, bounds: element.getBoundingClientRect() }))
    .filter(({ bounds }) => bounds.bottom > visibleTop && bounds.top < window.innerHeight)
    .sort((a, b) => Math.abs(a.bounds.top - visibleTop) - Math.abs(b.bounds.top - visibleTop));
  const visibleElement = candidates[0]?.element;
  const fallback = closeAll
    ? details?.closest('.tree-top-class')?.querySelector(':scope > summary')
      || tree.querySelector('.tree-top-class > summary')
    : details?.querySelector(':scope > summary');
  const anchor = visibleElement || fallback;
  if (!anchor) return;
  pendingTreeViewportAnchor = {
    details,
    closeAll,
    anchor,
    fallback,
    top: anchor.getBoundingClientRect().top
  };
}
function restoreTreeViewportAnchor(details) {
  const pending = pendingTreeViewportAnchor;
  if (!pending || (!pending.closeAll && pending.details !== details)) return;
  pendingTreeViewportAnchor = null;
  window.requestAnimationFrame(() => {
    const closedHeading = !pending.closeAll ? details?.querySelector(':scope > summary') : null;
    const anchor = closedHeading?.isConnected && closedHeading.getClientRects().length
      ? closedHeading
      : pending.anchor?.isConnected && pending.anchor.getClientRects().length
        ? pending.anchor
        : pending.fallback;
    if (!anchor?.isConnected || !anchor.getClientRects().length) return;
    const targetTop = pending.closeAll
      ? pending.top
      : Number.parseFloat(getComputedStyle(anchor).top) || 0;
    const difference = anchor.getBoundingClientRect().top - targetTop;
    if (Math.abs(difference) > 1) window.scrollBy(0, difference);
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
  const activeQuery = [...treeFilterKeywords, ...filterQuery.trim().split(/\s+/).filter(Boolean)];
  const filterActive = activeQuery.length > 0 || countFilterActive;
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
  const addTreeRow = (label, handler) => {
    const row = document.createElement('li');
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
      levelContent.prepend(checkbox);
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
      levelContent.prepend(checkbox);
    }
    if (treeHierarchyEditModeEnabled && item.label !== '未分類'
      && (classKind(item) === 'top' || classKind(item) === 'middle')) {
      const actions = document.createElement('span');
      actions.className = 'tree-class-edit-actions';
      actions.addEventListener('click', (event) => event.stopPropagation());
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
      summary.append(actions);
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
      summary.append(moveButton);
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
      summary.append(addButton);
    }
  };
  window.renderHierarchyTree(tree, model, {
    displayId: displayClassId,
    targetCountFor: (item) => countTargetInstances(item.id),
    isOpen: (node) => openNodeIds.has(node.id),
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
      addTopClass
    ),
    afterChildren: () => scheduleTargetConnectorLayout(),
    afterRender: () => scheduleTargetConnectorLayout()
  });
}
function scheduleTreeRender() {
  if (treeRenderFrame) return;
  treeRenderFrame = requestAnimationFrame(() => {
    treeRenderFrame = 0;
    renderTree();
  });
}
