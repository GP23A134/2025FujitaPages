// Large uploaded datasets live in IndexedDB so they are not limited by Web Storage quotas.
(() => {
  const DATABASE = 'fujita-editor-workspace';
  const STORE = 'workspaces';
  const KEY = 'current';
  const SESSION_KEY = 'fujita-editor-workspace-session-v1';
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
  const switchWorkspace = async (fromKey, toKey, currentSelection = []) => {
    const database = await openDatabase();
    return new Promise((resolve, reject) => {
      const transaction = database.transaction(STORE, 'readwrite');
      const store = transaction.objectStore(STORE);
      const currentRequest = store.get(KEY);
      const sourceRequest = store.get(fromKey);
      let switched = false;
      let currentReady = false;
      let sourceReady = false;
      const apply = () => {
        if (!currentReady || !sourceReady || currentRequest.result === undefined || sourceRequest.result === undefined) return;
        const source = sourceRequest.result;
        const sourceWorkspace = source.workspace || source;
        store.put({ workspace: currentRequest.result, selection: currentSelection }, toKey);
        store.put(sourceWorkspace, KEY);
        store.put(source.selection || null, 'selection-to-restore');
        store.delete(fromKey);
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
    // sessionStorage survives same-tab navigation/reloads and is cleared when the tab closes.
    // Clear workspace data left by an earlier browser-tab session before restoring anything.
    try {
      if (sessionStorage.getItem(SESSION_KEY) === 'active') return;
      await withStore('readwrite', (store) => {
        store.delete(KEY);
        store.delete('undo');
        store.delete('redo');
        store.delete('selection-to-restore');
      });
      sessionStorage.setItem(SESSION_KEY, 'active');
    } catch (error) {
      // If session storage is unavailable, retain the current workspace rather than
      // clearing it on every navigation in this tab.
      console.warn('[データ読み込み] タブ内セッションを確認できません。', error);
    }
  };
  window.dataWorkspace = {
    key: KEY,
    beginSession,
    rememberDefault: async (workspace) => {
      const database = await openDatabase();
      return new Promise((resolve, reject) => {
        const transaction = database.transaction(STORE, 'readwrite');
        const store = transaction.objectStore(STORE);
        const request = store.get('default');
        request.onsuccess = () => { if (!request.result) store.put(workspace, 'default'); };
        transaction.oncomplete = () => { database.close(); resolve(); };
        transaction.onerror = () => { database.close(); reject(transaction.error); };
        transaction.onabort = () => { database.close(); reject(transaction.error || new Error('IndexedDB transaction aborted')); };
      });
    },
    restoreDefault: () => withStore('readonly', (store) => store.get('default')),
    restore: async () => {
      try {
        const workspace = await withStore('readonly', (store) => store.get(KEY));
        return workspace?.classData && workspace?.instanceData ? workspace : null;
      } catch (error) {
        console.error('[データ読み込み] 作業データを復元できません。', error);
        return null;
      }
    },
    hasUndo: async () => Boolean(await withStore('readonly', (store) => store.get('undo'))),
    hasRedo: async () => Boolean(await withStore('readonly', (store) => store.get('redo'))),
    save: async (workspace, previousWorkspace = null, previousSelection = []) => {
      const database = await openDatabase();
      return new Promise((resolve, reject) => {
        const transaction = database.transaction(STORE, 'readwrite');
        const store = transaction.objectStore(STORE);
        const request = store.get(KEY);
        request.onsuccess = () => {
          const previous = previousWorkspace || request.result;
          if (previous) store.put({ workspace: previous.workspace || previous, selection: previous.selection || previousSelection }, 'undo');
          else store.delete('undo');
          store.delete('redo');
          store.put(workspace, KEY);
        };
        transaction.oncomplete = () => { database.close(); resolve(); };
        transaction.onerror = () => { database.close(); reject(transaction.error); };
        transaction.onabort = () => { database.close(); reject(transaction.error || new Error('IndexedDB transaction aborted')); };
      });
    },
    undoUpload: (selection) => switchWorkspace('undo', 'redo', selection),
    redoUpload: (selection) => switchWorkspace('redo', 'undo', selection),
    takeSelectionToRestore: async () => {
      const selection = await withStore('readonly', (store) => store.get('selection-to-restore'));
      await withStore('readwrite', (store) => store.delete('selection-to-restore'));
      return selection;
    },
    clearRedo: async () => {
      await withStore('readwrite', (store) => store.delete('redo'));
      window.__dataWorkspaceRedoAvailable = false;
      const redoButton = document.getElementById('redo-edit');
      if (redoButton && !redoButton.disabled) {
        redoButton.disabled = true;
        redoButton.title = 'やり直す履歴はありません';
      }
    }
  };
})();
