const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const test = require('node:test');

const source = fs.readFileSync(path.join(__dirname, '../web/js/editor/assistant/features/planning/question-view.js'), 'utf8')
  .replace(/^export /gm, '').concat('\nmodule.exports = { createQuestionView };');

class Element {
  constructor(tag = '') {
    this.tag = tag; this.children = []; this.listeners = {}; this.dataset = {}; this.value = ''; this.disabled = false; this.hidden = false;
    this.attributes = {}; this.classes = new Set();
    this.classList = {
      add: (name) => this.classes.add(name), remove: (name) => this.classes.delete(name),
      contains: (name) => this.classes.has(name), toggle: (name, force) => {
        const enabled = force === undefined ? !this.classes.has(name) : Boolean(force);
        if (enabled) this.classes.add(name); else this.classes.delete(name);
        return enabled;
      }
    };
  }
  addEventListener(name, callback) { this.listeners[name] = callback; }
  append(...items) { items.forEach((item) => { if (item instanceof Element) item.parentElement = this; }); this.children.push(...items); }
  replaceChildren(...items) { items.forEach((item) => { if (item instanceof Element) item.parentElement = this; }); this.children = items; }
  setAttribute(name, value) { this.attributes[name] = String(value); }
  getAttribute(name) { return this.attributes[name] ?? null; }
  focus() {}
  click() { this.listeners.click?.({ target: this }); }
  querySelector(selector) {
    const all = this.querySelectorAll(selector);
    return all[0] || null;
  }
  querySelectorAll(selector) {
    const descendants = this.children.flatMap((child) => child instanceof Element ? [child, ...child.querySelectorAll('*')] : []);
    if (selector === '*') return descendants;
    if (selector === 'button[data-question-option], textarea') return descendants.filter((item) => item.tag === 'button' && item.dataset.questionOption !== undefined || item.tag === 'textarea');
    const option = selector.match(/^(?:button)?\[data-question-option(?:="([^"]+)")?\](?:\[aria-pressed="true"\])?$/);
    if (option) return descendants.filter((item) => item.tag === 'button' && item.dataset.questionOption !== undefined
      && (option[1] === undefined || item.dataset.questionOption === option[1])
      && (!selector.includes('aria-pressed') || item.getAttribute('aria-pressed') === 'true'));
    const freeformToggle = selector.match(/^\[data-question-freeform-toggle(?:="([^"]+)")?\]$/);
    if (freeformToggle) return descendants.filter((item) => item.tag === 'button' && item.dataset.questionFreeformToggle !== undefined
      && (freeformToggle[1] === undefined || item.dataset.questionFreeformToggle === freeformToggle[1]));
    const data = selector.match(/^(?:textarea)?\[data-question-text="([^"]+)"\]$/);
    if (data) return descendants.filter((item) => item.tag === 'textarea' && item.dataset.questionText === data[1]);
    return [];
  }
}

test('confirmation questions show selectable buttons with selected styling or direct text', async () => {
  const list = new Element('ol');
  const submit = new Element('button');
  const cancel = new Element('button');
  const dialog = {
    open: false,
    querySelector: (selector) => ({ '[data-question-list]': list, '[data-question-submit]': submit, '[data-question-cancel]': cancel })[selector],
    addEventListener(name, callback) { this.listeners ||= {}; this.listeners[name] = callback; },
    showModal() { this.open = true; },
    close() { this.open = false; }
  };
  const sandbox = { module: { exports: {} }, document: { createElement: (tag) => new Element(tag), createTextNode: (text) => ({ textContent: text }) } };
  vm.runInNewContext(source, sandbox);
  const view = sandbox.module.exports.createQuestionView(dialog);
  const pending = view.ask([
    { id: 'q1', text: '優先する案', options: [{ id: 'a', label: '案A' }, { id: 'b', label: '案B' }, { id: 'c', label: '案C' }, { id: 'd', label: '案D' }] },
    { id: 'q2', text: '補足', options: [] }
  ]);
  assert.equal(submit.disabled, true);
  const options = list.querySelectorAll('[data-question-option="0"]');
  assert.deepEqual(options.map((item) => item.textContent), ['1. 案A', '2. 案B', '3. 案C', '4. 案D']);
  options[2].click();
  assert.equal(options[2].getAttribute('aria-pressed'), 'true');
  assert.equal(options[2].classList.contains('is-selected'), true);
  const freeformToggle = list.querySelector('[data-question-freeform-toggle="1"]');
  const text = list.querySelector('textarea[data-question-text="1"]');
  assert.equal(text.hidden, true);
  freeformToggle.click();
  assert.equal(text.hidden, false);
  text.value = '独自の回答';
  text.listeners.input();
  assert.equal(text.parentElement?.classList.contains('is-selected'), true);
  assert.equal(submit.disabled, false);
  submit.click();
  assert.deepEqual(JSON.parse(JSON.stringify(await pending)), [
    { questionId: 'q1', optionId: 'c', text: '案C' },
    { questionId: 'q2', optionId: null, text: '独自の回答' }
  ]);
});
