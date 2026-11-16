const PAGE_SIZE = 100;
const TYPE_LABEL = Object.freeze({ top: '上位', middle: '中間', class: '対象' });

export function createScopeApprovalView(dialog, editor) {
  if (!dialog || !editor?.getState) throw new TypeError('範囲許可画面の依存要素が不足しています。');
  const title = dialog.querySelector('[data-scope-title]');
  const summary = dialog.querySelector('[data-scope-summary]');
  const search = dialog.querySelector('[data-scope-search]');
  const list = dialog.querySelector('[data-scope-list]');
  const pageStatus = dialog.querySelector('[data-scope-page]');
  const previous = dialog.querySelector('[data-scope-previous]');
  const next = dialog.querySelector('[data-scope-next]');
  const referenceToggle = dialog.querySelector('[data-scope-reference]');
  const changeToggle = dialog.querySelector('[data-scope-change]');
  const allowButton = dialog.querySelector('[data-scope-allow]');
  const originalButton = dialog.querySelector('[data-scope-original]');
  const cancelButton = dialog.querySelector('[data-scope-cancel]');
  let current = null;

  function render() {
    if (!current) return;
    const query = search.value.trim().toLocaleLowerCase('ja');
    const filtered = current.candidates.filter((item) => !query
      || item.label.toLocaleLowerCase('ja').includes(query)
      || item.path.toLocaleLowerCase('ja').includes(query));
    const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
    current.page = Math.min(current.page, pageCount - 1);
    const pageItems = filtered.slice(current.page * PAGE_SIZE, (current.page + 1) * PAGE_SIZE);
    list.replaceChildren();
    for (const item of pageItems) {
      const row = document.createElement('div');
      row.className = 'assistant-scope-row';
      const description = document.createElement('div');
      description.className = 'assistant-scope-class';
      const name = document.createElement('strong');
      name.textContent = item.label || '(名称なし)';
      const meta = document.createElement('small');
      const count = item.type === 'class' ? '' : `・配下の対象クラス ${item.descendantTargetClassCount}件`;
      meta.textContent = `${item.path || TYPE_LABEL[item.type] || item.type}${count}`;
      description.append(name, meta);
      row.append(description);
      for (const [permission, enabled] of [['reference', current.allowReference], ['change', current.allowChange]]) {
        const label = document.createElement('label');
        label.className = 'assistant-scope-choice';
        label.hidden = !enabled;
        const checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.disabled = !enabled;
        checkbox.checked = current.selections[permission].has(item.id);
        checkbox.addEventListener('change', () => {
          const subtree = [item.id];
          const pending = [...(current.childrenByParent.get(item.id) || [])];
          const seen = new Set(subtree);
          while (pending.length) {
            const childId = pending.pop();
            if (seen.has(childId)) continue;
            seen.add(childId);
            subtree.push(childId);
            pending.push(...(current.childrenByParent.get(childId) || []));
          }
          subtree.forEach((id) => {
            if (checkbox.checked) current.selections[permission].add(id);
            else current.selections[permission].delete(id);
          });
        });
        label.append(checkbox, document.createTextNode(permission === 'reference' ? '参照' : '変更対象'));
        row.append(label);
      }
      list.append(row);
    }
    pageStatus.textContent = `${filtered.length ? current.page * PAGE_SIZE + 1 : 0}〜${Math.min((current.page + 1) * PAGE_SIZE, filtered.length)}件 / ${filtered.length}件`;
    previous.disabled = current.page === 0;
    next.disabled = current.page >= pageCount - 1;
  }

  previous.addEventListener('click', () => { current.page -= 1; render(); });
  next.addEventListener('click', () => { current.page += 1; render(); });
  search.addEventListener('input', () => { current.page = 0; render(); });

  const finish = (choice) => {
    if (!current) return;
    const result = {
      choice,
      referenceIds: choice === 'allow' ? [...current.selections.reference] : [],
      changeIds: choice === 'allow' ? [...current.selections.change] : []
    };
    const resolve = current.resolve;
    current = null;
    dialog.close();
    resolve(result);
  };
  allowButton.addEventListener('click', () => finish('allow'));
  originalButton.addEventListener('click', () => finish('original_scope'));
  cancelButton.addEventListener('click', () => finish('cancel'));
  dialog.addEventListener('cancel', (event) => { event.preventDefault(); finish('cancel'); });

  function request({ candidates, allowReference, allowChange, purpose, processSummary }) {
    if (current) throw new Error('別の範囲選択が進行中です。');
    const data = editor.getState();
    const byId = new Map(data.classes.map((item) => [item.id, item]));
    const parentByChild = new Map(data.relations.map(({ child, parent }) => [child, parent]));
    const childrenByParent = new Map();
    data.relations.forEach(({ child, parent }) => {
      if (!childrenByParent.has(parent)) childrenByParent.set(parent, []);
      childrenByParent.get(parent).push(child);
    });
    const requestedIds = new Set(candidates.map((item) => typeof item === 'string' ? item : item.id));
    const buildPath = (item) => {
      const labels = [item.label];
      let parentId = parentByChild.get(item.id);
      const seen = new Set([item.id]);
      while (parentId && !seen.has(parentId)) {
        seen.add(parentId);
        const parent = byId.get(parentId);
        if (!parent) break;
        labels.unshift(parent.label);
        parentId = parentByChild.get(parentId);
      }
      return labels.join(' › ');
    };
    const normalized = [...requestedIds].map((id) => byId.get(id)).filter(Boolean).map((item) => ({
      id: item.id,
      label: item.label,
      type: item.type,
      path: buildPath(item),
      descendantTargetClassCount: data.counts?.[item.id] || 0
    })).sort((a, b) => a.path.localeCompare(b.path, 'ja'));

    title.textContent = allowReference && allowChange
      ? '追加する参照・変更範囲を選択'
      : allowReference ? '追加する参照範囲を選択' : '追加する変更範囲を選択';
    summary.textContent = [purpose, processSummary].filter(Boolean).join('。');
    referenceToggle.hidden = !allowReference;
    changeToggle.hidden = !allowChange;
    search.value = '';
    current = {
      candidates: normalized, allowReference, allowChange, page: 0, childrenByParent,
      selections: { reference: new Set(), change: new Set() }, resolve: null
    };
    render();
    dialog.showModal();
    return new Promise((resolve) => { current.resolve = resolve; });
  }

  return Object.freeze({ request });
}
