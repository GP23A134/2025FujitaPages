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
  assert.equal(messages.children.length, 3);
  assert.equal(messages.children[0], userRequest);
  assert.equal(status.textContent, '');
  assert.equal(messages.children[1].textContent, '0s');
  listeners.get('assistant:progress')({ detail: {
    stage: 'retrieving', tool: 'read_hierarchy_index', note: '100件取得。続きがあります'
  } });
  assert.equal(messages.children[1].textContent, '0s');
  assert.equal(messages.children[2].textContent, '階層索引を取得しています。100件取得。続きがあります');
  const earlierMessage = makeElement();
  messages.append(earlierMessage);
  listeners.get('assistant:progress')({ detail: { stage: 'analyzing' } });
  assert.equal(messages.children[1].textContent, '0s');
  assert.equal(messages.children[2].textContent, '取得した情報を確認しています');
  assert.equal(messages.children[3], earlierMessage);
  now = 12000;
  intervalCallback();
  assert.equal(messages.children[1].textContent, '11s');
  listeners.get('assistant:progress')({ detail: { stage: 'completed' } });
  assert.equal(messages.children.length, 4);
  assert.equal(messages.children[1].hidden, false);
  assert.equal(messages.children[1].textContent, '11s');
  assert.equal(messages.children[2].textContent, '処理が完了しました');
  assert.equal(view.getElapsed(), '11s');
  assert.equal(intervalCallback, null);
  view.dispose();
});
