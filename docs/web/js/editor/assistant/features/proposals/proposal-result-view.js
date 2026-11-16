export function createProposalResultView(root, { onPreview, onAnswerQuestions, onSelectAlternative = () => {} }) {
  const resultStates = new WeakMap();
  const itemRows = new WeakMap();
  let nextResultId = 0;

  const statusOf = (state, item) => ['applied', 'dismissed'].includes(state.statuses.get(item))
    ? state.statuses.get(item) : 'unjudged';
  const updateStatusCounts = (message, state) => {
    const counts = { unjudged: 0, applied: 0, dismissed: 0 };
    state.result.proposals.forEach((item) => { counts[statusOf(state, item)] += 1; });
    message.querySelector('[data-proposal-status-counts]')?.replaceChildren(...[
      ['unjudged', '未判断', counts.unjudged],
      ['applied', '適用済み', counts.applied],
      ['dismissed', '見送り', counts.dismissed]
    ].map(([key, label, count]) => {
      const badge = document.createElement('span');
      badge.className = `ai-proposal-status-badge is-${key}`;
      badge.textContent = `${label} ${count}件`;
      return badge;
    }));
  };

  const canPreview = (state, item) => !item.proposal.questions.length
    && (!state.groupByProposal.get(item.proposal.id)
      || state.selectedAlternatives.get(state.groupByProposal.get(item.proposal.id).id) === item.proposal.id);

  root.addEventListener('click', async (event) => {
    const message = event.target.closest('[data-assistant-proposal-result]');
    if (!message || !root.contains(message)) return;
    const state = resultStates.get(message);
    if (!state) return;

    const choice = event.target.closest('[data-alternative-group]');
    if (choice) {
      state.selectedAlternatives.set(choice.dataset.alternativeGroup, choice.value);
      onSelectAlternative(choice.dataset.alternativeGroup, choice.value);
      message.querySelectorAll(`[data-alternative-choice="${CSS.escape(choice.dataset.alternativeGroup)}"]`).forEach((input) => {
        const item = state.result.proposals.find((candidate) => candidate.proposal.id === input.value);
        const row = itemRows.get(item);
        const preview = row?.querySelector('[data-preview-proposal]');
        if (preview) preview.disabled = !canPreview(state, item);
      });
      const firstPreview = message.querySelector('[data-preview-first]');
      if (firstPreview) firstPreview.disabled = !state.result.proposals.some((item) => canPreview(state, item));
      return;
    }
    const preview = event.target.closest('[data-preview-proposal]');
    if (preview) {
      const item = state.result.proposals.find((candidate) => candidate.proposal.id === preview.dataset.previewProposal);
      if (item && canPreview(state, item)) onPreview(item);
      return;
    }
    if (event.target.closest('[data-preview-first]')) {
      const item = state.result.proposals.find((candidate) => canPreview(state, candidate));
      if (item) onPreview(item);
      return;
    }
    const answer = event.target.closest('[data-answer-proposal]');
    if (answer) {
      const item = state.result.proposals.find((candidate) => candidate.proposal.id === answer.dataset.answerProposal);
      if (item) await onAnswerQuestions(item.proposal);
      return;
    }
  });

  function render(result) {
    root.querySelectorAll('[data-assistant-proposal-result]:not([data-archived])').forEach((message) => {
      message.dataset.archived = 'true';
      message.querySelectorAll('button, input').forEach((control) => { control.disabled = true; });
    });

    const message = document.createElement('div');
    message.className = 'ai-message assistant-proposal-result-message';
    message.dataset.assistantProposalResult = 'true';
    message.dataset.proposalResultId = String(++nextResultId);
    message.setAttribute('role', 'article');
    const body = document.createElement('div');
    body.className = 'ai-message-body';
    message.append(body);
    const state = {
      result,
      selectedAlternatives: new Map(),
      statuses: new Map((result.proposals || []).map((item) => [item, item.status || 'unjudged'])),
      groupByProposal: new Map()
    };
    resultStates.set(message, state);

    const summary = document.createElement('p');
    summary.textContent = result.message || '処理が完了しました。';
    body.append(summary);
    if (result.blocked?.length) {
      const list = document.createElement('ul');
      result.blocked.forEach((item) => {
        const row = document.createElement('li');
        row.textContent = `${item.proposalId ? `${item.proposalId}: ` : ''}${item.reason}`;
        list.append(row);
      });
      body.append(list);
    }
    if (!result.proposals?.length) {
      root.append(message);
      messagesScrollToLatest();
      return;
    }

    const queue = document.createElement('section');
    queue.className = 'ai-proposal-queue ai-proposal-queue-compact';
    const heading = document.createElement('div');
    heading.className = 'ai-proposal-queue-heading';
    const disclosure = document.createElement('details');
    disclosure.className = 'ai-proposal-queue-disclosure';
    disclosure.open = false;
    const queueTitle = document.createElement('span');
    queueTitle.className = 'ai-proposal-queue-title';
    queueTitle.textContent = `変更案 ${result.proposals.length}件`;
    const badges = document.createElement('span');
    badges.className = 'ai-proposal-queue-status-counts';
    badges.dataset.proposalStatusCounts = 'true';
    const disclosureSummary = document.createElement('summary');
    disclosureSummary.append(queueTitle, badges);
    const content = document.createElement('div');
    content.className = 'ai-proposal-queue-content';
    const list = document.createElement('div');
    list.className = 'ai-proposal-list';
    const previewAll = document.createElement('button');
    previewAll.type = 'button';
    previewAll.className = 'ai-proposal-preview ai-proposal-queue-preview';
    previewAll.dataset.previewFirst = 'true';
    previewAll.textContent = 'プレビュー';
    previewAll.disabled = !result.proposals.some((item) => canPreview(state, item));

    (result.alternativeGroups || []).forEach((group) => {
      group.proposalIds.forEach((id) => state.groupByProposal.set(id, group));
    });
    result.proposals.forEach((item) => {
      const status = statusOf(state, item);
      const row = document.createElement('article');
      row.className = `ai-proposal-list-item is-${status}`;
      itemRows.set(item, row);
      const main = document.createElement('div');
      main.className = 'ai-proposal-list-main';
      const meta = document.createElement('div');
      meta.className = 'ai-proposal-list-meta';
      const title = document.createElement('strong');
      title.className = 'ai-proposal-list-title';
      title.textContent = item.proposal.title;
      meta.append(title);
      const description = document.createElement('p');
      description.className = 'ai-proposal-list-description';
      description.textContent = item.proposal.summary;
      main.append(meta, description);
      const actions = document.createElement('div');
      actions.className = 'ai-proposal-list-actions';
      const badge = document.createElement('span');
      badge.className = `ai-proposal-status-badge is-${status}`;
      badge.dataset.proposalStatus = 'true';
      badge.textContent = ({ unjudged: '未判断', applied: '適用済み', dismissed: '見送り' })[status] || '未判断';
      actions.append(badge);
      const group = state.groupByProposal.get(item.proposal.id);
      if (group) {
        const radio = document.createElement('input');
        radio.type = 'radio';
        radio.name = `alternative-${message.dataset.proposalResultId}-${group.id}`;
        radio.value = item.proposal.id;
        radio.dataset.alternativeGroup = group.id;
        radio.dataset.alternativeChoice = group.id;
        actions.append(radio);
      }
      const preview = document.createElement('button');
      preview.type = 'button';
      preview.className = 'ai-proposal-preview';
      preview.dataset.previewProposal = item.proposal.id;
      preview.textContent = item.proposal.questions.length ? '回答が必要' : 'プレビュー';
      preview.disabled = !canPreview(state, item);
      actions.append(preview);
      row.append(main, actions);
      if (item.proposal.questions.length) {
        const answer = document.createElement('button');
        answer.type = 'button';
        answer.dataset.answerProposal = item.proposal.id;
        answer.textContent = '回答して案を再検討';
        row.append(answer);
      }
      list.append(row);
    });
    content.append(list);
    disclosure.append(disclosureSummary, content);
    disclosure.addEventListener('toggle', () => { previewAll.hidden = disclosure.open; });
    previewAll.hidden = disclosure.open;
    heading.append(disclosure, previewAll);
    queue.append(heading);
    body.append(queue);
    updateStatusCounts(message, state);
    root.append(message);
    messagesScrollToLatest();
  }

  function messagesScrollToLatest() {
    root.scrollTo?.({ top: root.scrollHeight, behavior: 'smooth' });
    if (!root.scrollTo) root.scrollTop = root.scrollHeight;
  }

  function markApplied(item) {
    setStatus(item, 'applied', '適用済み');
  }

  function markDismissed(item) {
    setStatus(item, 'dismissed', '見送り');
  }

  function setStatus(item, status, label) {
    const row = item && typeof item === 'object' ? itemRows.get(item) : null;
    const message = row?.closest('[data-assistant-proposal-result]');
    const state = message && resultStates.get(message);
    if (!row || !state) return;
    state.statuses.set(item, status);
    row.classList.remove('is-unjudged', 'is-dismissed');
    row.classList.remove('is-applied');
    row.classList.add(`is-${status}`);
    const badge = row.querySelector('[data-proposal-status]');
    if (badge) {
      badge.className = `ai-proposal-status-badge is-${status}`;
      badge.textContent = label;
    }
    const preview = row.querySelector('[data-preview-proposal]');
    if (preview) { preview.disabled = true; preview.textContent = label; }
    updateStatusCounts(message, state);
  }
  return Object.freeze({ render, markApplied, markDismissed });
}
