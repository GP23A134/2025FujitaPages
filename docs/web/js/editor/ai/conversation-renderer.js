// 会話アイテムの描画とスクロール・表示状態の同期を担当します。
// 送信や編集データの変更は呼び出し元へ委譲します。
export const createConversationRenderer = ({ messages, status, getCurrentConversation, getClasses,
  beforeRender = () => {}, renderMessage, renderProposalQueue, submitQuestionAnswers, requestProgress,
  updateUsageSummary, updateHistoryList, persistSavedConversations }) => {
  const renderQuestionQueue = (item, host, renderConversation) => {
    const details = document.createElement('details');
    details.className = 'ai-question-queue';
    details.open = Boolean(item.open);
    details.addEventListener('toggle', () => { item.open = details.open; });
    const summary = document.createElement('summary');
    const answeredCount = item.questions.filter((question) => question.answer?.trim()).length;
    summary.textContent = item.submitted
      ? `確認事項（${item.questions.length}件・回答送信済み）`
      : `確認事項（${item.questions.length}件・${answeredCount}件回答済み）`;
    details.append(summary);
    if (item.submitted) {
      const review = document.createElement('div');
      review.className = 'ai-question-review';
      item.questions.forEach((question, index) => {
        const entry = document.createElement('article');
        entry.className = 'ai-question-review-item';
        const prompt = document.createElement('p');
        prompt.className = 'ai-question-prompt';
        prompt.textContent = `${index + 1}. ${question.text}`;
        const answer = document.createElement('p');
        answer.className = 'ai-question-review-answer';
        answer.textContent = `回答: ${question.answer || '（回答なし）'}`;
        entry.append(prompt, answer);
        review.append(entry);
      });
      details.append(review);
      host.append(details);
      return;
    }
    const question = item.questions[item.activeIndex] || item.questions[0];
    const content = document.createElement('div');
    content.className = 'ai-question-content';
    const progress = document.createElement('p');
    progress.className = 'ai-question-progress';
    progress.textContent = `質問 ${item.activeIndex + 1} / ${item.questions.length}　Enterで次へ／送信・Shift+Enterで改行`;
    content.append(progress);
    if (question.proposalTitle) {
      const context = document.createElement('p');
      context.className = 'ai-question-context';
      context.textContent = `変更案「${question.proposalTitle}」について`;
      content.append(context);
    }
    const prompt = document.createElement('p');
    prompt.className = 'ai-question-prompt';
    prompt.textContent = question.text;
    const answer = document.createElement('textarea');
    answer.rows = 2;
    answer.className = 'ai-question-answer';
    answer.placeholder = '回答を入力してください';
    answer.value = question.answer || '';
    answer.setAttribute('aria-label', `質問 ${item.activeIndex + 1} への回答`);
    answer.addEventListener('input', () => { question.answer = answer.value; });
    content.append(prompt, answer);
    const actions = document.createElement('div');
    actions.className = 'ai-question-actions';
    const previous = document.createElement('button');
    previous.type = 'button';
    previous.textContent = '前へ';
    previous.disabled = item.activeIndex === 0;
    previous.addEventListener('click', () => { item.activeIndex -= 1; renderConversation(); });
    const recommend = document.createElement('button');
    recommend.type = 'button';
    recommend.textContent = 'おすすめに任せる';
    recommend.addEventListener('click', () => { question.answer = 'おすすめに任せる'; renderConversation(); });
    const next = document.createElement('button');
    next.type = 'button';
    next.className = 'search-button';
    const isLast = item.activeIndex === item.questions.length - 1;
    next.textContent = isLast ? '回答をまとめて送る' : '次へ';
    next.disabled = Boolean(item.submitting);
    next.addEventListener('click', () => {
      question.answer = answer.value.trim();
      if (!question.answer) {
        answer.setCustomValidity('回答を入力するか、「おすすめに任せる」を選んでください。');
        answer.reportValidity();
        return;
      }
      answer.setCustomValidity('');
      if (!isLast) { item.activeIndex += 1; renderConversation(); return; }
      void submitQuestionAnswers(item);
    });
    answer.addEventListener('keydown', (event) => {
      if (event.key !== 'Enter' || event.shiftKey || event.isComposing || event.repeat) return;
      event.preventDefault();
      next.click();
    });
    actions.append(previous, recommend, next);
    content.append(actions);
    details.append(content);
    host.append(details);
  };

  const render = ({ scrollToBottom = false, scrollToResponseGroupId = '' } = {}) => {
    const conversation = getCurrentConversation();
    const previousScrollTop = messages.scrollTop;
    beforeRender(conversation, getClasses());
    messages.replaceChildren();
    const renderedResponseGroups = new Set();
    conversation.items.forEach((item) => {
      if (item.type === 'message') renderMessage(item);
      else if (item.type === 'scope-summary') {
        const details = document.createElement('details');
        details.className = 'ai-scope-summary';
        const summary = document.createElement('summary');
        const selectedCount = item.classes.filter((entry) => entry.shareType === '選択中').length;
        const referenceCount = item.classes.length - selectedCount;
        summary.textContent = `依頼対象範囲（選択中 ${selectedCount}件・選択外の参照 ${referenceCount}件）`;
        details.append(summary);
        const note = document.createElement('p');
        note.className = 'ai-scope-summary-note';
        note.textContent = '対象範囲の一覧です。実際の送信本文、差分・要約の再利用、分割ごとの内容は表示していません。';
        details.append(note);
        const list = document.createElement('ul');
        item.classes.forEach((entry) => {
          const row = document.createElement('li');
          row.textContent = `${entry.shareType}：${entry.typeLabel}「${entry.label || '(ラベルなし)'}」 (${entry.id}) / 親クラスID: ${entry.parentId || 'なし'}`;
          list.append(row);
        });
        details.append(list);
        messages.append(details);
      } else if (item.type === 'workflow-status') {
        const indicator = document.createElement('div');
        indicator.className = 'ai-thinking-indicator is-complete ai-workflow-status';
        indicator.setAttribute('role', 'status');
        indicator.setAttribute('aria-live', 'polite');
        indicator.textContent = item.text;
        messages.append(indicator);
      } else if (item.type === 'proposal' || item.type === 'questions') {
        const responseGroupId = item.responseGroupId || item;
        if (renderedResponseGroups.has(responseGroupId)) return;
        renderedResponseGroups.add(responseGroupId);
        const groupItems = conversation.items.filter((entry) =>
          (entry.type === 'proposal' || entry.type === 'questions')
          && (entry.responseGroupId || entry) === responseGroupId);
        const proposalItems = groupItems.filter((entry) => entry.type === 'proposal');
        const questionItems = groupItems.filter((entry) => entry.type === 'questions');
        const responseGroup = document.createElement('section');
        responseGroup.className = 'ai-response-group';
        if (item.responseGroupId) responseGroup.dataset.responseGroupId = item.responseGroupId;
        const readyProposalItems = proposalItems.filter((proposalItem) => proposalItem.status !== 'awaiting-answers');
        if (readyProposalItems.length) renderProposalQueue(readyProposalItems, responseGroup);
        questionItems.forEach((questionItem) => renderQuestionQueue(questionItem, responseGroup, render));
        messages.append(responseGroup);
      }
    });
    if (conversation.isThinking) messages.append(requestProgress.createThinkingIndicator(conversation));
    if (scrollToResponseGroupId) {
      const target = [...messages.querySelectorAll('[data-response-group-id]')]
        .find((element) => element.dataset.responseGroupId === scrollToResponseGroupId);
      if (target) {
        const offset = target.getBoundingClientRect().top - messages.getBoundingClientRect().top + messages.scrollTop;
        messages.scrollTo({ top: offset, behavior: 'smooth' });
      } else messages.scrollTop = previousScrollTop;
    } else messages.scrollTop = scrollToBottom ? messages.scrollHeight : previousScrollTop;
    status.textContent = conversation.isThinking ? '' : (conversation.status || '');
    updateUsageSummary();
    updateHistoryList();
    if (conversation.saved) persistSavedConversations();
  };

  return { render };
};
