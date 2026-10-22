const searchForm = document.getElementById('search-form');
const searchInput = document.getElementById('search');
const clearSearchButton = document.getElementById('clear-search');
const rowsElement = document.getElementById('rows');
const treeElement = document.getElementById('tree');
const summaryElement = document.getElementById('summary');
const modeDescription = document.getElementById('mode-description');
let renderTargetClassList = null;
let renderInstanceList = null;
let treeStickyLayoutFrame = 0;

function scheduleBrowseTreeLayout() {
  if (treeStickyLayoutFrame) return;
  treeStickyLayoutFrame = requestAnimationFrame(() => {
    treeStickyLayoutFrame = 0;
    window.updateTreeStickyOffsets(treeElement);
    window.updateTreeTargetRowStarts(treeElement);
  });
}

window.addEventListener('resize', scheduleBrowseTreeLayout);

document.querySelector('[data-close-all-tree]')?.addEventListener('click', () => {
  treeElement.querySelectorAll('details[open]').forEach((details) => { details.open = false; });
});

const toggleBrowseIds = document.getElementById('toggle-browse-ids');
if (toggleBrowseIds) {
  toggleBrowseIds.addEventListener('click', () => {
    const visible = document.body.classList.toggle('browse-show-ids');
    toggleBrowseIds.setAttribute('aria-pressed', visible ? 'true' : 'false');
    toggleBrowseIds.textContent = `クラスID表示: ${visible ? 'ON' : 'OFF'}`;
  });
}

function renderClassListRows(elementId, items, relatedClassesById = null, instanceCountsByClassId = null) {
  const target = document.getElementById(elementId);
  if (!target) return;
  target.replaceChildren(...items.map((item) => {
    const row = document.createElement('tr');
    const id = document.createElement('td');
    const label = document.createElement('td');
    id.append(document.createTextNode(String(item.id)));
    id.append(createCopyIdButton(item.id));
    label.textContent = item.label;
    row.append(id, label);
    if (instanceCountsByClassId) {
      const count = document.createElement('td');
      count.className = 'class-instance-count';
      count.textContent = `${instanceCountsByClassId.get(item.id)?.size || 0}件`;
      row.append(count);
    }
    if (relatedClassesById) {
      const relatedCell = document.createElement('td');
      const relationship = relatedClassesById.get(item.id) || [];
      const relatedClasses = Array.isArray(relationship) ? relationship : relationship.parents;
      if (relatedClasses.length) {
        relatedClasses.forEach((relatedClass) => {
          const button = document.createElement('button');
          button.type = 'button';
          button.className = 'related-class-link';
          button.textContent = relatedClass.label || relatedClass.id;
          button.setAttribute('aria-label', `${relatedClass.label || relatedClass.id} の階層ツリーを表示`);
          button.addEventListener('click', () => showClassInTree(relatedClass.id));
          relatedCell.append(button);
        });
      }
      if (!Array.isArray(relationship) && relationship.children?.length) {
        const countButton = document.createElement('button');
        countButton.type = 'button';
        countButton.className = 'contained-class-count-button';
        countButton.textContent = `子クラス ${relationship.children.length}件`;
        countButton.setAttribute('aria-label', `${item.label} に含まれるクラス ${relationship.children.length}件を表示`);
        countButton.addEventListener('click', () => showContainedClasses(item, relationship.children));
        relatedCell.append(countButton);
      } else if (!relatedClasses.length) {
        relatedCell.textContent = '—';
      }
      row.append(relatedCell);
    }
    return row;
  }));
}

function showContainedClasses(middleClass, containedClasses) {
  const dialog = document.getElementById('contained-class-dialog');
  const title = document.getElementById('contained-class-title');
  const count = document.getElementById('contained-class-count');
  const list = document.getElementById('contained-class-list');
  if (!dialog || !title || !count || !list) return;
  title.textContent = `${middleClass.label || middleClass.id} に含まれるクラス`;
  count.textContent = `${containedClasses.length}件`;
  list.replaceChildren(...containedClasses.map((classInfo) => {
    const item = document.createElement('li');
    const button = document.createElement('button');
    const id = document.createElement('small');
    button.type = 'button';
    button.className = 'related-class-link';
    button.textContent = classInfo.label || classInfo.id;
    button.setAttribute('aria-label', `${classInfo.label || classInfo.id} の階層ツリーを表示`);
    button.addEventListener('click', () => {
      dialog.close();
      showClassInTree(classInfo.id);
    });
    id.textContent = classInfo.id;
    item.append(button, id);
    return item;
  }));
  dialog.showModal();
}

function createCopyIdButton(id) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'copy-id-button';
  button.textContent = 'コピー';
  button.setAttribute('aria-label', `ID ${id} をコピー`);
  button.addEventListener('click', () => copyIdentifier(id, button));
  return button;
}

async function copyIdentifier(value, button) {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(String(value));
    } else {
      const input = document.createElement('textarea');
      input.value = String(value);
      input.style.position = 'fixed';
      input.style.opacity = '0';
      document.body.append(input);
      input.select();
      const copied = document.execCommand('copy');
      input.remove();
      if (!copied) throw new Error('Clipboard copy failed');
    }
    button.textContent = 'コピー済み';
    window.setTimeout(() => { button.textContent = 'コピー'; }, 1200);
  } catch {
    button.textContent = '失敗';
    window.setTimeout(() => { button.textContent = 'コピー'; }, 1600);
  }
}

function renderClassLists(data) {
  const allClasses = data.classData?.classes || [];
  const tops = data.topClassList?.classes || allClasses.filter((item) => item.id.includes('/t_'));
  const middles = data.middleClassList?.classes || allClasses.filter((item) => item.id.includes('/m_'));
  const targets = allClasses.filter((item) => item.id.includes('/c_'));
  const instances = data.instanceData?.instances || [];
  const classById = new Map(allClasses.map((item) => [item.id, item]));
  const classesByInstanceId = new Map();
  (data.instanceClassData?.relations || []).forEach((relation) => {
    const classInfo = classById.get(relation.class);
    if (!classInfo) return;
    if (!classesByInstanceId.has(relation.instance)) classesByInstanceId.set(relation.instance, new Map());
    classesByInstanceId.get(relation.instance).set(classInfo.id, classInfo);
  });
  renderClassListRows('top-class-rows', tops);
  renderClassListRows('middle-class-rows', middles);

  const topFilter = document.getElementById('top-class-filter');
  const middleFilter = document.getElementById('middle-class-filter');
  const textFilter = document.getElementById('class-text-filter');
  const downloadButton = document.getElementById('download-list-tsv');
  if (!topFilter || !middleFilter || !textFilter || !downloadButton) return;
  let filteredTargets = targets;
  let filteredTops = tops;
  let filteredMiddles = middles;
  let filteredInstances = instances;
  let instanceCurrentPage = 1;
  const instancePageSize = 100;

  topFilter.replaceChildren(new Option('すべて', ''));
  middleFilter.replaceChildren(new Option('すべて', ''));
  const parentMap = new Map();
  const childrenMap = new Map();
  (data.classData?.relations || []).forEach((relation) => {
    if (!parentMap.has(relation.child)) parentMap.set(relation.child, []);
    parentMap.get(relation.child).push(relation.parent);
    if (!childrenMap.has(relation.parent)) childrenMap.set(relation.parent, []);
    childrenMap.get(relation.parent).push(relation.child);
  });
  const ancestors = (id) => {
    const result = new Set();
    const pending = [...(parentMap.get(id) || [])];
    while (pending.length) {
      const current = pending.pop();
      if (result.has(current)) continue;
      result.add(current);
      pending.push(...(parentMap.get(current) || []));
    }
    return result;
  };
  const knownInstanceIds = new Set(instances.map((instance) => instance.id));
  const instanceIdsByClassId = new Map();
  (data.instanceClassData?.relations || []).forEach((relation) => {
    if (!knownInstanceIds.has(relation.instance)) return;
    new Set([relation.class, ...ancestors(relation.class)]).forEach((classId) => {
      if (!classById.has(classId)) return;
      if (!instanceIdsByClassId.has(classId)) instanceIdsByClassId.set(classId, new Set());
      instanceIdsByClassId.get(classId).add(relation.instance);
    });
  });
  const relatedTargets = new Map(targets.map((item) => [item.id,
    [...new Set(parentMap.get(item.id) || [])].map((id) => classById.get(id)).filter(Boolean)]));
  const containedTargets = (middleId) => {
    const found = new Map();
    const seen = new Set();
    const pending = [...(childrenMap.get(middleId) || [])];
    while (pending.length) {
      const id = pending.pop();
      if (seen.has(id)) continue;
      seen.add(id);
      if (id.includes('/c_')) {
        const classInfo = classById.get(id);
        if (classInfo) found.set(id, classInfo);
      } else {
        pending.push(...(childrenMap.get(id) || []));
      }
    }
    return [...found.values()].sort((a, b) => (a.label || a.id).localeCompare(b.label || b.id, 'ja'));
  };
  const relatedMiddles = new Map(middles.map((item) => [item.id, {
    parents: [...new Set(parentMap.get(item.id) || [])].map((id) => classById.get(id)).filter(Boolean),
    children: containedTargets(item.id),
  }]));
  const renderInstancePage = () => {
    const pageCount = Math.max(1, Math.ceil(filteredInstances.length / instancePageSize));
    instanceCurrentPage = Math.min(instanceCurrentPage, pageCount);
    const start = (instanceCurrentPage - 1) * instancePageSize;
    const pageItems = filteredInstances.slice(start, start + instancePageSize);
    const rows = pageItems.map((instance) => {
      const row = document.createElement('tr');
      const id = document.createElement('td');
      const label = document.createElement('td');
      const classes = document.createElement('td');
      id.append(document.createTextNode(String(instance.id)), createCopyIdButton(instance.id));
      label.textContent = instance.label || '';
      const relatedClasses = [...(classesByInstanceId.get(instance.id)?.values() || [])];
      if (relatedClasses.length) {
        relatedClasses.forEach((classInfo) => {
          const link = document.createElement('button');
          link.type = 'button';
          link.className = 'related-class-link';
          link.textContent = classInfo.label || classInfo.id;
          link.setAttribute('aria-label', `${classInfo.label || classInfo.id} の階層ツリーを表示`);
          link.addEventListener('click', () => showClassInTree(classInfo.id));
          classes.append(link);
        });
      } else {
        classes.textContent = '—';
      }
      row.append(id, label, classes);
      return row;
    });
    document.getElementById('instance-rows').replaceChildren(...rows);
    const pageInfo = document.getElementById('instance-page-info');
    const first = filteredInstances.length ? start + 1 : 0;
    const last = Math.min(start + instancePageSize, filteredInstances.length);
    pageInfo.textContent = `${first}–${last}件 / ${filteredInstances.length}件（${instanceCurrentPage} / ${pageCount}ページ）`;
    document.getElementById('instance-page-prev').disabled = instanceCurrentPage <= 1;
    document.getElementById('instance-page-next').disabled = instanceCurrentPage >= pageCount;
  };
  const addOptions = (select, items) => items.forEach((item) => {
    const option = document.createElement('option');
    option.value = item.id;
    option.textContent = item.label;
    select.append(option);
  });
  addOptions(topFilter, tops);
  addOptions(middleFilter, middles);
  const updateTargets = () => {
    const topId = topFilter.value;
    const middleId = middleFilter.value;
    const text = textFilter.value.trim().toLocaleLowerCase();
    const filtered = targets.filter((item) => {
      const parentIds = ancestors(item.id);
      const matchesTop = !topId || parentIds.has(topId);
      const matchesMiddle = !middleId || parentIds.has(middleId);
      const matchesText = !text || `${item.id} ${item.label}`.toLocaleLowerCase().includes(text);
      return matchesTop && matchesMiddle && matchesText;
    });
    filteredTargets = filtered;
    renderClassListRows('target-class-rows', filtered, relatedTargets, instanceIdsByClassId);
  };
  const updateOtherLists = () => {
    const text = textFilter.value.trim().toLocaleLowerCase();
    const filterByText = (items) => !text ? items : items.filter((item) =>
      `${item.id} ${item.label}`.toLocaleLowerCase().includes(text));
    const topId = topFilter.value;
    filteredTops = filterByText(tops);
    filteredMiddles = filterByText(middles).filter((item) =>
      !topId || ancestors(item.id).has(topId));
    filteredInstances = filterByText(instances);
    instanceCurrentPage = 1;
    renderClassListRows('top-class-rows', filteredTops, null, instanceIdsByClassId);
    renderClassListRows('middle-class-rows', filteredMiddles, relatedMiddles, instanceIdsByClassId);
    if (document.getElementById('instance-tab')?.classList.contains('is-active')) {
      renderInstancePage();
    }
  };
  renderInstanceList = () => {
    const text = textFilter.value.trim().toLocaleLowerCase();
    filteredInstances = !text ? instances : instances.filter((item) =>
      `${item.id} ${item.label}`.toLocaleLowerCase().includes(text));
    instanceCurrentPage = 1;
    renderInstancePage();
  };
  downloadButton.onclick = () => {
    const activeListId = document.querySelector('.list-tab.is-active')?.id;
    const items = activeListId === 'middle-class-tab' ? filteredMiddles
      : activeListId === 'top-class-tab' ? filteredTops
        : activeListId === 'instance-tab' ? filteredInstances
          : filteredTargets;
    const filename = activeListId === 'middle-class-tab' ? 'middle-class-list.tsv'
      : activeListId === 'top-class-tab' ? 'top-class-list.tsv'
        : activeListId === 'instance-tab' ? 'instance-list.tsv'
          : 'class-list.tsv';
    const escapeTsv = (value) => String(value ?? '').replace(/\t/g, ' ').replace(/\r?\n/g, ' ');
    const isInstanceList = activeListId === 'instance-tab';
    const isRelatedClassList = activeListId === 'middle-class-tab' || activeListId === 'target-class-tab';
    const isClassList = ['middle-class-tab', 'target-class-tab', 'top-class-tab'].includes(activeListId);
    const headers = ['ID', 'ラベル'];
    if (isClassList) headers.push('インスタンス数');
    if (isInstanceList || isRelatedClassList) headers.push('関連クラス');
    const lines = [headers.join('\t'), ...items.map((item) => {
      const base = `${escapeTsv(item.id)}\t${escapeTsv(item.label)}`;
      const instanceCount = instanceIdsByClassId.get(item.id)?.size || 0;
      const classBase = `${base}\t${instanceCount}件`;
      if (isRelatedClassList) {
        const relatedMap = activeListId === 'middle-class-tab' ? relatedMiddles : relatedTargets;
        const relationship = relatedMap.get(item.id) || [];
        const relatedClasses = activeListId === 'middle-class-tab'
          ? `${relationship.parents.map((classInfo) => classInfo.label || classInfo.id).join(' / ')}${relationship.parents.length ? ' / ' : ''}内包クラス ${relationship.children.length}件`
          : relationship.map((classInfo) => classInfo.label || classInfo.id).join(' / ');
        return `${classBase}\t${escapeTsv(relatedClasses)}`;
      }
      if (!isInstanceList) return classBase;
      const relatedClasses = [...(classesByInstanceId.get(item.id)?.values() || [])]
        .map((classInfo) => classInfo.label || classInfo.id).join(' / ');
      return `${base}\t${escapeTsv(relatedClasses)}`;
    })];
    const blob = new Blob([`\ufeff${lines.join('\r\n')}\r\n`], { type: 'text/tab-separated-values;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    link.click();
    URL.revokeObjectURL(url);
  };
  topFilter.oninput = () => {
    updateTargets();
    updateOtherLists();
  };
  middleFilter.oninput = updateTargets;
  textFilter.oninput = () => {
    updateTargets();
    updateOtherLists();
  };
  renderTargetClassList = updateTargets;
  if (document.getElementById('target-class-panel')?.hidden === false) updateTargets();
  updateOtherLists();
  document.getElementById('instance-page-prev').onclick = () => {
    if (instanceCurrentPage <= 1) return;
    instanceCurrentPage -= 1;
    renderInstancePage();
  };
  document.getElementById('instance-page-next').onclick = () => {
    if (instanceCurrentPage * instancePageSize >= filteredInstances.length) return;
    instanceCurrentPage += 1;
    renderInstancePage();
  };
  document.getElementById('clear-list-filters').onclick = () => {
    topFilter.value = '';
    middleFilter.value = '';
    textFilter.value = '';
    updateTargets();
    updateOtherLists();
  };
}

document.querySelectorAll('.mode-button').forEach((button) => {
  button.addEventListener('click', () => {
    const isEditMode = button.dataset.mode === 'edit';
    document.querySelectorAll('.mode-button').forEach((item) => {
      const active = item === button;
      item.classList.toggle('is-active', active);
      item.setAttribute('aria-pressed', active ? 'true' : 'false');
    });
    document.body.dataset.mode = isEditMode ? 'edit' : 'browse';
    const editPanel = document.getElementById('class-edit-panel');
    if (editPanel) editPanel.hidden = !isEditMode;
    modeDescription.textContent = isEditMode
      ? '編集モードです。分類変更機能は次の段階で追加します。'
      : 'クラス階層と所属を確認できます。';
  });
});

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
  const treeRect = treeElement.getBoundingClientRect();
  const cardRect = target.getBoundingClientRect();
  treeElement.scrollTo({
    top: treeElement.scrollTop + cardRect.top - treeRect.top - 48,
    behavior: 'smooth'
  });
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

function renderSummary(rows) {
  const topCounts = new Map();
  const middleCounts = new Map();
  rows.forEach((row) => {
    topCounts.set(row.topClass, (topCounts.get(row.topClass) || 0) + 1);
    const key = `${row.topClass} / ${row.middleClass}`;
    middleCounts.set(key, (middleCounts.get(key) || 0) + 1);
  });
  const table = (title, counts) => {
    const section = document.createElement('div');
    const heading = document.createElement('h3');
    heading.textContent = title;
    section.append(heading);
    const list = document.createElement('ul');
    [...counts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).forEach(([name, value]) => {
      const item = document.createElement('li');
      item.textContent = `${name}: ${value} 件`;
      list.append(item);
    });
    section.append(list);
    return section;
  };
  summaryElement.replaceChildren(table('上位クラス別', topCounts), table('中間クラス別', middleCounts));
}

function render(rows) {
  renderTree(rows);
  if (summaryElement) renderSummary(rows);
  if (!rowsElement) return;
  rowsElement.replaceChildren(...rows.map((row) => {
    const tableRow = document.createElement('tr');
    [row.topClass, row.topClassId, row.middleClass, row.middleClassId, row.id, row.label].forEach((value) => {
      const cell = document.createElement('td');
      cell.textContent = value;
      tableRow.append(cell);
    });
    return tableRow;
  }));
}

if (window.appData) {
  // JSONでは階層クラスとクラスを分離し、画面内では従来どおり統合して扱う。
  window.appData.classData.classes = [
    ...(window.appData.classData.classes || []),
    ...(window.appData.targetClassData?.classes || [])
  ];
  const unclassified = window.appData.classData.classes.find((item) =>
    item.id.includes('/t_') && item.label === '未分類');
  if (unclassified) {
    const oldId = unclassified.id;
    unclassified.id = oldId.replace(/\/t_\d+$/, '/t_0');
    window.appData.classData.relations.forEach((relation) => {
      if (relation.parent === oldId) relation.parent = unclassified.id;
      if (relation.child === oldId) relation.child = unclassified.id;
    });
    [window.appData.topClassList].forEach((list) => list?.classes?.forEach((item) => {
      if (item.id === oldId) item.id = unclassified.id;
    }));
  }
}
let hierarchyRows = [];

function refresh(data) {
  hierarchyRows = buildHierarchyRows(data);
  render(hierarchyRows);
  renderClassLists(data);
}

function applySearch() {
  if (!searchInput) return;
  const query = searchInput.value.trim().toLocaleLowerCase();
  render(hierarchyRows.filter((row) =>
    Object.values(row).some((value) => value.toLocaleLowerCase().includes(query))));
}

if (searchForm && searchInput && clearSearchButton) {
  searchForm.addEventListener('submit', (event) => {
    event.preventDefault();
    applySearch();
  });
  clearSearchButton.addEventListener('click', () => {
    searchInput.value = '';
    render(hierarchyRows);
    searchInput.focus();
  });
}

if (window.appData) refresh(window.appData);
else render([]);

document.querySelectorAll('.tab').forEach((tab) => {
  tab.addEventListener('click', () => {
    document.querySelectorAll('.tab').forEach((item) => {
      item.classList.toggle('is-active', item === tab);
      item.setAttribute('aria-selected', item === tab ? 'true' : 'false');
    });
    document.querySelectorAll('.tab-panel').forEach((panel) => {
      const isActive = panel.id === tab.getAttribute('aria-controls');
      panel.hidden = !isActive;
      panel.style.display = isActive ? '' : 'none';
    });
    if (tab.id === 'list-tab' && document.getElementById('target-class-panel')?.hidden === false) {
      renderTargetClassList?.();
    }
  });
});

document.querySelectorAll('.list-tab').forEach((tab) => {
  tab.addEventListener('click', () => {
    document.querySelectorAll('.list-tab').forEach((item) => {
      const active = item === tab;
      item.classList.toggle('is-active', active);
      item.setAttribute('aria-selected', active ? 'true' : 'false');
    });
    document.querySelectorAll('.list-subpanel').forEach((panel) => {
      panel.hidden = panel.id !== tab.getAttribute('aria-controls');
    });
    document.querySelectorAll('.top-class-list-filter').forEach((filter) => {
      filter.hidden = !['target-class-tab', 'middle-class-tab'].includes(tab.id);
    });
    document.querySelectorAll('.middle-class-list-filter').forEach((filter) => {
      filter.hidden = tab.id !== 'target-class-tab';
    });
    if (tab.id === 'target-class-tab') renderTargetClassList?.();
    if (tab.id === 'instance-tab') renderInstanceList?.();
  });
});

const loadingIndicator = document.getElementById('loading-indicator');
if (loadingIndicator) loadingIndicator.hidden = true;
document.getElementById('tree-filter-type')?.addEventListener('change', (event) => {
  const queryInput = document.getElementById('tree-filter-query');
  if (queryInput) queryInput.placeholder = '名前・IDで検索';
  renderTree();
});
document.getElementById('tree-filter-query')?.addEventListener('input', () => {
  window.clearTimeout(treeSearchDebounceTimer);
  treeSearchDebounceTimer = window.setTimeout(scheduleTreeRender, 140);
});
function setTreeFilterMethod(method) {
  if (method === 'count') treeCountFilterEnabled = true;
  document.querySelector('.tree-filter-search-controls').hidden = method !== 'keyword';
  document.querySelector('.tree-filter-count-settings').hidden = method !== 'count';
  document.querySelectorAll('[data-tree-filter-method]').forEach((button) => {
    const active = button.dataset.treeFilterMethod === method;
    button.classList.toggle('is-active', active);
    button.setAttribute('aria-pressed', active ? 'true' : 'false');
  });
  renderTree();
}
document.querySelectorAll('[data-tree-filter-method]').forEach((button) => {
  button.addEventListener('click', () => setTreeFilterMethod(button.dataset.treeFilterMethod));
});
document.querySelector('.tree-filter')?.addEventListener('toggle', renderTree);
function scheduleTreeRender() {
  if (treeRenderFrame) return;
  treeRenderFrame = requestAnimationFrame(() => {
    treeRenderFrame = 0;
    renderTree();
  });
}
function updateTreeRangeBubbles() {
  const minSlider = document.getElementById('tree-filter-count-min');
  const maxSlider = document.getElementById('tree-filter-count-max');
  const maxIndex = Math.max(1, treeExactCountValues.length - 1);
  const startPercent = Math.min(Number(minSlider.value), Number(maxSlider.value)) / maxIndex * 100;
  const endPercent = Math.max(Number(minSlider.value), Number(maxSlider.value)) / maxIndex * 100;
  treeRangeSliderGroup.style.setProperty('--range-start', `${startPercent}%`);
  treeRangeSliderGroup.style.setProperty('--range-end', `${endPercent}%`);
  [
    { input: minSlider, bubble: document.getElementById('tree-filter-count-min-bubble') },
    { input: maxSlider, bubble: document.getElementById('tree-filter-count-max-bubble') }
  ].forEach(({ input, bubble }) => {
    const percent = Number(input.value) / maxIndex * 100;
    bubble.style.left = `clamp(1rem, ${percent}%, calc(100% - 1rem))`;
    bubble.textContent = `${treeExactCountValues[Number(input.value)] ?? 0}件`;
  });
}
function showTreeRangeBubble(input) {
  window.clearTimeout(treeRangeBubbleTimer);
  treeRangeSliderGroup.dataset.activeThumb = input.id.endsWith('-min') ? 'min' : 'max';
}
function hideTreeRangeBubbleSoon() {
  window.clearTimeout(treeRangeBubbleTimer);
  treeRangeBubbleTimer = window.setTimeout(() => delete treeRangeSliderGroup.dataset.activeThumb, 700);
}
['tree-filter-count-min', 'tree-filter-count-max'].forEach((id) => {
  const input = document.getElementById(id);
  input.addEventListener('pointerdown', () => showTreeRangeBubble(input));
  input.addEventListener('pointerup', hideTreeRangeBubbleSoon);
  input.addEventListener('focus', () => showTreeRangeBubble(input));
  input.addEventListener('blur', hideTreeRangeBubbleSoon);
  input.addEventListener('keydown', () => showTreeRangeBubble(input));
  input.addEventListener('keyup', hideTreeRangeBubbleSoon);
});
document.getElementById('tree-filter-count-min')?.addEventListener('input', (event) => {
  const maxInput = document.getElementById('tree-filter-count-max');
  if (Number(event.target.value) > Number(maxInput.value)) maxInput.value = event.target.value;
  treeCountRangeTouched = true;
  showTreeRangeBubble(event.target);
  scheduleTreeRender();
});
document.getElementById('tree-filter-count-max')?.addEventListener('input', (event) => {
  const minInput = document.getElementById('tree-filter-count-min');
  if (Number(event.target.value) < Number(minInput.value)) minInput.value = event.target.value;
  treeCountRangeTouched = true;
  showTreeRangeBubble(event.target);
  scheduleTreeRender();
});
const treeExactSlider = document.getElementById('tree-filter-count-exact-input');
const treeExactSliderWrap = document.querySelector('.tree-filter-exact-slider-wrap');
let treeExactBubbleTimer = 0;
function showTreeExactBubble() {
  window.clearTimeout(treeExactBubbleTimer);
  treeExactSliderWrap.classList.add('is-adjusting');
}
function hideTreeExactBubbleSoon() {
  window.clearTimeout(treeExactBubbleTimer);
  treeExactBubbleTimer = window.setTimeout(() => treeExactSliderWrap.classList.remove('is-adjusting'), 700);
}
treeExactSlider.addEventListener('pointerdown', showTreeExactBubble);
treeExactSlider.addEventListener('pointerup', hideTreeExactBubbleSoon);
treeExactSlider.addEventListener('focus', showTreeExactBubble);
treeExactSlider.addEventListener('blur', hideTreeExactBubbleSoon);
treeExactSlider.addEventListener('keydown', showTreeExactBubble);
treeExactSlider.addEventListener('keyup', hideTreeExactBubbleSoon);
document.getElementById('tree-filter-count-exact-input')?.addEventListener('input', (event) => {
  treeExactSelectedCount = treeExactCountValues[Number(event.target.value)] ?? treeExactCountValues[0];
  document.getElementById('tree-filter-count-exact-value').textContent = `${treeExactSelectedCount}件`;
  document.getElementById('tree-filter-count-exact-bubble').textContent = `${treeExactSelectedCount}件`;
  showTreeExactBubble();
  scheduleTreeRender();
});
document.getElementById('tree-filter-count-mode')?.addEventListener('change', (event) => {
  const exactMode = event.target.value === 'exact';
  document.getElementById('tree-filter-count-range').hidden = exactMode;
  document.getElementById('tree-filter-count-exact').hidden = !exactMode;
  renderTree();
});
window.addEventListener('resize', () => requestAnimationFrame(() => window.updateTreeTargetRowStarts(treeElement)));
