function appendText(parent, tag, text, className = '') {
  const element = document.createElement(tag);
  if (className) element.className = className;
  element.textContent = text;
  parent.append(element);
  return element;
}

export function createWorkflowView(root, questionView, proposalView, { onAnswerQuestions, onAnswerProposal }) {
  root.addEventListener('click', async (event) => {
    if (event.target.closest('[data-answer-plan]')) {
      const questions = root.__activeQuestions || [];
      const answer = await questionView.ask(questions);
      if (answer) await onAnswerQuestions(answer);
    }
    const answerButton = event.target.closest('[data-proposal-answer]');
    if (answerButton) {
      const id = answerButton.dataset.proposalAnswer;
      const textarea = root.querySelector(`[data-answer-text="${CSS.escape(id)}"]`);
      if (textarea?.value.trim()) await onAnswerProposal(id, textarea.value.trim());
    }
  });

  function renderPlan(plan) {
    root.replaceChildren();
    const card = document.createElement('section');
    card.className = 'assistant-plan-card';
    appendText(card, 'h3', '処理計画');
    appendText(card, 'p', plan.summary);
    appendText(card, 'p', plan.executionBrief.objective);
    const steps = document.createElement('ol');
    plan.steps.forEach((step) => appendText(steps, 'li', step));
    card.append(steps);
    if (plan.unsupportedParts.length) {
      const unsupported = document.createElement('ul');
      plan.unsupportedParts.forEach((part) => appendText(unsupported, 'li', `${part.description}：${part.reason}`));
      card.append(unsupported);
    }
    root.append(card);
  }

  function handle(event) {
    if (event.type === 'settings_invalidated') {
      root.replaceChildren();
      appendText(root, 'p', '許可や取得上限を狭める設定が変更されたため、以前の提案とAIの参照状態を破棄し、許可された設定で再計画します。');
    }
    if (event.type === 'plan') renderPlan(event.plan);
    if (event.type === 'questions') {
      root.__activeQuestions = event.questions;
      const card = document.createElement('section');
      card.className = 'assistant-plan-card';
      appendText(card, 'h3', '確認が必要です');
      const list = document.createElement('ol');
      event.questions.forEach((question) => appendText(list, 'li', question.text));
      card.append(list);
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'search-button';
      button.dataset.answerPlan = 'true';
      button.textContent = '回答して再計画';
      card.append(button);
      root.append(card);
    }
    if (event.type === 'unsupported') {
      root.replaceChildren();
      appendText(root, 'p', event.plan.summary);
      event.plan.unsupportedParts.forEach((part) => appendText(root, 'p', `${part.description}：${part.reason}`));
    }
    if (event.type === 'result') proposalView.render(event.result);
    if (event.type === 'scope_blocked') appendText(root, 'p', '追加範囲の許可が得られなかったため、依存する処理を保留しました。');
    if (event.type === 'error') appendText(root, 'p', event.error.message, 'assistant-error');
  }
  return Object.freeze({ handle, renderPlan });
}
