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
const toggleEditPanesPin = document.getElementById('toggle-edit-panes-pin');
let pinnedHeldPanelBoundsFrame = 0;
const syncPinnedHeldPanelBounds = () => {
  if (pinnedHeldPanelBoundsFrame) return;
  pinnedHeldPanelBoundsFrame = window.requestAnimationFrame(() => {
    pinnedHeldPanelBoundsFrame = 0;
    const panel = document.getElementById('held-panel');
    const layout = document.querySelector('#edit-tree-panel .edit-tree-layout');
    if (!panel) return;
    if (!document.body.classList.contains('edit-panes-pinned') || !layout || document.getElementById('edit-tree-panel')?.hidden || window.innerWidth <= 760) {
      layout?.style.removeProperty('--edit-pane-position-top');
      layout?.style.removeProperty('--edit-pane-available-height');
      layout?.style.removeProperty('--edit-top-class-sticky-top');
      panel.style.removeProperty('top');
      panel.style.removeProperty('height');
      panel.style.removeProperty('max-height');
      panel.style.removeProperty('visibility');
      return;
    }
    const treePane = layout.querySelector('.edit-tree-pane');
    if (!treePane) return;
    const treePaneBounds = treePane.getBoundingClientRect();
    const toolbarBounds = document.querySelector('.edit-taskbar')?.getBoundingClientRect();
    const stickyTop = toolbarBounds?.bottom ?? 0;
    const paneTopOffset = Number.parseFloat(getComputedStyle(layout).getPropertyValue('--edit-pane-top-offset')) || 0;
    const treeFilter = document.getElementById('tree-filter');
    const paneTop = treePaneBounds.top + (treeFilter?.hidden ? 0 : paneTopOffset);
    const top = Math.max(paneTop, stickyTop);
    const searchTreeGap = Number.parseFloat(getComputedStyle(layout).getPropertyValue('--edit-pane-search-tree-gap')) || 0;
    const treeStickyTop = treeFilter && !treeFilter.hidden
      ? Math.max(treeFilter.getBoundingClientRect().bottom + searchTreeGap, top)
      : top;
    const bottom = window.innerHeight - 8;
    layout.style.setProperty('--edit-pane-position-top', `${top}px`);
    layout.style.setProperty('--edit-top-class-sticky-top', `${treeStickyTop}px`);
    if (panel.hidden) {
      panel.style.removeProperty('top');
      panel.style.removeProperty('height');
      panel.style.removeProperty('max-height');
      panel.style.removeProperty('visibility');
      return;
    }
    if (bottom <= top) {
      panel.style.visibility = 'hidden';
      return;
    }
    panel.style.visibility = 'visible';
    const availableHeight = bottom - top;
    layout.style.setProperty('--edit-pane-available-height', `${Math.max(0, availableHeight)}px`);
    const desiredHeight = panel.classList.contains('is-collapsed')
      ? Number.parseFloat(getComputedStyle(panel).getPropertyValue('--held-collapsed-height')) || panel.scrollHeight
      : availableHeight;
    if (panel.classList.contains('is-collapsed')) {
      panel.style.height = `${Math.min(availableHeight, desiredHeight)}px`;
      panel.style.maxHeight = `${availableHeight}px`;
    } else {
      panel.style.removeProperty('height');
      panel.style.removeProperty('max-height');
    }
  });
};
if (toggleEditPanesPin) {
  const setEditPanesPinned = (pinned) => {
    document.body.classList.toggle('edit-panes-pinned', pinned);
    toggleEditPanesPin.checked = pinned;
    syncPinnedHeldPanelBounds();
  };
  setEditPanesPinned(true);
  toggleEditPanesPin.addEventListener('change', () => setEditPanesPinned(toggleEditPanesPin.checked));
}
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
let heldPanelCollapsed = false;
let heldPanelClosed = false;
let heldDestinationKind = 'top';
let heldDestinationId = '';
let recentHeldDestinationIds = [];
const treeFilterKeywords = [];

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
// ツリーと保持中パネルの描画
// ============================================================
function findTargetClasses(searchType, query) {
  return window.findTargetMatches(data, searchType, query, 'OR');
}
function renameClass(item) {
  const nextLabel = window.prompt('新しいクラス名を入力してください。', item.label);
  if (!nextLabel || !nextLabel.trim() || nextLabel.trim() === item.label) return;
  if (hasClassLabelConflict(classKind(item), nextLabel, item.id)) {
    logEditAction(classLabelConflictMessage(classKind(item), nextLabel.trim()), 'warn');
    return;
  }
  const undoBefore = snapshotEditState();
  item.label = nextLabel.trim();
  hasUnsavedChanges = true;
  recordEditHistory(undoBefore, '', '名称変更');
  logEditAction(`クラス名を「${item.label}」に変更しました。`);
  render();
}
function deleteClass(item) {
  if (item.label === '未分類') return;
  if (!window.confirm(`「${item.label}」を削除しますか？所属するクラスは未分類へ移動します。`)) return;
  const undoBefore = snapshotEditState();
  const directChildren = data.classData.relations
    .filter((relation) => relation.parent === item.id)
    .map((relation) => relation.child);
  const parentId = data.classData.relations.find((relation) => relation.child === item.id)?.parent;
  const middleChildren = directChildren.filter((id) => classKind(classById.get(id)) === 'middle');
  const moved = moveClassMembersToUnclassified(item.id);
  data.classData.relations = data.classData.relations.filter((relation) => relation.child !== item.id && relation.parent !== item.id);
  if (middleChildren.length) {
    if (classKind(item) === 'top') {
      const { top } = ensureUnclassified();
      middleChildren.forEach((id) => {
        const child = classById.get(id);
        if (!child) return;
        child.type = 'top';
        addRelation(id, top.id);
      });
    } else {
      const parent = classById.get(parentId) || ensureUnclassified().top;
      middleChildren.forEach((id) => addRelation(id, parent.id));
    }
  }
  const index = classes.indexOf(item);
  if (index >= 0) classes.splice(index, 1);
  classById.delete(item.id);
  heldMiddleClasses.delete(item.id);
  heldTopClasses.delete(item.id);
  hasUnsavedChanges = true;
  recordEditHistory(undoBefore, '', '削除');
  const promotionMessage = middleChildren.length
    ? classKind(item) === 'top'
      ? `直下の中間クラス${middleChildren.length}件を上位クラスにしました。`
      : `直下の中間クラス${middleChildren.length}件を親クラスへ移動しました。`
    : '';
  logEditAction(`${item.label}を削除しました。${promotionMessage}${moved}件を未分類へ移動しました。`);
  render();
}
function render() {
  renderTree();
  renderInstances();
}
function renderInstances() {
  // 保持中のクラスがある場合だけサイドパネルと移動用ボタンを表示する。
  // 解除操作後もこの関数だけを呼べば、件数と表示状態を同期できる。
  const held = document.getElementById('held-instance-list');
  const panel = document.getElementById('held-panel');
  const count = document.getElementById('held-count');
  const kindLabel = document.getElementById('held-kind-label');
  const selectionKind = activeSelectionKind();
  const heldListView = document.getElementById('held-list-view');
  const destinationPicker = document.getElementById('held-destination-picker');
  const aiAssistantPanel = document.getElementById('ai-assistant-panel');
  const destinationList = document.getElementById('held-destination-list');
  const destinationSearch = document.getElementById('held-destination-search');
  const recentSection = document.getElementById('held-destination-recent');
  const recentList = document.getElementById('held-destination-recent-list');
  const applyDestination = document.getElementById('apply-held-destination');
  const historyAnchor = document.querySelector('.ai-history-anchor');
  const collapseToggle = document.getElementById('toggle-held-panel-collapse');
  const undoButton = document.getElementById('undo-edit');
  const redoButton = document.getElementById('redo-edit');
  const undoEntry = editUndoStack.at(-1);
  const redoEntry = editRedoStack.at(-1);
  undoButton.disabled = !undoEntry;
  undoButton.title = undoEntry ? `元に戻す: ${undoEntry.actionLabel}` : '元に戻す履歴はありません';
  redoButton.disabled = !redoEntry;
  redoButton.title = redoEntry ? `やり直す: ${redoEntry.actionLabel}` : 'やり直す履歴はありません';
  const showHeldList = heldPanelView === 'held' && !heldPanelCollapsed;
  heldListView.hidden = !showHeldList;
  destinationPicker.hidden = heldPanelCollapsed || heldPanelView !== 'destination';
  aiAssistantPanel.hidden = heldPanelCollapsed || heldPanelView !== 'chat';
  panel.classList.toggle('is-collapsed', heldPanelCollapsed);
  panel.hidden = heldPanelClosed;
  document.getElementById('toggle-tree-filter-open').hidden = !treeFilter?.hidden;
  collapseToggle.setAttribute('aria-expanded', heldPanelCollapsed ? 'false' : 'true');
  collapseToggle.title = heldPanelCollapsed ? '保持中欄を展開' : '保持中欄を折りたたむ';
  collapseToggle.setAttribute('aria-label', heldPanelCollapsed ? '保持欄を展開' : '保持欄を最小化');
  document.querySelectorAll('.held-destination-tab').forEach((tab) => {
    const isActive = tab.dataset.destinationKind === heldDestinationKind;
    tab.classList.toggle('is-active', isActive);
    tab.setAttribute('aria-selected', isActive ? 'true' : 'false');
  });
  if (kindLabel) kindLabel.textContent = heldPanelView === 'chat' ? 'AIチャット' : heldPanelView === 'destination' ? '移動先' : '保持中';
  document.querySelectorAll('.held-panel-mode-tab').forEach((tab) => {
    const isActive = !heldPanelClosed && tab.dataset.heldPanelView === heldPanelView;
    tab.classList.toggle('is-active', isActive);
    tab.setAttribute('aria-selected', String(isActive));
  });
  const heldCountText = `${heldInstances.size + heldMiddleClasses.size + heldTopClasses.size}件`;
  if (count) count.textContent = heldCountText;
  const toolbarHeldCount = document.getElementById('held-count-toolbar');
  if (toolbarHeldCount) toolbarHeldCount.textContent = heldCountText;
  if (historyAnchor) historyAnchor.hidden = heldPanelView !== 'chat';
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
    const item = document.createElement('div'); item.className = 'held-instance-item'; item.dataset.heldKind = 'target';
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
    const item = document.createElement('div'); item.className = 'held-instance-item'; item.dataset.heldKind = 'middle';
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
    const item = document.createElement('div'); item.className = 'held-instance-item'; item.dataset.heldKind = 'top';
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
  held.querySelectorAll('[data-held-kind]').forEach((item) => { item.hidden = item.dataset.heldKind !== heldKindView; });
  const heldKindCounts = { top: heldTopClasses.size, middle: heldMiddleClasses.size, target: heldInstances.size };
  document.querySelectorAll('[data-held-kind-count]').forEach((badge) => { badge.textContent = String(heldKindCounts[badge.dataset.heldKindCount] || 0); });
  if (!heldKindCounts[heldKindView]) {
    const empty = document.createElement('p'); empty.className = 'held-kind-empty'; empty.textContent = 'この種類の保持項目はありません。'; held.append(empty);
  }
  document.querySelectorAll('.held-kind-tab').forEach((tab) => {
    const selected = tab.dataset.heldKind === heldKindView;
    tab.classList.toggle('is-active', selected);
    tab.setAttribute('aria-selected', String(selected));
  });
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
  applyDestination.disabled = !heldDestinationId || !selectionKind;
  syncTargetButtonAvailability();
  window.aiAssistant?.onScopeChange?.();
}

function activeSelectionKind() {
  if (heldTopClasses.size) return 'top';
  if (heldMiddleClasses.size) return 'middle';
  if (heldInstances.size) return 'class';
  return null;
}

function syncTargetButtonAvailability() {
  targetButtonById.forEach((button) => {
    button.disabled = false;
    button.title = '';
  });
  middleCheckboxById.forEach((checkbox) => {
    checkbox.disabled = false;
  });
  topCheckboxById.forEach((checkbox) => {
    checkbox.disabled = false;
  });
}

function moveHeldClassesToTop(topId) {
  if (!heldMiddleClasses.size && !heldTopClasses.size && !heldInstances.size) return false;
  const movableTopEntries = [...heldTopClasses.entries()].filter(([, item]) => !isUnclassified(item));
  const unclassifiedEntries = [...heldTopClasses.entries()].filter(([, item]) => isUnclassified(item));
  const hasUnclassifiedSelection = unclassifiedEntries.length > 0;
  if (!heldMiddleClasses.size && !movableTopEntries.length && !heldInstances.size) {
    logEditAction('未分類は受け皿のため移動できません。', 'warn');
    return true;
  }
  const selectedMiddleIds = new Set(heldMiddleClasses.keys());
  const selectedTopIds = new Set(movableTopEntries.map(([id]) => id));
  const selectedTargetIds = new Set(heldInstances.keys());
  if (selectedMiddleIds.has(topId) || selectedTopIds.has(topId)) {
    logEditAction('移動先として選択中のクラスは指定できません。', 'warn');
    return true;
  }
  // 選択した階層の全子孫を確認し、移動先が自分の配下になる循環を防ぐ。
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
  movableTopEntries.forEach(([, top]) => {
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
  unclassifiedEntries.forEach(([id, item]) => heldTopClasses.set(id, item));
  heldInstances.clear();
  heldDestinationId = '';
  hasUnsavedChanges = true;
  recordEditHistory(undoBefore, topId, 'クラス移動');
  logEditAction(`${selectedTopIds.size}件の上位クラスを中間クラス化し、合計${movedCount}件を移動しました。${hasUnclassifiedSelection ? '未分類は移動対象から除外しました。' : ''}`);
  render();
  return true;
}

function moveHeldToMiddle(middleId) {
  const movableTopEntries = [...heldTopClasses.entries()].filter(([, item]) => !isUnclassified(item));
  const unclassifiedEntries = [...heldTopClasses.entries()].filter(([, item]) => isUnclassified(item));
  const hasUnclassifiedSelection = unclassifiedEntries.length > 0;
  if (!heldMiddleClasses.size && !movableTopEntries.length && !heldInstances.size) {
    logEditAction('未分類は受け皿のため移動できません。', 'warn');
    return;
  }
  const selectedMiddleIds = new Set(heldMiddleClasses.keys());
  const selectedTopIds = new Set(movableTopEntries.map(([id]) => id));
  const selectedTargetIds = new Set(heldInstances.keys());
  const selectedIds = new Set([...selectedMiddleIds, ...selectedTopIds, ...selectedTargetIds]);
  if (!selectedIds.size) return;
  if (selectedIds.has(middleId) || [...selectedIds].some((id) => descendantIds(id).has(middleId))) {
    logEditAction('選択クラス自身またはその配下には移動できません。', 'warn');
    return;
  }

  const undoBefore = snapshotEditState();
  const convertedTopIds = new Map();
  movableTopEntries.forEach(([, top]) => {
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
  selectedTargetIds.forEach((id) => addRelation(id, middleId));
  convertedTopIds.forEach((id) => addRelation(id, middleId));
  const movedCount = selectedIds.size;
  heldMiddleClasses.clear();
  heldTopClasses.clear();
  unclassifiedEntries.forEach(([id, item]) => heldTopClasses.set(id, item));
  heldInstances.clear();
  heldDestinationId = '';
  hasUnsavedChanges = true;
  recordEditHistory(undoBefore, middleId, 'クラス移動');
  logEditAction(`${movedCount}件を中間クラス「${classById.get(middleId)?.label || ''}」へ移動しました。上位クラスは中間クラスに変更しました。${hasUnclassifiedSelection ? '未分類は移動対象から除外しました。' : ''}`);
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
// ツリーの絞り込み・描画・ツリー上の編集操作
// ============================================================
let targetConnectorLayoutFrame = 0;
let treeExactCountValues = [0];
let treeExactSelectedCount = null;
let treeCountRangeTouched = false;
let treeRenderFrame = 0;
let treeSearchDebounceTimer = 0;
let treeHierarchyEditModeEnabled = false;
// 画面には選択中の条件だけ表示し、件数条件は一度設定した後もキーワード条件と併用する。
let treeCountFilterEnabled = false;
function scheduleTargetConnectorLayout() {
  if (targetConnectorLayoutFrame) return;
  targetConnectorLayoutFrame = requestAnimationFrame(() => {
    targetConnectorLayoutFrame = 0;
    const panel = document.getElementById('edit-tree-panel');
    if (!panel) return;
    window.updateTreeStickyOffsets(panel);
    window.updateTreeTargetRowStarts(panel);
  });
}
window.addEventListener('resize', scheduleTargetConnectorLayout);

let pendingTreeViewportAnchor = null;
function captureTreeViewportAnchor(details, closeAll = false) {
  const tree = document.getElementById('edit-tree');
  if (!tree) return;
  const toolbarBottom = document.querySelector('.edit-taskbar')?.getBoundingClientRect().bottom ?? 0;
  const treeFilter = document.getElementById('tree-filter');
  const filterBottom = treeFilter && !treeFilter.hidden ? treeFilter.getBoundingClientRect().bottom : 0;
  const visibleTop = Math.max(toolbarBottom, filterBottom) + 4;
  const candidates = [...tree.querySelectorAll('.tree-top-class > summary, .tree-middle-class > summary, .tree-leaf-class')]
    .map((element) => ({ element, bounds: element.getBoundingClientRect() }))
    .filter(({ bounds }) => bounds.bottom > visibleTop && bounds.top < window.innerHeight)
    .sort((a, b) => Math.abs(a.bounds.top - visibleTop) - Math.abs(b.bounds.top - visibleTop));
  const visibleElement = candidates[0]?.element;
  const fallback = closeAll
    ? details?.closest('.tree-top-class')?.querySelector(':scope > summary')
      || tree.querySelector('.tree-top-class > summary')
    : details?.querySelector(':scope > summary');
  const anchor = visibleElement || fallback;
  if (!anchor) return;
  pendingTreeViewportAnchor = {
    details,
    closeAll,
    anchor,
    fallback,
    top: anchor.getBoundingClientRect().top
  };
}
function restoreTreeViewportAnchor(details) {
  const pending = pendingTreeViewportAnchor;
  if (!pending || (!pending.closeAll && pending.details !== details)) return;
  pendingTreeViewportAnchor = null;
  window.requestAnimationFrame(() => {
    const closedHeading = !pending.closeAll ? details?.querySelector(':scope > summary') : null;
    const anchor = closedHeading?.isConnected && closedHeading.getClientRects().length
      ? closedHeading
      : pending.anchor?.isConnected && pending.anchor.getClientRects().length
        ? pending.anchor
        : pending.fallback;
    if (!anchor?.isConnected || !anchor.getClientRects().length) return;
    const targetTop = pending.closeAll
      ? pending.top
      : Number.parseFloat(getComputedStyle(anchor).top) || 0;
    const difference = anchor.getBoundingClientRect().top - targetTop;
    if (Math.abs(difference) > 1) window.scrollBy(0, difference);
  });
}
document.getElementById('edit-tree')?.addEventListener('click', (event) => {
  const summary = event.target.closest('summary');
  const details = summary?.parentElement;
  if (!details?.matches('.tree-top-class, .tree-middle-class') || !details.open) return;
  if (event.target.closest('button, input, select, textarea, a')) return;
  captureTreeViewportAnchor(details);
}, true);

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
  const exactBubble = document.getElementById('tree-filter-count-exact-bubble');
  exactBubble.textContent = `${treeExactSelectedCount}件`;
  exactBubble.style.left = `clamp(1rem, ${(Number(exactInput.value) / Math.max(1, treeExactCountValues.length - 1)) * 100}%, calc(100% - 1rem))`;
  document.getElementById('tree-filter-count-exact-min').textContent = `${treeExactCountValues[0]}件`;
  document.getElementById('tree-filter-count-exact-max').textContent = `${treeExactCountValues.at(-1)}件`;
  minInput.max = String(treeExactCountValues.length - 1);
  maxInput.max = String(treeExactCountValues.length - 1);
  if (minInput.dataset.initialized !== 'true') {
    minInput.value = '0';
    maxInput.value = String(treeExactCountValues.length - 1);
    minInput.dataset.initialized = 'true';
    maxInput.dataset.initialized = 'true';
  } else {
    minInput.value = String(Math.min(Number(minInput.value), treeExactCountValues.length - 1));
    maxInput.value = String(Math.min(Number(maxInput.value), treeExactCountValues.length - 1));
  }
  const minRangeIndex = Math.min(Number(minInput.value), Number(maxInput.value));
  const maxRangeIndex = Math.max(Number(minInput.value), Number(maxInput.value));
  const rangeMinCount = treeExactCountValues[minRangeIndex] ?? treeExactCountValues[0];
  const rangeMaxCount = treeExactCountValues[maxRangeIndex] ?? treeExactCountValues.at(-1);
  document.getElementById('tree-filter-count-min-value').textContent = `${rangeMinCount}件`;
  document.getElementById('tree-filter-count-max-value').textContent = `${rangeMaxCount}件`;
  updateTreeRangeBubbles();
  const countMode = document.getElementById('tree-filter-count-mode').value;
  const exactCount = treeExactSelectedCount;
  // 件数条件は利用者が操作した後にのみ有効化し、初期表示で結果を隠さない。
  const countFilterActive = treeCountFilterEnabled && (countMode === 'exact'
    ? exactCount !== null
    : treeCountRangeTouched);
  const activeQuery = [...treeFilterKeywords, ...filterQuery.trim().split(/\s+/).filter(Boolean)];
  const filterActive = activeQuery.length > 0 || countFilterActive;
  const preserveHierarchy = filterActive;
  const effectiveSearchType = activeQuery.length ? filterType : 'class';
  const { targets: matchedTargets } = findTargetClasses(effectiveSearchType, activeQuery);
  const filteredTargets = matchedTargets.filter((target) =>
    (!countFilterActive || (countMode === 'exact'
      ? countTargetInstances(target.id) === exactCount
      : countTargetInstances(target.id) >= rangeMinCount
        && countTargetInstances(target.id) <= rangeMaxCount)));
  const allTargetCount = classes.filter((item) => classKind(item) === 'class').length;
  const filterHidesTargets = filteredTargets.length < allTargetCount;
  const filterCount = document.getElementById('tree-filter-count');
  filterCount.textContent = `${filteredTargets.length}件`;

  // 閲覧画面と同じ階層モデル・描画関数を使い、モードごとの差は操作UIに限定する。
  const targetIds = filterActive ? new Set(filteredTargets.map((target) => target.id)) : null;
  const model = window.buildTreeModel(data.classData, targetIds, preserveHierarchy);
  const openNodeIds = filterActive && filterHidesTargets && filteredTargets.length > 0
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
      if (heldInstances.has(item.id)) heldInstances.delete(item.id);
      else {
        heldInstances.set(item.id, item);
        heldKindView = 'target';
      }
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
    if (classKind(item) === 'middle') {
      const checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.checked = heldMiddleClasses.has(item.id);
      checkbox.disabled = false;
      middleCheckboxById.set(item.id, checkbox);
      checkbox.setAttribute('aria-label', `${item.label}を選択`);
      checkbox.addEventListener('click', (event) => event.stopPropagation());
      checkbox.addEventListener('change', () => {
        if (checkbox.checked) {
          heldMiddleClasses.set(item.id, item);
          heldKindView = 'middle';
        }
        else heldMiddleClasses.delete(item.id);
        syncTargetButtonAvailability();
        renderInstances();
      });
      levelContent.prepend(checkbox);
    }
    if (classKind(item) === 'top') {
      const checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.checked = heldTopClasses.has(item.id);
      checkbox.disabled = false;
      topCheckboxById.set(item.id, checkbox);
      checkbox.setAttribute('aria-label', isUnclassified(item)
        ? '未分類を選択（未分類自体は移動できません）'
        : `${item.label}を中間クラスとして選択`);
      checkbox.addEventListener('click', (event) => event.stopPropagation());
      checkbox.addEventListener('change', () => {
        if (checkbox.checked) {
          heldTopClasses.set(item.id, item);
          heldKindView = 'top';
        }
        else heldTopClasses.delete(item.id);
        syncTargetButtonAvailability();
        renderInstances();
      });
      levelContent.prepend(checkbox);
    }
    if (treeHierarchyEditModeEnabled && item.label !== '未分類'
      && (classKind(item) === 'top' || classKind(item) === 'middle')) {
      const actions = document.createElement('span');
      actions.className = 'tree-class-edit-actions';
      actions.addEventListener('click', (event) => event.stopPropagation());
      const rename = document.createElement('button');
      rename.type = 'button';
      rename.className = 'rename-class-button tree-class-edit-button';
      rename.textContent = '名称変更';
      rename.setAttribute('aria-label', `${item.label}の名称変更`);
      rename.addEventListener('click', (event) => {
        event.preventDefault();
        event.stopPropagation();
        renameClass(item);
      });
      const remove = document.createElement('button');
      remove.type = 'button';
      remove.className = 'delete-class-button tree-class-edit-button';
      remove.textContent = '削除';
      remove.disabled = item.label === '未分類';
      remove.setAttribute('aria-label', `${item.label}を削除`);
      remove.addEventListener('click', (event) => {
        event.preventDefault();
        event.stopPropagation();
        deleteClass(item);
      });
      actions.append(rename, remove);
      summary.append(actions);
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
    onToggle: (details) => {
      if (!details.open) restoreTreeViewportAnchor(details);
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
function scheduleTreeRender() {
  if (treeRenderFrame) return;
  treeRenderFrame = requestAnimationFrame(() => {
    treeRenderFrame = 0;
    renderTree();
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
// 保存と編集履歴
document.getElementById('save-edit-changes').addEventListener('click', saveEditChanges);

// 保持中パネルの表示タブ
document.querySelectorAll('.held-panel-mode-tab').forEach((tab) => tab.addEventListener('click', () => {
  heldPanelView = tab.dataset.heldPanelView;
  heldPanelClosed = false;
  heldPanelCollapsed = false;
  renderInstances();
}));
document.querySelectorAll('.held-kind-tab').forEach((tab) => tab.addEventListener('click', () => {
  heldKindView = tab.dataset.heldKind;
  renderInstances();
}));
document.getElementById('toggle-held-panel-collapse').addEventListener('click', () => {
  heldPanelCollapsed = !heldPanelCollapsed;
  renderInstances();
});
document.getElementById('close-held-panel').addEventListener('click', () => {
  heldPanelClosed = true;
  renderInstances();
});
const treeFilter = document.querySelector('.tree-filter');
document.getElementById('close-tree-filter').addEventListener('click', (event) => {
  event.preventDefault();
  event.stopPropagation();
  treeFilter.hidden = true;
  syncPinnedHeldPanelBounds();
  renderInstances();
});
document.getElementById('toggle-tree-filter-open').addEventListener('click', () => {
  treeFilter.hidden = false;
  syncPinnedHeldPanelBounds();
  renderInstances();
});
const heldPanel = document.getElementById('held-panel');
const heldPanelResizeHandle = document.getElementById('held-panel-resize');
const editTreeLayout = document.querySelector('#edit-tree-panel .edit-tree-layout');
if (heldPanelResizeHandle && heldPanel && editTreeLayout) {
  const minWidth = 240;
  const maxWidth = () => Math.max(minWidth, Math.min(760, window.innerWidth * 0.55, editTreeLayout.clientWidth * 0.55));
  const currentWidth = () => heldPanel.getBoundingClientRect().width || editTreeLayout.clientWidth * 0.3;
  const updateResizeValue = () => {
    heldPanelResizeHandle.setAttribute('aria-valuemax', String(Math.round(maxWidth())));
    const width = Math.round(currentWidth());
    heldPanelResizeHandle.setAttribute('aria-valuenow', String(width));
    heldPanelResizeHandle.setAttribute('aria-valuetext', `${width}ピクセル`);
  };
  const setPanelWidth = (width) => {
    const constrained = Math.round(Math.max(minWidth, Math.min(maxWidth(), width)));
    const ratio = editTreeLayout.clientWidth ? (constrained / editTreeLayout.clientWidth) * 100 : 30;
    editTreeLayout.style.setProperty('--held-panel-width', `${ratio.toFixed(2)}%`);
    updateResizeValue();
  };
  const isResizable = () => !heldPanel.hidden && !heldPanelCollapsed && window.innerWidth > 760;
  heldPanelResizeHandle.addEventListener('pointerdown', (event) => {
    if (!isResizable()) return;
    event.preventDefault();
    heldPanelResizeHandle.setPointerCapture(event.pointerId);
  });
  heldPanelResizeHandle.addEventListener('pointermove', (event) => {
    if (!heldPanelResizeHandle.hasPointerCapture(event.pointerId) || !isResizable()) return;
    setPanelWidth(heldPanel.getBoundingClientRect().right - event.clientX);
  });
  const releaseResizePointer = (event) => {
    if (heldPanelResizeHandle.hasPointerCapture(event.pointerId)) heldPanelResizeHandle.releasePointerCapture(event.pointerId);
  };
  heldPanelResizeHandle.addEventListener('pointerup', releaseResizePointer);
  heldPanelResizeHandle.addEventListener('pointercancel', releaseResizePointer);
  heldPanelResizeHandle.addEventListener('keydown', (event) => {
    if (!isResizable()) return;
    if (event.key === 'ArrowLeft') { event.preventDefault(); setPanelWidth(currentWidth() + 16); }
    else if (event.key === 'ArrowRight') { event.preventDefault(); setPanelWidth(currentWidth() - 16); }
    else if (event.key === 'Home') { event.preventDefault(); setPanelWidth(minWidth); }
    else if (event.key === 'End') { event.preventDefault(); setPanelWidth(maxWidth()); }
  });
  window.addEventListener('resize', () => {
    if (window.innerWidth > 760 && currentWidth() > maxWidth()) setPanelWidth(maxWidth());
    else updateResizeValue();
  });
  updateResizeValue();
}
if (treeFilter && heldPanel && 'ResizeObserver' in window) {
  const syncCollapsedHeldPanelHeight = () => {
    const collapsedHeight = heldPanel.querySelector('.held-panel-header')?.getBoundingClientRect().height;
    heldPanel.style.setProperty('--held-collapsed-height', `${collapsedHeight || 0}px`);
    syncPinnedHeldPanelBounds();
  };
  new ResizeObserver(syncCollapsedHeldPanelHeight).observe(treeFilter);
  const heldHeader = heldPanel.querySelector('.held-panel-header');
  if (heldHeader) new ResizeObserver(syncCollapsedHeldPanelHeight).observe(heldHeader);
  syncCollapsedHeldPanelHeight();
  const layout = document.querySelector('#edit-tree-panel .edit-tree-layout');
  if (layout) new ResizeObserver(syncPinnedHeldPanelBounds).observe(layout);
}
window.addEventListener('scroll', syncPinnedHeldPanelBounds, { passive: true });
window.addEventListener('resize', syncPinnedHeldPanelBounds);
if (heldPanel) new MutationObserver(syncPinnedHeldPanelBounds).observe(heldPanel, { attributes: true, attributeFilter: ['class', 'hidden'] });
syncPinnedHeldPanelBounds();
treeFilter?.addEventListener('toggle', () => {
  syncPinnedHeldPanelBounds();
});
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
  else moveHeldClassesToTop(heldDestinationId);
});
document.getElementById('clear-held').addEventListener('click', () => {
  if (heldKindView === 'target') {
    heldInstances.forEach((instance) => targetButtonById.get(instance.id)?.classList.remove('is-selected'));
    heldInstances.clear();
  } else if (heldKindView === 'middle') {
    heldMiddleClasses.forEach((middle) => {
      const checkbox = middleCheckboxById.get(middle.id);
      if (checkbox) checkbox.checked = false;
    });
    heldMiddleClasses.clear();
  } else {
    heldTopClasses.forEach((top) => {
      const checkbox = topCheckboxById.get(top.id);
      if (checkbox) checkbox.checked = false;
    });
    heldTopClasses.clear();
  }
  syncTargetButtonAvailability();
  renderInstances();
  const kindLabel = heldKindView === 'target' ? '対象クラス' : heldKindView === 'middle' ? '中間クラス' : '上位クラス';
  logEditAction(`保持中の${kindLabel}を解除しました。`);
});

function updateVisibleTreeSelection(select) {
  middleCheckboxById.forEach((checkbox, id) => {
    const item = classById.get(id);
    if (!item) return;
    if (select) {
      heldMiddleClasses.set(id, item);
      heldKindView = 'middle';
      checkbox.checked = true;
    } else {
      heldMiddleClasses.delete(id);
      checkbox.checked = false;
    }
  });
  topCheckboxById.forEach((checkbox, id) => {
    const item = classById.get(id);
    if (!item) return;
    if (select) {
      heldTopClasses.set(id, item);
      heldKindView = 'top';
      checkbox.checked = true;
    } else {
      heldTopClasses.delete(id);
      checkbox.checked = false;
    }
  });
  targetButtonById.forEach((button, id) => {
    const item = classById.get(id);
    if (!item) return;
    if (select) {
      heldInstances.set(id, item);
      heldKindView = 'target';
      button.classList.add('is-selected');
    } else {
      heldInstances.delete(id);
      button.classList.remove('is-selected');
    }
  });
  syncTargetButtonAvailability();
  renderInstances();
}
document.getElementById('select-visible-tree').addEventListener('click', () => updateVisibleTreeSelection(true));
document.getElementById('clear-visible-tree-selection').addEventListener('click', () => updateVisibleTreeSelection(false));

// ツリーの検索・件数フィルター
document.getElementById('tree-filter-type').addEventListener('change', () => {
  document.getElementById('tree-filter-query').placeholder = '名前・IDで検索';
  renderTree();
});
document.getElementById('tree-filter-query').addEventListener('input', () => {
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
const treeRangeSliderGroup = document.querySelector('.tree-filter-range-sliders');
let treeRangeBubbleTimer = 0;
function updateTreeRangeBubbles() {
  if (!treeRangeSliderGroup) return;
  const maxIndex = Math.max(1, treeExactCountValues.length - 1);
  const minSlider = document.getElementById('tree-filter-count-min');
  const maxSlider = document.getElementById('tree-filter-count-max');
  const startPercent = Math.min(Number(minSlider.value), Number(maxSlider.value)) / maxIndex * 100;
  const endPercent = Math.max(Number(minSlider.value), Number(maxSlider.value)) / maxIndex * 100;
  treeRangeSliderGroup.style.setProperty('--range-start', `${startPercent}%`);
  treeRangeSliderGroup.style.setProperty('--range-end', `${endPercent}%`);
  [
    { input: minSlider, bubble: document.getElementById('tree-filter-count-min-bubble') },
    { input: maxSlider, bubble: document.getElementById('tree-filter-count-max-bubble') }
  ].forEach(({ input, bubble }) => {
    const percent = (Number(input.value) / maxIndex) * 100;
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
document.getElementById('tree-filter-count-min').addEventListener('input', (event) => {
  const maxInput = document.getElementById('tree-filter-count-max');
  if (Number(event.target.value) > Number(maxInput.value)) maxInput.value = event.target.value;
  treeCountRangeTouched = true;
  showTreeRangeBubble(event.target);
  scheduleTreeRender();
});
document.getElementById('tree-filter-count-max').addEventListener('input', (event) => {
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
treeExactSlider.addEventListener('input', (event) => {
  treeExactSelectedCount = treeExactCountValues[Number(event.target.value)] ?? treeExactCountValues[0];
  document.getElementById('tree-filter-count-exact-value').textContent = `${treeExactSelectedCount}件`;
  document.getElementById('tree-filter-count-exact-bubble').textContent = `${treeExactSelectedCount}件`;
  showTreeExactBubble();
  scheduleTreeRender();
});
document.getElementById('tree-filter-count-mode').addEventListener('change', (event) => {
  const exactMode = event.target.value === 'exact';
  document.getElementById('tree-filter-count-range').hidden = exactMode;
  document.getElementById('tree-filter-count-exact').hidden = !exactMode;
  renderTree();
});

// ツリー検索はEnterごとに検索語を追加し、複数語のいずれかに一致するクラスを表示する。
function renderTreeFilterKeywords() {
  const container = document.getElementById('tree-filter-keyword-chips');
  container.replaceChildren(...treeFilterKeywords.map((term, index) => {
    const chip = document.createElement('button');
    chip.type = 'button';
    chip.className = 'search-hierarchy-selected-button';
    chip.textContent = term;
    chip.setAttribute('aria-label', '検索ワード「' + term + '」を解除');
    chip.addEventListener('click', () => {
      treeFilterKeywords.splice(index, 1);
      renderTreeFilterKeywords();
      renderTree();
    });
    return chip;
  }));
}
const treeFilterQueryInput = document.getElementById('tree-filter-query');
treeFilterQueryInput.addEventListener('keydown', (event) => {
  if (event.key !== 'Enter') return;
  event.preventDefault();
  const term = treeFilterQueryInput.value.trim();
  if (term && !treeFilterKeywords.some((existing) => existing.toLocaleLowerCase() === term.toLocaleLowerCase())) {
    treeFilterKeywords.push(term);
  }
  treeFilterQueryInput.value = '';
  renderTreeFilterKeywords();
  renderTree();
});

// 保存と初期描画

render();

// AI補助にはクラス分類のメタデータだけを渡し、個別インスタンスは公開しない。
window.classEditorAI = {
  get selectedIds() { return [...heldInstances.keys(), ...heldMiddleClasses.keys(), ...heldTopClasses.keys()]; },
  setSelectedIds(ids) {
    heldInstances.clear(); heldMiddleClasses.clear(); heldTopClasses.clear();
    (Array.isArray(ids) ? ids : []).forEach((id) => {
      const item = classById.get(id);
      if (!item) return;
      const type = classKind(item);
      if (type === 'top') heldTopClasses.set(id, item);
      else if (type === 'middle') heldMiddleClasses.set(id, item);
      else heldInstances.set(id, item);
    });
    render();
  },
  selectAll() { classes.forEach((item) => {
    const type = classKind(item);
    if (type === 'top') heldTopClasses.set(item.id, item);
    else if (type === 'middle') heldMiddleClasses.set(item.id, item);
    else heldInstances.set(item.id, item);
  }); render(); },
  clearSelection() { heldInstances.clear(); heldMiddleClasses.clear(); heldTopClasses.clear(); render(); },
  getState() {
    const children = buildChildrenMap();
    const aggregateCount = createTargetCounter(children);
    return {
      classes: classes.map((item) => ({ id: item.id, type: classKind(item), label: item.label })),
      relations: data.classData.relations.map(({ child, parent }) => ({ child, parent })),
      counts: Object.fromEntries(classes.map((item) => [item.id, aggregateCount(item.id)])),
      children: Object.fromEntries([...children.entries()].map(([id, values]) => [id, [...values]]))
    };
  },
  getScopedState(selectedIds) {
    const all = this.getState();
    const classByIdLocal = new Map(all.classes.map((item) => [item.id, item]));
    const children = buildChildrenMap();
    const parentByChild = new Map(data.classData.relations.map(({ child, parent }) => [child, parent]));
    const included = new Set();
    const editable = new Set();
    const addDescendants = (id) => {
      if (editable.has(id) || !classByIdLocal.has(id)) return;
      editable.add(id);
      included.add(id);
      (children.get(id) || []).forEach(addDescendants);
    };
    selectedIds.forEach(addDescendants);
    // 選択クラスと配下だけを編集対象にし、親階層は位置関係の文脈として加える。
    [...included].forEach((id) => {
      let parentId = parentByChild.get(id);
      const seen = new Set();
      while (parentId && !seen.has(parentId)) {
        seen.add(parentId);
        included.add(parentId);
        parentId = parentByChild.get(parentId);
      }
    });
    const scopedClasses = all.classes.filter((item) => included.has(item.id));
    return {
      selectedIds: [...selectedIds],
      editableIds: [...editable],
      classes: scopedClasses,
      relations: all.relations.filter((item) => included.has(item.child) && included.has(item.parent)),
      counts: Object.fromEntries(scopedClasses.map((item) => [item.id, all.counts[item.id] || 0]))
    };
  },
  getOverviewState() {
    const all = this.getState();
    const hierarchyClasses = all.classes.filter((item) => ['top', 'middle'].includes(item.type));
    const hierarchyIds = new Set(hierarchyClasses.map((item) => item.id));
    return {
      mode: 'overview_summary',
      selectedIds: [],
      editableIds: [],
      classes: hierarchyClasses,
      relations: all.relations.filter((item) => hierarchyIds.has(item.child) && hierarchyIds.has(item.parent)),
      counts: Object.fromEntries(hierarchyClasses.map((item) => [item.id, all.counts[item.id] || 0])),
      targetClassCount: all.classes.filter((item) => item.type === 'class').length
    };
  },
  applyOperations(operations, expectedFingerprint, editableIds = []) {
    const current = this.getState();
    const fingerprint = JSON.stringify({ classes: current.classes, relations: current.relations });
    if (fingerprint !== expectedFingerprint) throw new Error('提案作成後にクラスデータが変更されています。最新データで提案し直してください。');
    const candidateClasses = current.classes.map((item) => ({ ...item }));
    let candidateRelations = current.relations.map((item) => ({ ...item }));
    const byId = new Map(candidateClasses.map((item) => [item.id, item]));
    const editable = new Set(editableIds);
    const editableSource = (id) => {
      if (!editable.has(id)) throw new Error('選択範囲外のクラスを変更する提案は適用できません。');
    };
    const temporaryIds = new Map();
    const newClassId = (type) => {
      const prefix = type === 'top' ? 't' : 'm';
      const max = candidateClasses.reduce((value, item) => {
        const segment = String(item.id).split('/').pop();
        const match = segment.match(/^(?:new-)?[tm][_-]0*(\d+)$/);
        return match && kind(item.id) === type ? Math.max(value, Number(match[1])) : value;
      }, 0);
      return `new-${prefix}_${max + 1}`;
    };
    const addRelationCandidate = (child, parent) => {
      if (!candidateRelations.some((item) => item.child === child && item.parent === parent)) {
        candidateRelations.push({ child, parent, relation: 'subClassOf' });
      }
    };
    const resolve = (id) => temporaryIds.get(id) || id;
    operations.forEach((operation) => {
      if (!operation || typeof operation !== 'object') throw new Error('提案操作の形式が不正です。');
      if (operation.type === 'addClass') {
        if (!['top', 'middle'].includes(operation.classType) || !String(operation.label || '').trim()
          || !operation.temporaryId || temporaryIds.has(operation.temporaryId)) throw new Error('追加クラスの指定が不正です。');
        const id = newClassId(operation.classType);
        const label = String(operation.label).trim();
        if (label === '未分類') throw new Error('未分類クラスは新設できません。');
        if (candidateClasses.some((item) => item.type === operation.classType && item.label.trim() === label)) {
          throw new Error(`同じ種類の「${label}」が既にあります。`);
        }
        if (operation.classType === 'middle' && candidateClasses.some((item) => item.type === 'top' && item.label.trim() === label)) {
          throw new Error(`同名の上位クラス「${label}」があるため、中間クラスとして追加できません。`);
        }
        temporaryIds.set(operation.temporaryId, id);
        editable.add(id);
        const item = { id, type: operation.classType, label };
        candidateClasses.push(item); byId.set(id, item);
        if (operation.classType === 'middle') {
          const parent = byId.get(resolve(operation.parentId));
          if (!parent || !['top', 'middle'].includes(parent.type)) throw new Error('新しい中間クラスには上位または中間クラスの親が必要です。');
          addRelationCandidate(id, parent.id);
        } else if (operation.parentId) throw new Error('上位クラスに親は指定できません。');
        return;
      }
      if (operation.type === 'renameClass') {
        const id = resolve(operation.classId); const item = byId.get(id);
        editableSource(id);
        if (!item || !['top', 'middle'].includes(item.type) || item.label === '未分類') throw new Error('改名できるのは未分類以外の上位・中間クラスだけです。');
        const label = String(operation.label || '').trim();
        if (!label) throw new Error('クラス名を空にはできません。');
        if (label === item.label) return;
        if (label === '未分類') throw new Error('未分類クラスへの改名はできません。');
        if (candidateClasses.some((other) => other.id !== id && other.type === item.type && other.label.trim() === label)) throw new Error(`同じ種類の「${label}」が既にあります。`);
        if (item.type === 'middle' && candidateClasses.some((other) => other.type === 'top' && other.label.trim() === label)) throw new Error(`同名の上位クラス「${label}」があるため、中間クラスをその名前にできません。`);
        item.label = label; return;
      }
      if (operation.type === 'moveClass') {
        const id = resolve(operation.classId); const destinationId = resolve(operation.destinationId);
        editableSource(id);
        const item = byId.get(id); const destination = byId.get(destinationId);
        if (item && isUnclassified(item)) throw new Error('未分類は受け皿のため移動できません。');
        if (!item || !destination || !['middle', 'class'].includes(item.type)
          || !['top', 'middle'].includes(destination.type) || item.id === destination.id) throw new Error('クラスの移動先または対象が不正です。');
        const subtree = new Set([id]); const pending = [id];
        while (pending.length) (candidateRelations.filter((r) => r.parent === pending.pop()).map((r) => r.child)).forEach((child) => { if (!subtree.has(child)) { subtree.add(child); pending.push(child); } });
        if (subtree.has(destinationId)) throw new Error('自分自身または配下への移動はできません。');
        candidateRelations = candidateRelations.filter((relation) => relation.child !== id);
        addRelationCandidate(id, destinationId); return;
      }
      if (operation.type === 'moveChildren') {
        const fromId = resolve(operation.from); const toId = resolve(operation.to);
        editableSource(fromId);
        const from = byId.get(fromId); const destination = byId.get(toId);
        if (!from || from.type !== 'middle' || !destination || !['top', 'middle'].includes(destination.type)) throw new Error('配下一括移動の指定が不正です。');
        const directChildren = candidateRelations.filter((relation) => relation.parent === fromId).map((relation) => relation.child);
        if (directChildren.some((id) => !editable.has(id))) throw new Error('選択範囲外のクラスを含む一括移動はできません。');
        if (directChildren.includes(toId)) throw new Error('子孫を親として指定できません。');
        directChildren.forEach((child) => {
          candidateRelations = candidateRelations.filter((relation) => relation.child !== child);
          addRelationCandidate(child, toId);
        }); return;
      }
      if (operation.type === 'deleteClass') {
        const id = resolve(operation.classId); const item = byId.get(id);
        editableSource(id);
        if (!item || !['top', 'middle'].includes(item.type) || item.label === '未分類') throw new Error('削除できるのは未分類以外の上位・中間クラスだけです。');
        if (candidateRelations.some((relation) => relation.parent === id)) throw new Error(`「${item.label}」の配下を先に移動してください。`);
        candidateRelations = candidateRelations.filter((relation) => relation.child !== id);
        candidateClasses.splice(candidateClasses.indexOf(item), 1); byId.delete(id); return;
      }
      throw new Error(`許可されていない操作です: ${operation.type || '不明'}`);
    });
    const parentByChild = new Map();
    candidateRelations.forEach(({ child, parent }) => {
      if (!byId.has(child) || !byId.has(parent) || parentByChild.has(child)) throw new Error('存在しないクラスまたは複数の親を持つ関係があります。');
      const childType = byId.get(child).type; const parentType = byId.get(parent).type;
      if (!['middle', 'class'].includes(childType) || !['top', 'middle'].includes(parentType)) throw new Error('階層の種類が不正な親子関係があります。');
      if (byId.get(parent).label === '未分類' && childType === 'middle') throw new Error('未分類の下に中間クラスは置けません。');
      parentByChild.set(child, parent);
    });
    candidateClasses.filter((item) => ['middle', 'class'].includes(item.type)).forEach((item) => {
      if (!parentByChild.has(item.id)) throw new Error(`「${item.label}」の親クラスがありません。`);
      const visited = new Set([item.id]); let parent = parentByChild.get(item.id);
      while (parent) {
        if (visited.has(parent)) throw new Error('循環する親子関係が作られています。');
        visited.add(parent); parent = parentByChild.get(parent);
      }
    });
    return { classes: candidateClasses, relations: candidateRelations, fingerprint };
  },
  commitCandidate(candidate) {
    const before = snapshotEditState();
    classes.splice(0, classes.length, ...candidate.classes.map((item) => ({ ...item })));
    data.classData.relations = candidate.relations.map((item) => ({ ...item, relation: 'subClassOf' }));
    classById.clear(); classes.forEach((item) => classById.set(item.id, item));
    [...heldInstances.keys()].forEach((id) => {
      const item = classById.get(id);
      if (!item || classKind(item) !== 'class') heldInstances.delete(id);
      else heldInstances.set(id, item);
    });
    [...heldMiddleClasses.keys()].forEach((id) => {
      const item = classById.get(id);
      if (!item || classKind(item) !== 'middle') heldMiddleClasses.delete(id);
      else heldMiddleClasses.set(id, item);
    });
    [...heldTopClasses.keys()].forEach((id) => {
      const item = classById.get(id);
      if (!item || classKind(item) !== 'top') heldTopClasses.delete(id);
      else heldTopClasses.set(id, item);
    });
    hasUnsavedChanges = true;
    recordEditHistory(before, '', 'AI提案の適用');
    render();
  },
  render
};

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
// ツリー画面の初期化
// ============================================================
const closeAllTreeButton = document.getElementById('close-all-tree');
closeAllTreeButton.hidden = document.getElementById('edit-tree-panel').hidden;
const toggleTreeEditMode = document.getElementById('toggle-tree-edit-mode');
toggleTreeEditMode.addEventListener('click', () => {
  treeHierarchyEditModeEnabled = !treeHierarchyEditModeEnabled;
  toggleTreeEditMode.setAttribute('aria-pressed', String(treeHierarchyEditModeEnabled));
  const label = toggleTreeEditMode.querySelector('.edit-taskbar-label');
  if (label) label.textContent = `クラス編集: ${treeHierarchyEditModeEnabled ? 'ON' : 'OFF'}`;
  else toggleTreeEditMode.textContent = `クラス編集: ${treeHierarchyEditModeEnabled ? 'ON' : 'OFF'}`;
  renderTree();
});
closeAllTreeButton.addEventListener('click', () => {
  captureTreeViewportAnchor(null, true);
  document.querySelectorAll('#edit-tree-panel .tree details[open]').forEach((details) => {
    details.open = false;
  });
});
const loadingIndicator = document.getElementById('loading-indicator');
if (loadingIndicator) loadingIndicator.hidden = true;
