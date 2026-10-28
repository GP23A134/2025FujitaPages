// ============================================================
// 編集画面の状態と共有データ
// ============================================================
// このファイルは、状態の初期化 → 編集ロジック → 描画 → イベント登録の順に構成する。
// イベント登録の順序を保ち、既存画面の初期化動作を変えない。
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
function logEditAction(message, level = 'info') {
  console[level](`[クラス編集] ${message}`);
}
const toggleEditIds = document.getElementById('toggle-edit-ids');
if (toggleEditIds) {
  const setEditIdsVisible = (visible) => {
    document.body.classList.toggle('edit-show-ids', visible);
    toggleEditIds.checked = visible;
  };
  setEditIdsVisible(false);
  toggleEditIds.addEventListener('change', () => setEditIdsVisible(toggleEditIds.checked));
}
let pinnedHeldPanelBoundsFrame = 0;
function setInlineStyleIfChanged(element, property, value) {
  if (element.style.getPropertyValue(property) === value) return;
  element.style.setProperty(property, value);
}
function removeInlineStyleIfPresent(element, property) {
  if (!element.style.getPropertyValue(property)) return;
  element.style.removeProperty(property);
}
const syncPinnedHeldPanelBounds = () => {
  if (pinnedHeldPanelBoundsFrame) return;
  pinnedHeldPanelBoundsFrame = window.requestAnimationFrame(() => {
    pinnedHeldPanelBoundsFrame = 0;
    const panel = document.getElementById('held-panel');
    const layout = document.querySelector('#edit-tree-panel .edit-tree-layout');
    if (!panel || !layout) return;
    const toolbar = document.querySelector('.edit-taskbar');
    const toolbarHeight = toolbar?.offsetHeight ?? 0;
    const top = toolbarHeight + 8;
    const treeFilter = document.getElementById('tree-filter');
    const searchTreeGap = Number.parseFloat(getComputedStyle(layout).getPropertyValue('--edit-pane-search-tree-gap')) || 0;
    const filterHeight = treeFilter && !treeFilter.hidden ? treeFilter.offsetHeight : 0;
    const treeStickyTop = filterHeight ? top + filterHeight + searchTreeGap : top;
    setInlineStyleIfChanged(layout, '--edit-pane-position-top', `${top}px`);
    setInlineStyleIfChanged(layout, '--edit-top-class-sticky-top', `${treeStickyTop}px`);
    if (panel.hidden || document.getElementById('edit-tree-panel')?.hidden || window.innerWidth <= 760) {
      removeInlineStyleIfPresent(panel, 'height');
      removeInlineStyleIfPresent(panel, 'max-height');
      removeInlineStyleIfPresent(panel, 'visibility');
      return;
    }
    const visibleHeaderHeight = Number.parseFloat(getComputedStyle(layout).getPropertyValue('--edit-pane-visible-header-height')) || 0;
    const availableHeight = Math.max(0, (window.visualViewport?.height || window.innerHeight) - top - 8 - visibleHeaderHeight);
    const desiredHeight = panel.classList.contains('is-collapsed')
      ? Number.parseFloat(getComputedStyle(panel).getPropertyValue('--held-collapsed-height')) || panel.scrollHeight
      : availableHeight;
    if (panel.classList.contains('is-collapsed')) {
      setInlineStyleIfChanged(panel, 'height', `${Math.min(availableHeight, desiredHeight)}px`);
      setInlineStyleIfChanged(panel, 'max-height', `${availableHeight}px`);
    } else {
      removeInlineStyleIfPresent(panel, 'height');
      removeInlineStyleIfPresent(panel, 'max-height');
    }
  });
};
const settingsDialog = document.getElementById('edit-settings-dialog');
document.getElementById('open-edit-settings')?.addEventListener('click', () => settingsDialog?.showModal());
document.getElementById('close-edit-settings')?.addEventListener('click', () => settingsDialog?.close());
settingsDialog?.addEventListener('click', (event) => {
  if (event.target === settingsDialog) settingsDialog.close();
});
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
let hasUnsavedChanges = false;
let heldPanelView = 'held';
let heldKindView = 'top';
const heldPageByKind = { top: 0, middle: 0, target: 0 };
let HELD_PAGE_SIZE = 10;
let heldPanelCollapsed = false;
let heldPanelClosed = false;
let heldDestinationKind = 'top';
let heldDestinationId = '';
let recentHeldDestinationIds = [];
const treeFilterKeywords = [];
let currentFilteredTargetIds = null;
let selectionRangeAnchorId = null;

function applyTreeSubtreeSelection(rootIds, selected) {
  const childrenByParent = new Map();
  data.classData.relations.forEach(({ child, parent }) => {
    if (!childrenByParent.has(parent)) childrenByParent.set(parent, []);
    childrenByParent.get(parent).push(child);
  });
  const visited = new Set();
  const pending = [...rootIds];
  while (pending.length) {
    const id = pending.pop();
    if (visited.has(id)) continue;
    visited.add(id);
    const item = classById.get(id);
    if (item) {
      const type = classKind(item);
      const selection = type === 'class' ? heldInstances : type === 'middle' ? heldMiddleClasses : heldTopClasses;
      if (selected) selection.set(id, item);
      else selection.delete(id);
    }
    pending.push(...(childrenByParent.get(id) || []));
  }
  syncTreeSelectionAppearance();
}

function syncTreeSelectionAppearance() {
  middleCheckboxById.forEach((checkbox, id) => { checkbox.checked = heldMiddleClasses.has(id); });
  topCheckboxById.forEach((checkbox, id) => { checkbox.checked = heldTopClasses.has(id); });
  targetButtonById.forEach((button, id) => button.classList.toggle('is-selected', heldInstances.has(id)));
}

function applyTreeSelectionRange(control, event, selected) {
  const tree = document.getElementById('edit-tree');
  const controls = [...tree.querySelectorAll('.tree-level-selection-checkbox, .tree-leaf-class')];
  const ids = controls.map((element) => element.dataset.selectionId);
  const index = ids.indexOf(control.dataset.selectionId);
  const anchorIndex = ids.indexOf(selectionRangeAnchorId);
  const shiftRange = event.shiftKey || control.dataset.shiftKey === 'true';
  delete control.dataset.shiftKey;
  let selectedIds;
  if (shiftRange && index >= 0 && anchorIndex >= 0) {
    const [start, end] = [index, anchorIndex].sort((a, b) => a - b);
    selectedIds = controls.slice(start, end + 1).map((element) => element.dataset.selectionId);
  } else {
    selectedIds = [control.dataset.selectionId];
  }
  applyTreeSubtreeSelection(selectedIds, selected);
  selectionRangeAnchorId = control.dataset.selectionId;
  heldKindView = control.dataset.selectionKind === 'target'
    ? 'target'
    : control.dataset.selectionKind === 'middle' ? 'middle' : 'top';
  syncTargetButtonAvailability();
  renderInstances();
}

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
  // 描画用Mapはクラス配列を参照するため、配列とMapを同時に作り直す。
  // 選択状態は、復元後も存在するIDに限って保持する。
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

function isUnclassified(item) {
  return classKind(item) === 'top' && item.label === '未分類';
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
  const segment = String(id).split('/').pop();
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
  // 削除対象の直下にある対象クラスだけを未分類へ移す。
  // 配下の中間クラスの階層は、削除後に親へ付け替えるため維持する。
  const members = data.classData.relations
    .filter((relation) => relation.parent === classId && kind(relation.child) === 'class')
    .map((relation) => relation.child);
  if (!members.length) return 0;
  const { top } = ensureUnclassified();
  const memberIds = new Set(members);
  data.classData.relations = data.classData.relations.filter((relation) => !memberIds.has(relation.child));
  members.forEach((id) => addRelation(id, top.id));
  return members.length;
}

// ============================================================
