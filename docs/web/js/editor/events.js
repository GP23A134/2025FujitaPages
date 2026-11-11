// 編集モジュールを読み込んだ後に、保存・Undo/Redo・UIイベントを登録して初回描画を行う。
// ============================================================
// JSON出力と保存
// ============================================================
const saveValidationBaseline = {
  classes: classes.map((item) => ({ id: item.id, type: classKind(item), label: item.label })),
  relations: data.classData.relations.map(({ child, parent }) => ({ child, parent }))
};
const saveValidationDialog = document.getElementById('edit-validation-dialog');
const collectSaveValidationIssues = (graph) => {
  const issues = [];
  const addIssue = (code, severity, ids, detail, message) => {
    const classIds = [...new Set(ids.filter(Boolean))].sort();
    issues.push({
      code,
      severity,
      classIds,
      key: `${code}:${JSON.stringify(classIds)}:${detail || ''}`,
      message
    });
  };
  const classesById = new Map();
  graph.classes.forEach((item) => {
    if (!item.id) {
      addIssue('empty-id', 'error', [], '', 'IDが空のクラスがあります。');
      return;
    }
    const entries = classesById.get(item.id) || [];
    entries.push(item);
    classesById.set(item.id, entries);
  });
  classesById.forEach((items, id) => {
    if (items.length > 1) addIssue('duplicate-id', 'error', [id], String(items.length), `ID「${id}」のクラスが複数あります。`);
  });
  const byId = new Map(graph.classes.filter((item) => item.id).map((item) => [item.id, item]));
  const parentByChild = new Map(graph.relations.map(({ child, parent }) => [child, parent]));
  const labelsByType = new Map();
  graph.classes.forEach((item) => {
    const label = String(item.label ?? '').trim();
    if (!label) addIssue('empty-label', 'warning', [item.id], '', `「${item.id || 'IDなし'}」のクラス名が空です。`);
    if (!label) return;
    const duplicateScope = item.type === 'class' ? (parentByChild.get(item.id) || '') : '';
    const key = `${item.type}\u0000${duplicateScope}\u0000${label.toLocaleLowerCase('ja-JP')}`;
    const entries = labelsByType.get(key) || [];
    entries.push(item);
    labelsByType.set(key, entries);
  });
  labelsByType.forEach((items) => {
    if (items.length < 2) return;
    const ids = items.map((item) => item.id);
    addIssue('duplicate-label', 'warning', ids, `${items[0].type}\u0000${parentByChild.get(items[0].id) || ''}`,
      `同じ種類のクラス名「${items[0].label}」が重複しています（${ids.join('、')}）。`);
  });

  const seenRelations = new Set();
  const parentsByChild = new Map();
  graph.relations.forEach(({ child, parent }) => {
    const relationKey = `${child}\u0000${parent}`;
    if (seenRelations.has(relationKey)) addIssue('duplicate-relation', 'warning', [child, parent], '', `「${child}」から「${parent}」への親子関係が重複しています。`);
    seenRelations.add(relationKey);
    const childClass = byId.get(child);
    const parentClass = byId.get(parent);
    if (!childClass || !parentClass) {
      addIssue('missing-reference', 'error', [child, parent], `${child}\u0000${parent}`, `親子関係「${child} → ${parent}」に存在しないクラスIDがあります。`);
      return;
    }
    const parents = parentsByChild.get(child) || [];
    parents.push(parent);
    parentsByChild.set(child, parents);
    if (!['middle', 'class'].includes(childClass.type) || !['top', 'middle'].includes(parentClass.type)) {
      addIssue('invalid-type-edge', 'error', [child, parent], `${childClass.type}\u0000${parentClass.type}`,
        `「${childClass.label}」から「${parentClass.label}」への階層種別が不正です。`);
    }
    if (parentClass.label === '未分類' && childClass.type === 'middle') {
      addIssue('unclassified-middle', 'error', [child, parent], '', '中間クラスを「未分類」の下に置くことはできません。');
    }
  });
  parentsByChild.forEach((parents, child) => {
    if (new Set(parents).size > 1) addIssue('multiple-parents', 'error', [child, ...parents], '', `「${child}」が複数の親クラスを持っています。`);
  });
  graph.classes.filter((item) => ['middle', 'class'].includes(item.type)).forEach((item) => {
    if (!parentsByChild.has(item.id)) addIssue('missing-parent', 'error', [item.id], item.type, `「${item.label || item.id}」に親クラスがありません。`);
  });
  const singleParent = new Map([...parentsByChild]
    .filter(([, parents]) => new Set(parents).size === 1)
    .map(([child, parents]) => [child, parents[0]]));
  const reportedCycles = new Set();
  graph.classes.forEach((item) => {
    const path = [];
    const pathIndex = new Map();
    let current = item.id;
    while (singleParent.has(current)) {
      if (pathIndex.has(current)) {
        const cycleIds = path.slice(pathIndex.get(current)).sort();
        const cycleKey = cycleIds.join('\u0000');
        if (!reportedCycles.has(cycleKey)) {
          reportedCycles.add(cycleKey);
          addIssue('cycle', 'error', cycleIds, '', `親子関係が循環しています（${cycleIds.join('、')}）。`);
        }
        break;
      }
      pathIndex.set(current, path.length);
      path.push(current);
      current = singleParent.get(current);
    }
  });
  return issues;
};
const showSaveValidation = (issues) => {
  const baselineKeys = new Set(collectSaveValidationIssues(saveValidationBaseline).map((item) => item.key));
  const currentIssues = issues.map((issue) => baselineKeys.has(issue.key)
    ? { ...issue, severity: 'warning', preExisting: true }
    : issue);
  const errors = currentIssues.filter((issue) => issue.severity === 'error');
  const warnings = currentIssues.filter((issue) => issue.severity === 'warning');
  const summary = document.getElementById('edit-validation-summary');
  summary.textContent = errors.length
    ? `編集で新たに発生したエラーが${errors.length}件あります。修正してから出力してください。警告 ${warnings.length}件。`
    : `出力前に確認したい警告が${warnings.length}件あります。元データから存在する問題も警告として表示しています。`;
  const list = document.getElementById('edit-validation-issues');
  const rows = currentIssues.map((issue) => {
    const row = document.createElement('li');
    if (issue.severity === 'warning') row.classList.add('is-warning');
    const text = document.createElement('div');
    const severity = document.createElement('span');
    severity.className = 'edit-validation-issue-severity';
    severity.textContent = issue.preExisting ? '元データから存在する警告' : issue.severity === 'error' ? '要修正' : '警告';
    const message = document.createElement('span');
    message.textContent = issue.message;
    text.append(severity, message);
    row.append(text);
    if (issue.classIds.length) {
      const select = document.createElement('button');
      select.type = 'button';
      select.className = 'edit-validation-issue-select';
      select.textContent = '該当クラスを選択';
      select.addEventListener('click', () => {
        window.classEditorAI.setSelectedIds(issue.classIds);
        saveValidationDialog.close();
      });
      row.append(select);
    }
    return row;
  });
  list.replaceChildren(...rows);
  const exportButton = document.getElementById('edit-validation-export');
  exportButton.hidden = errors.length > 0;
  saveValidationDialog.showModal();
};
function downloadJson(name, value) {
  const blob = new Blob([`${JSON.stringify(value, null, 2)}\n`], { type: 'application/json;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a'); link.href = url; link.download = name; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function classUpdateFilename() {
  const now = new Date();
  const pad = (value, length = 2) => String(value).padStart(length, '0');
  const date = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}`;
  const time = `${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}-${pad(now.getMilliseconds(), 3)}`;
  return `class-update-${date}-${time}.json`;
}
function saveEditChanges(skipValidation = false) {
  if (!skipValidation) {
    const currentGraph = {
      classes: classes.map((item) => ({ id: item.id, type: classKind(item), label: item.label })),
      relations: data.classData.relations.map(({ child, parent }) => ({ child, parent }))
    };
    const issues = collectSaveValidationIssues(currentGraph);
    if (issues.length) {
      showSaveValidation(issues);
      return;
    }
  }
  const exportData = {
    classes: classes.map((item) => ({ type: classKind(item), id: item.id, label: item.label })),
    relations: data.classData.relations.map(({ child, parent }) => ({ child, parent }))
  };
  const filename = classUpdateFilename();
  downloadJson(filename, exportData);
  logEditAction(`${filename}をダウンロードしました。data/input/に配置してClassDataUpdateを実行してください。`);
  hasUnsavedChanges = false;
}
document.getElementById('edit-validation-close').addEventListener('click', () => saveValidationDialog.close());
document.getElementById('edit-validation-cancel').addEventListener('click', () => saveValidationDialog.close());
document.getElementById('edit-validation-export').addEventListener('click', () => {
  saveValidationDialog.close();
  saveEditChanges(true);
});
// ============================================================
// 編集操作のイベント登録
// ============================================================
// 保存と編集履歴
document.getElementById('save-edit-changes').addEventListener('click', () => saveEditChanges());

const scrollToTopButton = document.getElementById('scroll-to-top');
const treePaneForScrollButton = document.querySelector('#edit-tree-panel .edit-tree-pane');
let scrollToTopUpdateFrame = 0;
const updateScrollToTopPosition = () => {
  if (!treePaneForScrollButton) return;
  const paneRight = treePaneForScrollButton.getBoundingClientRect().right;
  scrollToTopButton.style.right = `${Math.max(0, window.innerWidth - paneRight)}px`;
};
const updateScrollToTopButton = () => {
  scrollToTopUpdateFrame = 0;
  scrollToTopButton.hidden = window.scrollY < 240;
};
window.addEventListener('scroll', () => {
  if (scrollToTopUpdateFrame) return;
  scrollToTopUpdateFrame = window.requestAnimationFrame(updateScrollToTopButton);
}, { passive: true });
window.addEventListener('resize', updateScrollToTopPosition);
if (treePaneForScrollButton && 'ResizeObserver' in window) {
  new ResizeObserver(updateScrollToTopPosition).observe(treePaneForScrollButton);
}
updateScrollToTopPosition();
scrollToTopButton.addEventListener('click', () => {
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  window.scrollTo({ top: 0, behavior: reducedMotion ? 'auto' : 'smooth' });
});

// 保持中パネルの表示タブ
let aiRequestRunning = false;
const browseLink = document.getElementById('browse-link');
const setAiRequestRunning = (running) => {
  aiRequestRunning = running;
  document.querySelectorAll('.held-panel-mode-tab').forEach((tab) => {
    tab.disabled = running && tab.dataset.heldPanelView !== 'chat';
  });
  if (running) {
    if (!browseLink.dataset.originalHref) browseLink.dataset.originalHref = browseLink.getAttribute('href') || '';
    browseLink.removeAttribute('href');
    browseLink.setAttribute('aria-disabled', 'true');
  } else {
    if (browseLink.dataset.originalHref) browseLink.setAttribute('href', browseLink.dataset.originalHref);
    browseLink.removeAttribute('aria-disabled');
  }
};
window.addEventListener('ai-request-state-change', (event) => {
  setAiRequestRunning(Boolean(event.detail?.running));
});
document.querySelectorAll('.held-panel-mode-tab').forEach((tab) => tab.addEventListener('click', () => {
  if (aiRequestRunning && tab.dataset.heldPanelView !== 'chat') return;
  if (!heldPanelClosed && heldPanelView === tab.dataset.heldPanelView) {
    heldPanelClosed = true;
  } else {
    heldPanelView = tab.dataset.heldPanelView;
    heldPanelClosed = false;
    heldPanelCollapsed = false;
  }
  renderInstances();
}));
document.querySelectorAll('.held-kind-tab').forEach((tab) => tab.addEventListener('click', () => {
  heldKindView = tab.dataset.heldKind;
  renderInstances();
}));
document.getElementById('toggle-held-panel-collapse').addEventListener('click', () => {
  heldPanelCollapsed = !heldPanelCollapsed;
  renderInstances();
});
document.getElementById('close-held-panel').addEventListener('click', () => {
  heldPanelClosed = true;
  renderInstances();
});
const treeFilter = document.querySelector('.tree-filter');
document.getElementById('close-tree-filter').addEventListener('click', (event) => {
  event.preventDefault();
  event.stopPropagation();
  treeFilter.hidden = true;
  syncPinnedHeldPanelBounds();
  renderInstances();
});
document.getElementById('toggle-tree-filter-open').addEventListener('click', () => {
  treeFilter.hidden = false;
  syncPinnedHeldPanelBounds();
  renderInstances();
});
const heldPanel = document.getElementById('held-panel');
const heldPanelResizeHandle = document.getElementById('held-panel-resize');
const editTreeLayout = document.querySelector('#edit-tree-panel .edit-tree-layout');
if (heldPanelResizeHandle && heldPanel && editTreeLayout) {
  const minWidth = 240;
  const maxWidth = () => Math.max(minWidth, Math.min(760, window.innerWidth * 0.55, editTreeLayout.clientWidth * 0.55));
  const currentWidth = () => heldPanel.getBoundingClientRect().width || editTreeLayout.clientWidth * 0.3;
  const updateResizeValue = () => {
    heldPanelResizeHandle.setAttribute('aria-valuemax', String(Math.round(maxWidth())));
    const width = Math.round(currentWidth());
    heldPanelResizeHandle.setAttribute('aria-valuenow', String(width));
    heldPanelResizeHandle.setAttribute('aria-valuetext', `${width}ピクセル`);
  };
  const setPanelWidth = (width) => {
    const constrained = Math.round(Math.max(minWidth, Math.min(maxWidth(), width)));
    const ratio = editTreeLayout.clientWidth ? (constrained / editTreeLayout.clientWidth) * 100 : 30;
    editTreeLayout.style.setProperty('--held-panel-width', `${ratio.toFixed(2)}%`);
    updateResizeValue();
  };
  const isResizable = () => !heldPanel.hidden && !heldPanelCollapsed && window.innerWidth > 760;
  heldPanelResizeHandle.addEventListener('pointerdown', (event) => {
    if (!isResizable()) return;
    event.preventDefault();
    heldPanelResizeHandle.setPointerCapture(event.pointerId);
  });
  heldPanelResizeHandle.addEventListener('pointermove', (event) => {
    if (!heldPanelResizeHandle.hasPointerCapture(event.pointerId) || !isResizable()) return;
    setPanelWidth(heldPanel.getBoundingClientRect().right - event.clientX);
  });
  const releaseResizePointer = (event) => {
    if (heldPanelResizeHandle.hasPointerCapture(event.pointerId)) heldPanelResizeHandle.releasePointerCapture(event.pointerId);
  };
  heldPanelResizeHandle.addEventListener('pointerup', releaseResizePointer);
  heldPanelResizeHandle.addEventListener('pointercancel', releaseResizePointer);
  heldPanelResizeHandle.addEventListener('keydown', (event) => {
    if (!isResizable()) return;
    if (event.key === 'ArrowLeft') { event.preventDefault(); setPanelWidth(currentWidth() + 16); }
    else if (event.key === 'ArrowRight') { event.preventDefault(); setPanelWidth(currentWidth() - 16); }
    else if (event.key === 'Home') { event.preventDefault(); setPanelWidth(minWidth); }
    else if (event.key === 'End') { event.preventDefault(); setPanelWidth(maxWidth()); }
  });
  window.addEventListener('resize', () => {
    if (window.innerWidth > 760 && currentWidth() > maxWidth()) setPanelWidth(maxWidth());
    else updateResizeValue();
  });
  updateResizeValue();
}
if (treeFilter && heldPanel && 'ResizeObserver' in window) {
  const syncCollapsedHeldPanelHeight = () => {
    const collapsedHeight = heldPanel.querySelector('.held-panel-header')?.getBoundingClientRect().height;
    heldPanel.style.setProperty('--held-collapsed-height', `${collapsedHeight || 0}px`);
    syncPinnedHeldPanelBounds();
  };
  new ResizeObserver(syncCollapsedHeldPanelHeight).observe(treeFilter);
  const heldHeader = heldPanel.querySelector('.held-panel-header');
  if (heldHeader) new ResizeObserver(syncCollapsedHeldPanelHeight).observe(heldHeader);
  syncCollapsedHeldPanelHeight();
  const layout = document.querySelector('#edit-tree-panel .edit-tree-layout');
  if (layout) new ResizeObserver(syncPinnedHeldPanelBounds).observe(layout);
  const taskbar = document.querySelector('.edit-taskbar');
  if (taskbar) new ResizeObserver(syncPinnedHeldPanelBounds).observe(taskbar);
  new ResizeObserver(syncPinnedHeldPanelBounds).observe(heldPanel);
}
let heldPanelBoundsDebounceTimer = 0;
const scheduleHeldPanelBoundsUpdate = () => {
  syncPinnedHeldPanelBounds();
  window.clearTimeout(heldPanelBoundsDebounceTimer);
  heldPanelBoundsDebounceTimer = window.setTimeout(syncPinnedHeldPanelBounds, 150);
};
window.addEventListener('resize', scheduleHeldPanelBoundsUpdate);
window.addEventListener('scroll', scheduleHeldPanelBoundsUpdate, { passive: true });
window.visualViewport?.addEventListener('resize', scheduleHeldPanelBoundsUpdate);
window.visualViewport?.addEventListener('scroll', scheduleHeldPanelBoundsUpdate, { passive: true });
if (heldPanel) new MutationObserver(syncPinnedHeldPanelBounds).observe(heldPanel, { attributes: true, attributeFilter: ['class', 'hidden'] });
syncPinnedHeldPanelBounds();
treeFilter?.addEventListener('toggle', () => {
  syncPinnedHeldPanelBounds();
});
document.getElementById('undo-edit').addEventListener('click', undoLastEdit);
document.getElementById('redo-edit').addEventListener('click', redoLastEdit);
document.addEventListener('keydown', (event) => {
  if (!(event.ctrlKey || event.metaKey) || event.altKey) return;
  const editingText = event.target instanceof Element
    && event.target.closest('input, textarea, select, [contenteditable="true"]');
  if (editingText) return;
  const key = event.key.toLocaleLowerCase();
  if (key === 'z' && event.shiftKey || key === 'y') {
    event.preventDefault();
    redoLastEdit();
  } else if (key === 'z') {
    event.preventDefault();
    undoLastEdit();
  }
});

document.querySelectorAll('.held-destination-tab').forEach((tab) => tab.addEventListener('click', () => {
  heldDestinationKind = tab.dataset.destinationKind;
  heldDestinationId = '';
  document.getElementById('held-destination-search').value = '';
  renderInstances();
}));
document.getElementById('held-destination-search').addEventListener('input', renderInstances);
document.getElementById('apply-held-destination').addEventListener('click', () => {
  if (!heldDestinationId) return;
  if (heldDestinationKind === 'middle') moveHeldToMiddle(heldDestinationId);
  else moveHeldClassesToTop(heldDestinationId);
});
document.getElementById('clear-held').addEventListener('click', () => {
  const selectionBefore = snapshotEditState();
  if (heldKindView === 'target') {
    heldInstances.clear();
  } else if (heldKindView === 'middle') {
    [...heldMiddleClasses.keys()].forEach((id) => applyTreeSubtreeSelection([id], false));
  } else {
    [...heldTopClasses.keys()].forEach((id) => applyTreeSubtreeSelection([id], false));
  }
  syncTreeSelectionAppearance();
  syncTargetButtonAvailability();
  renderInstances();
  recordEditHistory(selectionBefore, '', '保持中の選択解除');
  const kindLabel = heldKindView === 'target' ? '対象クラス' : heldKindView === 'middle' ? '中間クラス' : '上位クラス';
  logEditAction(`保持中の${kindLabel}を解除しました。`);
});

function updateVisibleTreeSelection(select) {
  const selectionBefore = snapshotEditState();
  const roots = [
    ...middleCheckboxById.keys(),
    ...topCheckboxById.keys(),
    ...targetButtonById.keys()
  ];
  applyTreeSubtreeSelection(roots, select);
  middleCheckboxById.forEach((checkbox, id) => {
    checkbox.checked = heldMiddleClasses.has(id);
  });
  topCheckboxById.forEach((checkbox, id) => {
    checkbox.checked = heldTopClasses.has(id);
  });
  targetButtonById.forEach((button, id) => {
    button.classList.toggle('is-selected', heldInstances.has(id));
  });
  if (select) heldKindView = 'target';
  syncTargetButtonAvailability();
  renderInstances();
  recordEditHistory(selectionBefore, '', select ? '表示範囲を選択' : '表示範囲の選択解除');
}
document.getElementById('select-visible-tree').addEventListener('click', () => updateVisibleTreeSelection(true));
document.getElementById('clear-visible-tree-selection').addEventListener('click', () => updateVisibleTreeSelection(false));
function updateFilteredTargetSelection(select) {
  const selectionBefore = snapshotEditState();
  (currentFilteredTargetIds || []).forEach((id) => {
    const item = classById.get(id);
    if (!item) return;
    if (select) {
      heldInstances.set(id, item);
      heldKindView = 'target';
      targetButtonById.get(id)?.classList.add('is-selected');
    } else {
      heldInstances.delete(id);
      targetButtonById.get(id)?.classList.remove('is-selected');
    }
  });
  syncTargetButtonAvailability();
  renderInstances();
  recordEditHistory(selectionBefore, '', select ? '検索結果を選択' : '検索結果の選択解除');
}
document.getElementById('select-filtered-targets').addEventListener('click', () => updateFilteredTargetSelection(true));
document.getElementById('clear-filtered-targets-selection').addEventListener('click', () => updateFilteredTargetSelection(false));

// ツリーの検索・件数フィルター
document.getElementById('tree-filter-type').addEventListener('change', () => {
  document.getElementById('tree-filter-query').placeholder = '名前・IDで検索';
  renderTreeFilterKeywords();
  renderTree();
});
document.getElementById('tree-filter-query').addEventListener('input', () => {
  renderTreeFilterKeywords();
  window.clearTimeout(treeSearchDebounceTimer);
  treeSearchDebounceTimer = window.setTimeout(scheduleTreeRender, 140);
});
function setTreeFilterMethod(method) {
  if (method === 'count') treeCountFilterEnabled = true;
  document.querySelector('.tree-filter-search-controls').hidden = method !== 'keyword';
  document.querySelector('.tree-filter-count-settings').hidden = method !== 'count';
  document.querySelectorAll('[data-tree-filter-method]').forEach((button) => {
    const active = button.dataset.treeFilterMethod === method;
    button.classList.toggle('is-active', active);
    button.setAttribute('aria-pressed', active ? 'true' : 'false');
  });
  renderTree();
}
document.querySelectorAll('[data-tree-filter-method]').forEach((button) => {
  button.addEventListener('click', () => setTreeFilterMethod(button.dataset.treeFilterMethod));
});
const treeRangeSliderGroup = document.querySelector('.tree-filter-range-sliders');
let treeRangeBubbleTimer = 0;
function updateTreeRangeBubbles() {
  if (!treeRangeSliderGroup) return;
  const maxIndex = Math.max(1, treeExactCountValues.length - 1);
  const minSlider = document.getElementById('tree-filter-count-min');
  const maxSlider = document.getElementById('tree-filter-count-max');
  const startPercent = Math.min(Number(minSlider.value), Number(maxSlider.value)) / maxIndex * 100;
  const endPercent = Math.max(Number(minSlider.value), Number(maxSlider.value)) / maxIndex * 100;
  treeRangeSliderGroup.style.setProperty('--range-start', `${startPercent}%`);
  treeRangeSliderGroup.style.setProperty('--range-end', `${endPercent}%`);
  [
    { input: minSlider, bubble: document.getElementById('tree-filter-count-min-bubble') },
    { input: maxSlider, bubble: document.getElementById('tree-filter-count-max-bubble') }
  ].forEach(({ input, bubble }) => {
    const percent = (Number(input.value) / maxIndex) * 100;
    bubble.style.left = `clamp(1rem, ${percent}%, calc(100% - 1rem))`;
    bubble.textContent = `${treeExactCountValues[Number(input.value)] ?? 0}件`;
  });
}
function showTreeRangeBubble(input) {
  window.clearTimeout(treeRangeBubbleTimer);
  treeRangeSliderGroup.dataset.activeThumb = input.id.endsWith('-min') ? 'min' : 'max';
}
function hideTreeRangeBubbleSoon() {
  window.clearTimeout(treeRangeBubbleTimer);
  treeRangeBubbleTimer = window.setTimeout(() => delete treeRangeSliderGroup.dataset.activeThumb, 700);
}
['tree-filter-count-min', 'tree-filter-count-max'].forEach((id) => {
  const input = document.getElementById(id);
  input.addEventListener('pointerdown', () => showTreeRangeBubble(input));
  input.addEventListener('pointerup', hideTreeRangeBubbleSoon);
  input.addEventListener('focus', () => showTreeRangeBubble(input));
  input.addEventListener('blur', hideTreeRangeBubbleSoon);
  input.addEventListener('keydown', () => showTreeRangeBubble(input));
  input.addEventListener('keyup', hideTreeRangeBubbleSoon);
});
document.getElementById('tree-filter-count-min').addEventListener('input', (event) => {
  const maxInput = document.getElementById('tree-filter-count-max');
  if (Number(event.target.value) > Number(maxInput.value)) maxInput.value = event.target.value;
  treeCountRangeTouched = true;
  showTreeRangeBubble(event.target);
  scheduleTreeRender();
});
document.getElementById('tree-filter-count-max').addEventListener('input', (event) => {
  const minInput = document.getElementById('tree-filter-count-min');
  if (Number(event.target.value) < Number(minInput.value)) minInput.value = event.target.value;
  treeCountRangeTouched = true;
  showTreeRangeBubble(event.target);
  scheduleTreeRender();
});
const treeExactSlider = document.getElementById('tree-filter-count-exact-input');
const treeExactSliderWrap = document.querySelector('.tree-filter-exact-slider-wrap');
let treeExactBubbleTimer = 0;
function showTreeExactBubble() {
  window.clearTimeout(treeExactBubbleTimer);
  treeExactSliderWrap.classList.add('is-adjusting');
}
function hideTreeExactBubbleSoon() {
  window.clearTimeout(treeExactBubbleTimer);
  treeExactBubbleTimer = window.setTimeout(() => treeExactSliderWrap.classList.remove('is-adjusting'), 700);
}
treeExactSlider.addEventListener('pointerdown', showTreeExactBubble);
treeExactSlider.addEventListener('pointerup', hideTreeExactBubbleSoon);
treeExactSlider.addEventListener('focus', showTreeExactBubble);
treeExactSlider.addEventListener('blur', hideTreeExactBubbleSoon);
treeExactSlider.addEventListener('keydown', showTreeExactBubble);
treeExactSlider.addEventListener('keyup', hideTreeExactBubbleSoon);
treeExactSlider.addEventListener('input', (event) => {
  treeExactSelectedCount = treeExactCountValues[Number(event.target.value)] ?? treeExactCountValues[0];
  document.getElementById('tree-filter-count-exact-value').textContent = `${treeExactSelectedCount}件`;
  document.getElementById('tree-filter-count-exact-bubble').textContent = `${treeExactSelectedCount}件`;
  showTreeExactBubble();
  scheduleTreeRender();
});
document.getElementById('tree-filter-count-mode').addEventListener('change', (event) => {
  const exactMode = event.target.value === 'exact';
  document.getElementById('tree-filter-count-range').hidden = exactMode;
  document.getElementById('tree-filter-count-exact').hidden = !exactMode;
  renderTree();
});

// ツリー検索はEnterごとに語句を確定し、すべてに一致するクラスを表示する。
function renderTreeFilterKeywords() {
  const container = document.getElementById('tree-filter-keyword-chips');
  if (!container) return;
  const query = treeFilterQueryInput?.value.trim() || '';
  const terms = [...treeFilterKeywords, ...(query ? [query] : [])];
  const kind = document.getElementById('tree-filter-type')?.value === 'instance' ? 'instance' : 'class';
  const countMode = document.getElementById('tree-filter-count-mode')?.value || 'range';
  const countActive = treeCountFilterEnabled && (countMode === 'exact'
    ? treeExactSelectedCount !== null
    : treeCountRangeTouched);
  const countChipLabel = countActive
    ? countMode === 'exact'
      ? `インスタンス件数：${treeExactSelectedCount}件`
      : (() => {
        const minInput = document.getElementById('tree-filter-count-min');
        const maxInput = document.getElementById('tree-filter-count-max');
        const minIndex = Math.min(Number(minInput.value), Number(maxInput.value));
        const maxIndex = Math.max(Number(minInput.value), Number(maxInput.value));
        return `インスタンス件数：${treeExactCountValues[minIndex] ?? 0}〜${treeExactCountValues[maxIndex] ?? treeExactCountValues.at(-1)}件`;
      })()
    : '';
  const hasConditions = terms.length > 0 || countActive;
  container.hidden = !hasConditions;
  const status = container.closest('.tree-filter-status');
  if (status) status.hidden = !hasConditions;
  const chips = terms.map((term, index) => {
    const chip = document.createElement('button');
    chip.type = 'button';
    chip.className = 'tree-filter-active-chip';
    chip.dataset.searchKind = kind;
    chip.textContent = `${kind === 'instance' ? 'インスタンス' : 'クラス'}：${term} ×`;
    chip.setAttribute('aria-label', `${kind === 'instance' ? 'インスタンス' : 'クラス'}検索「${term}」を解除`);
    chip.addEventListener('click', () => {
      if (index < treeFilterKeywords.length) treeFilterKeywords.splice(index, 1);
      else treeFilterQueryInput.value = '';
      renderTreeFilterKeywords();
      renderTree();
    });
    return chip;
  });
  const children = hasConditions ? [document.createTextNode('絞り込み中：'), ...chips] : [];
  if (countActive) {
    const chip = document.createElement('button');
    chip.type = 'button';
    chip.className = 'tree-filter-active-chip tree-filter-active-chip-count';
    chip.textContent = `${countChipLabel} ×`;
    chip.setAttribute('aria-label', 'インスタンス件数の条件を解除');
    chip.addEventListener('click', () => {
      treeCountFilterEnabled = false;
      treeCountRangeTouched = false;
      treeExactSelectedCount = null;
      document.getElementById('tree-filter-count-mode').value = 'range';
      document.getElementById('tree-filter-count-range').hidden = false;
      document.getElementById('tree-filter-count-exact').hidden = true;
      renderTree();
    });
    children.push(chip);
  }
  container.replaceChildren(...children);
}
const treeFilterQueryInput = document.getElementById('tree-filter-query');
treeFilterQueryInput.addEventListener('keydown', (event) => {
  if (event.key !== 'Enter') return;
  event.preventDefault();
  const term = treeFilterQueryInput.value.trim();
  if (term && !treeFilterKeywords.some((existing) => existing.toLocaleLowerCase() === term.toLocaleLowerCase())) {
    treeFilterKeywords.push(term);
  }
  window.clearTimeout(treeSearchDebounceTimer);
  treeFilterQueryInput.value = '';
  renderTreeFilterKeywords();
  renderTree();
});
document.getElementById('clear-tree-filters')?.addEventListener('click', () => {
  treeFilterKeywords.splice(0);
  treeFilterQueryInput.value = '';
  treeCountFilterEnabled = false;
  treeCountRangeTouched = false;
  treeExactSelectedCount = null;
  document.getElementById('tree-filter-count-mode').value = 'range';
  document.getElementById('tree-filter-count-range').hidden = false;
  document.getElementById('tree-filter-count-exact').hidden = true;
  setTreeFilterMethod('keyword');
});

// 保存と初期描画

render();

// AI補助にはクラス分類のメタデータだけを渡し、個別インスタンスは公開しない。
function buildAiTargetContext(all, hierarchyClasses) {
  const descendantTargetClassCounts = {};
  hierarchyClasses.forEach((item) => {
    descendantTargetClassCounts[item.id] = all.counts[item.id] || 0;
  });
  return { descendantTargetClassCounts };
}

// AIモジュールへ選択範囲とクラス構造だけを渡す画面内API。個別インスタンスは公開しない。
window.classEditorAI = {
  get selectedIds() { return [...heldInstances.keys(), ...heldMiddleClasses.keys(), ...heldTopClasses.keys()]; },
  get selectionSnapshot() { return { instances: [...heldInstances.keys()], middleClasses: [...heldMiddleClasses.keys()], topClasses: [...heldTopClasses.keys()] }; },
  setSelectedIds(ids) {
    const selectionBefore = snapshotEditState();
    heldInstances.clear(); heldMiddleClasses.clear(); heldTopClasses.clear();
    (Array.isArray(ids) ? ids : []).forEach((id) => {
      const item = classById.get(id);
      if (!item) return;
      const type = classKind(item);
      if (type === 'top') heldTopClasses.set(id, item);
      else if (type === 'middle') heldMiddleClasses.set(id, item);
      else heldInstances.set(id, item);
    });
    recordEditHistory(selectionBefore, '', 'AI範囲の選択変更');
    render();
  },
  selectAll() {
    const selectionBefore = snapshotEditState();
    classes.forEach((item) => {
    const type = classKind(item);
    if (type === 'top') heldTopClasses.set(item.id, item);
    else if (type === 'middle') heldMiddleClasses.set(item.id, item);
    else heldInstances.set(item.id, item);
    });
    recordEditHistory(selectionBefore, '', 'すべて選択');
    render();
  },
  clearSelection() {
    const selectionBefore = snapshotEditState();
    heldInstances.clear(); heldMiddleClasses.clear(); heldTopClasses.clear();
    recordEditHistory(selectionBefore, '', '選択解除');
    render();
  },
  getState() {
    const children = buildChildrenMap();
    const aggregateCount = createTargetCounter(children);
    return {
      classes: classes.map((item) => ({ id: item.id, type: classKind(item), label: item.label })),
      relations: data.classData.relations.map(({ child, parent }) => ({ child, parent })),
      counts: Object.fromEntries(classes.map((item) => [item.id, aggregateCount(item.id)])),
      children: Object.fromEntries([...children.entries()].map(([id, values]) => [id, [...values]]))
    };
  },
  getScopedState(selectedIds) {
    const all = this.getState();
    const classByIdLocal = new Map(all.classes.map((item) => [item.id, item]));
    const parentByChild = new Map(data.classData.relations.map(({ child, parent }) => [child, parent]));
    const selectedSet = new Set(selectedIds);
    const selectionRoots = selectedIds.filter((id) => {
      let parentId = parentByChild.get(id);
      const seen = new Set();
      while (parentId && !seen.has(parentId)) {
        if (selectedSet.has(parentId)) return false;
        seen.add(parentId);
        parentId = parentByChild.get(parentId);
      }
      return true;
    });
    const included = new Set();
    const editable = new Set();
    selectedIds.forEach((id) => {
      if (!classByIdLocal.has(id)) return;
      editable.add(id);
      included.add(id);
    });
    // AIに渡すクラス情報は、選択中のIDに限定する。
    const scopedClasses = all.classes.filter((item) => included.has(item.id)).map((item) => ({
      ...item,
      parentId: parentByChild.get(item.id) || null,
      parentLabel: classByIdLocal.get(parentByChild.get(item.id))?.label || null
    }));
    return {
      selectedIds: [...selectedIds],
      selectionRoots,
      editableIds: [...editable],
      classes: scopedClasses,
      relations: all.relations.filter((item) => included.has(item.child) && included.has(item.parent)),
      counts: Object.fromEntries(scopedClasses.map((item) => [item.id, all.counts[item.id] || 0])),
      targetContext: buildAiTargetContext(all, scopedClasses.filter((item) => ['top', 'middle'].includes(item.type)))
    };
  },
  getHierarchyScopedState(selectedIds) {
    const all = this.getState();
    const classByIdLocal = new Map(all.classes.map((item) => [item.id, item]));
    const parentByChild = new Map(data.classData.relations.map(({ child, parent }) => [child, parent]));
    const selectedSet = new Set(selectedIds);
    const selectionRoots = selectedIds.filter((id) => {
      let parentId = parentByChild.get(id);
      const seen = new Set();
      while (parentId && !seen.has(parentId)) {
        if (selectedSet.has(parentId)) return false;
        seen.add(parentId);
        parentId = parentByChild.get(parentId);
      }
      return true;
    });
    const editable = new Set();
    const addSelectedHierarchyClass = (id) => {
      const item = classByIdLocal.get(id);
      if (!item || !['top', 'middle'].includes(item.type)) return;
      editable.add(id);
    };
    selectedIds.forEach(addSelectedHierarchyClass);
    if (!editable.size) return null;

    // AIに渡す階層情報も選択中の上位・中間クラスだけに限定する。
    const included = new Set(editable);
    const scopedClasses = all.classes.filter((item) => included.has(item.id) && ['top', 'middle'].includes(item.type)).map((item) => ({
      ...item,
      parentId: parentByChild.get(item.id) || null,
      parentLabel: classByIdLocal.get(parentByChild.get(item.id))?.label || null
    }));
    return {
      mode: 'hierarchy_scope',
      selectedIds: [...selectedIds],
      selectionRoots,
      editableIds: [...editable],
      classes: scopedClasses,
      relations: all.relations.filter((item) => included.has(item.child) && included.has(item.parent)),
      counts: Object.fromEntries(scopedClasses.map((item) => [item.id, all.counts[item.id] || 0])),
      targetContext: buildAiTargetContext(all, scopedClasses)
    };
  },
  getTargetContext(ids) {
    const all = this.getState();
    const classByIdLocal = new Map(all.classes.map((item) => [item.id, item]));
    const hierarchyClasses = [...new Set(ids)]
      .map((id) => classByIdLocal.get(id))
      .filter((item) => item && ['top', 'middle'].includes(item.type));
    return buildAiTargetContext(all, hierarchyClasses);
  },
  applyOperations(operations, expectedFingerprint, editableIds = [], availableIds = editableIds, operationPolicy = null) {
    const current = this.getState();
    const fingerprint = JSON.stringify({ classes: current.classes, relations: current.relations });
    if (fingerprint !== expectedFingerprint) throw new Error('提案作成後にクラスデータが変更されています。最新データで提案し直してください。');
    const candidateClasses = current.classes.map((item) => ({ ...item }));
    const relationByChild = new Map(current.relations.map((item) => [item.child, { ...item }]));
    const byId = new Map(candidateClasses.map((item) => [item.id, item]));
    const editable = new Set(editableIds);
    const available = new Set(availableIds);
    const originalParentByChild = new Map(current.relations.map(({ child, parent }) => [child, parent]));
    const policyAllows = (operation) => !operationPolicy
      || (operationPolicy.allowedTypes || []).includes(operation.type);
    const assertPolicyAllows = (operation) => {
      if (!policyAllows(operation)) throw new Error('この依頼または分割範囲では許可されていない操作です。');
      if (operation.type === 'addClass' && operationPolicy?.addClassTypes
        && !operationPolicy.addClassTypes.includes(operation.classType)) throw new Error('この依頼範囲では指定した種類のクラスを追加できません。');
      if (operation.type === 'moveClass' && operationPolicy?.moveSourceTypes) {
        const source = byId.get(resolve(operation.classId));
        if (!operationPolicy.moveSourceTypes.includes(source?.type)) throw new Error('この依頼範囲では指定した種類のクラスを移動できません。');
      }
      if (operation.type === 'moveChildren' && operationPolicy?.moveSourceTypes
        && !operationPolicy.moveSourceTypes.includes('middle')) throw new Error('この依頼範囲では配下一括移動ができません。');
      if (['renameClass', 'deleteClass'].includes(operation.type) && operationPolicy?.moveSourceTypes) {
        const source = byId.get(resolve(operation.classId));
        if (!operationPolicy.moveSourceTypes.includes(source?.type)) throw new Error('この依頼範囲では指定した種類のクラスを変更できません。');
      }
      if (operation.type === 'deleteClass' && operationPolicy && !operationPolicy.allowDelete) {
        throw new Error('この依頼ではクラス削除が許可されていません。');
      }
      if (operation.type === 'promoteClass' && operationPolicy?.moveSourceTypes
        && !operationPolicy.moveSourceTypes.includes('middle')) throw new Error('この依頼範囲では中間クラスを上位化できません。');
    };
    const hasUneditableOriginalDescendant = (id) => {
      const childrenByParent = new Map();
      originalParentByChild.forEach((parentId, childId) => {
        if (!childrenByParent.has(parentId)) childrenByParent.set(parentId, []);
        childrenByParent.get(parentId).push(childId);
      });
      const pending = [...(childrenByParent.get(id) || [])];
      const seen = new Set();
      while (pending.length) {
        const childId = pending.pop();
        if (seen.has(childId)) continue;
        seen.add(childId);
        if (!editable.has(childId)) return true;
        pending.push(...(childrenByParent.get(childId) || []));
      }
      return false;
    };
    const editableSource = (id) => {
      if (!editable.has(id)) throw new Error('選択範囲外のクラスを変更する提案は適用できません。');
    };
    const temporaryIds = new Map();
    const convertedIds = new Map();
    const availableReference = (id) => available.has(id)
      || [...temporaryIds.values()].includes(id)
      || [...convertedIds.values()].includes(id);
    const newClassId = (type) => {
      const prefix = type === 'top' ? 't' : 'm';
      const max = candidateClasses.reduce((value, item) => {
        const segment = String(item.id).split('/').pop();
        const match = segment.match(/^(?:new-)?[tm][_-]0*(\d+)$/);
        return match && kind(item.id) === type ? Math.max(value, Number(match[1])) : value;
      }, 0);
      return `new-${prefix}_${max + 1}`;
    };
    const addRelationCandidate = (child, parent) => {
      const existing = relationByChild.get(child);
      if (!existing || existing.parent !== parent) {
        relationByChild.set(child, { child, parent, relation: 'subClassOf' });
      }
    };
    const resolve = (id) => {
      const temporaryId = temporaryIds.get(id) || id;
      return convertedIds.get(temporaryId) || temporaryId;
    };
    operations.forEach((operation) => {
      if (!operation || typeof operation !== 'object') throw new Error('提案操作の形式が不正です。');
      assertPolicyAllows(operation);
      if (operation.type === 'addClass') {
        if (!['top', 'middle'].includes(operation.classType) || !String(operation.label || '').trim()
          || !operation.temporaryId || temporaryIds.has(operation.temporaryId)) throw new Error('追加クラスの指定が不正です。');
        const id = newClassId(operation.classType);
        const label = String(operation.label).trim();
        if (label === '未分類') throw new Error('未分類クラスは新設できません。');
        const existingClass = candidateClasses.find((item) => item.type === operation.classType && item.label.trim() === label);
        if (existingClass) {
          if (!availableReference(existingClass.id)) throw new Error(`同じ種類の「${label}」は既にありますが、選択範囲または共有範囲に含まれていません。`);
          temporaryIds.set(operation.temporaryId, existingClass.id);
          return;
        }
        if (operation.classType === 'middle' && candidateClasses.some((item) => item.type === 'top' && item.label.trim() === label)) {
          throw new Error(`同名の上位クラス「${label}」があるため、中間クラスとして追加できません。`);
        }
        temporaryIds.set(operation.temporaryId, id);
        editable.add(id);
        const item = { id, type: operation.classType, label };
        candidateClasses.push(item); byId.set(id, item);
        if (operation.classType === 'middle') {
          const parentId = resolve(operation.parentId);
          if (!availableReference(parentId)) throw new Error('選択中または共有許可済みのクラスだけを追加先に指定できます。');
          const parent = byId.get(parentId);
          if (!parent || !['top', 'middle'].includes(parent.type)) throw new Error('新しい中間クラスには上位または中間クラスの親が必要です。');
          addRelationCandidate(id, parent.id);
        } else if (operation.parentId) throw new Error('上位クラスに親は指定できません。');
        return;
      }
      if (operation.type === 'renameClass') {
        const id = resolve(operation.classId); const item = byId.get(id);
        editableSource(id);
        if (!item || !['top', 'middle'].includes(item.type) || item.label === '未分類') throw new Error('改名できるのは未分類以外の上位・中間クラスだけです。');
        const label = String(operation.label || '').trim();
        if (!label) throw new Error('クラス名を空にはできません。');
        if (label === item.label) return;
        if (label === '未分類') throw new Error('未分類クラスへの改名はできません。');
        if (candidateClasses.some((other) => other.id !== id && other.type === item.type && other.label.trim() === label)) throw new Error(`同じ種類の「${label}」が既にあります。`);
        if (item.type === 'middle' && candidateClasses.some((other) => other.type === 'top' && other.label.trim() === label)) throw new Error(`同名の上位クラス「${label}」があるため、中間クラスをその名前にできません。`);
        item.label = label; return;
      }
      if (operation.type === 'moveClass') {
        const id = resolve(operation.classId); const destinationId = resolve(operation.destinationId);
        editableSource(id);
        if (!availableReference(destinationId)) throw new Error('選択中または共有許可済みのクラスだけを移動先に指定できます。');
        const item = byId.get(id); const destination = byId.get(destinationId);
        if (item && isUnclassified(item)) throw new Error('未分類は受け皿のため移動できません。');
        const convertsTopToMiddle = item?.type === 'top' && ['top', 'middle'].includes(destination?.type);
        if (!item || !destination || (!['middle', 'class'].includes(item.type) && !convertsTopToMiddle)
          || !['top', 'middle'].includes(destination.type) || item.id === destination.id) throw new Error('クラスの移動先または対象が不正です。');
        let ancestorId = destinationId;
        while (ancestorId) {
          if (ancestorId === id) throw new Error('自分自身または配下への移動はできません。');
          ancestorId = relationByChild.get(ancestorId)?.parent;
        }
        if (convertsTopToMiddle) {
          const oldId = item.id;
          const newId = newClassId('middle');
          const newRelations = [...relationByChild.values()].map((relation) => ({
            ...relation,
            parent: relation.parent === oldId ? newId : relation.parent
          }));
          relationByChild.clear();
          newRelations.forEach((relation) => relationByChild.set(relation.child, relation));
          relationByChild.delete(oldId);
          item.id = newId;
          item.type = 'middle';
          byId.delete(oldId);
          byId.set(newId, item);
          convertedIds.set(oldId, newId);
          temporaryIds.forEach((allocatedId, temporaryId) => {
            if (allocatedId === oldId) convertedIds.set(temporaryId, newId);
          });
          editable.delete(oldId);
          editable.add(newId);
          addRelationCandidate(newId, destinationId);
          return;
        }
        relationByChild.delete(id);
        addRelationCandidate(id, destinationId); return;
      }
      if (operation.type === 'moveChildren') {
        const fromId = resolve(operation.from); const toId = resolve(operation.to);
        editableSource(fromId);
        if (!availableReference(toId)) throw new Error('選択中または共有許可済みのクラスだけを移動先に指定できます。');
        const from = byId.get(fromId); const destination = byId.get(toId);
        if (!from || from.type !== 'middle' || !destination || !['top', 'middle'].includes(destination.type)) throw new Error('配下一括移動の指定が不正です。');
        const directChildren = [...relationByChild.values()].filter((relation) => relation.parent === fromId).map((relation) => relation.child);
        if (directChildren.some((id) => !editable.has(id))) throw new Error('選択範囲外のクラスを含む一括移動はできません。');
        if (directChildren.includes(toId)) throw new Error('子孫を親として指定できません。');
        directChildren.forEach((child) => {
          relationByChild.delete(child);
          addRelationCandidate(child, toId);
        }); return;
      }
      if (operation.type === 'promoteClass') {
        const id = resolve(operation.classId);
        editableSource(id);
        const item = byId.get(id);
        if (!item || item.type !== 'middle' || item.label === '未分類') throw new Error('上位化できるのは未分類以外の中間クラスだけです。');
        if (candidateClasses.some((other) => other.id !== id && other.type === 'top' && other.label.trim() === item.label.trim())) {
          throw new Error(`同名の上位クラス「${item.label}」があるため上位化できません。`);
        }
        const newId = newClassId('top');
        relationByChild.delete(id);
        [...relationByChild.values()].forEach((relation) => {
          if (relation.parent === id) relation.parent = newId;
        });
        item.id = newId;
        item.type = 'top';
        byId.delete(id);
        byId.set(newId, item);
        convertedIds.set(id, newId);
        editable.delete(id);
        editable.add(newId);
        return;
      }
      if (operation.type === 'deleteClass') {
        const id = resolve(operation.classId); const item = byId.get(id);
        editableSource(id);
        if (!item || !['top', 'middle'].includes(item.type) || item.label === '未分類') throw new Error('削除できるのは未分類以外の上位・中間クラスだけです。');
        if (operationPolicy?.requireAllDescendantsEditableForDelete !== false && hasUneditableOriginalDescendant(id)) {
          throw new Error(`「${item.label}」の配下に未選択のクラスがあるため削除できません。`);
        }
        if ([...relationByChild.values()].some((relation) => relation.parent === id)) throw new Error(`「${item.label}」の配下を先に移動してください。`);
        relationByChild.delete(id);
        candidateClasses.splice(candidateClasses.indexOf(item), 1); byId.delete(id); return;
      }
      throw new Error(`許可されていない操作です: ${operation.type || '不明'}`);
    });
    const candidateRelations = [...relationByChild.values()];
    const parentByChild = new Map();
    candidateRelations.forEach(({ child, parent }) => {
      if (!byId.has(child) || !byId.has(parent) || parentByChild.has(child)) throw new Error('存在しないクラスまたは複数の親を持つ関係があります。');
      const childType = byId.get(child).type; const parentType = byId.get(parent).type;
      if (!['middle', 'class'].includes(childType) || !['top', 'middle'].includes(parentType)) throw new Error('階層の種類が不正な親子関係があります。');
      if (byId.get(parent).label === '未分類' && childType === 'middle') throw new Error('未分類の下に中間クラスは置けません。');
      parentByChild.set(child, parent);
    });
    candidateClasses.filter((item) => ['middle', 'class'].includes(item.type)).forEach((item) => {
      if (!parentByChild.has(item.id)) throw new Error(`「${item.label}」の親クラスがありません。`);
      const visited = new Set([item.id]); let parent = parentByChild.get(item.id);
      while (parent) {
        if (visited.has(parent)) throw new Error('循環する親子関係が作られています。');
        visited.add(parent); parent = parentByChild.get(parent);
      }
    });
    return { classes: candidateClasses, relations: candidateRelations, fingerprint, idRemaps: convertedIds };
  },
  commitCandidate(candidate, historyMetadata = {}) {
    const before = snapshotEditState();
    classes.splice(0, classes.length, ...candidate.classes.map((item) => ({ ...item })));
    data.classData.relations = candidate.relations.map((item) => ({ ...item, relation: 'subClassOf' }));
    classById.clear(); classes.forEach((item) => classById.set(item.id, item));
    [...heldInstances.keys()].forEach((id) => {
      const item = classById.get(id);
      if (!item || classKind(item) !== 'class') heldInstances.delete(id);
      else heldInstances.set(id, item);
    });
    [...heldMiddleClasses.keys()].forEach((id) => {
      const item = classById.get(id);
      if (!item || classKind(item) !== 'middle') heldMiddleClasses.delete(id);
      else heldMiddleClasses.set(id, item);
    });
    [...heldTopClasses.keys()].forEach((id) => {
      const item = classById.get(id);
      if (!item || classKind(item) !== 'top') heldTopClasses.delete(id);
      else heldTopClasses.set(id, item);
    });
    hasUnsavedChanges = true;
    const historyEntry = recordEditHistory(before, '', 'AI提案の適用', historyMetadata);
    render();
    return historyEntry;
  },
  render
};

// ============================================================
// 画面遷移時の未保存確認

document.getElementById('browse-link').addEventListener('click', (event) => {
  if (aiRequestRunning) {
    event.preventDefault();
    return;
  }
  // 閲覧画面へ移動すると編集途中のメモリ上データは失われるため、
  // 保存されていない変更がある場合だけ確認を求める。
  if (hasUnsavedChanges && !window.confirm('保存していない編集内容があります。保存せずに閲覧画面へ移動しますか？')) {
    event.preventDefault();
  }
});
window.addEventListener('beforeunload', (event) => {
  if (window.__editorImportReload) return;
  // タブを閉じる、更新するなどの離脱では未保存データや実行中のAIリクエストを保護する。
  if (!hasUnsavedChanges && !aiRequestRunning) return;
  event.preventDefault();
  event.returnValue = '';
});

// ============================================================
// ツリー画面の初期化
// ============================================================
const closeAllTreeButton = document.getElementById('close-all-tree');
closeAllTreeButton.hidden = document.getElementById('edit-tree-panel').hidden;
const toggleTreeEditMode = document.getElementById('toggle-tree-edit-mode');
toggleTreeEditMode.checked = treeHierarchyEditModeEnabled;
toggleTreeEditMode.addEventListener('change', () => {
  treeHierarchyEditModeEnabled = toggleTreeEditMode.checked;
  renderTree();
});
closeAllTreeButton.addEventListener('click', () => {
  captureTreeViewportAnchor(null, true);
  document.querySelectorAll('#edit-tree-panel .tree details[open]').forEach((details) => {
    details.open = false;
  });
});
const loadingIndicator = document.getElementById('loading-indicator');
if (loadingIndicator) loadingIndicator.hidden = true;
