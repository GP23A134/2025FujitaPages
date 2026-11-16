const assert = require('node:assert/strict');
const test = require('node:test');
const { createTargetMoveBatchProcessor } = require('../web/js/editor/assistant/features/proposals/target-move-batch.js');

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
  assert.equal(aiCalls, 2);
  assert.equal(submitted[0].items.length, 500);
  assert.equal(submitted[1].items.length, 1);
  assert.equal(JSON.stringify(submitted).includes('target-1'), false);
  assert.equal(response.proposals.length, 1);
  assert.equal(response.proposals[0].operations.length, 501);
  assert.equal(response.proposals[0].operations[0].target.classId, 'target-1');
  assert.equal(response.proposals[0].operations[500].newParent.classId, 'destination');
  assert.match(response.message, /501件は名称や階層からの推定/);
});
