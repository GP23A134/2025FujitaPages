const test = require('node:test');
const assert = require('node:assert/strict');
const { pathToFileURL } = require('node:url');
const path = require('node:path');

const importModule = (relative) => import(pathToFileURL(path.join(__dirname, '..', relative)).href);
const memoryStorage = () => {
  const values = new Map();
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, String(value)),
    removeItem: (key) => values.delete(key),
    values
  };
};

test('history survives page reload in the same tab and stores transcript messages only', async () => {
  const { createHistoryService } = await importModule('web/js/editor/assistant/conversations/history-service.js');
  const sessionStorage = memoryStorage();
  const localStorage = memoryStorage();
  const service = createHistoryService({ sessionStorage, localStorage, now: () => 1000 });
  const record = {
    id: 'agent-1', title: '分類を整理', updatedAt: 1000, selectedIds: ['c1'],
    state: { apiKey: 'secret' },
    items: [
      { type: 'message', role: 'user', text: '移動案を考えて' },
      { type: 'proposal', proposal: { secret: true } },
      { type: 'message', role: 'assistant', text: '候補を確認しました' }
    ]
  };
  assert.equal(service.upsert(record), true);
  const restored = createHistoryService({ sessionStorage, localStorage, now: () => 1000 }).read();
  assert.equal(restored.length, 1);
  assert.equal(restored[0].assistantMode, 'agent');
  assert.deepEqual(restored[0].items.map(({ role }) => role), ['user', 'assistant']);
  assert.equal(JSON.stringify(restored).includes('secret'), false);
  assert.equal(localStorage.values.size, 0);
});

test('optional cross-tab history expires 24 hours after its latest update', async () => {
  const { createHistoryService } = await importModule('web/js/editor/assistant/conversations/history-service.js');
  const sessionStorage = memoryStorage();
  const localStorage = memoryStorage();
  let time = 10_000;
  const service = createHistoryService({ sessionStorage, localStorage, now: () => time });
  service.upsert({ id: 'agent-2', items: [{ type: 'message', role: 'user', text: '確認' }] }, true);
  assert.equal(service.read(true).length, 1);
  time += 24 * 60 * 60 * 1000;
  assert.equal(service.read(true).length, 1); // Same-tab session history remains available.
  assert.equal(service.read(true).filter((item) => item.id === 'agent-2').length, 1);
  assert.equal(localStorage.values.size, 0);
});

test('turning off cross-tab persistence removes shared history but keeps tab history', async () => {
  const { createHistoryService } = await importModule('web/js/editor/assistant/conversations/history-service.js');
  const sessionStorage = memoryStorage();
  const localStorage = memoryStorage();
  const service = createHistoryService({ sessionStorage, localStorage, now: () => 1000 });
  service.upsert({ id: 'agent-3', items: [{ type: 'message', role: 'user', text: '相談' }] }, true);
  assert.equal(localStorage.values.size, 1);
  service.setPersistAcrossTabs(false);
  assert.equal(localStorage.values.size, 0);
  assert.equal(service.read(false).length, 1);
});
