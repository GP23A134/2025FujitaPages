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
      const workspace = await window.dataWorkspace.restore();
      if (workspace) window.appData = workspace;
    }
  }
});
