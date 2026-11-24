const assert = require('node:assert/strict');
const test = require('node:test');
const { createTargetMoveBatchProcessor } = require('../web/js/editor/chat/agent/features/proposals/target-move-batch.js');

test('target moves are decided in compact batches and assembled locally into operations', async () => {
  const records = Array.from({ length: 501 }, (_, index) => ({
    id: `target-${index + 1}`, label: `対象${index + 1}`, type: 'class',
    parentId: 'old-parent', parentLabel: '旧分類'
  }));
  const submitted = [];
  let aiCalls = 0;
  const reader = {
    readHierarchyIndex: () => ({ items: [{ id: 'destination', label: '目的語', type: 'top', parentId: null, parentLabel: null }], nextCursor: null }),
    readSelectedClassDetails({ cursor }) {
      const offset = cursor ? Number(cursor) : 0;
      const items = records.slice(offset, offset + 2);
      const next = offset + items.length;
      return { items, totalCount: records.length, nextCursor: next < records.length ? String(next) : null };
    }
  };
  const counters = { retrievals: 0, responses: 0 };
  const budgetGuard = {
    countRetrieval() { counters.retrievals += 1; },
    assertResponseAllowed() {},
    reserveInput(input) { return { input }; },
    countResponse() { counters.responses += 1; },
    reconcileInput() { return { overBudget: false }; },
    getCounters() { return { ...counters }; }
  };
  const client = { async request({ input }) {
    aiCalls += 1;
    const payload = JSON.parse(input[1].content);
    submitted.push(payload);
    if (!Array.isArray(payload.items)) {
      return { output: [{ content: [{ type: 'output_text', text: JSON.stringify({ destinationKeys: ['d1'], noCandidateReason: '' }) }] }] };
    }
    const assignments = payload.items.map((item) => ({
      itemNumber: item.itemNumber, decision: 'move', destinationKey: 'd1', confidence: 'estimated'
    }));
    const destinationNotes = [{ destinationKey: 'd1', reason: '名称と階層から移動先を推定しました。', uncertainties: ['名称だけでは一部の意味に曖昧さがあります。'] }];
    return { usage: { input_tokens: 100 }, output: [{ content: [{ type: 'output_text', text: JSON.stringify({ assignments, destinationNotes }) }] }] };
  } };
  const processor = createTargetMoveBatchProcessor({
    reader, client, budgetGuard, model: 'test', apiKey: 'secret', request: '目的語へ移す案。推定でもよい',
    plan: { executionBrief: { objective: '選択対象を目的語へ移す', successCriteria: [] } },
    pageLimit: 1000, maxOutputTokens: 5000
  });

  const result = await processor.run();
  const response = JSON.parse(result.text);
  assert.equal(aiCalls, 7);
  assert.deepEqual(submitted.filter((item) => Array.isArray(item.items)).map((item) => item.items.length), [100, 100, 100, 100, 100, 1]);
  assert.equal(JSON.stringify(submitted).includes('target-1'), false);
  assert.equal(response.proposals.length, 1);
  assert.equal(response.proposals[0].operations.length, 501);
  assert.equal(response.proposals[0].operations[0].target.classId, 'target-1');
  assert.equal(response.proposals[0].operations[500].newParent.classId, 'destination');
  assert.match(response.message, /501件は名称と親子関係からの推定/);
});

test('target move checkpoints resume only pending batches and reject changed scope or data', async () => {
  const records = Array.from({ length: 101 }, (_, index) => ({
    id: `resume-target-${index + 1}`, label: `対象${index + 1}`, type: 'class',
    parentId: 'old-parent', parentLabel: '旧分類'
  }));
  const calls = [];
  const reader = (source = records) => ({
    readHierarchyIndex: () => ({ items: [{ id: 'destination', label: '移動先', type: 'top', parentId: null, parentLabel: null }], nextCursor: null }),
    readSelectedClassDetails({ cursor }) {
      const offset = cursor ? Number(cursor) : 0;
      return { items: source.slice(offset, offset + 500), nextCursor: null };
    }
  });
  const client = { async request({ input }) {
    const payload = JSON.parse(input[1].content);
    if (!Array.isArray(payload.items)) {
      calls.push('destinations');
      return { output: [{ content: [{ type: 'output_text', text: JSON.stringify({ destinationKeys: ['d1'], noCandidateReason: '' }) }] }] };
    }
    calls.push(payload.items.length);
    const assignments = payload.items.map((item) => ({
      itemNumber: item.itemNumber, decision: 'move', destinationKey: 'd1', confidence: 'high'
    }));
    return { usage: { input_tokens: 10 }, output: [{ content: [{ type: 'output_text', text: JSON.stringify({ assignments, destinationNotes: [{ destinationKey: 'd1', reason: '適合', uncertainties: [] }] }) }] }] };
  } };
  const makeBudget = (failAt = Infinity) => {
    let reservations = 0;
    return {
      countRetrieval() {}, assertResponseAllowed() {},
      reserveInput() {
        reservations += 1;
        if (reservations === failAt) throw Object.assign(new Error('budget stop'), { code: 'INPUT_TOKEN_BUDGET', status: 'budget_exhausted' });
        return {};
      },
      countResponse() {}, reconcileInput() { return { overBudget: false }; },
      getCounters() { return { responseRounds: 0, inputTokensActual: 0 }; }
    };
  };
  const options = {
    reader: reader(), client, model: 'test', apiKey: 'secret', request: '対象を移動先へ移す', jobRequest: '対象を移動先へ移す',
    plan: { executionBrief: { objective: '対象を移動する', successCriteria: [] } },
    maxOutputTokens: 5000, dataVersion: 'data-v1'
  };
  const first = await createTargetMoveBatchProcessor({ ...options, budgetGuard: makeBudget(3) }).run();
  assert.equal(first.budgetLimited, true);
  assert.equal(first.checkpoint.status, 'paused');
  assert.equal(calls.filter((item) => item === 100).length, 1);
  assert.deepEqual(first.checkpoint.phases.map((phase) => phase.id), ['target-decisions', 'uncertain-retry-1', 'uncertain-retry-2']);

  const beforeResume = calls.length;
  const resumed = await createTargetMoveBatchProcessor({ ...options, budgetGuard: makeBudget(), jobCheckpoint: first.checkpoint }).run();
  const response = JSON.parse(resumed.text);
  assert.equal(resumed.budgetLimited, false);
  assert.equal(resumed.checkpoint.status, 'completed');
  assert.equal(calls.length - beforeResume, 1);
  assert.equal(response.proposals[0].operations.length, 101);

  const changedScope = createTargetMoveBatchProcessor({
    ...options, reader: reader(records.slice(0, 100)), budgetGuard: makeBudget(), jobCheckpoint: first.checkpoint
  });
  assert.equal((await changedScope.run()).status, 'stale_job');
  const changedVersion = createTargetMoveBatchProcessor({
    ...options, dataVersion: 'data-v2', budgetGuard: makeBudget(), jobCheckpoint: first.checkpoint
  });
  assert.equal((await changedVersion.run()).status, 'stale_job');
});

test('uncertain retry decisions are checkpointed and resumed without repeating completed retry batches', async () => {
  const records = Array.from({ length: 101 }, (_, index) => ({
    id: `uncertain-target-${index + 1}`, label: `曖昧対象${index + 1}`, type: 'class',
    parentId: 'old-parent', parentLabel: '旧分類'
  }));
  let responseCalls = 0;
  const reader = {
    readHierarchyIndex: () => ({ items: [{ id: 'destination', label: '移動先', type: 'top', parentId: null, parentLabel: null }], nextCursor: null }),
    readSelectedClassDetails: ({ cursor }) => {
      const offset = cursor ? Number(cursor) : 0;
      return { items: records.slice(offset, offset + 500), nextCursor: null };
    }
  };
  const client = { async request({ input }) {
    const payload = JSON.parse(input[1].content);
    if (!Array.isArray(payload.items)) {
      responseCalls += 1;
      return { output: [{ content: [{ type: 'output_text', text: JSON.stringify({ destinationKeys: ['d1'], noCandidateReason: '' }) }] }] };
    }
    responseCalls += 1;
    const retry = input[0].content.includes('保留分の再判定');
    const assignments = payload.items.map((item) => ({
      itemNumber: item.itemNumber,
      decision: retry ? 'move' : 'uncertain',
      destinationKey: retry ? 'd1' : null,
      confidence: retry ? 'estimated' : 'uncertain'
    }));
    const destinationNotes = retry ? [{ destinationKey: 'd1', reason: '再判定で移動候補にしました。', uncertainties: [] }] : [];
    return { usage: { input_tokens: 10 }, output: [{ content: [{ type: 'output_text', text: JSON.stringify({ assignments, destinationNotes }) }] }] };
  } };
  const makeBudget = (failAt = Infinity) => {
    let reservations = 0;
    return {
      countRetrieval() {}, assertResponseAllowed() {},
      reserveInput() {
        reservations += 1;
        if (reservations === failAt) throw Object.assign(new Error('budget stop'), { code: 'INPUT_TOKEN_BUDGET', status: 'budget_exhausted' });
        return {};
      },
      countResponse() {}, reconcileInput() { return { overBudget: false }; },
      getCounters() { return { responseRounds: 0, inputTokensActual: 0 }; }
    };
  };
  const options = {
    reader, client, model: 'test', apiKey: 'secret', request: '対象を移動先へ移す', jobRequest: '対象を移動先へ移す',
    plan: { executionBrief: { objective: '対象を移動する', successCriteria: [] } },
    maxOutputTokens: 5000, dataVersion: 'data-v1'
  };
  const first = await createTargetMoveBatchProcessor({ ...options, budgetGuard: makeBudget(5) }).run();
  assert.equal(first.budgetLimited, true);
  const retryPhase = first.checkpoint.phases.find((phase) => phase.id === 'uncertain-retry-1');
  assert.equal(retryPhase.units[0].status, 'completed');
  assert.equal(retryPhase.units[1].status, 'paused');
  const beforeResumeCalls = responseCalls;

  const resumed = await createTargetMoveBatchProcessor({ ...options, budgetGuard: makeBudget(), jobCheckpoint: first.checkpoint }).run();
  const response = JSON.parse(resumed.text);
  assert.equal(resumed.checkpoint.status, 'completed');
  assert.equal(responseCalls - beforeResumeCalls, 1);
  assert.equal(response.proposals[0].operations.length, 101);
  assert.match(response.message, /101件を依頼条件/);
  assert.doesNotMatch(response.message, /保留中の/);
});
