// app.js が読み込んだ編集対象データを共有する。classes は同じ配列を参照するため、
// ここへ追加したクラスは保存処理とツリー表示の両方にそのまま反映される。
const data = window.appData;
const classes = data.classData.classes;
const childSelect = document.getElementById('edit-child-class');
const parentSelect = document.getElementById('edit-parent-class');
const status = document.getElementById('edit-status');
// ツリー上で選択した対象クラスを一時的に保持する。Map にすることで、
// 同じクラスの重複選択を防ぎながら、IDを使った移動処理を行える。
const heldInstances = new Map();
const heldMiddleClasses = new Map();
const searchSelected = new Map();
let hasUnsavedChanges = false;
let managementKind = 'top';
let searchDestinationId = '';

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

function createClass(type, label) {
  if (type === 'class') return null;
  // 新規IDは既存件数を基準に連番で作る。new- を付けることで、保存時に
  // まだ正式な外部IDが割り当てられていないクラスとして出力できる。
  const prefix = type === 'top' ? 't_' : type === 'middle' ? 'm_' : 'c_';
  // 件数ではなく既存IDの最大番号の次を使う。削除済みIDや欠番があると
  // 件数ベースではJava側の採番とずれ、new- IDを関係TSVから解決できなくなる。
  const serial = classes.reduce((max, item) => {
    if (kind(item.id) !== type) return max;
    const match = String(item.id).split('/').pop().match(/^[mt]_0*(\d+)$/);
    return match ? Math.max(max, Number(match[1])) : max;
  }, 0) + 1;
  const item = { id: `new-${prefix}${serial}`, label: label.trim(), type };
  classes.push(item);
  return item;
}

function addRelation(child, parent) {
  // 関係の向きは「子から親」。親変更処理では先に古い子の関係を除去してから、
  // この関数で新しい親との関係を1件追加する。
  data.classData.relations.push({ child, parent, relation: 'subClassOf' });
}

function descendantIds(id) {
  const result = new Set();
  let changed = true;
  while (changed) {
    changed = false;
    data.classData.relations.forEach((relation) => {
      if ((relation.parent === id || result.has(relation.parent)) && !result.has(relation.child)) {
        result.add(relation.child); changed = true;
      }
    });
  }
  return result;
}

function targetCount(id) {
  return [...descendantIds(id)].filter((childId) => kind(childId) === 'class').length;
}

function ensureUnclassified() {
  let top = classes.find((item) => classKind(item) === 'top' && item.label === '未分類');
  if (!top) { top = createClass('top', '未分類'); }
  let middle = classes.find((item) => classKind(item) === 'middle' && item.label === '未分類' &&
    data.classData.relations.some((relation) => relation.child === item.id && relation.parent === top.id));
  if (!middle) { middle = createClass('middle', '未分類'); addRelation(middle.id, top.id); }
  return { top, middle };
}

function moveClassMembersToUnclassified(classId) {
  const members = [...descendantIds(classId)].filter((id) => kind(id) === 'class');
  if (!members.length) return 0;
  const { middle } = ensureUnclassified();
  const memberIds = new Set(members);
  data.classData.relations = data.classData.relations.filter((relation) => !memberIds.has(relation.child));
  members.forEach((id) => addRelation(id, middle.id));
  return members.length;
}

function renderTargetSearch() {
  const input = document.getElementById('target-class-search');
  const query = input.value.trim().toLocaleLowerCase();
  const targets = classes.filter((item) => classKind(item) === 'class' &&
    (!query || `${item.label} ${item.id}`.toLocaleLowerCase().includes(query)));
  const result = document.getElementById('target-search-results');
  result.replaceChildren(...targets.map((item) => {
    const label = document.createElement('label'); label.className = 'target-search-option';
    const checkbox = document.createElement('input'); checkbox.type = 'checkbox'; checkbox.checked = searchSelected.has(item.id); checkbox.dataset.classId = item.id;
    checkbox.addEventListener('change', () => checkbox.checked ? searchSelected.set(item.id, item) : searchSelected.delete(item.id));
    const text = document.createElement('span'); text.textContent = `${item.label} (${displayClassId(item.id)})`;
    label.append(checkbox, text); return label;
  }));
  document.getElementById('target-search-count').textContent = `${targets.length}件中 ${searchSelected.size}件を選択中`;
}

function renderClassManagement() {
  const list = document.getElementById('class-management-list');
  if (!list) return;
  const managed = classes.filter((item) => classKind(item) === managementKind)
    .map((item) => ({ item, count: targetCount(item.id) }))
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
        childIds.forEach((childId) => { if (classes.some((candidate) => candidate.id === childId)) addRelation(childId, top.id); });
      }
      const index = classes.indexOf(item); if (index >= 0) classes.splice(index, 1);
      heldMiddleClasses.delete(item.id); hasUnsavedChanges = true;
      status.textContent = `${item.label}を削除しました。${moved}件を未分類へ移動しました。`; render();
    });
    actions.append(rename, button); row.append(info, actions); return row;
  }));
}

// 子クラス・親クラスの選択欄を現在のクラス配列から作り直す。
function fillSelect(select) {
  select.replaceChildren(...classes.map((item) => {
    const option = document.createElement('option'); option.value = item.id; option.textContent = `${item.label} (${displayClassId(item.id)})`; return option;
  }));
}
function render() {
  // クラス追加や親変更の後は、選択欄・一覧・ツリー・保持中パネルをまとめて
  // 更新する。個別の表示だけを更新すると、各画面の内容がずれるためである。
  fillSelect(childSelect); fillSelect(parentSelect);
  const searchTargetKind = document.getElementById('search-target-kind');
  const searchMiddle = document.getElementById('search-target-middle');
  const selectedKind = searchTargetKind.value;
  searchMiddle.parentElement.firstChild.textContent = selectedKind === 'top' ? '付与先の上位クラス' : '付与先の中間クラス';
  searchMiddle.replaceChildren(...classes.filter((item) => classKind(item) === selectedKind).map((item) => {
    const option = document.createElement('option'); option.value = item.id; option.textContent = `${item.label} (${displayClassId(item.id)})`; return option;
  }));
  const newParent = document.getElementById('search-new-class-parent');
  const parentKind = document.getElementById('search-new-class-parent-kind').value;
  newParent.parentElement.firstChild.textContent = `保存先の${parentKind === 'top' ? '上位' : '中間'}クラス`;
  newParent.replaceChildren(...classes.filter((item) => classKind(item) === parentKind).map((item) => {
    const option = document.createElement('option'); option.value = item.id; option.textContent = `${item.label} (${displayClassId(item.id)})`; return option;
  }));
  newParent.parentElement.hidden = selectedKind !== 'middle';
  document.getElementById('edit-class-rows').replaceChildren(...classes.map((item) => {
    const row = document.createElement('tr');
    [classKind(item), displayClassId(item.id), item.label].forEach((value) => {
      const cell = document.createElement('td');
      cell.textContent = value;
      row.append(cell);
    });
    return row;
  }));
  renderTree();
  renderInstances();
  renderTargetSearch();
  renderClassManagement();
}
function renderInstances() {
  // 保持中の対象クラスがある場合だけサイドパネルと移動用ボタンを表示する。
  // 解除操作後もこの関数だけを呼べば、件数と表示状態を同期できる。
  const held = document.getElementById('held-instance-list');
  const panel = document.getElementById('held-panel');
  const count = document.getElementById('held-count');
  panel.hidden = heldInstances.size === 0 && heldMiddleClasses.size === 0;
  if (count) count.textContent = `${heldInstances.size + heldMiddleClasses.size}件`;
  document.querySelectorAll('.move-held-button').forEach((button) => {
    button.hidden = heldInstances.size === 0;
  });
  document.querySelectorAll('.tree-leaf-class[data-instance-id]').forEach((button) => {
    button.classList.toggle('is-selected', heldInstances.has(button.dataset.instanceId));
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
    remove.addEventListener('click', () => { heldInstances.delete(instance.id); renderInstances(); });
    item.append(remove); return item;
  }), ...[...heldMiddleClasses.values()].map((middle) => {
    const item = document.createElement('div'); item.className = 'held-instance-item';
    item.textContent = `中間: ${middle.label}`;
    const remove = document.createElement('button'); remove.type = 'button'; remove.textContent = '解除';
    remove.addEventListener('click', () => { heldMiddleClasses.delete(middle.id); renderInstances(); });
    item.append(remove); return item;
  }));
}
function renderTree() {
  const tree = document.getElementById('edit-tree');

  // 関係配列を親IDから子IDへの検索用Mapに変換する。ツリーの描画中に
  // 毎回全クラスを検索せずに済むため、階層が大きくても処理を追いやすい。
  const children = new Map();
  data.classData.relations.forEach((relation) => {
    if (!children.has(relation.parent)) children.set(relation.parent, []);
    children.get(relation.parent).push(relation.child);
  });
  // どの関係でも子になっていないクラスをツリーの起点として扱う。
  const childIds = new Set(data.classData.relations.map((relation) => relation.child));
  const roots = classes.filter((item) => !childIds.has(item.id));
  const countTargets = (id) => {
    // 中間クラスを含む子孫を再帰的にたどり、配下の対象クラス数だけを数える。
    // 上位クラス直下の対象クラスも、1件の対象として正しく集計される。
    const descendants = children.get(id) || [];
    return descendants.reduce((count, childId) => count + (kind(childId) === 'class' ? 1 : countTargets(childId)), 0);
  };
  const addRow = (label, handler) => {
    const row = document.createElement('li');
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'tree-add-button tree-add-row';
    button.textContent = `＋ ${label}`;
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
  const moveHeldMiddlesToTop = (topId) => {
    if (!heldMiddleClasses.size) return false;
    const selected = new Set(heldMiddleClasses.keys());
    if (selected.has(topId)) return false;
    const descendants = new Set(selected);
    let changed = true;
    while (changed) {
      changed = false;
      data.classData.relations.forEach((relation) => {
        if (descendants.has(relation.parent) && !descendants.has(relation.child)) {
          descendants.add(relation.child); changed = true;
        }
      });
    }
    if (descendants.has(topId)) { status.textContent = '子孫の中間クラスへは移動できません。'; return true; }
    data.classData.relations = data.classData.relations.filter((relation) => !selected.has(relation.child));
    selected.forEach((middleId) => addRelation(middleId, topId));
    heldMiddleClasses.clear(); hasUnsavedChanges = true;
    status.textContent = `${selected.size}件の中間クラスを移動しました。`;
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
  const createFromTree = (type, parentId = null) => {
    const label = window.prompt(`${type === 'middle' ? '中間' : '対象'}クラス名を入力してください`);
    if (!label || !label.trim()) return;
    const item = createClass(type, label);
    if (parentId) addRelation(item.id, parentId);
    if (heldInstances.size) {
      const selectedIds = [...heldInstances.keys()];
      data.classData.relations = data.classData.relations.filter((relation) => !selectedIds.includes(relation.child));
      if (type === 'middle') {
        selectedIds.forEach((child) => addRelation(child, item.id));
      } else if (type === 'top') {
        const unclassified = createClass('middle', '未分類');
        addRelation(unclassified.id, item.id);
        selectedIds.forEach((child) => addRelation(child, unclassified.id));
      }
      heldInstances.clear();
      status.textContent = `${item.label}を追加し、保持中の対象クラスを移動しました。`;
    }
    hasUnsavedChanges = true;
    if (!status.textContent.includes('移動しました')) status.textContent = `${item.label}を追加しました。`;
    render();
  };
  const build = (item) => {
    // 対象クラスは選択可能な葉として描画し、上位・中間クラスは details として
    // 描画する。details の初期状態は上位だけを開き、最初の画面を見やすくする。
    if (classKind(item) === 'class') {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'tree-add-button tree-leaf-class';
      button.dataset.instanceId = item.id;
      button.disabled = heldMiddleClasses.size > 0;
      button.title = button.disabled ? '中間クラス選択中は対象クラスを選択できません' : '';
      const label = document.createElement('span');
      label.className = 'tree-leaf-label';
      label.textContent = item.label;
      const id = document.createElement('span');
      id.className = 'tree-leaf-id';
      id.textContent = displayClassId(item.id);
      button.append(id, label);
      button.classList.toggle('is-selected', heldInstances.has(item.id));
      button.addEventListener('click', () => {
        if (heldMiddleClasses.size) return;
        // 対象クラスはクリックするたびに保持・解除を切り替える。表示更新は
        // 保持中パネルにも必要なので、選択状態の変更後にrenderInstancesを呼ぶ。
        if (heldInstances.has(item.id)) heldInstances.delete(item.id);
        else heldInstances.set(item.id, item);
        button.classList.toggle('is-selected', heldInstances.has(item.id));
        renderInstances();
        status.textContent = `${heldInstances.size}件の対象クラスを保持中です。`;
      });
      return button;
    }
    const details = document.createElement('details');
    details.className = classKind(item) === 'top' ? 'tree-top-class' : 'tree-middle-class';
    details.open = classKind(item) === 'top';
    const summary = document.createElement('summary');
    const levelContent = document.createElement('div');
    levelContent.className = 'tree-level-content';
    const label = document.createElement('span');
    label.className = 'tree-level-label';
    label.textContent = item.label;
    const count = document.createElement('span');
    count.className = 'count-badge edit-count';
    count.textContent = countTargets(item.id);
    const id = document.createElement('span');
    id.className = 'tree-level-id';
    id.textContent = displayClassId(item.id);
    levelContent.append(label, count, id);
    if (classKind(item) === 'middle' && item.label !== '未分類') {
      const checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.checked = heldMiddleClasses.has(item.id);
      checkbox.setAttribute('aria-label', `${item.label}を選択`);
      checkbox.addEventListener('click', (event) => event.stopPropagation());
      checkbox.addEventListener('change', () => {
        if (checkbox.checked) heldMiddleClasses.set(item.id, item);
        else heldMiddleClasses.delete(item.id);
        render();
      });
      levelContent.prepend(checkbox);
    }
    summary.append(levelContent);
    if (classKind(item) === 'middle') {
      // 中間クラスの「＋」は、保持中の対象クラスをこの中間クラスへ移動する操作。
      // 対象が未選択のときは renderInstances がボタンを隠す。
      const moveButton = addTreeButton('＋', () => moveHeldToMiddle(item.id));
      moveButton.classList.add('move-held-button');
      moveButton.setAttribute('aria-label', 'ここへ移動');
      moveButton.title = '保持中の対象クラスをここへ移動';
      summary.append(moveButton);
    }
    details.append(summary);
    const list = document.createElement('ul');
    list.className = 'tree-level-rows';
    const childItems = (children.get(item.id) || [])
      .map((id) => classes.find((candidate) => candidate.id === id)).filter(Boolean);
    const directTargets = childItems.filter((child) => classKind(child) === 'class');
    const childMiddles = childItems.filter((child) => classKind(child) === 'middle');
    const appendChild = (child, parentList) => {
      const li = document.createElement('li');
      li.append(build(child));
      parentList.append(li);
    };
    if (classKind(item) === 'middle' && item.label !== '未分類') {
      list.append(addRow('中間クラスを追加', () => createFromTree('middle', item.id)));
    }
    if (classKind(item) === 'top') {
      list.append(addRow(heldMiddleClasses.size ? '選択中の中間クラスを移動' : '中間クラスを追加', () =>
        moveHeldMiddlesToTop(item.id) || createFromTree('middle', item.id)));
    }
    if (childMiddles.length) {
      const middleRow = document.createElement('li');
      middleRow.className = 'tree-child-middle-row';
      const middleList = document.createElement('ul');
      middleList.className = 'tree-child-middle-list';
      childMiddles.forEach((child) => appendChild(child, middleList));
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
      // 上位クラス直下の対象クラスは、通常の中間クラスの下側に
      // 表示上の「未分類」グループとして配置する。
      const li = document.createElement('li');
      const middleDetails = document.createElement('details');
      middleDetails.className = 'tree-middle-class';
      middleDetails.open = false;
      const middleSummary = document.createElement('summary');
      middleSummary.textContent = '未分類';
      middleDetails.append(middleSummary);
      const targetList = document.createElement('ul');
      directTargets.forEach((child) => appendChild(child, targetList));
      middleDetails.append(targetList);
      li.append(middleDetails);
      list.append(li);
    }
    details.append(list);
    return details;
  };
  const topRows = roots.map((item) => build(item));
  topRows.push(addRow('上位クラスを追加', () => createFromTree('top')));
  tree.replaceChildren(...topRows);
}
function download(name, lines) {
  // TSVはExcel等でも文字化けしにくいようUTF-8 BOM付きで作り、ブラウザーの
  // 一時的なObject URLを使ってダウンロードを開始する。
  const blob = new Blob([`\ufeff${lines.join('\r\n')}\r\n`], { type: 'text/tab-separated-values;charset=utf-8' });
  const link = document.createElement('a'); link.href = URL.createObjectURL(blob); link.download = name; link.click();
}
function saveEditChanges() {
  // クラス一覧と関係一覧を別ファイルで保存する。保存成功後だけ未保存フラグを解除し、
  // ブラウザー移動時の警告が出ない状態にする。
  download('class-list.tsv', ['種類\tID\tラベル', ...classes.map((item) => `${kind(item.id)}\t${item.id.startsWith('new-') ? '' : item.id}\t${item.label}`)]);
  download('class-relation.tsv', ['子クラスID\t親クラスID', ...data.classData.relations.map((item) => `${item.child}\t${item.parent}`)]);
  status.textContent = '編集内容を保存しました。';
  hasUnsavedChanges = false;
}
document.getElementById('save-edit-changes').addEventListener('click', saveEditChanges);
document.getElementById('clear-held').addEventListener('click', () => {
  heldInstances.clear();
  heldMiddleClasses.clear();
  renderInstances();
  status.textContent = '保持中の対象クラスをすべて解除しました。';
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
  data.classData.relations = data.classData.relations.filter((relation) => !selected.includes(relation.child));
  topIds.forEach((topId) => {
    let middle = classes.find((item) => classKind(item) === 'middle' && item.label === '未分類' &&
      data.classData.relations.some((relation) => relation.child === item.id && relation.parent === topId));
    if (!middle) { middle = createClass('middle', '未分類'); addRelation(middle.id, topId); }
    selected.filter((child) => topByChild(child) === topId || !topByChild(child)).forEach((child) => addRelation(child, middle.id));
  });
  heldInstances.clear(); hasUnsavedChanges = true; status.textContent = `${selected.length}件を未分類へ移動しました。`; render();
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
  const descendants = new Set([parentSelect.value]);
  let changed = true;
  while (changed) {
    changed = false;
    data.classData.relations.forEach((relation) => {
      if (descendants.has(relation.parent) && !descendants.has(relation.child)) { descendants.add(relation.child); changed = true; }
    });
  }
  if (descendants.has(parentSelect.value)) { status.textContent = '循環する親子関係は設定できません。'; return; }
  data.classData.relations = data.classData.relations.filter((item) => item.child !== childSelect.value);
  addRelation(childSelect.value, parentSelect.value);
  hasUnsavedChanges = true;
  status.textContent = '親クラスを変更しました。';
});
document.getElementById('target-class-search').addEventListener('input', renderTargetSearch);
document.getElementById('search-target-kind').addEventListener('change', render);
document.getElementById('search-new-class-parent-kind').addEventListener('change', render);
document.getElementById('select-search-results').addEventListener('click', () => {
  document.querySelectorAll('#target-search-results input[type="checkbox"]').forEach((checkbox) => {
    checkbox.checked = true;
    const option = classes.find((item) => item.id === checkbox.dataset.classId);
    if (option) searchSelected.set(option.id, option);
  });
  renderTargetSearch();
});
document.getElementById('clear-search-selection').addEventListener('click', () => { searchSelected.clear(); renderTargetSearch(); });
document.getElementById('apply-search-middle').addEventListener('click', () => {
  const middleId = document.getElementById('search-target-middle').value;
  if (!middleId || !searchSelected.size) { status.textContent = '対象クラスと付与先を選択してください。'; return; }
  const selectedIds = [...searchSelected.keys()];
  data.classData.relations = data.classData.relations.filter((relation) => !selectedIds.includes(relation.child));
  selectedIds.forEach((id) => addRelation(id, middleId));
  const count = selectedIds.length; searchSelected.clear(); hasUnsavedChanges = true;
  status.textContent = `${count}件を中間クラスへ付与しました。`; render();
});
document.getElementById('create-search-class').addEventListener('click', () => {
  if (!searchSelected.size) { status.textContent = '先に対象クラスを選択してください。'; return; }
  const label = document.getElementById('search-new-class-label').value.trim();
  if (!label) { status.textContent = '新しいクラス名を入力してください。'; return; }
  const selectedIds = [...searchSelected.keys()];
  const newKind = document.getElementById('search-target-kind').value;
  const item = createClass(newKind, label);
  let parentId = null;
  if (newKind === 'middle') {
    parentId = document.getElementById('search-new-class-parent').value;
    if (parentId) addRelation(item.id, parentId);
  }
  data.classData.relations = data.classData.relations.filter((relation) => !selectedIds.includes(relation.child));
  selectedIds.forEach((id) => addRelation(id, item.id));
  const count = selectedIds.length; searchSelected.clear();
  document.getElementById('search-new-class-label').value = '';
  hasUnsavedChanges = true; status.textContent = `${count}件を「${label}」へ付与しました。`; render();
});
document.getElementById('download-class-list').addEventListener('click', () => download('class-list.tsv', ['種類\tID\tラベル', ...classes.map((item) => `${kind(item.id)}\t${item.id.startsWith('new-') ? '' : item.id}\t${item.label}`)]));
document.getElementById('download-relation').addEventListener('click', () => download('class-relation.tsv', ['子クラスID\t親クラスID', ...data.classData.relations.map((item) => `${item.child}\t${item.parent}`)]));
render();

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
}));
document.querySelectorAll('[data-management-kind]').forEach((tab) => tab.addEventListener('click', () => {
  managementKind = tab.dataset.managementKind;
  document.querySelectorAll('[data-management-kind]').forEach((item) => item.classList.toggle('is-active', item === tab));
  renderClassManagement();
}));

const loadingIndicator = document.getElementById('loading-indicator');
if (loadingIndicator) loadingIndicator.hidden = true;
