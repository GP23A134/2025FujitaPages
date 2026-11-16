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

test('session storage resumes after reload, excludes credentials, and clears explicitly', async () => {
  const { createSessionService } = await importModule('web/js/editor/assistant/conversations/session-service.js');
  const sessionStorage = memoryStorage();
  const localStorage = memoryStorage();
  const service = createSessionService({ sessionStorage, localStorage, now: () => 1000 });
  const snapshot = { state: { id: 's1', status: 'needs_clarification', counters: { responseRounds: 2 } }, plan: { status: 'needs_clarification' }, apiKey: 'secret' };
  assert.equal(service.save(snapshot, false), true);
  const restored = service.read(false);
  assert.equal(restored.state.id, 's1');
  assert.equal(JSON.stringify(restored).includes('secret'), false);
  assert.equal(localStorage.values.size, 0);
  service.clear();
  assert.equal(service.read(false), null);
});

test('cross-tab persistence expires 24 hours after its last save', async () => {
  const { createSessionService } = await importModule('web/js/editor/assistant/conversations/session-service.js');
  const sessionStorage = memoryStorage();
  const localStorage = memoryStorage();
  let time = 10_000;
  const service = createSessionService({ sessionStorage, localStorage, now: () => time });
  service.save({ state: { id: 's2', status: 'needs_proposal_review' } }, true);
  assert.equal(service.read(true).state.id, 's2');
  time += 24 * 60 * 60 * 1000;
  assert.equal(service.read(true), null);
  assert.equal(localStorage.values.size, 0);
});
