// ============================================================
// 編集画面の状態と共有データ
// ============================================================
// app.js が読み込んだ編集対象データを共有する。classes は同じ配列を参照するため、
// ここへ追加したクラスは保存処理とツリー表示の両方にそのまま反映される。
const data = window.appData;
// 編集用の配列を元データから複製し、保存前の変更が読み込み元へ混ざらないようにする。
data.classData.classes = data.classData.classes.map((item) => ({ ...item }));
data.classData.relations = data.classData.relations.map((relation) => ({ ...relation }));
const classes = data.classData.classes;
const childSelect = document.getElementById('edit-child-class');
const parentSelect = document.getElementById('edit-parent-class');
const status = document.getElementById('edit-status');
// ツリー上で選択した対象クラスを一時的に保持する。Map にすることで、
// 同じクラスの重複選択を防ぎながら、IDを使った移動処理を行える。
const heldInstances = new Map();
const heldMiddleClasses = new Map();
const heldTopClasses = new Map();
const instancesByTargetClassId = new Map();
(data.instanceClassData.instances || []).forEach((instance) => {
  (instance.classes || []).forEach((classInfo) => {
    if (!instancesByTargetClassId.has(classInfo.id)) instancesByTargetClassId.set(classInfo.id, []);
    instancesByTargetClassId.get(classInfo.id).push(instance);
  });
});
const targetInstanceDialog = document.getElementById('target-instance-dialog');
targetInstanceDialog.addEventListener('click', (event) => {
  const bounds = targetInstanceDialog.getBoundingClientRect();
  const clickedOutside = event.clientX < bounds.left || event.clientX > bounds.right
    || event.clientY < bounds.top || event.clientY > bounds.bottom;
  if (clickedOutside) targetInstanceDialog.close();
});
function showRelatedInstances(targetClass) {
  const instances = instancesByTargetClassId.get(targetClass.id) || [];
  document.getElementById('target-instance-title').textContent = `${targetClass.label}の関連インスタンス`;
  document.getElementById('target-instance-count').textContent = `${instances.length}件`;
  const instanceList = document.getElementById('target-instance-list');
  instanceList.replaceChildren(...instances.map((instance) => {
    const row = document.createElement('li');
    const label = document.createElement('span');
    label.textContent = instance.label || '(ラベルなし)';
    const id = document.createElement('small');
    id.textContent = String(instance.id || '').split('/').pop();
    row.append(label, id);
    return row;
  }));
  if (!instances.length) {
    const empty = document.createElement('li');
    empty.textContent = '関連するインスタンスはありません。';
    instanceList.append(empty);
  }
  targetInstanceDialog.showModal();
}
const targetButtonById = new Map();
const middleCheckboxById = new Map();
const topCheckboxById = new Map();
const searchSelected = new Map();
let hasUnsavedChanges = false;
let managementKind = 'top';
let searchDestinationId = '';

// 未分類の上位クラスは予約ID t_0 に統一する（旧データの t_16 なども移行）。
const unclassifiedTop = classes.find((item) => classKind(item) === 'top' && item.label === '未分類');
if (unclassifiedTop && unclassifiedTop.id !== 't_0') {
  const oldId = unclassifiedTop.id;
  unclassifiedTop.id = 't_0';
  data.classData.relations.forEach((relation) => {
    if (relation.parent === oldId) relation.parent = unclassifiedTop.id;
    if (relation.child === oldId) relation.child = unclassifiedTop.id;
  });
}

// 旧データに残っている「未分類」中間クラス(m_17)を読み込み時に除去する。
// 対象クラスは失わず、上位クラス「未分類」へ直接付け替える。
const legacyUnclassifiedMiddleIds = new Set(
  classes.filter((item) => item.label === '未分類' && /^(?:https?:\/\/[^/]+\/)?(?:new-)?m[_-]17$/.test(item.id)).map((item) => item.id)
);
if (legacyUnclassifiedMiddleIds.size) {
  let unclassifiedTop = classes.find((item) => classKind(item) === 'top' && item.label === '未分類');
  if (unclassifiedTop) {
    const movedTargetIds = new Set(
      data.classData.relations
        .filter((relation) => legacyUnclassifiedMiddleIds.has(relation.parent))
        .map((relation) => relation.child)
    );
    data.classData.relations = data.classData.relations.filter((relation) =>
      !legacyUnclassifiedMiddleIds.has(relation.parent) && !legacyUnclassifiedMiddleIds.has(relation.child)
    );
    movedTargetIds.forEach((child) => data.classData.relations.push({
      child, parent: unclassifiedTop.id, relation: 'subClassOf'
    }));
    for (let index = classes.length - 1; index >= 0; index -= 1) {
      if (legacyUnclassifiedMiddleIds.has(classes[index].id)) classes.splice(index, 1);
    }
  }
}

const classById = new Map(classes.map((item) => [item.id, item]));

// ============================================================
// クラス・ID・親子関係の基本操作
// ============================================================
// IDの命名規則からクラスの階層を判定する。new- で始まる編集中のIDも、
// 保存前から通常の上位・中間・対象クラスと同じように扱う。
function kind(id) {
  const segment = String(id).split('/').pop();
  if (/^(?:new-)?t[_-]/.test(segment)) return 'top';
  if (/^(?:new-)?m[_-]/.test(segment)) return 'middle';
  return 'class';
}

function classKind(item) {
  return item.type || kind(item.id);
}

function displayClassId(id) {
  const segment = id.split('/').pop();
  const match = segment.match(/^([cmt])_0*(\d+)$/);
  return match ? `${match[1]}_${Number(match[2])}` : segment;
}

function allocateTemporaryClassId(type) {
  const prefix = type === 'top' ? 't_' : 'm_';
  const serial = classes.reduce((max, item) => {
    if (kind(item.id) !== type) return max;
    const match = String(item.id).split('/').pop().match(/^(?:new-)?[mt]_0*(\d+)$/);
    return match ? Math.max(max, Number(match[1])) : max;
  }, 0) + 1;
  return `new-${prefix}${serial}`;
}

function createClass(type, label) {
  if (type === 'class') return null;
  const normalizedLabel = label.trim();
  if (type === 'top' && normalizedLabel === '未分類' && !classes.some((item) => item.id === 't_0')) {
    const item = { id: 't_0', label: normalizedLabel, type };
    classes.push(item);
    classById.set(item.id, item);
    return item;
  }
  // 同じラベルでも所属先が異なる中間クラスは別クラスとして作成する。
  // 呼び出し側で親子関係を設定するため、ここでは既存クラスを再利用しない。
  // 新規IDは既存件数を基準に連番で作る。new- を付けることで、保存時に
  // まだ正式な外部IDが割り当てられていないクラスとして出力できる。
  // 件数ではなく既存IDの最大番号の次を使い、Java側の一時ID解決と揃える。
  const item = { id: allocateTemporaryClassId(type), label: normalizedLabel, type };
  classes.push(item);
  classById.set(item.id, item);
  return item;
}

function addRelation(child, parent) {
  // 同じ親子関係を重複登録しない。
  const exists = data.classData.relations.some((relation) =>
    relation.child === child && relation.parent === parent && relation.relation === 'subClassOf');
  if (!exists) data.classData.relations.push({ child, parent, relation: 'subClassOf' });
}

function buildChildrenMap(relations = data.classData.relations) {
  const children = new Map();
  relations.forEach(({ parent, child }) => {
    if (!children.has(parent)) children.set(parent, []);
    children.get(parent).push(child);
  });
  return children;
}

function descendantIds(id) {
  const children = buildChildrenMap();
  const result = new Set();
  const pending = [...(children.get(id) || [])];
  while (pending.length) {
    const childId = pending.pop();
    if (result.has(childId) || childId === id) continue;
    result.add(childId);
    (children.get(childId) || []).forEach((descendantId) => pending.push(descendantId));
  }
  return result;
}

function createTargetCounter(children) {
  const cache = new Map();
  const count = (id, visiting = new Set()) => {
    if (cache.has(id)) return cache.get(id);
    if (visiting.has(id)) return 0;
    const nextVisiting = new Set(visiting).add(id);
    const total = (children.get(id) || []).reduce((sum, childId) =>
      sum + (kind(childId) === 'class' ? 1 : count(childId, nextVisiting)), 0);
    cache.set(id, total);
    return total;
  };
  return count;
}

function ensureUnclassified() {
  // 「未分類」は上位クラスとして扱い、対象クラスを直接ぶら下げる。
  // 中間クラスを作らないことで、ツリー上でも未分類の対象を直接確認できる。
  let top = classes.find((item) => classKind(item) === 'top' && item.label === '未分類');
  if (!top) top = createClass('top', '未分類');
  return { top };
}

function moveClassMembersToUnclassified(classId) {
  const members = [...descendantIds(classId)].filter((id) => kind(id) === 'class');
  if (!members.length) return 0;
  const { top } = ensureUnclassified();
  const memberIds = new Set(members);
  data.classData.relations = data.classData.relations.filter((relation) => !memberIds.has(relation.child));
  members.forEach((id) => addRelation(id, top.id));
  return members.length;
}

// ============================================================
// 検索結果とクラス管理一覧の描画
// ============================================================
function findTargetClasses(searchType, query) {
  const normalizedQuery = query.trim().toLocaleLowerCase();
  const instances = data.instanceClassData.instances || [];
  if (searchType === 'instance') {
    const matchedInstances = instances.filter((instance) =>
      !normalizedQuery || `${instance.label || ''} ${instance.id || ''}`.toLocaleLowerCase().includes(normalizedQuery));
    const matchedClassIds = new Set(matchedInstances.flatMap((instance) =>
      (instance.classes || []).map((classInfo) => classInfo.id)
    ));
    return {
      targets: classes.filter((item) => classKind(item) === 'class' && matchedClassIds.has(item.id)),
      matchedInstanceCount: matchedInstances.length
    };
  }
  return {
    targets: classes.filter((item) => classKind(item) === 'class' &&
      (!normalizedQuery || `${item.label} ${item.id}`.toLocaleLowerCase().includes(normalizedQuery))),
    matchedInstanceCount: 0
  };
}

function renderTargetSearch() {
  const input = document.getElementById('target-class-search');
  const searchType = document.getElementById('target-search-type').value;
  const { targets, matchedInstanceCount } = findTargetClasses(searchType, input.value);
  // 検索結果には対象クラスと直上の親だけを表示する（祖先階層はたどらない）。
  const parentsByClassId = new Map();
  data.classData.relations.forEach((relation) => {
    if (!parentsByClassId.has(relation.child)) parentsByClassId.set(relation.child, []);
    const parent = classById.get(relation.parent);
    if (parent) parentsByClassId.get(relation.child).push(parent);
  });
  const result = document.getElementById('target-search-results');
  result.replaceChildren(...targets.map((item) => {
    const row = document.createElement('div'); row.className = 'target-search-result-option';
    const label = document.createElement('label'); label.className = 'target-search-option';
    const checkbox = document.createElement('input'); checkbox.type = 'checkbox'; checkbox.checked = searchSelected.has(item.id); checkbox.dataset.classId = item.id;
    checkbox.addEventListener('change', () => {
      if (checkbox.checked) searchSelected.set(item.id, item);
      else searchSelected.delete(item.id);
      document.getElementById('target-search-count').textContent = searchType === 'instance'
        ? `一致インスタンス ${matchedInstanceCount}件 / 表示クラス ${targets.length}件 / 選択中 ${searchSelected.size}件`
        : `表示 ${targets.length}件 / 選択中 ${searchSelected.size}件`;
    });
    const content = document.createElement('span'); content.className = 'target-search-option-content';
    const parentText = document.createElement('span'); parentText.className = 'target-search-parent';
    const parents = parentsByClassId.get(item.id) || [];
    parentText.textContent = parents.length
      ? parents.map((parent) => `${classKind(parent) === 'top' ? '上位' : '中間'}: ${parent.label} (${displayClassId(parent.id)})`).join('、')
      : '所属なし';
    const classText = document.createElement('span'); classText.className = 'target-search-class';
    classText.textContent = `${item.label} (${displayClassId(item.id)})`;
    content.append(parentText, classText);
    label.append(checkbox, content);
    const infoButton = document.createElement('button');
    infoButton.type = 'button';
    infoButton.className = 'target-search-info-button';
    infoButton.textContent = 'i';
    infoButton.setAttribute('aria-label', `${item.label}に関連するインスタンスを表示`);
    infoButton.title = '関連インスタンスを表示';
    infoButton.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      showRelatedInstances(item);
    });
    row.append(label, infoButton);
    return row;
  }));
  document.getElementById('target-search-count').textContent =
    searchType === 'instance'
      ? `一致インスタンス ${matchedInstanceCount}件 / 表示クラス ${targets.length}件 / 選択中 ${searchSelected.size}件`
      : `表示 ${targets.length}件 / 選択中 ${searchSelected.size}件`;
}

function renderClassManagement() {
  const list = document.getElementById('class-management-list');
  if (!list) return;
  const countTargets = createTargetCounter(buildChildrenMap());
  const managed = classes.filter((item) => classKind(item) === managementKind)
    .map((item) => ({ item, count: countTargets(item.id) }))
    .sort((a, b) => a.count - b.count || a.item.label.localeCompare(b.item.label, 'ja'));
  list.replaceChildren(...managed.map(({ item, count }) => {
    const row = document.createElement('div'); row.className = 'class-management-row';
    const info = document.createElement('span'); info.textContent = `${classKind(item) === 'top' ? '上位' : '中間'}: ${item.label} (${displayClassId(item.id)}) — ${count}件`;
    const actions = document.createElement('span'); actions.className = 'class-management-actions';
    const rename = document.createElement('button'); rename.type = 'button'; rename.className = 'rename-class-button'; rename.textContent = '名称変更';
    rename.addEventListener('click', () => {
      const nextLabel = window.prompt('新しいクラス名を入力してください。', item.label);
      if (!nextLabel || !nextLabel.trim() || nextLabel.trim() === item.label) return;
      item.label = nextLabel.trim(); hasUnsavedChanges = true;
      status.textContent = `クラス名を「${item.label}」に変更しました。`; render();
    });
    const button = document.createElement('button'); button.type = 'button'; button.className = 'delete-class-button'; button.textContent = '削除';
    button.disabled = item.label === '未分類';
    button.addEventListener('click', () => {
      if (!window.confirm(`「${item.label}」を削除しますか？所属する対象クラスは未分類へ移動します。`)) return;
      const moved = moveClassMembersToUnclassified(item.id);
      const childIds = new Set(data.classData.relations.filter((relation) => relation.parent === item.id).map((relation) => relation.child));
      data.classData.relations = data.classData.relations.filter((relation) => relation.child !== item.id && relation.parent !== item.id);
      if (classKind(item) === 'top') {
        const { top } = ensureUnclassified();
        childIds.forEach((childId) => { if (classById.has(childId)) addRelation(childId, top.id); });
      }
      const index = classes.indexOf(item); if (index >= 0) classes.splice(index, 1);
      classById.delete(item.id);
      heldMiddleClasses.delete(item.id); heldTopClasses.delete(item.id); hasUnsavedChanges = true;
      status.textContent = `${item.label}を削除しました。${moved}件を未分類へ移動しました。`; render();
    });
    actions.append(rename, button); row.append(info, actions); return row;
  }));
}

// ============================================================
// フォーム・一覧・保持中パネルの描画
// ============================================================
// 子クラス・親クラスの選択欄を現在のクラス配列から作り直す。
function fillSelect(select) {
  select.replaceChildren(...classes.map((item) => {
    const option = document.createElement('option'); option.value = item.id; option.textContent = `${item.label} (${displayClassId(item.id)})`; return option;
  }));
}
function renderSearchParentOptions() {
  const searchTargetKind = document.getElementById('search-target-kind');
  const searchParent = document.getElementById('search-target-parent');
  const selectedKind = searchTargetKind.value;
  searchParent.parentElement.firstChild.textContent = selectedKind === 'top' ? '付与先の上位クラス' : '付与先の中間クラス';
  searchParent.replaceChildren(...classes.filter((item) => classKind(item) === selectedKind).map((item) => {
    const option = document.createElement('option'); option.value = item.id; option.textContent = `${item.label} (${displayClassId(item.id)})`; return option;
  }));
  const newParent = document.getElementById('search-new-class-parent');
  const parentKind = document.getElementById('search-new-class-parent-kind').value;
  newParent.replaceChildren(...classes.filter((item) => classKind(item) === parentKind).map((item) => {
    const option = document.createElement('option'); option.value = item.id; option.textContent = `${item.label} (${displayClassId(item.id)})`; return option;
  }));
  document.getElementById('search-new-class-parent-fields').hidden =
    document.getElementById('search-new-class-kind').value !== 'middle';
}
function renderEditForm() {
  fillSelect(childSelect); fillSelect(parentSelect);
  document.getElementById('edit-class-rows').replaceChildren(...classes.map((item) => {
    const row = document.createElement('tr');
    [classKind(item), displayClassId(item.id), item.label].forEach((value) => {
      const cell = document.createElement('td');
      cell.textContent = value;
      row.append(cell);
    });
    return row;
  }));
}
function render() {
  // ツリーの状態は常に更新し、件数の多いタブ内容は表示中だけ作り直す。
  renderTree();
  renderInstances();
  if (!document.getElementById('edit-form-panel').hidden) renderEditForm();
  if (!document.getElementById('target-search-panel').hidden) {
    renderSearchParentOptions();
    renderTargetSearch();
  }
  if (!document.getElementById('class-management-panel').hidden) renderClassManagement();
}
function renderInstances() {
  // 保持中の対象クラスがある場合だけサイドパネルと移動用ボタンを表示する。
  // 解除操作後もこの関数だけを呼べば、件数と表示状態を同期できる。
  const held = document.getElementById('held-instance-list');
  const panel = document.getElementById('held-panel');
  const count = document.getElementById('held-count');
  const kindLabel = document.getElementById('held-kind-label');
  const selectionKind = activeSelectionKind();
  panel.hidden = false;
  if (kindLabel) {
    kindLabel.textContent = selectionKind === 'top' ? '上位クラス保持中'
      : selectionKind === 'middle' ? '中間クラス保持中'
        : selectionKind === 'class' ? 'クラス保持中' : '保持中';
  }
  if (count) count.textContent = `${heldInstances.size + heldMiddleClasses.size + heldTopClasses.size}件`;
  document.querySelectorAll('.move-held-button').forEach((button) => {
    button.hidden = heldInstances.size === 0;
  });
  document.querySelectorAll('.move-held-middle-button').forEach((button) => {
    // 上位・中間・対象クラスのいずれかを保持中なら移動先として表示する。
    button.hidden = heldMiddleClasses.size === 0 && heldTopClasses.size === 0 && heldInstances.size === 0;
  });
  held.replaceChildren(...[...heldInstances.values()].map((instance) => {
    const item = document.createElement('div'); item.className = 'held-instance-item';
    const label = document.createElement('span');
    label.textContent = instance.label || '(ラベルなし)';
    const id = document.createElement('small');
    id.className = 'held-instance-id';
    id.textContent = instance.id.match(/(?:^|\/)((?:c|m|t)_\d+)$/)?.[1] || instance.id;
    item.append(id, label);
    const remove = document.createElement('button'); remove.type = 'button'; remove.textContent = '解除';
    remove.addEventListener('click', () => {
      heldInstances.delete(instance.id);
      targetButtonById.get(instance.id)?.classList.remove('is-selected');
      syncTargetButtonAvailability();
      renderInstances();
    });
    item.append(remove); return item;
  }), ...[...heldMiddleClasses.values()].map((middle) => {
    const item = document.createElement('div'); item.className = 'held-instance-item';
    item.textContent = `中間: ${middle.label}`;
    const remove = document.createElement('button'); remove.type = 'button'; remove.textContent = '解除';
    remove.addEventListener('click', () => {
      heldMiddleClasses.delete(middle.id);
      const checkbox = middleCheckboxById.get(middle.id);
      if (checkbox) checkbox.checked = false;
      syncTargetButtonAvailability();
      renderInstances();
    });
    item.append(remove); return item;
  }), ...[...heldTopClasses.values()].map((top) => {
    const item = document.createElement('div'); item.className = 'held-instance-item';
    item.textContent = `上位: ${top.label}`;
    const remove = document.createElement('button'); remove.type = 'button'; remove.textContent = '解除';
    remove.addEventListener('click', () => {
      heldTopClasses.delete(top.id);
      const checkbox = topCheckboxById.get(top.id);
      if (checkbox) checkbox.checked = false;
      syncTargetButtonAvailability();
      renderInstances();
    });
    item.append(remove); return item;
  }));
  syncTargetButtonAvailability();
}

function activeSelectionKind() {
  if (heldTopClasses.size) return 'top';
  if (heldMiddleClasses.size) return 'middle';
  if (heldInstances.size) return 'class';
  return null;
}

function syncTargetButtonAvailability() {
  const selectionKind = activeSelectionKind();
  targetButtonById.forEach((button) => {
    button.disabled = selectionKind !== null && selectionKind !== 'class';
    button.title = button.disabled ? '上位・中間クラス選択中は対象クラスを選択できません' : '';
  });
  middleCheckboxById.forEach((checkbox) => {
    checkbox.disabled = selectionKind !== null && selectionKind !== 'middle';
  });
  topCheckboxById.forEach((checkbox) => {
    checkbox.disabled = selectionKind !== null && selectionKind !== 'top';
  });
}
// ============================================================
// 階層ツリーの描画とツリー上の編集操作
// ============================================================
let targetConnectorLayoutFrame = 0;
function scheduleTargetConnectorLayout() {
  if (targetConnectorLayoutFrame) return;
  targetConnectorLayoutFrame = requestAnimationFrame(() => {
    targetConnectorLayoutFrame = 0;
    const panel = document.getElementById('edit-tree-panel');
    const lists = [...panel.querySelectorAll('.tree-target-list')];
    const stickySummaries = [...panel.querySelectorAll('.tree-top-class > summary, .tree-middle-class > summary')];
    // 位置・高さを先にまとめて読む。DOM更新後の再計測を避ける。
    const summaryHeights = new Map(stickySummaries.map((summary) => [
      summary,
      summary.getBoundingClientRect().height
    ]));
    const listRows = lists.map((list) => {
      let previousRowTop = Number.NEGATIVE_INFINITY;
      const rowStarts = new Set();
      const items = [...list.children].filter((item) =>
        item.firstElementChild?.classList.contains('tree-leaf-class')
      );
      const positions = items.map((item) => item.getBoundingClientRect().top);
      positions.forEach((rowTop, index) => {
        const isRowStart = Math.abs(rowTop - previousRowTop) > 1;
        if (isRowStart) rowStarts.add(items[index]);
        if (isRowStart) previousRowTop = rowTop;
      });
      return { items, rowStarts };
    });
    const stickyOffsets = [...panel.querySelectorAll('.tree-middle-class')].map((details) => {
      const topClass = details.parentElement?.closest('.tree-top-class');
      let offset = (topClass && summaryHeights.get(topClass.querySelector(':scope > summary'))) || 0;
      offset += 6;
      let ancestor = details.parentElement?.closest('.tree-middle-class');
      while (ancestor) {
        offset += (summaryHeights.get(ancestor.querySelector(':scope > summary')) || 0) + 6;
        ancestor = ancestor.parentElement?.closest('.tree-middle-class');
      }
      return { details, offset };
    });
    // 全ての計測後にまとめて反映する。
    stickyOffsets.forEach(({ details, offset }) => details.style.setProperty('--middle-sticky-top', `${offset}px`));
    listRows.forEach(({ items, rowStarts }) => {
      items.forEach((item) => item.classList.toggle('is-row-start', rowStarts.has(item)));
    });
  });
}
window.addEventListener('resize', scheduleTargetConnectorLayout);

function renderTree() {
  const tree = document.getElementById('edit-tree');
  targetButtonById.clear();
  middleCheckboxById.clear();
  topCheckboxById.clear();

  const filterType = document.getElementById('tree-filter-type').value;
  const filterQuery = document.getElementById('tree-filter-query').value;
  const filterActive = filterQuery.trim().length > 0;
  const { targets: filteredTargets, matchedInstanceCount } = findTargetClasses(filterType, filterQuery);
  const visibleIds = new Set();
  const filterAncestorIds = new Set();
  const filteredTargetIdsByAncestor = new Map();
  if (filterActive) {
    const parentsByChild = new Map();
    data.classData.relations.forEach(({ child, parent }) => {
      if (!parentsByChild.has(child)) parentsByChild.set(child, []);
      parentsByChild.get(child).push(parent);
    });
    filteredTargets.forEach((target) => {
      const pending = [target.id];
      const visitedForTarget = new Set();
      while (pending.length) {
        const id = pending.pop();
        if (visitedForTarget.has(id)) continue;
        visitedForTarget.add(id);
        visibleIds.add(id);
        (parentsByChild.get(id) || []).forEach((parentId) => {
          filterAncestorIds.add(parentId);
          if (!filteredTargetIdsByAncestor.has(parentId)) filteredTargetIdsByAncestor.set(parentId, new Set());
          filteredTargetIdsByAncestor.get(parentId).add(target.id);
          pending.push(parentId);
        });
      }
    });
  }
  const filterCount = document.getElementById('tree-filter-count');
  filterCount.textContent = !filterActive
    ? '検索すると、一致した対象クラスと所属階層だけを表示します。'
    : filterType === 'instance'
      ? `一致インスタンス ${matchedInstanceCount}件に関連する対象クラス ${filteredTargets.length}件を表示中`
      : `一致する対象クラス ${filteredTargets.length}件を表示中`;

  // 関係配列を親IDから子IDへの検索用Mapに変換する。ツリーの描画中に
  // 毎回全クラスを検索せずに済むため、階層が大きくても処理を追いやすい。
  const children = buildChildrenMap();
  // どの関係でも子になっていないクラスをツリーの起点として扱う。
  const childIds = new Set(data.classData.relations.map((relation) => relation.child));
  const rootCandidates = classes.filter((item) => !childIds.has(item.id));
  // 各クラスの配下件数は描画中に一度だけ計算する。
  const countTargets = createTargetCounter(children);
  const addRow = (label, handler, prefix = '＋') => {
    const row = document.createElement('li');
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'tree-add-button tree-add-row';
    button.textContent = `${prefix} ${label}`;
    button.addEventListener('click', handler);
    row.append(button);
    return row;
  };
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
  const moveHeldClassesToTop = (topId) => {
    if (!heldMiddleClasses.size && !heldTopClasses.size && !heldInstances.size) return false;
    const selectedMiddleIds = new Set(heldMiddleClasses.keys());
    const selectedTopIds = new Set(heldTopClasses.keys());
    const selectedTargetIds = new Set(heldInstances.keys());
    if (selectedMiddleIds.has(topId) || selectedTopIds.has(topId)) {
      status.textContent = '移動先として選択中のクラスは指定できません。';
      return true;
    }
    const movingHierarchyIds = new Set([...selectedMiddleIds, ...selectedTopIds]);
    const descendants = new Set(movingHierarchyIds);
    const children = buildChildrenMap();
    const pending = [...movingHierarchyIds];
    while (pending.length) {
      const current = pending.pop();
      (children.get(current) || []).forEach((childId) => {
        if (descendants.has(childId)) return;
        descendants.add(childId);
        pending.push(childId);
      });
    }
    if (descendants.has(topId)) { status.textContent = '選択クラスの配下には移動できません。'; return true; }

    const convertedIds = new Map();
    heldTopClasses.forEach((top) => {
      const oldId = top.id;
      const newId = allocateTemporaryClassId('middle');
      convertedIds.set(oldId, newId);
      classById.delete(oldId);
      top.id = newId;
      top.type = 'middle';
      classById.set(newId, top);
    });
    const movingIds = new Set([...movingHierarchyIds, ...selectedTargetIds]);
    data.classData.relations = data.classData.relations
      .filter((relation) => !movingIds.has(relation.child))
      .map((relation) => ({
        ...relation,
        parent: convertedIds.get(relation.parent) || relation.parent
      }));
    convertedIds.forEach((newId) => addRelation(newId, topId));
    selectedMiddleIds.forEach((middleId) => addRelation(middleId, topId));
    selectedTargetIds.forEach((targetId) => addRelation(targetId, topId));
    const movedCount = selectedMiddleIds.size + selectedTopIds.size + selectedTargetIds.size;
    heldMiddleClasses.clear();
    heldTopClasses.clear();
    heldInstances.clear();
    hasUnsavedChanges = true;
    status.textContent = `${selectedTopIds.size}件の上位クラスを中間クラス化し、合計${movedCount}件を移動しました。`;
    render(); return true;
  };
  const moveHeldToMiddle = (middleId) => {
    // 保持中の対象クラスから既存の親子関係をすべて外し、選択した中間クラスへ
    // 付け替える。移動後は保持状態を空にして、同じ対象を誤って再移動しないようにする。
    if (!heldInstances.size) { status.textContent = '先に対象クラスを選択してください。'; return; }
    const selectedIds = new Set(heldInstances.keys());
    data.classData.relations = data.classData.relations.filter((relation) => !selectedIds.has(relation.child));
    selectedIds.forEach((child) => data.classData.relations.push({ child, parent: middleId, relation: 'subClassOf' }));
    const movedCount = selectedIds.size;
    heldInstances.clear(); hasUnsavedChanges = true;
    status.textContent = `${movedCount}件を中間クラスへ移動しました。`;
    render();
  };
  const moveHeldToTop = (topId) => {
    if (!heldInstances.size) { status.textContent = '先に対象クラスを選択してください。'; return; }
    const selectedIds = new Set(heldInstances.keys());
    data.classData.relations = data.classData.relations.filter((relation) => !selectedIds.has(relation.child));
    selectedIds.forEach((child) => addRelation(child, topId));
    const movedCount = selectedIds.size;
    heldInstances.clear(); hasUnsavedChanges = true;
    status.textContent = `${movedCount}件を上位クラスへ直接移動しました。`;
    render();
  };
  const createFromTree = (type, parentId = null) => {
    const label = window.prompt(`${type === 'middle' ? '中間' : '対象'}クラス名を入力してください`);
    if (!label || !label.trim()) return;
    const item = createClass(type, label);
    if (parentId) addRelation(item.id, parentId);
    if (heldInstances.size) {
      const selectedIds = [...heldInstances.keys()];
      const selectedIdSet = new Set(selectedIds);
      data.classData.relations = data.classData.relations.filter((relation) => !selectedIdSet.has(relation.child));
      if (type === 'middle') {
        selectedIds.forEach((child) => addRelation(child, item.id));
       } else if (type === 'top') {
         selectedIds.forEach((child) => addRelation(child, item.id));
      }
      heldInstances.clear();
      status.textContent = `${item.label}を追加し、保持中の対象クラスを移動しました。`;
    }
    hasUnsavedChanges = true;
    if (!status.textContent.includes('移動しました')) status.textContent = `${item.label}を追加しました。`;
    render();
  };
  const build = (item, middleDepth = classKind(item) === 'middle' ? 1 : 0) => {
    // 対象クラスは選択可能な葉として描画し、上位・中間クラスは details として
    // 描画する。details の初期状態は上位だけを開き、最初の画面を見やすくする。
    if (classKind(item) === 'class') {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'tree-add-button tree-leaf-class';
      button.dataset.instanceId = item.id;
      const selectionKind = activeSelectionKind();
      button.disabled = selectionKind !== null && selectionKind !== 'class';
      button.title = button.disabled ? '上位・中間クラス選択中は対象クラスを選択できません' : '';
      const label = document.createElement('span');
      label.className = 'tree-leaf-label';
      label.textContent = item.label;
      const id = document.createElement('span');
      id.className = 'tree-leaf-id';
      id.textContent = displayClassId(item.id);
      button.append(id, label);
      button.classList.toggle('is-selected', heldInstances.has(item.id));
      targetButtonById.set(item.id, button);
      button.addEventListener('click', () => {
        if (activeSelectionKind() && activeSelectionKind() !== 'class') return;
        // 対象クラスはクリックするたびに保持・解除を切り替える。表示更新は
        // 保持中パネルにも必要なので、選択状態の変更後にrenderInstancesを呼ぶ。
        if (heldInstances.has(item.id)) heldInstances.delete(item.id);
        else heldInstances.set(item.id, item);
        button.classList.toggle('is-selected', heldInstances.has(item.id));
        syncTargetButtonAvailability();
        renderInstances();
        status.textContent = `${heldInstances.size}件の対象クラスを保持中です。`;
      });
      return button;
    }
    const details = document.createElement('details');
    details.className = classKind(item) === 'top' ? 'tree-top-class' : 'tree-middle-class';
    if (classKind(item) === 'middle') {
      // 固定位置は描画後に、親見出しと各階層の実高さから計算する。
      details.style.setProperty('--middle-sticky-z', String(14 + middleDepth));
    }
    details.open = filterActive
      ? filterAncestorIds.has(item.id)
      : classKind(item) === 'top' && item.label !== '未分類';
    const summary = document.createElement('summary');
    const levelContent = document.createElement('div');
    levelContent.className = 'tree-level-content';
    const label = document.createElement('span');
    label.className = 'tree-level-label';
    label.textContent = item.label;
    const count = document.createElement('span');
    count.className = 'count-badge edit-count';
    count.textContent = filterActive
      ? filteredTargetIdsByAncestor.get(item.id)?.size || 0
      : countTargets(item.id);
    const id = document.createElement('span');
    id.className = 'tree-level-id';
    id.textContent = displayClassId(item.id);
    levelContent.append(label, count, id);
    if (classKind(item) === 'middle' && item.label !== '未分類') {
      const checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.checked = heldMiddleClasses.has(item.id);
      checkbox.disabled = activeSelectionKind() !== null && activeSelectionKind() !== 'middle';
      middleCheckboxById.set(item.id, checkbox);
      checkbox.setAttribute('aria-label', `${item.label}を選択`);
      checkbox.addEventListener('click', (event) => event.stopPropagation());
      checkbox.addEventListener('change', () => {
        if (checkbox.checked && (heldTopClasses.size || heldInstances.size)) {
          checkbox.checked = false;
          return;
        }
        if (checkbox.checked) heldMiddleClasses.set(item.id, item);
        else heldMiddleClasses.delete(item.id);
        syncTargetButtonAvailability();
        renderInstances();
      });
      levelContent.prepend(checkbox);
    }
    if (classKind(item) === 'top' && item.label !== '未分類') {
      const checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.checked = heldTopClasses.has(item.id);
      checkbox.disabled = activeSelectionKind() !== null && activeSelectionKind() !== 'top';
      topCheckboxById.set(item.id, checkbox);
      checkbox.setAttribute('aria-label', `${item.label}を中間クラスとして選択`);
      checkbox.addEventListener('click', (event) => event.stopPropagation());
      checkbox.addEventListener('change', () => {
        if (checkbox.checked && (heldMiddleClasses.size || heldInstances.size)) {
          checkbox.checked = false;
          return;
        }
        if (checkbox.checked) heldTopClasses.set(item.id, item);
        else heldTopClasses.delete(item.id);
        syncTargetButtonAvailability();
        renderInstances();
      });
      levelContent.prepend(checkbox);
    }
    summary.append(levelContent);
    if (classKind(item) === 'middle') {
      // 中間クラスの「＋」は、保持中の対象クラスをこの中間クラスへ移動する操作。
      // 対象が未選択のときは renderInstances がボタンを隠す。
      const moveButton = addTreeButton('＋', () => moveHeldToMiddle(item.id));
      moveButton.classList.add('move-held-button');
      moveButton.hidden = heldInstances.size === 0;
      moveButton.setAttribute('aria-label', 'ここへ移動');
      moveButton.title = '保持中の対象クラスをここへ移動';
      summary.append(moveButton);
    }
    if (classKind(item) === 'top') {
      const isUnclassified = item.label === '未分類';
      // 未分類は対象クラスだけを受け入れ、他の上位クラスは保持中クラスを受け入れる。
      const addButton = addTreeButton('＋', () => {
        if (!isUnclassified) moveHeldClassesToTop(item.id);
        else moveHeldToTop(item.id);
      });
      // 中間クラス側の移動ボタンと同じスタイルを適用する。
      addButton.classList.add('move-held-button');
      if (!isUnclassified) addButton.classList.add('move-held-middle-button');
      addButton.hidden = isUnclassified
        ? heldInstances.size === 0
        : heldMiddleClasses.size === 0 && heldTopClasses.size === 0 && heldInstances.size === 0;
      addButton.setAttribute('aria-label', 'ここへ移動');
      addButton.title = isUnclassified
        ? '保持中の対象クラスを未分類へ移動'
        : '保持中のクラスをここへ移動';
      summary.append(addButton);
    }
    details.append(summary);
    let childrenRendered = false;
    const renderChildren = () => {
      if (childrenRendered) return;
      childrenRendered = true;
      const list = document.createElement('ul');
      list.className = 'tree-level-rows';
      const childItems = (children.get(item.id) || [])
        .map((id) => classById.get(id)).filter((child) =>
          child && (!filterActive || visibleIds.has(child.id)));
      const directTargets = childItems.filter((child) => classKind(child) === 'class');
      const childMiddles = childItems.filter((child) => classKind(child) === 'middle');
      const appendChild = (child, parentList, childMiddleDepth) => {
        const li = document.createElement('li');
        li.append(build(child, childMiddleDepth));
        if (classKind(child) === 'class') {
          const infoButton = document.createElement('button');
          infoButton.type = 'button';
          infoButton.className = 'tree-leaf-info-button';
          infoButton.textContent = 'i';
          infoButton.setAttribute('aria-label', `${child.label}に関連するインスタンスを表示`);
          infoButton.title = '関連インスタンスを表示';
          infoButton.addEventListener('click', (event) => {
            event.preventDefault();
            event.stopPropagation();
            showRelatedInstances(child);
          });
          li.append(infoButton);
        }
        parentList.append(li);
      };
      if (classKind(item) === 'middle' && item.label !== '未分類') {
        list.append(addRow('中間クラスを追加', () => createFromTree('middle', item.id)));
      }
      if (classKind(item) === 'top' && item.label !== '未分類') {
        list.append(addRow('中間クラスを追加', () => createFromTree('middle', item.id)));
      }
      if (childMiddles.length) {
        const middleRow = document.createElement('li');
        middleRow.className = 'tree-child-middle-row';
        const middleList = document.createElement('ul');
        middleList.className = 'tree-child-middle-list';
        childMiddles.forEach((child) => appendChild(
          child,
          middleList,
          classKind(item) === 'top' ? 1 : middleDepth + 1
        ));
        middleRow.append(middleList);
        list.append(middleRow);
      }
      if (classKind(item) === 'middle' && directTargets.length) {
        const targetRow = document.createElement('li');
        targetRow.className = 'tree-target-row';
        const targetList = document.createElement('ul');
        targetList.className = 'tree-target-list';
        directTargets.forEach((child) => appendChild(child, targetList));
        targetRow.append(targetList);
        list.append(targetRow);
      }
      if (classKind(item) === 'top' && directTargets.length) {
        // 上位クラス直下の対象クラスは中間クラスを介さず、そのまま表示する。
        const targetRow = document.createElement('li');
        targetRow.className = 'tree-target-row';
        const targetList = document.createElement('ul');
        targetList.className = 'tree-target-list';
        directTargets.forEach((child) => appendChild(child, targetList));
        targetRow.append(targetList);
        list.append(targetRow);
      }
      details.append(list);
      scheduleTargetConnectorLayout();
    };
    details.addEventListener('toggle', () => {
      if (details.open) renderChildren();
    });
    if (details.open) renderChildren();
    return details;
  };
  // 未分類を最上段に固定し、それ以外は配下の対象クラス件数の多い順に並べる。
  const roots = rootCandidates.filter((item) => !filterActive || visibleIds.has(item.id)).sort((a, b) => {
    const aIsUnclassified = classKind(a) === 'top' && a.label === '未分類';
    const bIsUnclassified = classKind(b) === 'top' && b.label === '未分類';
    if (aIsUnclassified !== bIsUnclassified) return aIsUnclassified ? -1 : 1;
    return countTargets(b.id) - countTargets(a.id) || a.label.localeCompare(b.label, 'ja');
  });
  const topRows = roots.map((item) => build(item));
  // 上位クラスの追加は、他の追加操作と区別しやすいよう「追加」と表示する。
  topRows.push(addRow('上位クラス', () => createFromTree('top'), '追加'));
  tree.replaceChildren(...topRows);
  scheduleTargetConnectorLayout();
}
// ============================================================
// TSV出力と保存
// ============================================================
function download(name, lines) {
  // TSVはExcel等でも文字化けしにくいようUTF-8 BOM付きで作り、ブラウザーの
  // 一時的なObject URLを使ってダウンロードを開始する。
  const blob = new Blob([`\ufeff${lines.join('\r\n')}\r\n`], { type: 'text/tab-separated-values;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a'); link.href = url; link.download = name; link.click();
  URL.revokeObjectURL(url);
}
function escapeTsv(value) {
  return String(value ?? '').replace(/\t/g, ' ').replace(/\r?\n/g, ' ');
}
function saveEditChanges() {
  // クラス一覧と関係一覧を別ファイルで保存する。保存成功後だけ未保存フラグを解除し、
  // ブラウザー移動時の警告が出ない状態にする。
  download('class-list.tsv', ['種類\tID\tラベル', ...classes.map((item) => `${escapeTsv(kind(item.id))}\t${escapeTsv(item.id.startsWith('new-') ? '' : item.id)}\t${escapeTsv(item.label)}`)]);
  download('class-relation.tsv', ['子クラスID\t親クラスID', ...data.classData.relations.map((item) => `${escapeTsv(item.child)}\t${escapeTsv(item.parent)}`)]);
  status.textContent = '編集内容を保存しました。';
  hasUnsavedChanges = false;
}
// ============================================================
// 編集操作のイベント登録
// ============================================================
// 保存・保持状態の操作
document.getElementById('save-edit-changes').addEventListener('click', saveEditChanges);
document.getElementById('clear-held').addEventListener('click', () => {
  heldInstances.forEach((instance) => targetButtonById.get(instance.id)?.classList.remove('is-selected'));
  heldMiddleClasses.forEach((middle) => {
    const checkbox = middleCheckboxById.get(middle.id);
    if (checkbox) checkbox.checked = false;
  });
  heldTopClasses.forEach((top) => {
    const checkbox = topCheckboxById.get(top.id);
    if (checkbox) checkbox.checked = false;
  });
  heldInstances.clear();
  heldMiddleClasses.clear();
  heldTopClasses.clear();
  syncTargetButtonAvailability();
  renderInstances();
  status.textContent = '保持中のクラスをすべて解除しました。';
});
document.getElementById('move-held-unclassified').addEventListener('click', () => {
  if (!heldInstances.size) return;
  const selected = [...heldInstances.keys()];
  const parentMap = new Map();
  data.classData.relations.forEach((relation) => parentMap.set(relation.child, relation.parent));
  const topByChild = (child) => {
    const seen = new Set(); let current = child;
    while (current && !seen.has(current)) {
      seen.add(current);
      if (kind(current) === 'top') return current;
      current = parentMap.get(current);
    }
    return null;
  };
  const topIds = new Set(selected.map(topByChild).filter(Boolean));
  const selectedTopMap = new Map(selected.map((child) => [child, topByChild(child)]));
  const selectedIds = new Set(selected);
  data.classData.relations = data.classData.relations.filter((relation) => !selectedIds.has(relation.child));
  topIds.forEach((topId) => {
    selected.filter((child) => selectedTopMap.get(child) === topId)
      .forEach((child) => addRelation(child, topId));
  });
  heldInstances.clear(); hasUnsavedChanges = true; status.textContent = `${selected.length}件を上位クラスへ直接移動しました。`; render();
});
document.getElementById('add-class').addEventListener('click', () => {
  // フォームからの追加は、ツリーからの追加と同じ createClass を使うことで
  // ID採番と配列への登録方法を統一する。
  const type = document.getElementById('new-class-type').value;
  const label = document.getElementById('new-class-label').value.trim();
  if (!label) return;
  createClass(type, label);
  document.getElementById('new-class-label').value = '';
  hasUnsavedChanges = true;
  status.textContent = `${label}を追加しました。`;
  render();
});
document.getElementById('apply-parent-change').addEventListener('click', () => {
  // 親を変更する際は現在の関係配列を使う。初期配列を保持したままにすると、
  // 複数回の変更で直前の編集内容を上書きしてしまう。
  if (childSelect.value === parentSelect.value) return;
  const descendants = descendantIds(childSelect.value);
  descendants.add(childSelect.value);
  if (descendants.has(parentSelect.value)) { status.textContent = '循環する親子関係は設定できません。'; return; }
  data.classData.relations = data.classData.relations.filter((item) => item.child !== childSelect.value);
  addRelation(childSelect.value, parentSelect.value);
  hasUnsavedChanges = true;
  status.textContent = '親クラスを変更しました。';
});
document.getElementById('tree-filter-type').addEventListener('change', () => {
  document.getElementById('tree-filter-query').placeholder =
    document.getElementById('tree-filter-type').value === 'instance'
      ? 'インスタンス名・IDを入力'
      : '対象クラス名・IDを入力';
  renderTree();
});
document.getElementById('tree-filter-query').addEventListener('input', renderTree);
// 検索結果を使った一括付与・クラス作成
document.getElementById('target-search-type').addEventListener('change', () => {
  // 検索対象を切り替えたら、別の検索条件で選んだクラスを持ち越さない。
  searchSelected.clear();
  document.getElementById('search-new-class-label').value = '';
  document.getElementById('target-class-search').placeholder =
    document.getElementById('target-search-type').value === 'instance'
      ? 'インスタンス名・IDを入力'
      : '対象クラス名・IDを入力';
  renderTargetSearch();
});
document.getElementById('target-class-search').addEventListener('input', () => {
  // 検索語を変えたら、前回の検索で保持した対象やクラス名を次の付与へ持ち越さない。
  searchSelected.clear();
  document.getElementById('search-new-class-label').value = '';
  renderTargetSearch();
});
document.getElementById('search-target-kind').addEventListener('change', render);
document.getElementById('search-new-class-parent-kind').addEventListener('change', render);
document.getElementById('search-new-class-kind').addEventListener('change', render);
document.getElementById('search-apply-mode').addEventListener('change', () => {
  const creating = document.getElementById('search-apply-mode').value === 'create';
  document.getElementById('search-existing-fields').hidden = creating;
  document.getElementById('search-create-fields').hidden = !creating;
  document.getElementById('apply-search-selection').textContent = creating
    ? '作成して付与'
    : '既存クラスへ付与';
});
document.getElementById('select-search-results').addEventListener('click', () => {
  document.querySelectorAll('#target-search-results input[type="checkbox"]').forEach((checkbox) => {
    checkbox.checked = true;
    const option = classById.get(checkbox.dataset.classId);
    if (option) searchSelected.set(option.id, option);
  });
  renderTargetSearch();
});
document.getElementById('clear-search-selection').addEventListener('click', () => { searchSelected.clear(); renderTargetSearch(); });
document.getElementById('apply-search-selection').addEventListener('click', () => {
  if (searchSelected.size === 0) {
    status.textContent = '対象クラスを1件以上選択してください。';
    return;
  }
  const selectedIds = [...searchSelected.keys()];
  const selectedIdSet = new Set(selectedIds);
  const creating = document.getElementById('search-apply-mode').value === 'create';
  if (!creating) {
    const parentId = document.getElementById('search-target-parent').value;
    if (!parentId) { status.textContent = '付与先のクラスを選択してください。'; return; }
    data.classData.relations = data.classData.relations.filter((relation) => !selectedIdSet.has(relation.child));
    selectedIds.forEach((id) => addRelation(id, parentId));
    const parentKind = document.getElementById('search-target-kind').value;
    status.textContent = `${selectedIds.length}件を${parentKind === 'top' ? '上位' : '中間'}クラスへ付与しました。`;
  } else {
    const label = document.getElementById('search-new-class-label').value.trim();
    if (!label) { status.textContent = '新しいクラス名を入力してください。'; return; }
    const newKind = document.getElementById('search-new-class-kind').value;
    if (classes.some((item) => classKind(item) === newKind && item.label === label)) {
      status.textContent = `同じ種類・名称のクラス「${label}」が既に存在します。`;
      return;
    }
    const parentId = newKind === 'middle' ? document.getElementById('search-new-class-parent').value : '';
    if (newKind === 'middle' && !parentId) { status.textContent = '新しい中間クラスの親を選択してください。'; return; }
    const item = createClass(newKind, label);
    if (parentId) addRelation(item.id, parentId);
    data.classData.relations = data.classData.relations.filter((relation) => !selectedIdSet.has(relation.child));
    selectedIds.forEach((id) => addRelation(id, item.id));
    status.textContent = `${selectedIds.length}件を「${label}」へ付与しました。`;
    document.getElementById('search-new-class-label').value = '';
  }
  searchSelected.clear();
  document.getElementById('target-class-search').value = '';
  hasUnsavedChanges = true;
  render();
});
document.getElementById('download-class-list').addEventListener('click', () => download('class-list.tsv', ['種類\tID\tラベル', ...classes.map((item) => `${escapeTsv(kind(item.id))}\t${escapeTsv(item.id.startsWith('new-') ? '' : item.id)}\t${escapeTsv(item.label)}`)]));
document.getElementById('download-relation').addEventListener('click', () => download('class-relation.tsv', ['子クラスID\t親クラスID', ...data.classData.relations.map((item) => `${escapeTsv(item.child)}\t${escapeTsv(item.parent)}`)]));
// 初期表示
render();

// ============================================================
// 画面遷移時の未保存確認

document.getElementById('browse-link').addEventListener('click', (event) => {
  // 閲覧画面へ移動すると編集途中のメモリ上データは失われるため、
  // 保存されていない変更がある場合だけ確認を求める。
  if (hasUnsavedChanges && !window.confirm('保存していない編集内容があります。保存せずに閲覧画面へ移動しますか？')) {
    event.preventDefault();
  }
});
window.addEventListener('beforeunload', (event) => {
  // タブを閉じる、更新するなどの離脱でも同じ確認を表示する。
  if (!hasUnsavedChanges) return;
  event.preventDefault();
  event.returnValue = '';
});

// ============================================================
// タブ切り替えと画面初期化
// ============================================================
// 検索・管理機能はツリー／フォームから独立したタブとして表示する。
// HTML上の既存配置をここで移動することで、初期表示時の構造も保ちつつ
// 旧画面との互換性を確保する。
const tabBar = document.querySelector('.tabs');
const main = document.querySelector('main');
const treePanel = document.getElementById('edit-tree-panel');
const searchPanel = document.getElementById('target-search-panel');
const managementPanel = document.getElementById('class-management-panel');
if (searchPanel) { searchPanel.remove(); main.insertBefore(searchPanel, treePanel); }
if (managementPanel) { managementPanel.remove(); main.insertBefore(managementPanel, treePanel); }

document.querySelectorAll('[data-edit-tab]').forEach((tab) => tab.addEventListener('click', () => {
  // 編集ツリーと編集フォームは同じページ内で切り替える。選択中タブの
  // aria-selected と panel の hidden を同時に更新し、見た目と読み上げ状態を揃える。
  document.querySelectorAll('[data-edit-tab]').forEach((item) => {
    const active = item === tab;
    item.classList.toggle('is-active', active);
    item.setAttribute('aria-selected', active ? 'true' : 'false');
  });
  document.querySelectorAll('#edit-form-panel, #edit-tree-panel, #target-search-panel, #class-management-panel').forEach((panel) => {
    panel.hidden = panel.id !== tab.dataset.editTab;
  });
  if (tab.dataset.editTab === 'edit-form-panel') renderEditForm();
  if (tab.dataset.editTab === 'target-search-panel') {
    renderSearchParentOptions();
    renderTargetSearch();
  }
  if (tab.dataset.editTab === 'class-management-panel') renderClassManagement();
}));
document.querySelectorAll('[data-management-kind]').forEach((tab) => tab.addEventListener('click', () => {
  managementKind = tab.dataset.managementKind;
  document.querySelectorAll('[data-management-kind]').forEach((item) => item.classList.toggle('is-active', item === tab));
  renderClassManagement();
}));

const loadingIndicator = document.getElementById('loading-indicator');
if (loadingIndicator) loadingIndicator.hidden = true;
