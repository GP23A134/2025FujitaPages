const searchForm = document.getElementById('search-form');
const searchInput = document.getElementById('search');
const clearSearchButton = document.getElementById('clear-search');
const rowsElement = document.getElementById('rows');
const treeElement = document.getElementById('tree');
const summaryElement = document.getElementById('summary');
const modeDescription = document.getElementById('mode-description');
let renderTargetClassList = null;

const toggleBrowseIds = document.getElementById('toggle-browse-ids');
if (toggleBrowseIds) {
  toggleBrowseIds.addEventListener('click', () => {
    const visible = document.body.classList.toggle('browse-show-ids');
    toggleBrowseIds.setAttribute('aria-pressed', visible ? 'true' : 'false');
    toggleBrowseIds.textContent = `クラスID表示: ${visible ? 'ON' : 'OFF'}`;
  });
}

function renderClassListRows(elementId, items) {
  const target = document.getElementById(elementId);
  if (!target) return;
  target.replaceChildren(...items.map((item) => {
    const row = document.createElement('tr');
    const id = document.createElement('td');
    const label = document.createElement('td');
    id.textContent = displayClassId(item.id);
    label.textContent = item.label;
    row.append(id, label);
    return row;
  }));
}

function renderClassLists(data) {
  const allClasses = data.classData?.classes || [];
  const tops = data.topClassList?.classes || allClasses.filter((item) => item.id.includes('/t_'));
  const middles = data.middleClassList?.classes || allClasses.filter((item) => item.id.includes('/m_'));
  const targets = allClasses.filter((item) => item.id.includes('/c_'));
  renderClassListRows('top-class-rows', tops);
  renderClassListRows('middle-class-rows', middles);

  const topFilter = document.getElementById('top-class-filter');
  const middleFilter = document.getElementById('middle-class-filter');
  const textFilter = document.getElementById('class-text-filter');
  const downloadButton = document.getElementById('download-class-tsv');
  if (!topFilter || !middleFilter || !textFilter || !downloadButton) return;

  topFilter.replaceChildren(new Option('すべて', ''));
  middleFilter.replaceChildren(new Option('すべて', ''));
  const parentMap = new Map();
  (data.classData?.relations || []).forEach((relation) => {
    if (!parentMap.has(relation.child)) parentMap.set(relation.child, []);
    parentMap.get(relation.child).push(relation.parent);
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
  const addOptions = (select, items) => items.forEach((item) => {
    const option = document.createElement('option');
    option.value = item.id;
    option.textContent = `${item.label} (${displayClassId(item.id)})`;
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
    renderClassListRows('target-class-rows', filtered);
    downloadButton.onclick = () => {
      const escapeTsv = (value) => String(value ?? '').replace(/\t/g, ' ').replace(/\r?\n/g, ' ');
      const lines = ['ID\tラベル', ...filtered.map((item) => `${escapeTsv(item.id)}\t${escapeTsv(item.label)}`)];
      const blob = new Blob([`\ufeff${lines.join('\r\n')}\r\n`], { type: 'text/tab-separated-values;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = 'class-list.tsv';
      link.click();
      URL.revokeObjectURL(url);
    };
  };
  [topFilter, middleFilter, textFilter].forEach((element) => {
    element.oninput = updateTargets;
  });
  renderTargetClassList = updateTargets;
  if (document.getElementById('target-class-panel')?.hidden === false) updateTargets();
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
  // インスタンス単位ではなく対象クラス単位で行を作る。同じ対象クラスに
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
      // 更新データによっては対象クラスが上位クラスへ直接つながる。
      // 階層の深さだけで判定すると、対象クラス(c_)自身を中間クラスとして表示してしまう。
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

function textLabel(value) {
  return value.replace(/^"|"@[^@]+$/g, '');
}

function displayClassId(id) {
  const segment = String(id).split('/').pop();
  const match = segment.match(/^([cmt])_0*(\d+)$/);
  return match ? `${match[1]}_${Number(match[2])}` : segment;
}

function renderTree() {
  const filterInput = document.getElementById('tree-filter-query');
  const filterType = document.getElementById('tree-filter-type');
  const filterCount = document.getElementById('tree-filter-count');
  const query = filterInput?.value || '';
  const { targets, matchedInstanceCount } = window.findTargetMatches(window.appData, filterType?.value || 'class', query);
  const targetIds = query.trim() ? new Set(targets.map((item) => item.id)) : null;
  const model = window.buildTreeModel(window.appData.classData, targetIds) || [];
  const makeTarget = (item) => {
    const li = document.createElement('li');
    const card = document.createElement('div');
    card.className = 'tree-leaf-class';
    const id = document.createElement('span'); id.className = 'tree-leaf-id'; id.textContent = displayClassId(item.id);
    const label = document.createElement('span'); label.className = 'tree-leaf-label'; label.textContent = textLabel(item.label || '');
    const info = document.createElement('button');
    info.type = 'button'; info.className = 'tree-leaf-info-button'; info.textContent = 'i';
    info.setAttribute('aria-label', `${item.label}に関連するインスタンスを表示`);
    info.addEventListener('click', (event) => { event.preventDefault(); event.stopPropagation(); showTargetInstances(item); });
    card.append(id, label, info); li.append(card); return li;
  };
  window.renderHierarchyTree(treeElement, model, {
    isOpen: (node) => query.trim() ? true : node.type === 'top' && node.label !== '未分類',
    renderTarget: makeTarget,
    displayId: displayClassId,
    afterChildren: () => requestAnimationFrame(() => window.updateTreeTargetRowStarts(treeElement)),
    afterRender: (container) => requestAnimationFrame(() => window.updateTreeTargetRowStarts(container))
  });
  if (filterCount) filterCount.textContent = query.trim()
    ? filterType.value === 'instance'
      ? `一致インスタンス ${matchedInstanceCount}件に関連するクラス ${targets.length}件を表示中`
      : `一致するクラス ${targets.length}件を表示中`
    : `クラス ${window.appData.classData.classes.filter((item) => item.id.includes('/c_')).length}件`;
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
  // JSONでは階層クラスと対象クラスを分離し、画面内では従来どおり統合して扱う。
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
    if (tab.id === 'target-class-tab') renderTargetClassList?.();
  });
});

const loadingIndicator = document.getElementById('loading-indicator');
if (loadingIndicator) loadingIndicator.hidden = true;
document.getElementById('tree-filter-type')?.addEventListener('change', renderTree);
document.getElementById('tree-filter-query')?.addEventListener('input', renderTree);
window.addEventListener('resize', () => requestAnimationFrame(() => window.updateTreeTargetRowStarts(treeElement)));
