const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const test = require('node:test');

const source = fs.readFileSync(path.join(__dirname, '../web/js/editor/chat/agent/application/id-set.js'), 'utf8')
  .replace(/^export /gm, '').concat('\nmodule.exports = { sameIdSet };');
const sandboxModule = { exports: {} };
vm.runInNewContext(source, { module: sandboxModule, exports: sandboxModule.exports, JSON, Set, Array });
const { sameIdSet } = sandboxModule.exports;

test('job target identity ignores order but detects missing or malformed IDs', () => {
  assert.equal(sameIdSet(['a', 'b', 'b'], ['b', 'a']), true);
  assert.equal(sameIdSet(['a', 'b'], ['a']), false);
  assert.equal(sameIdSet(['a', null], ['a']), false);
});
