/**
 * 結果出力エリア（2ペインUI、インタラクティブ凡例、スピナー）の描画を担当
 */

export function showSearchIng(resultArea) {
    const orgDiv = resultArea.innerHTML;
    resultArea.innerHTML = orgDiv + '<div id="searching"><h2>検索中...</h2>'
       + '<div class="flower-spinner"><div class="dots-container">'
       + '<div class="bigger-dot"><div class="smaller-dot"></div>'
       + '</div></div></div><br></div>';
}

export function removeSearchIng() {
    const searchingDiv = document.getElementById("searching");
    if (searchingDiv != null) searchingDiv.remove();
}

export function createDocumentSection(docId, textContent, stats) {
    const container = document.getElementById("outputContainer");
    const isAllDoc = (docId === "ALL_DOCUMENTS");

    const section = document.createElement("div");
    section.className = "doc-section";

    const textarea = document.createElement("textarea");
    textarea.readOnly = true;
    textarea.value = textContent; 

    const alertCopied = () => alert(`${docId} のデータをコピーしました。`);

    section.innerHTML = `
        <div class="doc-header">
            <div class="doc-title">${isAllDoc ? '出力モード: すべてのドキュメント（一括出力）' : `出力モード: ${docId}`}</div>
            <div class="doc-actions"><button class="btn-small btn-copy-small">このデータをコピー</button></div>
        </div>
        <div class="doc-main-content">
            <div class="doc-side-panel">
                <div class="doc-meta-badge">
                    <b class="badge-main-title" style="font-size: 1.1em;">解析結果統計</b>
                    <table class="stats-table" style="font-size: 1.05em; width: 100%;">
                        <tr><td>${!isAllDoc ? `<button class="stats-toggle-btn" data-target="triple" style="font-size: 1em;">トリプル数</button>` : 'トリプル数'}</td><td>${stats.tripleCount}</td></tr>
                        ${stats.sEnabled ? `<tr><td><span class="legend-color-box" style="background-color:${stats.cSubj}; display:inline-block; width:12px; height:12px; border-radius:3px; margin-right:5px; vertical-align:middle;"></span>${!isAllDoc ? `<button class="stats-toggle-btn" data-target="subject" style="font-size: 1em;">主語数</button>` : '主語数'}</td><td>${stats.subjectCount}</td></tr>` : ''}
                        ${stats.oEnabled ? `<tr><td><span class="legend-color-box" style="background-color:${stats.cObj}; display:inline-block; width:12px; height:12px; border-radius:3px; margin-right:5px; vertical-align:middle;"></span>${!isAllDoc ? `<button class="stats-toggle-btn" data-target="object" style="font-size: 1em;">目的語数</button>` : '目的語数'}</td><td>${stats.objectCount}</td></tr>` : ''}
                        ${stats.sClassEnabled ? `<tr><td><span class="legend-color-box" style="background-color:${stats.cSClass}; display:inline-block; width:12px; height:12px; border-radius:3px; margin-right:5px; vertical-align:middle;"></span>${!isAllDoc ? `<button class="stats-toggle-btn" data-target="sClass" style="font-size: 1em;">主語クラス数</button>` : '主語クラス数'}</td><td>${stats.sClassCount}</td></tr>` : ''}
                        ${stats.oClassEnabled ? `<tr><td><span class="legend-color-box" style="background-color:${stats.cOClass}; display:inline-block; width:12px; height:12px; border-radius:3px; margin-right:5px; vertical-align:middle;"></span>${!isAllDoc ? `<button class="stats-toggle-btn" data-target="oClass" style="font-size: 1em;">目的語クラス数</button>` : '目的語クラス数'}</td><td>${stats.oClassCount}</td></tr>` : ''}
                        ${stats.shEnabled ? `
                            <tr><td>${!isAllDoc ? `<button class="stats-toggle-btn" data-target="stakeholder" style="font-size: 1em;">${stats.titleName || 'ステークホルダー'}数</button>` : `${stats.titleName || 'ステークホルダー'}数`}</td><td>${stats.stakeholderCount}</td></tr>
                            <tr><td>${!isAllDoc ? `<button class="stats-toggle-btn" data-target="opinion" style="font-size: 1em;">意見数</button>` : '意見数'}</td><td>${stats.opinionCount}</td></tr>
                        ` : ''}
                        ${stats.evEnabled ? `<tr><td><span class="legend-color-box" style="background-color:${stats.cEv}; display:inline-block; width:12px; height:12px; border-radius:3px; margin-right:5px; vertical-align:middle;"></span>${!isAllDoc ? `<button class="stats-toggle-btn" data-target="evidence" style="font-size: 1em;">根拠数</button>` : '根拠数'}</td><td>${stats.evidenceCount}</td></tr>` : ''}
                    </table>
                    ${!isAllDoc ? `
                        <hr class="badge-divider" style="border:none; border-top:1px dashed #ccc; margin:25px 0 15px 0;">
                        <b id="legend-current-title-${docId}" class="badge-sub-title" style="display:block; margin-bottom:4px; font-size:1.05em; color:#444;"></b>
                        <span id="legend-notice-${docId}" style="font-size:0.8em; color:#888; display:block; margin-bottom:8px;"></span>
                        <div class="legend-scroll-container" style="overflow-y: auto; overflow-x: auto; max-height: 200px; border: 1px solid #eee; padding: 5px; background: #fff; border-radius: 4px;">
                            <table id="dynamic-legend-table-${docId}" class="dynamic-legend-table" style="width: max-content; min-width: 100%; white-space: nowrap; border-collapse: collapse;"></table>
                        </div>
                    ` : ''}
                </div>
            </div>
            <div class="doc-text-panel"></div>
        </div>
    `;

    section.querySelector(".doc-text-panel").appendChild(textarea);
    section.querySelector(".btn-copy-small").onclick = () => {
        navigator.clipboard.writeText(textarea.value)
            .then(alertCopied)
            .catch(() => {
                textarea.select();
                document.execCommand("copy");
                alertCopied();
            });
    };

    container.appendChild(section);

    if (!isAllDoc) {
        const legendTable = document.getElementById(`dynamic-legend-table-${docId}`);
        const titleEl = document.getElementById(`legend-current-title-${docId}`);
        const noticeEl = document.getElementById(`legend-notice-${docId}`);
        let currentFilterTarget = null;

        const updateLegendTable = (targetKey) => {
            const currentList = stats.lists[targetKey] || [];
            if (currentList.length === 0) {
                legendTable.innerHTML = `<tr><td style="color:#888; font-style:italic; padding:5px; font-size:1em;">データがありません</td></tr>`;
                return;
            }

            legendTable.innerHTML = currentList.map((item, index) => `
                <tr class="filter-trigger-row" data-index="${index}" data-value="${item.name}" style="cursor:pointer; transition: background 0.2s; ${currentFilterTarget === item.name ? 'background-color: #e0e0e0;' : ''}">
                    <td style="padding:6px 4px; border-bottom:1px dashed #eee; vertical-align:middle;">
                        ${item.color ? `<span class="legend-color-box" style="background-color:${item.color}; display:inline-block; width:12px; height:12px; border-radius:3px; margin-right:5px; vertical-align:middle;"></span>` : ''}
                        <span class="legend-item-name" style="vertical-align:middle; font-size:1.05em; color:#333; ${currentFilterTarget === item.name ? 'font-weight: bold;' : ''}">
                            ${item.name} <span style="color: #d32f2f; font-size: 0.9em; margin-left: 4px; font-weight: bold;">(${item.count || 0}件)</span>
                        </span>
                    </td>
                </tr>
            `).join('');

            legendTable.querySelectorAll(".filter-trigger-row").forEach(row => {
                row.onclick = () => {
                    const clickedValue = row.getAttribute("data-value");
                    const idx = parseInt(row.getAttribute("data-index"), 10);
                    const item = currentList[idx];

                    if (item.isTriple) {
                        const allLines = textContent.split("\n");
                        if (currentFilterTarget === clickedValue) {
                            currentFilterTarget = null;
                            textarea.value = textContent;
                        } else {
                            currentFilterTarget = clickedValue;
                            const trPrefix = clickedValue.split('_')[0];
                            textarea.value = allLines.filter(line => line.split('\t')[2] === trPrefix).join("\n");
                        }
                    } else {
                        if (window.cy) window.cy.elements().removeClass("highlighted-node dimmed-node");

                        if (currentFilterTarget === clickedValue) {
                            currentFilterTarget = null;
                        } else {
                            currentFilterTarget = clickedValue;
                            if (window.cy) {
                                let prefix = { stakeholder: "st_", subject: "s_", object: "o_" }[targetKey] || "";
                                window.cy.elements().addClass("dimmed-node");
                                window.cy.nodes().forEach(node => {
                                    const nodeId = node.id();
                                    if (nodeId === item.name || nodeId.startsWith(prefix + item.name)) {
                                        node.removeClass("dimmed-node").addClass("highlighted-node");
                                        node.connectedEdges().removeClass("dimmed-node");
                                    }
                                });
                            }
                            console.log(`[選択] カテゴリ: ${targetKey} | 名称: ${item.name} | ID/URI: ${item.uri || "IDが存在しません"}`);
                        }
                    }
                    updateLegendTable(targetKey);
                };
            });
        };

        const statsTable = section.querySelector(".stats-table");
        statsTable.onclick = (e) => {
            const btn = e.target.closest(".stats-toggle-btn");
            if (!btn) return;

            statsTable.querySelectorAll(".stats-toggle-btn").forEach(b => b.classList.remove("active"));
            btn.classList.add("active");

            const targetKey = btn.getAttribute("data-target");
            const labelText = btn.textContent;

            if (titleEl) titleEl.textContent = `${labelText.replace(/[・数]/g, '')}一覧`;
            if (noticeEl) {
                noticeEl.textContent = targetKey === "triple" 
                    ? "※行をクリックで本文をトリプル番号（T1など）で絞り込み"
                    : "※行をクリックでグラフ上の該当ノード（重複分離分含む）を一括ハイライト";
            }

            currentFilterTarget = null;
            textarea.value = textContent;
            if (window.cy) window.cy.elements().removeClass("highlighted-node dimmed-node");

            updateLegendTable(targetKey);
        };

        let defaultKey = stats.shEnabled ? "stakeholder" : "subject";
        const initialBtn = statsTable.querySelector(`.stats-toggle-btn[data-target="${defaultKey}"]`);
        if (initialBtn) initialBtn.click();
    }
}
