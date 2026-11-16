const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const test = require('node:test');

const sourcePath = path.join(__dirname, '../web/js/editor/assistant/features/scope-approval/scope-approval-view.js');
const source = fs.readFileSync(sourcePath, 'utf8').replace(/^export /gm, '')
  .concat('\nmodule.exports = { createScopeApprovalView };');

class Element {
  constructor() { this.children = []; this.listeners = {}; this.dataset = {}; this.hidden = false; this.value = ''; }
  addEventListener(name, callback) { this.listeners[name] = callback; }
  append(...elements) { this.children.push(...elements); }
  replaceChildren(...elements) { this.children = elements; }
  setAttribute() {}
  click() { this.listeners.click?.({ preventDefault() {} }); }
}

test('scope approval shows summary first, details are read-only, and approval grants only listed classes', async () => {
  const selectors = [
    '[data-scope-title]', '[data-scope-summary]', '[data-scope-search]', '[data-scope-list]',
    '[data-scope-page]', '[data-scope-previous]', '[data-scope-next]', '[data-scope-allow]',
    '[data-scope-deny]', '[data-scope-close]'
  ];
  const elements = new Map(selectors.map((selector) => [selector, new Element()]));
  const dialog = {
    open: false,
    querySelector: (selector) => elements.get(selector),
    addEventListener(name, callback) { this.listeners ||= {}; this.listeners[name] = callback; },
    showModal() { this.open = true; },
    close() { this.open = false; }
  };
  const messages = new Element();
  const sandbox = { module: { exports: {} }, document: { createElement: () => new Element() }, TypeError, Set, Map, Math };
  vm.runInNewContext(source, sandbox);
  const view = sandbox.module.exports.createScopeApprovalView(dialog, {
    getState: () => ({
      classes: [
        { id: 'top-1', type: 'top', label: '食品' },
        { id: 'middle-1', type: 'middle', label: '飲料' },
        { id: 'target-1', type: 'class', label: '水' }
      ],
      relations: [{ parent: 'top-1', child: 'middle-1' }, { parent: 'middle-1', child: 'target-1' }],
      counts: { 'middle-1': 1 }
    })
  }, { messages });

  const decisionPromise = view.request({
    candidates: [{ id: 'middle-1' }], allowReference: true, allowChange: false,
    purpose: '参照範囲を追加します。', processSummary: '配置を確認します。'
  });
  assert.equal(dialog.open, false);
  assert.match(messages.children[0].children[1].textContent, /中間クラス 1件/);
  const actions = messages.children[0].children[3];
  actions.children[2].click();
  assert.equal(dialog.open, true);
  assert.equal(elements.get('[data-scope-list]').children[0].children.length, 1);
  elements.get('[data-scope-allow]').click();
  const result = await decisionPromise;
  assert.equal(result.choice, 'allow');
  assert.deepEqual([...result.referenceIds].sort(), ['middle-1']);
  assert.equal(result.changeIds.length, 0);

  const deniedPromise = view.request({
    candidates: [{ id: 'middle-1' }], allowReference: true, allowChange: false,
    purpose: '参照範囲を追加します。', processSummary: '配置を確認します。'
  });
  messages.children[1].children[3].children[1].click();
  const denied = await deniedPromise;
  assert.equal(denied.choice, 'original_scope');
  assert.equal(denied.referenceIds.length, 0);
});
