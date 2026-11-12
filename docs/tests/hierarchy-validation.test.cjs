const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const test = require('node:test');

const source = fs.readFileSync(path.join(__dirname, '../web/js/shared/hierarchy-validation.js'), 'utf8');
const window = {};
vm.runInNewContext(source, { window });
const validate = window.validateHierarchyGraph;

test('accepts a valid top-middle-target hierarchy', () => {
  const classes = [
    { id: 't1', type: 'top', label: '地域' },
    { id: 'm1', type: 'middle', label: '交通' },
    { id: 'c1', type: 'class', label: '移動手段' }
  ];
  const relations = [{ child: 'm1', parent: 't1' }, { child: 'c1', parent: 'm1' }];
  assert.equal(validate(classes, relations).length, 0);
});

test('rejects invalid type edges and middle classes under unclassified tops', () => {
  const classes = [
    { id: 't0', type: 'top', label: '未分類' },
    { id: 'm1', type: 'middle', label: '交通' },
    { id: 'c1', type: 'class', label: '移動' }
  ];
  const issues = validate(classes, [
    { child: 'm1', parent: 't0' },
    { child: 'c1', parent: 'c1' }
  ]);
  assert.ok(issues.some((issue) => issue.code === 'unclassified-middle'));
  assert.ok(issues.some((issue) => issue.code === 'invalid-type-edge'));
});

test('rejects multiple parents, missing parents, and cycles', () => {
  const classes = [
    { id: 't1', type: 'top', label: '地域' },
    { id: 't2', type: 'top', label: '交通' },
    { id: 'm1', type: 'middle', label: '移動' },
    { id: 'c1', type: 'class', label: '循環' },
    { id: 'c2', type: 'class', label: '所属なし' }
  ];
  const issues = validate(classes, [
    { child: 'm1', parent: 't1' },
    { child: 'm1', parent: 't2' },
    { child: 'c1', parent: 'c1' }
  ]);
  assert.ok(issues.some((issue) => issue.code === 'multiple-parents'));
  assert.ok(issues.some((issue) => issue.code === 'missing-parent' && issue.classIds.includes('c2')));
  assert.ok(issues.some((issue) => issue.code === 'cycle'));
});

test('allows missing parents while validating a partial upload chunk', () => {
  const issues = validate([{ id: 'c1', type: 'class', label: '単独' }], [], { requireParents: false });
  assert.equal(issues.length, 0);
});
