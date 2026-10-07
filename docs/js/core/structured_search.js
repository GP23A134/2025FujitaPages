// 構造化検索の候補生成・選択状態・候補連動を担当する。
function getStructuredSet(filter) {
  if (filter === "triple-first") return selectedTripleFirst;
  if (filter === "triple-second") return selectedTripleSecond;
  if (filter === "relation") return selectedRelations;
  if (filter === "stakeholder-type") return selectedStructuredStakeholderClasses;
  return selectedStructuredStakeholderNames;
}

function populateMultiSelect(id, values) {
  const container = document.getElementById(id);
  if (!container) return;
  const selected = getStructuredSet(container.dataset.filter);
  container._candidateValues = values;
  const counts = new Map();
  if (values.length > 0 && typeof values[0] === "object" && values[0] !== null) {
    const tripleSets = new Map();
    values.forEach(item => {
      if (!item || !item.value) return;
      if (!tripleSets.has(item.value)) tripleSets.set(item.value, new Set());
      tripleSets.get(item.value).add(item.tplId);
    });
    tripleSets.forEach((set, value) => counts.set(value, set.size));
  } else values.filter(Boolean).forEach(value => counts.set(value, (counts.get(value) || 0) + 1));
  const options = [...counts.entries()].sort(([a, aCount], [b, bCount]) =>
    Number(selected.has(b)) - Number(selected.has(a)) || bCount - aCount || String(a).localeCompare(String(b), "ja"));
  const isOpen = container.classList.contains("is-open");
  container.innerHTML = `<button type="button" class="multi-select-toggle" aria-expanded="${isOpen}"><span>${selected.size ? `${selected.size}件選択` : "すべて"}</span><b aria-hidden="true">▼</b></button><div class="multi-select-options">${isOpen ? options.map(([value, count]) => `<label><input type="checkbox" value="${escapeHtml(value)}" ${selected.has(value) ? "checked" : ""}><span>${escapeHtml(value)}（${count.toLocaleString()}件）</span></label>`).join("") : ""}</div><div class="selected-filter-chips">${[...selected].map(value => `<button type="button" data-remove-value="${escapeHtml(value)}">${escapeHtml(value)} <b aria-hidden="true">×</b></button>`).join("")}</div>`;
}

function refreshMultiSelect(container) {
  const selected = getStructuredSet(container.dataset.filter);
  container.querySelector(".multi-select-toggle span").textContent = selected.size ? `${selected.size}件選択` : "すべて";
  container.querySelectorAll("input[type=checkbox]").forEach(input => { input.checked = selected.has(input.value); });
  const options = container.querySelector(".multi-select-options");
  if (options) [...options.querySelectorAll("label")].filter(label => selected.has(label.querySelector("input").value)).reverse().forEach(label => options.prepend(label));
  container.querySelector(".selected-filter-chips").innerHTML = [...selected].map(value => `<button type="button" data-remove-value="${escapeHtml(value)}">${escapeHtml(value)} <b aria-hidden="true">×</b></button>`).join("");
}

function initializeStructuredSearch() {
  const rows = getAllData();
  populateMultiSelect("tripleFirstSelect", rows.flatMap(item => getTripleClassLabels(item.triple, "s").map(value => ({ tplId: item.triple.tplId, value }))));
  updateTripleDependentOptions();
  populateMultiSelect("stakeholderTypeSelect", rows.flatMap(item => item.stakeholderContexts.map(context => ({ tplId: item.triple.tplId, value: context.typeName || context.className || "未指定" }))));
  updateStakeholderNameOptions();
}

function updateTripleDependentOptions() {
  const first = selectedTripleFirst;
  const rows = !first.size ? getAllData() : getAllData().filter(({ triple }) => [...first].some(term => getTripleClassLabels(triple, "s").some(classLabel => isSameValue(classLabel, term))));
  const relations = rows.map(item => ({ tplId: item.triple.tplId, value: item.triple.pLabel })).filter(item => item.value);
  selectedRelations.forEach(value => { if (!relations.some(candidate => isSameValue(candidate.value, value))) selectedRelations.delete(value); });
  const relationRows = !selectedRelations.size ? rows : rows.filter(({ triple }) => [...selectedRelations].some(term => isSameValue(triple.pLabel, term)));
  const secondClasses = relationRows.flatMap(item => getTripleClassLabels(item.triple, "o").map(value => ({ tplId: item.triple.tplId, value }))).filter(item => item.value);
  selectedTripleSecond.forEach(value => { if (!secondClasses.some(candidate => isSameValue(candidate.value, value))) selectedTripleSecond.delete(value); });
  populateMultiSelect("relationSelect", relations);
  populateMultiSelect("tripleSecondSelect", secondClasses);
}

function updateStakeholderNameOptions() {
  const types = selectedStructuredStakeholderClasses;
  const names = getAllData().flatMap(item => item.stakeholderContexts.filter(context => !types.size || [...types].some(type => isSameValue(context.typeName || context.className || "未指定", type))).map(context => ({ tplId: item.triple.tplId, value: context.name })));
  populateMultiSelect("stakeholderNameSelect", names);
}

function handleStructuredSearchInput(event) {
  const checkbox = event.target.closest(".multi-select input[type=checkbox]");
  if (!checkbox) return;
  const container = checkbox.closest(".multi-select");
  const selected = getStructuredSet(container.dataset.filter);
  checkbox.checked ? selected.add(checkbox.value) : selected.delete(checkbox.value);
  if (container.dataset.filter === "stakeholder-type") { selectedStructuredStakeholderNames.clear(); updateStakeholderNameOptions(); }
  if (container.dataset.filter === "triple-first" || container.dataset.filter === "relation") updateTripleDependentOptions();
  refreshMultiSelect(container); page = 1; renderTable();
}
