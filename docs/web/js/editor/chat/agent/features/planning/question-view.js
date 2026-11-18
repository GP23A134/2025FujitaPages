function createQuestionDockView(dock, messages) {
  let resolveCurrent = null;

  const appendAnswerMessage = (questions, answers) => {
    if (!messages) return;
    const byId = new Map(answers.map((answer) => [answer.questionId, answer]));
    const lines = questions.map((question) => `${question.text}\n${byId.get(question.id)?.text || ''}`);
    const message = document.createElement('div');
    message.className = 'ai-message is-user';
    message.setAttribute('role', 'article');
    const author = document.createElement('strong');
    author.textContent = 'あなた';
    const body = document.createElement('div');
    body.className = 'ai-message-body';
    const text = document.createElement('p');
    text.textContent = lines.join('\n\n');
    body.append(text);
    message.append(author, body);
    messages.append(message);
    messages.scrollTop = messages.scrollHeight;
  };

  const finish = (answers, questions) => {
    if (!resolveCurrent) return;
    const resolve = resolveCurrent;
    resolveCurrent = null;
    dock.replaceChildren();
    dock.hidden = true;
    appendAnswerMessage(questions, answers);
    resolve(answers);
  };

  return Object.freeze({
    ask(questions) {
      if (resolveCurrent) throw new Error('別の確認質問が表示されています。');
      const currentQuestions = questions || [];
      const panel = document.createElement('section');
      panel.className = 'assistant-question-panel';
      const answers = currentQuestions.map((question) => ({ questionId: question.id, optionId: null, text: '' }));
      const skipAnswers = () => finish(currentQuestions.map((question) => ({
        questionId: question.id,
        optionId: null,
        text: '回答はスキップします。追加条件はありません。AIの判断で進めてください。'
      })), currentQuestions);
      const header = document.createElement('div');
      header.className = 'assistant-question-header';
      const heading = document.createElement('div');
      heading.className = 'assistant-question-heading';
      const questionMark = document.createElement('span');
      questionMark.className = 'assistant-question-mark';
      questionMark.textContent = '?';
      questionMark.setAttribute('aria-hidden', 'true');
      const headingText = document.createElement('span');
      headingText.textContent = currentQuestions.length > 1 ? `確認事項（${currentQuestions.length}件）` : '質問';
      heading.append(questionMark, headingText);
      const close = document.createElement('button');
      close.type = 'button';
      close.className = 'assistant-question-close';
      close.textContent = '×';
      close.setAttribute('aria-label', '質問をスキップ');
      close.addEventListener('click', skipAnswers);
      header.append(heading, close);
      panel.append(header);

      const updateSubmit = (submit) => { submit.disabled = answers.some((answer) => !answer.text.trim()); };
      currentQuestions.forEach((question, index) => {
        const item = document.createElement('fieldset');
        item.className = 'assistant-question-item';
        const prompt = document.createElement('p');
        prompt.className = 'assistant-question-title';
        prompt.textContent = question.text;
        item.append(prompt);
        const options = document.createElement('div');
        options.className = 'assistant-question-options';
        (question.options || []).forEach((option, optionIndex) => {
          const button = document.createElement('button');
          button.type = 'button';
          button.className = 'assistant-question-option';
          const number = document.createElement('span');
          number.className = 'assistant-question-option-number';
          number.textContent = String(optionIndex + 1);
          const label = document.createElement('span');
          label.className = 'assistant-question-option-label';
          label.textContent = option.label;
          button.append(number, label);
          button.dataset.questionOption = String(index);
          button.setAttribute('aria-pressed', 'false');
          button.addEventListener('click', () => {
            options.querySelectorAll('[data-question-option]').forEach((candidate) => {
              candidate.setAttribute('aria-pressed', 'false');
              candidate.classList.remove('is-selected');
            });
            button.setAttribute('aria-pressed', 'true');
            button.classList.add('is-selected');
            freeformToggle.setAttribute('aria-expanded', 'false');
            answerInput.hidden = true;
            answerInput.value = '';
            freeform.classList.remove('is-selected');
            answers[index] = { questionId: question.id, optionId: option.id, text: option.label };
            updateSubmit(submit);
          });
          options.append(button);
        });

        const freeform = document.createElement('div');
        freeform.className = 'assistant-question-freeform';
        const freeformToggle = document.createElement('button');
        freeformToggle.type = 'button';
        freeformToggle.className = 'assistant-question-freeform-toggle';
        const pencil = document.createElement('span');
        pencil.className = 'assistant-question-pencil';
        pencil.textContent = '✎';
        pencil.setAttribute('aria-hidden', 'true');
        const freeformLabel = document.createElement('span');
        freeformLabel.textContent = 'または自分で回答を入力';
        freeformToggle.append(pencil, freeformLabel);
        freeformToggle.setAttribute('aria-expanded', 'false');
        const answerInput = document.createElement('textarea');
        answerInput.rows = 2;
        answerInput.placeholder = '候補にない回答を入力';
        answerInput.setAttribute('aria-label', `${question.text}への回答`);
        answerInput.hidden = true;
        freeformToggle.addEventListener('click', () => {
          const expanded = freeformToggle.getAttribute('aria-expanded') !== 'true';
          options.querySelectorAll('[data-question-option]').forEach((button) => {
            button.setAttribute('aria-pressed', 'false');
            button.classList.remove('is-selected');
          });
          freeformToggle.setAttribute('aria-expanded', String(expanded));
          answerInput.hidden = !expanded;
          freeform.classList.toggle('is-selected', expanded || Boolean(answerInput.value.trim()));
          answers[index] = { questionId: question.id, optionId: null, text: answerInput.value.trim() };
          if (expanded) answerInput.focus();
          updateSubmit(submit);
        });
        answerInput.addEventListener('input', () => {
          answers[index] = { questionId: question.id, optionId: null, text: answerInput.value.trim() };
          freeform.classList.toggle('is-selected', freeformToggle.getAttribute('aria-expanded') === 'true' || Boolean(answerInput.value.trim()));
          updateSubmit(submit);
        });
        freeform.append(freeformToggle, answerInput);
        options.append(freeform);
        item.append(options);
        panel.append(item);
      });

      const actions = document.createElement('div');
      actions.className = 'assistant-question-actions';
      const skip = document.createElement('button');
      skip.type = 'button';
      skip.className = 'secondary-search-button';
      skip.textContent = 'スキップ';
      skip.addEventListener('click', skipAnswers);
      const submit = document.createElement('button');
      submit.type = 'button';
      submit.className = 'search-button';
      submit.textContent = '送信';
      submit.disabled = true;
      submit.addEventListener('click', () => {
        if (answers.some((answer) => !answer.text.trim())) return;
        finish(answers.map((answer) => ({ ...answer })), currentQuestions);
      });
      actions.append(skip, submit);
      panel.append(actions);
      dock.replaceChildren(panel);
      dock.hidden = false;
      dock.scrollIntoView?.({ block: 'nearest' });
      return new Promise((resolve) => { resolveCurrent = resolve; });
    }
  });
}

export function createQuestionView(dialog, { dock = null, messages = null } = {}) {
  if (dock) return createQuestionDockView(dock, messages);
  const list = dialog.querySelector('[data-question-list]');
  const submit = dialog.querySelector('[data-question-submit]');
  const cancel = dialog.querySelector('[data-question-cancel]');
  let resolveCurrent = null;
  let currentQuestions = [];

  const finish = (answer) => {
    if (!resolveCurrent) return;
    const resolve = resolveCurrent;
    resolveCurrent = null;
    dialog.close();
    resolve(answer);
  };

  const collectAnswers = () => currentQuestions.map((question, index) => {
    const selected = list.querySelector(`button[data-question-option="${index}"][aria-pressed="true"]`);
    const input = list.querySelector(`[data-question-text="${index}"]`);
    const text = input?.value.trim() || '';
    if (!selected && !text) return null;
    return {
      questionId: question.id,
      optionId: selected?.dataset.optionId || null,
      text: selected ? selected.dataset.optionLabel : text
    };
  });

  const updateSubmitState = () => {
    submit.disabled = collectAnswers().some((answer) => !answer);
  };

  submit.addEventListener('click', () => {
    const answers = collectAnswers();
    if (answers.some((answer) => !answer)) return;
    finish(answers);
  });
  cancel.addEventListener('click', () => finish(null));
  dialog.addEventListener('cancel', (event) => { event.preventDefault(); finish(null); });

  return Object.freeze({
    ask(questions, { submitLabel = '回答して再計画' } = {}) {
      if (resolveCurrent) throw new Error('別の確認質問が表示されています。');
      currentQuestions = questions || [];
      list.replaceChildren();
      currentQuestions.forEach((question, index) => {
        const item = document.createElement('li');
        const prompt = document.createElement('p');
        prompt.textContent = question.text;
        item.append(prompt);
        const options = question.options || [];
        const optionList = document.createElement('div');
        optionList.className = 'assistant-question-options';
        options.forEach((option, optionIndex) => {
          const button = document.createElement('button');
          button.type = 'button';
          button.className = 'assistant-question-option';
          button.textContent = `${optionIndex + 1}. ${option.label}`;
          button.dataset.questionOption = String(index);
          button.dataset.optionId = option.id;
          button.dataset.optionLabel = option.label;
          button.setAttribute('aria-pressed', 'false');
          button.addEventListener('click', () => {
            const buttons = list.querySelectorAll(`[data-question-option="${index}"]`);
            const wasSelected = button.getAttribute('aria-pressed') === 'true';
            buttons.forEach((candidate) => {
              candidate.setAttribute('aria-pressed', 'false');
              candidate.classList.remove('is-selected');
            });
            freeformToggle.setAttribute('aria-expanded', 'false');
            answerInput.hidden = true;
            freeformCard.classList.remove('is-selected');
            if (!wasSelected) {
              button.setAttribute('aria-pressed', 'true');
              button.classList.add('is-selected');
            }
            const textInput = list.querySelector(`[data-question-text="${index}"]`);
            if (textInput) textInput.value = '';
            updateSubmitState();
          });
          optionList.append(button);
        });
        const freeformCard = document.createElement('div');
        freeformCard.className = 'assistant-question-freeform';
        const freeformToggle = document.createElement('button');
        freeformToggle.type = 'button';
        freeformToggle.className = 'assistant-question-freeform-toggle';
        freeformToggle.dataset.questionFreeformToggle = String(index);
        freeformToggle.textContent = options.length ? '自由入力で回答' : '回答を入力';
        freeformToggle.setAttribute('aria-expanded', 'false');
        const answerInput = document.createElement('textarea');
        answerInput.dataset.questionText = String(index);
        answerInput.rows = 2;
        answerInput.setAttribute('aria-label', `${question.text}への回答`);
        answerInput.hidden = true;
        freeformToggle.addEventListener('click', () => {
          const expanded = freeformToggle.getAttribute('aria-expanded') !== 'true';
          list.querySelectorAll(`[data-question-option="${index}"]`).forEach((button) => {
            button.setAttribute('aria-pressed', 'false');
            button.classList.remove('is-selected');
          });
          freeformToggle.setAttribute('aria-expanded', String(expanded));
          answerInput.hidden = !expanded;
          freeformCard.classList.toggle('is-selected', expanded || Boolean(answerInput.value.trim()));
          if (expanded) answerInput.focus();
          updateSubmitState();
        });
        answerInput.addEventListener('input', () => {
          if (answerInput.value.trim()) {
            list.querySelectorAll(`[data-question-option="${index}"]`).forEach((button) => {
              button.setAttribute('aria-pressed', 'false');
              button.classList.remove('is-selected');
            });
          }
          freeformCard.classList.toggle('is-selected', freeformToggle.getAttribute('aria-expanded') === 'true' || Boolean(answerInput.value.trim()));
          updateSubmitState();
        });
        freeformCard.append(freeformToggle, answerInput);
        optionList.append(freeformCard);
        item.append(optionList);
        list.append(item);
      });
      submit.textContent = submitLabel;
      updateSubmitState();
      dialog.showModal();
      const initialFocus = list.querySelector('button[data-question-option]')
        || list.querySelector('[data-question-freeform-toggle]')
        || list.querySelector('textarea');
      initialFocus?.focus();
      return new Promise((resolve) => { resolveCurrent = resolve; });
    }
  });
}
