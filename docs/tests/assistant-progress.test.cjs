const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const test = require('node:test');

const sourcePath = path.join(__dirname, '../web/js/editor/assistant/features/progress/progress-view.js');
const source = fs.readFileSync(sourcePath, 'utf8').replace(/^export /gm, '')
  .concat('\nmodule.exports = { createProgressView };');

test('progress view shows a live stage bubble with elapsed seconds and freezes at completion', () => {
  let now = 1000;
  let intervalCallback;
  let listener;
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
  } };
  const sandbox = {
    module: { exports: {} },
    document: { createElement: makeElement },
    window: {
      addEventListener(_name, callback) { listener = callback; },
      removeEventListener() {},
      setInterval(callback) { intervalCallback = callback; return ++timerId; },
      clearInterval() { intervalCallback = null; }
    },
    Date: { now: () => now },
    TypeError
  };
  vm.runInNewContext(source, sandbox);
  const view = sandbox.module.exports.createProgressView(status, messages);

  listener({ detail: { stage: 'planning' } });
  assert.equal(messages.children.length, 1);
  assert.equal(status.textContent, '');
  assert.equal(messages.children[0].textContent, '0s作業中');
  now = 12000;
  intervalCallback();
  assert.equal(messages.children[0].textContent, '11s作業中');
  listener({ detail: { stage: 'completed' } });
  assert.equal(messages.children.length, 1);
  assert.equal(messages.children[0].hidden, true);
  assert.equal(view.getElapsed(), '11s');
  assert.equal(intervalCallback, null);
  view.dispose();
});
