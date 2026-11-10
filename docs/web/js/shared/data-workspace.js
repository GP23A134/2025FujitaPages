// データ読み込み画面と編集画面で作業データの受け渡し形式を共通化する。
(() => {
  const KEY = 'fujita.editor.workspace.v1';
  window.dataWorkspace = {
    key: KEY,
    restore() {
      try {
        const saved = sessionStorage.getItem(KEY);
        if (!saved) return null;
        const workspace = JSON.parse(saved);
        if (!workspace?.classData || !workspace?.instanceData) {
          sessionStorage.removeItem(KEY);
          return null;
        }
        return workspace;
      } catch (error) {
        console.error('[データ読み込み] 作業データを復元できません。', error);
        sessionStorage.removeItem(KEY);
        return null;
      }
    },
    save(workspace) {
      sessionStorage.setItem(KEY, JSON.stringify(workspace));
    }
  };
  const workspace = window.dataWorkspace.restore();
  if (workspace) window.appData = workspace;
})();
