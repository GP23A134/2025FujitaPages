const PROGRESS_STAGES = new Set([
  'planning', 'waiting_for_answer', 'checking_scope', 'waiting_for_scope_approval',
  'retrieving', 'analyzing', 'validating', 'waiting_for_review', 'budget_exhausted', 'completed', 'failed'
]);

const DEFAULT_LABELS = Object.freeze({
  planning: '依頼を整理しています',
  waiting_for_answer: '確認への回答をお待ちしています',
  checking_scope: '必要な参照・変更範囲を確認しています',
  waiting_for_scope_approval: '追加範囲の選択をお待ちしています',
  retrieving: '許可された範囲からデータを取得しています',
  analyzing: '取得した情報を確認しています',
  validating: '変更案を検証しています',
  waiting_for_review: '変更案の確認をお待ちしています',
  budget_exhausted: '処理上限に達したため一時停止しています',
  completed: '処理が完了しました',
  failed: '処理を続けられませんでした'
});

export function createProgressView(statusElement) {
  if (!statusElement) throw new TypeError('進捗表示要素が必要です。');

  function render(event) {
    const detail = event?.detail || {};
    if (!PROGRESS_STAGES.has(detail.stage)) return;
    const note = typeof detail.note === 'string' ? detail.note.trim() : '';
    const scope = typeof detail.scopeSummary === 'string' ? detail.scopeSummary.trim() : '';
    statusElement.textContent = [DEFAULT_LABELS[detail.stage], scope, note].filter(Boolean).join('。');
    statusElement.dataset.workflowStage = detail.stage;
  }

  window.addEventListener('assistant:progress', render);
  return Object.freeze({
    dispose() { window.removeEventListener('assistant:progress', render); },
    render
  });
}
