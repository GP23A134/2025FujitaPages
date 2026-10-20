// ============================================================
// 編集画面の状態と共有データ
// ============================================================
// クラスデータJavaScriptが読み込んだ編集対象データを共有する。classes は同じ配列を参照するため、
// ここへ追加したクラスは保存処理とツリー表示の両方にそのまま反映される。
const data = window.appData;
// 編集用の配列を元データから複製し、保存前の変更が読み込み元へ混ざらないようにする。
data.classData.classes = [
  ...(data.classData.classes || []),
  ...(data.targetClassData?.classes || [])
].map((item) => ({ ...item }));
data.classData.relations = data.classData.relations.map((relation) => ({ ...relation }));
const classes = data.classData.classes;
// 検索語を空白で分割して判定する。AND検索へ変更する場合は 'AND' にする。
const TARGET_SEARCH_MATCH_MODE = 'OR';
function logEditAction(message, level = 'info') {
  console[level](`[付与検索] ${message}`);
}
const toggleEditIds = document.getElementById('toggle-edit-ids');
if (toggleEditIds) {
  const setEditIdsVisible = (visible) => {
    document.body.classList.toggle('edit-show-ids', visible);
    toggleEditIds.setAttribute('aria-pressed', visible ? 'true' : 'false');
    toggleEditIds.textContent = `クラスID表示: ${visible ? 'ON' : 'OFF'}`;
  };
  setEditIdsVisible(false);
  toggleEditIds.addEventListener('click', () => {
    setEditIdsVisible(!document.body.classList.contains('edit-show-ids'));
  });
}
const toggleEditPanesPin = document.getElementById('toggle-edit-panes-pin');
let pinnedHeldPanelBoundsFrame = 0;
const syncPinnedHeldPanelBounds = () => {
  if (pinnedHeldPanelBoundsFrame) return;
  pinnedHeldPanelBoundsFrame = window.requestAnimationFrame(() => {
    pinnedHeldPanelBoundsFrame = 0;
    const panel = document.getElementById('held-panel');
    const layout = document.querySelector('#edit-tree-panel .edit-tree-layout');
    if (!panel) return;
    if (!document.body.classList.contains('edit-panes-pinned') || !layout || document.getElementById('edit-tree-panel')?.hidden || panel.hidden || window.innerWidth <= 760) {
      panel.style.removeProperty('top');
      panel.style.removeProperty('height');
      panel.style.removeProperty('max-height');
      panel.style.removeProperty('visibility');
      return;
    }
    const layoutBounds = layout.getBoundingClientRect();
    const toolbarBounds = document.querySelector('.edit-taskbar')?.getBoundingClientRect();
    const top = Math.max(layoutBounds.top, (toolbarBounds?.bottom ?? 0) + 8);
    const bottom = Math.min(layoutBounds.bottom, window.innerHeight - 8);
    if (bottom <= top) {
      panel.style.visibility = 'hidden';
      return;
    }
    panel.style.visibility = 'visible';
    panel.style.top = `${top}px`;
    const availableHeight = bottom - top;
    const desiredHeight = panel.classList.contains('is-collapsed')
      ? Number.parseFloat(getComputedStyle(panel).getPropertyValue('--held-collapsed-height')) || panel.scrollHeight
      : window.innerHeight - top - 8;
    panel.style.height = `${Math.min(availableHeight, desiredHeight)}px`;
    panel.style.maxHeight = `${availableHeight}px`;
  });
};
if (toggleEditPanesPin) {
  const setEditPanesPinned = (pinned) => {
    document.body.classList.toggle('edit-panes-pinned', pinned);
    toggleEditPanesPin.setAttribute('aria-pressed', pinned ? 'true' : 'false');
    toggleEditPanesPin.textContent = `検索・保持欄固定: ${pinned ? 'ON' : 'OFF'}`;
    syncPinnedHeldPanelBounds();
  };
  setEditPanesPinned(false);
  toggleEditPanesPin.addEventListener('click', () => {
    setEditPanesPinned(!document.body.classList.contains('edit-panes-pinned'));
  });
}
// ツリー上で選択したクラスを一時的に保持する。Map にすることで、
// 同じクラスの重複選択を防ぎながら、IDを使った移動処理を行える。
const heldInstances = new Map();
const heldMiddleClasses = new Map();
const heldTopClasses = new Map();
const instancesByTargetClassId = new Map();
const instancesById = new Map((data.instanceData?.instances || []).map((instance) => [instance.id, instance]));
(data.instanceClassData.relations || []).forEach((relation) => {
  const instance = instancesById.get(relation.instance);
  if (!instance) return;
  if (!instancesByTargetClassId.has(relation.class)) instancesByTargetClassId.set(relation.class, []);
  instancesByTargetClassId.get(relation.class).push(instance);
});
const instanceIdsByTargetClassId = new Map();
(data.instanceClassData.relations || []).forEach((relation) => {
  if (!instancesById.has(relation.instance)) return;
  if (!instanceIdsByTargetClassId.has(relation.class)) instanceIdsByTargetClassId.set(relation.class, new Set());
  instanceIdsByTargetClassId.get(relation.class).add(relation.instance);
});
const countTargetInstances = (classId) => instanceIdsByTargetClassId.get(classId)?.size || 0;
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
let currentTargetSearchResults = [];
let hasUnsavedChanges = false;
let managementKind = 'top';
let searchDestinationId = '';
let heldPanelView = 'held';
let heldPanelCollapsed = false;
let heldDestinationKind = 'top';
let heldDestinationId = '';
let recentHeldDestinationIds = [];
let targetSearchRenderSequence = 0;
let targetSearchHasRendered = false;
let targetSearchOptionsPrepared = false;
let targetSearchQuery = [];

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
// クラスは失わず、上位クラス「未分類」へ直接付け替える。
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
const editUndoStack = [];
const editRedoStack = [];
const EDIT_HISTORY_LIMIT = 100;
function snapshotEditState() {
  const state = {
    classes: classes.map((item) => ({ ...item })),
    relations: data.classData.relations.map((relation) => ({ ...relation }))
  };
  return { ...state, fingerprint: JSON.stringify(state), recentDestinations: [...recentHeldDestinationIds] };
}
function recordEditHistory(before, destinationId = '', actionLabel = '編集') {
  const recentDestinationsBefore = [...recentHeldDestinationIds];
  if (destinationId && classById.has(destinationId)) {
    recentHeldDestinationIds = [destinationId, ...recentHeldDestinationIds.filter((id) => id !== destinationId)].slice(0, 5);
  }
  before.recentDestinations = recentDestinationsBefore;
  editUndoStack.push({ before, after: snapshotEditState(), actionLabel });
  if (editUndoStack.length > EDIT_HISTORY_LIMIT) editUndoStack.shift();
  editRedoStack.length = 0;
}
function restoreEditState(snapshot) {
  const currentHeldInstances = [...heldInstances.entries()];
  const currentHeldMiddleIds = [...heldMiddleClasses.keys()];
  const currentHeldTopIds = [...heldTopClasses.keys()];
  classes.splice(0, classes.length, ...snapshot.classes.map((item) => ({ ...item })));
  data.classData.relations = snapshot.relations.map((relation) => ({ ...relation }));
  classById.clear();
  classes.forEach((item) => classById.set(item.id, item));
  heldInstances.clear();
  currentHeldInstances.forEach(([id, instance]) => heldInstances.set(id, instance));
  heldMiddleClasses.clear();
  currentHeldMiddleIds.forEach((id) => {
    const item = classById.get(id);
    if (item && classKind(item) === 'middle') heldMiddleClasses.set(id, item);
  });
  heldTopClasses.clear();
  currentHeldTopIds.forEach((id) => {
    const item = classById.get(id);
    if (item && classKind(item) === 'top') heldTopClasses.set(id, item);
  });
  if (heldDestinationId && !classById.has(heldDestinationId)) heldDestinationId = '';
  recentHeldDestinationIds = [...(snapshot.recentDestinations || [])];
  hasUnsavedChanges = true;
}
function undoLastEdit() {
  const edit = editUndoStack.at(-1);
  if (!edit) return;
  if (snapshotEditState().fingerprint !== edit.after.fingerprint) {
    editUndoStack.length = 0;
    editRedoStack.length = 0;
    render();
    logEditAction('履歴と現在の編集状態が一致しないため、履歴をクリアしました。', 'warn');
    return;
  }
  editUndoStack.pop();
  restoreEditState(edit.before);
  editRedoStack.push(edit);
  logEditAction(`「${edit.actionLabel}」を元に戻しました。`);
  render();
}
function redoLastEdit() {
  const edit = editRedoStack.at(-1);
  if (!edit) return;
  if (snapshotEditState().fingerprint !== edit.before.fingerprint) {
    editUndoStack.length = 0;
    editRedoStack.length = 0;
    render();
    logEditAction('履歴と現在の編集状態が一致しないため、履歴をクリアしました。', 'warn');
    return;
  }
  editRedoStack.pop();
  restoreEditState(edit.after);
  editUndoStack.push(edit);
  logEditAction(`「${edit.actionLabel}」をやり直しました。`);
  render();
}

// ============================================================
// クラス・ID・親子関係の基本操作
// ============================================================
// IDの命名規則からクラスの階層を判定する。new- で始まる編集中のIDも、
// 保存前から通常の上位・中間・クラスと同じように扱う。
function kind(id) {
  const segment = String(id).split('/').pop();
  if (/^(?:new-)?t[_-]/.test(segment)) return 'top';
  if (/^(?:new-)?m[_-]/.test(segment)) return 'middle';
  return 'class';
}

function classKind(item) {
  return item.type || kind(item.id);
}

function hasClassLabelConflict(type, label, excludedId = null) {
  const normalizedLabel = label.trim();
  return classes.some((item) => item.id !== excludedId
    && classKind(item) === type
    && String(item.label ?? '').trim() === normalizedLabel);
}

function classLabelConflictMessage(type, label) {
  const typeLabel = type === 'top' ? '上位' : '中間';
  return `同じ種類の「${typeLabel}クラス」に「${label}」は既にあります。別の名前を入力してください。`;
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
  if (hasClassLabelConflict(type, normalizedLabel)) {
    logEditAction(classLabelConflictMessage(type, normalizedLabel), 'warn');
    return null;
  }
  if (type === 'top' && normalizedLabel === '未分類' && !classes.some((item) => item.id === 't_0')) {
    const item = { id: 't_0', label: normalizedLabel, type };
    classes.push(item);
    classById.set(item.id, item);
    return item;
  }
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
  // 「未分類」は上位クラスとして扱い、クラスを直接ぶら下げる。
  // 中間クラスを作らないことで、ツリー上でも未分類の対象を直接確認できる。
  let top = classes.find((item) => classKind(item) === 'top' && item.label === '未分類');
  if (!top) {
    const id = classes.some((item) => item.id === 't_0') ? allocateTemporaryClassId('top') : 't_0';
    top = { id, label: '未分類', type: 'top' };
    classes.push(top);
    classById.set(id, top);
  }
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
function findTargetClasses(searchType, query, searchOptions) {
  return window.findTargetMatches(data, searchType, query, TARGET_SEARCH_MATCH_MODE, searchOptions);
}

function renderTargetSearchKeywordChips() {
  const container = document.getElementById('target-search-keyword-chip');
  container.replaceChildren(...targetSearchQuery.map((term, index) => {
    const chip = document.createElement('button');
    chip.type = 'button';
    chip.className = 'search-hierarchy-selected-button';
    chip.textContent = term;
    chip.setAttribute('aria-label', `検索ワード「${term}」を解除`);
    chip.title = 'クリックして検索ワードを解除';
    chip.addEventListener('click', () => {
      targetSearchQuery.splice(index, 1);
      renderTargetSearchKeywordChips();
      searchSelected.clear();
      renderSearchParentOptions();
      renderTargetSearch();
    });
    return chip;
  }));
}

function renderTargetSearch() {
  const input = document.getElementById('target-class-search');
  const searchType = document.getElementById('target-search-type').value;
  const query = targetSearchQuery;
  const result = document.getElementById('target-search-results');
  const count = document.getElementById('target-search-count');
  const loading = document.getElementById('target-search-loading');
  const getFilterIds = (listId) => new Set([...document.querySelectorAll(`#${listId} input[type="checkbox"]:checked`)].map((input) => input.value));
  const topIds = getFilterIds('search-filter-top-list');
  const middleIds = getFilterIds('search-filter-middle-list');
  const sequence = ++targetSearchRenderSequence;
  const showInitialProgress = !targetSearchHasRendered;
  if (showInitialProgress) {
    loading.hidden = false;
    loading.textContent = '検索中…';
  } else {
    loading.hidden = true;
  }
  count.textContent = '';
  result.replaceChildren();

  window.setTimeout(() => {
    if (sequence !== targetSearchRenderSequence) return;
  const { targets: matchedTargets, matchedInstanceCount } = findTargetClasses(searchType, query);
  // 上位・中間クラスの絞り込みと、結果行の所属表示に使う親クラス表を作る。
  const parentsByClassId = new Map();
  data.classData.relations.forEach((relation) => {
    if (!parentsByClassId.has(relation.child)) parentsByClassId.set(relation.child, []);
    const parent = classById.get(relation.parent);
    if (parent) parentsByClassId.get(relation.child).push(parent);
  });
  const hasAncestor = (classId, ancestorId) => {
    const pending = [...(parentsByClassId.get(classId) || [])].map((parent) => parent.id);
    const visited = new Set();
    while (pending.length) {
      const current = pending.pop();
      if (current === ancestorId) return true;
      if (visited.has(current)) continue;
      visited.add(current);
      (parentsByClassId.get(current) || []).forEach((parent) => pending.push(parent.id));
    }
    return false;
  };
  const targets = matchedTargets.filter((item) =>
    (!topIds.size || [...topIds].some((id) => hasAncestor(item.id, id)))
    && (!middleIds.size || [...middleIds].some((id) => hasAncestor(item.id, id))));
  currentTargetSearchResults = targets;
  const renderCountSummary = () => {
    const stats = searchType === 'instance'
      ? [['一致インスタンス', matchedInstanceCount], ['表示クラス', targets.length], ['選択中', searchSelected.size]]
      : [['表示件数', targets.length], ['選択中', searchSelected.size]];
    count.replaceChildren(...stats.map(([label, value]) => {
      const stat = document.createElement('span');
      stat.className = `search-count-stat${label === '選択中' && value ? ' is-selected' : ''}`;
      if (label === '一致インスタンス') stat.classList.add('is-instance');
      const name = document.createElement('span'); name.className = 'search-count-label'; name.textContent = label;
      const number = document.createElement('strong'); number.className = 'search-count-value'; number.textContent = `${value}件`;
      stat.append(name, number);
      return stat;
    }));
  };
  const makeResultRow = (item) => {
    const row = document.createElement('div'); row.className = 'target-search-result-option';
    const label = document.createElement('label'); label.className = 'target-search-option';
    const checkbox = document.createElement('input'); checkbox.type = 'checkbox'; checkbox.checked = searchSelected.has(item.id); checkbox.dataset.classId = item.id;
    checkbox.addEventListener('change', () => {
      if (checkbox.checked) searchSelected.set(item.id, item);
      else searchSelected.delete(item.id);
      renderCountSummary();
    });
    const content = document.createElement('span'); content.className = 'target-search-option-content';
    const parentText = document.createElement('span'); parentText.className = 'target-search-parent';
    const parents = parentsByClassId.get(item.id) || [];
    if (parents.length) {
      parentText.replaceChildren(...parents.map((parent) => {
        const badge = document.createElement('span');
        const parentKind = classKind(parent);
        badge.className = `target-search-parent-badge ${parentKind === 'top' ? 'is-top' : 'is-middle'}`;
        badge.textContent = `${parentKind === 'top' ? '上位' : '中間'}: ${parent.label} (${displayClassId(parent.id)})`;
        return badge;
      }));
    } else {
      parentText.textContent = '所属なし';
    }
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
  };
  if (!targets.length) {
    const empty = document.createElement('p');
    empty.className = 'target-search-empty';
    empty.textContent = '一致するクラスはありません。';
    result.append(empty);
    loading.hidden = true;
    targetSearchHasRendered = true;
    renderCountSummary();
    return;
  }

  let rendered = 0;
  const renderBatch = () => {
    if (sequence !== targetSearchRenderSequence) return;
    const fragment = document.createDocumentFragment();
    const end = Math.min(rendered + 160, targets.length);
    for (; rendered < end; rendered += 1) fragment.append(makeResultRow(targets[rendered]));
    result.append(fragment);
    if (rendered < targets.length) {
      if (showInitialProgress) loading.textContent = `検索結果を表示中… ${rendered} / ${targets.length}件`;
      window.setTimeout(renderBatch, 0);
      return;
    }
    loading.hidden = true;
    targetSearchHasRendered = true;
    renderCountSummary();
  };
  if (showInitialProgress) loading.textContent = `検索結果を表示中… 0 / ${targets.length}件`;
  window.setTimeout(renderBatch, 0);
  }, 0);
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
      if (hasClassLabelConflict(classKind(item), nextLabel, item.id)) {
        logEditAction(classLabelConflictMessage(classKind(item), nextLabel.trim()), 'warn');
        return;
      }
      const undoBefore = snapshotEditState();
      item.label = nextLabel.trim(); hasUnsavedChanges = true;
      recordEditHistory(undoBefore, '', '名称変更');
      logEditAction(`クラス名を「${item.label}」に変更しました。`); render();
    });
    const button = document.createElement('button'); button.type = 'button'; button.className = 'delete-class-button'; button.textContent = '削除';
    button.disabled = item.label === '未分類';
    button.addEventListener('click', () => {
      if (!window.confirm(`「${item.label}」を削除しますか？所属するクラスは未分類へ移動します。`)) return;
      const undoBefore = snapshotEditState();
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
      recordEditHistory(undoBefore, '', '削除');
      logEditAction(`${item.label}を削除しました。${moved}件を未分類へ移動しました。`); render();
    });
    actions.append(rename, button); row.append(info, actions); return row;
  }));
}

// ============================================================
// フォーム・一覧・保持中パネルの描画
// ============================================================
function renderSearchParentOptions() {
  const searchTargetKind = document.getElementById('search-target-kind');
  const searchParent = document.getElementById('search-target-parent');
  const selectedKind = searchTargetKind.value;
  searchTargetKind.parentElement.firstChild.textContent = selectedKind === 'top' ? '付与先の上位クラス' : '付与先の中間クラス';
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
  // 検索語に一致したクラスだけを親階層の一覧・件数へ反映する。
  const matchedTargets = findTargetClasses(
    document.getElementById('target-search-type').value,
    targetSearchQuery
  ).targets;
  const parentsById = new Map();
  data.classData.relations.forEach(({ child, parent }) => {
    if (!parentsById.has(child)) parentsById.set(child, []);
    parentsById.get(child).push(parent);
  });
  const matchingCounts = new Map();
  matchedTargets.forEach(({ id }) => {
    const pending = [...(parentsById.get(id) || [])];
    const visited = new Set();
    while (pending.length) {
      const parentId = pending.pop();
      if (visited.has(parentId)) continue;
      visited.add(parentId);
      matchingCounts.set(parentId, (matchingCounts.get(parentId) || 0) + 1);
      pending.push(...(parentsById.get(parentId) || []));
    }
  });
  const renderSelectedHierarchyClasses = () => {
    const selected = document.getElementById('search-hierarchy-selected-classes');
    const selectedItems = [
      { listId: 'search-filter-top-list', toggleId: 'search-filter-top-toggle', label: '上位' },
      { listId: 'search-filter-middle-list', toggleId: 'search-filter-middle-toggle', label: '中間' }
    ].flatMap(({ listId, toggleId, label }) => {
      const list = document.getElementById(listId);
      const toggle = document.getElementById(toggleId);
      return [...list.querySelectorAll('input[type="checkbox"]:checked')].map((checkbox) => ({
        item: classById.get(checkbox.value), checkbox, list, toggle, label
      }));
    }).filter(({ item }) => item);
    selected.replaceChildren(...selectedItems.map(({ item, checkbox, list, toggle, label }) => {
      const chip = document.createElement('button'); chip.type = 'button';
      chip.className = `search-hierarchy-selected-button ${label === '上位' ? 'is-top' : 'is-middle'}`;
      chip.textContent = `${label}: ${item.label}`;
      chip.setAttribute('aria-label', `${label}クラス「${item.label}」の選択を解除`);
      chip.title = 'クリックして選択解除';
      chip.addEventListener('click', () => {
        checkbox.checked = false;
        updateFilterToggleLabel(toggle, list, `${label}クラス`);
        renderSelectedHierarchyClasses();
        renderTargetSearch();
      });
      return chip;
    }));
  };
  const fillHierarchyFilter = (listId, toggleId, kindName, label) => {
    const list = document.getElementById(listId);
    const toggle = document.getElementById(toggleId);
    const selectedIds = new Set([...list.querySelectorAll('input[type="checkbox"]:checked')].map((input) => input.value));
    const options = classes.filter((item) => classKind(item) === kindName && (matchingCounts.get(item.id) || 0) > 0).map((item) => {
      const row = document.createElement('label'); row.className = 'search-hierarchy-filter-option';
      const checkbox = document.createElement('input'); checkbox.type = 'checkbox'; checkbox.value = item.id; checkbox.checked = selectedIds.has(item.id);
      checkbox.addEventListener('change', () => {
        updateFilterToggleLabel(toggle, list, label);
        renderSelectedHierarchyClasses();
        renderTargetSearch();
      });
      const name = document.createElement('span'); name.className = 'search-hierarchy-filter-option-name';
      name.textContent = `${item.label} (${displayClassId(item.id)})`;
      const count = document.createElement('span'); count.className = 'search-hierarchy-filter-option-count';
      count.textContent = `${matchingCounts.get(item.id) || 0}件`;
      row.append(checkbox, name, count);
      return row;
    });
    list.replaceChildren(...options);
    updateFilterToggleLabel(toggle, list, label);
  };
  fillHierarchyFilter('search-filter-top-list', 'search-filter-top-toggle', 'top', '上位クラス');
  fillHierarchyFilter('search-filter-middle-list', 'search-filter-middle-toggle', 'middle', '中間クラス');
  renderSelectedHierarchyClasses();
}

function updateFilterToggleLabel(toggle, list, label) {
  const selectedCount = list.querySelectorAll('input[type="checkbox"]:checked').length;
  toggle.textContent = selectedCount ? `${label}（${selectedCount}件選択中）` : `${label}を選択`;
}
function renderEditForm() {
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
  // 保持中のクラスがある場合だけサイドパネルと移動用ボタンを表示する。
  // 解除操作後もこの関数だけを呼べば、件数と表示状態を同期できる。
  const held = document.getElementById('held-instance-list');
  const panel = document.getElementById('held-panel');
  const count = document.getElementById('held-count');
  const kindLabel = document.getElementById('held-kind-label');
  const selectionKind = activeSelectionKind();
  panel.hidden = false;
  const heldListView = document.getElementById('held-list-view');
  const destinationPicker = document.getElementById('held-destination-picker');
  const destinationList = document.getElementById('held-destination-list');
  const destinationSearch = document.getElementById('held-destination-search');
  const recentSection = document.getElementById('held-destination-recent');
  const recentList = document.getElementById('held-destination-recent-list');
  const applyDestination = document.getElementById('apply-held-destination');
  const viewToggle = document.getElementById('toggle-held-panel-view');
  const collapseToggle = document.getElementById('toggle-held-panel-collapse');
  const undoButton = document.getElementById('undo-edit');
  const redoButton = document.getElementById('redo-edit');
  const undoEntry = editUndoStack.at(-1);
  const redoEntry = editRedoStack.at(-1);
  undoButton.disabled = !undoEntry;
  undoButton.title = undoEntry ? `元に戻す: ${undoEntry.actionLabel}` : '元に戻す履歴はありません';
  redoButton.disabled = !redoEntry;
  redoButton.title = redoEntry ? `やり直す: ${redoEntry.actionLabel}` : 'やり直す履歴はありません';
  const hasHeldItems = heldInstances.size + heldMiddleClasses.size + heldTopClasses.size > 0;
  const treeFilterIsOpen = document.querySelector('.tree-filter')?.open === true;
  const showHeldList = heldPanelView === 'held'
    && (!heldPanelCollapsed || (treeFilterIsOpen && hasHeldItems));
  heldListView.hidden = !showHeldList;
  destinationPicker.hidden = heldPanelCollapsed || heldPanelView !== 'list';
  panel.classList.toggle('is-collapsed', heldPanelCollapsed);
  collapseToggle.setAttribute('aria-expanded', heldPanelCollapsed ? 'false' : 'true');
  collapseToggle.title = heldPanelCollapsed ? '保持中欄を展開' : '保持中欄を折りたたむ';
  document.querySelectorAll('.held-destination-tab').forEach((tab) => {
    const isActive = tab.dataset.destinationKind === heldDestinationKind;
    tab.classList.toggle('is-active', isActive);
    tab.setAttribute('aria-selected', isActive ? 'true' : 'false');
  });
  if (kindLabel) kindLabel.textContent = '保持中';
  if (count) count.hidden = heldPanelView !== 'held';
  viewToggle.textContent = heldPanelView === 'held' ? '一覧へ' : '保持中へ';
  viewToggle.setAttribute('aria-pressed', heldPanelView === 'list' ? 'true' : 'false');
  if (count) count.textContent = `${heldInstances.size + heldMiddleClasses.size + heldTopClasses.size}件`;
  document.querySelectorAll('.move-held-button').forEach((button) => {
    button.hidden = heldInstances.size === 0;
  });
  document.querySelectorAll('.move-held-middle-button').forEach((button) => {
    // 上位・中間・クラスのいずれかを保持中なら移動先として表示する。
    const destinationIsSelected = heldMiddleClasses.has(button.dataset.destinationClassId)
      || heldTopClasses.has(button.dataset.destinationClassId);
    button.hidden = destinationIsSelected
      || (heldMiddleClasses.size === 0 && heldTopClasses.size === 0 && heldInstances.size === 0);
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
  const destinationClasses = classes
    .filter((item) => classKind(item) === heldDestinationKind && item.label !== '未分類')
    .sort((a, b) => String(a.label || '').localeCompare(String(b.label || ''), 'ja'));
  const parentByChild = new Map();
  data.classData.relations.forEach(({ child, parent }) => {
    if (!parentByChild.has(child)) parentByChild.set(child, parent);
  });
  const hierarchyPath = (destination) => {
    const path = [];
    const seen = new Set();
    let currentId = destination.id;
    while (currentId && !seen.has(currentId)) {
      seen.add(currentId);
      const current = classById.get(currentId);
      if (!current) break;
      path.unshift(String(current.label || '(ラベルなし)'));
      currentId = parentByChild.get(currentId);
    }
    return path.join(' › ');
  };
  const searchTerm = destinationSearch.value.trim().toLocaleLowerCase();
  const matchesDestination = (destination) => {
    const visiblePath = heldDestinationKind === 'middle' ? hierarchyPath(destination) : '';
    return !searchTerm || `${destination.label || ''} ${displayClassId(destination.id)} ${visiblePath}`
      .toLocaleLowerCase().includes(searchTerm);
  };
  const makeDestinationOption = (destination, isRecent = false) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'held-destination-option';
    if (isRecent) button.classList.add('is-recent');
    button.classList.toggle('is-selected', heldDestinationId === destination.id);
    const name = document.createElement('span');
    name.className = 'held-destination-option-name';
    name.textContent = destination.label || '(ラベルなし)';
    const path = document.createElement('small');
    path.className = 'held-destination-option-path';
    path.textContent = hierarchyPath(destination);
    path.hidden = heldDestinationKind === 'top';
    button.append(name, path);
    button.setAttribute('aria-pressed', heldDestinationId === destination.id ? 'true' : 'false');
    button.addEventListener('click', () => {
      heldDestinationId = heldDestinationId === destination.id ? '' : destination.id;
      renderInstances();
    });
    return button;
  };
  const recentDestinations = recentHeldDestinationIds
    .map((id) => classById.get(id))
    .filter((item) => item && classKind(item) === heldDestinationKind && item.label !== '未分類' && matchesDestination(item));
  if (recentDestinations.length) {
    recentSection.hidden = false;
    recentList.replaceChildren(...recentDestinations.map((destination) => makeDestinationOption(destination, true)));
  } else {
    recentSection.hidden = true;
    recentList.replaceChildren();
  }
  const filteredDestinations = destinationClasses.filter(matchesDestination);
  destinationList.replaceChildren(...filteredDestinations.map((destination) => makeDestinationOption(destination)));
  if (!filteredDestinations.length) {
    const empty = document.createElement('p');
    empty.className = 'held-destination-empty';
    empty.textContent = destinationClasses.length ? '一致する移動先がありません。' : '移動先にできるクラスがありません。';
    destinationList.append(empty);
  }
  applyDestination.disabled = !heldDestinationId || !selectionKind
    || (heldDestinationKind === 'middle' && selectionKind !== 'class');
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
    button.title = button.disabled ? '上位・中間クラス選択中はクラスを選択できません' : '';
  });
  middleCheckboxById.forEach((checkbox) => {
    checkbox.disabled = selectionKind !== null && selectionKind !== 'middle';
  });
  topCheckboxById.forEach((checkbox) => {
    checkbox.disabled = selectionKind !== null && selectionKind !== 'top';
  });
}

function moveHeldClassesToTop(topId) {
  if (!heldMiddleClasses.size && !heldTopClasses.size && !heldInstances.size) return false;
  const selectedMiddleIds = new Set(heldMiddleClasses.keys());
  const selectedTopIds = new Set(heldTopClasses.keys());
  const selectedTargetIds = new Set(heldInstances.keys());
  if (selectedMiddleIds.has(topId) || selectedTopIds.has(topId)) {
    logEditAction('移動先として選択中のクラスは指定できません。', 'warn');
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
  if (descendants.has(topId)) { logEditAction('選択クラスの配下には移動できません。', 'warn'); return true; }

  const undoBefore = snapshotEditState();
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
    .map((relation) => ({ ...relation, parent: convertedIds.get(relation.parent) || relation.parent }));
  convertedIds.forEach((newId) => addRelation(newId, topId));
  selectedMiddleIds.forEach((middleId) => addRelation(middleId, topId));
  selectedTargetIds.forEach((targetId) => addRelation(targetId, topId));
  const movedCount = selectedMiddleIds.size + selectedTopIds.size + selectedTargetIds.size;
  heldMiddleClasses.clear();
  heldTopClasses.clear();
  heldInstances.clear();
  heldDestinationId = '';
  hasUnsavedChanges = true;
  recordEditHistory(undoBefore, topId, 'クラス移動');
  logEditAction(`${selectedTopIds.size}件の上位クラスを中間クラス化し、合計${movedCount}件を移動しました。`);
  render();
  return true;
}

function moveHeldToMiddle(middleId) {
  if (heldInstances.size) {
    const undoBefore = snapshotEditState();
    const selectedIds = new Set(heldInstances.keys());
    data.classData.relations = data.classData.relations.filter((relation) => !selectedIds.has(relation.child));
    selectedIds.forEach((child) => addRelation(child, middleId));
    const movedCount = selectedIds.size;
    heldInstances.clear();
    heldDestinationId = '';
    hasUnsavedChanges = true;
    recordEditHistory(undoBefore, middleId, 'クラス移動');
    logEditAction(`${movedCount}件のクラスを中間クラスへ移動しました。`);
    render();
    return;
  }

  const selectedMiddleIds = new Set(heldMiddleClasses.keys());
  const selectedTopIds = new Set(heldTopClasses.keys());
  const selectedIds = new Set([...selectedMiddleIds, ...selectedTopIds]);
  if (!selectedIds.size) return;
  if (selectedIds.has(middleId) || [...selectedIds].some((id) => descendantIds(id).has(middleId))) {
    logEditAction('選択クラス自身またはその配下には移動できません。', 'warn');
    return;
  }

  const undoBefore = snapshotEditState();
  const convertedTopIds = new Map();
  heldTopClasses.forEach((top) => {
    const oldId = top.id;
    const newId = allocateTemporaryClassId('middle');
    convertedTopIds.set(oldId, newId);
    classById.delete(oldId);
    top.id = newId;
    top.type = 'middle';
    classById.set(newId, top);
  });
  data.classData.relations = data.classData.relations
    .filter((relation) => !selectedIds.has(relation.child))
    .map((relation) => ({ ...relation, parent: convertedTopIds.get(relation.parent) || relation.parent }));
  selectedMiddleIds.forEach((id) => addRelation(id, middleId));
  convertedTopIds.forEach((id) => addRelation(id, middleId));
  const movedCount = selectedIds.size;
  heldMiddleClasses.clear();
  heldTopClasses.clear();
  heldDestinationId = '';
  hasUnsavedChanges = true;
  recordEditHistory(undoBefore, middleId, 'クラス移動');
  logEditAction(`${movedCount}件のクラスを中間クラスへ移動しました。選択した上位クラスは中間クラスに変更しました。`);
  render();
}

function moveHeldToTop(topId) {
  if (!heldInstances.size) { logEditAction('先にクラスを選択してください。', 'warn'); return; }
  const undoBefore = snapshotEditState();
  const selectedIds = new Set(heldInstances.keys());
  data.classData.relations = data.classData.relations.filter((relation) => !selectedIds.has(relation.child));
  selectedIds.forEach((child) => addRelation(child, topId));
  const movedCount = selectedIds.size;
  heldInstances.clear();
  heldDestinationId = '';
  hasUnsavedChanges = true;
  recordEditHistory(undoBefore, topId, 'クラス移動');
  logEditAction(`${movedCount}件を上位クラスへ直接移動しました。`);
  render();
}
// ============================================================
// 階層ツリーの描画とツリー上の編集操作
// ============================================================
let targetConnectorLayoutFrame = 0;
let treeCountRangeDefaultsInitialized = false;
let treeExactCountValues = [0];
let treeExactSelectedCount = null;
let treeCountRangeTouched = false;
// 画面には選択中の条件だけ表示し、件数条件は一度設定した後もキーワード条件と併用する。
let treeCountFilterEnabled = false;
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
    window.updateTreeTargetRowStarts(panel);
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
  const minInput = document.getElementById('tree-filter-count-min');
  const maxInput = document.getElementById('tree-filter-count-max');
  treeExactCountValues = [...new Set(classes
    .filter((item) => classKind(item) === 'class')
    .map((item) => countTargetInstances(item.id)))].sort((a, b) => a - b);
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
  document.getElementById('tree-filter-count-exact-min').textContent = `${treeExactCountValues[0]}件`;
  document.getElementById('tree-filter-count-exact-max').textContent = `${treeExactCountValues.at(-1)}件`;
  if (!treeCountRangeDefaultsInitialized) {
    if (minInput.value === '') minInput.value = '0';
    if (maxInput.value === '') {
      const largestClassCount = classes.reduce((largest, item) =>
        classKind(item) === 'class' ? Math.max(largest, countTargetInstances(item.id)) : largest, 0);
      maxInput.value = String(largestClassCount);
    }
    treeCountRangeDefaultsInitialized = true;
  }
  const minValue = minInput.value;
  const maxValue = maxInput.value;
  const minCount = minValue === '' ? null : Number(minValue);
  const maxCount = maxValue === '' ? null : Number(maxValue);
  const countMode = document.getElementById('tree-filter-count-mode').value;
  const exactCount = treeExactSelectedCount;
  const countFilterActive = treeCountFilterEnabled && (countMode === 'exact'
    ? exactCount !== null
    : treeCountRangeTouched && (minCount !== null || maxCount !== null));
  const activeQuery = filterQuery;
  const filterActive = activeQuery.trim().length > 0 || countFilterActive;
  const preserveHierarchy = countFilterActive && !activeQuery.trim();
  const effectiveSearchType = activeQuery.trim() ? filterType : 'class';
  const { targets: matchedTargets } = findTargetClasses(effectiveSearchType, activeQuery);
  const filteredTargets = matchedTargets.filter((target) =>
    (!countFilterActive || (countMode === 'exact'
      ? countTargetInstances(target.id) === exactCount
      : (minCount === null || countTargetInstances(target.id) >= minCount)
        && (maxCount === null || countTargetInstances(target.id) <= maxCount))));
  const filterCount = document.getElementById('tree-filter-count');
  filterCount.textContent = `${filteredTargets.length}件`;

  // 閲覧画面と同じ階層モデル・描画関数を使い、モードごとの差は操作UIに限定する。
  const targetIds = filterActive ? new Set(filteredTargets.map((target) => target.id)) : null;
  const model = window.buildTreeModel(data.classData, targetIds, preserveHierarchy);
  const openNodeIds = activeQuery.trim()
    ? window.treeAncestorIds(data.classData, targetIds)
    : new Set();
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
  const addTreeRow = (label, handler) => {
    const row = document.createElement('li');
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'tree-add-button tree-add-row';
    button.textContent = `＋ ${label}`;
    button.addEventListener('click', handler);
    row.append(button);
    return row;
  };
  const addMiddleClass = (parentId) => {
    const label = window.prompt('中間クラス名を入力してください');
    if (!label || !label.trim()) return;
    const isMovingHeldTargets = heldInstances.size > 0;
    const undoBefore = snapshotEditState();
    const item = createClass('middle', label);
    if (!item) return;
    addRelation(item.id, parentId);
    if (heldInstances.size) {
      const selectedIds = [...heldInstances.keys()];
      const selectedIdSet = new Set(selectedIds);
      data.classData.relations = data.classData.relations.filter((relation) => !selectedIdSet.has(relation.child));
      selectedIds.forEach((childId) => addRelation(childId, item.id));
      heldInstances.clear();
      logEditAction(`${item.label}を追加し、保持中のクラスを移動しました。`);
    } else {
      logEditAction(`中間クラス「${item.label}」を追加しました。`);
    }
    hasUnsavedChanges = true;
    recordEditHistory(undoBefore, '', isMovingHeldTargets ? '中間クラス作成と移動' : '中間クラス作成');
    render();
  };
  const addTopClass = () => {
    if (heldMiddleClasses.size) {
      const selected = [...heldMiddleClasses.values()];
      const selectedIds = new Set(selected.map((item) => item.id));
      const conflicts = selected.filter((item) => classes.some((candidate) =>
        classKind(candidate) === 'top' && candidate.label.trim() === item.label.trim()));
      if (conflicts.length) {
        logEditAction(`同じ名前の上位クラスがあるため上位化できません: ${conflicts.map((item) => item.label).join('、')}`, 'warn');
        return;
      }
      const children = buildChildrenMap();
      const countTargets = createTargetCounter(children);
      const summary = selected.map((item) => `・${item.label}（配下 ${countTargets(item.id)}件）`).join('\n');
      if (!window.confirm(`選択した中間クラスを、それぞれ独立した上位クラスに変更します。\n名前と配下のクラスは引き継ぎます。\n\n${summary}\n\n実行しますか？`)) return;

      const undoBefore = snapshotEditState();
      const promotedIds = new Map();
      selected.forEach((item) => {
        const oldId = item.id;
        const newId = allocateTemporaryClassId('top');
        promotedIds.set(oldId, newId);
        classById.delete(oldId);
        item.id = newId;
        item.type = 'top';
        classById.set(newId, item);
      });
      // 昇格対象自身の親（旧上位クラス）との関係は外し、配下からの
      // 参照だけ新しい上位クラスIDへ付け替える。
      data.classData.relations = data.classData.relations
        .filter((relation) => !selectedIds.has(relation.child))
        .map((relation) => ({ ...relation, parent: promotedIds.get(relation.parent) || relation.parent }));
      heldMiddleClasses.clear();
      heldDestinationId = '';
      hasUnsavedChanges = true;
      recordEditHistory(undoBefore, '', '中間クラスの上位化');
      logEditAction(`${selected.length}件の中間クラスを、それぞれ上位クラスに変更しました。`);
      render();
      return;
    }
    const label = window.prompt('上位クラス名を入力してください');
    if (!label || !label.trim()) return;
    const isMovingHeldTargets = heldInstances.size > 0;
    const undoBefore = snapshotEditState();
    const item = createClass('top', label);
    if (!item) return;
    if (heldInstances.size) {
      const selectedIds = [...heldInstances.keys()];
      const selectedIdSet = new Set(selectedIds);
      data.classData.relations = data.classData.relations.filter((relation) => !selectedIdSet.has(relation.child));
      selectedIds.forEach((childId) => addRelation(childId, item.id));
      heldInstances.clear();
      logEditAction(`${item.label}を追加し、保持中のクラスを移動しました。`);
    } else {
      logEditAction(`上位クラス「${item.label}」を追加しました。`);
    }
    hasUnsavedChanges = true;
    recordEditHistory(undoBefore, '', isMovingHeldTargets ? '上位クラス作成と移動' : '上位クラス作成');
    render();
  };
  const renderTarget = (item, _parent, depth) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'tree-add-button tree-leaf-class';
    button.dataset.instanceId = item.id;
    button.style.setProperty('--tree-level-color', window.treeDepthColor(depth));
    const selectionKind = activeSelectionKind();
    button.disabled = selectionKind !== null && selectionKind !== 'class';
    button.title = button.disabled ? '上位・中間クラス選択中はクラスを選択できません' : '';
    const id = document.createElement('span');
    id.className = 'tree-leaf-id';
    id.textContent = displayClassId(item.id);
    const label = document.createElement('span');
    label.className = 'tree-leaf-label';
    label.textContent = window.treeLabel(item.label);
    const count = document.createElement('span');
    count.className = 'target-instance-count-badge';
    count.textContent = `(${countTargetInstances(item.id)}件)`;
    button.append(id, label, count);
    button.classList.toggle('is-selected', heldInstances.has(item.id));
    targetButtonById.set(item.id, button);
    button.addEventListener('click', () => {
      if (activeSelectionKind() && activeSelectionKind() !== 'class') return;
      if (heldInstances.has(item.id)) heldInstances.delete(item.id);
      else heldInstances.set(item.id, item);
      button.classList.toggle('is-selected', heldInstances.has(item.id));
      syncTargetButtonAvailability();
      renderInstances();
    });
    const li = document.createElement('li');
    li.style.setProperty('--tree-level-color', window.treeDepthColor(depth));
    li.append(button);
    const infoButton = document.createElement('button');
    infoButton.type = 'button';
    infoButton.className = 'tree-leaf-info-button';
    infoButton.textContent = 'i';
    infoButton.setAttribute('aria-label', `${item.label}に関連するインスタンスを表示`);
    infoButton.title = '関連インスタンスを表示';
    infoButton.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      showRelatedInstances(item);
    });
    li.append(infoButton);
    return li;
  };
  const decorateSummary = (summary, levelContent, node, depth) => {
    const item = classById.get(node.id);
    if (!item) return;
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
    if (classKind(item) === 'middle') {
      // 中間クラスの「＋」は、保持中のクラスをこの中間クラスへ移動する操作。
      // 対象・中間・上位クラスの選択中に移動先として表示する。
      const moveButton = addTreeButton('＋', () => moveHeldToMiddle(item.id));
      moveButton.classList.add('move-held-button', 'move-held-middle-button');
      moveButton.dataset.destinationClassId = item.id;
      moveButton.hidden = heldMiddleClasses.has(item.id)
        || (!heldInstances.size && !heldMiddleClasses.size && !heldTopClasses.size);
      moveButton.setAttribute('aria-label', 'ここへ移動');
      moveButton.title = '選択中のクラスをここへ移動';
      summary.append(moveButton);
    }
    if (classKind(item) === 'top') {
      const isUnclassified = item.label === '未分類';
      // 未分類はクラスだけを受け入れ、他の上位クラスは保持中クラスを受け入れる。
      const addButton = addTreeButton('＋', () => {
        if (!isUnclassified) moveHeldClassesToTop(item.id);
        else moveHeldToTop(item.id);
      });
      // 中間クラス側の移動ボタンと同じスタイルを適用する。
      addButton.classList.add('move-held-button');
      if (!isUnclassified) {
        addButton.classList.add('move-held-middle-button');
        addButton.dataset.destinationClassId = item.id;
      }
      addButton.hidden = isUnclassified
        ? heldInstances.size === 0
        : heldMiddleClasses.size === 0 && heldTopClasses.size === 0 && heldInstances.size === 0;
      addButton.setAttribute('aria-label', 'ここへ移動');
      addButton.title = isUnclassified
        ? '保持中のクラスを未分類へ移動'
        : '保持中のクラスをここへ移動';
      summary.append(addButton);
    }
  };
  window.renderHierarchyTree(tree, model, {
    displayId: displayClassId,
    targetCountFor: (item) => countTargetInstances(item.id),
    isOpen: (node) => openNodeIds.has(node.id),
    configureDetails: (details, node, depth) => {
      if (node.type === 'middle') details.style.setProperty('--middle-sticky-z', String(14 + depth));
    },
    decorateSummary,
    beforeChildren: (node, list) => {
      const item = classById.get(node.id);
      if (item && item.label !== '未分類') {
        list.append(addTreeRow('中間クラスを追加', () => addMiddleClass(item.id)));
      }
    },
    renderTarget,
    renderRootExtra: () => addTreeRow(
      heldMiddleClasses.size ? `選択した中間クラスを上位化（${heldMiddleClasses.size}件）` : '上位クラスを追加',
      addTopClass
    ),
    afterChildren: () => scheduleTargetConnectorLayout(),
    afterRender: () => scheduleTargetConnectorLayout()
  });
}
// ============================================================
// JSON出力と保存
// ============================================================
function downloadJson(name, value) {
  const blob = new Blob([`${JSON.stringify(value, null, 2)}\n`], { type: 'application/json;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a'); link.href = url; link.download = name; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function saveEditChanges() {
  const exportData = {
    classes: classes.map((item) => ({ type: kind(item.id), id: item.id, label: item.label })),
    relations: data.classData.relations.map(({ child, parent }) => ({ child, parent }))
  };
  downloadJson('class-update.json', exportData);
  logEditAction('class-update.jsonをダウンロードしました。data/input/に配置してClassDataUpdateを実行してください。');
  hasUnsavedChanges = false;
}
// ============================================================
// 編集操作のイベント登録
// ============================================================
// 保存・保持状態の操作
document.getElementById('save-edit-changes').addEventListener('click', saveEditChanges);
document.getElementById('toggle-held-panel-view').addEventListener('click', () => {
  heldPanelView = heldPanelView === 'held' ? 'list' : 'held';
  renderInstances();
});
document.getElementById('toggle-held-panel-collapse').addEventListener('click', () => {
  heldPanelCollapsed = !heldPanelCollapsed;
  renderInstances();
});
const treeFilter = document.querySelector('.tree-filter');
const heldPanel = document.getElementById('held-panel');
if (treeFilter && heldPanel && 'ResizeObserver' in window) {
  const syncCollapsedHeldPanelHeight = () => {
    heldPanel.style.setProperty('--held-collapsed-height', `${treeFilter.getBoundingClientRect().height}px`);
  };
  new ResizeObserver(syncCollapsedHeldPanelHeight).observe(treeFilter);
  syncCollapsedHeldPanelHeight();
  const layout = document.querySelector('#edit-tree-panel .edit-tree-layout');
  if (layout) new ResizeObserver(syncPinnedHeldPanelBounds).observe(layout);
}
window.addEventListener('scroll', syncPinnedHeldPanelBounds, { passive: true });
window.addEventListener('resize', syncPinnedHeldPanelBounds);
if (heldPanel) new MutationObserver(syncPinnedHeldPanelBounds).observe(heldPanel, { attributes: true, attributeFilter: ['class', 'hidden'] });
syncPinnedHeldPanelBounds();
treeFilter?.addEventListener('toggle', renderInstances);
document.getElementById('undo-edit').addEventListener('click', undoLastEdit);
document.getElementById('redo-edit').addEventListener('click', redoLastEdit);
document.addEventListener('keydown', (event) => {
  if (!(event.ctrlKey || event.metaKey) || event.altKey) return;
  const editingText = event.target instanceof Element
    && event.target.closest('input, textarea, select, [contenteditable="true"]');
  if (editingText) return;
  const key = event.key.toLocaleLowerCase();
  if (key === 'z' && event.shiftKey || key === 'y') {
    event.preventDefault();
    redoLastEdit();
  } else if (key === 'z') {
    event.preventDefault();
    undoLastEdit();
  }
});
document.querySelectorAll('.held-destination-tab').forEach((tab) => tab.addEventListener('click', () => {
  heldDestinationKind = tab.dataset.destinationKind;
  heldDestinationId = '';
  document.getElementById('held-destination-search').value = '';
  renderInstances();
}));
document.getElementById('held-destination-search').addEventListener('input', renderInstances);
document.getElementById('apply-held-destination').addEventListener('click', () => {
  if (!heldDestinationId) return;
  if (heldDestinationKind === 'middle') moveHeldToMiddle(heldDestinationId);
  else if (activeSelectionKind() === 'class') moveHeldToTop(heldDestinationId);
  else moveHeldClassesToTop(heldDestinationId);
});
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
  heldDestinationId = '';
  syncTargetButtonAvailability();
  renderInstances();
  logEditAction('保持中のクラスをすべて解除しました。');
});
document.getElementById('tree-filter-type').addEventListener('change', () => {
  document.getElementById('tree-filter-query').placeholder = '名前・IDで検索';
  renderTree();
});
document.getElementById('tree-filter-query').addEventListener('input', renderTree);
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
document.getElementById('tree-filter-count-min').addEventListener('input', () => { treeCountRangeTouched = true; renderTree(); });
document.getElementById('tree-filter-count-max').addEventListener('input', () => { treeCountRangeTouched = true; renderTree(); });
document.getElementById('tree-filter-count-exact-input').addEventListener('input', (event) => {
  treeExactSelectedCount = treeExactCountValues[Number(event.target.value)] ?? treeExactCountValues[0];
  document.getElementById('tree-filter-count-exact-value').textContent = `${treeExactSelectedCount}件`;
  renderTree();
});
document.getElementById('tree-filter-count-mode').addEventListener('change', (event) => {
  const exactMode = event.target.value === 'exact';
  document.getElementById('tree-filter-count-range').hidden = exactMode;
  document.getElementById('tree-filter-count-exact').hidden = !exactMode;
  renderTree();
});
// 検索結果を既存クラスへ一括付与
document.getElementById('target-search-type').addEventListener('change', () => {
  // 検索対象を切り替えたら、別の検索条件で選んだクラスを持ち越さない。
  const searchTypeSelect = document.getElementById('target-search-type');
  searchTypeSelect.classList.toggle('is-instance', searchTypeSelect.value === 'instance');
  searchTypeSelect.classList.toggle('is-class', searchTypeSelect.value !== 'instance');
  searchSelected.clear();
  document.getElementById('search-new-class-label').value = '';
  document.getElementById('target-class-search').placeholder =
    document.getElementById('target-search-type').value === 'instance'
      ? 'インスタンス名・IDを入力'
      : 'クラス名・IDを入力';
  renderTargetSearch();
});
document.getElementById('target-class-search').addEventListener('input', () => {
  // 検索語は検索ボタンで確定し、確定後は下のチップに蓄積する。
});
const runTargetSearch = () => {
  const input = document.getElementById('target-class-search');
  const term = input.value.trim();
  if (term && !targetSearchQuery.some((existing) => existing.toLocaleLowerCase() === term.toLocaleLowerCase())) {
    targetSearchQuery.push(term);
  }
  input.value = '';
  renderTargetSearchKeywordChips();
  searchSelected.clear();
  document.getElementById('search-new-class-label').value = '';
  renderSearchParentOptions();
  renderTargetSearch();
};
document.getElementById('target-search-submit').addEventListener('click', runTargetSearch);
document.getElementById('target-class-search').addEventListener('keydown', (event) => {
  if (event.key === 'Enter') { event.preventDefault(); runTargetSearch(); }
});
document.getElementById('target-search-clear').addEventListener('click', () => {
  const input = document.getElementById('target-class-search');
  input.value = '';
  targetSearchQuery = [];
  renderTargetSearchKeywordChips();
  searchSelected.clear();
  document.getElementById('search-new-class-label').value = '';
  renderSearchParentOptions();
  renderTargetSearch();
  input.focus();
});
document.getElementById('search-target-kind').addEventListener('change', render);
[
  { buttonId: 'search-condition-keyword-tab', viewId: 'search-keyword-view' },
  { buttonId: 'search-condition-hierarchy-tab', viewId: 'search-hierarchy-view' }
].forEach(({ buttonId, viewId }) => {
  document.getElementById(buttonId).addEventListener('click', () => {
    [
      ['search-condition-keyword-tab', 'search-keyword-view'],
      ['search-condition-hierarchy-tab', 'search-hierarchy-view']
    ].forEach(([candidateButtonId, candidateViewId]) => {
      const selected = candidateButtonId === buttonId;
      const tab = document.getElementById(candidateButtonId);
      tab.classList.toggle('is-active', selected);
      tab.setAttribute('aria-selected', String(selected));
      document.getElementById(candidateViewId).hidden = !selected;
    });
  });
});
[['search-filter-top-toggle', 'search-filter-top-list'], ['search-filter-middle-toggle', 'search-filter-middle-list']].forEach(([toggleId, listId]) => {
  const toggle = document.getElementById(toggleId);
  const list = document.getElementById(listId);
  toggle.addEventListener('click', () => {
    const opening = list.hidden;
    list.hidden = !opening;
    toggle.setAttribute('aria-expanded', String(opening));
  });
});
document.getElementById('clear-hierarchy-filters').addEventListener('click', () => {
  ['search-filter-top-list', 'search-filter-middle-list'].forEach((listId) => {
    document.querySelectorAll(`#${listId} input[type="checkbox"]`).forEach((checkbox) => { checkbox.checked = false; });
  });
  renderSearchParentOptions();
  renderTargetSearch();
});
document.getElementById('search-new-class-parent-kind').addEventListener('change', render);
document.getElementById('search-new-class-kind').addEventListener('change', render);
document.getElementById('search-apply-mode').addEventListener('change', () => {
  const creating = document.getElementById('search-apply-mode').value === 'create';
  document.getElementById('search-existing-fields').hidden = creating;
  document.getElementById('search-create-fields').hidden = !creating;
  document.getElementById('apply-search-selection').textContent = creating
    ? '生成して付与'
    : '既存クラスへ付与';
  renderSearchParentOptions();
});
document.getElementById('select-search-results').addEventListener('click', () => {
  currentTargetSearchResults.forEach((item) => searchSelected.set(item.id, item));
  renderTargetSearch();
});
document.getElementById('clear-search-selection').addEventListener('click', () => { searchSelected.clear(); renderTargetSearch(); });
document.getElementById('apply-search-selection').addEventListener('click', () => {
  if (searchSelected.size === 0) {
    logEditAction('クラスを1件以上選択してください。', 'warn');
    return;
  }
  const selectedIds = [...searchSelected.keys()];
  const selectedIdSet = new Set(selectedIds);
  const creating = document.getElementById('search-apply-mode').value === 'create';
  let undoBefore;
  if (creating) {
    const label = document.getElementById('search-new-class-label').value.trim();
    if (!label) { logEditAction('新しいクラス名を入力してください。', 'warn'); return; }
    const newKind = document.getElementById('search-new-class-kind').value;
    if (hasClassLabelConflict(newKind, label)) {
      logEditAction(classLabelConflictMessage(newKind, label), 'warn');
      return;
    }
    const parentId = newKind === 'middle' ? document.getElementById('search-new-class-parent').value : '';
    if (newKind === 'middle' && !parentId) { logEditAction('新しい中間クラスの親を選択してください。', 'warn'); return; }
    undoBefore = snapshotEditState();
    const item = createClass(newKind, label);
    if (!item) return;
    if (parentId) addRelation(item.id, parentId);
    data.classData.relations = data.classData.relations.filter((relation) => !selectedIdSet.has(relation.child));
    selectedIds.forEach((id) => addRelation(id, item.id));
    logEditAction(`${selectedIds.length}件を「${label}」へ付与しました。`);
    document.getElementById('search-new-class-label').value = '';
  } else {
    const parentId = document.getElementById('search-target-parent').value;
    if (!parentId) { logEditAction('付与先のクラスを選択してください。', 'warn'); return; }
    undoBefore = snapshotEditState();
    data.classData.relations = data.classData.relations.filter((relation) => !selectedIdSet.has(relation.child));
    selectedIds.forEach((id) => addRelation(id, parentId));
    const parentKind = document.getElementById('search-target-kind').value;
    logEditAction(`${selectedIds.length}件を${parentKind === 'top' ? '上位' : '中間'}クラスへ付与しました。`);
  }
  searchSelected.clear();
  document.getElementById('target-class-search').value = '';
  hasUnsavedChanges = true;
  recordEditHistory(undoBefore, '', creating ? 'クラス作成と付与' : 'クラス付与');
  render();
});
document.getElementById('download-class-update').addEventListener('click', saveEditChanges);
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
  syncPinnedHeldPanelBounds();
  document.getElementById('close-all-tree').hidden = tab.dataset.editTab !== 'edit-tree-panel';
  if (tab.dataset.editTab !== 'target-search-panel') {
    targetSearchRenderSequence += 1;
    document.getElementById('target-search-loading').hidden = true;
  }
  if (tab.dataset.editTab === 'edit-form-panel') renderEditForm();
  if (tab.dataset.editTab === 'target-search-panel') {
    const loading = document.getElementById('target-search-loading');
    const prepareOptions = !targetSearchOptionsPrepared;
    if (prepareOptions && !targetSearchHasRendered) {
      loading.hidden = false;
      loading.textContent = '検索結果を読み込み中…';
    }
    window.requestAnimationFrame(() => window.setTimeout(() => {
      if (searchPanel.hidden) return;
      if (prepareOptions) {
        renderSearchParentOptions();
        targetSearchOptionsPrepared = true;
      }
      renderTargetSearch();
    }, 0));
  }
  if (tab.dataset.editTab === 'class-management-panel') renderClassManagement();
}));
const closeAllTreeButton = document.getElementById('close-all-tree');
closeAllTreeButton.hidden = document.getElementById('edit-tree-panel').hidden;
closeAllTreeButton.addEventListener('click', () => {
  document.querySelectorAll('#edit-tree-panel .tree details[open]').forEach((details) => {
    details.open = false;
  });
});
document.querySelectorAll('[data-management-kind]').forEach((tab) => tab.addEventListener('click', () => {
  managementKind = tab.dataset.managementKind;
  document.querySelectorAll('[data-management-kind]').forEach((item) => item.classList.toggle('is-active', item === tab));
  renderClassManagement();
}));

const loadingIndicator = document.getElementById('loading-indicator');
if (loadingIndicator) loadingIndicator.hidden = true;
