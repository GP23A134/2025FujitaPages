const PAGE_SIZE = 100;
const TYPE_LABEL = Object.freeze({ top: '上位', middle: '中間', class: '対象' });

export function createScopeApprovalView(dialog, editor, { messages, interactionDock } = {}) {
  if (!dialog || !editor?.getState) throw new TypeError('範囲許可画面の依存要素が不足しています。');
  const title = dialog.querySelector('[data-scope-title]');
  const summary = dialog.querySelector('[data-scope-summary]');
  const search = dialog.querySelector('[data-scope-search]');
  const list = dialog.querySelector('[data-scope-list]');
  const pageStatus = dialog.querySelector('[data-scope-page]');
  const previous = dialog.querySelector('[data-scope-previous]');
  const next = dialog.querySelector('[data-scope-next]');
  const allowButton = dialog.querySelector('[data-scope-allow]');
  const denyButton = dialog.querySelector('[data-scope-deny]');
  const closeButton = dialog.querySelector('[data-scope-close]');
  let current = null;

  function showSummary({ candidates, allowReference, allowChange, purpose, processSummary }) {
    const host = interactionDock || messages;
    if (!host) return null;
    const counts = { top: 0, middle: 0, class: 0 };
    const permissionCounts = { reference: { top: 0, middle: 0, class: 0 }, change: { top: 0, middle: 0, class: 0 } };
    candidates.forEach((item) => {
      const type = typeof item === 'string' ? null : item.type;
      if (Object.hasOwn(counts, type)) counts[type] += 1;
      if (!Object.hasOwn(counts, type)) return;
      if (item.needsReference ?? allowReference) permissionCounts.reference[type] += 1;
      if (item.needsChange ?? allowChange) permissionCounts.change[type] += 1;
    });
    const countText = [['top', '上位'], ['middle', '中間'], ['class', '対象']]
      .filter(([type]) => counts[type] > 0)
      .map(([type, label]) => `${label}クラス ${counts[type]}件`)
      .join('・') || `候補クラス ${candidates.length}件`;
    const formatCounts = (group) => Object.entries(group).filter(([, count]) => count)
      .map(([type, count]) => `${TYPE_LABEL[type]}クラス ${count}件`).join('・') || 'なし';
    const permissions = [
      (allowReference || candidates.some((item) => item.needsReference)) && `参照（${formatCounts(permissionCounts.reference)}）`,
      (allowChange || candidates.some((item) => item.needsChange)) && `変更対象（${formatCounts(permissionCounts.change)}）`
    ].filter(Boolean).join('、');
    const card = document.createElement('section');
    card.className = 'ai-scope-request-summary';
    card.setAttribute('role', 'group');
    const heading = document.createElement('strong');
    heading.textContent = '追加範囲の許可が必要です';
    const overview = document.createElement('p');
    overview.textContent = `${purpose || '選択範囲外のクラス情報が必要です。'} 候補: ${countText}。必要な許可: ${permissions || '参照'}。`;
    const continuation = document.createElement('p');
    continuation.textContent = `続ける処理: ${processSummary || '許可された範囲を使って処理を続けます。'}`;
    const actions = document.createElement('div');
    actions.className = 'ai-scope-request-actions';
    const approveButton = document.createElement('button');
    approveButton.type = 'button';
    approveButton.className = 'search-button';
    approveButton.textContent = '許可する';
    approveButton.addEventListener('click', () => finish('allow'));
    const denyButton = document.createElement('button');
    denyButton.type = 'button';
    denyButton.className = 'search-button secondary-search-button';
    denyButton.textContent = '許可しない';
    denyButton.addEventListener('click', () => finish('original_scope'));
    const detailButton = document.createElement('button');
    detailButton.type = 'button';
    detailButton.className = 'search-button secondary-search-button';
    detailButton.textContent = '詳細を見る';
    detailButton.addEventListener('click', () => {
      if (current && !dialog.open) dialog.showModal();
    });
    actions.append(denyButton, approveButton, detailButton);
    card.append(heading, overview, continuation, actions);
    host.append(card);
    if (interactionDock) interactionDock.hidden = false;
    if (!messages) return { card, approveButton, denyButton, detailButton };
    if (typeof requestAnimationFrame === 'function') {
      requestAnimationFrame(() => messages.scrollTo?.({ top: messages.scrollHeight, behavior: 'smooth' }));
    } else {
      messages.scrollTop = messages.scrollHeight;
    }
    return { card, approveButton, denyButton, detailButton };
  }

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
    const referenceIds = new Set();
    const changeIds = new Set();
    if (choice === 'allow') {
      for (const item of current.candidates) {
        if (item.needsReference) referenceIds.add(item.id);
        if (item.needsChange) changeIds.add(item.id);
      }
    }
    const result = { choice, referenceIds: [...referenceIds], changeIds: [...changeIds] };
    const resolve = current.resolve;
    current.summaryView?.card.remove();
    if (current.summaryView) {
      current.summaryView.detailButton.disabled = true;
      if (interactionDock) interactionDock.hidden = true;
    }
    if (messages) {
      const response = document.createElement('div');
      response.className = 'ai-message is-user';
      response.setAttribute('role', 'article');
      const author = document.createElement('strong');
      author.textContent = 'あなた';
      const body = document.createElement('div');
      body.className = 'ai-message-body';
      const text = document.createElement('p');
      text.textContent = choice === 'allow' ? '追加する範囲を許可します。' : '追加する範囲を許可しません。';
      body.append(text);
      response.append(author, body);
      messages.append(response);
      messages.scrollTop = messages.scrollHeight;
    }
    current = null;
    dialog.close();
    resolve(result);
  };
  allowButton.addEventListener('click', () => finish('allow'));
  denyButton.addEventListener('click', () => finish('original_scope'));
  closeButton?.addEventListener('click', () => dialog.close());
  dialog.addEventListener('cancel', (event) => { event.preventDefault(); dialog.close(); });

  function request({ candidates, allowReference, allowChange, purpose, processSummary }) {
    if (current) throw new Error('別の範囲選択が進行中です。');
    const data = editor.getState();
    const byId = new Map(data.classes.map((item) => [item.id, item]));
    const parentByChild = new Map(data.relations.map(({ child, parent }) => [child, parent]));
    const requestedById = new Map();
    candidates.forEach((candidate) => {
      const id = typeof candidate === 'string' ? candidate : candidate.id;
      const prior = requestedById.get(id) || { needsReference: false, needsChange: false };
      requestedById.set(id, {
        needsReference: prior.needsReference || (typeof candidate === 'object' && typeof candidate.needsReference === 'boolean' ? candidate.needsReference : allowReference),
        needsChange: prior.needsChange || (typeof candidate === 'object' && typeof candidate.needsChange === 'boolean' ? candidate.needsChange : allowChange)
      });
    });
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
    const normalized = [...requestedById].map(([id, permissions]) => {
      const item = byId.get(id);
      if (!item) return null;
      return {
        id,
        ...permissions,
        label: item.label,
        type: item.type,
        path: buildPath(item),
        descendantTargetClassCount: data.counts?.[id] || 0
      };
    }).filter(Boolean).sort((a, b) => a.path.localeCompare(b.path, 'ja'));

    title.textContent = '追加許可を求めている範囲';
    summary.textContent = [purpose, processSummary].filter(Boolean).join('。');
    search.value = '';
    current = {
      candidates: normalized, allowReference, allowChange, page: 0,
      resolve: null,
      summaryView: showSummary({ candidates: normalized, allowReference, allowChange, purpose, processSummary })
    };
    render();
    if (!current.summaryView) dialog.showModal();
    return new Promise((resolve) => { current.resolve = resolve; });
  }

  return Object.freeze({ request });
}
