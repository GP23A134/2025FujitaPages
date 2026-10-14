const searchForm = document.getElementById('search-form');
const searchInput = document.getElementById('search');
const clearSearchButton = document.getElementById('clear-search');
const rowsElement = document.getElementById('rows');
const treeElement = document.getElementById('tree');
const summaryElement = document.getElementById('summary');
const modeDescription = document.getElementById('mode-description');

function renderClassListRows(elementId, items) {
  const target = document.getElementById(elementId);
  if (!target) return;
  target.replaceChildren(...items.map((item) => {
    const row = document.createElement('tr');
    const id = document.createElement('td');
    const label = document.createElement('td');
    id.textContent = item.id;
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
    renderClassListRows('target-class-rows', filtered);
    downloadButton.onclick = () => {
      const lines = ['ID\tラベル', ...filtered.map((item) => `${item.id}\t${item.label}`)];
      const blob = new Blob([`\ufeff${lines.join('\r\n')}\r\n`], { type: 'text/tab-separated-values;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = 'class-list.tsv';
      link.click();
      URL.revokeObjectURL(url);
    };
  };
  [topFilter, middleFilter, textFilter].forEach((element) => element.addEventListener('input', updateTargets));
  updateTargets();
}

if (window.appData) renderClassLists(window.appData);

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
  const rows = [];
  (data.instanceClassData.instances || []).forEach((instance) => {
    (instance.classes || []).forEach((classInfo) => {
      const path = pathFor(classInfo.id).map((id) => classMap.get(id) || { id, label: id });
      const top = path[0] || { id: 'unclassified-top', label: '未分類' };
      const middle = path.length > 2
        ? path.slice(1, -1).map((item) => item.label).join(' / ')
        : (path[1] ? path[1].label : '未分類');
      const leaf = path[path.length - 1] || classInfo;
      rows.push({
        topClass: top.label,
        topClassId: top.id,
        middleClass: middle,
        middleClassId: path.length > 1 ? path[1].id : 'unclassified-middle',
        id: leaf.id,
        label: leaf.label
      });
    });
  });
  return rows;
}

const hierarchyRows = window.appData ? buildHierarchyRows(window.appData) : [];

function textLabel(value) {
  return value.replace(/^"|"@[^@]+$/g, '');
}

function textId(value) {
  return value.replace(/^<|>$/g, '');
}

function renderTree(rows) {
  const tree = new Map();
  const isSearching = Boolean(searchInput && searchInput.value.trim() !== '');
  rows.forEach((row) => {
    if (!tree.has(row.topClass)) tree.set(row.topClass, new Map());
    let nodes = tree.get(row.topClass);
    row.middleClass.split(' / ').forEach((label, index, labels) => {
      if (!nodes.has(label)) nodes.set(label, { children: new Map(), rows: [] });
      const node = nodes.get(label);
      if (index === labels.length - 1) node.rows.push(row);
      nodes = node.children;
    });
  });

  const countRows = (nodes) => [...nodes.values()].reduce(
    (count, node) => count + node.rows.length + countRows(node.children), 0);

  const addTreeButton = (label, handler) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'tree-add-button';
    button.textContent = label;
    button.addEventListener('click', (event) => { event.preventDefault(); event.stopPropagation(); handler(); });
    return button;
  };
  treeElement.replaceChildren(...[...tree].map(([topClass, middle]) => {
    const top = document.createElement('details');
    top.className = 'tree-top-class';
    top.open = true;
    top.setAttribute('role', 'treeitem');
    const topSummary = document.createElement('summary');
    topSummary.append(document.createTextNode(topClass));
    const topCount = document.createElement('span');
    topCount.className = 'count-badge top-count';
    topCount.textContent = countRows(middle);
    topSummary.append(topCount);
    topSummary.append(addTreeButton('＋中間クラス', () => addClassFromTree('middle', topClass)));
    top.append(topSummary);
    const middleList = document.createElement('ul');
    const renderMiddleNodes = (nodes, list) => [...nodes].forEach(([middleClass, node]) => {
      const middleItem = document.createElement('li');
      const middleDetails = document.createElement('details');
      middleDetails.className = 'tree-middle-class';
      middleDetails.open = isSearching;
      const middleSummary = document.createElement('summary');
      middleSummary.append(document.createTextNode(middleClass));
      const middleCount = document.createElement('span');
      middleCount.className = 'count-badge middle-count';
      middleCount.textContent = node.rows.length + countRows(node.children);
      middleSummary.append(middleCount);
      middleSummary.append(addTreeButton('＋対象クラス', () => addClassFromTree('class', middleClass)));
      middleDetails.append(middleSummary);
      const leafList = document.createElement('ul');
      node.rows.forEach((row) => {
        const leaf = document.createElement('li');
        const classInfo = document.createElement('div');
        classInfo.className = 'tree-class';
        const label = document.createElement('span');
        label.className = 'tree-class-label';
        label.textContent = textLabel(row.label);
        const id = document.createElement('span');
        id.className = 'tree-class-id';
        id.textContent = row.id;
        classInfo.append(label, id);
        leaf.append(classInfo);
        leafList.append(leaf);
      });
      renderMiddleNodes(node.children, leafList);
      middleDetails.append(leafList);
      middleItem.append(middleDetails);
      list.append(middleItem);
    });
    renderMiddleNodes(middle, middleList);
    top.append(middleList);
    return top;
  }));
}

function addClassFromTree(type, parentLabel = '') {
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
  if (parentLabel) {
    const parent = classes.find((candidate) => candidate.label === parentLabel);
    if (parent) window.appData.classData.relations.push({ child: item.id, parent: parent.id, relation: 'subClassOf' });
  }
  render(buildHierarchyRows(window.appData));
  if (window.appData) renderClassLists(window.appData);
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

render(hierarchyRows);

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
  });
});

const loadingIndicator = document.getElementById('loading-indicator');
if (loadingIndicator) loadingIndicator.hidden = true;
