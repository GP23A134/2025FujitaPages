import { CHAT_EVENTS } from '../../../integration/chat-events.js?v=20261118-chat-events-v1';

const PROGRESS_STAGES = new Set([
  'planning', 'waiting_for_answer', 'checking_scope', 'waiting_for_scope_approval', 'scope_denied',
  'retrieving', 'analyzing', 'validating', 'waiting_for_review', 'budget_exhausted', 'completed', 'cancelled', 'failed'
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
  completed: '',
  cancelled: '処理を中止しました',
  failed: '処理を続けられませんでした'
});

const TOOL_LABELS = Object.freeze({
  read_hierarchy_index: '階層索引を取得しています',
  read_direct_children: '指定クラスの直下を取得しています',
  read_class_details: '指定クラスの詳細を取得しています',
  read_selected_class_details: '選択クラスの詳細を取得しています',
  read_instance_context: 'インスタンス情報を取得しています'
});
const ACTIVE_STAGES = new Set(['planning', 'checking_scope', 'retrieving', 'analyzing', 'validating']);

export function createProgressView(statusElement, messages = document.getElementById('ai-chat-messages')) {
  if (!statusElement) throw new TypeError('進捗表示要素が必要です。');

  let indicator = null;
  let activity = null;
  let lastMilestoneText = '';
  let startedAt = 0;
  let timer = null;
  let waiting = false;
  let resumeSameRunAfterWait = false;
  let terminal = false;

  const formatElapsed = (milliseconds) => {
    const seconds = Math.max(0, Math.floor(milliseconds / 1000));
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const remainingSeconds = seconds % 60;
    if (hours) return `${hours}h${minutes}m${remainingSeconds}s`;
    if (minutes) return `${minutes}m${remainingSeconds}s`;
    return `${remainingSeconds}s`;
  };

  const ensureIndicator = (newRun = false) => {
    if (!messages || (indicator && !newRun)) return;
    indicator = document.createElement('div');
    indicator.className = 'ai-thinking-indicator is-agent-progress';
    indicator.setAttribute('role', 'status');
    indicator.setAttribute('aria-live', 'polite');
    messages.append(indicator);
    activity = document.createElement('p');
    activity.className = 'assistant-progress-activity';
    activity.setAttribute('role', 'status');
    activity.setAttribute('aria-live', 'polite');
    messages.append(activity);
    messages.scrollTop = messages.scrollHeight;
  };

  const stopTimer = () => {
    if (timer !== null) window.clearInterval(timer);
    timer = null;
  };

  const updateIndicator = () => {
    if (!indicator) return;
    const label = indicator.dataset.progressLabel || '';
    const note = indicator.dataset.progressNote || '';
    const stage = indicator.dataset.progressStage || '';
    const elapsed = formatElapsed(Date.now() - startedAt);
    const display = stage === 'completed'
      ? `${elapsed}間作業しました`
      : ACTIVE_STAGES.has(stage) ? `${elapsed} 作業中` : elapsed;
    indicator.hidden = false;
    indicator.textContent = display;
    indicator.setAttribute('aria-label', [label, note, display].filter(Boolean).join('。'));
  };

  const appendMilestone = (text) => {
    if (!messages || !text || lastMilestoneText === text) return;
    const milestone = document.createElement('p');
    milestone.className = 'assistant-progress-milestone';
    milestone.dataset.assistantProgressMilestone = 'true';
    milestone.textContent = text;
    lastMilestoneText = text;
    if (activity?.parentNode === messages) messages.insertBefore(milestone, activity);
    else messages.append(milestone);
  };

  function render(event) {
    const detail = event?.detail || {};
    if (!PROGRESS_STAGES.has(detail.stage)) return;
    const note = typeof detail.note === 'string' ? detail.note.trim() : '';
    const scope = typeof detail.scopeSummary === 'string' ? detail.scopeSummary.trim() : '';
    const label = detail.stage === 'retrieving'
      ? TOOL_LABELS[detail.tool] || DEFAULT_LABELS[detail.stage]
      : DEFAULT_LABELS[detail.stage];
    const isWaiting = ['waiting_for_answer', 'waiting_for_scope_approval', 'waiting_for_review'].includes(detail.stage);
    const isFinished = ['budget_exhausted', 'completed', 'cancelled', 'failed', 'scope_denied'].includes(detail.stage);
    const canResumeSameRun = waiting && resumeSameRunAfterWait;
    const startsNewRun = !isWaiting && !isFinished && (!startedAt || (waiting && !canResumeSameRun) || (terminal && !canResumeSameRun));
    ensureIndicator(startsNewRun);
    if (!isWaiting && !isFinished) {
      if (startsNewRun) {
        startedAt = Date.now();
        lastMilestoneText = '';
      }
      waiting = false;
      resumeSameRunAfterWait = false;
      terminal = false;
      indicator?.classList.remove('is-complete');
      if (timer === null) timer = window.setInterval(updateIndicator, 1000);
    } else {
      if (!startedAt) startedAt = Date.now();
      waiting = true;
      resumeSameRunAfterWait = ['waiting_for_answer', 'waiting_for_scope_approval', 'scope_denied'].includes(detail.stage);
      terminal ||= isFinished;
      stopTimer();
      indicator?.classList.add('is-complete');
    }
    if (indicator) {
      indicator.dataset.progressLabel = label;
      indicator.dataset.progressNote = [scope, note].filter(Boolean).join('。');
      indicator.dataset.progressStage = detail.stage;
      updateIndicator();
      if (activity && detail.stage !== 'completed') {
        activity.textContent = [label, note].filter(Boolean).join('。');
        activity.classList.toggle('is-active', ACTIVE_STAGES.has(detail.stage));
        if (detail.milestone === true) appendMilestone(note || label);
        // Keep prior chat entries and move only the current activity line to the bottom.
        messages.append(activity);
        if (isFinished) {
          activity.classList.add('is-terminal');
          activity = null;
        }
      } else if (activity && detail.stage === 'completed') {
        activity.remove();
        activity = null;
      }
      messages.scrollTop = messages.scrollHeight;
    }
    // Agent progress is shown in the chat log itself; keep the legacy status slot empty.
    statusElement.textContent = '';
    statusElement.dataset.workflowStage = detail.stage;
  }

  window.addEventListener(CHAT_EVENTS.agentProgress, render);
  return Object.freeze({
    getElapsed: () => startedAt ? formatElapsed(Date.now() - startedAt) : '',
    dispose() {
      window.removeEventListener(CHAT_EVENTS.agentProgress, render);
      stopTimer();
    },
    render
  });
}

