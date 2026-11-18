const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const test = require('node:test');

const sourcePath = path.join(__dirname, '../web/js/editor/chat/agent/features/proposals/proposal-contract.js');
const source = fs.readFileSync(sourcePath, 'utf8').replace(/^export /gm, '')
  .concat('\nmodule.exports = { validateProposalResponse };');
const sandboxModule = { exports: {} };
vm.runInNewContext(source, { module: sandboxModule, exports: sandboxModule.exports, Object, Set, Map, JSON, TypeError, Error });
const { validateProposalResponse } = sandboxModule.exports;

const classes = [
  { id: 't1', type: 'top', label: '地域' },
  { id: 'm1', type: 'middle', label: '教育' },
  { id: 'm2', type: 'middle', label: '文化' },
  { id: 'c1', type: 'class', label: '対象A' }
];
const relations = [{ child: 'm1', parent: 't1' }, { child: 'm2', parent: 't1' }, { child: 'c1', parent: 'm1' }];
const existing = (classId) => ({ kind: 'existing_class', classId, tempId: null });
const temporary = (tempId) => ({ kind: 'temporary_class', classId: null, tempId });
const proposal = (operations, id = 'p1') => ({ id, title: '移動', summary: '対象を移動する', reason: '分類を合わせる', uncertainties: [], questions: [], operations });
const response = (proposals, alternativeGroups = []) => ({ message: '検証済み提案', proposals, alternativeGroups });
function fixture({ reject = false } = {}) {
  const calls = [];
  const editor = {
    getState: () => ({ classes, relations, counts: { t1: 1, m1: 1, m2: 0 } }),
    applyOperations: (...args) => {
      calls.push(args);
      if (reject) throw new Error('hierarchy rejected');
      return { classes: [...classes], relations: [...relations] };
    }
  };
  return { calls, editor };
}

test('validates a proposal atomically against approved change and reference ranges', () => {
  const { editor, calls } = fixture();
  const result = validateProposalResponse(response([proposal([{
    type: 'move_target_class', target: existing('c1'), newParent: existing('m2'), tempId: null, label: null
  }])]), { editor, referenceIds: ['t1', 'm1', 'm2', 'c1'], changeIds: ['c1'], dataVersion: 'v1' });
  assert.equal(result.proposals.length, 1);
  assert.equal(result.blocked.length, 0);
  assert.equal(calls.length, 1);
  assert.deepEqual(JSON.parse(JSON.stringify(calls[0][0])), [{ type: 'moveClass', classId: 'c1', destinationId: 'm2' }]);
});

test('holds proposals that modify outside the change grant or reference outside the read grant', () => {
  const { editor } = fixture();
  const raw = proposal([{
    type: 'move_target_class', target: existing('c1'), newParent: existing('m2'), tempId: null, label: null
  }]);
  const changeDenied = validateProposalResponse(response([raw]), { editor, referenceIds: ['m2'], changeIds: [] });
  assert.equal(changeDenied.proposals.length, 0);
  assert.match(changeDenied.blocked[0].reason, /許可されていないクラス範囲/);
  assert.deepEqual(JSON.parse(JSON.stringify(changeDenied.scopeRequests)), [{ classId: 'c1', needsReference: true, needsChange: true }]);
  const referenceDenied = validateProposalResponse(response([raw]), { editor, referenceIds: ['c1'], changeIds: ['c1'] });
  assert.equal(referenceDenied.proposals.length, 0);
  assert.match(referenceDenied.blocked[0].reason, /許可されていないクラス範囲/);
});

test('temporary IDs are usable only after ordered addition and resolve to editor operations', () => {
  const { editor, calls } = fixture();
  const result = validateProposalResponse(response([proposal([
    { type: 'add_middle_class', target: null, newParent: existing('t1'), tempId: 'tmp_new', label: '新しい区分' },
    { type: 'move_target_class', target: existing('c1'), newParent: temporary('tmp_new'), tempId: null, label: null }
  ])]), { editor, referenceIds: ['t1', 'c1'], changeIds: ['c1'] });
  assert.equal(result.proposals.length, 1);
  assert.deepEqual(JSON.parse(JSON.stringify(calls[0][0])).map((item) => item.type), ['addClass', 'moveClass']);

  const invalid = validateProposalResponse(response([proposal([
    { type: 'move_target_class', target: existing('c1'), newParent: temporary('tmp_later'), tempId: null, label: null },
    { type: 'add_middle_class', target: null, newParent: existing('t1'), tempId: 'tmp_later', label: '後から追加' }
  ])]), { editor, referenceIds: ['t1', 'c1'], changeIds: ['c1'] });
  assert.equal(invalid.proposals.length, 0);
});

test('program validation failures keep invalid proposals out of the preview', () => {
  const { editor } = fixture({ reject: true });
  const result = validateProposalResponse(response([proposal([{
    type: 'move_target_class', target: existing('c1'), newParent: existing('m2'), tempId: null, label: null
  }])]), { editor, referenceIds: ['t1', 'm1', 'm2', 'c1'], changeIds: ['c1'] });
  assert.equal(result.proposals.length, 0);
  assert.equal(result.blocked[0].reason, 'hierarchy rejected');
});

test('proposal questions accept up to four options and hold malformed confirmation choices', () => {
  const { editor } = fixture();
  const raw = { ...proposal([{ type: 'move_target_class', target: existing('c1'), newParent: existing('m2'), tempId: null, label: null }]),
    questions: [{ id: 'q1', text: 'どちらですか？', options: [
      { id: 'a', label: 'A' }, { id: 'b', label: 'B' }, { id: 'c', label: 'C' }, { id: 'd', label: 'D' }, { id: 'e', label: 'E' }
    ] }]
  };
  const result = validateProposalResponse(response([raw]), { editor, referenceIds: ['c1', 'm2'], changeIds: ['c1'] });
  assert.equal(result.proposals.length, 0);
  assert.match(result.blocked[0].reason, /質問/);
});

test('alternative groups accept only existing proposals with at most three choices', () => {
  const { editor } = fixture();
  const operations = [{ type: 'move_target_class', target: existing('c1'), newParent: existing('m2'), tempId: null, label: null }];
  const result = validateProposalResponse(response([proposal(operations, 'p1'), proposal(operations, 'p2')], [
    { id: 'g1', proposalIds: ['p1', 'p2'] }
  ]), { editor, referenceIds: ['t1', 'm1', 'm2', 'c1'], changeIds: ['c1'] });
  assert.equal(result.alternativeGroups.length, 1);
  const bad = validateProposalResponse(response([proposal(operations)], [{ id: 'g2', proposalIds: ['p1', 'missing'] }]), {
    editor, referenceIds: ['t1', 'm1', 'm2', 'c1'], changeIds: ['c1']
  });
  assert.equal(bad.alternativeGroups.length, 0);
  assert.ok(bad.blocked.length);
});

test('conflicting moves from separate proposals are converted into exclusive choices', () => {
  const { editor } = fixture();
  const toM1 = proposal([{ type: 'move_target_class', target: existing('c1'), newParent: existing('m1'), tempId: null, label: null }], 'move-m1');
  const toM2 = proposal([{ type: 'move_target_class', target: existing('c1'), newParent: existing('m2'), tempId: null, label: null }], 'move-m2');
  const result = validateProposalResponse(response([toM1, toM2]), {
    editor, referenceIds: ['t1', 'm1', 'm2', 'c1'], changeIds: ['c1']
  });
  assert.equal(result.proposals.length, 2);
  assert.deepEqual(JSON.parse(JSON.stringify(result.alternativeGroups)), [{ id: 'conflict_1', proposalIds: ['move-m1', 'move-m2'] }]);
});

test('target-class rename requires the feature setting and uses editor validation when enabled', () => {
  const { editor, calls } = fixture();
  const raw = proposal([{ type: 'rename_target_class', target: existing('c1'), newParent: null, tempId: null, label: '対象A-変更' }]);
  const disabled = validateProposalResponse(response([raw]), {
    editor, referenceIds: ['c1'], changeIds: ['c1'], allowedOperations: ['rename_target_class'], targetRenameEnabled: false
  });
  assert.equal(disabled.proposals.length, 0);
  const enabled = validateProposalResponse(response([raw]), {
    editor, referenceIds: ['c1'], changeIds: ['c1'], allowedOperations: ['rename_target_class'], targetRenameEnabled: true
  });
  assert.equal(enabled.proposals.length, 1);
  assert.equal(calls.at(-1)[4].allowTargetRename, true);
});
