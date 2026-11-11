// 閲覧画面のクラス一覧・インスタンス一覧の描画と、一覧内の補助表示を担当する。
function groupItemsByLabel(items) {
  const groups = new Map();
  items.forEach((item) => {
    const label = String(item.label ?? '');
    const key = label ? `label:${label}` : `id:${item.id}`;
    if (!groups.has(key)) groups.set(key, { id: item.id, label, ids: [], members: [] });
    const group = groups.get(key);
    if (!group.ids.includes(item.id)) group.ids.push(item.id);
    group.members.push(item);
  });
  return [...groups.values()];
}

function getUniqueMemberCount(countsById, item) {
  const ids = new Set();
  (item.ids || [item.id]).forEach((id) => (countsById.get(id) || []).forEach((value) => ids.add(value)));
  return ids.size;
}

function appendCountActions(cell, total, direct, onTotal, onDirect) {
  if (Number(total) === 0) {
    cell.textContent = '0件';
    return;
  }
  [['全件', total, onTotal], ['直下', direct, onDirect]].forEach(([label, value, handler]) => {
    const button = document.createElement('button');
    button.type = 'button'; button.className = 'class-count-link';
    button.textContent = `${label} ${Number(value).toLocaleString('ja-JP')}件`;
    button.setAttribute('aria-label', `${label} ${value}件の一覧を表示`);
    button.addEventListener('click', handler);
    cell.append(button);
  });
}

function appendSingleCountAction(cell, total, handler) {
  const button = document.createElement('button');
  button.type = 'button'; button.className = 'class-count-link';
  button.textContent = `${Number(total).toLocaleString('ja-JP')}件`;
  button.setAttribute('aria-label', `一覧を表示 ${total}件`);
  button.addEventListener('click', handler);
  cell.append(button);
}

function appendClassLinks(cell, classes, emptyLabel) {
  const groups = groupItemsByLabel([...new Map(classes.map((item) => [item.id, item])).values()]);
  if (!groups.length) { cell.textContent = emptyLabel; return; }
  groups.forEach((group, index) => {
    if (index) cell.append(document.createTextNode(' ／ '));
    const link = document.createElement('button');
    link.type = 'button'; link.className = 'related-class-link';
    link.textContent = group.label || '(ラベルなし)';
    link.title = `ID: ${group.ids.join(' ／ ')}`;
    link.addEventListener('click', () => showClassInTree(group.ids[0]));
    cell.append(link);
  });
}

function appendEntityIds(container, ids) {
  container.className = 'list-entity-id';
  const representative = document.createElement('span');
  representative.className = 'list-id-representative';
  representative.textContent = String(ids[0] ?? '');
  const representativeCopy = createCopyIdButton(ids[0]);
  if (ids.length < 2) {
    const row = document.createElement('div');
    row.className = 'list-id-single-row';
    row.append(representative, representativeCopy);
    container.append(row);
    return;
  }

  const details = document.createElement('details');
  details.className = 'list-id-details';
  const summary = document.createElement('summary');
  summary.append(representative, representativeCopy);
  const expandLabel = document.createElement('span');
  expandLabel.className = 'list-id-expand-label';
  expandLabel.textContent = `ほか${ids.length - 1}件`;
  summary.append(expandLabel);
  const list = document.createElement('div');
  list.className = 'list-id-detail-list';
  ids.slice(1).forEach((id) => {
    const entry = document.createElement('div');
    entry.className = 'list-id-detail-entry';
    const value = document.createElement('span');
    value.textContent = String(id);
    entry.append(value, createCopyIdButton(id));
    list.append(entry);
  });
  details.append(summary, list);
  container.append(details);
}

function renderClassListRows(elementId, items, options = {}) {
  const target = document.getElementById(elementId);
  if (!target) return;
  const { parentsById = null, middleCountsById = null, targetCountsById = null,
    topClassesById = null, middleClassesById = null, childMiddleClassesById = null,
    directMiddleCountsById = null, directTargetCountsById = null, instanceCountsByClassId = null,
    onChildMiddleClick = null, onMiddleTotalClick = null, onMiddleDirectClick = null,
    onTargetTotalClick = null, onTargetDirectClick = null, onInstanceClick = null } = options;
  if (!items.length) {
    const row = document.createElement('tr');
    const cell = document.createElement('td');
    cell.colSpan = 1 + Number(Boolean(topClassesById)) + Number(Boolean(middleClassesById))
      + Number(Boolean(childMiddleClassesById))
      + Number(Boolean(parentsById)) + Number(Boolean(middleCountsById))
      + Number(Boolean(targetCountsById)) + Number(Boolean(instanceCountsByClassId));
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
    appendEntityIds(id, item.ids || [item.id]);
    name.append(label, id);
    row.append(name);
    if (topClassesById) {
      const topCell = document.createElement('td');
      const topClasses = [...new Map((item.ids || [item.id]).flatMap((id) => topClassesById.get(id) || [])
        .map((topClass) => [topClass.id, topClass])).values()];
      if (topClasses.length) {
        groupItemsByLabel(topClasses).forEach((topClass, index) => {
          if (index) topCell.append(document.createTextNode(' ／ '));
          const link = document.createElement('button');
          link.type = 'button'; link.className = 'related-class-link';
          link.textContent = topClass.label || '(ラベルなし)';
          link.title = `ID: ${topClass.ids.join(' ／ ')}`;
          link.addEventListener('click', () => showClassInTree(topClass.ids[0]));
          topCell.append(link);
        });
      } else topCell.textContent = '上位クラスなし';
      row.append(topCell);
    }
    if (middleClassesById) {
      const middleCell = document.createElement('td');
      const middleClasses = [...new Map((item.ids || [item.id]).flatMap((id) => middleClassesById.get(id) || [])
        .map((middleClass) => [middleClass.id, middleClass])).values()];
      if (middleClasses.length) {
        groupItemsByLabel(middleClasses).forEach((middleClass, index) => {
          if (index) middleCell.append(document.createTextNode(' ／ '));
          const link = document.createElement('button');
          link.type = 'button'; link.className = 'related-class-link';
          link.textContent = middleClass.label || '(ラベルなし)';
          link.title = `ID: ${middleClass.ids.join(' ／ ')}`;
          link.addEventListener('click', () => showClassInTree(middleClass.ids[0]));
          middleCell.append(link);
        });
      } else middleCell.textContent = '中間クラスなし';
      row.append(middleCell);
    }
    if (parentsById) {
      const parentCell = document.createElement('td');
      const parents = [...new Map((item.ids || [item.id]).flatMap((id) => parentsById.get(id) || [])
        .map((parent) => [parent.id, parent])).values()];
      if (parents.length) {
        groupItemsByLabel(parents).forEach((parent, index) => {
          if (index) parentCell.append(document.createTextNode(' ／ '));
          const link = document.createElement('button');
          link.type = 'button';
          link.className = 'related-class-link';
          link.textContent = parent.label || '(ラベルなし)';
          link.title = `ID: ${parent.ids.join(' ／ ')}`;
          link.setAttribute('aria-label', `${parent.label || 'ラベルなし'} の階層ツリーを表示（${parent.ids.join('、')}）`);
          link.addEventListener('click', () => showClassInTree(parent.ids[0]));
          parentCell.append(link);
        });
      } else {
        parentCell.textContent = '親なし';
      }
      row.append(parentCell);
    }
    if (childMiddleClassesById) {
      const childMiddleCell = document.createElement('td');
      const childMiddleClasses = [...new Map((item.ids || [item.id]).flatMap((id) => childMiddleClassesById.get(id) || [])
        .map((middleClass) => [middleClass.id, middleClass])).values()];
      if (!childMiddleClasses.length) {
        childMiddleCell.textContent = '0件';
      } else if (onChildMiddleClick) {
        const button = document.createElement('button');
        button.type = 'button'; button.className = 'class-count-link';
        button.textContent = `${childMiddleClasses.length.toLocaleString('ja-JP')}件`;
        button.setAttribute('aria-label', `下位中間クラス一覧を表示 ${childMiddleClasses.length}件`);
        button.addEventListener('click', () => onChildMiddleClick(item));
        childMiddleCell.append(button);
      } else childMiddleCell.textContent = `${childMiddleClasses.length.toLocaleString('ja-JP')}件`;
      row.append(childMiddleCell);
    }
    if (middleCountsById) {
      const count = document.createElement('td');
      count.className = 'class-instance-count';
      const total = getUniqueMemberCount(middleCountsById, item);
      const direct = directMiddleCountsById ? getUniqueMemberCount(directMiddleCountsById, item) : total;
      if (onMiddleTotalClick && onMiddleDirectClick) appendCountActions(count, total, direct,
        () => onMiddleTotalClick(item), () => onMiddleDirectClick(item));
      else count.textContent = `${total.toLocaleString('ja-JP')}件（直下${direct.toLocaleString('ja-JP')}件）`;
      row.append(count);
    }
    if (targetCountsById) {
      const count = document.createElement('td');
      count.className = 'class-instance-count';
      const total = getUniqueMemberCount(targetCountsById, item);
      const direct = directTargetCountsById ? getUniqueMemberCount(directTargetCountsById, item) : total;
      const hasChildMiddleClasses = childMiddleClassesById
        && (item.ids || [item.id]).some((id) => (childMiddleClassesById.get(id) || []).length > 0);
      if (childMiddleClassesById && !hasChildMiddleClasses) {
        if (!total) count.textContent = '0件';
        else if (onTargetTotalClick) appendSingleCountAction(count, total, () => onTargetTotalClick(item));
        else count.textContent = `${total.toLocaleString('ja-JP')}件`;
      } else if (onTargetTotalClick && onTargetDirectClick) appendCountActions(count, total, direct,
        () => onTargetTotalClick(item), () => onTargetDirectClick(item));
      else if (!total) count.textContent = '0件';
      else count.textContent = `全件 ${total.toLocaleString('ja-JP')}件 ／ 直下 ${direct.toLocaleString('ja-JP')}件`;
      row.append(count);
    }
    if (instanceCountsByClassId) {
      const count = document.createElement('td');
      count.className = 'class-instance-count';
      if (onInstanceClick) {
        const total = getUniqueMemberCount(instanceCountsByClassId, item);
        appendSingleCountAction(count, total, () => onInstanceClick(item));
      } else count.textContent = `${getUniqueMemberCount(instanceCountsByClassId, item)}件`;
      row.append(count);
    }
    return row;
  }));
}

function createCopyIdButton(id) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'copy-id-button';
  button.textContent = 'コピー';
  button.setAttribute('aria-label', `ID ${id} をコピー`);
  button.addEventListener('click', (event) => {
    event.preventDefault();
    event.stopPropagation();
    copyIdentifier(id, button);
  });
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
  const allClasses = [...new Map((data.classData?.classes || []).map((item) => [item.id, item])).values()];
  const classTypeById = new Map(allClasses.map((item) => [item.id, item.type || (/\/(?:new-)?t[_-]/.test(item.id) ? 'top' : /\/(?:new-)?m[_-]/.test(item.id) ? 'middle' : 'class')]));
  const classType = (id) => classTypeById.get(id) || 'class';
  const topClasses = [...new Map((data.topClassList?.classes || allClasses.filter((item) => classType(item.id) === 'top'))
    .map((item) => [item.id, item])).values()];
  const middleClasses = [...new Map((data.middleClassList?.classes || allClasses.filter((item) => classType(item.id) === 'middle'))
    .map((item) => [item.id, item])).values()];
  const targetClasses = allClasses.filter((item) => classType(item.id) === 'class');
  const allInstances = [...new Map((data.instanceData?.instances || []).map((item) => [item.id, item])).values()];
  const tops = groupItemsByLabel(topClasses);
  const middles = groupItemsByLabel(middleClasses);
  const targets = groupItemsByLabel(targetClasses);
  const instances = groupItemsByLabel(allInstances);
  const classById = new Map(allClasses.map((item) => [item.id, item]));
  const classesByInstanceId = new Map();
  (data.instanceClassData?.relations || []).forEach((relation) => {
    const classInfo = classById.get(relation.class);
    if (!classInfo) return;
    if (!classesByInstanceId.has(relation.instance)) classesByInstanceId.set(relation.instance, new Map());
    classesByInstanceId.get(relation.instance).set(classInfo.id, classInfo);
  });
  const searchElementFilter = document.getElementById('list-search-element-filter');
  const textFilter = document.getElementById('class-text-filter');
  const pageSizeSelect = document.getElementById('list-page-size');
  const pageTools = document.getElementById('list-page-tools');
  const downloadButton = document.getElementById('download-list-tsv');
  if (!searchElementFilter || !textFilter || !pageSizeSelect || !pageTools || !downloadButton) return;
  let filteredTargets = targets;
  let filteredTops = tops;
  let filteredMiddles = middles;
  let filteredInstances = instances;
  let instanceCurrentPage = 1;
  let pageSize = Number(pageSizeSelect.value) || 100;
  const classCurrentPages = { top: 1, middle: 1, target: 1 };

  const parentMap = new Map();
  const childrenMap = new Map();
  (data.classData?.relations || []).forEach((relation) => {
    if (!classById.has(relation.child) || !classById.has(relation.parent)) return;
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
  const descendants = (id) => {
    const result = new Set();
    const pending = [...(childrenMap.get(id) || [])];
    while (pending.length) {
      const current = pending.pop();
      if (result.has(current)) continue;
      result.add(current);
      pending.push(...(childrenMap.get(current) || []));
    }
    return result;
  };
  const parentClassesById = new Map(allClasses.map((item) => [item.id,
    [...new Set(parentMap.get(item.id) || [])].map((id) => classById.get(id)).filter(Boolean)]));
  const topClassesById = new Map(allClasses.map((item) => [item.id,
    [...ancestors(item.id)].filter((id) => classType(id) === 'top').map((id) => classById.get(id)).filter(Boolean)]));
  const middleClassesById = new Map(allClasses.map((item) => [item.id,
    [...ancestors(item.id)].filter((id) => classType(id) === 'middle').map((id) => classById.get(id)).filter(Boolean)]));
  const childMiddleClassesById = new Map(allClasses.map((item) => [item.id,
    [...new Set(childrenMap.get(item.id) || [])].filter((id) => classType(id) === 'middle').map((id) => classById.get(id)).filter(Boolean)]));
  const parentClassesForGroup = (item) => [...new Map((item.ids || [item.id])
    .flatMap((id) => parentClassesById.get(id) || []).map((parent) => [parent.id, parent])).values()];
  const parentLabelForGroup = (item) => {
    const parents = parentClassesForGroup(item);
    const labels = groupItemsByLabel(parents).map((parent) => parent.label || '(ラベルなし)')
      .sort((a, b) => a.localeCompare(b, 'ja'));
    return labels.join(' ／ ') || '親なし';
  };
  const allClassGroups = groupItemsByLabel(allClasses);
  const classGroupIdsByOptionId = new Map(allClassGroups.map((group) => [group.id, group.ids]));
  const knownInstanceIds = new Set(allInstances.map((instance) => instance.id));
  const instanceIdsByClassId = new Map();
  (data.instanceClassData?.relations || []).forEach((relation) => {
    if (!knownInstanceIds.has(relation.instance)) return;
    new Set([relation.class, ...ancestors(relation.class)]).forEach((classId) => {
      if (!classById.has(classId)) return;
      if (!instanceIdsByClassId.has(classId)) instanceIdsByClassId.set(classId, new Set());
      instanceIdsByClassId.get(classId).add(relation.instance);
    });
  });
  const middleIdsByClassId = new Map();
  const targetIdsByClassId = new Map();
  const directMiddleIdsByClassId = new Map();
  const directTargetIdsByClassId = new Map();
  allClasses.forEach((item) => {
    const containedIds = descendants(item.id);
    middleIdsByClassId.set(item.id, new Set([...containedIds].filter((id) => classType(id) === 'middle')));
    targetIdsByClassId.set(item.id, new Set([...containedIds].filter((id) => classType(id) === 'class')));
    const directIds = childrenMap.get(item.id) || [];
    directMiddleIdsByClassId.set(item.id, new Set(directIds.filter((id) => classType(id) === 'middle')));
    directTargetIdsByClassId.set(item.id, new Set(directIds.filter((id) => classType(id) === 'class')));
  });
  const renderInstancePage = () => {
    const pageCount = Math.max(1, Math.ceil(filteredInstances.length / pageSize));
    instanceCurrentPage = Math.min(instanceCurrentPage, pageCount);
    const start = (instanceCurrentPage - 1) * pageSize;
    const pageItems = applySort(filteredInstances, 'instance-tab').slice(start, start + pageSize);
    const rows = pageItems.map((instance) => {
      const row = document.createElement('tr');
      const name = document.createElement('td');
      const topClassesCell = document.createElement('td');
      const middleClassesCell = document.createElement('td');
      const classes = document.createElement('td');
      name.className = 'list-entity-cell';
      const label = document.createElement('span');
      label.className = 'list-entity-label';
      label.textContent = instance.label || '(ラベルなし)';
      const id = document.createElement('small');
      appendEntityIds(id, instance.ids || [instance.id]);
      name.append(label, id);
      const relatedClasses = [...new Map((instance.ids || [instance.id])
        .flatMap((instanceId) => [...(classesByInstanceId.get(instanceId)?.values() || [])])
        .map((classInfo) => [classInfo.id, classInfo])).values()];
      const topClasses = new Map();
      const middleClasses = new Map();
      relatedClasses.forEach((classInfo) => {
        const lineage = new Set([classInfo.id, ...ancestors(classInfo.id)]);
        lineage.forEach((classId) => {
          const ancestorClass = classById.get(classId);
          if (!ancestorClass) return;
          if (classType(classId) === 'top') topClasses.set(classId, ancestorClass);
          if (classType(classId) === 'middle') middleClasses.set(classId, ancestorClass);
        });
      });
      appendClassLinks(topClassesCell, [...topClasses.values()], '上位クラスなし');
      appendClassLinks(middleClassesCell, [...middleClasses.values()], '中間クラスなし');
      appendClassLinks(classes, relatedClasses, '分類なし');
      row.append(name, topClassesCell, middleClassesCell, classes);
      return row;
    });
    if (!rows.length) {
      const row = document.createElement('tr');
      const cell = document.createElement('td');
      cell.colSpan = 4;
      cell.className = 'list-empty-cell';
      cell.textContent = '該当する項目はありません。';
      row.append(cell);
      rows.push(row);
    }
    document.getElementById('instance-rows').replaceChildren(...rows);
    const pageInfo = document.getElementById('instance-page-info');
    const first = filteredInstances.length ? start + 1 : 0;
    const last = Math.min(start + pageSize, filteredInstances.length);
    pageInfo.textContent = `${first}–${last}件 / ${filteredInstances.length}件（${instanceCurrentPage} / ${pageCount}ページ）`;
    document.getElementById('instance-page-prev').disabled = instanceCurrentPage <= 1;
    document.getElementById('instance-page-next').disabled = instanceCurrentPage >= pageCount;
  };
  const listSortByTab = {
    'top-class-tab': 'label-asc',
    'middle-class-tab': 'label-asc',
    'target-class-tab': 'label-asc',
    'instance-tab': 'label-asc'
  };
  const defaultListSortByTab = Object.fromEntries(Object.keys(listSortByTab).map((tabId) => [tabId, 'label-asc']));
  const listSortIsDefaultByTab = Object.fromEntries(Object.keys(listSortByTab).map((tabId) => [tabId, true]));
  let instanceHeaderCycleStarted = false;
  const activeListTabId = () => document.querySelector('.list-tab.is-active')?.id || 'top-class-tab';
  const hierarchyLevelsByTab = {
    'top-class-tab': [['t', '上位クラス']],
    'middle-class-tab': [['m', '中間クラス'], ['t', '上位クラス']],
    'target-class-tab': [['c', '対象クラス'], ['t', '上位クラス'], ['m', '中間クラス']],
    'instance-tab': [['i', 'インスタンス'], ['t', '上位クラス'], ['m', '中間クラス'], ['c', '対象クラス']]
  };
  const listSearchState = {
    'top-class-tab': { keyword: '', searchElement: 't', pinnedClassId: '', pinnedClassLevel: '', pinnedIncludeDescendants: false },
    'middle-class-tab': { keyword: '', searchElement: 'm', pinnedClassId: '', pinnedClassLevel: '', pinnedIncludeDescendants: false },
    'target-class-tab': { keyword: '', searchElement: 'c', pinnedClassId: '', pinnedClassLevel: '', pinnedIncludeDescendants: false },
    'instance-tab': { keyword: '', searchElement: 'i', pinnedClassId: '', pinnedClassLevel: '', pinnedIncludeDescendants: false }
  };
  const levelMatchesClassId = (classId, level) => Boolean(level && classId.includes(`/${level}_`));
  const refreshSearchElementOptions = (tabId) => {
    const state = listSearchState[tabId];
    const levels = hierarchyLevelsByTab[tabId];
    searchElementFilter.replaceChildren(...levels.map(([value, label]) => new Option(label, value)));
    if (!levels.some(([value]) => value === state.searchElement)) state.searchElement = levels[0]?.[0] || '';
    searchElementFilter.value = state.searchElement;
  };
  const saveActiveListSearchInputs = () => {
    const tabId = activeListTabId();
    const state = listSearchState[tabId];
    state.keyword = textFilter.value;
    state.searchElement = searchElementFilter.value;
  };
  const loadListSearchInputs = (tabId) => {
    const state = listSearchState[tabId];
    textFilter.value = state.keyword;
    refreshSearchElementOptions(tabId);
    const elementLabel = (hierarchyLevelsByTab[tabId].find(([level]) => level === state.searchElement) || ['', '要素'])[1];
    textFilter.placeholder = `${elementLabel}の名前・IDで部分一致検索`;
  };
  const classEntitiesForItem = (item, level) => [...new Map((item.ids || [item.id]).flatMap((id) =>
    [...new Set([id, ...ancestors(id)])].filter((classId) => levelMatchesClassId(classId, level))
      .map((classId) => classById.get(classId)).filter(Boolean).map((classInfo) => [classInfo.id, classInfo]))).values()];
  const classEntitiesForInstance = (item, level) => [...new Map((item.ids || [item.id]).flatMap((id) =>
    [...(classesByInstanceId.get(id)?.values() || [])].flatMap((classInfo) =>
      [...new Set([classInfo.id, ...ancestors(classInfo.id)])]
        .filter((classId) => levelMatchesClassId(classId, level))
        .map((classId) => classById.get(classId)).filter(Boolean).map((classInfoAtLevel) => [classInfoAtLevel.id, classInfoAtLevel])))).values()];
  const matchesSearchKeyword = (item, state, tabId) => {
    const keyword = state.keyword.trim().toLocaleLowerCase();
    if (!keyword) return true;
    const entities = state.searchElement === 'i' ? [item]
      : tabId === 'instance-tab' ? classEntitiesForInstance(item, state.searchElement)
        : classEntitiesForItem(item, state.searchElement);
    return entities.some((entity) => `${entity.label || ''} ${entity.id}`.toLocaleLowerCase().includes(keyword));
  };
  const matchesPinnedClass = (item, state, tabId) => {
    if (!state.pinnedClassId || !state.pinnedClassLevel) return true;
    const pinnedIds = new Set((classGroupIdsByOptionId.get(state.pinnedClassId) || [state.pinnedClassId])
      .filter((id) => levelMatchesClassId(id, state.pinnedClassLevel)));
    if (tabId === 'instance-tab') {
      const matchingIds = new Set(pinnedIds);
      if (state.pinnedIncludeDescendants) pinnedIds.forEach((id) => descendants(id).forEach((descendantId) => matchingIds.add(descendantId)));
      return (item.ids || [item.id]).some((id) => [...matchingIds].some((classId) => classesByInstanceId.get(id)?.has(classId)));
    }
    return (item.ids || [item.id]).some((id) => {
      if (state.pinnedIncludeDescendants) return pinnedIds.has(id) || [...ancestors(id)].some((ancestorId) => pinnedIds.has(ancestorId));
      return [...(parentMap.get(id) || [])].some((parentId) => pinnedIds.has(parentId));
    });
  };
  const applySort = (items, tabId = activeListTabId()) => {
    const sort = listSortByTab[tabId] || 'label-asc';
    const sorted = [...items];
    const idCountSort = sort.match(/^id-count-(desc|asc)$/);
    if (tabId === 'instance-tab' && idCountSort) {
      const direction = idCountSort[1] === 'desc' ? -1 : 1;
      return sorted.sort((a, b) => direction * (a.ids.length - b.ids.length)
        || (a.label || a.id).localeCompare(b.label || b.id, 'ja'));
    }
    const idSort = sort.match(/^id-(desc|asc)$/);
    if (tabId === 'instance-tab' && idSort) {
      const direction = idSort[1] === 'desc' ? -1 : 1;
      return sorted.sort((a, b) => direction * String(a.ids[0]).localeCompare(String(b.ids[0]))
        || (a.label || a.id).localeCompare(b.label || b.id, 'ja'));
    }
    const classSort = sort.match(/^class-count-(desc|asc)$/);
    if (tabId === 'instance-tab' && classSort) {
      const direction = classSort[1] === 'desc' ? -1 : 1;
      const assignedClasses = (item) => [...new Map((item.ids || [item.id])
        .flatMap((id) => [...(classesByInstanceId.get(id)?.values() || [])])
        .map((classInfo) => [classInfo.id, classInfo])).values()];
      const assignedLabels = (item) => [...new Set(assignedClasses(item).map((classInfo) => classInfo.label || classInfo.id))]
        .sort((a, b) => a.localeCompare(b, 'ja')).join(' ／ ') || '分類なし';
      return sorted.sort((a, b) => direction * (assignedClasses(a).length - assignedClasses(b).length)
        || assignedLabels(a).localeCompare(assignedLabels(b), 'ja')
        || (a.label || a.id).localeCompare(b.label || b.id, 'ja'));
    }
    const instanceHierarchySort = sort.match(/^(top-class|middle-class)-(desc|asc)$/);
    if (tabId === 'instance-tab' && instanceHierarchySort) {
      const [, level, order] = instanceHierarchySort;
      const direction = order === 'desc' ? -1 : 1;
      const classStats = (item) => {
        const related = new Map();
        (item.ids || [item.id]).forEach((id) => (classesByInstanceId.get(id)?.values() || []).forEach((classInfo) => {
          const lineage = new Set([classInfo.id, ...ancestors(classInfo.id)]);
          lineage.forEach((classId) => {
            if (classType(classId) === (level === 'top-class' ? 'top' : 'middle')) {
              const relatedClass = classById.get(classId);
              if (relatedClass) related.set(classId, relatedClass.label || relatedClass.id);
            }
          });
        }));
        return {
          count: related.size,
          labels: [...related.values()].sort((a, b) => a.localeCompare(b, 'ja')).join(' ／ ')
        };
      };
      return sorted.sort((a, b) => {
        const aStats = classStats(a);
        const bStats = classStats(b);
        return direction * (aStats.count - bStats.count)
          || direction * aStats.labels.localeCompare(bStats.labels, 'ja')
          || (a.label || a.id).localeCompare(b.label || b.id, 'ja');
      });
    }
    const countSort = sort.match(/^(middle-count|target-count|count)-(desc|asc)$/);
    if (tabId !== 'instance-tab' && countSort) {
      const [, metric, order] = countSort;
      const counts = metric === 'middle-count' ? middleIdsByClassId
        : metric === 'target-count' ? targetIdsByClassId : instanceIdsByClassId;
      const direction = order === 'desc' ? -1 : 1;
      return sorted.sort((a, b) => direction * (getUniqueMemberCount(counts, a) - getUniqueMemberCount(counts, b))
        || (a.label || a.id).localeCompare(b.label || b.id, 'ja'));
    }
    const parentSort = sort.match(/^parent-(desc|asc)$/);
    if (tabId !== 'instance-tab' && parentSort) {
      const direction = parentSort[1] === 'desc' ? -1 : 1;
      return sorted.sort((a, b) => direction * (parentClassesForGroup(a).length - parentClassesForGroup(b).length)
        || parentLabelForGroup(a).localeCompare(parentLabelForGroup(b), 'ja')
        || (a.label || a.id).localeCompare(b.label || b.id, 'ja'));
    }
    const classHierarchySort = sort.match(/^(top-class|middle-class)-(desc|asc)$/);
    if (tabId !== 'instance-tab' && classHierarchySort) {
      const [, level, order] = classHierarchySort;
      const direction = order === 'desc' ? -1 : 1;
      const classesForGroup = (item) => [...new Map((item.ids || [item.id])
        .flatMap((id) => (level === 'top-class' ? topClassesById : middleClassesById).get(id) || [])
        .map((classInfo) => [classInfo.id, classInfo])).values()];
      const labelsForGroup = (item) => groupItemsByLabel(classesForGroup(item))
        .map((classGroup) => classGroup.label || '(ラベルなし)')
        .sort((a, b) => a.localeCompare(b, 'ja')).join(' ／ ');
      return sorted.sort((a, b) => direction * (classesForGroup(a).length - classesForGroup(b).length)
        || direction * labelsForGroup(a).localeCompare(labelsForGroup(b), 'ja')
        || (a.label || a.id).localeCompare(b.label || b.id, 'ja'));
    }
    const childMiddleSort = sort.match(/^child-middle-(desc|asc)$/);
    if (tabId === 'middle-class-tab' && childMiddleSort) {
      const direction = childMiddleSort[1] === 'desc' ? -1 : 1;
      const childClasses = (item) => [...new Map((item.ids || [item.id])
        .flatMap((id) => childMiddleClassesById.get(id) || [])
        .map((classInfo) => [classInfo.id, classInfo])).values()];
      const childLabels = (item) => groupItemsByLabel(childClasses(item))
        .map((group) => group.label || '(ラベルなし)').sort((a, b) => a.localeCompare(b, 'ja')).join(' ／ ');
      return sorted.sort((a, b) => direction * (childClasses(a).length - childClasses(b).length)
        || direction * childLabels(a).localeCompare(childLabels(b), 'ja')
        || (a.label || a.id).localeCompare(b.label || b.id, 'ja'));
    }
    const direction = sort === 'label-desc' ? -1 : 1;
    return sorted.sort((a, b) => direction * (a.label || a.id).localeCompare(b.label || b.id, 'ja') || a.id.localeCompare(b.id));
  };
  refreshListSortOptions = () => {
    const activeTabId = activeListTabId();
    const slotId = ({
      'top-class-tab': 'top-class-page-size-slot',
      'middle-class-tab': 'middle-class-page-size-slot',
      'target-class-tab': 'target-class-page-size-slot',
      'instance-tab': 'instance-page-size-slot'
    })[activeTabId];
    document.getElementById(slotId)?.append(pageTools);
    updateListSortIndicators();
  };
  const updateListSortIndicators = () => {
    const activeSort = listSortByTab[activeListTabId()] || 'label-asc';
    document.querySelectorAll('[data-list-sort-key]').forEach((button) => {
      const key = button.dataset.listSortKey;
      const active = !listSortIsDefaultByTab[activeListTabId()] && activeSort.startsWith(`${key}-`);
      const direction = activeSort.endsWith('-asc') ? 'ascending' : 'descending';
      button.setAttribute('aria-pressed', String(active));
      button.dataset.sortDirection = active ? direction : '';
      button.closest('th')?.setAttribute('aria-sort', active ? direction : 'none');
    });
    const instanceHeader = document.querySelector('[data-list-sort-cycle="instance"]');
    if (instanceHeader) {
      const instanceSort = listSortByTab['instance-tab'];
      const mode = instanceSort.startsWith('id-count-') ? '件数'
        : instanceSort.startsWith('id-') ? 'ID' : 'ラベル';
      instanceHeader.textContent = instanceHeaderCycleStarted ? `インスタンス（${mode}）` : 'インスタンス（ラベル・ID）';
      const active = activeListTabId() === 'instance-tab' && !listSortIsDefaultByTab['instance-tab'];
      const direction = instanceSort.endsWith('-desc') ? 'descending' : 'ascending';
      instanceHeader.setAttribute('aria-pressed', String(active));
      instanceHeader.dataset.sortDirection = active ? direction : '';
      instanceHeader.closest('th')?.setAttribute('aria-sort', active ? direction : 'none');
    }
  };
  refreshListSortOptions();
  refreshBrowseListFilterSummary = () => {
    const activeTab = activeListTabId();
    const state = listSearchState[activeTab];
    const summary = document.getElementById('list-active-filter-summary');
    const chips = [];
    const addChip = (label, filterType, clear) => {
      const chip = document.createElement('button');
      chip.type = 'button'; chip.className = 'list-filter-chip';
      chip.dataset.filterType = filterType;
      chip.textContent = `${label} ×`;
      chip.setAttribute('aria-label', `${label} の条件を解除`);
      chip.addEventListener('click', () => {
        clear();
        loadListSearchInputs(activeTab);
        updateTargets();
        updateOtherLists();
        refreshBrowseListFilterSummary();
      });
      chips.push(chip);
    };
    if (state.keyword.trim()) {
      const shortLabel = ({ t: '上位', m: '中間', c: '対象', i: '実体' })[state.searchElement] || '検索';
      addChip(`${shortLabel}: ${state.keyword.trim()}`, state.searchElement, () => { state.keyword = ''; });
    }
    if (state.pinnedClassId && state.pinnedClassLevel) {
      const suffix = state.pinnedIncludeDescendants ? '（配下を含む）' : '';
      const levelLabel = ({ t: '上位', m: '中間', c: '対象' })[state.pinnedClassLevel] || 'クラス';
      const classLabel = allClassGroups.find((group) => group.id === state.pinnedClassId)?.label || state.pinnedClassId;
      addChip(`${levelLabel}: ${classLabel}${suffix}`, state.pinnedClassLevel, () => {
        state.pinnedClassId = ''; state.pinnedClassLevel = ''; state.pinnedIncludeDescendants = false;
      });
    }
    summary.replaceChildren(...(chips.length ? [document.createTextNode('絞り込み中：'), ...chips] : []));
    summary.hidden = chips.length === 0;
    document.getElementById('clear-list-filters').disabled = chips.length === 0;
  };
  const groupedResultCount = (items) => `${items.length.toLocaleString('ja-JP')}ラベル（${items.reduce((total, item) => total + item.ids.length, 0).toLocaleString('ja-JP')} ID）`;
  refreshBrowseListFilterSummary();
  const renderClassPage = (kind, items) => {
    const config = {
      top: { id: 'top-class-tab', rows: 'top-class-rows', info: 'top-class-page-info', prev: 'top-class-page-prev', next: 'top-class-page-next', middleCounts: middleIdsByClassId, targetCounts: targetIdsByClassId },
      middle: { id: 'middle-class-tab', rows: 'middle-class-rows', info: 'middle-class-page-info', prev: 'middle-class-page-prev', next: 'middle-class-page-next', parents: parentClassesById, topClasses: topClassesById, childMiddleClasses: childMiddleClassesById, targetCounts: targetIdsByClassId },
      target: { id: 'target-class-tab', rows: 'target-class-rows', info: 'target-class-page-info', prev: 'target-class-page-prev', next: 'target-class-page-next', parents: parentClassesById, topClasses: topClassesById, middleClasses: middleClassesById }
    }[kind];
    const pageCount = Math.max(1, Math.ceil(items.length / pageSize));
    classCurrentPages[kind] = Math.min(classCurrentPages[kind], pageCount);
    const currentPage = classCurrentPages[kind];
    const start = (currentPage - 1) * pageSize;
    const sortItems = applySort(items, config.id);
    const pageItems = sortItems.slice(start, start + pageSize);
    renderClassListRows(config.rows, pageItems, {
      parentsById: config.parents || null,
      topClassesById: config.topClasses || null,
      middleClassesById: config.middleClasses || null,
      childMiddleClassesById: config.childMiddleClasses || null,
      onChildMiddleClick: kind === 'middle' ? (item) => showChildrenList(item, 'middle-class-tab', false) : null,
      middleCountsById: config.middleCounts || null,
      targetCountsById: config.targetCounts || null,
      instanceCountsByClassId: instanceIdsByClassId,
      directMiddleCountsById: directMiddleIdsByClassId,
      directTargetCountsById: directTargetIdsByClassId,
      onMiddleTotalClick: kind === 'top' ? (item) => showChildrenList(item, 'middle-class-tab', true) : null,
      onMiddleDirectClick: kind === 'top' ? (item) => showChildrenList(item, 'middle-class-tab', false) : null,
      onTargetTotalClick: ['top', 'middle'].includes(kind)
        ? (item) => showChildrenList(item, 'target-class-tab', true) : null,
      onTargetDirectClick: ['top', 'middle'].includes(kind)
        ? (item) => showChildrenList(item, 'target-class-tab', false) : null,
      onInstanceClick: (item) => showInstancesForClass(item),
    });
    const first = items.length ? start + 1 : 0;
    const last = Math.min(start + pageSize, items.length);
    document.getElementById(config.info).textContent = `${first}–${last}件 / ${items.length.toLocaleString('ja-JP')}件（${currentPage} / ${pageCount}ページ）`;
    document.getElementById(config.prev).disabled = currentPage <= 1;
    document.getElementById(config.next).disabled = currentPage >= pageCount;
  };
  const updateTargets = () => {
    const state = listSearchState['target-class-tab'];
    const filtered = targets.filter((item) => matchesSearchKeyword(item, state, 'target-class-tab')
      && matchesPinnedClass(item, state, 'target-class-tab'));
    filteredTargets = filtered;
    const targetResultCount = document.getElementById('target-class-result-count');
    if (targetResultCount) targetResultCount.textContent = `（${groupedResultCount(filtered)}）`;
    classCurrentPages.target = 1;
    renderClassPage('target', filtered);
  };
  const updateOtherLists = () => {
    const topState = listSearchState['top-class-tab'];
    const middleState = listSearchState['middle-class-tab'];
    filteredTops = tops.filter((item) => matchesSearchKeyword(item, topState, 'top-class-tab')
      && matchesPinnedClass(item, topState, 'top-class-tab'));
    filteredMiddles = middles.filter((item) => matchesSearchKeyword(item, middleState, 'middle-class-tab')
      && matchesPinnedClass(item, middleState, 'middle-class-tab'));
    document.getElementById('top-class-result-count').textContent = `（${groupedResultCount(filteredTops)}）`;
    document.getElementById('middle-class-result-count').textContent = `（${groupedResultCount(filteredMiddles)}）`;
    classCurrentPages.top = 1;
    classCurrentPages.middle = 1;
    instanceCurrentPage = 1;
    renderClassPage('top', filteredTops);
    renderClassPage('middle', filteredMiddles);
    updateInstances();
  };
  const showChildrenList = (item, tabId, includeDescendants) => {
    const group = allClassGroups.find((candidate) => candidate.ids.some((id) => (item.ids || [item.id]).includes(id)));
    document.getElementById('list-tab')?.click();
    document.getElementById(tabId)?.click();
    const state = listSearchState[tabId];
    state.pinnedClassLevel = (item.ids || [item.id]).find((id) => /\/(t|m|c)_/.test(id))?.match(/\/(t|m|c)_/)?.[1] || '';
    state.pinnedClassId = group?.id || item.id;
    state.pinnedIncludeDescendants = includeDescendants;
    loadListSearchInputs(tabId);
    updateTargets();
    updateOtherLists();
    refreshBrowseListFilterSummary();
  };
  const showInstancesForClass = (item) => {
    const group = allClassGroups.find((candidate) => candidate.ids.some((id) => (item.ids || [item.id]).includes(id)));
    document.getElementById('list-tab')?.click();
    document.getElementById('instance-tab')?.click();
    const state = listSearchState['instance-tab'];
    state.pinnedClassLevel = (item.ids || [item.id]).find((id) => /\/(t|m|c)_/.test(id))?.match(/\/(t|m|c)_/)?.[1] || '';
    state.pinnedClassId = group?.id || item.id;
    state.pinnedIncludeDescendants = true;
    loadListSearchInputs('instance-tab');
    updateInstances();
    refreshBrowseListFilterSummary();
  };
  const updateInstances = () => {
    const state = listSearchState['instance-tab'];
    filteredInstances = instances.filter((item) => matchesSearchKeyword(item, state, 'instance-tab')
      && matchesPinnedClass(item, state, 'instance-tab'));
    instanceCurrentPage = 1;
    document.getElementById('instance-result-count').textContent = `（${groupedResultCount(filteredInstances)}）`;
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
    const escapeTsv = (value) => {
      const text = String(value ?? '');
      const safeText = /^[\u0000-\u0020\uFEFF]*[=+\-@]/.test(text) ? `'${text}` : text;
      return safeText.replace(/[\t\r\n]/g, ' ');
    };
    const headers = activeListId === 'top-class-tab'
      ? ['ID', 'ラベル', '配下の中間クラス数', '配下の対象クラス数', '配下のインスタンス数']
      : activeListId === 'middle-class-tab'
        ? ['ID', 'ラベル', '上位クラス', '親クラス', '下位中間クラス数', '配下の対象クラス数', '配下のインスタンス数']
        : activeListId === 'target-class-tab'
          ? ['ID', 'ラベル', '上位クラス', '中間クラス', '親クラス', 'インスタンス数']
          : ['ID', 'ラベル', '上位クラス', '中間クラス', '所属クラス'];
    const lines = [headers.join('\t'), ...items.map((item) => {
      const memberIds = item.ids || [item.id];
      const base = `${escapeTsv(memberIds.join(' ／ '))}\t${escapeTsv(item.label)}`;
      const instanceCount = getUniqueMemberCount(instanceIdsByClassId, item);
      const parents = [...new Map(memberIds.flatMap((id) => parentClassesById.get(id) || [])
        .map((parent) => [parent.id, parent])).values()];
      const parentLabels = groupItemsByLabel(parents).map((parent) => parent.label || '(ラベルなし)').join(' ／ ') || '親なし';
      const topLabels = groupItemsByLabel([...new Map(memberIds.flatMap((id) => topClassesById.get(id) || [])
        .map((topClass) => [topClass.id, topClass])).values()])
        .map((topClass) => topClass.label || '(ラベルなし)').join(' ／ ') || '上位クラスなし';
      const middleLabels = groupItemsByLabel([...new Map(memberIds.flatMap((id) => middleClassesById.get(id) || [])
        .map((middleClass) => [middleClass.id, middleClass])).values()])
        .map((middleClass) => middleClass.label || '(ラベルなし)').join(' ／ ') || '中間クラスなし';
      const childMiddleCount = new Set(memberIds.flatMap((id) => (childMiddleClassesById.get(id) || []).map((middleClass) => middleClass.id))).size;
      if (activeListId === 'top-class-tab') {
        return `${base}\t${getUniqueMemberCount(middleIdsByClassId, item)}件\t${getUniqueMemberCount(targetIdsByClassId, item)}件\t${instanceCount}件`;
      }
      if (activeListId === 'middle-class-tab') {
        return `${base}\t${escapeTsv(topLabels)}\t${escapeTsv(parentLabels)}\t${childMiddleCount}件\t${getUniqueMemberCount(targetIdsByClassId, item)}件\t${instanceCount}件`;
      }
      if (activeListId === 'target-class-tab') return `${base}\t${escapeTsv(topLabels)}\t${escapeTsv(middleLabels)}\t${escapeTsv(parentLabels)}\t${instanceCount}件`;
      const instanceClasses = [...new Map(memberIds
        .flatMap((id) => [...(classesByInstanceId.get(id)?.values() || [])])
        .map((classInfo) => [classInfo.id, classInfo])).values()];
      const relatedClasses = groupItemsByLabel(instanceClasses)
        .map((classGroup) => classGroup.label || '(ラベルなし)').join(' ／ ') || '分類なし';
      const hierarchyLabels = (level) => groupItemsByLabel([...new Map(instanceClasses.flatMap((classInfo) =>
        [...new Set([classInfo.id, ...ancestors(classInfo.id)])]
          .filter((id) => classType(id) === (level === 'top' ? 'top' : 'middle'))
          .map((id) => classById.get(id)).filter(Boolean).map((relatedClass) => [relatedClass.id, relatedClass]))).values()])
        .map((classGroup) => classGroup.label || '(ラベルなし)').join(' ／ ') || `${level === 'top' ? '上位' : '中間'}クラスなし`;
      return `${base}\t${escapeTsv(hierarchyLabels('top'))}\t${escapeTsv(hierarchyLabels('middle'))}\t${escapeTsv(relatedClasses)}`;
    })];
    const blob = new Blob([`\ufeff${lines.join('\r\n')}\r\n`], { type: 'text/tab-separated-values;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    link.click();
    URL.revokeObjectURL(url);
  };
  searchElementFilter.onchange = () => {
    const state = listSearchState[activeListTabId()];
    state.searchElement = searchElementFilter.value;
    const elementLabel = (hierarchyLevelsByTab[activeListTabId()].find(([level]) => level === state.searchElement) || ['', '要素'])[1];
    textFilter.placeholder = `${elementLabel}の名前・IDで部分一致検索`;
    updateTargets();
    updateOtherLists();
    refreshBrowseListFilterSummary?.();
  };
  textFilter.oninput = () => {
    listSearchState[activeListTabId()].keyword = textFilter.value;
    updateTargets();
    updateOtherLists();
    refreshBrowseListFilterSummary?.();
  };
  document.querySelectorAll('.list-tab').forEach((tab) => {
    tab.addEventListener('click', () => {
      saveActiveListSearchInputs();
      loadListSearchInputs(tab.id);
      updateTargets();
      updateOtherLists();
      refreshBrowseListFilterSummary?.();
    });
  });
  const rerenderForActiveSort = () => {
    updateListSortIndicators();
    const activeTab = activeListTabId();
    if (activeTab === 'target-class-tab') updateTargets();
    else if (activeTab === 'instance-tab') updateInstances();
    else updateOtherLists();
  };
  document.querySelectorAll('[data-list-sort-key]').forEach((button) => {
    button.addEventListener('click', () => {
      const activeTab = activeListTabId();
      const descending = `${button.dataset.listSortKey}-desc`;
      const ascending = `${button.dataset.listSortKey}-asc`;
      if (listSortIsDefaultByTab[activeTab] || !listSortByTab[activeTab].startsWith(`${button.dataset.listSortKey}-`)) {
        listSortByTab[activeTab] = descending;
        listSortIsDefaultByTab[activeTab] = false;
      } else if (listSortByTab[activeTab] === descending) {
        listSortByTab[activeTab] = ascending;
      } else {
        listSortByTab[activeTab] = defaultListSortByTab[activeTab];
        listSortIsDefaultByTab[activeTab] = true;
        if (activeTab === 'instance-tab') instanceHeaderCycleStarted = false;
      }
      rerenderForActiveSort();
    });
  });
  document.querySelector('[data-list-sort-cycle="instance"]')?.addEventListener('click', () => {
    const instanceSort = listSortByTab['instance-tab'];
    const currentMode = instanceSort.startsWith('id-count-') ? 'count'
      : instanceSort.startsWith('id-') ? 'id' : 'label';
    if (!instanceHeaderCycleStarted) {
      listSortByTab['instance-tab'] = 'id-count-desc';
      listSortIsDefaultByTab['instance-tab'] = false;
      instanceHeaderCycleStarted = true;
    } else if (currentMode === 'count') {
      listSortByTab['instance-tab'] = 'label-asc';
    } else if (currentMode === 'label') {
      listSortByTab['instance-tab'] = 'id-asc';
    } else {
      listSortByTab['instance-tab'] = defaultListSortByTab['instance-tab'];
      listSortIsDefaultByTab['instance-tab'] = true;
      instanceHeaderCycleStarted = false;
    }
    rerenderForActiveSort();
  });
  pageSizeSelect.onchange = () => {
    pageSize = pageSizeSelect.value === 'all' ? Number.MAX_SAFE_INTEGER : Number(pageSizeSelect.value) || 100;
    instanceCurrentPage = 1;
    Object.keys(classCurrentPages).forEach((kind) => { classCurrentPages[kind] = 1; });
    updateTargets();
    updateOtherLists();
  };
  renderTargetClassList = updateTargets;
  loadListSearchInputs(activeListTabId());
  if (document.getElementById('target-class-panel')?.hidden === false) updateTargets();
  updateOtherLists();
  document.getElementById('instance-page-prev').onclick = () => {
    if (instanceCurrentPage <= 1) return;
    instanceCurrentPage -= 1;
    renderInstancePage();
  };
  document.getElementById('instance-page-next').onclick = () => {
    if (instanceCurrentPage * pageSize >= filteredInstances.length) return;
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
      if (classCurrentPages[kind] * pageSize >= classPageItems[kind]().length) return;
      classCurrentPages[kind] += 1;
      renderClassPage(kind, classPageItems[kind]());
    };
  });
  document.getElementById('clear-list-filters').onclick = () => {
    Object.values(listSearchState).forEach((state) => {
      state.keyword = '';
      state.pinnedClassId = '';
      state.pinnedClassLevel = '';
      state.pinnedIncludeDescendants = false;
    });
    loadListSearchInputs(activeListTabId());
    updateTargets();
    updateOtherLists();
    refreshBrowseListFilterSummary?.();
  };
}

