const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const test = require('node:test');

const root = path.join(__dirname, '../web/js/editor/assistant');
function load(relativePath, exportNames, stubs = {}) {
  const source = fs.readFileSync(path.join(root, relativePath), 'utf8')
    .replace(/^import .*;\s*$/gm, '')
    .replace(/^export /gm, '')
    .concat(`\nmodule.exports = { ${exportNames} };`);
  const sandboxModule = { exports: {} };
  vm.runInNewContext(source, { module: sandboxModule, exports: sandboxModule.exports, Object, Set, Map, Math, Error, TypeError, RangeError, ...stubs });
  return sandboxModule.exports;
}
const { createToolRegistry } = load('agent-runtime/tool-registry.js', 'createToolRegistry');
const { createEditorDataReader } = load('features/data-retrieval/editor-data-reader.js', 'createEditorDataReader', { createToolRegistry });

function fixture(scope, pageLimit = 100, idLimit = pageLimit) {
  let version = 'v1';
  const state = {
    classes: [
      { id: 't1', type: 'top', label: '食品' },
      { id: 'm1', type: 'middle', label: '飲料' },
      { id: 'm2', type: 'middle', label: '菓子' },
      { id: 'c1', type: 'class', label: '茶' }
    ],
    relations: [{ child: 'm1', parent: 't1' }, { child: 'm2', parent: 't1' }, { child: 'c1', parent: 'm1' }],
    counts: { t1: 1, m1: 1, m2: 0 }
  };
  const reader = createEditorDataReader({
    editor: { getState: () => state }, getReferenceScope: () => scope,
    getDataVersion: () => version, pageLimit, idLimit
  });
  return { reader, setVersion: (value) => { version = value; } };
}

function instanceFixture({ classLimit = 2, taskLimit = 3, includeIds = false, plannedContext = 'instance_content' } = {}) {
  const state = {
    classes: [
      { id: 't1', type: 'top', label: '発電' },
      { id: 'c1', type: 'class', label: '風車' },
      { id: 'c2', type: 'class', label: '鳥類' }
    ],
    relations: [{ child: 'c1', parent: 't1' }, { child: 'c2', parent: 't1' }],
    counts: { t1: 5, c1: 3, c2: 2 }
  };
  const instances = Array.from({ length: 8 }, (_, index) => ({ id: `i${index + 1}`, label: `事例${index + 1}` }));
  const memberships = [
    { instance: 'i1', class: 'c1' }, { instance: 'i2', class: 'c1' }, { instance: 'i3', class: 'c1' },
    { instance: 'i4', class: 'c2' }, { instance: 'i5', class: 'c2' }, { instance: 'i6', class: 'c2' },
    { instance: 'i7', class: 'c2' }, { instance: 'i8', class: 't1' }
  ];
  return createEditorDataReader({
    editor: { getState: () => state }, getReferenceScope: () => ['t1', 'c1', 'c2'],
    appData: { instanceData: { instances }, instanceClassData: { relations: memberships } },
    instanceInformationEnabled: true, instancePerClassLimit: classLimit, instancePerTaskLimit: taskLimit,
    includeInstanceIds: includeIds, plannedInstanceContext: plannedContext
  });
}

test('hierarchy index returns hierarchy fields without target-class rows or childIds', () => {
  const { reader } = fixture(['t1', 'm1', 'm2', 'c1']);
  const result = reader.readHierarchyIndex();
  const items = JSON.parse(JSON.stringify(result.items));
  assert.deepEqual(items.map(({ id, type, parentId, parentLabel, descendantTargetClassCount }) => [id, type, parentId, parentLabel, descendantTargetClassCount]), [
    ['m1', 'middle', 't1', '食品', 1], ['m2', 'middle', 't1', '食品', 0], ['t1', 'top', null, null, 1]
  ]);
  assert.ok(items.every((item) => !Object.hasOwn(item, 'childIds')));
});

test('hierarchy index and direct-child retrieval stop for program-built out-of-scope candidates', () => {
  const { reader } = fixture(['t1', 'm1', 'c1']);
  assert.throws(() => reader.readHierarchyIndex(), (error) => {
    assert.equal(error.code, 'SCOPE_EXPANSION_REQUIRED');
    assert.deepEqual(JSON.parse(JSON.stringify(error.scopeRequest.candidates)).map(({ id }) => id), ['m2']);
    return true;
  });
  assert.throws(() => reader.readChildren({ parentId: 't1' }), (error) => error.code === 'SCOPE_EXPANSION_REQUIRED');
});

test('pagination cursor is opaque, stable by version, and target details omit descendant counts', () => {
  const { reader, setVersion } = fixture(['t1', 'm1', 'm2', 'c1'], 2, 2);
  const first = reader.readHierarchyIndex();
  assert.equal(first.items.length, 2);
  assert.match(first.nextCursor, /^cursor_/);
  const last = reader.readHierarchyIndex({ cursor: first.nextCursor });
  assert.equal(last.nextCursor, null);
  assert.equal(last.items.length, 1);

  const details = reader.readClassDetails({ classIds: ['c1', 'missing'] });
  assert.equal(details.items[0].type, 'class');
  assert.equal(Object.hasOwn(details.items[0], 'descendantTargetClassCount'), false);
  assert.deepEqual(JSON.parse(JSON.stringify(details.notFoundIds)), ['missing']);

  const stale = reader.readHierarchyIndex();
  setVersion('v2');
  assert.throws(() => reader.readHierarchyIndex({ cursor: stale.nextCursor }), (error) => error.code === 'STALE_DATA');
});

test('detail retrieval enforces the shared per-call ID cap', () => {
  const { reader } = fixture(['t1', 'm1', 'm2', 'c1'], 2, 2);
  assert.throws(() => reader.readClassDetails({ classIds: ['t1', 'm1', 'm2'] }), (error) => error.code === 'ID_LIMIT');
});

test('instance contents obey per-class and task caps with reproducible sampling and no IDs by default', () => {
  const reader = instanceFixture();
  const first = reader.readInstanceContext({ classIds: ['t1'], context: 'instance_content' });
  const second = reader.readInstanceContext({ classIds: ['t1'], context: 'instance_content' });
  assert.equal(first.items.length, 2);
  assert.equal(first.items.reduce((sum, item) => sum + item.returnedCount, 0), 3);
  assert.equal(first.sampling.totalInstancesInAllowedScope, 7);
  assert.equal(first.sampling.overallLimitReached, true);
  assert.deepEqual(JSON.parse(JSON.stringify(first.items)), JSON.parse(JSON.stringify(second.items)));
  assert.ok(first.items.every((item) => item.instances.every((record) => Object.keys(record).join(',') === 'label')));
  assert.ok(first.items.some((item) => item.selectionMethod === 'deterministic_random_sample'));
});

test('instance membership summary returns counts only and context cannot exceed the plan', () => {
  const reader = instanceFixture({ plannedContext: 'membership_summary' });
  const summary = reader.readInstanceContext({ classIds: ['c1', 'c2'], context: 'membership_summary' });
  assert.deepEqual(JSON.parse(JSON.stringify(summary.items.map(({ classId, totalCount, selectionMethod, instances }) => [classId, totalCount, selectionMethod, instances]))), [
    ['c1', 3, 'count_only', null], ['c2', 4, 'count_only', null]
  ]);
  assert.throws(() => reader.readInstanceContext({ classIds: ['c1'], context: 'instance_content' }), (error) => error.code === 'INSTANCE_CONTEXT_NOT_PLANNED');
});

test('instance IDs are returned only under explicit developer allowance', () => {
  const reader = instanceFixture({ classLimit: 1, taskLimit: 10, includeIds: true });
  const result = reader.readInstanceContext({ classIds: ['c1'], context: 'instance_content' });
  assert.equal(typeof result.items[0].instances[0].id, 'string');
});
