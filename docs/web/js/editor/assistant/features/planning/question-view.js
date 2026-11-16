export function createQuestionView(dialog) {
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
