function appendText(parent, tag, text, className = '') {
  const element = document.createElement(tag);
  if (className) element.className = className;
  element.textContent = text;
  parent.append(element);
  return element;
}

export function createWorkflowView(root, questionView, proposalView, { onAnswerQuestions, messages, getElapsed = () => '' }) {
  function renderPlan(plan) {
    root.replaceChildren();
    if (messages) {
      messages.querySelector('[data-assistant-plan-message]')?.remove();
      const message = document.createElement('div');
      message.className = 'ai-message';
      message.dataset.assistantPlanMessage = 'true';
      message.setAttribute('role', 'article');
      const body = document.createElement('div');
      body.className = 'ai-message-body assistant-plan-message';
      const lines = [plan.summary];
      if (plan.unsupportedParts.length) {
        lines.push(...plan.unsupportedParts.map((part) => `今回対応できない内容は「${part.description}」です。${part.reason}`));
      }
      appendText(message, 'strong', 'AI');
      body.textContent = lines.join('\n\n');
      message.append(body);
      messages.append(message);
      const scrollToLatest = () => {
        messages.scrollTo?.({ top: messages.scrollHeight, behavior: 'smooth' });
        if (!messages.scrollTo) messages.scrollTop = messages.scrollHeight;
      };
      if (typeof requestAnimationFrame === 'function') requestAnimationFrame(scrollToLatest);
      else scrollToLatest();
      return;
    }
    const card = document.createElement('section');
    card.className = 'assistant-plan-card';
    appendText(card, 'p', plan.summary);
    if (plan.unsupportedParts.length) {
      plan.unsupportedParts.forEach((part) => appendText(card, 'p', `今回対応できない内容は「${part.description}」です。${part.reason}`));
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
      questionView.ask(event.questions).then((answers) => {
        if (answers) return onAnswerQuestions(answers);
        return null;
      }).catch((error) => {
        appendText(root, 'p', error.message || '回答を処理できませんでした。', 'assistant-error');
      });
    }
    if (event.type === 'unsupported') {
      root.replaceChildren();
      appendText(root, 'p', event.plan.summary);
      event.plan.unsupportedParts.forEach((part) => appendText(root, 'p', `${part.description}：${part.reason}`));
    }
    if (event.type === 'result') {
      if (messages && (event.result?.budgetLimited || !event.result?.proposals?.length)) {
        root.replaceChildren();
        const message = document.createElement('div');
        message.className = 'ai-message';
        message.dataset.assistantBudgetResult = 'true';
        message.setAttribute('role', 'article');
        appendText(message, 'strong', 'AI');
        const elapsed = getElapsed();
        if (elapsed) appendText(message, 'small', `所要時間 ${elapsed}`, 'ai-message-time');
        const body = document.createElement('div');
        body.className = 'ai-message-body';
        appendText(body, 'p', event.result.message || '処理上限に達したため一時停止しました。');
        message.append(body);
        messages.append(message);
        const scrollToLatest = () => {
          messages.scrollTo?.({ top: messages.scrollHeight, behavior: 'smooth' });
          if (!messages.scrollTo) messages.scrollTop = messages.scrollHeight;
        };
        if (typeof requestAnimationFrame === 'function') requestAnimationFrame(scrollToLatest);
        else scrollToLatest();
      } else {
        proposalView.render(event.result);
      }
    }
    if (event.type === 'scope_blocked') appendText(root, 'p', '追加範囲の許可が得られなかったため、依存する処理を保留しました。');
    if (event.type === 'error') appendText(root, 'p', event.error.message, 'assistant-error');
  }
  return Object.freeze({ handle, renderPlan });
}
