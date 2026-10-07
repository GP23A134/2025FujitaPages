/**
 * アノテーション、結果テーブル、詳細ダイアログの描画を担当する。
 * フィルタ状態やデータ変換は、それぞれ filters.js と data.js に分離している。
 */

// --- annotation-view ---
/** 入力文章からクラス名を検出し、クリック可能な表示を生成する。 */
function findAnnotations(text) {
  const normalizedText = normalize(text);
  return normalizedText ? getAnnotationVocabulary().filter(term => normalizedText.includes(term)) : [];
}

function getAnnotationVocabulary() {
  const labels = getAllData().flatMap(({ triple }) => getAnnotationLabels(triple));
  return [...new Set(labels.map(normalize).filter(term => term.length > 1))]
    .sort((firstTerm, secondTerm) => secondTerm.length - firstTerm.length);
}

// 抽出語のうち、別の抽出語と主語・目的語の組を作れる語だけを結果に残す。
function getAnnotationTermsWithTriples() {
  const terms = [...annotationTerms];
  const termsWithTriples = new Set();
  getAllData().forEach(({ triple }) => {
    const subjectTerms = terms.filter(term =>
      getAnnotationLabelsForSide(triple, "s").some(label => isSameValue(label, term))
    );
    const objectTerms = terms.filter(term =>
      getAnnotationLabelsForSide(triple, "o").some(label => isSameValue(label, term))
    );
    subjectTerms.forEach(subjectTerm => objectTerms.forEach(objectTerm => {
      if (isSameValue(subjectTerm, objectTerm)) return;
      termsWithTriples.add(subjectTerm);
      termsWithTriples.add(objectTerm);
    }));
  });
  return terms.filter(term => termsWithTriples.has(term));
}

function getAnnotationCount(term) {
  return getAllData().filter(item => {
    const labels = getAnnotationLabels(item.triple);
    return labels.some(label => isSameValue(label, term));
  }).length;
}

function createAnnotationLabel(term) {
  const normalizedTerm = normalize(term);
  const isExcluded = excludedAnnotationTerms.has(normalizedTerm);
  const target = document.getElementById("annotationTargetSelect")?.value || "intermediate";
  return `<span class="annotation-term-actions"><button type="button" class="ann-chip ann-chip-inline${isExcluded ? " is-excluded" : ""}" data-annotation-term="${escapeHtml(normalizedTerm)}" aria-pressed="${isExcluded}" aria-label="${escapeHtml(term)}を${isExcluded ? "検索に含める" : "検索から除外する"}"><span class="ann-chip-word">${escapeHtml(term)}</span></button><button type="button" class="annotation-detail-btn" data-annotation-detail-term="${escapeHtml(normalizedTerm)}" data-annotation-detail-target="${escapeHtml(target)}" aria-label="${escapeHtml(term)}の項目詳細を見る">i</button></span>`;
}

function updateAnnotationPreview() {
  const input = document.getElementById("searchKeyword");
  const panel = document.querySelector(".annotation-panel");
  const preview = document.getElementById("annotationPreview");
  if (!panel || !preview) return;
  const terms = getAnnotationTermsWithTriples();
  panel.style.display = annotationTripleSearchActive ? "block" : "none";
  if (!terms.length) {
    preview.textContent = "";
    return;
  }
  preview.innerHTML = terms.map(createAnnotationLabel).join("");
}

// --- table-view ---
/** 結果テーブル、ソート、ページネーションの描画を担当する。 */
let showEmptyOpinions = false;
let selectedOverviewPredicate = null;
function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// 検索欄に入力された語だけを強調し、それ以外は安全なHTML文字列として返す。
function highlightKeyword(value) {
  const text = String(value || "");
  const searchWord = keyword.trim();
  if (!searchWord) return escapeHtml(text);

  const pattern = escapeRegExp(searchWord).replace(/\s+/g, "\\s+");
  const parts = text.split(new RegExp(`(${pattern})`, "gi"));
  return parts.map((part, index) => index % 2 ? `<mark class="keyword-match">${escapeHtml(part)}</mark>` : escapeHtml(part)).join("");
}

function createFilterButton(text, className, attributes = "") {
  return `<button type="button" class="${className}" ${attributes}>${highlightKeyword(text || "未指定")}</button>`;
}

function hasSelectedValue(selectedSet, value) {
  return [...selectedSet].some(selectedValue => isSameValue(selectedValue, value));
}

function selectedButton(text, className, attributes, selectedSet) {
  const selectedClass = hasSelectedValue(selectedSet, text) ? " annotation-table-match" : "";
  return createFilterButton(text, `${className}${selectedClass}`, attributes);
}

// 一覧用に、同じ発言者タイプ（中間クラス）を集約して表示する。
function createStakeholderCells(stakeholderContexts, fieldName) {
  if (!stakeholderContexts.length) return "";
  const countsByClass = new Map();
  stakeholderContexts.forEach(context => {
    const className = context[fieldName] || "未指定";
    countsByClass.set(className, (countsByClass.get(className) || 0) + 1);
  });

  return `<div class="table-stakeholder-list">${[...countsByClass.entries()].map(([className, count]) => `
    <div class="table-stakeholder">
      ${selectedButton(className, "speaker-class table-entity-filter", `data-kind="stakeholder-class" data-term="${escapeHtml(className)}"`, selectedStakeholderClasses)} <span class="stakeholder-count">${count}件</span>
    </div>`).join("")}</div>`;
}

// 一覧では意見件数を見出しにし、必要な行だけプルダウンで本文を開く。
function createOpinionSummary(stakeholderContexts, tripleId) {
  const opinions = [...new Set(stakeholderContexts.flatMap(context => context.opinions))];
  if (!opinions.length) return '<span class="opinion-empty">意見なし</span>';

  const groups = stakeholderContexts.filter(context => context.opinions.length).map(context =>
    `<section class="opinion-dialog-group"><h4>${escapeHtml(context.typeName || "発言者タイプ未指定")}：${escapeHtml(context.name || "未指定")}</h4><ul>${context.opinions.map(opinion => `<li>${escapeHtml(opinion)}</li>`).join("")}</ul></section>`
  ).join("");
  return `<details class="opinion-dropdown"><summary>意見 ${opinions.length}件</summary><div class="opinion-dropdown-content">${groups}</div></details>`;
}

function toggleEmptyOpinionDisplay() {
  showEmptyOpinions = !showEmptyOpinions;
  const setting = document.getElementById("showEmptyOpinionsSetting");
  if (setting) setting.checked = showEmptyOpinions;
  renderTable();
}

// 主語・目的語の個別名は表示せず、それぞれのクラスを従来のエンティティカードと同じ形で整える。
function createTripleClassHtml(classLabels, kind) {
  const classButtons = classLabels.map(classLabel => {
    // 主語クラスは左側、目的語クラスは右側だけで一致を判定する。
    const structuredMatch = kind === "subject" && hasSelectedValue(selectedTripleFirst, classLabel)
      ? " table-triple-first-match"
      : kind === "object" && hasSelectedValue(selectedTripleSecond, classLabel)
        ? " table-triple-second-match"
        : "";

    return selectedButton(
      classLabel,
      `mini-card table-entity-filter table-class-filter${structuredMatch}`,
      `data-term="${escapeHtml(classLabel)}"`,
      selectedTerms
    );
  }).join(" ");
  return classButtons ? `<div class="triple-entity">${classButtons}</div>` : "未指定";
}

// 中間クラスは発言者タイプと同じ丸いタグで、従来クラスのカードの上に表示する。
function createIntermediateClassHtml(classLabels, kind) {
  return classLabels.map(classLabel => {
    const structuredMatch = kind === "subject" && hasSelectedValue(selectedTripleFirst, classLabel)
      ? " table-triple-first-match"
      : kind === "object" && hasSelectedValue(selectedTripleSecond, classLabel)
        ? " table-triple-second-match"
        : "";
    return selectedButton(
      classLabel,
      `intermediate-class table-entity-filter${structuredMatch}`,
      `data-term="${escapeHtml(classLabel)}"`,
      selectedTerms
    );
  }).join(" ");
}
function createDocumentTypeCells(documentTypes) {
  return documentTypes.map(documentType =>
    selectedButton(
      documentType,
      "pill pill-green table-entity-filter",
      `data-kind="document-type" data-term="${escapeHtml(documentType)}"`,
      selectedDocumentTypes
    )
  ).join(" ");
}

function createTableRow(item) {
  const { documentTypes, triple, prefectures, stakeholderContexts } = item;
  const prefectureButtons = prefectures.map(prefecture => selectedButton(
    prefecture,
    "pill pill-green table-entity-filter",
    `data-kind="prefecture" data-term="${escapeHtml(prefecture)}"`,
    selectedPrefectures
  )).join(" ");

  // 因果構造（トリプル）表示の行を生成する。
  const subjectTypes = triple.sTypeLabels || [];
  const objectTypes = triple.oTypeLabels || [];
  const subjectHtml = createTripleClassHtml(triple.sClassLabels, "subject");
  const objectHtml = createTripleClassHtml(triple.oClassLabels, "object");
  const subjectTypeHtml = createIntermediateClassHtml(subjectTypes, "subject");
  const objectTypeHtml = createIntermediateClassHtml(objectTypes, "object");

  const hasSelectedClass = (classLabels, selected) => selected.size
    && [...selected].some(term => classLabels.some(classLabel => isSameValue(classLabel, term)));

  // 主語クラスの条件は左列、目的語クラスの条件は右列だけを強調する。
  const subjectCellClass = hasSelectedClass(getTripleClassLabels(triple, "s"), selectedTripleFirst)
    ? " table-class-only-cell table-triple-first-cell-match" : " table-class-only-cell";
  const objectCellClass = hasSelectedClass(getTripleClassLabels(triple, "o"), selectedTripleSecond)
    ? " table-class-only-cell table-triple-second-cell-match" : " table-class-only-cell";

  const relationMatch = hasSelectedValue(selectedRelations, triple.pLabel) ? " table-relation-match" : "";
  return `<tr>
    <td class="number-cell"><div class="number-cell-content"><span>${escapeHtml(triple.tplId)}</span><button type="button" class="show-btn detail-inline-btn" data-detail-list-id="${escapeHtml(triple.tplId)}">詳細</button></div></td>
    <td class="document-type-cell">${createDocumentTypeCells(documentTypes)}</td>
    <td class="prefecture-cell">${prefectureButtons}</td>
    <td class="${subjectCellClass}">${subjectTypeHtml}${subjectHtml}</td>
    <td class="triple-relation${relationMatch ? " table-relation-cell-match" : ""}"><span>―</span><strong class="${relationMatch}">${highlightKeyword(triple.pLabel || "未指定")}</strong><span>→</span></td>
    <td class="${objectCellClass}">${objectTypeHtml}${objectHtml}</td>
    <td>${createStakeholderCells(stakeholderContexts, "typeName")}</td>
    <td class="opinion-cell">${createOpinionSummary(stakeholderContexts, triple.tplId)}</td>
  </tr>`;
}

function getFilteredRows() {
  return getAllData().filter(item =>
    matchesSelectedFilters(item)
    && (showEmptyOpinions || item.stakeholderContexts.some(context => context.opinions.length > 0))
  );
}

function renderTable() {
  const filteredRows = getFilteredRows();
  updateHeatmapSubjectOptions(filteredRows);
  const count = document.getElementById("searchResultCount");
  if (count) count.textContent = `${filteredRows.length.toLocaleString()}件 / 全${getAllData().length.toLocaleString()}件`;
  renderOverview();
}

// 概要タブに、現在のデータ件数を簡潔に表示する。
function renderOverview() {
  const filteredRows = getFilteredRows();
  const annotationTarget = document.getElementById("annotationTargetSelect")?.value || "intermediate";
  renderOverviewHeatmap(filteredRows);
  renderStructureHeatmap();
}

function getUniqueOverviewTriples(rows, annotationTarget) {
  const uniqueTriples = new Map();
  rows.forEach(item => {
    const { triple } = item;
    const subjectLabels = annotationTarget === "intermediate" ? triple.sTypeLabels : annotationTarget === "individual" ? [triple.sLabel] : triple.sClassLabels;
    const objectLabels = annotationTarget === "intermediate" ? triple.oTypeLabels : annotationTarget === "individual" ? [triple.oLabel] : triple.oClassLabels;
    const key = [subjectLabels, triple.pLabel, objectLabels]
      .map(value => Array.isArray(value) ? [...value].sort().map(normalize).join("\u0001") : normalize(value))
      .join("\u0000");
    if (!uniqueTriples.has(key)) uniqueTriples.set(key, { item, opinions: new Set() });
    const entry = uniqueTriples.get(key);
    item.stakeholderContexts.forEach(context => context.opinions.forEach(opinion => entry.opinions.add(opinion)));
  });
  return [...uniqueTriples.values()];
}

function toggleOverviewPredicate(predicate) {
  selectedOverviewPredicate = selectedOverviewPredicate === predicate ? null : predicate;
  renderOverview();
}

function toggleFilter(button) {
  const term = button.dataset.term;
  if (!term) return;

  const selectedSet = getSelectionSet(button.dataset.kind);
  if (selectedSet.has(term)) selectedSet.delete(term);
  else selectedSet.add(term);

  page = 1;
  renderTable();
}

// 同じ列をクリックするたびに、降順、昇順、並び替えなしを切り替える。
function updateSortState(nextKey) {
  if (sortKey !== nextKey) {
    sortKey = nextKey;
    sortAscending = false;
  } else if (!sortAscending) {
    sortAscending = true;
  } else {
    sortKey = null;
    sortAscending = true;
  }
}

// 現在のソート状態を、各列見出しの矢印に反映する。
function updateSortButtonStates() {
  document.querySelectorAll("[data-sort-key]").forEach(button => {
    const isCurrentColumn = button.dataset.sortKey === sortKey;
    button.classList.toggle("is-asc", isCurrentColumn && sortAscending);
    button.classList.toggle("is-desc", isCurrentColumn && !sortAscending);
  });
}

function toggleSort(sortButton) {
  updateSortState(sortButton.dataset.sortKey);
  page = 1;
  updateSortButtonStates();
  renderTable();
}
