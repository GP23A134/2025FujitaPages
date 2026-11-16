export function createQuestionView(dialog) {
  const list = dialog.querySelector('[data-question-list]');
  const answerInput = dialog.querySelector('[data-question-answer]');
  const submit = dialog.querySelector('[data-question-submit]');
  const cancel = dialog.querySelector('[data-question-cancel]');
  let resolveCurrent = null;

  const finish = (answer) => {
    if (!resolveCurrent) return;
    const resolve = resolveCurrent;
    resolveCurrent = null;
    dialog.close();
    resolve(answer);
  };
  submit.addEventListener('click', () => finish(answerInput.value.trim()));
  cancel.addEventListener('click', () => finish(null));
  dialog.addEventListener('cancel', (event) => { event.preventDefault(); finish(null); });

  return Object.freeze({
    ask(questions) {
      if (resolveCurrent) throw new Error('別の確認質問が表示されています。');
      list.replaceChildren();
      for (const [index, question] of questions.entries()) {
        const item = document.createElement('li');
        item.textContent = `${index + 1}. ${question.text}`;
        list.append(item);
      }
      answerInput.value = '';
      dialog.showModal();
      answerInput.focus();
      return new Promise((resolve) => { resolveCurrent = resolve; });
    }
  });
}
