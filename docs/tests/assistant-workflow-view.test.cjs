const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const test = require('node:test');

const sourcePath = path.join(__dirname, '../web/js/editor/chat/agent/features/progress/workflow-view.js');
const source = fs.readFileSync(sourcePath, 'utf8').replace(/^export /gm, '')
  .concat('\nmodule.exports = { createWorkflowView };');

class Element {
  constructor(tagName) { this.tagName = tagName; this.children = []; this.dataset = {}; this.attributes = {}; }
  append(...items) { this.children.push(...items); }
  appendChild(item) { this.children.push(item); }
  setAttribute(name, value) { this.attributes[name] = value; }
  remove() { this.removed = true; }
  addEventListener() {}
  replaceChildren(...items) { this.children = items; }
  querySelector(selector) { return selector === '[data-assistant-plan-message]' ? this.children.find((item) => item.dataset.assistantPlanMessage) || null : null; }
  set textContent(value) { this._textContent = value; }
  get textContent() { return this._textContent || this.children.map((item) => item.textContent).join(''); }
}

test('workflow plan card does not duplicate the history message managed by the chat entrypoint', () => {
  const sandbox = {
    module: { exports: {} },
    document: { createElement: (tag) => new Element(tag) },
    CSS: { escape: (value) => value }
  };
  vm.runInNewContext(source, sandbox);
  const root = new Element('div');
  const messages = new Element('div');
  const view = sandbox.module.exports.createWorkflowView(root, {}, {}, { messages });
  view.handle({ type: 'plan', plan: {
    summary: '選択範囲のクラス配置を確認します。',
    executionBrief: { objective: '親子関係を確認する。' },
    steps: ['まず、選択範囲の対象クラスを確認します。', '親子関係を見て、結果をお伝えします。'],
    unsupportedParts: []
  } });

  assert.equal(root.children.length, 1);
  assert.equal(root.children[0].textContent, '選択範囲のクラス配置を確認します。');
  assert.equal(messages.children.length, 0);
});
