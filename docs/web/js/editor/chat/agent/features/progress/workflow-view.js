function appendText(parent, tag, text, className = '') {
  const element = document.createElement(tag);
  if (className) element.className = className;
  element.textContent = text;
  parent.append(element);
  return element;
}

export function createWorkflowView(root, questionView, proposalView, { onAnswerQuestions, onError = () => {}, messages }) {
  function handle(event) {
    if (event.type === 'settings_invalidated') {
      root.replaceChildren();
      appendText(root, 'p', '許可や取得上限を狭める設定が変更されたため、以前の提案とAIの参照状態を破棄し、許可された設定で再計画します。');
    }
    if (event.type === 'questions') {
      questionView.ask(event.questions).then((answers) => {
        if (answers) return onAnswerQuestions(answers);
        return null;
      }).catch((error) => {
        onError(error);
      });
    }
    if (event.type === 'unsupported') {
      root.replaceChildren();
    }
    if (event.type === 'result') {
      if (messages && (event.result?.budgetLimited || !event.result?.proposals?.length)) {
        root.replaceChildren();
        const message = document.createElement('div');
        message.className = 'ai-message';
        message.dataset.assistantBudgetResult = 'true';
        message.setAttribute('role', 'article');
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
    if (event.type === 'scope_blocked') {
      const message = event.scopeReason === 'approved_without_scope'
        ? '許可操作を受け取りましたが、許可対象を特定できず処理を保留しました。'
        : event.scopeReason === 'approved_scope_incomplete'
          ? '追加範囲の一部は許可されましたが、必要な範囲が不足しているため処理を保留しました。'
          : '追加範囲は許可されなかったため、依存する処理を保留しました。';
      appendText(root, 'p', message);
    }
    if (event.type === 'error') onError(event.error);
  }
  return Object.freeze({ handle });
}
