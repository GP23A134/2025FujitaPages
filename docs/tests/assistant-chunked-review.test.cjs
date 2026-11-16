const assert = require('node:assert/strict');
const test = require('node:test');
const { createChunkedReadOnlyReview } = require('../web/js/editor/assistant/features/data-retrieval/chunked-read-only-review.js');

test('selected class reviews process 12,000 records in bounded batches and retain only compact findings', async () => {
  const records = Array.from({ length: 12000 }, (_, index) => ({
    id: `internal-${index}`,
    label: `対象クラス${index}`,
    type: 'class',
    parentId: `parent-${Math.floor(index / 20)}`,
    parentLabel: `中間クラス${Math.floor(index / 20)}`
  }));
  let reads = 0;
  let retrievals = 0;
  let responses = 0;
  let submittedItems = 0;
  let largestBatch = 0;
  const reader = {
    readSelectedClassDetails({ cursor }) {
      reads += 1;
      const offset = cursor ? Number(cursor) : 0;
      const items = records.slice(offset, offset + 100);
      const nextOffset = offset + items.length;
      return { items, totalCount: records.length, notFoundIds: [], nextCursor: nextOffset < records.length ? String(nextOffset) : null };
    }
  };
  const budgetGuard = {
    countRetrieval() { retrievals += 1; },
    assertResponseAllowed() {},
    reserveInput() { return { id: ++responses }; },
    countResponse() {},
    reconcileInput() { return { overBudget: false }; },
    getCounters() { return { retrievals, responses }; }
  };
  const client = {
    async request({ input }) {
      const payload = JSON.parse(input[1].content);
      if (Array.isArray(payload.items)) {
        submittedItems += payload.items.length;
        largestBatch = Math.max(largestBatch, payload.items.length);
        return { output: [{ content: [{ type: 'output_text', text: JSON.stringify({
          checkedCount: payload.items.length, summary: '配置を確認しました。', findings: [], moreFindingsMayExist: false
        }) }] }] };
      }
      return { usage: { input_tokens: 10 }, output: [{ content: [{ type: 'output_text', text: JSON.stringify({ message: '全体を確認しました。' }) }] }] };
    }
  };
  const review = createChunkedReadOnlyReview({
    reader, client, budgetGuard, model: 'test-model', apiKey: 'key', request: '配置を確認',
    plan: { executionBrief: { objective: '選択対象を確認', successCriteria: [] } },
    pageLimit: 100, maxOutputTokens: 5000
  });

  const result = await review.run();
  assert.equal(result.status, undefined);
  assert.equal(reads, 120);
  assert.equal(retrievals, 120);
  assert.equal(submittedItems, 12000);
  assert.equal(largestBatch, 1000);
  assert.match(JSON.parse(result.text).message, /12,000件を全12バッチで確認しました/);
});
