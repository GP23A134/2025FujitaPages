const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const sourcePath = path.join(__dirname, '../web/js/editor/assistant/features/usage/usage-accounting.js');
const source = fs.readFileSync(sourcePath, 'utf8').replace(/^export /gm, '')
  .concat('\nmodule.exports = { createUsageAccounting, estimateUsageCost };');
const sandboxModule = { exports: {} };
vm.runInNewContext(source, { module: sandboxModule, exports: sandboxModule.exports, Number, Math });
const { createUsageAccounting } = sandboxModule.exports;

const pricing = { pricingAsOf: '2026-11-06', models: [
  { id: 'cheap', pricingVerified: true, inputUsdPerMillion: 0.1, cachedInputUsdPerMillion: 0.01, cacheWriteUsdPerMillion: 0.125, outputUsdPerMillion: 0.5 },
  { id: 'unknown', pricingVerified: false }
] };

test('accounts for planner and agent usage, cached tokens, and per-task reset', () => {
  const usage = createUsageAccounting();
  usage.record('cheap', { input_tokens: 1000, output_tokens: 200 });
  usage.record('cheap', { input_tokens: 1000, output_tokens: 100, input_tokens_details: { cached_tokens: 400, cache_write_tokens: 100 } });
  const result = usage.summary(pricing);
  assert.equal(result.task.requests, 2);
  assert.equal(result.task.inputTokens, 2000);
  assert.equal(result.task.outputTokens, 300);
  assert.equal(result.task.known, true);
  assert.ok(Math.abs(result.task.costUsd - 0.0003165) < 1e-12);
  usage.resetTask();
  assert.equal(usage.summary(pricing).task.requests, 0);
  assert.equal(usage.summary(pricing).session.requests, 2);
});

test('marks unverified model pricing or missing usage as unknown instead of inventing a cost', () => {
  const usage = createUsageAccounting();
  usage.record('unknown', { input_tokens: 100, output_tokens: 50 });
  assert.equal(usage.summary(pricing).task.known, false);
  usage.resetTask();
  usage.record('cheap', null);
  assert.equal(usage.summary(pricing).task.known, false);
});
