// クラス階層に沿った集計表を作成し、集計画面の表示切替を設定する。
const aggregationDefaultSortState = {
  top: { metric: 'instanceCount', direction: -1 },
  middle: { metric: 'instanceCount', direction: -1 },
  target: { metric: 'instanceCount', direction: -1 },
  instance: { metric: 'label', direction: 1 }
};
const aggregationSortState = Object.fromEntries(Object.entries(aggregationDefaultSortState)
  .map(([key, state]) => [key, { ...state }]));
const aggregationSortIsDefault = Object.fromEntries(Object.keys(aggregationDefaultSortState).map((key) => [key, true]));

function renderAggregation(data) {
  const panel = document.getElementById('aggregation-panel');
  if (!panel) return;
  const classes = [...new Map((data.classData?.classes || []).map((item) => [item.id, item])).values()];
  const byId = new Map(classes.map((item) => [item.id, item]));
  const tops = classes.filter((item) => /\/t_/.test(item.id));
  const middles = classes.filter((item) => /\/m_/.test(item.id));
  const targets = classes.filter((item) => /\/c_/.test(item.id));
  const parents = new Map();
  const children = new Map();
  (data.classData?.relations || []).forEach(({ child, parent }) => {
    if (!byId.has(child) || !byId.has(parent)) return;
    if (!parents.has(child)) parents.set(child, new Set());
    if (!children.has(parent)) children.set(parent, new Set());
    parents.get(child).add(parent);
    children.get(parent).add(child);
  });
  const topAncestors = (id) => {
    const found = new Set();
    const pending = [...(parents.get(id) || [])];
    while (pending.length) {
      const current = pending.pop();
      if (found.has(current)) continue;
      found.add(current);
      pending.push(...(parents.get(current) || []));
    }
    return found;
  };
  const descendants = (id) => {
    const found = new Set();
    const pending = [...(children.get(id) || [])];
    while (pending.length) {
      const current = pending.pop();
      if (found.has(current)) continue;
      found.add(current);
      pending.push(...(children.get(current) || []));
    }
    return found;
  };
  const knownInstances = new Set((data.instanceData?.instances || []).map((item) => item.id));
  const instanceIdsByClass = new Map();
  (data.instanceClassData?.relations || []).forEach(({ instance, class: classId }) => {
    if (!knownInstances.has(instance)) return;
    const associated = [classId, ...topAncestors(classId)];
    associated.forEach((id) => {
      if (!instanceIdsByClass.has(id)) instanceIdsByClass.set(id, new Set());
      instanceIdsByClass.get(id).add(instance);
    });
  });
  const statsFor = (item) => {
    const below = descendants(item.id);
    const middleCount = new Set([...below].filter((id) => /\/m_/.test(id))).size;
    const targetCount = [...below].filter((id) => /\/c_/.test(id)).length;
    const directChildren = children.get(item.id) || new Set();
    const directMiddleCount = [...directChildren].filter((id) => /\/m_/.test(id)).length;
    const directTargetCount = [...directChildren].filter((id) => /\/c_/.test(id)).length;
    const instanceIds = new Set(instanceIdsByClass.get(item.id) || []);
    below.forEach((id) => (instanceIdsByClass.get(id) || []).forEach((value) => instanceIds.add(value)));
    return { item, middleCount, targetCount, directMiddleCount, directTargetCount, instanceCount: instanceIds.size };
  };
  const topStats = tops.map(statsFor);
  const middleStats = middles.map(statsFor);
  const topIds = new Set(tops.map((item) => item.id));
  const hasTopAncestor = (id) => topIds.has(id) || [...topAncestors(id)].some((ancestorId) => topIds.has(ancestorId));
  const unclassifiedClassCount = classes.filter((item) => !topIds.has(item.id) && !hasTopAncestor(item.id)).length;
  const instanceIdsWithTopClass = new Set();
  (data.instanceClassData?.relations || []).forEach(({ instance, class: classId }) => {
    if (knownInstances.has(instance) && hasTopAncestor(classId)) instanceIdsWithTopClass.add(instance);
  });
  const unclassifiedInstanceCount = [...knownInstances].filter((id) => !instanceIdsWithTopClass.has(id)).length;
  const summary = document.getElementById('aggregation-summary');
  const cards = [
    ['インスタンス', knownInstances.size],
    ['対象クラス', targets.length],
    ['中間クラス', middles.length],
    ['上位クラス', tops.length],
    ['分類なしクラス', unclassifiedClassCount],
    ['分類なしインスタンス', unclassifiedInstanceCount]
  ];
  summary.replaceChildren(...cards.map(([label, count]) => {
    const card = document.createElement('div'); card.className = 'aggregation-card';
    const title = document.createElement('span'); title.textContent = label;
    const value = document.createElement('strong'); value.textContent = `${count.toLocaleString('ja-JP')}件`;
    card.append(title, value); return card;
  }));
  const filter = document.getElementById('aggregation-top-filter');
  const selected = filter.value;
  filter.replaceChildren(new Option('すべて', ''), ...tops.map((item) => new Option(item.label || item.id, item.id)));
  filter.value = selected;
  const sortStats = (items, tableKey) => {
    const { metric, direction } = aggregationSortState[tableKey];
    if (metric === 'label') {
      return [...items].sort((a, b) => direction * (a.item.label || a.item.id).localeCompare(b.item.label || b.item.id, 'ja'));
    }
    return [...items].sort((a, b) => direction * ((a[metric] || 0) - (b[metric] || 0))
      || (a.item.label || a.item.id).localeCompare(b.item.label || b.item.id, 'ja'));
  };
  const drawRows = (targetId, items, max, includeMiddleCount = false, includeTargetCount = true, tableKey = 'middle') => {
    document.getElementById(targetId).replaceChildren(...sortStats(items, tableKey).map(({ item, middleCount, targetCount, directMiddleCount, directTargetCount, instanceCount }) => {
      const row = document.createElement('tr');
      const name = document.createElement('th'); name.scope = 'row'; name.textContent = item.label || '(ラベルなし)';
      const inst = document.createElement('td'); inst.textContent = `${instanceCount.toLocaleString('ja-JP')}件`;
      const target = document.createElement('td'); target.textContent = targetCount
        ? `全件 ${targetCount.toLocaleString('ja-JP')}件 ／ 直下 ${directTargetCount.toLocaleString('ja-JP')}件`
        : '0件';
      if (includeMiddleCount) {
        const middle = document.createElement('td'); middle.textContent = middleCount
          ? `全件 ${middleCount.toLocaleString('ja-JP')}件 ／ 直下 ${directMiddleCount.toLocaleString('ja-JP')}件`
          : '0件';
        row.append(name, middle);
      } else {
        row.append(name);
      }
      if (includeTargetCount) row.append(target);
      const barCell = document.createElement('td'); barCell.className = 'aggregation-bar-cell';
      const bar = document.createElement('span'); bar.className = 'aggregation-bar';
      bar.style.width = `${max ? Math.max(instanceCount > 0 ? 2 : 0, instanceCount / max * 100) : 0}%`;
      bar.setAttribute('aria-label', `インスタンス ${instanceCount}件`); barCell.append(bar);
      row.append(inst, barCell); return row;
    }));
  };
  drawRows('aggregation-top-rows', topStats, Math.max(0, ...topStats.map((stat) => stat.instanceCount)), true, true, 'top');
  const selectedMiddles = selected ? middleStats.filter(({ item }) => topAncestors(item.id).has(selected)) : middleStats;
  drawRows('aggregation-middle-rows', selectedMiddles, Math.max(0, ...selectedMiddles.map((stat) => stat.instanceCount)), false, true, 'middle');
  const selectedTargets = targets.map(statsFor)
    .filter(({ item }) => !selected || topAncestors(item.id).has(selected));
  const targetMax = Math.max(0, ...selectedTargets.map((stat) => stat.instanceCount));
  document.getElementById('aggregation-target-rows').replaceChildren(...sortStats(selectedTargets, 'target').map(({ item, instanceCount }) => {
    const row = document.createElement('tr');
    const name = document.createElement('th'); name.scope = 'row'; name.textContent = item.label || '(ラベルなし)';
    const count = document.createElement('td'); count.textContent = `${instanceCount.toLocaleString('ja-JP')}件`;
    const barCell = document.createElement('td'); barCell.className = 'aggregation-bar-cell';
    const bar = document.createElement('span'); bar.className = 'aggregation-bar';
    bar.style.width = `${targetMax ? Math.max(instanceCount > 0 ? 2 : 0, instanceCount / targetMax * 100) : 0}%`;
    bar.setAttribute('aria-label', `インスタンス ${instanceCount}件`); barCell.append(bar);
    row.append(name, count, barCell); return row;
  }));
  const instanceById = new Map((data.instanceData?.instances || []).map((item) => [item.id, item]));
  const classesByInstance = new Map();
  (data.instanceClassData?.relations || []).forEach(({ instance, class: classId }) => {
    if (!knownInstances.has(instance) || !byId.has(classId)) return;
    if (!classesByInstance.has(instance)) classesByInstance.set(instance, new Set());
    classesByInstance.get(instance).add(classId);
  });
  const instanceRows = [...instanceById.values()].filter((instance) => {
    if (!selected) return true;
    return [...(classesByInstance.get(instance.id) || [])]
      .some((classId) => classId === selected || topAncestors(classId).has(selected));
  }).sort((a, b) => aggregationSortState.instance.direction
    * (a.label || a.id).localeCompare(b.label || b.id, 'ja'));
  document.getElementById('aggregation-instance-rows').replaceChildren(...instanceRows.map((instance) => {
    const row = document.createElement('tr');
    const name = document.createElement('th'); name.scope = 'row'; name.textContent = instance.label || '(ラベルなし)';
    const pathCell = document.createElement('td');
    const instanceClassIds = [...(classesByInstance.get(instance.id) || [])];
    const assignedClasses = instanceClassIds
      .map((classId) => byId.get(classId)?.label || byId.get(classId)?.id).filter(Boolean);
    const belongsToTopClass = instanceClassIds.some((classId) => hasTopAncestor(classId));
    const directClassLabels = [...new Set(assignedClasses)].join(' ／ ');
    pathCell.textContent = belongsToTopClass
      ? directClassLabels || '分類なし'
      : directClassLabels ? `分類なし（${directClassLabels}）` : '分類なし';
    row.append(name, pathCell); return row;
  }));
  document.querySelectorAll('[data-aggregation-sort]').forEach((button) => {
    const [tableKey, metric] = button.dataset.aggregationSort.split(':');
    const state = aggregationSortState[tableKey];
    const active = !aggregationSortIsDefault[tableKey] && state.metric === metric;
    button.setAttribute('aria-pressed', String(active));
    button.dataset.sortDirection = active ? (state.direction > 0 ? 'ascending' : 'descending') : '';
    button.closest('th')?.setAttribute('aria-sort', active
      ? (state.direction > 0 ? 'ascending' : 'descending') : 'none');
  });
}

document.querySelectorAll('[data-aggregation-sort]').forEach((button) => {
  button.addEventListener('click', () => {
    const [tableKey, metric] = button.dataset.aggregationSort.split(':');
    const state = aggregationSortState[tableKey];
    if (!state) return;
    if (aggregationSortIsDefault[tableKey] || state.metric !== metric) {
      state.metric = metric;
      state.direction = -1;
      aggregationSortIsDefault[tableKey] = false;
    } else if (state.direction < 0) {
      state.direction = 1;
    } else {
      Object.assign(state, aggregationDefaultSortState[tableKey]);
      aggregationSortIsDefault[tableKey] = true;
    }
    if (window.appData) renderAggregation(window.appData);
  });
});

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

