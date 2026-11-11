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
  const defaults = { heldFontSize: 0.92, chatFontSize: 1, proposalFontSize: 0.9, treeTopFontSize: 0.95, treeMiddleFontSize: 0.95, treeTargetFontSize: 0.9, treeColorIntensity: 1, treeDisclosureSize: 0.85, treeTopColor: '#7dd3fc', treeTopTextColor: '#075985', treeTopBackgroundColor: '#e0f2fe', proposalMode: 'compact', responseMode: 'proposal', promptFlexibility: 5, crossScopeStrategy: 'exhaustive', aiConcurrency: 2, crossScopeTopLimit: 2, crossScopeMiddleLimit: 5, responseOutputTokens: 5000, chunkOutputTokens: 3000, synthesisOutputTokens: 4500, crossScopeOutputTokens: 4000, aiSplitEnabled: true, maxRequestCharacters: 48000, maxUnitsPerBatch: 4, optimizationSplitThreshold: 20, synthesisMaxRounds: 8 };
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
    crossScopeMiddleLimit: [1, 10],
    responseOutputTokens: [500, 128000],
    chunkOutputTokens: [500, 128000],
    synthesisOutputTokens: [500, 128000],
    crossScopeOutputTokens: [500, 128000],
    maxRequestCharacters: [12000, 128000],
    maxUnitsPerBatch: [1, 4],
    optimizationSplitThreshold: [1, 20],
    synthesisMaxRounds: [1, 8]
  };
  const countSettings = new Set(['aiConcurrency', 'crossScopeTopLimit', 'crossScopeMiddleLimit', 'maxRequestCharacters', 'maxUnitsPerBatch', 'optimizationSplitThreshold', 'synthesisMaxRounds']);
  const countUnits = { maxRequestCharacters: '文字', maxUnitsPerBatch: '単位', synthesisMaxRounds: '回' };
  const outputTokenSettings = new Set(['responseOutputTokens', 'chunkOutputTokens', 'synthesisOutputTokens', 'crossScopeOutputTokens']);
  const flexibilityLabels = ['最大限自由', '柔軟', '標準', '厳密', '非常に厳密'];
  const percentageSettings = new Set(['treeColorIntensity']);
  const read = () => {
    let saved = {};
    try { saved = JSON.parse(localStorage.getItem(storageKey) || '{}') || {}; } catch {}
    const preferences = { ...defaults };
    if (typeof saved.aiSplitEnabled === 'boolean') preferences.aiSplitEnabled = saved.aiSplitEnabled;
    for (const [key, [min, max]] of Object.entries(limits)) {
      const value = Number(saved[key]);
      if (Number.isFinite(value) && value >= min && value <= max
        && (Number.isInteger(value) || !Number.isInteger(defaults[key]))) preferences[key] = value;
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
    if (control.type === 'checkbox') control.checked = Boolean(preferences[key]);
    else control.value = String(preferences[key]);
    const output = document.querySelector(`output[for="${control.id}"]`);
    if (output) output.value = key === 'promptFlexibility' ? `${preferences[key]}：${flexibilityLabels[preferences[key] - 1]}`
      : countSettings.has(key) ? `${preferences[key]}${countUnits[key] || '件'}`
      : outputTokenSettings.has(key) ? `${Number(preferences[key]).toLocaleString('ja-JP')} トークン`
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
  window.addEventListener('class-editor-model-capabilities-change', (event) => {
    const suppliedLimit = Number(event.detail?.maxOutputTokens);
    const modelMaximum = Number.isInteger(suppliedLimit) && suppliedLimit > 0
      ? Math.min(128000, suppliedLimit) : 128000;
    let changed = false;
    outputTokenSettings.forEach((key) => {
      limits[key][1] = modelMaximum;
      controls.filter((control) => control.dataset.preference === key).forEach((control) => {
        control.max = String(modelMaximum);
      });
      if (preferences[key] > modelMaximum) {
        preferences[key] = modelMaximum;
        changed = true;
      }
    });
    if (!changed) {
      updateControls();
      return;
    }
    apply(preferences);
    updateControls();
    dispatch(preferences);
    savePreferences();
    status('選択モデルの最大出力に合わせて上限を調整しました。');
  });
  const restoreSaved = () => {
    const hadUnsavedChanges = JSON.stringify(preferences) !== JSON.stringify(savedPreferences);
    preferences = { ...savedPreferences };
    apply(preferences);
    updateControls();
    dispatch(preferences);
    status(hadUnsavedChanges ? '未保存の変更を取り消しました。' : '');
  };
  controls.forEach((control) => control.addEventListener(
    control.tagName === 'SELECT' || control.type === 'number' || control.type === 'checkbox' ? 'change' : 'input', () => {
    const key = control.dataset.preference;
    if (control.type === 'checkbox') preferences[key] = control.checked;
    else if (limits[key]) {
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
    Object.entries(limits).forEach(([key, [min, max]]) => {
      if (Number.isFinite(Number(preferences[key]))) preferences[key] = Math.max(min, Math.min(max, Number(preferences[key])));
    });
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
