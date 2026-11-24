const assert = require('node:assert/strict');
const test = require('node:test');
const { runJobLoop } = require('../web/js/editor/chat/agent/application/job-loop.js');

const phase = (execute) => ({
  id: 'work',
  units: [{ id: 'a' }, { id: 'b' }, { id: 'c' }],
  execute,
  validate: () => true,
  validatePhase: (results) => results.length === 3
});

test('job loop pauses and resumes from the first unfinished unit', async () => {
  const firstRun = [];
  const paused = await runJobLoop({
    dataVersion: 'v1', checkpointEvery: 1,
    phases: [phase(async (unit) => {
      firstRun.push(unit.id);
      if (unit.id === 'b') throw Object.assign(new Error('budget'), { code: 'INPUT_TOKEN_BUDGET', status: 'budget_exhausted' });
      return { id: unit.id };
    })]
  });
  assert.equal(paused.status, 'paused');
  assert.deepEqual(firstRun, ['a', 'b']);
  assert.equal(paused.checkpoint.phases[0].units[0].status, 'completed');
  assert.equal(paused.checkpoint.phases[0].units[1].status, 'paused');

  const resumedRun = [];
  const resumed = await runJobLoop({
    checkpoint: paused.checkpoint, dataVersion: 'v1',
    phases: [phase(async (unit) => { resumedRun.push(unit.id); return { id: unit.id }; })]
  });
  assert.equal(resumed.status, 'completed');
  assert.deepEqual(resumedRun, ['b', 'c']);
  assert.deepEqual(resumed.checkpoint.phases[0].units.map((unit) => unit.status), ['completed', 'completed', 'completed']);
});

test('job loop refuses a checkpoint from another data version', async () => {
  let executed = false;
  const initial = await runJobLoop({
    dataVersion: 'old', phases: [{ id: 'work', units: [], execute: async () => null, validate: () => true }]
  });
  const result = await runJobLoop({
    checkpoint: initial.checkpoint, dataVersion: 'new',
    phases: [{ id: 'work', units: [], execute: async () => { executed = true; }, validate: () => true }]
  });
  assert.equal(result.status, 'stale');
  assert.equal(executed, false);
});

test('job loop records an explicit interruption before starting a unit', async () => {
  const controller = new AbortController();
  controller.abort();
  const result = await runJobLoop({
    dataVersion: 'v1', signal: controller.signal,
    phases: [phase(async (unit) => ({ id: unit.id }))]
  });
  assert.equal(result.status, 'interrupted');
  assert.equal(result.checkpoint.status, 'interrupted');
  assert.equal(result.checkpoint.phases[0].units[0].status, 'paused');
});
