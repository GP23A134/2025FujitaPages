export const createRequestProgress = ({ messages, getCurrentConversation }) => {
  let preparationIndicator = null;
  let preparationTimer = null;
  let thinkingTimer = null;
  let preparationStartedAt = 0;
  let preparationLabel = '';

  const formatElapsedTime = (totalSeconds) => {
    if (totalSeconds < 1) return '<1s';
    let remaining = Math.max(0, Math.floor(totalSeconds));
    const hours = Math.floor(remaining / 3600);
    remaining %= 3600;
    const minutes = Math.floor(remaining / 60);
    const seconds = remaining % 60;
    if (hours) return `${hours}h${minutes ? `${minutes}m` : ''}${seconds ? `${seconds}s` : ''}`;
    if (minutes) return `${minutes}m${seconds ? `${seconds}s` : ''}`;
    return `${seconds}s`;
  };

  const elapsedSeconds = (conversation) => Math.max(0, Math.floor((Date.now() - conversation.thinkingStartedAt) / 1000));
  const formatThinkingStatus = (conversation) => {
    if (conversation.thinkingStage === '変更適用中') return '変更適用中…';
    const elapsed = formatElapsedTime(elapsedSeconds(conversation));
    const stage = conversation.thinkingStage || '回答・変更案を作成中';
    const progress = conversation.thinkingProgress;
    if (stage === '分割処理中' && progress) {
      const compactProgress = progress.replace(/送信バッチを処理中/g, 'バッチ').replace(/送信バッチ完了/g, 'バッチ完了');
      return `分割処理中…：${compactProgress}（${elapsed}）`;
    }
    if (stage === '結果統合中' && progress) {
      return `結果統合中…：${progress.replace(/統合単位/g, '単位')}（${elapsed}）`;
    }
    return `${stage}…${progress ? `：${progress}` : ''}（${elapsed}）`;
  };

  const updatePreparationIndicator = () => {
    if (!preparationIndicator) return;
    preparationIndicator.setAttribute('aria-label', `${preparationLabel}…（${formatElapsedTime((Date.now() - preparationStartedAt) / 1000)}）`);
  };

  const startPreparation = ({ label, startedAt }) => {
    stopPreparation();
    preparationLabel = label;
    preparationStartedAt = startedAt;
    preparationIndicator = document.createElement('div');
    preparationIndicator.className = 'ai-thinking-indicator';
    preparationIndicator.setAttribute('role', 'status');
    preparationIndicator.setAttribute('aria-live', 'polite');
    preparationIndicator.setAttribute('aria-label', `${preparationLabel}…（0s）`);
    messages.append(preparationIndicator);
    messages.scrollTop = messages.scrollHeight;
    updatePreparationIndicator();
    preparationTimer = window.setInterval(updatePreparationIndicator, 1000);
  };

  const updatePreparationLabel = (label) => {
    preparationLabel = label;
    updatePreparationIndicator();
  };

  const stopPreparation = () => {
    const wasActive = preparationIndicator !== null || preparationTimer !== null;
    if (preparationTimer !== null) window.clearInterval(preparationTimer);
    preparationTimer = null;
    preparationIndicator?.remove();
    preparationIndicator = null;
    return wasActive;
  };

  const createThinkingIndicator = (conversation) => {
    const indicator = document.createElement('div');
    indicator.className = 'ai-thinking-indicator';
    indicator.setAttribute('role', 'status');
    indicator.setAttribute('aria-live', 'polite');
    indicator.setAttribute('aria-label', formatThinkingStatus(conversation));
    return indicator;
  };

  const setThinkingStage = (conversation, stage, progress = conversation.thinkingProgress || '') => {
    conversation.thinkingStage = stage;
    conversation.thinkingProgress = progress;
    if (getCurrentConversation() === conversation) {
      const indicator = messages.querySelector('.ai-thinking-indicator:not(.is-complete)');
      if (indicator) indicator.setAttribute('aria-label', formatThinkingStatus(conversation));
    }
  };

  const startThinkingTimer = (conversation) => {
    stopThinkingTimer();
    thinkingTimer = window.setInterval(() => {
      const indicator = messages.querySelector('.ai-thinking-indicator:not(.is-complete)');
      if (indicator && getCurrentConversation() === conversation) {
        indicator.setAttribute('aria-label', formatThinkingStatus(conversation));
      }
    }, 1000);
    return stopThinkingTimer;
  };

  const stopThinkingTimer = () => {
    if (thinkingTimer !== null) window.clearInterval(thinkingTimer);
    thinkingTimer = null;
  };

  return {
    formatElapsedTime,
    elapsedSeconds,
    startPreparation,
    updatePreparationLabel,
    stopPreparation,
    createThinkingIndicator,
    setThinkingStage,
    startThinkingTimer,
    stopThinkingTimer
  };
};
