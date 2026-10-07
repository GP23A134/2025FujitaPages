// 各機能を初期化し、画面イベントを接続するエントリーポイント。
function handleSearchInput() {
  const inputText = document.getElementById("searchKeyword").value;
  selectedOverviewTripleId = null;
  annotationTerms.clear();
  excludedAnnotationTerms.clear();
  findAnnotations(inputText).forEach(term => annotationTerms.add(normalize(term)));
  annotationTripleSearchActive = Boolean(inputText.trim());
  page = 1;
  updateAnnotationPreview();
  renderTable();
  selectPageTab("overview");
}

// 入力中は検索を実行せず、前回のアノテーション条件だけを解除する。
function handleAnnotationTextEdit() {
  selectedOverviewTripleId = null;
  annotationTerms.clear();
  excludedAnnotationTerms.clear();
  annotationTripleSearchActive = false;
  page = 1;
  updateAnnotationPreview();
  renderTable();
}

function handleAnnotationTargetChange() {
  selectedAnnotationTargets.clear();
  selectedAnnotationTargets.add(document.getElementById("annotationTargetSelect").value);
  handleAnnotationTextEdit();
}

function handleKeywordInput(event) {
  keyword = event.target.value;
  page = 1;
  renderTable();
  if (annotationTripleSearchActive) updateAnnotationPreview();
}

function clearKeywordSearch() {
  const input = document.getElementById("keywordSearch");
  input.value = "";
  keyword = "";
  page = 1;
  renderTable();
}

function clearStructuredSearch() {
  clearFilters();
  initializeStructuredSearch();
  document.getElementById("keywordSearch").value = "";
  keyword = "";
  page = 1;
  updateStakeholderNameOptions();
  renderTable();
}

function openDisplaySettings() {
  const dialog = document.getElementById("displaySettingsDialog");
  document.getElementById("showEmptyOpinionsSetting").checked = showEmptyOpinions;
  document.getElementById("showStructuredSearchSetting").checked = !document.getElementById("structuredSearchPanel").hidden;
  document.getElementById("showTextSearchSetting").checked = !document.getElementById("textSearchPanel").hidden;
  document.getElementById("showKeywordSearchSetting").checked = !document.getElementById("keywordSearchPanel").hidden;
  dialog.showModal();
}

function applyDisplaySetting(event) {
  const { id, checked } = event.target;
  if (id === "showEmptyOpinionsSetting" && checked !== showEmptyOpinions) toggleEmptyOpinionDisplay();
  if (id === "showStructuredSearchSetting") document.getElementById("structuredSearchPanel").hidden = !checked;
  if (id === "showTextSearchSetting") document.getElementById("textSearchPanel").hidden = !checked;
  if (id === "showKeywordSearchSetting") document.getElementById("keywordSearchPanel").hidden = !checked;
}

// クリック対象の属性に応じて、詳細表示・ソート・フィルタ・表示モード切り替えを振り分ける。
function handleOutputClick(event) {
  const heatmapCell = event.target.closest("[data-heatmap-type]");
  if (heatmapCell) {
    showHeatmapOpinions(heatmapCell.dataset.heatmapType, heatmapCell.dataset.heatmapObject);
    return;
  }
  const overviewTriple = event.target.closest("[data-overview-triple-id]");
  if (overviewTriple) {
    showDetailCandidates(overviewTriple.dataset.overviewTripleId);
    return;
  }

  const overviewPredicate = event.target.closest("[data-overview-predicate]");
  if (overviewPredicate) {
    toggleOverviewPredicate(overviewPredicate.dataset.overviewPredicate);
    return;
  }

  const detailListButton = event.target.closest("[data-detail-list-id]");
  if (detailListButton) {
    showDetailCandidates(detailListButton.dataset.detailListId);
    return;
  }

  const detailButton = event.target.closest("[data-detail-id]");
  if (detailButton) {
    showDetails(detailButton.dataset.detailId);
    return;
  }

  const annotationClassDetailButton = event.target.closest("[data-annotation-class-detail-id]");
  if (annotationClassDetailButton) {
    document.getElementById("annotationClassDialog").close();
    showDetails(annotationClassDetailButton.dataset.annotationClassDetailId);
    return;
  }

  const sortButton = event.target.closest("[data-sort-key]");
  if (sortButton) {
    toggleSort(sortButton);
    return;
  }

  const annotationTermButton = event.target.closest("[data-annotation-term]");
  if (annotationTermButton) {
    const term = annotationTermButton.dataset.annotationTerm;
    if (excludedAnnotationTerms.has(term)) excludedAnnotationTerms.delete(term);
    else excludedAnnotationTerms.add(term);
    page = 1;
    renderTable();
    updateAnnotationPreview();
    return;
  }

  const annotationDetailButton = event.target.closest("[data-annotation-detail-term]");
  if (annotationDetailButton) {
    const targetType = annotationDetailButton.dataset.annotationDetailTarget || "intermediate";
    selectedAnnotationTargets.clear();
    selectedAnnotationTargets.add(targetType);
    const targetSelect = document.getElementById("annotationTargetSelect");
    if (targetSelect) targetSelect.value = targetType;
    showItemDetail(annotationDetailButton.dataset.annotationDetailTerm);
    return;
  }

  const filterButton = event.target.closest("[data-term]");
  if (filterButton) {
    toggleFilter(filterButton);
    if (filterButton.classList.contains("ann-chip")) updateAnnotationPreview();
  }
}

// ページ番号を変更して、現在のフィルタ・ソート条件で再描画する。
function changePage(offset) {
  page += offset;
  renderTable();
}

// 表示ページをタブで切り替える。矢印キーでも隣のタブへ移動できる。
function selectPageTab(pageName, moveFocus = false) {
  const isSecondHeatmap = pageName === "second";
  // テーブルでの単票表示は、概要へ戻る際に解除して元の検索結果一覧へ戻す。
  if (!isSecondHeatmap && selectedOverviewTripleId != null) {
    selectedOverviewTripleId = null;
    renderTable();
  }
  const overviewTab = document.getElementById("overviewTab");
  overviewTab.classList.toggle("is-active", !isSecondHeatmap);
  const secondTab = document.getElementById("futureHeatmapTab");
  secondTab.classList.toggle("is-active", isSecondHeatmap);
  overviewTab.setAttribute("aria-selected", String(!isSecondHeatmap));
  secondTab.setAttribute("aria-selected", String(isSecondHeatmap));
  overviewTab.tabIndex = isSecondHeatmap ? -1 : 0;
  secondTab.tabIndex = isSecondHeatmap ? 0 : -1;
  document.getElementById("overviewPanel").hidden = isSecondHeatmap;
  document.getElementById("futureHeatmapPanel").hidden = !isSecondHeatmap;
  if (moveFocus) (isSecondHeatmap ? secondTab : overviewTab).focus();
}

// 画面初期化はここに集約する。画面固有の処理本体は core の機能ファイルに置く。
function initializeTableScreen() {
  initializeStructuredSearch();
  updateAnnotationPreview();
  renderTable();
}

function initializeOverviewScreen() {
  renderOverview();
}

function initializeSettingsScreen() {
  const dialog = document.getElementById("displaySettingsDialog");
  if (!dialog) return;
  dialog.addEventListener("change", applyDisplaySetting);
  dialog.addEventListener("click", event => {
    if (event.target === event.currentTarget || event.target.closest("[data-close-settings]")) event.currentTarget.close();
  });
}

function initializeTripleDetailScreen() {
  document.getElementById("detailDialog")?.addEventListener("click", event => {
    if (event.target === event.currentTarget || event.target.closest("[data-close-dialog]")) event.currentTarget.close();
  });
}

function initializeClassTriplesScreen() {
  document.getElementById("detailListDialog")?.addEventListener("click", event => {
    if (event.target === event.currentTarget || event.target.closest("[data-close-detail-list]")) event.currentTarget.close();
    const detailButton = event.target.closest("[data-detail-id]");
    if (detailButton) {
      event.currentTarget.close();
      showDetails(detailButton.dataset.detailId);
    }
  });
}

function initializeIndividualDetailScreen() {
  document.getElementById("annotationClassDialog")?.addEventListener("click", event => {
    if (event.target === event.currentTarget || event.target.closest("[data-close-annotation-class]")) event.currentTarget.close();
    const relatedClassButton = event.target.closest("[data-related-class-term]");
    if (relatedClassButton) {
      event.currentTarget.close();
      selectedAnnotationTargets.clear();
      const relatedKind = relatedClassButton.dataset.relatedClassKind || "class";
      selectedAnnotationTargets.add(relatedKind);
      const targetSelect = document.getElementById("annotationTargetSelect");
      if (targetSelect) targetSelect.value = relatedKind;
      showItemDetail(relatedClassButton.dataset.relatedClassTerm);
    }
  });
}

async function initializeApplication() {
  const output = document.getElementById("outputContainer");

  await loadIntermediateClassData();

  initializeTableScreen();
  initializeOverviewScreen();
  initializeHeatmapControls();
  renderOverview();
  renderStructureHeatmap();
  initializeSettingsScreen();
  initializeTripleDetailScreen();
  initializeClassTriplesScreen();
  initializeIndividualDetailScreen();

  const annotationInput = document.getElementById("searchKeyword");
  annotationInput.addEventListener("input", handleAnnotationTextEdit);
  annotationInput.addEventListener("keydown", event => {
    if (event.key !== "Enter" || event.isComposing) return;
    event.preventDefault();
    handleSearchInput();
  });
  document.getElementById("annotationSearchBtn").addEventListener("click", handleSearchInput);
  document.getElementById("annotationTargetSelect").addEventListener("change", handleAnnotationTargetChange);
  document.getElementById("keywordSearch").addEventListener("input", handleKeywordInput);
  document.getElementById("clearKeywordSearchBtn").addEventListener("click", clearKeywordSearch);
  document.querySelector(".structured-search-panel").addEventListener("change", handleStructuredSearchInput);
  document.querySelector(".structured-search-panel").addEventListener("click", event => {
    const toggle = event.target.closest(".multi-select-toggle");
    const remove = event.target.closest("[data-remove-value]");
    if (toggle) {
      const parent = toggle.closest(".multi-select");
      document.querySelectorAll(".multi-select.is-open").forEach(select => {
        if (select === parent) return;
        select.classList.remove("is-open");
        select.querySelector(".multi-select-toggle")?.setAttribute("aria-expanded", "false");
      });
      const open = parent.classList.toggle("is-open");
      if (open) populateMultiSelect(parent.id, parent._candidateValues || []);
      else toggle.setAttribute("aria-expanded", "false");
    } else if (remove) {
      const parent = remove.closest(".multi-select");
      getStructuredSet(parent.dataset.filter).delete(remove.dataset.removeValue);
      if (parent.dataset.filter === "stakeholder-type") {
        selectedStructuredStakeholderNames.clear();
        updateStakeholderNameOptions();
      }
      if (parent.dataset.filter === "triple-first" || parent.dataset.filter === "relation") updateTripleDependentOptions();
      refreshMultiSelect(parent);
      page = 1;
      renderTable();
    }
  });
  // キャプチャ段階で判定することで、開く処理中の再描画後に誤って欄外扱いになるのを防ぐ。
  document.addEventListener("click", event => {
    if (event.target.closest(".multi-select")) return;
    document.querySelectorAll(".multi-select.is-open").forEach(select => {
      select.classList.remove("is-open");
      select.querySelector(".multi-select-toggle")?.setAttribute("aria-expanded", "false");
    });
  }, true);
  document.getElementById("clearStructuredSearchBtn").addEventListener("click", clearStructuredSearch);
  document.getElementById("heatmapSubjectType").addEventListener("change", renderOverview);
  document.getElementById("heatmapPredicate").addEventListener("change", () => { renderOverview(); renderStructureHeatmap(); });
  document.getElementById("structurePredicate").addEventListener("change", renderStructureHeatmap);
  document.getElementById("displaySettingsBtn").addEventListener("click", openDisplaySettings);
  document.querySelector(".page-tabs").addEventListener("click", event => {
    const tab = event.target.closest("[role=tab]");
    if (!tab) return;
    selectPageTab(tab.id === "futureHeatmapTab" ? "second" : "overview");
  });
  document.querySelector(".page-tabs").addEventListener("keydown", event => {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    const tabs = [...document.querySelectorAll(".page-tab")];
    const current = tabs.indexOf(document.activeElement);
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1 : (current + (event.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length;
    selectPageTab(["overview", "second"][next], true);
  });
  output.addEventListener("click", handleOutputClick);
}

window.addEventListener("DOMContentLoaded", initializeApplication);
