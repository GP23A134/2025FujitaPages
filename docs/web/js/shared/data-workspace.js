// Large uploaded datasets live in IndexedDB so they are not limited by Web Storage quotas.
(() => {
  const DATABASE = 'fujita-editor-workspace';
  const STORE = 'workspaces';
  const KEY = 'current';
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
      request.onsuccess = () => { result = request.result; };
      request.onerror = () => reject(request.error);
      transaction.oncomplete = () => { database.close(); resolve(result); };
      transaction.onerror = () => { database.close(); reject(transaction.error); };
      transaction.onabort = () => { database.close(); reject(transaction.error || new Error('IndexedDB transaction aborted')); };
    });
  };
  window.dataWorkspace = {
    key: KEY,
    restore: async () => {
      try {
        const workspace = await withStore('readonly', (store) => store.get(KEY));
        return workspace?.classData && workspace?.instanceData ? workspace : null;
      } catch (error) {
        console.error('[データ読み込み] 作業データを復元できません。', error);
        return null;
      }
    },
    save: (workspace) => withStore('readwrite', (store) => store.put(workspace, KEY))
  };
})();
