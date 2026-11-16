const PROGRESS_STAGES = new Set([
  'planning', 'waiting_for_answer', 'checking_scope', 'waiting_for_scope_approval', 'scope_denied',
  'retrieving', 'analyzing', 'validating', 'waiting_for_review', 'budget_exhausted', 'completed', 'failed'
]);

const DEFAULT_LABELS = Object.freeze({
  planning: '依頼を整理しています',
  waiting_for_answer: '確認への回答をお待ちしています',
  checking_scope: '必要な参照・変更範囲を確認しています',
  waiting_for_scope_approval: '追加範囲の選択をお待ちしています',
  scope_denied: '追加範囲が許可されなかったため処理を停止しました',
  retrieving: '許可された範囲からデータを取得しています',
  analyzing: '取得した情報を確認しています',
  validating: '変更案を検証しています',
  waiting_for_review: '変更案の確認をお待ちしています',
  budget_exhausted: '処理上限に達したため一時停止しています',
  completed: '処理が完了しました',
  failed: '処理を続けられませんでした'
});

export function createProgressView(statusElement, messages = document.getElementById('ai-chat-messages')) {
  if (!statusElement) throw new TypeError('進捗表示要素が必要です。');

  let indicator = null;
  let startedAt = 0;
  let timer = null;
  let waiting = false;

  const formatElapsed = (milliseconds) => {
    const seconds = Math.max(0, Math.floor(milliseconds / 1000));
    return `${seconds}s`;
  };

  const ensureIndicator = () => {
    if (indicator || !messages) return;
    indicator = document.createElement('div');
    indicator.className = 'ai-thinking-indicator is-agent-progress';
    indicator.setAttribute('role', 'status');
    indicator.setAttribute('aria-live', 'polite');
    messages.append(indicator);
    messages.scrollTop = messages.scrollHeight;
  };

  const stopTimer = () => {
    if (timer !== null) window.clearInterval(timer);
    timer = null;
  };

  const updateIndicator = () => {
    if (!indicator) return;
    const elapsedSeconds = Math.max(0, Math.floor((Date.now() - startedAt) / 1000));
    const label = indicator.dataset.progressLabel || '';
    const note = indicator.dataset.progressNote || '';
    const stage = indicator.dataset.progressStage || '';
    const isActive = !waiting && !['budget_exhausted', 'completed', 'failed', 'scope_denied'].includes(stage);
    indicator.hidden = !isActive;
    const text = isActive ? `${elapsedSeconds}s作業中` : '';
    indicator.textContent = text;
    indicator.setAttribute('aria-label', [label, note, formatElapsed(Date.now() - startedAt)].filter(Boolean).join('。'));
  };

  function render(event) {
    const detail = event?.detail || {};
    if (!PROGRESS_STAGES.has(detail.stage)) return;
    const note = typeof detail.note === 'string' ? detail.note.trim() : '';
    const scope = typeof detail.scopeSummary === 'string' ? detail.scopeSummary.trim() : '';
    const label = DEFAULT_LABELS[detail.stage];
    const isWaiting = ['waiting_for_answer', 'waiting_for_scope_approval', 'waiting_for_review'].includes(detail.stage);
    const isFinished = ['budget_exhausted', 'completed', 'failed', 'scope_denied'].includes(detail.stage);
    ensureIndicator();
    if (!isWaiting && !isFinished) {
      if (!startedAt || waiting) startedAt = Date.now();
      waiting = false;
      indicator?.classList.remove('is-complete');
      if (timer === null) timer = window.setInterval(updateIndicator, 1000);
    } else {
      if (!startedAt) startedAt = Date.now();
      waiting = true;
      stopTimer();
      indicator?.classList.add('is-complete');
    }
    if (indicator) {
      indicator.dataset.progressLabel = label;
      indicator.dataset.progressNote = [scope, note].filter(Boolean).join('。');
      indicator.dataset.progressStage = detail.stage;
      updateIndicator();
      messages.append(indicator);
      messages.scrollTop = messages.scrollHeight;
    }
    // Agent progress is shown in the chat log itself; keep the legacy status slot empty.
    statusElement.textContent = '';
    statusElement.dataset.workflowStage = detail.stage;
  }

  window.addEventListener('assistant:progress', render);
  return Object.freeze({
    getElapsed: () => startedAt ? formatElapsed(Date.now() - startedAt) : '',
    dispose() {
      window.removeEventListener('assistant:progress', render);
      stopTimer();
    },
    render
  });
}
