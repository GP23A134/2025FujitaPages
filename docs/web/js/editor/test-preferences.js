(() => {
  // 開発用の調整UIは edit.html?dev=1 の場合だけ表示する。
  const testModeEnabled = new URLSearchParams(window.location.search).get('dev') === '1';
  if (testModeEnabled) {
    const testButton = document.getElementById('open-test-settings');
    if (testButton) testButton.hidden = false;
  } else {
    document.getElementById('open-test-settings')?.remove();
    document.getElementById('test-settings-dialog')?.remove();
  }
  const storageKey = 'classEditorTestPreferences';
  const proposalModeKey = 'classEditorAiProposalView';
  const defaults = { heldFontSize: 0.92, chatFontSize: 1, proposalFontSize: 0.9, treeTopFontSize: 0.95, treeMiddleFontSize: 0.95, treeTargetFontSize: 0.9, treeColorIntensity: 1, treeDisclosureSize: 0.85, treeTopColor: '#7dd3fc', treeTopTextColor: '#075985', treeTopBackgroundColor: '#e0f2fe', proposalMode: 'compact', responseMode: 'proposal', promptFlexibility: 5, crossScopeStrategy: 'exhaustive', aiConcurrency: 2, crossScopeTopLimit: 2, crossScopeMiddleLimit: 5 };
  const limits = {
    heldFontSize: [0.8, 1.3],
    chatFontSize: [0.85, 1.4],
    proposalFontSize: [0.8, 1.3],
    treeTopFontSize: [0.8, 1.4],
    treeMiddleFontSize: [0.8, 1.4],
    treeTargetFontSize: [0.8, 1.4],
    treeColorIntensity: [0, 1],
    treeDisclosureSize: [0.6, 1.4],
    aiConcurrency: [1, 4],
    promptFlexibility: [1, 5],
    crossScopeTopLimit: [1, 5],
    crossScopeMiddleLimit: [1, 10]
  };
  const countSettings = new Set(['aiConcurrency', 'crossScopeTopLimit', 'crossScopeMiddleLimit']);
  const flexibilityLabels = ['最大限自由', '柔軟', '標準', '厳密', '非常に厳密'];
  const percentageSettings = new Set(['treeColorIntensity']);
  const read = () => {
    let saved = {};
    try { saved = JSON.parse(localStorage.getItem(storageKey) || '{}') || {}; } catch {}
    const preferences = { ...defaults };
    for (const [key, [min, max]] of Object.entries(limits)) {
      const value = Number(saved[key]);
      if (Number.isFinite(value) && value >= min && value <= max) preferences[key] = value;
    }
    const legacyTreeLevelFontSize = Number(saved.treeLevelFontSize);
    if (legacyTreeLevelFontSize >= 0.8 && legacyTreeLevelFontSize <= 1.4) {
      if (!(Number(saved.treeTopFontSize) >= 0.8 && Number(saved.treeTopFontSize) <= 1.4)) preferences.treeTopFontSize = legacyTreeLevelFontSize;
      if (!(Number(saved.treeMiddleFontSize) >= 0.8 && Number(saved.treeMiddleFontSize) <= 1.4)) preferences.treeMiddleFontSize = legacyTreeLevelFontSize;
    }
    for (const key of ['treeTopColor', 'treeTopTextColor', 'treeTopBackgroundColor']) {
      if (typeof saved[key] === 'string' && /^#[0-9a-f]{6}$/i.test(saved[key])) preferences[key] = saved[key];
    }
    if (saved.proposalMode === 'legacy' || saved.proposalMode === 'compact') preferences.proposalMode = saved.proposalMode;
    if (saved.responseMode === 'proposal' || saved.responseMode === 'evaluation') preferences.responseMode = saved.responseMode;
    if (saved.crossScopeStrategy === 'exhaustive' || saved.crossScopeStrategy === 'hierarchical') {
      preferences.crossScopeStrategy = saved.crossScopeStrategy;
    } else {
      try {
        const oldStrategy = localStorage.getItem('classEditorAiCrossScopeStrategy');
        if (oldStrategy === 'exhaustive' || oldStrategy === 'hierarchical') preferences.crossScopeStrategy = oldStrategy;
      } catch {}
    }
    try {
      const oldMode = localStorage.getItem(proposalModeKey);
      if (!saved.proposalMode && (oldMode === 'legacy' || oldMode === 'compact')) preferences.proposalMode = oldMode;
    } catch {}
    return preferences;
  };
  const apply = (preferences) => {
    const root = document.documentElement;
    root.style.setProperty('--test-held-font-size', `${preferences.heldFontSize}rem`);
    root.style.setProperty('--test-chat-font-size', `${preferences.chatFontSize}rem`);
    root.style.setProperty('--test-proposal-font-size', `${preferences.proposalFontSize}rem`);
    root.style.setProperty('--test-tree-top-font-size', `${preferences.treeTopFontSize}rem`);
    root.style.setProperty('--test-tree-middle-font-size', `${preferences.treeMiddleFontSize}rem`);
    root.style.setProperty('--test-tree-target-font-size', `${preferences.treeTargetFontSize}rem`);
    window.testTreeColorIntensity = preferences.treeColorIntensity;
    root.style.setProperty('--test-tree-disclosure-size', `${preferences.treeDisclosureSize}rem`);
    root.style.setProperty('--test-tree-top-color', preferences.treeTopColor);
    root.style.setProperty('--test-tree-top-text-color', preferences.treeTopTextColor);
    root.style.setProperty('--test-tree-top-background-color', preferences.treeTopBackgroundColor);
  };
  const dispatch = (preferences) => window.dispatchEvent(new CustomEvent('class-editor-test-preferences-change', { detail: preferences }));
  let preferences = read();
  let savedPreferences = { ...preferences };
  apply(preferences);
  dispatch(preferences);
  const controls = [...document.querySelectorAll('[data-preference]')];
  const updateControls = () => controls.forEach((control) => {
    const key = control.dataset.preference;
    if (!(key in preferences)) return;
    control.value = String(preferences[key]);
    const output = document.querySelector(`output[for="${control.id}"]`);
    if (output) output.value = key === 'promptFlexibility' ? `${preferences[key]}：${flexibilityLabels[preferences[key] - 1]}`
      : countSettings.has(key) ? `${preferences[key]}件`
      : percentageSettings.has(key) ? `${Math.round(preferences[key] * 100)}%` : `${Number(preferences[key]).toFixed(2)}rem`;
  });
  updateControls();
  const dialog = document.getElementById('test-settings-dialog');
  document.getElementById('open-test-settings')?.addEventListener('click', () => dialog?.showModal());
  document.getElementById('close-test-settings')?.addEventListener('click', () => dialog?.close());
  dialog?.addEventListener('click', (event) => {
    if (event.target === dialog) dialog.close();
  });
  const status = (message) => ['test-preferences-status', 'test-preferences-settings-status'].forEach((id) => {
    document.getElementById(id)?.replaceChildren(document.createTextNode(message));
  });
  const savePreferences = () => {
    try {
      localStorage.setItem(storageKey, JSON.stringify(preferences));
      localStorage.setItem(proposalModeKey, preferences.proposalMode);
      localStorage.setItem('classEditorAiCrossScopeStrategy', preferences.crossScopeStrategy);
      savedPreferences = { ...preferences };
      return true;
    } catch {
      status('設定を保存できませんでした。');
      return false;
    }
  };
  const restoreSaved = () => {
    const hadUnsavedChanges = JSON.stringify(preferences) !== JSON.stringify(savedPreferences);
    preferences = { ...savedPreferences };
    apply(preferences);
    updateControls();
    dispatch(preferences);
    status(hadUnsavedChanges ? '未保存の変更を取り消しました。' : '');
  };
  controls.forEach((control) => control.addEventListener(
    control.tagName === 'SELECT' || control.type === 'number' ? 'change' : 'input', () => {
    const key = control.dataset.preference;
    if (limits[key]) {
      const [min, max] = limits[key];
      const value = Number(control.value);
      preferences[key] = Math.max(min, Math.min(max, Number.isFinite(value) ? value : min));
    } else preferences[key] = control.value;
    apply(preferences);
    updateControls();
    dispatch(preferences);
    if (savePreferences()) status('変更を反映し、自動保存しました。');
  }));
  document.getElementById('test-preferences-reset')?.addEventListener('click', () => {
    preferences = { ...defaults };
    apply(preferences);
    updateControls();
    dispatch(preferences);
    if (savePreferences()) status('初期値に戻して保存しました。');
  });
  document.getElementById('save-test-settings')?.addEventListener('click', () => {
    if (savePreferences()) {
      dispatch(preferences);
      status('設定を保存しました。');
      dialog?.close();
    }
  });
  dialog?.addEventListener('close', restoreSaved);
  window.addEventListener('pageshow', () => {
    const latest = read();
    preferences = { ...latest };
    savedPreferences = { ...latest };
    apply(preferences);
    updateControls();
    dispatch(preferences);
  });
})();
