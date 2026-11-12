// Run page scripts in document order only after an uploaded workspace has been restored.
document.addEventListener('DOMContentLoaded', async () => {
  const scripts = [...document.querySelectorAll('script[data-app-script]')];
  for (const placeholder of scripts) {
    const script = document.createElement('script');
    script.src = placeholder.dataset.appScript;
    if (placeholder.dataset.appType) script.type = placeholder.dataset.appType;
    script.async = false;
    await new Promise((resolve, reject) => {
      script.onload = resolve;
      script.onerror = () => reject(new Error(`スクリプトを読み込めません: ${script.src}`));
      placeholder.replaceWith(script);
    });
    if (script.src.includes('/shared/data-workspace.js')) {
      await window.dataWorkspace.beginSession();
      window.addEventListener('pagehide', () => window.dataWorkspace.releaseSession(), { once: true });
      window.normalizeAppClassTypes?.(window.appData);
      await window.dataWorkspace.rememberDefault(window.appData);
      const workspace = await window.dataWorkspace.restore();
      if (workspace) window.appData = workspace;
      window.normalizeAppClassTypes?.(window.appData);
      window.__workspaceSelectionToRestore = document.body.dataset.mode === 'edit'
        ? await window.dataWorkspace.takeSelectionToRestore()
        : null;
      window.__dataWorkspaceUndoAvailable = await window.dataWorkspace.hasUndo();
      window.__dataWorkspaceRedoAvailable = await window.dataWorkspace.hasRedo();
    }
  }
});
