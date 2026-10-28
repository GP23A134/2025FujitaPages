// 閲覧画面の初回描画と、タブ・検索・絞り込みの画面イベントをまとめる。前段の閲覧モジュール読み込み後に実行する。
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
  renderAggregation(data);
}

document.getElementById('aggregation-top-filter')?.addEventListener('change', () => {
  if (window.appData) renderAggregation(window.appData);
});

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
    document.querySelectorAll('.instance-class-list-filter').forEach((filter) => {
      filter.hidden = tab.id !== 'instance-tab';
    });
    refreshListSortOptions?.();
    refreshBrowseListFilterSummary?.();
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
const browseTreeFilter = document.querySelector('#tree-panel .tree-filter');
const browseTreeFilterOpenButton = document.getElementById('toggle-browse-tree-filter-open');
document.getElementById('close-browse-tree-filter')?.addEventListener('click', (event) => {
  event.preventDefault();
  event.stopPropagation();
  browseTreeFilter.hidden = true;
  browseTreeFilterOpenButton.hidden = false;
  renderTree();
});
browseTreeFilterOpenButton?.addEventListener('click', () => {
  browseTreeFilter.hidden = false;
  browseTreeFilterOpenButton.hidden = true;
  renderTree();
});
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
