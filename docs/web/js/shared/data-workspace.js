// Large uploaded datasets live in IndexedDB so they are not limited by Web Storage quotas.
(() => {
  const DATABASE = 'fujita-editor-workspace';
  const STORE = 'workspaces';
  const SESSION_KEY = 'fujita-editor-workspace-session-v2';
  const LEGACY_SESSION_KEY = 'fujita-editor-workspace-session-v1';
  const WINDOW_NAME_PREFIX = 'fujita-workspace-session:';
  const DEFAULT_KEY = 'default';
  let sessionId = '';
  let sessionKeys = null;
  let releaseSessionLock = null;

  const createSessionKeys = (id) => ({
    current: `session:${id}:current`,
    undo: `session:${id}:undo`,
    redo: `session:${id}:redo`,
    selectionToRestore: `session:${id}:selection-to-restore`
  });
  const makeId = () => globalThis.crypto?.randomUUID?.()
    || `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`;
  const openDatabase = () => new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  const withStore = async (mode, operation) => {
    const database = await openDatabase();
    return new Promise((resolve, reject) => {
      const transaction = database.transaction(STORE, mode);
      const request = operation(transaction.objectStore(STORE));
      let result;
      if (request) {
        request.onsuccess = () => { result = request.result; };
        request.onerror = () => reject(request.error);
      }
      transaction.oncomplete = () => { database.close(); resolve(result); };
      transaction.onerror = () => { database.close(); reject(transaction.error); };
      transaction.onabort = () => { database.close(); reject(transaction.error || new Error('IndexedDB transaction aborted')); };
    });
  };
  const claimTabLock = async (id) => {
    if (!navigator.locks?.request) return true;
    let resolveAcquired;
    const acquired = new Promise((resolve) => { resolveAcquired = resolve; });
    let release;
    const holdLock = new Promise((resolve) => { release = resolve; });
    navigator.locks.request(`fujita-editor-workspace:${id}`, { ifAvailable: true }, async (lock) => {
      resolveAcquired(Boolean(lock));
      if (lock) await holdLock;
    }).catch((error) => {
      console.warn('[データ読み込み] タブ間の作業領域ロックを取得できません。', error);
      resolveAcquired(null);
    });
    const result = await acquired;
    if (result) releaseSessionLock = release;
    return result;
  };
  const readSessionValue = (key) => {
    try { return sessionStorage.getItem(key); } catch { return null; }
  };
  const writeSessionValue = (key, value) => {
    try { sessionStorage.setItem(key, value); } catch (error) {
      console.warn('[データ読み込み] タブの作業領域IDを保存できません。', error);
    }
  };
  const dataFingerprint = async (workspace) => {
    const serialized = JSON.stringify(workspace);
    if (globalThis.crypto?.subtle && globalThis.TextEncoder) {
      const digest = await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(serialized));
      return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
    }
    let first = 2166136261;
    let second = 2246822519;
    for (let index = 0; index < serialized.length; index += 1) {
      const code = serialized.charCodeAt(index);
      first = Math.imul(first ^ code, 16777619);
      second = Math.imul(second ^ code, 3266489917);
    }
    return `${first >>> 0}-${second >>> 0}`;
  };
  const copyLegacySession = async () => {
    if (readSessionValue(LEGACY_SESSION_KEY) !== 'active'
        || readSessionValue(`${SESSION_KEY}:legacy-migrated`) === 'yes') return;
    const legacyKeys = ['current', 'undo', 'redo', 'selection-to-restore'];
    const database = await openDatabase();
    await new Promise((resolve, reject) => {
      const transaction = database.transaction(STORE, 'readwrite');
      const store = transaction.objectStore(STORE);
      legacyKeys.forEach((oldKey) => {
        const request = store.get(oldKey);
        request.onsuccess = () => {
          const value = request.result;
          const slot = oldKey === 'selection-to-restore' ? 'selectionToRestore' : oldKey;
          if (value === undefined) return;
          const currentRequest = store.get(sessionKeys[slot]);
          currentRequest.onsuccess = () => {
            if (currentRequest.result === undefined) store.put(value, sessionKeys[slot]);
          };
          currentRequest.onerror = () => transaction.abort();
        };
        request.onerror = () => transaction.abort();
      });
      transaction.oncomplete = () => { database.close(); resolve(); };
      transaction.onerror = () => { database.close(); reject(transaction.error); };
      transaction.onabort = () => { database.close(); reject(transaction.error || new Error('IndexedDB transaction aborted')); };
    });
    writeSessionValue(`${SESSION_KEY}:legacy-migrated`, 'yes');
  };
  const switchWorkspace = async (fromSlot, toSlot, currentSelection = []) => {
    const database = await openDatabase();
    return new Promise((resolve, reject) => {
      const transaction = database.transaction(STORE, 'readwrite');
      const store = transaction.objectStore(STORE);
      const currentRequest = store.get(sessionKeys.current);
      const sourceRequest = store.get(sessionKeys[fromSlot]);
      let switched = false;
      let currentReady = false;
      let sourceReady = false;
      const apply = () => {
        if (!currentReady || !sourceReady || currentRequest.result === undefined || sourceRequest.result === undefined) return;
        const source = sourceRequest.result;
        const sourceWorkspace = source.workspace || source;
        store.put({ workspace: currentRequest.result, selection: currentSelection }, sessionKeys[toSlot]);
        store.put(sourceWorkspace, sessionKeys.current);
        store.put(source.selection || null, sessionKeys.selectionToRestore);
        store.delete(sessionKeys[fromSlot]);
        switched = true;
      };
      currentRequest.onsuccess = () => { currentReady = true; apply(); };
      sourceRequest.onsuccess = () => { sourceReady = true; apply(); };
      transaction.oncomplete = () => { database.close(); resolve(switched); };
      transaction.onerror = () => { database.close(); reject(transaction.error); };
      transaction.onabort = () => { database.close(); reject(transaction.error || new Error('IndexedDB transaction aborted')); };
    });
  };
  const beginSession = async () => {
    if (sessionKeys) return sessionId;
    const storedId = readSessionValue(SESSION_KEY);
    const namedId = typeof window.name === 'string' && window.name.startsWith(WINDOW_NAME_PREFIX)
      ? window.name.slice(WINDOW_NAME_PREFIX.length) : '';
    const supportsTabLocks = Boolean(navigator.locks?.request);
    let candidate = supportsTabLocks
      ? (storedId || namedId || makeId())
      : (namedId || makeId());
    let lockResult = await claimTabLock(candidate);
    if (lockResult !== true) {
      candidate = makeId();
      lockResult = await claimTabLock(candidate);
    }
    if (lockResult === false) throw new Error('このタブの作業領域を確保できませんでした。ページを再読み込みしてください。');
    sessionId = candidate;
    sessionKeys = createSessionKeys(sessionId);
    writeSessionValue(SESSION_KEY, sessionId);
    if (!namedId || namedId !== sessionId) {
      try { window.name = `${WINDOW_NAME_PREFIX}${sessionId}`; } catch { /* sessionStorage remains the fallback */ }
    }
    await copyLegacySession();
    return sessionId;
  };
  const requireSession = () => {
    if (!sessionKeys) throw new Error('作業領域の初期化が完了していません。');
    return sessionKeys;
  };
  const dataWorkspace = {
    get key() { return sessionKeys?.current || null; },
    createSessionKeys,
    beginSession,
    rememberDefault: async (workspace) => {
      const version = await dataFingerprint(workspace);
      const existing = await withStore('readonly', (store) => store.get(DEFAULT_KEY));
      if (existing?.version === version) return;
      await withStore('readwrite', (store) => store.put({ version, workspace }, DEFAULT_KEY));
    },
    restoreDefault: async () => {
      const stored = await withStore('readonly', (store) => store.get(DEFAULT_KEY));
      return stored?.workspace || stored || null;
    },
    restore: async () => {
      const keys = requireSession();
      try {
        const workspace = await withStore('readonly', (store) => store.get(keys.current));
        return workspace?.classData && workspace?.instanceData ? workspace : null;
      } catch (error) {
        console.error('[データ読み込み] 作業データを復元できません。', error);
        return null;
      }
    },
    hasUndo: async () => Boolean(await withStore('readonly', (store) => store.get(requireSession().undo))),
    hasRedo: async () => Boolean(await withStore('readonly', (store) => store.get(requireSession().redo))),
    save: async (workspace, previousWorkspace = null, previousSelection = []) => {
      const keys = requireSession();
      const database = await openDatabase();
      return new Promise((resolve, reject) => {
        const transaction = database.transaction(STORE, 'readwrite');
        const store = transaction.objectStore(STORE);
        const request = store.get(keys.current);
        request.onsuccess = () => {
          const previous = previousWorkspace || request.result;
          if (previous) store.put({ workspace: previous.workspace || previous, selection: previous.selection || previousSelection }, keys.undo);
          else store.delete(keys.undo);
          store.delete(keys.redo);
          store.put(workspace, keys.current);
        };
        transaction.oncomplete = () => { database.close(); resolve(); };
        transaction.onerror = () => { database.close(); reject(transaction.error); };
        transaction.onabort = () => { database.close(); reject(transaction.error || new Error('IndexedDB transaction aborted')); };
      });
    },
    undoUpload: (selection) => switchWorkspace('undo', 'redo', selection),
    redoUpload: (selection) => switchWorkspace('redo', 'undo', selection),
    takeSelectionToRestore: async () => {
      const keys = requireSession();
      const selection = await withStore('readonly', (store) => store.get(keys.selectionToRestore));
      await withStore('readwrite', (store) => store.delete(keys.selectionToRestore));
      return selection;
    },
    clearRedo: async () => {
      await withStore('readwrite', (store) => store.delete(requireSession().redo));
      window.__dataWorkspaceRedoAvailable = false;
      const redoButton = document.getElementById('redo-edit');
      if (redoButton && !redoButton.disabled) {
        redoButton.disabled = true;
        redoButton.title = 'やり直す履歴はありません';
      }
    },
    releaseSession: () => {
      releaseSessionLock?.();
      releaseSessionLock = null;
    }
  };
  window.dataWorkspace = dataWorkspace;
})();
