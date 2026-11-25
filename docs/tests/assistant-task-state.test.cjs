const assert = require('node:assert/strict');
const test = require('node:test');
const { createTaskState, authorizeTaskAction, recordTaskAction, recordTaskCriterion, stopTask, resumeTask, completeTask } = require('../web/js/editor/chat/agent/application/task-state.js');

const task = (overrides = {}) => createTaskState({
  id: 'task-1', objective: '対象を確認する', completionCriteria: ['全対象を確認'],
  scopeIds: ['a', 'b'], dataVersion: 'v1', structureMode: 'existing', ...overrides
});

test('task action authorization accepts scoped existing-structure inspection', () => {
  assert.deepEqual(authorizeTaskAction(task(), {
    action: 'use_existing_structure', input: {}
  }, { scopeIds: ['a', 'b'], dataVersion: 'v1' }), { allowed: true, action: 'use_existing_structure', input: {} });
});

test('scope inspection is permitted before a named target has been resolved', () => {
  const unbound = task({ scopeIds: [] });
  assert.deepEqual(authorizeTaskAction(unbound, { action: 'inspect_scope', input: {} }, {
    scopeIds: [], dataVersion: 'v1'
  }), { allowed: true, action: 'inspect_scope', input: {} });
  assert.equal(authorizeTaskAction(unbound, { action: 'place_items', input: { targetIds: ['a'] } }, {
    scopeIds: [], dataVersion: 'v1'
  }).reason, 'scope_violation');
});

test('task action authorization rejects scope, structure, version, and iteration violations', () => {
  assert.equal(authorizeTaskAction(task(), { action: 'place_items', input: { targetIds: ['outside'] } }, { dataVersion: 'v1' }).reason, 'scope_violation');
  assert.equal(authorizeTaskAction(task(), { action: 'design_structure', input: {} }, { dataVersion: 'v1' }).reason, 'structure_mode_mismatch');
  assert.equal(authorizeTaskAction(task(), { action: 'inspect_scope', input: {} }, { dataVersion: 'v2' }).reason, 'data_version_changed');
  assert.equal(authorizeTaskAction(task(), { action: 'inspect_scope', input: {} }).reason, 'data_version_changed');
  const exhausted = { ...task(), iterationCount: 3 };
  assert.equal(authorizeTaskAction(exhausted, { action: 'inspect_scope', input: {} }, { maxIterations: 3, dataVersion: 'v1' }).reason, 'iteration_limit');
});

test('task completion remains blocked until unfinished items are cleared', () => {
  const waiting = stopTask(task(), { reason: 'review', awaitingUserInput: { reason: 'review' }, unfinishedItems: ['proposal review'] });
  assert.equal(authorizeTaskAction(waiting, { action: 'complete', input: {} }).reason, 'invalid_task_or_action');
  const resumed = resumeTask({ ...waiting, unfinishedItems: [] }, { scopeIds: ['a', 'b'], dataVersion: 'v1' });
  assert.equal(resumed.status, 'running');
  assert.equal(completeTask(resumed), null);
  const verified = recordTaskCriterion(resumed, '全対象を確認', { count: 2 });
  assert.equal(completeTask(verified).status, 'completed');
});

test('completion requires evidence for every declared criterion', () => {
  const state = task({ completionCriteria: ['全対象を確認', '結果を検証'] });
  const partial = recordTaskCriterion(state, '全対象を確認', { count: 2 });
  assert.equal(completeTask(partial), null);
  const full = recordTaskCriterion(partial, '結果を検証', { validator: 'passed' });
  assert.equal(completeTask(full).status, 'completed');
});

test('task action history is bounded and increments the iteration count', () => {
  const recorded = recordTaskAction(task(), { action: 'inspect_scope', input: {}, outcome: 'done' });
  assert.equal(recorded.iterationCount, 1);
  assert.equal(recorded.actionHistory[0].outcome, 'done');
});
