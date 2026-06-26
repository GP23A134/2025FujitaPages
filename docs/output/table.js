// tableRenderer.js

// 各ドキュメントセクションごとの現在のページ数、およびユーザーが選択した表示件数を管理するオブジェクト
const _tablePageStore = {};

/**
 * データテーブルの描画、ページネーション制御、およびヘッダークリックでの列一括切り替えを行います。
 * @param {HTMLElement} section - ドキュメントセクションのコンテナ要素
 * @param {string} docId - ドキュメントID
 * @param {string} currentActiveTab - 現在選択されている統計カテゴリ（sClass, oClass等）
 * @param {string} currentTextvalue - メインテキストエリアの現在の文字列値
 */
function updateDataTableDisplay(section, docId, currentActiveTab, currentTextvalue) {
    const table = section.querySelector(`#data-content-table-${docId}`);
    const thead = section.querySelector(`#data-content-table-${docId} thead`);
    const tbody = section.querySelector(`#data-content-tbody-${docId}`);
    if (!tbody || !thead) return;

    // 💡 テーブル本体に確実にCSSクラスを適用する
    if (table) {
        table.className = "data-content-table";
    }

    // ドキュメントごとにユーザーが選択した表示件数を保持（初期値は 10 件）
    if (!_tablePageStore[docId]) {
        _tablePageStore[docId] = {
            currentPage: 1,
            rowsPerPage: 10
        };
    }
    const ROWS_PER_PAGE = _tablePageStore[docId].rowsPerPage;

    // 初期の表示モード判定
    const initSubjectAsClass = (currentActiveTab === "sClass");
    const initObjectAsClass = (currentActiveTab === "oClass");
    
    // 1. ヘッダーの描画（中央揃えスタイルを強制適用）
    thead.innerHTML = `
        <tr>
            <th class="th-id text-center" style="text-align: center !important;">ID</th>
            <th id="th-subject-${docId}" class="th-subject text-center clickable" title="クリックで主語 ↔ 主語クラスを一括切り替え" style="text-align: center !important;">
                ${initSubjectAsClass ? '主語クラス' : '主語'}
            </th>
            <th class="th-predicate text-center" style="text-align: center !important;">述語</th>
            <th id="th-object-${docId}" class="th-object text-center clickable" title="クリックで目的語 ↔ 目的語クラスを一括切り替え" style="text-align: center !important;">
                ${initObjectAsClass ? '目的語クラス' : '目的語'}
            </th>
            <th class="th-stakeholder text-center" style="text-align: center !important;">ステークホルダー</th>
        </tr>
    `;

    // データのパース処理
    const parsedData = parseTableData(currentTextvalue.trim());
    if (!parsedData) {
        tbody.innerHTML = `<tr><td colspan="5" class="table-empty-msg">該当するデータがありません。</td></tr>`;
        removePaginationControls(section, docId);
        return;
    }

    const { stringToSClassMap, stringToOClassMap, idGroupMap, idToOpinionsMap, opinionToStakeholderMap } = parsedData;
    
    // ID（T1, T2...）順にソート
    const sortedIds = Object.keys(idGroupMap).sort((a, b) => {
        return parseInt(a.replace("T", ""), 10) - parseInt(b.replace("T", ""), 10);
    });

    const totalLines = sortedIds.length;
    if (totalLines === 0) {
        tbody.innerHTML = `<tr><td colspan="5" class="table-empty-msg">該当するデータがありません。</td></tr>`;
        removePaginationControls(section, docId);
        return;
    }

    // ページネーションの計算
    const totalPages = Math.ceil(totalLines / ROWS_PER_PAGE);
    if (_tablePageStore[docId].currentPage > totalPages) {
        _tablePageStore[docId].currentPage = 1;
    }
    const currentPage = _tablePageStore[docId].currentPage;

    // 現在のページに対応するデータのみを切り出す
    const startIndex = (currentPage - 1) * ROWS_PER_PAGE;
    const endIndex = Math.min(startIndex + ROWS_PER_PAGE, totalLines);
    const pageIds = sortedIds.slice(startIndex, endIndex);

    // 2. ボディ（データ行）の組み立て（インラインスタイルを排除し、CSSクラスを付与）
    let htmlBuffer = "";
    pageIds.forEach(tId => {
        const group = idGroupMap[tId];
        const rawSub = group.rawSubject || "（未定義）";
        const rawObj = group.rawObject || "（未定義）";
        
        const sClass = stringToSClassMap.get(rawSub) || rawSub;
        const oClass = stringToOClassMap.get(rawObj) || rawObj;
        
        const displayPred = group.predicates.length > 0 ? group.predicates.join(" / ") : "（関係性なし）";

        const initSubText = initSubjectAsClass ? sClass : rawSub;
        const initObjText = initObjectAsClass ? oClass : rawObj;

        // トリプルに紐づく発話者のリストを抽出
        const stakeholderNamesSet = new Set();
        const opinions = idToOpinionsMap.get(tId);
        if (opinions) {
            opinions.forEach(op => {
                const sh = opinionToStakeholderMap.get(op);
                if (sh && sh.trim() !== "") {
                    stakeholderNamesSet.add(sh.trim());
                }
            });
        }
        
        const displayStakeholders = stakeholderNamesSet.size > 0 
            ? Array.from(stakeholderNamesSet).join("<br>") 
            : "—";

        // 動的な初期状態（classかrawか）に合わせて適用するCSSクラスを決定
        const subStatusClass = initSubjectAsClass ? "status-class" : "status-raw";
        const objStatusClass = initObjectAsClass ? "status-class" : "status-raw";

        htmlBuffer += `
            <tr class="data-table-row">
                <td class="cell-id text-center">${tId}</td>
                <td class="toggle-cell subject-cell text-left ${subStatusClass}" 
                    data-raw="${rawSub}" data-class="${sClass}" data-current="${initSubjectAsClass ? 'class' : 'raw'}">${initSubText}</td>
                <td class="cell-predicate text-center">${displayPred}</td>
                <td class="toggle-cell object-cell text-left ${objStatusClass}" 
                    data-raw="${rawObj}" data-class="${oClass}" data-current="${initObjectAsClass ? 'class' : 'raw'}">${initObjText}</td>
                <td class="cell-stakeholder text-left">${displayStakeholders}</td>
            </tr>
        `;
    });

    tbody.innerHTML = htmlBuffer;

    // 3. ページ移動ナビゲーションUIの生成・更新
    renderPaginationControls(section, docId, currentPage, totalPages, startIndex + 1, endIndex, totalLines, ROWS_PER_PAGE, () => {
        updateDataTableDisplay(section, docId, currentActiveTab, currentTextvalue);
    });

    // 4. ヘッダークリックによる列一括切り替えイベントのバインド
    bindHeaderToggleEvents(thead, tbody);
}

/**
 * ページネーションコントロールの生成と配置
 */
function renderPaginationControls(section, docId, currentPage, totalPages, fromIdx, toIdx, totalCount, currentRows, onPageChange) {
    const wrapper = section.querySelector(".table-scroll-wrapper");
    if (!wrapper) return;

    // 確実に下に配置するため、wrapperの親要素にコンテナ用のクラスを適用
    if (wrapper.parentNode && !wrapper.parentNode.classList.contains("table-container-box")) {
        wrapper.parentNode.classList.add("table-container-box");
    }

    // 既存のコントロールがあれば取得、なければ新規作成
    let navContainer = section.querySelector(`.table-pagination-nav-${docId}`);
    if (!navContainer) {
        navContainer = document.createElement("div");
        navContainer.className = `table-pagination-nav-${docId} table-pagination-nav`;
        
        // スクロール領域（wrapper）の直後に追加
        wrapper.parentNode.appendChild(navContainer);
    }

    // 1ページ以下の場合はボタンエリアを隠すクラスを制御
    if (totalPages <= 1) {
        navContainer.classList.add("is-hidden-buttons");
    } else {
        navContainer.classList.remove("is-hidden-buttons");
    }

    navContainer.innerHTML = `
        <div class="nav-info-group">
            <span class="nav-counter">表示中: <b>${fromIdx} - ${toIdx}</b> / 全 <b>${totalCount}</b> 件</span>
            <div class="nav-selector-wrapper">
                表示件数:
                <select class="select-rows-per-page">
                    <option value="10" ${currentRows === 10 ? 'selected' : ''}>10件</option>
                    <option value="20" ${currentRows === 20 ? 'selected' : ''}>20件</option>
                    <option value="50" ${currentRows === 50 ? 'selected' : ''}>50件</option>
                    <option value="100" ${currentRows === 100 ? 'selected' : ''}>100件</option>
                </select>
            </div>
        </div>
        <div class="pagination-buttons-area">
            <button class="btn-page-prev" ${currentPage === 1 ? 'disabled' : ''}>前へ</button>
            <span class="page-indicator">ページ <b>${currentPage}</b> / ${totalPages}</span>
            <button class="btn-page-next" ${currentPage === totalPages ? 'disabled' : ''}>次へ</button>
        </div>
    `;
    
    // 表示件数プルダウンの変更イベント
    navContainer.querySelector(".select-rows-per-page").addEventListener("change", function() {
        const nextRows = parseInt(this.value, 10);
        _tablePageStore[docId].rowsPerPage = nextRows;
        _tablePageStore[docId].currentPage = 1;
        onPageChange();
    });

    // 「前へ」ボタンイベント
    navContainer.querySelector(".btn-page-prev").addEventListener("click", () => {
        if (_tablePageStore[docId].currentPage > 1) {
            _tablePageStore[docId].currentPage--;
            onPageChange();
        }
    });

    // 「次へ」ボタンイベント
    navContainer.querySelector(".btn-page-next").addEventListener("click", () => {
        if (_tablePageStore[docId].currentPage < totalPages) {
            _tablePageStore[docId].currentPage++;
            onPageChange();
        }
    });
}

function removePaginationControls(section, docId) {
    const nav = section.querySelector(`.table-pagination-nav-${docId}`);
    if (nav) nav.remove();
}

/**
 * ヘッダークリックによる列一括切り替えイベントのバインド
 */
function bindHeaderToggleEvents(thead, tbody) {
    const toggleCell = (cell) => {
        const currentStatus = cell.getAttribute("data-current");
        if (currentStatus === "raw") {
            cell.textContent = cell.getAttribute("data-class");
            cell.setAttribute("data-current", "class");
            cell.classList.remove("status-raw");
            cell.classList.add("status-class");
        } else {
            cell.textContent = cell.getAttribute("data-raw");
            cell.setAttribute("data-current", "raw");
            cell.classList.remove("status-class");
            cell.classList.add("status-raw");
        }
    };

    // 主語列トグル
    const subTh = thead.querySelector('[id^="th-subject-"]');
    if (subTh) {
        subTh.replaceWith(subTh.cloneNode(true));
        thead.querySelector('[id^="th-subject-"]').addEventListener("click", function() {
            const cells = tbody.querySelectorAll(".subject-cell");
            if (cells.length === 0) return;
            cells.forEach(toggleCell);
            this.textContent = cells[0].getAttribute("data-current") === "class" ? "主語クラス" : "主語";
        });
    }

    // 目的語列トグル
    const objTh = thead.querySelector('[id^="th-object-"]');
    if (objTh) {
        objTh.replaceWith(objTh.cloneNode(true));
        thead.querySelector('[id^="th-object-"]').addEventListener("click", function() {
            const cells = tbody.querySelectorAll(".object-cell");
            if (cells.length === 0) return;
            cells.forEach(toggleCell);
            this.textContent = cells[0].getAttribute("data-current") === "class" ? "目的語クラス" : "目的語";
        });
    }
}

// 外部呼び出し用にwindowに登録
window.updateDataTableDisplay = updateDataTableDisplay;
