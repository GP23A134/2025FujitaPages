const searchForm = document.getElementById('search-form');
const searchInput = document.getElementById('search');
const clearSearchButton = document.getElementById('clear-search');
const rowsElement = document.getElementById('rows');
const treeElement = document.getElementById('tree');
const summaryElement = document.getElementById('summary');

function textLabel(value) {
  return value.replace(/^"|"@[^@]+$/g, '');
}

function textId(value) {
  return value.replace(/^<|>$/g, '');
}

function renderTree(rows) {
  const tree = new Map();
  const isSearching = searchInput.value.trim() !== '';
  rows.forEach((row) => {
    if (!tree.has(row.topClass)) tree.set(row.topClass, new Map());
    const middle = tree.get(row.topClass);
    if (!middle.has(row.middleClass)) middle.set(row.middleClass, []);
    middle.get(row.middleClass).push(row);
  });

  treeElement.replaceChildren(...[...tree].map(([topClass, middle]) => {
    const top = document.createElement('details');
    top.className = 'tree-top-class';
    top.open = true;
    top.setAttribute('role', 'treeitem');
    const topSummary = document.createElement('summary');
    topSummary.append(document.createTextNode(topClass));
    const topId = document.createElement('span');
    topId.className = 'tree-level-id';
    topId.textContent = textId(rows.find((row) => row.topClass === topClass).topClassId);
    topSummary.append(topId);
    const topCount = document.createElement('span');
    topCount.className = 'count-badge top-count';
    topCount.textContent = [...middle.values()].reduce((n, items) => n + items.length, 0);
    topSummary.append(topCount);
    top.append(topSummary);
    const middleList = document.createElement('ul');
    [...middle].forEach(([middleClass, items]) => {
      const middleItem = document.createElement('li');
      const middleDetails = document.createElement('details');
      middleDetails.className = 'tree-middle-class';
      middleDetails.open = isSearching;
      const middleSummary = document.createElement('summary');
      middleSummary.append(document.createTextNode(middleClass));
      const middleId = document.createElement('span');
      middleId.className = 'tree-level-id';
      middleId.textContent = textId(items[0].middleClassId);
      middleSummary.append(middleId);
      const middleCount = document.createElement('span');
      middleCount.className = 'count-badge middle-count';
      middleCount.textContent = items.length;
      middleSummary.append(middleCount);
      middleDetails.append(middleSummary);
      const leafList = document.createElement('ul');
      items.forEach((row) => {
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
      middleDetails.append(leafList);
      middleItem.append(middleDetails);
      middleList.append(middleItem);
    });
    top.append(middleList);
    return top;
  }));
}

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
  renderSummary(rows);
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
  const query = searchInput.value.trim().toLocaleLowerCase();
  render(hierarchyRows.filter((row) =>
    Object.values(row).some((value) => value.toLocaleLowerCase().includes(query))));
}

searchForm.addEventListener('submit', (event) => {
  event.preventDefault();
  applySearch();
});

clearSearchButton.addEventListener('click', () => {
  searchInput.value = '';
  render(hierarchyRows);
  searchInput.focus();
});

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
