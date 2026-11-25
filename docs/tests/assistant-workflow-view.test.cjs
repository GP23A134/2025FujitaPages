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

test('workflow displays plan text as a chat message and creates no plan card', () => {
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
    unsupportedParts: [{ description: '新設クラスへの配置案', reason: 'クラス追加は未対応です。' }]
  } });

  assert.equal(root.children.length, 0);
  assert.equal(messages.children.length, 1);
  assert.equal(messages.children[0].className, 'ai-message');
  assert.equal(messages.children[0].dataset.assistantPlanMessage, 'true');
  assert.equal(messages.children[0].textContent, '選択範囲のクラス配置を確認します。今回対応できない内容は「新設クラスへの配置案」です。クラス追加は未対応です。');

  view.handle({ type: 'plan', plan: {
    summary: '選択範囲のクラス配置を確認します。', unsupportedParts: []
  } });
  assert.equal(messages.children.length, 1);
  assert.equal(messages.children[0].textContent, '選択範囲のクラス配置を確認します。');
});
