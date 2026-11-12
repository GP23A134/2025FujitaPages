const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const test = require('node:test');
const { webcrypto } = require('node:crypto');
const { TextEncoder } = require('node:util');

const source = fs.readFileSync(path.join(__dirname, '../web/js/shared/data-workspace.js'), 'utf8');
const activeLocks = new Set();
let nextId = 0;
const locks = {
  request: (name, options, callback) => {
    if (activeLocks.has(name)) return Promise.resolve().then(() => callback(null));
    activeLocks.add(name);
    return Promise.resolve().then(() => callback({ name, options })).finally(() => activeLocks.delete(name));
  }
};
const createMemoryIndexedDB = () => {
  const records = new Map();
  const database = {
    createObjectStore: () => {},
    close: () => {},
    transaction: () => {
      const transaction = { oncomplete: null, onerror: null, onabort: null };
      let pending = 0;
      let completionQueued = false;
      const maybeComplete = () => {
        if (pending || completionQueued) return;
        completionQueued = true;
        setTimeout(() => transaction.oncomplete?.(), 0);
      };
      const enqueue = (callback) => {
        pending += 1;
        queueMicrotask(() => {
          try { callback(); } catch (error) { transaction.error = error; transaction.onerror?.(); }
          pending -= 1;
          completionQueued = false;
          maybeComplete();
        });
      };
      transaction.objectStore = () => ({
        get: (key) => {
          const request = {};
          enqueue(() => { request.result = records.get(key); request.onsuccess?.(); });
          return request;
        },
        put: (value, key) => enqueue(() => records.set(key, value)),
        delete: (key) => enqueue(() => records.delete(key))
      });
      return transaction;
    }
  };
  return {
    open: () => {
      const request = {};
      queueMicrotask(() => {
        request.result = database;
        request.onupgradeneeded?.();
        request.onsuccess?.();
      });
      return request;
    }
  };
};

const createTab = (id, indexedDB = {}) => {
  const storage = new Map([['fujita-editor-workspace-session-v2', id]]);
  const sessionStorage = {
    getItem: (key) => storage.get(key) ?? null,
    setItem: (key, value) => storage.set(key, String(value))
  };
  const window = { name: '' };
  vm.runInNewContext(source, {
    window,
    navigator: { locks },
    sessionStorage,
    indexedDB,
    crypto: { randomUUID: () => `new-tab-${++nextId}`, subtle: webcrypto.subtle },
    TextEncoder,
    Uint8Array,
    console
  });
  return window.dataWorkspace;
};

test('uses different IndexedDB keys for distinct tabs', () => {
  const first = createTab('tab-a');
  const second = createTab('tab-b');
  assert.notEqual(first.createSessionKeys('tab-a').current, second.createSessionKeys('tab-b').current);
  assert.notEqual(first.createSessionKeys('tab-a').undo, second.createSessionKeys('tab-b').undo);
});

test('detects a duplicated session id and assigns the second tab a new workspace', async () => {
  const first = createTab('copied-session');
  const second = createTab('copied-session');
  const firstId = await first.beginSession();
  const secondId = await second.beginSession();
  assert.equal(firstId, 'copied-session');
  assert.notEqual(firstId, secondId);
  assert.notEqual(first.key, second.key);
  first.releaseSession();
  second.releaseSession();
});

test('reuses a session id after same-tab navigation releases its lock', async () => {
  const firstPage = createTab('same-tab-session');
  const firstId = await firstPage.beginSession();
  firstPage.releaseSession();
  await new Promise((resolve) => setTimeout(resolve, 0));
  const nextPage = createTab('same-tab-session');
  const nextId = await nextPage.beginSession();
  assert.equal(nextId, firstId);
  nextPage.releaseSession();
});

test('refreshes the saved initial workspace when any bundled data changes', async () => {
  const workspaceStore = createTab('default-version-test', createMemoryIndexedDB());
  await workspaceStore.beginSession();
  const initial = {
    classDataVersion: 'same-class-version',
    classData: { classes: [{ id: 't1', type: 'top', label: '初期' }], relations: [] },
    instanceData: { instances: [{ id: 'i1', label: '初期' }] }
  };
  await workspaceStore.rememberDefault(initial);
  const updated = {
    ...initial,
    instanceData: { instances: [{ id: 'i1', label: '更新後' }] }
  };
  await workspaceStore.rememberDefault(updated);
  assert.equal((await workspaceStore.restoreDefault()).instanceData.instances[0].label, '更新後');
});
