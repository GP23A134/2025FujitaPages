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

const createTab = (id, indexedDB = {}, tabLocks = locks, BroadcastChannelImpl = null, windowName = '') => {
  const storage = new Map([['fujita-editor-workspace-session-v2', id]]);
  const sessionStorage = {
    getItem: (key) => storage.get(key) ?? null,
    setItem: (key, value) => storage.set(key, String(value))
  };
  const window = { name: windowName };
  const context = {
    window,
    navigator: tabLocks ? { locks: tabLocks } : {},
    sessionStorage,
    indexedDB,
    crypto: { randomUUID: () => `new-tab-${++nextId}`, subtle: webcrypto.subtle },
    TextEncoder,
    Uint8Array,
    setTimeout,
    console
  };
  if (BroadcastChannelImpl) context.BroadcastChannel = BroadcastChannelImpl;
  vm.runInNewContext(source, {
    ...context
  });
  return window.dataWorkspace;
};

const createBroadcastChannel = () => {
  const channels = new Set();
  return class {
    constructor(name) { this.name = name; channels.add(this); }
    postMessage(data) {
      channels.forEach((channel) => {
        if (channel !== this && channel.name === this.name) queueMicrotask(() => channel.onmessage?.({ data }));
      });
    }
    close() { channels.delete(this); }
  };
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

test('detects duplicated workspaces with BroadcastChannel when Web Locks are unavailable', async () => {
  const BroadcastChannelImpl = createBroadcastChannel();
  const first = createTab('copied-session', {}, null, BroadcastChannelImpl);
  const second = createTab('copied-session', {}, null, BroadcastChannelImpl);
  const [firstId, secondId] = await Promise.all([first.beginSession(), second.beginSession()]);

  assert.notEqual(firstId, secondId);
  assert.notEqual(first.key, second.key);
  first.releaseSession();
  second.releaseSession();
});

test('reuses a workspace after same-tab navigation in the BroadcastChannel fallback', async () => {
  const BroadcastChannelImpl = createBroadcastChannel();
  const sessionName = 'fujita-workspace-session:same-tab-fallback';
  const first = createTab('same-tab-fallback', {}, null, BroadcastChannelImpl, sessionName);
  const firstId = await first.beginSession();
  first.releaseSession();
  const nextPage = createTab(firstId, {}, null, BroadcastChannelImpl, `fujita-workspace-session:${firstId}`);
  const nextId = await nextPage.beginSession();

  assert.equal(nextId, firstId);
  nextPage.releaseSession();
});

test('uses a fresh workspace instead of reusing a copied id when no tab lock API exists', async () => {
  const indexedDB = createMemoryIndexedDB();
  const seed = createTab('copied-session', indexedDB);
  await seed.beginSession();
  const savedWorkspace = {
    classData: { classes: [{ id: 't1', type: 'top', label: '保存済み' }], relations: [] },
    instanceData: { instances: [] }
  };
  await seed.save(savedWorkspace);
  seed.releaseSession();

  const copiedName = 'fujita-workspace-session:copied-session';
  const first = createTab('copied-session', indexedDB, null, null, copiedName);
  const second = createTab('copied-session', indexedDB, null, null, copiedName);
  const [firstId, secondId] = await Promise.all([first.beginSession(), second.beginSession()]);

  assert.notEqual(firstId, 'copied-session');
  assert.notEqual(firstId, secondId);
  assert.deepEqual((await first.restore()).classData.classes, savedWorkspace.classData.classes);
  assert.deepEqual((await second.restore()).classData.classes, savedWorkspace.classData.classes);
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
