const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const test = require('node:test');

const sourcePath = path.join(__dirname, '../web/js/editor/assistant/features/progress/progress-view.js');
const source = fs.readFileSync(sourcePath, 'utf8').replace(/^export /gm, '')
  .concat('\nmodule.exports = { createProgressView };');

test('progress view stays after the submitted request and ahead of later messages', () => {
  let now = 1000;
  let intervalCallback;
  const listeners = new Map();
  let timerId = 0;
  const makeElement = () => ({
    className: '', textContent: '', dataset: {}, attributes: {}, classList: { add() {}, remove() {} },
    setAttribute(name, value) { this.attributes[name] = value; }
  });
  const status = makeElement();
  const messages = { children: [], scrollTop: 0, scrollHeight: 20, append(element) {
    this.children = this.children.filter((item) => item !== element);
    this.children.push(element);
    element.parentElement = this;
  }, insertBefore(element, reference) {
    this.children = this.children.filter((item) => item !== element);
    const index = reference ? this.children.indexOf(reference) : -1;
    this.children.splice(index < 0 ? 0 : index, 0, element);
    element.parentElement = this;
  } };
  const sandbox = {
    module: { exports: {} },
    document: { createElement: makeElement },
    window: {
      addEventListener(name, callback) { listeners.set(name, callback); },
      removeEventListener() {},
      setInterval(callback) { intervalCallback = callback; return ++timerId; },
      clearInterval() { intervalCallback = null; }
    },
    Date: { now: () => now },
    TypeError
  };
  vm.runInNewContext(source, sandbox);
  const view = sandbox.module.exports.createProgressView(status, messages);

  const userRequest = makeElement();
  messages.append(userRequest);
  listeners.get('assistant:progress')({ detail: { stage: 'planning' } });
  assert.equal(messages.children.length, 2);
  assert.equal(messages.children[0], userRequest);
  assert.equal(status.textContent, '');
  assert.equal(messages.children[1].textContent, '0s · 依頼を整理しています · APIトークン実績待ち');
  listeners.get('assistant-api-usage')({ detail: { usage: { input_tokens: 120, output_tokens: 18 } } });
  assert.equal(messages.children[1].textContent, '0s · 依頼を整理しています · API実績 入力 120 / 出力 18 tokens');
  listeners.get('assistant-api-usage')({ detail: { usage: { input_tokens: 20 } } });
  assert.equal(messages.children[1].textContent, '0s · 依頼を整理しています · API実績 入力 140 / 出力 18+不明 tokens');
  const earlierMessage = makeElement();
  messages.append(earlierMessage);
  listeners.get('assistant:progress')({ detail: { stage: 'analyzing' } });
  assert.equal(messages.children[1].textContent, '0s · 取得した情報を確認しています · API実績 入力 140 / 出力 18+不明 tokens');
  assert.equal(messages.children[2], earlierMessage);
  now = 12000;
  intervalCallback();
  assert.equal(messages.children[1].textContent, '11s · 取得した情報を確認しています · API実績 入力 140 / 出力 18+不明 tokens');
  listeners.get('assistant:progress')({ detail: { stage: 'completed' } });
  assert.equal(messages.children.length, 3);
  assert.equal(messages.children[1].hidden, false);
  assert.equal(messages.children[1].textContent, '11s · 処理が完了しました · API実績 入力 140 / 出力 18+不明 tokens');
  assert.equal(view.getElapsed(), '11s');
  assert.equal(intervalCallback, null);
  view.dispose();
});
