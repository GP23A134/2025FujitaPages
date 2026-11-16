export function createProposalResultView(root, { onPreview, onAnswerQuestions, onFinishReview, onSelectAlternative = () => {} }) {
  let currentResult = null;
  let selectedAlternatives = new Map();
  root.addEventListener('click', async (event) => {
    const choice = event.target.closest('[data-alternative-group]');
    if (choice) {
      selectedAlternatives.set(choice.dataset.alternativeGroup, choice.value);
      onSelectAlternative(choice.dataset.alternativeGroup, choice.value);
      root.querySelectorAll(`[data-alternative-choice="${CSS.escape(choice.dataset.alternativeGroup)}"]`).forEach((input) => {
        const card = input.closest('.assistant-proposal-card');
        card.querySelector('[data-preview-proposal]').disabled = !input.checked || card.dataset.hasQuestions === 'true';
      });
      return;
    }
    const preview = event.target.closest('[data-preview-proposal]');
    if (preview) {
      const proposal = currentResult?.proposals.find((item) => item.proposal.id === preview.dataset.previewProposal);
      if (proposal) onPreview(proposal);
      return;
    }
    const answer = event.target.closest('[data-answer-proposal]');
    if (answer) {
      const item = currentResult?.proposals.find((entry) => entry.proposal.id === answer.dataset.answerProposal);
      if (!item) return;
      const textarea = root.querySelector(`[data-proposal-answer="${CSS.escape(item.proposal.id)}"]`);
      if (textarea?.value.trim()) await onAnswerQuestions(item.proposal, textarea.value.trim());
      return;
    }
    if (event.target.closest('[data-finish-review]')) await onFinishReview();
  });

  function render(result) {
    currentResult = result;
    selectedAlternatives = new Map();
    root.replaceChildren();
    const message = document.createElement('p');
    message.textContent = result.message || '処理が完了しました。';
    root.append(message);

    if (result.blocked?.length) {
      const section = document.createElement('section');
      const heading = document.createElement('h3');
      heading.textContent = '保留した案';
      const list = document.createElement('ul');
      result.blocked.forEach((item) => {
        const row = document.createElement('li');
        row.textContent = `${item.proposalId ? `${item.proposalId}: ` : ''}${item.reason}`;
        list.append(row);
      });
      section.append(heading, list);
      root.append(section);
    }

    const groupByProposal = new Map();
    (result.alternativeGroups || []).forEach((group) => group.proposalIds.forEach((id) => groupByProposal.set(id, group)));
    for (const item of result.proposals || []) {
      const card = document.createElement('article');
      card.className = 'assistant-proposal-card';
      const heading = document.createElement('h3');
      heading.textContent = item.proposal.title;
      const summary = document.createElement('p');
      summary.textContent = item.proposal.summary;
      const reason = document.createElement('p');
      reason.textContent = item.proposal.reason;
      const count = document.createElement('p');
      count.textContent = `変更 ${item.operations.length}件`;
      card.append(heading, summary, reason, count);
      const group = groupByProposal.get(item.proposal.id);
      if (group) {
        const selected = selectedAlternatives.get(group.id) || '';
        if (group.id.startsWith('conflict_')) {
          const groupNote = document.createElement('p');
          groupNote.className = 'assistant-proposal-conflict';
          groupNote.textContent = 'この案は同じ変更対象を扱うため、同時には適用できません。';
          card.append(groupNote);
        }
        const radioLabel = document.createElement('label');
        radioLabel.className = 'assistant-alternative-choice';
        const radio = document.createElement('input');
        radio.type = 'radio';
        radio.name = `alternative-${group.id}`;
        radio.value = item.proposal.id;
        radio.checked = selected === item.proposal.id;
        radio.dataset.alternativeGroup = group.id;
        radio.dataset.alternativeChoice = group.id;
        radioLabel.append(radio, document.createTextNode('この代替案を選択'));
        card.append(radioLabel);
      }
      if (item.proposal.questions.length) {
        card.dataset.hasQuestions = 'true';
        const questions = document.createElement('ul');
        item.proposal.questions.forEach((question) => {
          const li = document.createElement('li');
          li.textContent = question.text;
          questions.append(li);
        });
        const answer = document.createElement('textarea');
        answer.dataset.proposalAnswer = item.proposal.id;
        answer.rows = 2;
        answer.setAttribute('aria-label', `${item.proposal.title}への回答`);
        const answerButton = document.createElement('button');
        answerButton.type = 'button';
        answerButton.dataset.answerProposal = item.proposal.id;
        answerButton.textContent = '回答して案を再検討';
        card.append(questions, answer, answerButton);
      }
      const preview = document.createElement('button');
      preview.type = 'button';
      preview.className = 'search-button';
      preview.dataset.previewProposal = item.proposal.id;
      preview.textContent = 'プレビューを確認';
      preview.disabled = item.proposal.questions.length > 0 || (Boolean(group) && selectedAlternatives.get(group.id) !== item.proposal.id);
      card.append(preview);
      root.append(card);
    }
    if (result.proposals?.length) {
      const finish = document.createElement('button');
      finish.type = 'button';
      finish.className = 'search-button secondary-search-button';
      finish.dataset.finishReview = 'true';
      finish.textContent = '確認を終える';
      root.append(finish);
    }
  }
  function markApplied(proposalId) {
    const card = root.querySelector(`[data-preview-proposal="${CSS.escape(proposalId)}"]`)?.closest('.assistant-proposal-card');
    if (!card) return;
    card.dataset.applied = 'true';
    card.querySelector('[data-preview-proposal]').disabled = true;
    card.querySelector('[data-preview-proposal]').textContent = '適用済み';
    const choice = card.querySelector('[data-alternative-group]');
    if (choice) {
      const groupId = choice.dataset.alternativeGroup;
      root.querySelectorAll(`[data-alternative-choice="${CSS.escape(groupId)}"]`).forEach((input) => {
        input.disabled = true;
        input.closest('.assistant-proposal-card').querySelector('[data-preview-proposal]').disabled = true;
      });
    }
  }
  return Object.freeze({ render, markApplied });
}
