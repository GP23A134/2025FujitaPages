// 項目詳細専用CSS。機能と一緒に読み込み、外部CSSへの依存を減らす。
const ITEM_DETAIL_CSS = `
.item-detail-membership, .item-membership-group { margin-top: 8px; }
.item-membership-group { border: 1px solid #d8e4ed; border-radius: 8px; background: #fbfdff; }
.item-membership-group summary { display: flex; justify-content: space-between; padding: 9px 11px; color: #35516f; font-size: 13px; font-weight: 700; cursor: pointer; }
.item-membership-group summary span { color: #64748b; font-size: 12px; }
.item-membership-group .detail-class-options { padding: 8px 11px 11px; border-top: 1px solid #e1e9f1; }
.class-detail-summary-item dt { font-size: 12px; }
.class-detail-summary-item dd { font-size: 14px; }
.class-detail-summary dl { display: block; }
.class-detail-summary-item { margin-bottom: 10px; }
.item-type-badge { display: inline-block; padding: 4px 10px; border: 1px solid #b9d1e5; border-radius: 999px; background: #eef6ff; color: #245d9c; font-size: 12px; font-weight: 700; }
.class-detail-heading { background: #264653; color: #fff; }
.class-detail-heading h3 { margin: 0; padding: 0; background: transparent; color: #fff; }
.class-detail-heading .class-detail-target { background: rgba(255, 255, 255, .16); border-color: rgba(255, 255, 255, .55); color: #fff; }
.class-detail-charts { grid-template-columns: 1fr; gap: 10px; }
.class-detail-charts { display: flex; flex-direction: column; gap: 12px; }
.class-detail-charts .class-chart-card { padding: 14px; border: 1px solid #d8e4ed; border-radius: 10px; background: #fbfdff; }
.class-detail-charts .class-chart-card + .class-chart-card { border-top: 1px solid #d8e4ed; padding-top: 14px; }
.item-detail-analysis-grid { display: grid; grid-template-columns: minmax(0, 1.6fr) minmax(220px, .9fr); gap: 12px; align-items: start; }
.item-detail-analysis-grid .class-detail-charts { min-width: 0; }
.item-detail-bar-related-area { display: grid; grid-template-columns: minmax(0, 1.6fr) minmax(220px, .9fr); gap: 14px; align-items: stretch; padding: 12px; border: 1px solid #d8e4ed; border-radius: 10px; background: #fbfdff; }
.item-detail-bar-related-area { min-height: 300px; }
.item-detail-bar-area { min-width: 0; min-height: 280px; height: 100%; }
.item-detail-bar-area .class-chart-card { width: 100%; box-sizing: border-box; }
.item-detail-bar-area .class-chart-card { height: 100%; box-sizing: border-box; }
.item-detail-bar-area .class-bar-chart { width: 100%; min-height: 240px; height: 100%; }
.item-detail-donut-area { padding-top: 14px; }
.item-detail-related-panel { min-width: 0; padding: 12px; border: 1px solid #d8e4ed; border-radius: 10px; background: transparent; }
.item-detail-related-panel .related-container { max-height: 220px; overflow-y: auto; padding-right: 4px; }
.item-detail-related-panel h4 { margin: 0 0 10px; color: #08706f; font-size: 14px; }
.item-detail-filter-status { display: flex; align-items: center; justify-content: space-between; gap: 10px; margin: 0 0 10px; padding: 8px 10px; border: 1px solid #d8e4ed; border-radius: 7px; color: #35516f; font-size: 12px; }
.item-detail-filter-status strong { color: #245d9c; }
.item-detail-filter-clear { padding: 4px 8px; border: 1px solid #b9d1e5; border-radius: 5px; background: #fff; color: #245d9c; font-size: 11px; cursor: pointer; }
.class-chart-card { padding: 12px; }
.class-chart-card h4 { margin-bottom: 8px; font-size: 13px; }
.class-chart-label { font-size: 15px; }
.class-chart-value { font-size: 14px; font-weight: 700; }
.item-detail-predicate-bar { cursor: pointer; }
.item-detail-predicate-bar:hover, .item-detail-predicate-bar:focus { opacity: .75; outline: none; }
.item-detail-predicate-selected { opacity: .72; }
.item-detail-predicate-selected rect { stroke: #173445; stroke-width: 2; }
.item-detail-chart-legend { display: flex; gap: 14px; margin: 0 0 8px 92px; color: #4b6175; font-size: 12px; }
.item-detail-chart-legend i { display: inline-block; width: 10px; height: 10px; margin-right: 4px; border-radius: 2px; vertical-align: -1px; }
.item-detail-chart-legend i.is-subject { background: #2f67a0; }
.item-detail-chart-legend i.is-object { background: #08706f; }
.related-class-group { padding: 9px 11px; }
.related-class-group h5 { margin-bottom: 7px; font-size: 13px; }
.class-detail-triples-section .annotation-detail-triples { gap: 6px; }
.class-detail-triples-section .annotation-detail-triples button { padding: 7px 9px; font-size: 13px; }
@media (max-width: 760px) {
  .item-detail-analysis-grid, .item-detail-bar-related-area { grid-template-columns: 1fr; }
}

/* 項目詳細専用。ほかのダイアログの同名クラスへ影響させない。 */
.item-detail-container .class-detail-heading { background: #264653; color: #fff; }
.item-detail-container .class-detail-heading h3 { margin: 0; padding: 0; background: transparent; color: #fff; }
.item-detail-container .class-detail-section { border-top: 1px solid #d5e0e6; }
.item-detail-container .class-detail-summary { padding-top: 14px; }
.item-detail-container .class-detail-charts { display: flex; flex-direction: column; }
.item-detail-container .class-chart-card { width: 100%; box-sizing: border-box; }
.item-detail-container .class-detail-triples-section { display: block; }
#annotationClassDialog { width: min(1100px, calc(100vw - 24px)); max-width: none; max-height: 92vh; padding: 0; overflow: hidden; }
#annotationClassDialog .detail-content { width: 100%; max-width: none; max-height: calc(92vh - 24px); box-sizing: border-box; overflow: hidden; padding: 0; }
.item-detail-container { width: 100%; max-width: none; box-sizing: border-box; }
.item-detail-container .class-detail-body { max-height: calc(92vh - 90px); overflow-y: auto; overflow-x: hidden; padding: 20px 28px 48px; box-sizing: border-box; }
`;

if (!document.getElementById("item-detail-style")) {
  const itemDetailStyle = document.createElement("style");
  itemDetailStyle.id = "item-detail-style";
  itemDetailStyle.textContent = ITEM_DETAIL_CSS;
  document.head.appendChild(itemDetailStyle);
}

// クラス詳細画面の集計グラフを描画するカラーパレット
const classChartColors = ["#2f67a0", "#08706f", "#d58b2a", "#8b5ca8", "#c45757", "#4f8b63"];
let activeItemDetailTerm = null;
let selectedItemDetailPredicate = null;
let selectedItemDetailSide = null;

// 空値を除外して出現回数を数え、件数順・名称順で安定して並べ替える。
function countValues(values) {
  const counts = new Map();
  values.filter(Boolean).forEach(value => counts.set(value, (counts.get(value) || 0) + 1));
  return [...counts.entries()].sort((a, b) => b[1] - a[1] || String(a[0]).localeCompare(String(b[0]), "ja"));
}

function initializeHeatmapControls() {
  const subjectSelect = document.getElementById("heatmapSubjectType");
  const predicateSelect = document.getElementById("heatmapPredicate");
  const structurePredicateSelect = document.getElementById("structurePredicate");
  if (!subjectSelect || !predicateSelect) return;
  const rows = getAllData();
  const subjectTypeCounts = new Map();
  rows.forEach(item => (item.triple.sTypeLabels || []).forEach(type => {
    if (type) subjectTypeCounts.set(type, (subjectTypeCounts.get(type) || 0) + 1);
  }));
  const subjectTypes = [...subjectTypeCounts.keys()].sort((a, b) =>
    subjectTypeCounts.get(b) - subjectTypeCounts.get(a) || String(a).localeCompare(String(b), "ja")
  );
  const predicates = [...new Set(rows.map(item => item.triple.pLabel).filter(Boolean))].sort((a, b) => String(a).localeCompare(String(b), "ja"));
  subjectSelect.innerHTML = subjectTypes.map(value => `<option value="${escapeHtml(value)}">${escapeHtml(value)}（${subjectTypeCounts.get(value).toLocaleString()}件）</option>`).join("");
  predicateSelect.innerHTML = predicates.map(value => `<option value="${escapeHtml(value)}">${escapeHtml(value)}</option>`).join("");
  structurePredicateSelect.innerHTML = predicateSelect.innerHTML;
}

function updateHeatmapSubjectOptions(rows) {
  const select = document.getElementById("heatmapSubjectType");
  if (!select) return;
  const previous = select.value;
  const counts = new Map();
  rows.forEach(item => (item.triple.sTypeLabels || []).forEach(type => {
    if (type) counts.set(type, (counts.get(type) || 0) + 1);
  }));
  const values = [...counts.keys()].sort((a, b) => counts.get(b) - counts.get(a) || String(a).localeCompare(String(b), "ja"));
  select.innerHTML = values.map(value => `<option value="${escapeHtml(value)}">${escapeHtml(value)}（${counts.get(value).toLocaleString()}件）</option>`).join("");
  if (values.includes(previous)) select.value = previous;
}

// 主語中間クラス・述語を固定した、ステークホルダークラス×目的語中間クラスの集計。
function renderOverviewHeatmap(rows) {
  const container = document.getElementById("overviewHeatmap");
  if (!container) return;
  const subjectType = document.getElementById("heatmapSubjectType")?.value || "";
  const predicate = document.getElementById("heatmapPredicate")?.value || "";
  const filtered = rows.filter(item => item.triple.pLabel === predicate && (item.triple.sTypeLabels || []).includes(subjectType));
  const opinionSets = new Map();
  filtered.forEach(item => item.stakeholderContexts.forEach(context => {
    if (!context.className || !context.opinions.length) return;
    (item.triple.oTypeLabels || []).forEach(object => {
      const key = `${context.typeName || "未分類"}\u0001\u0000${object}`;
      if (!opinionSets.has(key)) opinionSets.set(key, new Set());
      context.opinions.forEach(opinion => opinionSets.get(key).add(opinion));
    });
  }));
  const counts = new Map([...opinionSets].map(([key, opinions]) => [key, opinions.size]));
  const objectsTotal = (map, label, isSubject) => [...map.entries()].reduce((total, [key, count]) => {
    const parts = key.split("\u0000");
    return total + (parts[isSubject ? 0 : 1] === label ? count : 0);
  }, 0);
  const subjects = [...new Set([...counts.keys()].map(key => key.split("\u0000")[0]))].sort((a, b) => {
    const aType = a.split("\u0001")[0];
    const bType = b.split("\u0001")[0];
    return String(aType).localeCompare(String(bType), "ja") || objectsTotal(counts, b, true) - objectsTotal(counts, a, true) || String(a).localeCompare(String(b), "ja");
  });
  const objects = [...new Set([...counts.keys()].map(key => key.split("\u0000")[1]))].sort((a, b) => {
    const aTotal = objectsTotal(counts, a, false);
    const bTotal = objectsTotal(counts, b, false);
    return bTotal - aTotal || String(a).localeCompare(String(b), "ja");
  });
  if (!subjects.length || !objects.length) {
    container.innerHTML = '<p class="overview-chart-empty">表示できる組み合わせがありません。</p>';
    return;
  }
  const max = Math.max(...counts.values(), 1);
  const maxLog = Math.log1p(max);
  const color = count => count ? `rgba(47, 103, 160, ${0.16 + 0.84 * Math.log1p(count) / maxLog})` : "#f1f3f5";
  const header = objects.map(object => `<th scope="col" title="${escapeHtml(object)}">${escapeHtml(object)}</th>`).join("") + '<th scope="col" class="heatmap-total-heading">合計</th>';
  const heatmapColors = ["#eaf3ff", "#e9f8f0", "#fff3df", "#f4eafd", "#ffe9e9", "#e8f5f7"];
  const typeNames = [...new Set(subjects.map(subject => subject.split("\u0001")[0]))];
  const body = subjects.map(subject => {
    const [typeName, className] = subject.split("\u0001");
    const displayName = className || typeName;
    const rowColor = heatmapColors[typeNames.indexOf(typeName) % heatmapColors.length];
    const rowTotal = objects.reduce((total, object) => total + (counts.get(`${subject}\u0000${object}`) || 0), 0);
    return `<tr><th scope="row" title="${escapeHtml(displayName)}" style="background:${rowColor}">${className ? `<span class="heatmap-row-type">${escapeHtml(typeName)}</span>` : ""}${escapeHtml(displayName)}</th>${objects.map(object => {
    const count = counts.get(`${subject}\u0000${object}`) || 0;
    return `<td class="heatmap-cell${count ? " has-value" : ""}" style="background:${color(count)}" title="${escapeHtml(displayName)} × ${escapeHtml(object)}：${count}件">${count ? `<button type="button" class="heatmap-cell-button" data-heatmap-type="${escapeHtml(typeName)}" data-heatmap-object="${escapeHtml(object)}">${count}</button>` : "・"}</td>`;
    }).join("")}<td class="heatmap-total-cell">${rowTotal}</td></tr>`;
  }).join("");
  const columnTotals = objects.map(object => objectsTotal(counts, object, false));
  const totalRow = `<tr class="heatmap-total-row"><th scope="row">合計</th>${columnTotals.map(total => `<td>${total}</td>`).join("")}<td>${columnTotals.reduce((sum, total) => sum + total, 0)}</td></tr>`;
  container.innerHTML = `<div class="overview-heatmap-scroll"><table class="overview-heatmap-table"><thead><tr><th scope="col">ステークホルダー中間クラス\\目的語中間クラス</th>${header}</tr></thead><tbody>${body}${totalRow}</tbody></table></div><p class="heatmap-legend"><span>少ない</span><i style="background:#f1f3f5"></i><i style="background:rgba(47,103,160,.4)"></i><i style="background:rgba(47,103,160,.75)"></i><i style="background:rgba(47,103,160,1)"></i><span>多い</span></p><p class="overview-heatmap-note">主語中間クラス「${escapeHtml(subjectType)}」・述語「${escapeHtml(predicate)}」で集計（対象トリプル ${filtered.length.toLocaleString()}件）</p>`;
}

function renderStructureHeatmap() {
  const container = document.getElementById("structureHeatmap");
  const predicate = document.getElementById("structurePredicate")?.value || "";
  if (!container) return;
  const sets = new Map();
  getFilteredRows().filter(item => item.triple.pLabel === predicate).forEach(item => {
    const subjects = item.triple.sTypeLabels || [];
    const objects = item.triple.oTypeLabels || [];
    const opinions = item.stakeholderContexts.flatMap(context => context.opinions || []).filter(Boolean);
    subjects.forEach(subject => objects.forEach(object => {
      const key = `${subject}\u0000${object}`;
      if (!sets.has(key)) sets.set(key, new Set());
      opinions.forEach(opinion => sets.get(key).add(opinion));
    }));
  });
  const subjects = [...new Set([...sets.keys()].map(key => key.split("\u0000")[0]))].sort((a, b) => String(a).localeCompare(String(b), "ja"));
  const objects = [...new Set([...sets.keys()].map(key => key.split("\u0000")[1]))].sort((a, b) => String(a).localeCompare(String(b), "ja"));
  if (!subjects.length || !objects.length) { container.innerHTML = '<p class="overview-chart-empty">表示できる組み合わせがありません。</p>'; return; }
  const counts = new Map([...sets].map(([key, values]) => [key, values.size]));
  const max = Math.max(...counts.values(), 1);
  const color = count => count ? `rgba(47, 103, 160, ${0.16 + 0.84 * Math.log1p(count) / Math.log1p(max)})` : "#f1f3f5";
  const header = objects.map(object => `<th scope="col">${escapeHtml(object)}</th>`).join("");
  const body = subjects.map(subject => `<tr><th scope="row">${escapeHtml(subject)}</th>${objects.map(object => { const count = counts.get(`${subject}\u0000${object}`) || 0; return `<td class="heatmap-cell" style="background:${color(count)}">${count || "・"}</td>`; }).join("")}</tr>`).join("");
  container.innerHTML = `<div class="overview-heatmap-scroll"><table class="overview-heatmap-table"><thead><tr><th scope="col">主語中間クラス\\目的語中間クラス</th>${header}</tr></thead><tbody>${body}</tbody></table></div><p class="overview-heatmap-note">述語「${escapeHtml(predicate)}」で集計</p>`;
}

function showHeatmapOpinions(typeName, objectType) {
  const subjectType = document.getElementById("heatmapSubjectType")?.value || "";
  const predicate = document.getElementById("heatmapPredicate")?.value || "";
  const opinions = getSourceRows().filter(row =>
    getField(row, "pLabel") === predicate
    && getIntermediateClassLabel(row, "subject", "sClass") === subjectType
    && getIntermediateClassLabel(row, "object", "oClass") === objectType
    && getIntermediateClassLabel(row, "stakeholder", "stClass") === typeName
    && getField(row, "opinionContent")
  ).map(row => ({
    opinion: getField(row, "opinionContent"),
    stakeholder: getField(row, "stakeholderLabel"),
    evidence: getField(row, "evidence")
  }));
  const dialog = document.getElementById("detailDialog");
  if (!dialog) return;
  dialog.querySelector("h3").textContent = `${typeName} × ${objectType} の意見`;
  dialog.querySelector(".detail-content").innerHTML = opinions.length
    ? `<ol class="heatmap-opinion-list">${opinions.map(({ opinion, stakeholder, evidence }) => `<li><p>${escapeHtml(opinion)}</p>${stakeholder ? `<small>発言者：${escapeHtml(stakeholder)}</small>` : ""}${evidence ? `<details><summary>根拠を表示</summary><p>${escapeHtml(evidence)}</p></details>` : ""}</li>`).join("")}</ol>`
    : '<p>該当する意見はありません。</p>';
  dialog.showModal();
}

// SVG横棒グラフの生成
function createClassBarChart(title, entries) {
  const rows = entries.slice(0, 8);
  if (!rows.length) return `<div class="class-chart-card"><h4>${escapeHtml(title)}</h4><p class="class-detail-empty">データがありません。</p></div>`;

  const max = Math.max(1, rows[0][1]);
  const width = 560;
  const rowHeight = 34;
  const labelWidth = 105;
  const chartWidth = width - labelWidth - 45;
  const height = rows.length * rowHeight + 8;

  const bars = rows.map(([label, count], index) => {
    const y = index * rowHeight + 4;
    const barWidth = Math.max(3, chartWidth * count / max);
    
    // ラベルテキスト、棒、件数表示の位置を詰めて調整
    const selectedClass = selectedItemDetailPredicate === label ? " item-detail-predicate-selected" : "";
    return `<g class="item-detail-predicate-bar${selectedClass}" data-item-detail-predicate="${escapeHtml(label)}" tabindex="0" role="button" aria-label="${escapeHtml(label)} ${escapeHtml(count)}件"><text x="0" y="${y + 16}" class="class-chart-label">${escapeHtml(label)}</text>` +
           `<rect x="${labelWidth - 10}" y="${y + 1}" width="${barWidth}" height="26" rx="5" fill="${classChartColors[index % classChartColors.length]}"></rect>` +
           `<text x="${labelWidth - 10 + barWidth + 6}" y="${y + 17}" class="class-chart-value">${escapeHtml(count)}件</text></g>`;
  }).join("");

  return `<div class="class-chart-card"><h4>${escapeHtml(title)}</h4><svg class="class-bar-chart" viewBox="0 0 ${width} ${height}" role="img" aria-label="${escapeHtml(title)}">${bars}</svg></div>`;
}

// SVGドーナツグラフの生成
function createClassDonutChart(title, entries) {
  const rows = entries.slice(0, 6);
  const total = rows.reduce((sum, [, count]) => sum + count, 0);
  if (!total) return `<div class="class-chart-card"><h4>${escapeHtml(title)}</h4><p class="class-detail-empty">データがありません。</p></div>`;

  const radius = 18;
  const circumference = 2 * Math.PI * radius;
  let accumulatedPercent = 0;

  const segments = rows.map(([label, count], index) => {
    const ratio = count / total;
    const strokeDasharray = `${ratio * circumference} ${circumference}`;
    const strokeDashoffset = -accumulatedPercent * circumference;
    accumulatedPercent += ratio;
    const color = classChartColors[index % classChartColors.length];
    return `<circle cx="21" cy="21" r="${radius}" fill="none" stroke="${color}" stroke-width="6" stroke-dasharray="${strokeDasharray}" stroke-dashoffset="${strokeDashoffset}" transform="rotate(-90 21 21)" data-item-detail-side="${escapeHtml(label)}" tabindex="0" role="button" aria-label="${escapeHtml(label)} ${escapeHtml(count)}件"></circle>`;
  }).join("");

  const legend = rows.map(([label, count], index) =>
    `<li><span class="class-chart-dot" style="background:${classChartColors[index % classChartColors.length]}"></span>${escapeHtml(label)}：${escapeHtml(count)}件</li>`
  ).join("");

  return `
  <div class="class-chart-card">
    <h4>${escapeHtml(title)}</h4>
    <div class="class-donut-layout">
      <div class="class-donut" role="img" aria-label="${escapeHtml(title)}">
        <svg viewBox="0 0 42 42">${segments}</svg>
        <span>${total}<small>件</small></span>
      </div>
      <ul class="class-chart-legend">${legend}</ul>
    </div>
  </div>`;
}

function createClassDetailCharts(subjectRows, objectRows, detailRows) {
  const predicateRows = countValues(detailRows.map(({ triple }) => triple.pLabel));
  const sideRows = countValues([
    ...subjectRows.map(() => "主語側"),
    ...objectRows.map(() => "目的語側")
  ]);
  return `${createClassBarChart("述語別の関連トリプル数", predicateRows)}${createClassDonutChart("クラスの登場側", sideRows)}`;
}

function createPredicateSideChart(subjectRows, objectRows) {
  const predicates = new Set([
    "影響", "原因", "対策",
    ...subjectRows.map(({ triple }) => triple.pLabel).filter(Boolean),
    ...objectRows.map(({ triple }) => triple.pLabel).filter(Boolean)
  ]);
  const rows = [...predicates].map(predicate => ({
    predicate,
    subject: subjectRows.filter(({ triple }) => isSameValue(triple.pLabel, predicate)).length,
    object: objectRows.filter(({ triple }) => isSameValue(triple.pLabel, predicate)).length
  })).sort((a, b) => b.subject + b.object - (a.subject + a.object) || String(a.predicate).localeCompare(String(b.predicate), "ja"));
  const width = 560;
  const rowHeight = 48;
  const labelWidth = 92;
  const chartWidth = width - labelWidth - 70;
  const max = Math.max(1, ...rows.map(row => row.subject + row.object));
  const bars = rows.map((row, index) => {
    const y = index * rowHeight + 5;
    const subjectWidth = chartWidth * row.subject / max;
    const objectWidth = chartWidth * row.object / max;
    const selectedPredicate = selectedItemDetailPredicate === row.predicate;
    const predicateClass = selectedPredicate ? " item-detail-predicate-selected" : "";
    return `<g class="item-detail-predicate-bar${predicateClass}" data-item-detail-predicate="${escapeHtml(row.predicate)}" tabindex="0" role="button" aria-label="${escapeHtml(row.predicate)} ${row.subject + row.object}件"><text x="0" y="${y + 22}" class="class-chart-label">${escapeHtml(row.predicate)}</text><rect x="${labelWidth}" y="${y + 4}" width="${subjectWidth}" height="28" rx="5" fill="#2f67a0" data-item-detail-side="主語側" data-item-detail-predicate="${escapeHtml(row.predicate)}"></rect><rect x="${labelWidth + subjectWidth}" y="${y + 4}" width="${objectWidth}" height="28" rx="5" fill="#08706f" data-item-detail-side="目的語側" data-item-detail-predicate="${escapeHtml(row.predicate)}"></rect><text x="${labelWidth + subjectWidth + objectWidth + 8}" y="${y + 22}" class="class-chart-value">${row.subject + row.object}件</text></g>`;
  }).join("");
  return `<div class="class-chart-card"><h4>述語別・登場側の関連トリプル数</h4><div class="item-detail-chart-legend"><span><i class="is-subject"></i>主語側</span><span><i class="is-object"></i>目的語側</span></div><svg class="class-bar-chart" viewBox="0 0 ${width} ${Math.max(70, rows.length * rowHeight + 10)}" role="img" aria-label="述語別・登場側の関連トリプル数">${bars}</svg></div>`;
}

const itemDetailConfig = {
  maxTriples: 12,
  showSummary: true,
  showCharts: true,
  showRelatedTriples: true
};

function getCurrentItemType() {
  const selectedValue = document.getElementById("annotationTargetSelect")?.value;
  if (["intermediate", "class", "individual"].includes(selectedValue)) return selectedValue;
  if (selectedAnnotationTargets.has("individual")) return "individual";
  if (selectedAnnotationTargets.has("intermediate")) return "intermediate";
  return "class";
}

function getItemTypeLabel(type = getCurrentItemType()) {
  return { intermediate: "中間クラス", class: "クラス", individual: "個別" }[type];
}

function getRelatedLabels(triple, side, type = getCurrentItemType()) {
  if (type === "individual") return [triple[`${side}Label`]].filter(Boolean);
  if (type === "intermediate") return triple[`${side}TypeLabels`] || [];
  return triple[`${side}ClassLabels`] || [];
}

function getHierarchyTripleLabel(triple, side, type = getCurrentItemType()) {
  if (type === "individual") return triple[`${side}Label`] || "未指定";
  const labels = type === "intermediate" ? triple[`${side}TypeLabels`] : triple[`${side}ClassLabels`];
  return labels?.join("・") || "未指定";
}

function collectItemDetailData(term) {
  const normalizedTerm = normalize(term);
  const itemType = getCurrentItemType();
  const rows = getAllData();
  const subjectRows = rows.filter(({ triple }) => matchesDetailTarget(triple, "s", normalizedTerm, itemType));
  const objectRows = rows.filter(({ triple }) => matchesDetailTarget(triple, "o", normalizedTerm, itemType));
  const allDetailRows = getDetailData().filter(({ triple }) =>
    matchesDetailTarget(triple, "s", normalizedTerm, itemType) || matchesDetailTarget(triple, "o", normalizedTerm, itemType)
  );
  const relatedItems = relatedItemsForRows(subjectRows, objectRows);
  const relatedIntermediateClasses = collectOppositeLabels(subjectRows, objectRows, "type");
  const relatedIndividuals = collectOppositeLabels(subjectRows, objectRows, "individual");
  const parentIntermediateClasses = collectSameSideLabels(subjectRows, objectRows, "type");
  const parentClasses = collectSameSideLabels(subjectRows, objectRows, "class");
  return {
    normalizedTerm,
    subjectRows,
    objectRows,
    allDetailRows,
    detailRows: allDetailRows,
    relatedPredicates: [...new Set([...subjectRows, ...objectRows].map(({ triple }) => triple.pLabel).filter(Boolean))],
    relatedItems,
    relatedIntermediateClasses,
    relatedIndividuals,
    parentIntermediateClasses,
    parentClasses
  };
}

function matchesDetailTarget(triple, side, normalizedTerm, itemType = getCurrentItemType()) {
  if (itemType === "individual") return isSameValue(triple[`${side}Label`], normalizedTerm);
  const labels = itemType === "intermediate"
    ? (triple[`${side}TypeLabels`] || [])
    : (triple[`${side}ClassLabels`] || []);
  return labels.some(label => isSameValue(label, normalizedTerm));
}

function collectOppositeLabels(subjectRows, objectRows, kind) {
  const values = [];
  [[subjectRows, "o"], [objectRows, "s"]].forEach(([rows, side]) => rows.forEach(({ triple }) => {
    if (kind === "type") values.push(...(triple[`${side}TypeLabels`] || []));
    if (kind === "individual") values.push(triple[`${side}Label`]);
  }));
  return [...new Set(values.filter(Boolean))];
}

function collectSameSideLabels(subjectRows, objectRows, kind) {
  const values = [];
  [[subjectRows, "s"], [objectRows, "o"]].forEach(([rows, side]) => rows.forEach(({ triple }) => {
    if (kind === "type") values.push(...(triple[`${side}TypeLabels`] || []));
    if (kind === "class") values.push(...(triple[`${side}ClassLabels`] || []));
  }));
  return [...new Set(values.filter(Boolean))];
}

function relatedItemsForRows(subjectRows, objectRows) {
  return [...new Set([
    ...subjectRows.flatMap(({ triple }) => getRelatedLabels(triple, "o")),
    ...objectRows.flatMap(({ triple }) => getRelatedLabels(triple, "s"))
  ])];
}

function relatedClassGroupsForRows(subjectRows, objectRows) {
  const groups = new Map();
  const add = (rows, side) => rows.forEach(({ triple }) => {
    const predicate = triple.pLabel || "述語未指定";
    const labels = getRelatedLabels(triple, side);
    if (!groups.has(predicate)) groups.set(predicate, new Set());
    labels.forEach(label => groups.get(predicate).add(label));
  });
  add(subjectRows, "o");
  add(objectRows, "s");
  return [...groups.entries()].filter(([, values]) => values.size);
}

function collectMembership(term, itemType) {
  const membership = { intermediate: new Set(), class: new Set(), individual: new Set() };
  getAllData().forEach(({ triple }) => {
    const subjectMatches = itemType === "individual"
      ? isSameValue(triple.sLabel, term)
      : itemType === "intermediate"
        ? (triple.sTypeLabels || []).some(label => isSameValue(label, term))
        : (triple.sClassLabels || []).some(label => isSameValue(label, term));
    const objectMatches = itemType === "individual"
      ? isSameValue(triple.oLabel, term)
      : itemType === "intermediate"
        ? (triple.oTypeLabels || []).some(label => isSameValue(label, term))
        : (triple.oClassLabels || []).some(label => isSameValue(label, term));

    if (itemType === "intermediate") {
      if (subjectMatches) (triple.sClassLabels || []).forEach(label => membership.class.add(label));
      if (objectMatches) (triple.oClassLabels || []).forEach(label => membership.class.add(label));
    } else if (itemType === "class") {
      if (subjectMatches) {
        (triple.sTypeLabels || []).forEach(label => membership.intermediate.add(label));
        if (triple.sLabel) membership.individual.add(triple.sLabel);
      }
      if (objectMatches) {
        (triple.oTypeLabels || []).forEach(label => membership.intermediate.add(label));
        if (triple.oLabel) membership.individual.add(triple.oLabel);
      }
    } else {
      if (subjectMatches) (triple.sClassLabels || []).forEach(label => membership.class.add(label));
      if (objectMatches) (triple.oClassLabels || []).forEach(label => membership.class.add(label));
    }
  });
  Object.values(membership).forEach(values => values.delete(term));
  return membership;
}

function dataSecondLevelClasses(rows, relatedClasses) {
  const result = [];
  relatedClasses.forEach(relatedClass => {
    rows.forEach(({ triple }) => {
      const isSubject = (triple.sClassLabels || []).some(label => isSameValue(label, relatedClass));
      const isObject = (triple.oClassLabels || []).some(label => isSameValue(label, relatedClass));
      if (isSubject) result.push(...(triple.oClassLabels || []));
      if (isObject) result.push(...(triple.sClassLabels || []));
    });
  });
  return result;
}

// -------------------------------------------------------------
// 【コア】JS内に用意した固定HTMLの枠組み（シェル構造）
// -------------------------------------------------------------
function renderItemDetailShell({ headerHtml, summaryHtml, barChartHtml, donutChartHtml, relatedHtml, triplesHtml }) {
  return `
    <div class="item-detail-container">
      <!-- 1. 固定ヘッダー枠（×ボタン付き） -->
      <header class="class-detail-heading">
        ${headerHtml}
      </header>

      <!-- スクロール可能なメインコンテンツ領域 -->
      <div class="class-detail-body">
        <div class="item-detail-filter-status">
          <span>選択条件：<strong>${selectedItemDetailPredicate ? `述語「${escapeHtml(selectedItemDetailPredicate)}」` : "述語なし"}</strong>${selectedItemDetailSide ? ` ／ <strong>${escapeHtml(selectedItemDetailSide)}</strong>` : ""}</span>
          <button type="button" class="item-detail-filter-clear" data-clear-item-detail-filters>条件をクリア</button>
        </div>
        <!-- 2. 概要サマリー枠 -->
        <section class="class-detail-section class-detail-summary">
          ${summaryHtml}
        </section>

        <!-- 3. 集計グラフ枠 -->
        ${barChartHtml ? `
        <section class="class-detail-section">
          <div class="item-detail-bar-related-area">
            <div class="item-detail-bar-area">${barChartHtml}</div>
            <aside class="item-detail-related-panel class-detail-related-classes">
          <h4>関連項目${selectedItemDetailPredicate ? `（${escapeHtml(selectedItemDetailPredicate)}）` : ""}${selectedItemDetailSide ? `（${escapeHtml(selectedItemDetailSide)}）` : ""}</h4>
              <div class="related-container">${relatedHtml}</div>
            </aside>
          </div>
        </section>` : ""}

        ${donutChartHtml ? `
        <section class="class-detail-section item-detail-donut-area">
          ${donutChartHtml}
        </section>` : ""}

        <!-- 5. 本文トリプル一覧枠 -->
        <section class="class-detail-section class-detail-triples-section">
          <h4>関連トリプル${selectedItemDetailPredicate ? `（${escapeHtml(selectedItemDetailPredicate)}）` : ""}${selectedItemDetailSide ? `（${escapeHtml(selectedItemDetailSide)}）` : ""}</h4>
          <div class="triples-container">
            ${triplesHtml}
          </div>
        </section>
      </div>
    </div>
  `;
}

// 各コンテンツ（動的パーツ）の生成関数
function buildItemDetailContent(term) {
  const data = collectItemDetailData(term);
  const targetType = getCurrentItemType();
  const targetName = getItemTypeLabel(targetType);
  const membership = collectMembership(term, targetType);

  // ヘッダーパーツ
  const headerHtml = `
    <div class="class-detail-header-main">
      <span class="class-detail-target">${escapeHtml(targetName)}</span>
      <h3>${escapeHtml(term)}</h3>
    </div>
  `;

  // 概要サマリーパーツ
  const summaryHtml = `
    <dl>
      <div class="class-detail-summary-item">
        <dt>種別</dt>
        <dd><span class="item-type-badge">${escapeHtml(targetName)}</span></dd>
      </div>
      <div class="class-detail-summary-item item-membership-summary">
        <dt>所属</dt>
        <dd>${Object.entries(membership).filter(([, values]) => values.size).map(([type, values]) => `<details class="item-membership-group"><summary>${type === "intermediate" ? "所属する中間クラス" : type === "class" ? "所属するクラス" : "所属する個別"}<span>${values.size}件</span></summary><div class="detail-class-options">${[...values].sort((a, b) => String(a).localeCompare(String(b), "ja")).map(value => `<button type="button" data-related-class-term="${escapeHtml(value)}" data-related-class-kind="${type}">${escapeHtml(value)}</button>`).join("")}</div></details>`).join("") || "所属情報はありません。"}</dd>
      </div>
    </dl>`;

  // グラフパーツ
  const barChartHtml = itemDetailConfig.showCharts
    ? createPredicateSideChart(data.subjectRows, data.objectRows)
    : "";
  const donutChartHtml = "";

  // 関連クラスパーツ
  const relatedClassGroups = relatedClassGroupsForRows(
    selectedItemDetailSide === "目的語側" ? [] : data.subjectRows,
    selectedItemDetailSide === "主語側" ? [] : data.objectRows
  )
    .filter(([predicate]) => !selectedItemDetailPredicate || isSameValue(predicate, selectedItemDetailPredicate));
  const relatedKind = targetType;
  const relatedHtml = relatedClassGroups.length
    ? `<div class="related-class-groups">${relatedClassGroups.map(([predicate, values]) => `
        <section class="related-class-group">
          <h5>${escapeHtml(predicate)}</h5>
          <div class="detail-class-options">
            ${[...values].map(v => `<button type="button" data-related-class-term="${escapeHtml(v)}" data-related-class-kind="${escapeHtml(relatedKind)}">${escapeHtml(v)}</button>`).join("")}
          </div>
        </section>
      `).join("")}</div>`
    : `<p class="class-detail-empty">該当する関連クラスはありません。</p>`;

  // トリプル一覧パーツ
  const sourceRows = targetType === "individual" ? data.allDetailRows : getAllData();
  const detailRows = sourceRows.filter(({ triple }) => {
    const appearsAsSubject = matchesDetailTarget(triple, "s", data.normalizedTerm, targetType);
    const appearsAsObject = matchesDetailTarget(triple, "o", data.normalizedTerm, targetType);
    if (!appearsAsSubject && !appearsAsObject) return false;
    const matchesPredicate = !selectedItemDetailPredicate || isSameValue(triple.pLabel, selectedItemDetailPredicate);
    const matchesSide = !selectedItemDetailSide || (selectedItemDetailSide === "主語側"
      ? appearsAsSubject
      : appearsAsObject);
    return matchesPredicate && matchesSide;
  });
  const triplesHtml = (itemDetailConfig.showRelatedTriples && detailRows.length)
    ? `<div class="annotation-detail-triples">${detailRows.map(({ triple }) =>
        `<button type="button" data-annotation-class-detail-id="${escapeHtml(triple.tplId)}" data-annotation-class-term="${escapeHtml(data.normalizedTerm)}">${escapeHtml(getHierarchyTripleLabel(triple, "s", targetType))} ― ${escapeHtml(triple.pLabel || "未指定")} → ${escapeHtml(getHierarchyTripleLabel(triple, "o", targetType))}</button>`
      ).join("")}</div>`
    : `<p class="class-detail-empty">本文を表示できるトリプルはありません。</p>`;

  return renderItemDetailShell({
    headerHtml,
    summaryHtml,
    barChartHtml,
    donutChartHtml,
    relatedHtml,
    triplesHtml
  });
}

// ダイアログを表示するエントリーポイント
function showItemDetail(term) {
  const dialog = document.getElementById("annotationClassDialog");
  if (!dialog) return;

  const container = dialog.querySelector(".detail-content") || dialog;
  activeItemDetailTerm = term;
  selectedItemDetailSide = null;
  const initialData = collectItemDetailData(term);
  const initialGroups = relatedClassGroupsForRows(initialData.subjectRows, initialData.objectRows);
  selectedItemDetailPredicate = initialGroups
    .sort((first, second) => second[1].size - first[1].size)[0]?.[0] || null;
  container.innerHTML = buildItemDetailContent(term);

  if (!dialog.dataset.itemDetailEventsBound) {
    dialog.addEventListener("click", event => {
      if (event.target.closest("[data-clear-item-detail-filters]")) {
        selectedItemDetailPredicate = null;
        selectedItemDetailSide = null;
        container.innerHTML = buildItemDetailContent(activeItemDetailTerm);
        return;
      }
      const predicateBar = event.target.closest("[data-item-detail-predicate]");
      if (!predicateBar) return;
      const predicate = predicateBar.dataset.itemDetailPredicate;
      selectedItemDetailPredicate = selectedItemDetailPredicate === predicate ? null : predicate;
      container.innerHTML = buildItemDetailContent(activeItemDetailTerm);
    });
    dialog.addEventListener("click", event => {
      const sideSegment = event.target.closest("[data-item-detail-side]");
      if (!sideSegment) return;
      const side = sideSegment.dataset.itemDetailSide;
      selectedItemDetailSide = selectedItemDetailSide === side ? null : side;
      container.innerHTML = buildItemDetailContent(activeItemDetailTerm);
    });
    dialog.addEventListener("keydown", event => {
      if (event.key !== "Enter" && event.key !== " ") return;
      const interactive = event.target.closest("[data-item-detail-predicate], [data-item-detail-side]");
      if (!interactive) return;
      event.preventDefault();
      interactive.click();
    });
    dialog.dataset.itemDetailEventsBound = "true";
  }

  if (typeof dialog.showModal === "function") {
    dialog.showModal();
  }
}
