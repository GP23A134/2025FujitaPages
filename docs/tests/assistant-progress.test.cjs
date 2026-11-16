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
  const makeElement = () => {
    const element = { className: '', textContent: '', dataset: {}, attributes: {}, classes: new Set() };
    element.classList = {
      add(name) { element.classes.add(name); },
      remove(name) { element.classes.delete(name); },
      toggle(name, force) { if (force) element.classes.add(name); else element.classes.delete(name); return force; }
    };
    element.setAttribute = (name, value) => { element.attributes[name] = value; };
    return element;
  };
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
  assert.equal(messages.children[2].textContent, '依頼を整理しています');
  assert.equal(messages.children[2].classes.has('is-active'), true);
  listeners.get('assistant:progress')({ detail: {
    stage: 'retrieving', tool: 'read_hierarchy_index', note: '100件取得。続きがあります'
  } });
  assert.equal(messages.children[1].textContent, '0s');
  assert.equal(messages.children[2].textContent, '階層索引を取得しています。100件取得。続きがあります');
  const earlierMessage = makeElement();
  messages.append(earlierMessage);
  listeners.get('assistant:progress')({ detail: { stage: 'analyzing' } });
  assert.equal(messages.children[1].textContent, '0s');
  assert.equal(messages.children[2], earlierMessage);
  assert.equal(messages.children[3].textContent, '取得した情報を確認しています');
  now = 3662000;
  intervalCallback();
  assert.equal(messages.children[1].textContent, '1h1m1s');
  listeners.get('assistant:progress')({ detail: { stage: 'completed' } });
  assert.equal(messages.children.length, 4);
  assert.equal(messages.children[1].hidden, false);
  assert.equal(messages.children[1].textContent, '1h1m1s間作業しました');
  assert.equal(messages.children[2], earlierMessage);
  assert.equal(messages.children[3].textContent, '処理が完了しました');
  assert.equal(messages.children[3].classes.has('is-active'), false);
  assert.equal(view.getElapsed(), '1h1m1s');
  assert.equal(intervalCallback, null);
  view.dispose();
});
