// 閲覧画面のクラス一覧・インスタンス一覧の描画と、一覧内の補助表示を担当する。
function renderClassListRows(elementId, items, relatedClassesById = null, instanceCountsByClassId = null,
  onInstanceCountClick = null, onContainedCountClick = null, hierarchyPathsByClassId = null) {
  const target = document.getElementById(elementId);
  if (!target) return;
  if (!items.length) {
    const row = document.createElement('tr');
    const cell = document.createElement('td');
    cell.colSpan = 1 + Number(Boolean(hierarchyPathsByClassId))
      + Number(Boolean(instanceCountsByClassId)) + Number(Boolean(relatedClassesById));
    cell.className = 'list-empty-cell';
    cell.textContent = '該当する項目はありません。';
    row.append(cell);
    target.replaceChildren(row);
    return;
  }
  target.replaceChildren(...items.map((item) => {
    const row = document.createElement('tr');
    const name = document.createElement('td');
    name.className = 'list-entity-cell';
    const label = document.createElement('span');
    label.className = 'list-entity-label';
    label.textContent = item.label || '(ラベルなし)';
    const id = document.createElement('small');
    id.className = 'list-entity-id';
    id.textContent = String(item.id);
    id.append(createCopyIdButton(item.id));
    name.append(label, id);
    row.append(name);
    if (hierarchyPathsByClassId) {
      const path = document.createElement('td');
      path.className = 'class-hierarchy-path';
      const paths = hierarchyPathsByClassId.get(item.id) || [];
      if (paths.length) {
        paths.forEach((hierarchyPath, index) => {
          if (index) path.append(document.createTextNode(' ／ '));
          const pathButton = document.createElement('button');
          pathButton.type = 'button';
          pathButton.className = 'class-hierarchy-path-button';
          pathButton.textContent = hierarchyPath;
          pathButton.title = `${hierarchyPath} をツリーで表示`;
          pathButton.setAttribute('aria-label', `階層パス「${hierarchyPath}」から ${item.label || item.id} をツリーで表示`);
          pathButton.addEventListener('click', () => showClassInTree(item.id));
          path.append(pathButton);
        });
      } else {
        path.textContent = '—';
      }
      row.append(path);
    }
    if (instanceCountsByClassId) {
      const count = document.createElement('td');
      count.className = 'class-instance-count';
      const countButton = document.createElement('button');
      countButton.type = 'button';
      countButton.className = 'contained-class-count-button class-instance-count-button';
      countButton.textContent = `${instanceCountsByClassId.get(item.id)?.size || 0}件`;
      const scope = item.id.includes('/c_') ? '' : '配下を含む ';
      countButton.setAttribute('aria-label', `${item.label || item.id} の${scope}インスタンス一覧を表示`);
      countButton.addEventListener('click', () => onInstanceCountClick?.(item));
      count.append(countButton);
      row.append(count);
    }
    if (relatedClassesById) {
      const relatedCell = document.createElement('td');
      const relationship = relatedClassesById.get(item.id) || [];
      const relatedClasses = Array.isArray(relationship) ? relationship : (relationship.parents || []);
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
      if (!Array.isArray(relationship) && Array.isArray(relationship.children)) {
        const countButton = document.createElement('button');
        countButton.type = 'button';
        countButton.className = 'contained-class-count-button';
        countButton.textContent = `対象クラス ${relationship.children.length}件`;
        countButton.setAttribute('aria-label', `${item.label} に含まれるクラス ${relationship.children.length}件を表示`);
        countButton.addEventListener('click', () => onContainedCountClick
          ? onContainedCountClick(item, relationship.children)
          : showContainedClasses(item, relationship.children));
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
  const instanceClassFilter = document.getElementById('instance-class-filter');
  const textFilter = document.getElementById('class-text-filter');
  const sortSelect = document.getElementById('list-sort');
  const downloadButton = document.getElementById('download-list-tsv');
  if (!topFilter || !middleFilter || !instanceClassFilter || !textFilter || !sortSelect || !downloadButton) return;
  let filteredTargets = targets;
  let filteredTops = tops;
  let filteredMiddles = middles;
  let filteredInstances = instances;
  let instanceCurrentPage = 1;
  const instancePageSize = 100;
  const classPageSize = 100;
  const classCurrentPages = { top: 1, middle: 1, target: 1 };

  topFilter.replaceChildren(new Option('すべて', ''));
  middleFilter.replaceChildren(new Option('すべて', ''));
  instanceClassFilter.replaceChildren(new Option('すべて', ''));
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
  const hierarchyPathsByClassId = new Map();
  const hierarchyPathsFor = (id, visited = new Set()) => {
    if (visited.has(id)) return [classById.get(id)?.label || id];
    const label = classById.get(id)?.label || id;
    const parents = [...new Set(parentMap.get(id) || [])].filter((parentId) => classById.has(parentId));
    if (!parents.length) return [label];
    const nextVisited = new Set(visited);
    nextVisited.add(id);
    return parents.flatMap((parentId) => hierarchyPathsFor(parentId, nextVisited).map((path) => `${path} › ${label}`));
  };
  allClasses.forEach((classInfo) => {
    hierarchyPathsByClassId.set(classInfo.id, [...new Set(hierarchyPathsFor(classInfo.id))]);
  });
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
  const relatedTops = new Map(tops.map((item) => [item.id, {
    parents: [],
    children: containedTargets(item.id),
  }]));
  const renderInstancePage = () => {
    const pageCount = Math.max(1, Math.ceil(filteredInstances.length / instancePageSize));
    instanceCurrentPage = Math.min(instanceCurrentPage, pageCount);
    const start = (instanceCurrentPage - 1) * instancePageSize;
    const pageItems = applySort(filteredInstances, 'instance-tab').slice(start, start + instancePageSize);
    const rows = pageItems.map((instance) => {
      const row = document.createElement('tr');
      const name = document.createElement('td');
      const classes = document.createElement('td');
      name.className = 'list-entity-cell';
      const label = document.createElement('span');
      label.className = 'list-entity-label';
      label.textContent = instance.label || '(ラベルなし)';
      const id = document.createElement('small');
      id.className = 'list-entity-id';
      id.textContent = String(instance.id);
      id.append(createCopyIdButton(instance.id));
      name.append(label, id);
      const relatedClasses = [...(classesByInstanceId.get(instance.id)?.values() || [])];
      if (relatedClasses.length) {
        relatedClasses.forEach((classInfo) => {
          const link = document.createElement('button');
          link.type = 'button';
          link.className = 'related-class-link';
          link.textContent = hierarchyPathsByClassId.get(classInfo.id)?.join(' ／ ') || classInfo.label || classInfo.id;
          link.setAttribute('aria-label', `${classInfo.label || classInfo.id} の階層ツリーを表示`);
          link.addEventListener('click', () => showClassInTree(classInfo.id));
          classes.append(link);
        });
      } else {
        classes.textContent = '—';
      }
      row.append(name, classes);
      return row;
    });
    if (!rows.length) {
      const row = document.createElement('tr');
      const cell = document.createElement('td');
      cell.colSpan = 2;
      cell.className = 'list-empty-cell';
      cell.textContent = '該当する項目はありません。';
      row.append(cell);
      rows.push(row);
    }
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
  addOptions(instanceClassFilter, allClasses);
  const sortChoices = {
    'top-class-tab': [['label-asc', 'ラベル順（あ→ん）'], ['label-desc', 'ラベル順（ん→あ）'], ['count-desc', '件数が多い順'], ['count-asc', '件数が少ない順']],
    'middle-class-tab': [['label-asc', 'ラベル順（あ→ん）'], ['label-desc', 'ラベル順（ん→あ）'], ['count-desc', '件数が多い順'], ['count-asc', '件数が少ない順']],
    'target-class-tab': [['label-asc', 'ラベル順（あ→ん）'], ['label-desc', 'ラベル順（ん→あ）'], ['count-desc', '件数が多い順'], ['count-asc', '件数が少ない順']],
    'instance-tab': [['label-asc', 'ラベル順（あ→ん）'], ['label-desc', 'ラベル順（ん→あ）']]
  };
  const activeListTabId = () => document.querySelector('.list-tab.is-active')?.id || 'target-class-tab';
  const applySort = (items, tabId = activeListTabId()) => {
    const sort = sortSelect.value || 'label-asc';
    const sorted = [...items];
    if (tabId !== 'instance-tab' && sort.startsWith('count-')) {
      const direction = sort === 'count-desc' ? -1 : 1;
      return sorted.sort((a, b) => direction * ((instanceIdsByClassId.get(a.id)?.size || 0) - (instanceIdsByClassId.get(b.id)?.size || 0))
        || (a.label || a.id).localeCompare(b.label || b.id, 'ja'));
    }
    const direction = sort === 'label-desc' ? -1 : 1;
    return sorted.sort((a, b) => direction * (a.label || a.id).localeCompare(b.label || b.id, 'ja') || a.id.localeCompare(b.id));
  };
  refreshListSortOptions = () => {
    const activeTabId = activeListTabId();
    const choices = sortChoices[activeTabId] || sortChoices['target-class-tab'];
    const previous = sortSelect.value;
    sortSelect.replaceChildren(...choices.map(([value, label]) => new Option(label, value)));
    sortSelect.value = choices.some(([value]) => value === previous) ? previous : 'label-asc';
    const slotId = ({
      'top-class-tab': 'top-class-sort-slot',
      'middle-class-tab': 'middle-class-sort-slot',
      'target-class-tab': 'target-class-sort-slot',
      'instance-tab': 'instance-sort-slot'
    })[activeTabId];
    document.getElementById(slotId)?.append(document.getElementById('list-sort-control'));
  };
  refreshListSortOptions();
  refreshBrowseListFilterSummary = () => {
    const activeTab = activeListTabId();
    const filters = [];
    const keyword = textFilter.value.trim();
    if (keyword) filters.push(`検索: ${keyword}`);
    if (['middle-class-tab', 'target-class-tab'].includes(activeTab) && topFilter.value) {
      filters.push(`上位クラス: ${classById.get(topFilter.value)?.label || topFilter.value}`);
    }
    if (activeTab === 'target-class-tab' && middleFilter.value) {
      filters.push(`中間クラス: ${classById.get(middleFilter.value)?.label || middleFilter.value}`);
    }
    if (activeTab === 'instance-tab' && instanceClassFilter.value) {
      filters.push(`クラス（配下を含む）: ${classById.get(instanceClassFilter.value)?.label || instanceClassFilter.value}`);
    }
    document.getElementById('list-active-filter-summary').textContent = filters.length
      ? `絞り込み中：${filters.join(' ／ ')}` : '絞り込みなし';
  };
  refreshBrowseListFilterSummary();
  const openInstancesForClass = (classInfo) => {
    textFilter.value = '';
    instanceClassFilter.value = classInfo.id;
    document.getElementById('list-tab')?.click();
    document.getElementById('instance-tab')?.click();
  };
  const openTargetClassesFor = (classInfo) => {
    textFilter.value = '';
    topFilter.value = classInfo.id.includes('/t_') ? classInfo.id : '';
    middleFilter.value = classInfo.id.includes('/m_') ? classInfo.id : '';
    document.getElementById('list-tab')?.click();
    document.getElementById('target-class-tab')?.click();
  };
  const renderClassPage = (kind, items) => {
    const config = {
      top: { id: 'top-class-tab', rows: 'top-class-rows', info: 'top-class-page-info', prev: 'top-class-page-prev', next: 'top-class-page-next', relations: relatedTops, onContained: openTargetClassesFor },
      middle: { id: 'middle-class-tab', rows: 'middle-class-rows', info: 'middle-class-page-info', prev: 'middle-class-page-prev', next: 'middle-class-page-next', relations: relatedMiddles, onContained: openTargetClassesFor },
      target: { id: 'target-class-tab', rows: 'target-class-rows', info: 'target-class-page-info', prev: 'target-class-page-prev', next: 'target-class-page-next', relations: relatedTargets, paths: hierarchyPathsByClassId }
    }[kind];
    const pageCount = Math.max(1, Math.ceil(items.length / classPageSize));
    classCurrentPages[kind] = Math.min(classCurrentPages[kind], pageCount);
    const currentPage = classCurrentPages[kind];
    const start = (currentPage - 1) * classPageSize;
    const sortItems = applySort(items, config.id);
    const pageItems = sortItems.slice(start, start + classPageSize);
    renderClassListRows(config.rows, pageItems, config.relations, instanceIdsByClassId,
      openInstancesForClass, config.onContained || null, config.paths || null);
    const first = items.length ? start + 1 : 0;
    const last = Math.min(start + classPageSize, items.length);
    document.getElementById(config.info).textContent = `${first}–${last}件 / ${items.length.toLocaleString('ja-JP')}件（${currentPage} / ${pageCount}ページ）`;
    document.getElementById(config.prev).disabled = currentPage <= 1;
    document.getElementById(config.next).disabled = currentPage >= pageCount;
  };
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
    const targetResultCount = document.getElementById('target-class-result-count');
    if (targetResultCount) targetResultCount.textContent = `（${filtered.length.toLocaleString('ja-JP')}件）`;
    classCurrentPages.target = 1;
    renderClassPage('target', filtered);
  };
  const updateOtherLists = () => {
    const text = textFilter.value.trim().toLocaleLowerCase();
    const filterByText = (items) => !text ? items : items.filter((item) =>
      `${item.id} ${item.label}`.toLocaleLowerCase().includes(text));
    const topId = topFilter.value;
    filteredTops = filterByText(tops);
    filteredMiddles = filterByText(middles).filter((item) =>
      !topId || ancestors(item.id).has(topId));
    document.getElementById('top-class-result-count').textContent = `（${filteredTops.length.toLocaleString('ja-JP')}件）`;
    document.getElementById('middle-class-result-count').textContent = `（${filteredMiddles.length.toLocaleString('ja-JP')}件）`;
    classCurrentPages.top = 1;
    classCurrentPages.middle = 1;
    instanceCurrentPage = 1;
    renderClassPage('top', filteredTops);
    renderClassPage('middle', filteredMiddles);
    updateInstances();
  };
  const updateInstances = () => {
    const text = textFilter.value.trim().toLocaleLowerCase();
    const classId = instanceClassFilter.value;
    filteredInstances = instances.filter((item) =>
      (!text || `${item.id} ${item.label}`.toLocaleLowerCase().includes(text))
      && (!classId || instanceIdsByClassId.get(classId)?.has(item.id)));
    instanceCurrentPage = 1;
    document.getElementById('instance-result-count').textContent = `（${filteredInstances.length.toLocaleString('ja-JP')}件）`;
    if (document.getElementById('instance-tab')?.classList.contains('is-active')) renderInstancePage();
  };
  renderInstanceList = updateInstances;
  downloadButton.onclick = () => {
    const activeListId = document.querySelector('.list-tab.is-active')?.id;
    const items = applySort(activeListId === 'middle-class-tab' ? filteredMiddles
      : activeListId === 'top-class-tab' ? filteredTops
        : activeListId === 'instance-tab' ? filteredInstances
          : filteredTargets, activeListId);
    const filename = activeListId === 'middle-class-tab' ? 'middle-class-list.tsv'
      : activeListId === 'top-class-tab' ? 'top-class-list.tsv'
        : activeListId === 'instance-tab' ? 'instance-list.tsv'
          : 'class-list.tsv';
    const escapeTsv = (value) => String(value ?? '').replace(/\t/g, ' ').replace(/\r?\n/g, ' ');
    const isInstanceList = activeListId === 'instance-tab';
    const isRelatedClassList = activeListId === 'middle-class-tab' || activeListId === 'target-class-tab';
    const isClassList = ['middle-class-tab', 'target-class-tab', 'top-class-tab'].includes(activeListId);
    const headers = ['ID', 'ラベル'];
    if (activeListId === 'target-class-tab') headers.push('階層パス');
    if (isClassList) headers.push(activeListId === 'target-class-tab' ? 'インスタンス数' : '配下のインスタンス数');
    if (activeListId === 'top-class-tab') headers.push('対象クラス数');
    if (isInstanceList) headers.push('所属クラス（階層）');
    else if (isRelatedClassList) headers.push(activeListId === 'middle-class-tab' ? '親クラス・対象クラス数' : '親クラス');
    const lines = [headers.join('\t'), ...items.map((item) => {
      const base = `${escapeTsv(item.id)}\t${escapeTsv(item.label)}${activeListId === 'target-class-tab'
        ? `\t${escapeTsv((hierarchyPathsByClassId.get(item.id) || []).join(' ／ '))}` : ''}`;
      const instanceCount = instanceIdsByClassId.get(item.id)?.size || 0;
      const classBase = `${base}\t${instanceCount}件`;
      if (activeListId === 'top-class-tab') {
        return `${classBase}\t${relatedTops.get(item.id)?.children.length || 0}件`;
      }
      if (isRelatedClassList) {
        const relatedMap = activeListId === 'middle-class-tab' ? relatedMiddles : relatedTargets;
        const relationship = relatedMap.get(item.id) || [];
        const relatedClasses = activeListId === 'middle-class-tab'
          ? `${relationship.parents.map((classInfo) => classInfo.label || classInfo.id).join(' / ')}${relationship.parents.length ? ' / ' : ''}対象クラス ${relationship.children.length}件`
          : relationship.map((classInfo) => classInfo.label || classInfo.id).join(' / ');
        return `${classBase}\t${escapeTsv(relatedClasses)}`;
      }
      if (!isInstanceList) return classBase;
      const relatedClasses = [...(classesByInstanceId.get(item.id)?.values() || [])]
        .map((classInfo) => hierarchyPathsByClassId.get(classInfo.id)?.join(' ／ ') || classInfo.label || classInfo.id).join(' / ');
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
    refreshBrowseListFilterSummary?.();
  };
  middleFilter.oninput = () => {
    updateTargets();
    refreshBrowseListFilterSummary?.();
  };
  instanceClassFilter.oninput = () => {
    updateInstances();
    refreshBrowseListFilterSummary?.();
  };
  textFilter.oninput = () => {
    updateTargets();
    updateOtherLists();
    refreshBrowseListFilterSummary?.();
  };
  sortSelect.onchange = () => {
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
  const classPageItems = { top: () => filteredTops, middle: () => filteredMiddles, target: () => filteredTargets };
  Object.entries({ top: 'top-class', middle: 'middle-class', target: 'target-class' }).forEach(([kind, prefix]) => {
    document.getElementById(`${prefix}-page-prev`).onclick = () => {
      if (classCurrentPages[kind] <= 1) return;
      classCurrentPages[kind] -= 1;
      renderClassPage(kind, classPageItems[kind]());
    };
    document.getElementById(`${prefix}-page-next`).onclick = () => {
      if (classCurrentPages[kind] * classPageSize >= classPageItems[kind]().length) return;
      classCurrentPages[kind] += 1;
      renderClassPage(kind, classPageItems[kind]());
    };
  });
  document.getElementById('clear-list-filters').onclick = () => {
    topFilter.value = '';
    middleFilter.value = '';
    instanceClassFilter.value = '';
    textFilter.value = '';
    updateTargets();
    updateOtherLists();
    refreshBrowseListFilterSummary?.();
  };
}

