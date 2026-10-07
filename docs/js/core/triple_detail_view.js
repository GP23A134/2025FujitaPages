/**
 * triple_detail_view.js
 * 詳細ダイアログのHTML組み立ておよび動的スタイルの注入を担当
 */

// =================================================================
// ★ 似た話題（関連トリプル）の検索条件設定エリア
// =================================================================
const RELATED_TRIPLES_CONFIG = {
  // --- 判定対象の有効/無効 (true: 判定に使う, false: 無視) ---
  matchSubjectClass: true,      // 主語クラス（sClassLabels）
  matchSubjectInstance: false,  // 主語インスタンス名（sLabel）
  matchPredicate: true,        // 述語（pLabel）
  matchObjectClass: true,      // 目的語クラス（oClassLabels）
  matchObjectInstance: false,  // 目的語インスタンス名（oLabel）

  // --- 比較方法 ---
  // true: 有効にした条件すべてが一致（AND判定）
  // false: 有効にした条件のいずれか1つ以上が一致（OR判定）
  matchBoth: true,

  // --- 比較の柔軟性設定 ---
  fuzzyInstance: false,  // インスタンス名（sLabel/oLabel）の部分一致を許容するか
  fuzzyPredicate: false, // 述語（pLabel）の部分一致を許容するか

  // --- 表示テキスト設定 ---
  sectionTitle: "似た話題",
  sectionSubTitle: "（関連するデータ）",
  noDataText: "該当する似た話題はありません。"
};

// --- 閲覧済みトリプルIDを管理するSet（ダイアログを閉じるとリセット） ---
const visitedTplIds = new Set();

/**
 * ダイアログを閉じる際などに呼び出して閲覧済み状態をリセットする関数
 */
function resetVisitedTriples() {
  visitedTplIds.clear();
}

// --- 1. CSSスタイルの自動注入 ---
(function injectDetailStyles() {
  const styleId = "detail-view-custom-styles";
  if (document.getElementById(styleId)) return;

  const style = document.createElement("style");
  style.id = styleId;
  style.textContent = `
    /* モーダル自体のサイズとスクロール補正 */
    #detailDialog,
    .detail-dialog {
      max-height: 85vh;
      overflow-y: auto;
      padding-bottom: 24px;
      scroll-behavior: auto;
    }

    .detail-dialog-content,
    .detail-content {
      max-height: none;
      overflow: visible;
    }

    /* メイン詳細モーダル用のトリプル表示 */
    .detail-triple-table-style {
      display: flex;
      align-items: center;
      gap: 12px;
      padding: 6px 0;
      flex-wrap: wrap;
    }

    .detail-triple-table-style .triple-entity-box {
      display: flex;
      flex-direction: column;
      gap: 4px;
      max-width: 100%;
    }

    .detail-triple-table-style .triple-class-list {
      display: flex;
      flex-wrap: wrap;
      gap: 4px;
    }

    .detail-triple-table-style .triple-relation {
      display: flex;
      align-items: center;
      gap: 6px;
      font-weight: 600;
      color: #334155;
    }

    /* 発言・意見グループ（クラスごとに横並び配置） */
    .speaker-cards-container {
      display: flex;
      flex-wrap: wrap;
      gap: 12px;
      margin-top: 6px;
    }

    .speaker-group-card {
      background: #f8fafc;
      border: 1px solid #e2e8f0;
      border-radius: 10px;
      padding: 14px 16px;
      flex: 1 1 calc(50% - 12px);
      min-width: 260px;
      box-sizing: border-box;
    }

    .speaker-class-header {
      margin-bottom: 10px;
    }

    .speaker-class-tag {
      display: inline-block;
      background: #f3e8ff;
      color: #6b21a8;
      border: 1px solid #d8b4fe;
      border-radius: 12px;
      padding: 2px 10px;
      font-size: 0.85rem;
      font-weight: 600;
    }

    .speaker-member {
      background: #ffffff;
      border: 1px solid #e2e8f0;
      border-radius: 6px;
      padding: 10px 14px;
      margin-bottom: 8px;
    }

    .speaker-member:last-child {
      margin-bottom: 0;
    }

    .speaker-name {
      display: block;
      font-size: 0.95rem;
      color: #1e293b;
      margin-bottom: 4px;
    }

    .speaker-member ul {
      margin: 4px 0 0 18px;
      padding: 0;
      color: #334155;
    }

    /* 似た話題エリア */
    .related-triples-list {
      display: flex;
      flex-direction: column;
      gap: 12px;
      margin-top: 8px;
    }

    .related-triple-item {
      background: #ffffff;
      border: 1px solid #e2e8f0;
      border-radius: 8px;
      padding: 12px 16px;
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 16px;
      box-sizing: border-box;
      width: 100%;
    }

    .related-triple-body {
      display: flex;
      flex-direction: column;
      gap: 8px;
      flex: 1;
      min-width: 0;
    }

    /* 未閲覧の No. バッジ（通常） */
    .related-triple-no-badge {
      display: inline-block;
      color: #0284c7;
      font-weight: 700;
      font-size: 0.85rem;
      background: #e0f2fe;
      padding: 2px 8px;
      border-radius: 4px;
      width: fit-content;
      transition: background-color 0.2s, color 0.2s;
    }

    /* ★ 閲覧済みの No. バッジスタイル */
    .related-triple-no-badge.visited {
      color: #64748b;
      background: #e2e8f0;
    }

    /* テーブル表示に合わせたグリッド構造 */
    .related-triple-flow {
      display: grid;
      grid-template-columns: minmax(180px, 1fr) auto minmax(180px, 1fr);
      align-items: center;
      gap: 8px 12px;
      padding: 4px 0;
      width: 100%;
    }

    @media (max-width: 640px) {
      .related-triple-flow {
        grid-template-columns: 1fr;
      }
    }

    .related-triple-flow .triple-entity-box {
      display: flex;
      flex-direction: column;
      gap: 4px;
      width: 100%;
      min-width: 0;
    }

    .related-triple-flow .mini-card {
      display: inline-block;
      white-space: normal;
      word-break: break-word;
      line-height: 1.4;
      width: 100%;
      box-sizing: border-box;
    }

    .related-triple-flow .triple-relation {
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 6px;
      font-weight: 600;
      color: #334155;
      white-space: nowrap;
      padding: 0 4px;
    }

    .related-triple-btn {
      background: #0284c7;
      color: #ffffff;
      border: none;
      border-radius: 4px;
      padding: 8px 16px;
      font-size: 0.85rem;
      cursor: pointer;
      white-space: nowrap;
      align-self: center;
      flex-shrink: 0;
      margin-left: auto;
    }

    .related-triple-btn:hover {
      background: #0369a1;
    }

    /* --- アコーディオン用スタイル --- */
    .collapsible-trigger {
      cursor: pointer;
      user-select: none;
      transition: background-color 0.2s ease;
      position: relative;
      border-radius: 6px;
      padding: 4px 8px;
      margin: -4px -8px;
    }

    .collapsible-trigger:hover {
      background-color: #f1f5f9;
    }

    .collapsible-trigger-title {
      display: flex;
      align-items: center;
      justify-content: space-between;
    }

    .collapsible-arrow {
      font-size: 0.8rem;
      color: #64748b;
      transition: transform 0.3s ease;
    }

    .collapsible-trigger.active .collapsible-arrow {
      transform: rotate(180deg);
    }

    .collapsible-content {
      max-height: 0;
      overflow: hidden;
      transition: max-height 0.35s cubic-bezier(0, 1, 0, 1), opacity 0.25s ease, margin 0.25s ease;
      opacity: 0;
      margin-top: 0;
    }

    .collapsible-content.open {
      max-height: 1000px;
      transition: max-height 0.4s cubic-bezier(1, 0, 1, 0), opacity 0.3s ease, margin 0.3s ease;
      opacity: 1;
      margin-top: 8px;
    }

    .source-dropdown-card {
      background: #f8fafc;
      border: 1px solid #cbd5e1;
      border-left: 4px solid #0284c7;
      border-radius: 6px;
      padding: 12px 16px;
    }
  `;
  document.head.appendChild(style);
})();

// --- 2. アコーディオン開閉制御関数 ---
function toggleSourceDropdown(triggerEl) {
  triggerEl.classList.toggle("active");
  const content = triggerEl.nextElementSibling;
  if (content) {
    content.classList.toggle("open");
  }
}

// --- 3. ヘルパー関数 ---

function formatDetailValues(values, emptyText, separator = "<br>") {
  return values.length ? values.map(escapeHtml).join(separator) : emptyText;
}

function createDocumentLinks(urls) {
  if (!urls.length) return "なし";
  return urls
    .map(url => `<a href="${escapeHtml(url)}" target="_blank" rel="noopener">${escapeHtml(url)}</a>`)
    .join("<br>");
}

function createTripleEntityDetailHtml(classLabels, label) {
  const classPills = (classLabels || []).map(classLabel => 
    `<span class="pill pill-blue">${escapeHtml(classLabel)}</span>`
  ).join(" ");
  
  return `
    <div class="triple-entity-box">
      <div class="triple-class-list">${classPills}</div>
      <div class="triple-entity">
        <span class="mini-card">${escapeHtml(label)}</span>
      </div>
    </div>
  `;
}

// 詳細画面の因果構造では、個別の主語・目的語だけを表示する。
function createTripleInstanceDetailHtml(label) {
  return `
    <div class="triple-entity-box">
      <div class="triple-entity">
        <span class="mini-card">${escapeHtml(label)}</span>
      </div>
    </div>
  `;
}

function createSpeakerSection(stakeholderContexts) {
  if (!stakeholderContexts.length) return "";

  const groupedByClass = new Map();
  stakeholderContexts.forEach(context => {
    const className = context.typeName || "発言者タイプ未指定";
    if (!groupedByClass.has(className)) {
      groupedByClass.set(className, []);
    }
    groupedByClass.get(className).push(context);
  });

  const groupHtmlList = [...groupedByClass.entries()].map(([className, contexts]) => {
    const membersHtml = contexts.map(context => {
      const opinions = context.opinions.length
        ? `<ul>${context.opinions.map(opinion => `<li>${escapeHtml(opinion)}</li>`).join("")}</ul>`
        : "";

      return `
        <div class="speaker-member">
          <strong class="speaker-name">${escapeHtml(context.name)}</strong>
          ${opinions}
        </div>
      `;
    }).join("");

    return `
      <div class="speaker-group-card">
        <div class="speaker-class-header">
          <span class="speaker-class-tag">${escapeHtml(className)}</span>
        </div>
        <div class="speaker-group-body">
          ${membersHtml}
        </div>
      </div>
    `;
  }).join("");

  return `
    <section>
      <dt>発言・意見</dt>
      <dd class="speaker-cards-container">${groupHtmlList}</dd>
    </section>
  `;
}

// --- 4. 似た話題（関連トリプル）を検索・生成する関数 ---

function createRelatedTriplesSection(currentItem, customConfig = {}) {
  if (!currentItem || !currentItem.triple) return "";

  // 設定の統合
  const config = { ...RELATED_TRIPLES_CONFIG, ...customConfig };

  const currentTriple = currentItem.triple;
  const currentSClasses = currentTriple.sClassLabels || [];
  const currentSLabel = (currentTriple.sLabel || "").trim();
  const currentPLabel = (currentTriple.pLabel || "").trim();
  const currentOClasses = currentTriple.oClassLabels || [];
  const currentOLabel = (currentTriple.oLabel || "").trim();

  // 個別トリプルを対象に比較し、主語そのものも含めた4条件を正確に判定する。
  const allData = typeof getDetailData === "function" ? getDetailData() : [];

  // 文字列の判定用ヘルパー関数（完全一致 / 部分一致）
  const checkStringMatch = (val1, val2, isFuzzy) => {
    if (!val1 || !val2) return false;
    if (isFuzzy) {
      return val1 === val2 || val1.includes(val2) || val2.includes(val1);
    }
    return val1 === val2;
  };

  // クラス配列（配列同士）の共通要素チェック
  const checkClassArrayMatch = (arr1, arr2) => {
    if (!arr1.length || !arr2.length) return false;
    return arr1.some(c => arr2.includes(c));
  };

  // 1. 条件に合うトリプルを抽出
  const relatedItems = allData.filter(item => {
    if (!item || !item.triple) return false;

    // 自分自身を除外
    if (String(item.triple.tplId) === String(currentTriple.tplId)) return false;

    const itemSClasses = item.triple.sClassLabels || [];
    const itemSLabel = (item.triple.sLabel || "").trim();
    const itemPLabel = (item.triple.pLabel || "").trim();
    const itemOClasses = item.triple.oClassLabels || [];
    const itemOLabel = (item.triple.oLabel || "").trim();

    // アクティブな判定チェック結果を保持する配列
    const matches = [];

    // ① 主語クラスの判定
    if (config.matchSubjectClass) {
      matches.push(checkClassArrayMatch(currentSClasses, itemSClasses));
    }

    // ② 主語インスタンス名の判定
    if (config.matchSubjectInstance) {
      matches.push(checkStringMatch(currentSLabel, itemSLabel, config.fuzzyInstance));
    }

    // ③ 述語の判定
    if (config.matchPredicate) {
      matches.push(checkStringMatch(currentPLabel, itemPLabel, config.fuzzyPredicate));
    }

    // ④ 目的語クラスの判定
    if (config.matchObjectClass) {
      matches.push(checkClassArrayMatch(currentOClasses, itemOClasses));
    }

    // ⑤ 目的語インスタンス名の判定
    if (config.matchObjectInstance) {
      matches.push(checkStringMatch(currentOLabel, itemOLabel, config.fuzzyInstance));
    }

    // 設定項目がひとつも有効化されていない場合は除外
    if (matches.length === 0) return false;

    // AND条件（matchBoth: true）ならすべてtrue、OR条件（false）なら1つ以上件true
    return config.matchBoth 
      ? matches.every(isMatch => isMatch === true)
      : matches.some(isMatch => isMatch === true);
  });

  // 2. 未閲覧(0)が先頭、閲覧済み(1)が末尾になるようにソート
  relatedItems.sort((a, b) => {
    const aVisited = visitedTplIds.has(String(a.triple.tplId)) ? 1 : 0;
    const bVisited = visitedTplIds.has(String(b.triple.tplId)) ? 1 : 0;
    return aVisited - bVisited;
  });

  // タイトルに件数を自動挿入（例：似た話題（3件））
  const sectionTitleWithCount = `${config.sectionTitle}（${relatedItems.length}件）`;
  const sectionTitleHtml = `${escapeHtml(sectionTitleWithCount)}<small style="font-size:0.8rem; font-weight:normal; margin-left:6px; color:#64748b;">${escapeHtml(config.sectionSubTitle)}</small>`;

  if (!relatedItems.length) {
    return `
      <section class="related-triples-section">
        <dt>${sectionTitleHtml}</dt>
        <dd style="color: #94a3b8; font-size: 0.88rem;">${escapeHtml(config.noDataText)}</dd>
      </section>
    `;
  }

  const itemsHtml = relatedItems.map(item => {
    const subjectHtml = createTripleEntityDetailHtml(item.triple.sClassLabels, item.triple.sLabel);
    const objectHtml = createTripleEntityDetailHtml(item.triple.oClassLabels, item.triple.oLabel);
    const itemNo = item.triple.tplId ? item.triple.tplId : "1";
    
    // 閲覧済み判定をしてクラス（visited）を決定
    const isVisited = visitedTplIds.has(String(item.triple.tplId));
    const badgeClass = `related-triple-no-badge ${isVisited ? "visited" : ""}`;

    return `
      <div class="related-triple-item">
        <div class="related-triple-body">
          <span class="${badgeClass}">No.${escapeHtml(String(itemNo))}</span>
          <div class="related-triple-flow">
            ${subjectHtml}
            <div class="triple-relation">
              <span>―</span>
              <strong>${escapeHtml(item.triple.pLabel || "未指定")}</strong>
              <span>→</span>
            </div>
            ${objectHtml}
          </div>
        </div>
        <button type="button" class="related-triple-btn" onclick="showDetails('${escapeHtml(String(item.triple.tplId))}')">
          詳細を見る
        </button>
      </div>
    `;
  }).join("");

  return `
    <section class="related-triples-section">
      <dt>${sectionTitleHtml}</dt>
      <dd class="related-triples-list">${itemsHtml}</dd>
    </section>
  `;
}

// --- 5. メイン描画関数 ---

function createDetailContent(item) {
    const { triple } = item;
    const itemNo = triple.tplId ? triple.tplId : "1";

    // 開いたアイテムの ID を閲覧済みとして記録
    if (triple.tplId !== undefined && triple.tplId !== null) {
      visitedTplIds.add(String(triple.tplId));
    }

    // ヘッダータイトルの設定（例：本文（No.233））
    const headerTitleText = `本文（No.${itemNo}）`;

    // 最上部ヘッダータイトルの更新 ＆ 最上部スクロール処理
    setTimeout(() => {
        const dialog = document.getElementById("detailDialog") || document.querySelector(".detail-dialog");
        if (dialog) {
            dialog.scrollTop = 0;
            
            const headerTitleEl = dialog.querySelector("h2, h3, .dialog-header-title, .modal-title, .dialog-title");
            if (headerTitleEl) {
                headerTitleEl.textContent = headerTitleText;
            }
        }
    }, 0);

    const titles = formatDetailValues(item.documentTitles, "なし");
    const folders = formatDetailValues(item.sourceFolders, "なし");
    const urls = createDocumentLinks(item.documentUrls);
    const prefectures = formatDetailValues(item.prefectures, "なし", "、");
    const body = formatDetailValues(item.documentTexts, "本文データなし", "<br><br>");
    const documentTypes = item.documentTypes.map(escapeHtml).join("、");
    const speakerSection = createSpeakerSection(item.stakeholderContexts);

    // 本文ダイアログでも、個別名に加えて主語・目的語クラスを表示する。
    const subjectHtml = createTripleEntityDetailHtml(triple.sClassLabels, triple.sLabel);
    const objectHtml = createTripleEntityDetailHtml(triple.oClassLabels, triple.oLabel);

    const relatedSection = createRelatedTriplesSection(item);

    return `
        <!-- 都道府県・資料種別 -->
        <div class="detail-meta">
            <div>
                <dt>都道府県</dt>
                <dd>${prefectures}</dd>
            </div>
            <div>
                <dt>資料種別</dt>
                <dd>${documentTypes}</dd>
            </div>
        </div>

        <!-- 資料名（クリックで直下に保存元フォルダ・資料URLを展開） -->
        <section>
            <div class="collapsible-trigger" onclick="toggleSourceDropdown(this)">
                <div class="collapsible-trigger-title">
                    <dt style="margin:0;">資料名</dt>
                    <span class="collapsible-arrow">▼</span>
                </div>
                <dd style="margin:4px 0 0 0;">${titles}</dd>
            </div>
            <div class="collapsible-content">
                <div class="source-dropdown-card">
                    <dt>保存元フォルダ</dt>
                    <dd>${folders}</dd>
                    <dt style="margin-top: 8px;">資料URL</dt>
                    <dd>${urls}</dd>
                </div>
            </div>
        </section>

        <!-- 本文の内容 -->
        <section>
            <dt>本文</dt>
            <dd class="detail-body">${body}</dd>
        </section>

        <!-- 因果構造（トリプル） -->
        <section>
            <dt>因果構造（トリプル）</dt>
            <dd>
                <div class="detail-triple-table-style">
                    ${subjectHtml}
                    <div class="triple-relation">
                        <span>―</span>
                        <strong>${escapeHtml(triple.pLabel || "未指定")}</strong>
                        <span>→</span>
                    </div>
                    ${objectHtml}
                </div>
            </dd>
        </section>

        <!-- 発言・意見 -->
        ${speakerSection}

        <!-- 似た話題 -->
        ${relatedSection}
    `;
}
