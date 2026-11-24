export function createBudgetApprovalView({ messages, interactionDock } = {}) {
  let pending = null;

  function request({ kind = 'response_rounds', used, limit, extension, required = 0 }) {
    if (pending) throw new Error('上限延長の確認が進行中です。');
    const host = interactionDock || messages;
    if (!host) return Promise.resolve(false);
    const card = document.createElement('section');
    card.className = 'ai-scope-request-summary';
    card.setAttribute('role', 'group');
    const heading = document.createElement('strong');
    const tokenLimit = kind === 'input_tokens';
    heading.textContent = tokenLimit ? '累積入力トークン上限に達しました' : 'AI応答回数の上限に達しました';
    const detail = document.createElement('p');
    detail.textContent = tokenLimit
      ? `現在 ${used.toLocaleString('ja-JP')} / 上限 ${limit.toLocaleString('ja-JP')} トークンです。現在の処理に必要な見積もり枠は約${required.toLocaleString('ja-JP')}トークンです。続行すると、累積上限を${extension.toLocaleString('ja-JP')}トークン追加します。追加利用料が発生する場合があります。`
      : `現在 ${used} 回 / 上限 ${limit} 回です。続行すると、追加で最大 ${extension} 回のAI応答を許可します。追加利用料が発生する場合があります。`;
    const actions = document.createElement('div');
    actions.className = 'ai-scope-request-actions';
    const stop = document.createElement('button');
    stop.type = 'button';
    stop.className = 'search-button secondary-search-button';
    stop.textContent = '停止する';
    const allow = document.createElement('button');
    allow.type = 'button';
    allow.className = 'search-button';
    allow.textContent = tokenLimit
      ? `${extension.toLocaleString('ja-JP')}トークン追加して続ける`
      : '20回追加して続ける';
    actions.append(stop, allow);
    card.append(heading, detail, actions);
    host.append(card);
    if (interactionDock) interactionDock.hidden = false;
    if (messages) messages.scrollTo?.({ top: messages.scrollHeight, behavior: 'smooth' });

    return new Promise((resolve) => {
      const finish = (choice) => {
        if (!pending) return;
        const current = pending;
        pending = null;
        current.card.remove();
        if (interactionDock && !interactionDock.children.length) interactionDock.hidden = true;
        if (messages) {
          const response = document.createElement('div');
          response.className = 'ai-message is-user';
          response.setAttribute('role', 'article');
          const author = document.createElement('strong');
          author.textContent = 'あなた';
          const body = document.createElement('div');
          body.className = 'ai-message-body';
          const text = document.createElement('p');
          text.textContent = choice === 'continue'
            ? tokenLimit
              ? `累積入力トークン上限を${extension.toLocaleString('ja-JP')}追加して続行しました（新しい上限 ${(limit + extension).toLocaleString('ja-JP')}トークン）。`
              : `AI応答上限を20回追加して続行しました（新しい上限 ${limit + extension} 回）。`
            : choice === 'stop'
              ? tokenLimit ? '累積入力トークン上限で停止しました。' : 'AI応答回数の上限で停止しました。'
              : '処理を中止しました。';
          body.append(text);
          response.append(author, body);
          messages.append(response);
          messages.scrollTop = messages.scrollHeight;
        }
        resolve(choice);
      };
      stop.addEventListener('click', () => finish('stop'), { once: true });
      allow.addEventListener('click', () => finish('continue'), { once: true });
      pending = { card, finish };
    });
  }

  function cancel() {
    if (!pending) return false;
    pending.finish('cancel');
    return true;
  }

  return Object.freeze({ request, cancel });
}
