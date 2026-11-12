const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const test = require('node:test');

const sourcePath = path.join(__dirname, '../web/js/editor/ai/proposal-engine.js');
const source = fs.readFileSync(sourcePath, 'utf8')
  .replace(/^export /gm, '')
  .concat('\nmodule.exports = { reconcileSplitProposals, composeProposalOperations, conflictChoicesComplete, buildQuestionQueue };');
const moduleSandbox = { exports: {} };
vm.runInNewContext(source, { module: moduleSandbox, exports: moduleSandbox.exports, console });
const { reconcileSplitProposals, composeProposalOperations, conflictChoicesComplete, buildQuestionQueue } = moduleSandbox.exports;
const plain = (value) => JSON.parse(JSON.stringify(value));

const classes = [
  { id: 't1', type: 'top', label: '地域' },
  { id: 'm1', type: 'middle', label: '教育' },
  { id: 'm2', type: 'middle', label: '文化' },
  { id: 'm3', type: 'middle', label: '交通' },
  { id: 'm4', type: 'middle', label: '防災' },
  { id: 'm5', type: 'middle', label: '環境' },
  { id: 'c1', type: 'class', label: '対象A' },
  { id: 'c2', type: 'class', label: '対象B' },
  { id: 'c3', type: 'class', label: '対象C' }
];
const relations = [
  { child: 'm1', parent: 't1' }, { child: 'm2', parent: 't1' }, { child: 'm3', parent: 't1' },
  { child: 'm4', parent: 't1' }, { child: 'm5', parent: 't1' },
  { child: 'c1', parent: 'm1' }, { child: 'c2', parent: 'm3' }, { child: 'c3', parent: 'm4' }
];
const move = (classId, destinationId) => ({ type: 'moveClass', classId, destinationId });
const proposal = (id, operations, title = id) => ({ id, title, summary: title, reason: `${title}の根拠`, uncertainties: [], questions: [], operations });

test('keeps independent changes common and exposes only the overlapping move as a choice', () => {
  const [combined] = reconcileSplitProposals([
    proposal('p1', [move('c1', 'm2'), move('c2', 'm5')]),
    proposal('p2', [move('c1', 'm3'), move('c3', 'm5')])
  ], [], classes, relations);

  assert.equal(combined.sourceType, 'combined');
  assert.deepEqual(plain(combined.operations.map(({ classId }) => classId)).sort(), ['c2', 'c3']);
  assert.equal(combined.conflictGroups.length, 1);
  assert.deepEqual(plain(combined.conflictGroups[0].choices.map((choice) => choice.operations[0].destinationId)), ['m2', 'm3']);
  assert.deepEqual(plain(composeProposalOperations(combined, { conflict_1: 0 }).map(({ classId, destinationId }) => [classId, destinationId])), [
    ['c2', 'm5'], ['c3', 'm5'], ['c1', 'm2']
  ]);
  assert.deepEqual(plain(composeProposalOperations(combined, { conflict_1: 1 }).map(({ classId, destinationId }) => [classId, destinationId])), [
    ['c2', 'm5'], ['c3', 'm5'], ['c1', 'm3']
  ]);
});

test('keeps unrelated proposals separate when they do not conflict', () => {
  const result = reconcileSplitProposals([
    proposal('p1', [move('c1', 'm2')]),
    proposal('p2', [move('c2', 'm5')])
  ], [], classes, relations);

  assert.equal(result.length, 2);
  assert.ok(result.every((item) => !item.conflictGroups));
});

test('does not expose identical moves as duplicate choices', () => {
  const [combined] = reconcileSplitProposals([
    proposal('p1', [move('c1', 'm2'), move('c2', 'm5')]),
    proposal('p2', [move('c1', 'm2'), move('c3', 'm5')])
  ], [], classes, relations);

  assert.equal(combined.conflictGroups.length, 0);
  assert.equal(plain(combined.operations).filter((operation) => operation.classId === 'c1').length, 1);
});

test('creates a separate choice group for each independent conflict', () => {
  const [combined] = reconcileSplitProposals([
    proposal('p1', [move('c1', 'm2'), move('c2', 'm3'), move('c3', 'm5')]),
    proposal('p2', [move('c1', 'm3'), move('c2', 'm4'), move('c3', 'm5')])
  ], [], classes, relations);

  assert.equal(combined.conflictGroups.length, 2);
  assert.deepEqual(plain(composeProposalOperations(combined, { conflict_1: 1, conflict_2: 0 })
    .map(({ classId, destinationId }) => [classId, destinationId])), [
    ['c3', 'm5'], ['c1', 'm3'], ['c2', 'm3']
  ]);
});

test('keeps temporary class references unique when common operations are combined', () => {
  const [combined] = reconcileSplitProposals([
    proposal('p1', [
      move('c1', 'm2'),
      { type: 'addClass', classType: 'middle', temporaryId: 'tmp_1', label: '新設A', parentId: 't1' },
      move('c2', 'tmp_1')
    ]),
    proposal('p2', [
      move('c1', 'm3'),
      { type: 'addClass', classType: 'middle', temporaryId: 'tmp_1', label: '新設B', parentId: 't1' },
      move('c3', 'tmp_1')
    ])
  ], [], classes, relations);

  const commonAddIds = plain(combined.operations).filter((operation) => operation.type === 'addClass')
    .map((operation) => operation.temporaryId);
  assert.equal(new Set(commonAddIds).size, 2);
  assert.ok(commonAddIds.every((id) => id.startsWith('combined_tmp_')));
  assert.equal(combined.conflictGroups.length, 1);
});

test('treats moving into a class scheduled for deletion as a conflict', () => {
  const deletionClasses = [
    { id: 't1', type: 'top', label: '旧分類' },
    { id: 't2', type: 'top', label: '別分類' },
    { id: 'm1', type: 'middle', label: '削除対象' },
    { id: 'c1', type: 'class', label: '配下' },
    { id: 'c2', type: 'class', label: '移動対象' }
  ];
  const deletionRelations = [
    { child: 'm1', parent: 't1' }, { child: 'c1', parent: 'm1' }, { child: 'c2', parent: 't2' }
  ];
  const [combined] = reconcileSplitProposals([
    proposal('delete', [{ type: 'deleteClass', classId: 't1' }]),
    proposal('move', [move('c2', 't1')])
  ], [], deletionClasses, deletionRelations);

  assert.equal(combined.conflictGroups.length, 1);
  assert.equal(combined.operations.length, 0);
});

test('requires an explicit valid choice for every conflict before applying', () => {
  const composed = {
    operations: [],
    conflictGroups: [
      { id: 'a', choices: [{ operations: [move('c1', 'm2')] }, { operations: [move('c1', 'm3')] }] },
      { id: 'b', choices: [{ operations: [move('c2', 'm4')] }] }
    ]
  };

  assert.equal(conflictChoicesComplete(composed, {}), false);
  assert.equal(conflictChoicesComplete(composed, { a: 0 }), false);
  assert.equal(conflictChoicesComplete(composed, { a: 4, b: 0 }), false);
  assert.equal(conflictChoicesComplete(composed, { a: 1, b: 0 }), true);
});

test('applies the question limit to top-level and proposal questions together', () => {
  const first = proposal('p1', [move('c1', 'm2')]);
  first.questions = ['提案Aの確認'];
  const omitted = proposal('p2', [move('c2', 'm3')]);
  omitted.questions = ['提案Bの確認'];
  const result = buildQuestionQueue({
    questions: ['全体確認1', '全体確認2'],
    proposals: [first, omitted],
    maximum: 3,
    deduplicate: (items) => [...new Set(items)]
  });

  assert.equal(result.queuedQuestions.length, 3);
  assert.deepEqual(plain(result.queuedQuestions.map(({ text }) => text)), ['全体確認1', '全体確認2', '提案Aの確認']);
  assert.deepEqual(plain(result.queuedProposals.map(({ id }) => id)), ['p1']);
  assert.deepEqual(plain(result.omittedProposals.map(({ id }) => id)), ['p2']);
  assert.deepEqual(plain(omitted.questions), ['提案Bの確認']);
});
