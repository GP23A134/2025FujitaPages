// ------------------------------------------------------------------------
// 5. レンダラー＆相互連動型リストフィルタ（広々サイズ × 初期表示グラフ版）
// ------------------------------------------------------------------------
function createDocumentSection(docId, structuredLines, stats) {
    // 表示できない項目（カウントが0のものなど）をリストから完全に非表示にするかどうかのフラグ
    const HIDE_UNAVAILABLE = false; 

    // 出力先となるメインコンテナを取得
    const container = document.getElementById("outputContainer");
    if (!container) return;
    
    // ------------------------------------------------------------------------
    // 1. 設定・内部状態の定義 (State Manager)
    // ------------------------------------------------------------------------
    const isAllDoc = (docId === "ALL_DOCUMENTS");
    const linesArray = Array.isArray(structuredLines) ? structuredLines : [];

    // 各項目の表示・非表示設定をチェックボックスから取得
    const getChecked = (id) => {
        const el = document.getElementById(id);
        return el ? el.checked : true;
    };
    
    const config = {
        isSubjectEnabled: getChecked("enableSubject"),
        isPredicateEnabled: getChecked("enablePredicate"),
        isObjectEnabled: getChecked("enableObject"),
        isSClassEnabled: getChecked("enableSClass"),
        oClassEnabled: getChecked("enableOClass"),
        isStakeholderEnabled: getChecked("enableStakeholder"),
        isStClassEnabled: getChecked("enableStClass"),
        isOpinionEnabled: getChecked("enableOpinion"),
        isEvidenceEnabled: getChecked("enableEvidence")
    };

    let activeFiltersMap = {};  // 現在アクティブになっているフィルタ状態を管理
    let currentActiveTab = "";  // 現在アクティブなカテゴリタブ
    let network = null;         // グラフのインスタンス保持用

    // DOM要素参照キャッシュ用
    let section, textarea, legendTable, titleEl, noticeEl, statsTable, physicsBtn;
    let tabs = [], panes = [];
    const targetStatElements = {};

    // グラフ描画クラスのインスタンス化
    const viewMap = new ViewMap(function(updatedText) {});

    // ------------------------------------------------------------------------
    // 2. データ整形・クレンジング (Data Engine)
    // ------------------------------------------------------------------------
    const getCleanFullText = () => {
        const cleanLines = [];
        linesArray.forEach(lineObj => {
            const lines = lineObj.text.split("\n");
            lines.forEach(edgeStr => {
                if (!edgeStr) return;
                const columns = edgeStr.split("\t");
                
                // 末尾のインデックスカラムを除外
                columns.pop();
                
                // 一括出力の場合は先頭のドキュメントIDカラムも除外
                if (isAllDoc && columns.length > 0) {
                    columns.shift();
                }
                
                cleanLines.push(columns.join("\t"));
            });
        });
        // 重複行を排除して改行コードで結合
        return Array.from(new Set(cleanLines)).join("\n");
    };

    // ------------------------------------------------------------------------
    // 3. UIテンプレート生成 (UI Renderer)
    // ------------------------------------------------------------------------
    const renderUI = () => {
        section = document.createElement("div");
        section.className = "doc-section";
        
        section.innerHTML = `
        <div class="doc-header">
            <div class="doc-title">${isAllDoc ? '出力モード: 一括出力' : `出力モード: ${docId}`}</div>
        </div>
        
        <div class="doc-main-content">
            <div class="doc-side-panel">
                <div class="doc-meta-badge">
                    <div class="badge-header-row" style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 10px;">
                        <b class="badge-main-title" style="margin: 0;">結果</b>
                        <button class="btn-small btn-clear-filters" style="background-color: #f0f0f0; margin: 0; padding: 4px 8px; font-size: 0.85em;">全てクリア</button>
                    </div>
                    
                    <table class="stats-table">
                        <tr data-row="triple"><td><button class="stats-toggle-btn" data-target="triple" data-label="トリプル"><span class="cat-color-badge" style="background-color:${stats.configColors.triple};"></span>トリプル数</button></td><td class="stat-count-value" data-stat="triple">${stats.tripleCount}</td></tr>
                        <tr data-row="subject" style="display: ${config.isSubjectEnabled ? 'table-row' : 'none'};"><td><button class="stats-toggle-btn" data-target="subject" data-label="主語"><span class="cat-color-badge" style="background-color:${stats.configColors.subject};"></span>主語数</button></td><td class="stat-count-value" data-stat="subject">${stats.subjectCount}</td></tr>
                        <tr data-row="p" style="display: ${config.isPredicateEnabled ? 'table-row' : 'none'};"><td><button class="stats-toggle-btn" data-target="p" data-label="述語"><span class="cat-color-badge" style="background-color:${stats.configColors.p || '#ff9800'};"></span>述語数</button></td><td class="stat-count-value" data-stat="p">${stats.pCount || 0}</td></tr>
                        <tr data-row="object" style="display: ${config.isObjectEnabled ? 'table-row' : 'none'};"><td><button class="stats-toggle-btn" data-target="object" data-label="目的語"><span class="cat-color-badge" style="background-color:${stats.configColors.object};"></span>目的語数</button></td><td class="stat-count-value" data-stat="object">${stats.objectCount}</td></tr>
                        <tr data-row="sClass" style="display: ${config.isSClassEnabled ? 'table-row' : 'none'};"><td><button class="stats-toggle-btn" data-target="sClass" data-label="主語クラス"><span class="cat-color-badge" style="background-color:${stats.configColors.sClass};"></span>主語クラス数</button></td><td class="stat-count-value" data-stat="sClass">${stats.sClassCount}</td></tr>
                        <tr data-row="oClass" style="display: ${config.oClassEnabled ? 'table-row' : 'none'};"><td><button class="stats-toggle-btn" data-target="oClass" data-label="目的語クラス"><span class="cat-color-badge" style="background-color:${stats.configColors.oClass};"></span>目的語クラス数</button></td><td class="stat-count-value" data-stat="oClass">${stats.oClassCount}</td></tr>
                        <tr data-row="stakeholder" style="display: ${config.isStakeholderEnabled ? 'table-row' : 'none'};"><td><button class="stats-toggle-btn" data-target="stakeholder" data-label="ステークホルダー"><span class="cat-color-badge" style="background-color:${stats.configColors.stakeholder};"></span>ステークホルダー数</button></td><td class="stat-count-value" data-stat="stakeholder">${stats.stakeholderCount}</td></tr>
                        <tr data-row="stClass" style="display: ${config.isStClassEnabled ? 'table-row' : 'none'};"><td><button class="stats-toggle-btn" data-target="stClass" data-label="ステークホルダークラス"><span class="cat-color-badge" style="background-color:${stats.configColors.stClass || '#e0e0e0'};"></span>発話者クラス数</button></td><td class="stat-count-value" data-stat="stClass">${stats.stClassCount || 0}</td></tr>
                        <tr data-row="opinion" style="display: ${config.isOpinionEnabled ? 'table-row' : 'none'};"><td><button class="stats-toggle-btn" data-target="opinion" data-label="意見"><span class="cat-color-badge" style="background-color:${stats.configColors.opinion};"></span>意見数</button></td><td class="stat-count-value" data-stat="opinion">${stats.opinionCount}</td></tr>
                        <tr data-row="evidence" style="display: ${config.isEvidenceEnabled ? 'table-row' : 'none'};"><td><button class="stats-toggle-btn" data-target="evidence" data-label="根拠"><span class="cat-color-badge" style="background-color:${stats.configColors.evidence};"></span>根拠数</button></td><td class="stat-count-value" data-stat="evidence">${stats.evidenceCount}</td></tr>
                    </table>
                    
                    <hr class="badge-divider">
                    
                    <div class="legend-header-row" style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 5px;">
                        <b id="legend-current-title-${docId}" class="badge-sub-title" style="margin: 0;">一覧</b>
                        <button type="button" id="btn-clear-from-list-${docId}" class="btn-clear-from-list" style="padding: 4px 8px; background-color: #f8f9fa; color: #6c757d; border: 1px solid #ced4da; border-radius: 4px; cursor: pointer; font-size: 0.85em; transition: all 0.2s; margin: 0;" onmouseover="this.style.backgroundColor='#e2e6ea'; this.style.color='#343a40';" onmouseout="this.style.backgroundColor='#f8f9fa'; this.style.color='#6c757d';">
                            選択解除
                        </button>
                    </div>

                    <span id="legend-notice-${docId}" class="legend-notice" style="font-size:0.8em; color:#2196F3; display:block; margin-bottom:8px; font-weight:bold;"></span>
                    <div class="legend-scroll-container">
                        <table id="dynamic-legend-table-${docId}" class="dynamic-legend-table"></table>
                    </div>
                </div>
            </div>
            
            <div class="doc-text-panel" style="display: flex; flex-direction: column; height: 850px; box-sizing: border-box;">
                <div class="doc-tabs-bar" style="margin-bottom: 15px; flex-shrink: 0;">
                    <button class="doc-panel-tab active" data-tab="diagram">図・グラフ表示</button>
                    <button class="doc-panel-tab" data-tab="table">テーブル表示</button> 
                    <button class="doc-panel-tab" data-tab="text">テキスト表示</button>
                </div>
                
                <div class="doc-tabs-content" style="flex-grow: 1; height: 0; position: relative; background-color: #ffffff; display: flex; flex-direction: column;">
                    
                    <div class="tab-pane pane-text" data-content="text" style="display: none !important; flex-direction: column !important; justify-content: flex-start !important; align-items: stretch !important; height: 100% !important; box-sizing: border-box !important;">
                        <div class="pane-action-row" style="display: flex !important; justify-content: flex-end !important; width: 100% !important; margin-bottom: 12px !important; flex-shrink: 0 !important; box-sizing: border-box !important;">
                            <button class="btn-small btn-copy-small" style="cursor: pointer;">このデータをコピー</button>
                        </div>
                        <textarea id="main-textarea-${docId}" class="textarea" style="display: block !important; width: 100% !important; flex: 1 1 0% !important; min-height: 0 !important; box-sizing: border-box !important; resize: none; margin: 0;" readonly></textarea>
                    </div>

                    <div class="tab-pane pane-diagram active" data-content="diagram" style="width: 100%; height: 100%; display: flex; flex-direction: column;">
                        <div class="diagram-container" style="display: flex; flex-direction: column; height: 100%; width: 100%;">
                            <div class="control-actions-bar" style="display: flex; justify-content: flex-start; width: 100%; margin-bottom: 12px; flex-shrink: 0;">
                                <button id="physicsBtn-${docId}" data-on="true" class="btn-small btn-physics" style="margin: 0; background-color: #2196F3; color: white;">自動レイアウト：ON</button>
                            </div>
                            <div class="map_box" style="position: relative; width: 100%; flex-grow: 1; height: 0; margin: 0;">
                                <div id="mynetwork-${docId}" class="network-canvas" style="position: absolute; top: 0; left: 0; width: 100%; height: 100%; contain: strict; will-change: transform;"></div>
                                <input id="editBox-${docId}" type="text" class="network-edit-box" style="position: absolute; text-align: center; display: none; z-index: 1000; outline: none; padding: 2px;" />
                                <input id="colorPicker-${docId}" type="color" class="network-color-picker" style="position: absolute; display: none; z-index: 101;" />
                                <div id="colorPreset-${docId}" class="network-color-preset" style="position: absolute; display: none; z-index: 1002; background: #ffffff; border: 1px solid #cccccc; padding: 4px;"></div>
                            </div>
                        </div>
                    </div>

                    <div class="tab-pane pane-table" data-content="table" style="display: none; width: 100%; height: 100%; padding: 0px; box-sizing: border-box; overflow: hidden;">
                        <div class="table-scroll-wrapper" style="height: 100%; overflow-y: auto; overflow-x: hidden; border: 1px solid #e0e0e0; border-radius: 4px; width: 100%;">
                            <table id="data-content-table-${docId}" class="data-content-table" style="width: 100%; border-collapse: collapse; font-size: 0.9em; text-align: left; table-layout: fixed; margin: 0 auto;">
                                <thead style="background-color: #f5f5f5; position: sticky; top: 0; z-index: 10; box-shadow: 0 1px 0 #e0e0e0;">
                                    <tr>
                                        <th style="padding: 10px; border-bottom: 2px solid #e0e0e0; width: 7%; text-align: center;">ID</th>
                                        <th style="padding: 10px; border-bottom: 2px solid #e0e0e0; width: 35% text-align: center;">主語</th>
                                        <th style="padding: 10px; border-bottom: 2px solid #e0e0e0; width: 12%; text-align: center;">述語</th>
                                        <th style="padding: 10px; border-bottom: 2px solid #e0e0e0; width: 35% text-align: center;">目的語</th>
                                        <th style="padding: 10px; border-bottom: 2px solid #e0e0e0; width: 11%; text-align: center;">ステークホルダー数</th>
                                    </tr>
                                </thead>
                                <tbody id="data-content-tbody-${docId}"></tbody>
                            </table>
                        </div>
                    </div>
                    
                </div>
            </div>
        </div>`;

        // 親コンテナへ追加
        container.appendChild(section);

        // キャッシュ用のDOM参照を取得
        textarea = section.querySelector(`#main-textarea-${docId}`);
        legendTable = document.getElementById(`dynamic-legend-table-${docId}`);
        titleEl = document.getElementById(`legend-current-title-${docId}`);
        noticeEl = document.getElementById(`legend-notice-${docId}`);
        statsTable = section.querySelector(".stats-table");
        physicsBtn = section.querySelector(`#physicsBtn-${docId}`);
        tabs = section.querySelectorAll(".doc-panel-tab");
        panes = section.querySelectorAll(".tab-pane");

        // 統計数値セルのキャッシュ
        if (statsTable) {
            statsTable.querySelectorAll(".stat-count-value").forEach(td => {
                const statKey = td.getAttribute("data-stat");
                if (statKey) targetStatElements[statKey] = td;
            });
        }

        // 初期テキストをセット
        textarea.value = getCleanFullText();
    };

    // ------------------------------------------------------------------------
    // 4. フィルタ＆表示更新ロジック (Filter & Sync Logic)
    // ------------------------------------------------------------------------
    
    // サイドバー下部の凡例一覧テーブルを再描画する関数
    const updateLegendTable = (targetKey) => {
        currentActiveTab = targetKey;
        const currentList = stats.lists[targetKey] || [];
        const activeLabels = Object.keys(activeFiltersMap);

        let globalIntersectionSet = null;
        if (activeLabels.length > 0) {
            activeLabels.forEach(label => {
                const indexes = activeFiltersMap[label].bindingIndexes || [];
                if (globalIntersectionSet === null) {
                    globalIntersectionSet = new Set(indexes);
                } else {
                    const nextInt = new Set();
                    indexes.forEach(idx => {
                        if (globalIntersectionSet.has(idx)) nextInt.add(idx);
                    });
                    globalIntersectionSet = nextInt;
                }
            });
        }

        const processedList = currentList.map(item => {
            let displayCount = item.count;
            if (activeLabels.length > 0) {
                if (globalIntersectionSet && globalIntersectionSet.size > 0) {
                    let matchCount = 0;
                    item.bindingIndexes.forEach(idx => {
                        if (globalIntersectionSet.has(idx)) matchCount++;
                    });
                    displayCount = matchCount;
                } else {
                    displayCount = 0;
                }
            }
            let resolvedColor = item.color || null;
            if (targetKey === "triple") {
                resolvedColor = stats.configColors.triple;
            } else if (!resolvedColor && item.name) {
                const matchedLine = linesArray.find(line => line.text.includes(item.name));
                if (matchedLine) {
                    const parts = matchedLine.text.split("\t");
                    const foundColor = parts.find(p => /^#[0-9a-fA-F]{6}$/.test(p.trim()));
                    if (foundColor) resolvedColor = foundColor.trim();
                }
            }
            return {
                ...item,
                color: resolvedColor, 
                displayCount: displayCount,
                isSelected: !!activeFiltersMap[item.name]
            };
        });

        processedList.sort((a, b) => {
            if (a.isSelected !== b.isSelected) return a.isSelected ? -1 : 1;
            const aAvailable = a.displayCount > 0;
            const bAvailable = b.displayCount > 0;
            if (aAvailable !== bAvailable) return aAvailable ? -1 : 1;
            return b.displayCount - a.displayCount;
        });

        if (!legendTable) return;

        legendTable.innerHTML = processedList.map((item, index) => {
            const useRedColor = (activeLabels.length > 0 && !item.isSelected);
            const countStyle = useRedColor 
                ? 'color: #d32f2f; margin-left: 4px; font-weight: bold;' 
                : 'color: #666666; margin-left: 4px;';
            const activeClass = item.isSelected ? 'filter-active' : '';

            return `
                <tr class="filter-trigger-row ${activeClass}" data-index="${index}" data-value="${item.name}" style="cursor:pointer; transition: background 0.2s; ${item.isSelected ? 'background-color: #cce5ff; border-left: 4px solid #004085;' : ''}">
                    <td style="padding:6px 10px; border-bottom:1px dashed #eee; vertical-align:middle;">
                        ${item.color ? `<span style="background-color:${item.color}; display:inline-block; width:12px; height:12px; border-radius:3px; margin-right:8px; vertical-align:middle; box-shadow: inset 0 0 0 1px rgba(0,0,0,0.1);"></span>` : ''}
                        <span style="vertical-align:middle; ${item.isSelected ? 'font-weight: bold; color: #004085;' : ''}">
                            ${item.isSelected ? '✓ ' : ''}${item.name} 
                            <span class="legend-item-count" style="${countStyle}">(${item.displayCount}件)</span>
                        </span>
                    </td>
                </tr>
            `;
        }).join('');

        const rows = legendTable.querySelectorAll(".filter-trigger-row");
        rows.forEach(row => {
            const idx = parseInt(row.getAttribute("data-index"), 10);
            const item = processedList[idx];
            if (!item) return;

            const isAvailable = (item.displayCount > 0);
            const shouldShow = item.isSelected || isAvailable; 

            if (shouldShow) {
                row.style.display = ""; 
                row.style.opacity = "1";
                row.style.pointerEvents = "auto";
            } else {
                if (HIDE_UNAVAILABLE) {
                    row.style.display = "none"; 
                } else {
                    row.style.display = "";     
                    row.style.opacity = "0.25"; 
                    row.style.pointerEvents = "none"; 
                }
            }

            row.addEventListener("click", () => {
                const clickedValue = row.getAttribute("data-value");
                if (activeFiltersMap[clickedValue]) {
                    delete activeFiltersMap[clickedValue]; 
                } else {
                    const originalItem = currentList.find(c => c.name === clickedValue);
                    activeFiltersMap[clickedValue] = { 
                        ...originalItem, 
                        color: item.color, 
                        category: currentActiveTab 
                    }; 
                }
                updateTextareaDisplay();      
                updateLegendTable(currentActiveTab); 
                updateTabVisualIndicators();  
            });
        });
    };

    // テーブルデータを更新する関数（ステークホルダー数を右端に配置）
    const updateDataTableDisplay = () => {
        const thead = section.querySelector(`#data-content-table-${docId} thead`);
        const tbody = section.querySelector(`#data-content-tbody-${docId}`);
        if (!tbody || !thead) return;

        // 現在どの統計カテゴリが選ばれているかの初期状態
        const isSubjectClassMode = (currentActiveTab === "subject");
        const isObjectClassMode = (currentActiveTab === "object");
        
        // テーブル自体のスタイルを中央揃え・最大幅に設定
        const tableEl = section.querySelector(`#data-content-table-${docId}`);
        if (tableEl) {
            tableEl.style.width = "100%";
            tableEl.style.margin = "0 auto";
            tableEl.style.borderCollapse = "collapse";
        }
        
        // 1. ヘッダーを生成（ステークホルダー数を一番右端に配置）
        thead.innerHTML = `
            <tr>
                <th style="padding: 10px; border-bottom: 2px solid #e0e0e0; width: 7%; text-align: center;">ID</th>
                <th style="padding: 10px; border-bottom: 2px solid #e0e0e0; width: 35%;  text-align: center; cursor: help;" title="セルをクリックすると詳細/クラスを切り替え">
                    ${isSubjectClassMode ? '主語クラス' : '主語'}
                </th>
                <th style="padding: 10px; border-bottom: 2px solid #e0e0e0; width: 12%; text-align: center;">述語 (Predicate)</th>
                <th style="padding: 10px; border-bottom: 2px solid #e0e0e0; width: 35%;  text-align: center; cursor: help;" title="セルをクリックすると詳細/クラスを切り替え">
                    ${isObjectClassMode ? '目的語クラス' : '目的語'}
                </th>
                <th style="padding: 10px; border-bottom: 2px solid #e0e0e0; width: 11%; text-align: center;">ステークホルダー数</th>
            </tr>
        `;

        tbody.innerHTML = "";
        const currentText = textarea.value.trim();

        if (!currentText) {
            tbody.innerHTML = `<tr><td colspan="5" style="padding: 20px; text-align: center; color: #999;">該当するデータがありません。</td></tr>`;
            return;
        }

        const lines = currentText.split("\n");
        
        // --- データの収集フェーズ ---
        const stringToSClassMap = new Map(); 
        const stringToOClassMap = new Map(); 
        const idGroupMap = {}; 
        
        const idToOpinionsMap = new Map(); 
        const opinionToStakeholderMap = new Map(); 

        // 1次パース：クラス定義（sClass/oClass）および発話者マッピングの収集
        lines.forEach(lineStr => {
            if (!lineStr.trim()) return;
            const columns = lineStr.split("\t");
            if (columns.length < 3) return;
            const col0 = columns[0].trim();
            const col1 = columns[1].trim();
            const col2 = columns[2].trim();

            if (!/^T\d+$/.test(col0)) {
                if (col1 === "sClass") stringToSClassMap.set(col0, col2);
                if (col1 === "oClass") stringToOClassMap.set(col0, col2);
                if (col1 === "発話者") {
                    opinionToStakeholderMap.set(col0, col2);
                }
            }
        });

        // 2次パース：T番号に紐づく主語・目的語、および「意見」の収集
        lines.forEach(lineStr => {
            if (!lineStr.trim()) return;
            const columns = lineStr.split("\t");
            if (columns.length < 3) return;
            const col0 = columns[0].trim();
            const col1 = columns[1].trim();
            const col2 = columns[2].trim();

            if (/^T\d+$/.test(col0)) {
                if (!idGroupMap[col0]) {
                    idGroupMap[col0] = { rawSubject: "", rawObject: "", predicates: [] };
                }
                if (col1 === "主語") idGroupMap[col0].rawSubject = col2;
                if (col1 === "目的語") idGroupMap[col0].rawObject = col2;
                
                if (col1 === "意見") {
                    if (!idToOpinionsMap.has(col0)) {
                        idToOpinionsMap.set(col0, new Set());
                    }
                    idToOpinionsMap.get(col0).add(col2);
                }
            }
        });

        // 3次パース：純粋な関係性（述語）を収集
        lines.forEach(lineStr => {
            if (!lineStr.trim()) return;
            const columns = lineStr.split("\t");
            if (columns.length < 3) return;
            const subStr = columns[0].trim();
            const predStr = columns[1].trim();
            const objStr = columns[2].trim();

            if (/^T\d+$/.test(subStr) || predStr === "sClass" || predStr === "oClass" || predStr === "-" || predStr === "意見" || predStr === "発話者") {
                return;
            }

            Object.keys(idGroupMap).forEach(tId => {
                const group = idGroupMap[tId];
                const isMatchSubject = (group.rawSubject === subStr);
                const isMatchObject = (group.rawObject === objStr);

                if (isMatchSubject && isMatchObject) {
                    if (!group.predicates.includes(predStr)) {
                        group.predicates.push(predStr);
                    }
                }
            });
        });

        // --- HTML出力の組み立てフェーズ ---
        const sortedIds = Object.keys(idGroupMap).sort((a, b) => {
            return parseInt(a.replace("T", ""), 10) - parseInt(b.replace("T", ""), 10);
        });

        let htmlBuffer = "";
        sortedIds.forEach(tId => {
            const group = idGroupMap[tId];
            const rawSub = group.rawSubject || "（未定義）";
            const rawObj = group.rawObject || "（未定義）";
            const sClass = stringToSClassMap.get(rawSub) || rawSub;
            const oClass = stringToOClassMap.get(rawObj) || rawObj;
            
            const displayPred = group.predicates.length > 0 ? group.predicates.join(" / ") : "（関係性なし）";

            const initSubText = isSubjectClassMode ? sClass : rawSub;
            const initObjText = isObjectClassMode ? oClass : rawObj;

            // ステークホルダー数の計算
            const shSet = new Set();
            const opinions = idToOpinionsMap.get(tId);
            if (opinions) {
                opinions.forEach(op => {
                    const sh = opinionToStakeholderMap.get(op);
                    if (sh) shSet.add(sh);
                });
            }
            const stakeholderCount = shSet.size;

            // HTMLの出力順序を入れ替え（ステークホルダー数を一番最後（右側）のtdに）
            htmlBuffer += `
                <tr style="border-bottom: 1px solid #eee; transition: background 0.1s;" onmouseover="this.style.backgroundColor='#f9f9f9'" onmouseout="this.style.backgroundColor='transparent'">
                    <td style="padding: 10px; font-weight: bold; color: #004085; width: 7%; font-size: 0.95em; text-align: center;">${tId}</td>
                    <td class="toggle-cell subject-cell" 
                        style="padding: 10px; word-break: break-all; width: 35%;  text-align: center; cursor: pointer; transition: color 0.2s;"
                        data-raw="${rawSub}" 
                        data-class="${sClass}"
                        data-current="${isSubjectClassMode ? 'class' : 'raw'}"
                        onmouseover="this.style.color='#0056b3'; this.style.textDecoration='underline';"
                        onmouseout="this.style.color=''; this.style.textDecoration='';"
                    >${initSubText}</td>
                    <td style="padding: 10px; color: #333; font-weight: 500; width: 12%; font-size: 0.95em; text-align: center;">${displayPred}</td>
                    <td class="toggle-cell object-cell" 
                        style="padding: 10px; word-break: break-all; width: 35%;  text-align: center; cursor: pointer; transition: color 0.2s;"
                        data-raw="${rawObj}" 
                        data-class="${oClass}"
                        data-current="${isObjectClassMode ? 'class' : 'raw'}"
                        onmouseover="this.style.color='#0056b3'; this.style.textDecoration='underline';"
                        onmouseout="this.style.color=''; this.style.textDecoration='';"
                    >${initObjText}</td>
                    <td style="padding: 10px; color: #495057; font-weight: bold; width: 11%; font-size: 0.95em; text-align: center;">${stakeholderCount}</td>
                </tr>
            `;
        });

        tbody.innerHTML = htmlBuffer === "" 
            ? `<tr><td colspan="5" style="padding: 20px; text-align: center; color: #999;">該当するデータがありません。</td></tr>` 
            : htmlBuffer;

        // --- 4. クリックイベントのバインド（個別トグル処理） ---
        tbody.querySelectorAll(".toggle-cell").forEach(cell => {
            cell.addEventListener("click", (e) => {
                e.stopPropagation();
                
                const currentStatus = cell.getAttribute("data-current");
                const rawVal = cell.getAttribute("data-raw");
                const classVal = cell.getAttribute("data-class");

                if (currentStatus === "raw") {
                    cell.textContent = classVal;
                    cell.setAttribute("data-current", "class");
                    cell.style.fontWeight = "600";
                } else {
                    cell.textContent = rawVal;
                    cell.setAttribute("data-current", "raw");
                    cell.style.fontWeight = "normal";
                }
            });
        });
    };
    // グラフ描画・同期共通関数
    const syncGraphWithCurrentText = () => {
        const diagramTab = section.querySelector(".doc-panel-tab[data-tab='diagram']");
        if (diagramTab && diagramTab.classList.contains("active")) {
            const currentText = textarea.value.trim();
            if (currentText !== "") {
                viewMap.setData(currentText);
                viewMap.showMap(
                    `mynetwork-${docId}`, 
                    function (updatedText) {
                        textarea.value = updatedText;
                        updateDataTableDisplay(); 
                    },
                    function (net) {
                        network = net;
                        network.setOptions({
                            physics: {
                                enabled: true,
                                stabilization: { iterations: 1000 }
                            }
                        });
                        network.once("stabilizationIterationsDone", function () {
                            network.setOptions({
                                physics: { enabled: false }
                            });
                            if (physicsBtn) {
                                physicsBtn.innerText = "自動レイアウト：OFF";
                                physicsBtn.setAttribute("data-on", "false");
                                physicsBtn.style.backgroundColor = "#6c757d"; 
                            }
                        });
                    }
                );
            } else {
                if (typeof viewMap.clear === "function") {
                    viewMap.clear();
                } else if (network) {
                    network.setData({ nodes: [], edges: [] });
                }
            }
        }
    };

    // 選択されたフィルタに基づいてテキストエリア表示を更新する関数
    const updateTextareaDisplay = () => {
        const activeLabels = Object.keys(activeFiltersMap); 
        
        if (activeLabels.length === 0) {
            textarea.value = getCleanFullText();
            syncGraphWithCurrentText();
            updateDataTableDisplay(); 
            return;
        }

        let allowedIndexesSet = null;
        activeLabels.forEach(label => {
            const itemIndexes = activeFiltersMap[label].bindingIndexes || [];
            const currentIndexesSet = new Set(itemIndexes);

            if (allowedIndexesSet === null) {
                allowedIndexesSet = new Set(currentIndexesSet);
            } else {
                const nextIntersection = new Set();
                for (let idx of allowedIndexesSet) {
                    if (currentIndexesSet.has(idx)) {
                        nextIntersection.add(idx);
                    }
                }
                allowedIndexesSet = nextIntersection;
            }
        });

        if (!allowedIndexesSet || allowedIndexesSet.size === 0) {
            textarea.value = "";
            syncGraphWithCurrentText();
            updateDataTableDisplay(); 
            return;
        }

        const filteredLines = [];
        linesArray.forEach(lineObj => {
            const edges = lineObj.text.split("\n");
            edges.forEach(edgeStr => {
                if (!edgeStr) return;
                const columns = edgeStr.split("\t");
                const edgeLineIdx = parseInt(columns[columns.length - 1], 10);

                if (allowedIndexesSet.has(edgeLineIdx)) {
                    columns.pop(); 

                    if (isAllDoc && columns.length > 0) {
                        columns.shift(); 
                    }
                    filteredLines.push(columns.join("\t"));
                }
            });
        });

        textarea.value = Array.from(new Set(filteredLines)).join("\n");
        syncGraphWithCurrentText();
        updateDataTableDisplay(); 
    };

    // 選択状態に応じて左側の数値バッジや色表示を動的に書き換える関数
    const updateTabVisualIndicators = () => {
        const activeLabels = Object.keys(activeFiltersMap);
        let visibleTrCount = 0;
        const countedTrIds = new Set();

        if (textarea.value) {
            const currentEdges = textarea.value.split("\n");
            currentEdges.forEach(edgeStr => {
                if (!edgeStr) return;
                const columns = edgeStr.split("\t");
                columns.forEach(col => {
                    if (/^T\d+$/.test(col.trim())) countedTrIds.add(col.trim());
                });
            });
            visibleTrCount = countedTrIds.size;
        }

        if (!statsTable) return;

        statsTable.querySelectorAll(".stats-toggle-btn").forEach(btn => {
            const targetKey = btn.getAttribute("data-target");
            if (!targetKey) return;
            
            const activeCount = Object.values(activeFiltersMap).filter(item => item.category === targetKey).length;
            const oldBadge = btn.querySelector(".tab-badge");
            if (oldBadge) oldBadge.remove();

            if (activeCount > 0) {
                const badge = document.createElement("span");
                badge.className = "tab-badge";
                badge.textContent = `${activeCount}`;
                btn.appendChild(badge);
            }

            const targetTd = targetStatElements[targetKey];
            if (targetTd) {
                const currentList = stats.lists[targetKey] || [];
                if (activeLabels.length === 0) {
                    const defaultCountKey = `${targetKey}Count`;
                    targetTd.textContent = stats[defaultCountKey] !== undefined ? stats[defaultCountKey] : 0;
                    targetTd.style.color = "#333333"; 
                } else {
                    if (targetKey === "triple") {
                        targetTd.textContent = visibleTrCount;
                    } else {
                        let availableUniqueCount = 0;
                        let matchedIndexes = null;
                        activeLabels.forEach(label => {
                            const arr = activeFiltersMap[label].bindingIndexes || [];
                            if (matchedIndexes === null) matchedIndexes = new Set(arr);
                            else {
                                const nextInt = new Set();
                                arr.forEach(id => { if (matchedIndexes.has(id)) nextInt.add(id); });
                                matchedIndexes = nextInt;
                            }
                        });

                        currentList.forEach(item => {
                            const isSelected = !!activeFiltersMap[item.name];
                            const hasOverlap = item.bindingIndexes.some(idx => matchedIndexes && matchedIndexes.has(idx));
                            if (isSelected || hasOverlap) {
                                availableUniqueCount++;
                            }
                        });
                        targetTd.textContent = availableUniqueCount;
                    }
                    targetTd.style.color = "#d32f2f"; 
                }
            }
        });
    };

    // ------------------------------------------------------------------------
    // 5. ビュー制御・イベントハンドリング (View Controller)
    // ------------------------------------------------------------------------
    const bindEvents = () => {
        // 1. コピーボタンの挙動
        const copyBtn = section.querySelector(".btn-copy-small");
        if (copyBtn) {
            copyBtn.addEventListener("click", () => {
                navigator.clipboard.writeText(textarea.value).then(() => {
                    const origText = copyBtn.innerText;
                    copyBtn.innerText = "コピーしました！";
                    copyBtn.style.backgroundColor = "#28a745";
                    copyBtn.style.color = "#ffffff";
                    setTimeout(() => {
                        copyBtn.innerText = origText;
                        copyBtn.style.backgroundColor = "";
                        copyBtn.style.color = "";
                    }, 1500);
                });
            });
        }

        // 2. 凡例テーブルへのダブルクリック（同一カテゴリフィルタの一括解除）
        if (legendTable) {
            legendTable.addEventListener("dblclick", (e) => {
                e.stopPropagation();
                let hasChanged = false;
                Object.keys(activeFiltersMap).forEach(label => {
                    if (activeFiltersMap[label].category === currentActiveTab) {
                        delete activeFiltersMap[label];
                        hasChanged = true;
                    }
                });
                if (hasChanged) {
                    updateTextareaDisplay();
                    updateLegendTable(currentActiveTab);
                    updateTabVisualIndicators();
                }
            });
        }

        // 3. 統計カテゴリの切り替え・クリックイベント処理
        if (statsTable) {
            statsTable.addEventListener("click", (e) => {
                const btn = e.target.closest(".stats-toggle-btn");
                if (!btn) return;

                const targetKey = btn.getAttribute("data-target");
                const parentRow = btn.closest("tr");
                const isHiddenOrDisabled = parentRow && (parentRow.style.display === "none" || btn.disabled);

                if (isHiddenOrDisabled) {
                    Object.keys(activeFiltersMap).forEach(label => {
                        if (activeFiltersMap[label].category === targetKey) {
                            delete activeFiltersMap[label];
                        }
                    });

                    const defaultBtn = statsTable.querySelector('.stats-toggle-btn[data-target="triple"]');
                    if (defaultBtn) {
                        defaultBtn.click();
                    }
                    return;
                }

                statsTable.querySelectorAll(".stats-toggle-btn").forEach(b => b.classList.remove("active"));
                btn.classList.add("active");

                const labelText = btn.getAttribute("data-label") || ""; 

                if (titleEl) titleEl.textContent = `${labelText}一覧`;
                if (noticeEl) noticeEl.textContent = "";

                updateLegendTable(targetKey);
                updateTabVisualIndicators();
            });
        }

        // 4. 全フィルタクリアボタン
        const clearBtn = section.querySelector(".btn-clear-filters");
        if (clearBtn) {
            clearBtn.addEventListener("click", () => {
                activeFiltersMap = {}; 
                updateTextareaDisplay(); 
                updateLegendTable(currentActiveTab);
                updateTabVisualIndicators();
            });
        }

        // 5. 一覧（選択中カテゴリ）の隣にある選択解除ボタン（部分解除に変更）
        const listClearBtn = section.querySelector(`#btn-clear-from-list-${docId}`);
        if (listClearBtn && statsTable) {
            listClearBtn.addEventListener("click", () => {
                // 1. 現在のカテゴリ(state.currentActiveTab)に属するフィルタだけを削除する
                Object.keys(state.activeFiltersMap).forEach(label => {
                    if (state.activeFiltersMap[label].category === state.currentActiveTab) {
                        delete state.activeFiltersMap[label];
                    }
                });

                // 💡【重要バグ修正】
                // 統計ボタンのactiveクラスを一括削除したり、defaultBtn.click() を呼んだりするのを完全に廃止します。
                // これにより、今見ているカテゴリ一覧の画面（主語、目的語、ステークホルダーなど）を維持します。

                // 2. 「全てクリア」ボタンと全く同じ安全な更新フローを直接実行
                updateTextareaDisplay(); // 👈 これが走ることでテキストが再計算され、表(table.js)も自動で元に戻ります
                updateLegendTable(state.currentActiveTab);
                updateTabVisualIndicators();
                
                // 念のため、表表示への最終的な同期命令も明示的に呼び出します
                if (typeof updateDataTableDisplay === "function") {
                    updateDataTableDisplay(section, docId, state.currentActiveTab, textarea.value);
                }
            });
        }

        // 6. タブ切り替え制御
        tabs.forEach(tab => {
            tab.addEventListener("click", () => {
                const targetTab = tab.getAttribute("data-tab");

                tabs.forEach(t => t.classList.remove("active"));
                tab.classList.add("active");

                panes.forEach(pane => {
                    if (pane.getAttribute("data-content") === targetTab) {
                        pane.style.setProperty("display", (targetTab === "text") ? "flex" : "block", (targetTab === "text") ? "important" : "");
                        pane.classList.add("active");
                    } else {
                        pane.style.setProperty("display", "none", "important");
                        pane.classList.remove("active");
                    }
                });

                if (targetTab === "diagram") {
                    syncGraphWithCurrentText();
                    if (network && typeof network.redraw === "function") {
                        setTimeout(() => {
                            network.setSize("100%", "100%");
                            network.redraw();
                            network.fit(); 
                        }, 50); 
                    }
                }

                if (targetTab === "table") {
                    updateDataTableDisplay();
                }
            });
        });

        // 7. 自動レイアウトボタンのトグルイベント処理
        if (physicsBtn) {
            physicsBtn.addEventListener("click", () => {
                if (!network) return;
                const isOn = physicsBtn.getAttribute("data-on") === "true";
                if (isOn) {
                    network.setOptions({ physics: { enabled: false } });
                    physicsBtn.innerText = "自動レイアウト：OFF";
                    physicsBtn.setAttribute("data-on", "false");
                    physicsBtn.style.backgroundColor = "#6c757d"; 
                } else {
                    network.setOptions({ physics: { enabled: true } });
                    physicsBtn.innerText = "自動レイアウト：ON";
                    physicsBtn.setAttribute("data-on", "true");
                    physicsBtn.style.backgroundColor = "#2196F3"; 
                }
            });
        }
    };

    // ------------------------------------------------------------------------
    // 6. 初期起動処理 (Initializer)
    // ------------------------------------------------------------------------
    const initialize = () => {
        // UIテンプレートをレンダリング
        renderUI();

        // 各種イベントのバインド
        bindEvents();

        // 初期選択カテゴリ（動的フォールバック）の決定
        let defaultTarget = "triple"; 
        if (!config.isSubjectEnabled) {
            if (config.isStakeholderEnabled) defaultTarget = "stakeholder";
            else if (config.isPredicateEnabled) defaultTarget = "p";
        }
        
        if (statsTable) {
            const defaultBtn = statsTable.querySelector(`.stats-toggle-btn[data-target="${defaultTarget}"]`);
            if (defaultBtn) defaultBtn.click();
        }

        // 初期描画の同期
        syncGraphWithCurrentText();
        updateDataTableDisplay(); 
    };

    // ランタイム実行
    initialize();
}