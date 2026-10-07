/**
 * 概要一覧で集約されたクラスに対応する詳細トリプルを、モーダルダイアログで表示する。
 * @param {string|number} overviewId 概要一覧のトリプルID
 */
function showDetailCandidates(overviewId) {
  // 概要行と、その行に集約されている元の詳細トリプルを取得する。
  const overview = getAllData().find(data => String(data.triple.tplId) === String(overviewId));
  if (!overview) return;

  const items = getDetailData().filter(item => overview.detailIds.includes(item.triple.tplId));
  const dialog = document.getElementById("detailListDialog");
  const content = dialog.querySelector(".detail-content");
  const { triple } = overview;
  // メインのテーブル表示と同じクラス用の描画関数を使い、色・形・階層を統一する。
  const subjectHtml = `${createIntermediateClassHtml(triple.sTypeLabels || [], "subject")}${createTripleClassHtml(triple.sClassLabels || [], "subject")}`;
  const objectHtml = `${createIntermediateClassHtml(triple.oTypeLabels || [], "object")}${createTripleClassHtml(triple.oClassLabels || [], "object")}`;

  // 発言者タイプごとに氏名をまとめ、同じ意見は Set で重複を除外する。
  const speakers = new Map();
  items.flatMap(item => item.stakeholderContexts).forEach(context => {
    const className = context.typeName || "未指定";
    const name = context.name || "未指定";
    if (!speakers.has(className)) speakers.set(className, new Map());
    const members = speakers.get(className);
    if (!members.has(name)) members.set(name, { className, name, opinions: new Set() });
    context.opinions.forEach(opinion => members.get(name).opinions.add(opinion));
  });
  const speakerCount = [...speakers.values()].reduce((count, members) => count + members.size, 0);

  // タイプ別の発言者と意見を展開可能なリストとして描画する。
  const speakerList = speakerCount
    ? `<div class="class-detail-speaker-groups">${[...speakers.entries()].map(([className, members]) =>
      `<section class="class-detail-speaker-group"><h5 class="speaker-class-header"><span class="speaker-class-tag">${escapeHtml(className)}</span></h5><ul class="class-detail-speaker-list">${[...members.values()].map(({ name, opinions }) =>
        `<li><span class="class-detail-speaker-name">${escapeHtml(name)}</span>${opinions.size ? `<details class="class-detail-opinions"><summary>意見 ${opinions.size}件</summary><ul>${[...opinions].map(opinion => `<li>${escapeHtml(opinion)}</li>`).join("")}</ul></details>` : "<span class=\"class-detail-no-opinion\">意見なし</span>"}</li>`
      ).join("")}</ul></section>`
    ).join("")}</div>`
    : "<p class=\"class-detail-empty\">発言者はありません。</p>";

  // 各詳細トリプルには、本文を開くためのID付きボタンを設定する。
  const detailList = items.length
    ? `<div class="related-triples-list">${items.map(item => {
      const detailTriple = item.triple;
      const detailOpinionCount = new Set(item.stakeholderContexts.flatMap(context => context.opinions)).size;
      const evidenceCount = (item.documentTexts || []).length;
      return `<div class="related-triple-item"><div class="related-triple-body"><span class="detail-candidate-label">No.${escapeHtml(String(detailTriple.tplId))}</span><div class="related-triple-flow">${createTripleInstanceDetailHtml(detailTriple.sLabel)}<div class="triple-relation"><span>―</span><strong>${escapeHtml(detailTriple.pLabel || "未指定")}</strong><span>→</span></div>${createTripleInstanceDetailHtml(detailTriple.oLabel)}</div><div class="detail-candidate-counts">根拠： ${evidenceCount}件・意見 ${detailOpinionCount}件</div></div><button type="button" class="related-triple-btn" data-detail-id="${escapeHtml(detailTriple.tplId)}">本文の詳細</button></div>`;
    }).join("")}</div>`
    : "<p class=\"class-detail-empty\">詳細なトリプルはありません。</p>";

  // 因果構造、発言者、詳細トリプルの順にダイアログ本文を組み立てる。
  content.innerHTML = `
    <section class="class-detail-section">
      <h4>因果構造（トリプル）</h4>
      <div class="class-detail-table-wrap"><table class="result-table class-detail-triple-table"><tbody><tr><td class="table-class-only-cell">${subjectHtml}</td><td class="triple-relation"><span>―</span><strong>${escapeHtml(triple.pLabel || "未指定")}</strong><span>→</span></td><td class="table-class-only-cell">${objectHtml}</td></tr></tbody></table></div>
    </section>
    <section class="class-detail-section">
      <h4>発言者一覧（${speakerCount}件）</h4>
      ${speakerList}
    </section>
    <section class="class-detail-section">
      <h4>詳細なトリプル一覧（${items.length}件）</h4>
      ${detailList}
    </section>`;
  dialog.showModal();
}
