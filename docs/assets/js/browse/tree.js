// 閲覧画面向けのツリーデータ、検索、展開、インスタンス表示を担当する。共通描画は shared/tree.js を使う。
function buildHierarchyRows(data) {
  const classMap = new Map((data.classData.classes || []).map((item) => [item.id, item]));
  const parentMap = new Map();
  (data.classData.relations || []).forEach((relation) => {
    if (!parentMap.has(relation.child)) parentMap.set(relation.child, []);
    parentMap.get(relation.child).push(relation.parent);
  });
  const pathFor = (classId) => {
    const path = [classId];
    const seen = new Set(path);
    let current = classId;
    while (parentMap.has(current)) {
      const parent = parentMap.get(current)[0];
      if (seen.has(parent)) break;
      path.push(parent);
      seen.add(parent);
      current = parent;
    }
    return path.reverse();
  };
  // インスタンス単位ではなくクラス単位で行を作る。同じクラスに
  // 複数のインスタンスが属していても、階層上は1件だけ表示する。
  const rowsByClass = new Map();
  const instancesById = new Map((data.instanceData?.instances || []).map((instance) => [instance.id, instance]));
  (data.instanceClassData.relations || []).forEach((relation) => {
    const instance = instancesById.get(relation.instance);
    const classInfo = classMap.get(relation.class);
    if (!instance || !classInfo) return;
      if (rowsByClass.has(classInfo.id)) return;
      const path = pathFor(classInfo.id).map((id) => classMap.get(id) || { id, label: id });
      const top = path[0] || { id: 't_0', label: '未分類' };
      const leaf = path[path.length - 1] || classInfo;
      // 更新データによってはクラスが上位クラスへ直接つながる。
      // 階層の深さだけで判定すると、クラス(c_)自身を中間クラスとして表示してしまう。
      const isTargetClass = leaf.id.includes('/c_');
      const middle = path.length > 2
        ? path.slice(1, -1).map((item) => item.label).join(' / ')
        : (isTargetClass ? '（上位クラス直下）' : (path[1] ? path[1].label : '未分類'));
      rowsByClass.set(classInfo.id, {
        topClass: top.label,
        topClassId: top.id,
        middleClass: middle,
        middleClassId: path.length > 2 ? path[1].id : (isTargetClass ? '' : 'm_0'),
        id: leaf.id,
        label: leaf.label
      });
  });
  return [...rowsByClass.values()];
}

let treeCountRangeTouched = false;
let treeCountFilterEnabled = false;
let treeExactCountValues = [0];
let treeExactSelectedCount = null;
let treeRenderFrame = 0;
let treeSearchDebounceTimer = 0;
const treeRangeSliderGroup = document.querySelector('.tree-filter-range-sliders');
let treeRangeBubbleTimer = 0;
function renderTree() {
  const filterInput = document.getElementById('tree-filter-query');
  const filterType = document.getElementById('tree-filter-type');
  const filterCount = document.getElementById('tree-filter-count');
  const filterPanelOpen = document.querySelector('.tree-filter')?.open === true;
  const query = filterPanelOpen ? (filterInput?.value || '') : '';
  const instanceCountByClassId = new Map();
  const knownInstanceIds = new Set((window.appData.instanceData?.instances || []).map((instance) => instance.id));
  (window.appData.instanceClassData?.relations || []).forEach((relation) => {
    if (!knownInstanceIds.has(relation.instance)) return;
    if (!instanceCountByClassId.has(relation.class)) instanceCountByClassId.set(relation.class, new Set());
    instanceCountByClassId.get(relation.class).add(relation.instance);
  });
  const instanceCount = (classId) => instanceCountByClassId.get(classId)?.size || 0;
  const allTargets = window.findTargetMatches(window.appData, 'class', '').targets;
  treeExactCountValues = [...new Set(allTargets.map((item) => instanceCount(item.id)))].sort((a, b) => a - b);
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
  const minInput = document.getElementById('tree-filter-count-min');
  const maxInput = document.getElementById('tree-filter-count-max');
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
  const minCount = treeExactCountValues[minRangeIndex] ?? treeExactCountValues[0];
  const maxCount = treeExactCountValues[maxRangeIndex] ?? treeExactCountValues.at(-1);
  document.getElementById('tree-filter-count-min-value').textContent = `${minCount}件`;
  document.getElementById('tree-filter-count-max-value').textContent = `${maxCount}件`;
  updateTreeRangeBubbles();
  const countMode = document.getElementById('tree-filter-count-mode')?.value || 'range';
  const exactCount = treeExactSelectedCount;
  const countFilterActive = filterPanelOpen && treeCountFilterEnabled && (countMode === 'exact'
    ? exactCount !== null
    : treeCountRangeTouched);
  const effectiveSearchType = query.trim() ? (filterType?.value || 'class') : 'class';
  const { targets: matchedTargets } = window.findTargetMatches(window.appData, effectiveSearchType, query);
  const targets = matchedTargets.filter((item) =>
    (!countFilterActive || (countMode === 'exact'
      ? instanceCount(item.id) === exactCount
      : (minCount === null || instanceCount(item.id) >= minCount)
        && (maxCount === null || instanceCount(item.id) <= maxCount))));
  const filterActive = query.trim().length > 0 || countFilterActive;
  const targetIds = filterActive ? new Set(targets.map((item) => item.id)) : null;
  const preserveHierarchy = filterActive;
  const model = window.buildTreeModel(window.appData.classData, targetIds, preserveHierarchy) || [];
  const filterHidesTargets = targets.length < allTargets.length;
  const openNodeIds = filterActive && filterHidesTargets && targets.length > 0
    ? window.treeAncestorIds(window.appData.classData, targetIds)
    : new Set();
  const makeTarget = (item, _parent, depth) => {
    const li = document.createElement('li');
    const levelColor = window.treeDepthColor(depth);
    li.style.setProperty('--tree-level-color', levelColor);
    const card = document.createElement('div');
    card.className = 'tree-leaf-class';
    card.dataset.classId = item.id;
    card.style.setProperty('--tree-level-color', levelColor);
    const id = document.createElement('span'); id.className = 'tree-leaf-id'; id.textContent = String(item.id);
    const label = document.createElement('span'); label.className = 'tree-leaf-label'; label.textContent = window.treeLabel(item.label);
    const count = document.createElement('span'); count.className = 'target-instance-count-badge';
    count.textContent = `(${instanceCount(item.id)}件)`;
    const info = document.createElement('button');
    info.type = 'button'; info.className = 'tree-leaf-info-button'; info.textContent = 'i';
    info.setAttribute('aria-label', `${item.label}に関連するインスタンスを表示`);
    info.addEventListener('click', (event) => { event.preventDefault(); event.stopPropagation(); showTargetInstances(item); });
    card.append(id, label, count, info); li.append(card); return li;
  };
  window.renderHierarchyTree(treeElement, model, {
    isOpen: (node) => openNodeIds.has(node.id),
    renderTarget: makeTarget,
    targetCountFor: (item) => instanceCount(item.id),
    displayId: (id) => String(id),
    onToggle: (details) => {
      if (details.open || pendingBrowseCloseDetails !== details) return;
      pendingBrowseCloseDetails = null;
      const heading = details.querySelector(':scope > summary');
      if (heading?.getClientRects().length) alignBrowseHeadingToStickyPosition(heading);
    },
    afterChildren: scheduleBrowseTreeLayout,
    afterRender: scheduleBrowseTreeLayout
  });
  if (filterCount) filterCount.textContent = `${targets.length}件`;
}

async function showClassInTree(classId) {
  document.getElementById('tree-tab')?.click();
  const filterPanel = document.querySelector('.tree-filter');
  const queryInput = document.getElementById('tree-filter-query');
  const filterType = document.getElementById('tree-filter-type');
  if (filterPanel) filterPanel.open = true;
  if (queryInput) queryInput.value = '';
  if (filterType) filterType.value = 'class';
  treeCountFilterEnabled = false;
  treeCountRangeTouched = false;
  setTreeFilterMethod('keyword');
  const parents = new Map();
  (window.appData.classData.relations || []).forEach(({ child, parent }) => {
    if (!parents.has(child)) parents.set(child, []);
    parents.get(child).push(parent);
  });
  const path = [classId];
  const seen = new Set(path);
  let current = classId;
  while (parents.has(current)) {
    const parent = parents.get(current)[0];
    if (seen.has(parent)) break;
    path.push(parent);
    seen.add(parent);
    current = parent;
  }
  path.reverse();
  for (const id of path) {
    const node = [...treeElement.querySelectorAll('details[data-class-id]')]
      .find((item) => item.dataset.classId === id);
    if (!node) continue;
    if (!node.open) {
      const opened = new Promise((resolve) => node.addEventListener('toggle', resolve, { once: true }));
      node.open = true;
      await opened;
    }
  }
  const card = [...treeElement.querySelectorAll('.tree-leaf-class')]
    .find((item) => item.dataset.classId === classId);
  const node = [...treeElement.querySelectorAll('details[data-class-id]')]
    .find((item) => item.dataset.classId === classId);
  const target = card || node?.querySelector(':scope > summary');
  if (!target) return;
  await new Promise((resolve) => window.requestAnimationFrame(resolve));
  syncBrowseTreeStickyBounds();
  window.updateTreeStickyOffsets(treeElement);
  const cardRect = target.getBoundingClientRect();
  const visibleTop = getBrowseStickyHeadersBottom(target) + 8;
  window.scrollTo({ top: window.scrollY + cardRect.top - visibleTop, behavior: 'smooth' });
  target.classList.add('is-navigation-target');
  window.setTimeout(() => target.classList.remove('is-navigation-target'), 1800);
}

function showTargetInstances(targetClass) {
  const dialog = document.getElementById('target-instance-dialog');
  if (!dialog) return;
  const instancesById = new Map((window.appData.instanceData?.instances || []).map((instance) => [instance.id, instance]));
  const instances = (window.appData.instanceClassData.relations || [])
    .filter((relation) => relation.class === targetClass.id)
    .map((relation) => instancesById.get(relation.instance)).filter(Boolean);
  document.getElementById('target-instance-title').textContent = `${targetClass.label}の関連インスタンス`;
  document.getElementById('target-instance-count').textContent = `${instances.length}件`;
  const list = document.getElementById('target-instance-list');
  list.replaceChildren(...instances.map((instance) => {
    const li = document.createElement('li'); const label = document.createElement('span');
    label.textContent = instance.label || '(ラベルなし)'; const id = document.createElement('small');
    id.textContent = String(instance.id || '').split('/').pop(); li.append(label, id); return li;
  }));
  if (!instances.length) { const li = document.createElement('li'); li.textContent = '関連するインスタンスはありません。'; list.append(li); }
  dialog.showModal();
  dialog.onclick = (event) => { const rect = dialog.getBoundingClientRect(); if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) dialog.close(); };
}

function addClassFromTree(type, parentId = '') {
  if (document.body.dataset.mode !== 'edit') return;
  const label = window.prompt(`${type === 'middle' ? '中間' : type === 'top' ? '上位' : '対象'}クラス名を入力してください`);
  if (!label || !label.trim()) return;
  const prefix = type === 'top' ? 't_' : type === 'middle' ? 'm_' : 'c_';
  const classes = window.appData.classData.classes;
  const serial = classes.filter((item) => item.id.includes(`/${prefix}`)).length + 1;
  const item = { id: `new-${prefix}${String(serial).padStart(5, '0')}`, label: label.trim() };
  classes.push(item);
  if (type === 'top') window.appData.topClassList.classes.push(item);
  if (type === 'middle') window.appData.middleClassList.classes.push(item);
  if (parentId) {
    const parent = classes.find((candidate) => candidate.id === parentId);
    if (parent) window.appData.classData.relations.push({ child: item.id, parent: parent.id, relation: 'subClassOf' });
  }
  refresh(window.appData);
}

const addTopFromTree = document.getElementById('add-top-from-tree');
if (addTopFromTree) addTopFromTree.addEventListener('click', () => addClassFromTree('top'));

