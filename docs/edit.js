const data = window.appData;
const classes = data.classData.classes;
const relations = data.classData.relations;
const childSelect = document.getElementById('edit-child-class');
const parentSelect = document.getElementById('edit-parent-class');
const status = document.getElementById('edit-status');
const instances = classes.filter((item) => kind(item.id) === 'class');
const heldInstances = new Map();
let hasUnsavedChanges = false;

function kind(id) { return id.includes('/t_') || id.includes('new-t_') ? 'top' : id.includes('/m_') || id.includes('new-m_') ? 'middle' : 'class'; }
function fillSelect(select) {
  select.replaceChildren(...classes.map((item) => {
    const option = document.createElement('option'); option.value = item.id; option.textContent = `${item.label} (${item.id})`; return option;
  }));
}
function render() {
  fillSelect(childSelect); fillSelect(parentSelect);
  document.getElementById('edit-class-rows').replaceChildren(...classes.map((item) => {
    const row = document.createElement('tr'); row.innerHTML = `<td>${kind(item.id)}</td><td>${item.id}</td><td>${item.label}</td>`; return row;
  }));
  renderTree();
  renderInstances();
}
function renderInstances() {
  const held = document.getElementById('held-instance-list');
  const panel = document.getElementById('held-panel');
  const count = document.getElementById('held-count');
  panel.hidden = heldInstances.size === 0;
  if (count) count.textContent = `${heldInstances.size}件`;
  held.replaceChildren(...[...heldInstances.values()].map((instance) => {
    const item = document.createElement('div'); item.className = 'held-instance-item';
    item.textContent = `${instance.label || '(ラベルなし)'} (${instance.id})`;
    const remove = document.createElement('button'); remove.type = 'button'; remove.textContent = '解除';
    remove.addEventListener('click', () => { heldInstances.delete(instance.id); renderInstances(); });
    item.append(remove); return item;
  }));
}
function renderTree() {
  const tree = document.getElementById('edit-tree');
  const children = new Map();
  data.classData.relations.forEach((relation) => {
    if (!children.has(relation.parent)) children.set(relation.parent, []);
    children.get(relation.parent).push(relation.child);
  });
  const childIds = new Set(data.classData.relations.map((relation) => relation.child));
  const roots = classes.filter((item) => !childIds.has(item.id));
  const countTargets = (id) => {
    const descendants = children.get(id) || [];
    return descendants.reduce((count, childId) => count + (kind(childId) === 'class' ? 1 : countTargets(childId)), 0);
  };
  const addRow = (label, handler) => {
    const row = document.createElement('li');
    const button = document.createElement('button');
    button.type = 'button'; button.className = 'tree-add-button tree-add-row'; button.textContent = `＋ ${label}`;
    button.addEventListener('click', handler); row.append(button); return row;
  };
  const createFromTree = (type, parentId = null) => {
    const label = window.prompt(`${type === 'top' ? '上位' : type === 'middle' ? '中間' : '対象'}クラス名を入力してください`);
    if (!label || !label.trim()) return;
    const prefix = type === 'top' ? 't_' : type === 'middle' ? 'm_' : 'c_';
    const id = `new-${prefix}${String(classes.filter((item) => kind(item.id) === type).length + 1).padStart(5, '0')}`;
    const item = { id, label: label.trim() };
    classes.push(item);
    if (type === 'top') {
      const unclassifiedId = `new-m_00000-${classes.length}`;
      const unclassified = { id: unclassifiedId, label: '未分類' };
      classes.push(unclassified);
      data.classData.relations.push({ child: unclassifiedId, parent: id, relation: 'subClassOf' });
    }
    if (parentId) data.classData.relations.push({ child: id, parent: parentId, relation: 'subClassOf' });
    hasUnsavedChanges = true;
    status.textContent = `${item.label}を追加しました。`;
    render();
  };
  const build = (item, depth = 0) => {
    if (kind(item.id) === 'class') {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'tree-add-button tree-leaf-class';
      const label = document.createElement('span');
      label.className = 'tree-leaf-label';
      label.textContent = item.label;
      const id = document.createElement('span');
      id.className = 'tree-leaf-id';
      id.textContent = item.id;
      button.append(label, id);
      button.classList.toggle('is-selected', heldInstances.has(item.id));
      button.addEventListener('click', () => {
        if (heldInstances.has(item.id)) heldInstances.delete(item.id);
        else heldInstances.set(item.id, item);
        button.classList.toggle('is-selected', heldInstances.has(item.id));
        renderInstances();
        status.textContent = `${heldInstances.size}件の対象クラスを保持中です。`;
      });
      return button;
    }
    const details = document.createElement('details');
    // 親子関係が「対象クラス → 上位クラス」の2階層でも、
    // 階層の深さではなくIDの種別で上位・中間を判定する。
    details.className = kind(item.id) === 'top' ? 'tree-top-class' : 'tree-middle-class';
    details.open = true;
    const summary = document.createElement('summary');
    const button = document.createElement('button');
    button.type = 'button'; button.className = 'tree-add-button';
    button.textContent = `${item.label} (${item.id})`;
    button.addEventListener('click', () => { childSelect.value = item.id; document.getElementById('edit-form-panel').scrollIntoView(); });
    summary.append(button); details.append(summary);
    const count = document.createElement('span');
    count.className = 'count-badge edit-count';
    count.textContent = countTargets(item.id);
    summary.append(count);
    const list = document.createElement('ul');
    const childItems = (children.get(item.id) || [])
      .map((id) => classes.find((candidate) => candidate.id === id)).filter(Boolean);
    const directTargets = kind(item.id) === 'top'
      ? childItems.filter((child) => kind(child.id) === 'class') : [];
    const appendChild = (child, parentList) => {
      const li = document.createElement('li');
      li.append(build(child, depth + 1));
      parentList.append(li);
    };
    if (directTargets.length) {
      const li = document.createElement('li');
      const middleDetails = document.createElement('details');
      middleDetails.className = 'tree-middle-class';
      middleDetails.open = true;
      const middleSummary = document.createElement('summary');
      middleSummary.textContent = '未分類';
      middleDetails.append(middleSummary);
      const targetList = document.createElement('ul');
      directTargets.forEach((child) => appendChild(child, targetList));
      middleDetails.append(targetList);
      li.append(middleDetails);
      list.append(li);
    }
    childItems.filter((child) => !directTargets.includes(child))
      .forEach((child) => appendChild(child, list));
    if (kind(item.id) === 'top') list.append(addRow('中間クラスを追加', () => createFromTree('middle', item.id)));
    details.append(list); return details;
  };
  tree.replaceChildren(...roots.map((item) => build(item)));
  tree.append(addRow('上位クラスを追加', () => createFromTree('top')));
}
function download(name, lines) {
  const blob = new Blob([`\ufeff${lines.join('\r\n')}\r\n`], { type: 'text/tab-separated-values;charset=utf-8' });
  const link = document.createElement('a'); link.href = URL.createObjectURL(blob); link.download = name; link.click();
}
function saveEditChanges() {
  download('class-list.tsv', ['種類\tID\tラベル', ...classes.map((item) => `${kind(item.id)}\t${item.id.startsWith('new-') ? '' : item.id}\t${item.label}`)]);
  download('class-relation.tsv', ['子クラスID\t親クラスID', ...data.classData.relations.map((item) => `${item.child}\t${item.parent}`)]);
  status.textContent = '編集内容を保存しました。';
  hasUnsavedChanges = false;
}
document.getElementById('save-edit-changes').addEventListener('click', saveEditChanges);
document.getElementById('add-class').addEventListener('click', () => {
  const type = document.getElementById('new-class-type').value;
  const label = document.getElementById('new-class-label').value.trim();
  if (!label) return;
  const prefix = type === 'top' ? 't_' : type === 'middle' ? 'm_' : 'c_';
  const id = `new-${prefix}${String(classes.filter((item) => kind(item.id) === type).length + 1).padStart(5, '0')}`;
  classes.push({ id, label }); document.getElementById('new-class-label').value = ''; hasUnsavedChanges = true; status.textContent = `${label}を追加しました。`; render();
});
document.getElementById('apply-parent-change').addEventListener('click', () => {
  if (childSelect.value === parentSelect.value) return;
  data.classData.relations = relations.filter((item) => item.child !== childSelect.value);
  data.classData.relations.push({ child: childSelect.value, parent: parentSelect.value, relation: 'subClassOf' });
  hasUnsavedChanges = true;
  status.textContent = '親クラスを変更しました。';
});
document.getElementById('download-class-list').addEventListener('click', () => download('class-list.tsv', ['種類\tID\tラベル', ...classes.map((item) => `${kind(item.id)}\t${item.id.startsWith('new-') ? '' : item.id}\t${item.label}`)]));
document.getElementById('download-relation').addEventListener('click', () => download('class-relation.tsv', ['子クラスID\t親クラスID', ...data.classData.relations.map((item) => `${item.child}\t${item.parent}`)]));
document.getElementById('save-held-classes').addEventListener('click', () => {
  download('held-class-list.tsv', ['ID\tラベル', ...heldInstances.values().map((item) => `${item.id}\t${item.label}`)]);
  status.textContent = '保持中の対象クラスを保存しました。';
});
render();

document.getElementById('browse-link').addEventListener('click', (event) => {
  if (hasUnsavedChanges && !window.confirm('保存していない編集内容があります。保存せずに閲覧画面へ移動しますか？')) {
    event.preventDefault();
  }
});
window.addEventListener('beforeunload', (event) => {
  if (!hasUnsavedChanges) return;
  event.preventDefault();
  event.returnValue = '';
});

document.querySelectorAll('[data-edit-tab]').forEach((tab) => tab.addEventListener('click', () => {
  document.querySelectorAll('[data-edit-tab]').forEach((item) => {
    const active = item === tab;
    item.classList.toggle('is-active', active);
    item.setAttribute('aria-selected', active ? 'true' : 'false');
  });
  document.querySelectorAll('#edit-form-panel, #edit-tree-panel').forEach((panel) => {
    panel.hidden = panel.id !== tab.dataset.editTab;
  });
}));

const loadingIndicator = document.getElementById('loading-indicator');
if (loadingIndicator) loadingIndicator.hidden = true;
