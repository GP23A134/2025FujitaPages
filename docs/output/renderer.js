// renderer.js

function createDocumentSection(docId, structuredLines, stats) {
    const HIDE_UNAVAILABLE = false; 

    const container = document.getElementById("outputContainer");
    if (!container) return;
    
    // 他のファイルから読み込まれているグローバル関数を実行
    const state = createStateManager(docId);
    const linesArray = Array.isArray(structuredLines) ? structuredLines : [];

    let section, textarea, legendTable, titleEl, noticeEl, statsTable, physicsBtn;
    let tabs = [], panes = [];

    const viewMap = new ViewMap(function(updatedText) {});

    const renderUI = () => {
        section = document.createElement("div");
        section.className = "doc-section";
        // 他のファイルから読み込まれているグローバル関数を実行
        section.innerHTML = generateHTML(docId, state.isAllDoc, state.config, stats);

        container.appendChild(section);

        textarea = section.querySelector(`#main-textarea-${docId}`);
        legendTable = document.getElementById(`dynamic-legend-table-${docId}`);
        titleEl = document.getElementById(`legend-current-title-${docId}`);
        noticeEl = document.getElementById(`legend-notice-${docId}`);
        statsTable = section.querySelector(".stats-table");
        physicsBtn = section.querySelector(`#physicsBtn-${docId}`);
        tabs = section.querySelectorAll(".doc-panel-tab");
        panes = section.querySelectorAll(".tab-pane");

        if (statsTable) {
            statsTable.querySelectorAll(".stat-count-value").forEach(td => {
                const statKey = td.getAttribute("data-stat");
                if (statKey) state.targetStatElements[statKey] = td;
            });
        }

        textarea.value = getCleanFullText(linesArray, state.isAllDoc);
        
        //初期表示時は「データテーブル(table)」のみを表示、他を非表示にする
        tabs.forEach((tab) => {
            const targetTab = tab.getAttribute("data-tab");
            const pane = section.querySelector(`.tab-pane[data-content="${targetTab}"]`);
            
            if (targetTab === "table") {
                tab.classList.add("active");
                if (pane) {
                    pane.classList.add("active");
                    pane.style.display = "flex";
                }
            } else {
                tab.classList.remove("active");
                if (pane) {
                    pane.classList.remove("active");
                    pane.style.display = "none";
                }
            }
        });
    };

    // 凡例選択テーブルの描画と同期
    const updateLegendTable = (targetKey) => {
        state.currentActiveTab = targetKey;
        if (noticeEl) {
            noticeEl.style.display = Object.keys(state.activeFiltersMap).length > 1 ? "block" : "none";
        }

        const currentList = stats.lists[targetKey] || [];
        const activeLabels = Object.keys(state.activeFiltersMap);

        let globalIntersectionSet = null;
        if (activeLabels.length > 0) {
            activeLabels.forEach(label => {
                const indexes = state.activeFiltersMap[label].bindingIndexes || [];
                if (globalIntersectionSet === null) {
                    globalIntersectionSet = new Set(indexes);
                } else {
                    const nextInt = new Set();
                    indexes.forEach(idx => { if (globalIntersectionSet.has(idx)) nextInt.add(idx); });
                    globalIntersectionSet = nextInt;
                }
            });
        }

        const processedList = currentList.map(item => {
            let displayCount = item.count;
            if (activeLabels.length > 0) {
                if (globalIntersectionSet && globalIntersectionSet.size > 0) {
                    let matchCount = 0;
                    item.bindingIndexes.forEach(idx => { if (globalIntersectionSet.has(idx)) matchCount++; });
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
                isSelected: !!state.activeFiltersMap[item.name]
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
            const countStyle = useRedColor ? 'color: #d32f2f; margin-left: 4px; font-weight: bold;' : 'color: #666666; margin-left: 4px;';
            const activeClass = item.isSelected ? 'filter-active' : '';

            return `
                <tr class="filter-trigger-row ${activeClass}" data-index="${index}" data-value="${item.name}" style="cursor:pointer; transition: background 0.2s; ${item.isSelected ? 'background-color: #cce5ff; border-left: 4px solid #004085;' : ''}">
                    <td style="padding:6px 10px; border-bottom:1px dashed #eee; vertical-align:middle;">
                        ${item.color ? `<span style="background-color:${item.color}; display:inline-block; width:12px; height:12px; border-radius:3px; margin-right:8px; vertical-align:middle; box-shadow: inset 0 0 0 1px rgba(0,0,0,0.1);"></span>` : ''}
                        <span style="vertical-align:middle; ${item.isSelected ? 'font-weight: bold; color: #004085;' : ''}">
                            ${item.name}
                            <span class="legend-item-count" style="${countStyle}">(${item.displayCount}件)</span>
                        </span>
                    </td>
                </tr>
            `;
        }).join('');

        legendTable.querySelectorAll(".filter-trigger-row").forEach(row => {
            const idx = parseInt(row.getAttribute("data-index"), 10);
            const item = processedList[idx];
            if (!item) return;

            if (item.isSelected || item.displayCount > 0) {
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
                if (state.activeFiltersMap[clickedValue]) {
                    delete state.activeFiltersMap[clickedValue];
                } else {
                    const originalItem = currentList.find(c => c.name === clickedValue);
                    state.activeFiltersMap[clickedValue] = { ...originalItem, color: item.color, category: state.currentActiveTab };
                }
                updateTextareaDisplay();
                updateLegendTable(state.currentActiveTab);
                updateTabVisualIndicators();
            });
        });
    };

    // 可視化マップの同期描画
    const syncGraphWithCurrentText = () => {
        const diagramTab = section.querySelector(".doc-panel-tab[data-tab='diagram']");
        if (diagramTab && diagramTab.classList.contains("active")) {
            const currentText = textarea.value.trim();
            if (currentText !== "") {
                viewMap.setData(currentText);
                viewMap.showMap(`mynetwork-${docId}`, 
                    (updatedText) => {
                        textarea.value = updatedText;
                        updateDataTableDisplay(section, docId, state.currentActiveTab, textarea.value);
                    },
                    (net) => {
                        state.network = net;
                        state.network.setOptions({ 
                            physics: { enabled: true, stabilization: { iterations: 1000 } },
                            layout: { improvedLayout: false } 
                        });
                        state.network.once("stabilizationIterationsDone", () => {
                            state.network.setOptions({ 
                                physics: { enabled: false },
                                layout: { improvedLayout: false } 
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
                if (typeof viewMap.clear === "function") viewMap.clear();
                else if (state.network) state.network.setData({ nodes: [], edges: [] });
            }
        }
    };

    // フィルタ条件変更に伴う処理
    const updateTextareaDisplay = () => {
        const activeLabels = Object.keys(state.activeFiltersMap);
        if (activeLabels.length === 0) {
            textarea.value = getCleanFullText(linesArray, state.isAllDoc);
            syncGraphWithCurrentText();
            updateDataTableDisplay(section, docId, state.currentActiveTab, textarea.value);
            return;
        }

        let allowedIndexesSet = null;
        activeLabels.forEach(label => {
            const itemIndexes = state.activeFiltersMap[label].bindingIndexes || [];
            const currentIndexesSet = new Set(itemIndexes);
            if (allowedIndexesSet === null) {
                allowedIndexesSet = new Set(currentIndexesSet);
            } else {
                const nextIntersection = new Set();
                for (let idx of allowedIndexesSet) {
                    if (currentIndexesSet.has(idx)) nextIntersection.add(idx);
                }
                allowedIndexesSet = nextIntersection;
            }
        });

        if (!allowedIndexesSet || allowedIndexesSet.size === 0) {
            textarea.value = "";
            syncGraphWithCurrentText();
            updateDataTableDisplay(section, docId, state.currentActiveTab, textarea.value);
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
                    if (state.isAllDoc && columns.length > 0) columns.shift(); 
                    filteredLines.push(columns.join("\t"));
                }
            });
        });

        textarea.value = Array.from(new Set(filteredLines)).join("\n");
        syncGraphWithCurrentText();
        updateDataTableDisplay(section, docId, state.currentActiveTab, textarea.value);
    };

    // バッジおよび件数のリアルタイム更新
    const updateTabVisualIndicators = () => {
        const activeLabels = Object.keys(state.activeFiltersMap);
        let visibleTrCount = 0;
        const countedTrIds = new Set();

        if (textarea.value) {
            textarea.value.split("\n").forEach(edgeStr => {
                if (!edgeStr) return;
                edgeStr.split("\t").forEach(col => {
                    if (/^T\d+$/.test(col.trim())) countedTrIds.add(col.trim());
                });
            });
            visibleTrCount = countedTrIds.size;
        }

        if (!statsTable) return;

        statsTable.querySelectorAll(".stats-toggle-btn").forEach(btn => {
            const targetKey = btn.getAttribute("data-target");
            if (!targetKey) return;
            
            const activeCount = Object.values(state.activeFiltersMap).filter(item => item.category === targetKey).length;
            const oldBadge = btn.querySelector(".tab-badge");
            if (oldBadge) oldBadge.remove();

            if (activeCount > 0) {
                const badge = document.createElement("span");
                badge.className = "tab-badge";
                badge.textContent = `${activeCount}`;
                btn.appendChild(badge);
            }

            const targetTd = state.targetStatElements[targetKey];
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
                            const arr = state.activeFiltersMap[label].bindingIndexes || [];
                            if (matchedIndexes === null) matchedIndexes = new Set(arr);
                            else {
                                const nextInt = new Set();
                                arr.forEach(id => { if (matchedIndexes.has(id)) nextInt.add(id); });
                                matchedIndexes = nextInt;
                            }
                        });

                        currentList.forEach(item => {
                            if (state.activeFiltersMap[item.name] || item.bindingIndexes.some(idx => matchedIndexes && matchedIndexes.has(idx))) {
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

    const bindEvents = () => {
        const copyBtn = section.querySelector(".btn-copy-small");
        if (copyBtn) {
            copyBtn.addEventListener("click", () => {
                navigator.clipboard.writeText(textarea.value).then(() => {
                    const origText = copyBtn.innerText;
                    copyBtn.innerText = "コピーしました！";
                    setTimeout(() => { copyBtn.innerText = origText; }, 1500);
                });
            });
        }

        if (legendTable) {
            legendTable.addEventListener("dblclick", (e) => {
                e.stopPropagation();
                let hasChanged = false;
                Object.keys(state.activeFiltersMap).forEach(label => {
                    if (state.activeFiltersMap[label].category === state.currentActiveTab) {
                        delete state.activeFiltersMap[label];
                        hasChanged = true;
                    }
                });
                if (hasChanged) {
                    updateTextareaDisplay();
                    updateLegendTable(state.currentActiveTab);
                    updateTabVisualIndicators();
                }
            });
        }

        if (statsTable) {
            statsTable.addEventListener("click", (e) => {
                const btn = e.target.closest(".stats-toggle-btn");
                if (!btn) return;

                const targetKey = btn.getAttribute("data-target");
                const parentRow = btn.closest("tr");
                if (parentRow && parentRow.style.display === "none") {
                    Object.keys(state.activeFiltersMap).forEach(label => {
                        if (state.activeFiltersMap[label].category === targetKey) delete state.activeFiltersMap[label];
                    });
                    const defaultBtn = statsTable.querySelector('.stats-toggle-btn[data-target="triple"]');
                    if (defaultBtn) defaultBtn.click();
                    return;
                }

                statsTable.querySelectorAll(".stats-toggle-btn").forEach(b => b.classList.remove("active"));
                btn.classList.add("active");
                if (titleEl) titleEl.textContent = `${btn.getAttribute("data-label") || ""}一覧`;
                
                updateLegendTable(targetKey);
                updateTabVisualIndicators();
                updateDataTableDisplay(section, docId, state.currentActiveTab, textarea.value); 
            });
        }

        const clearBtn = section.querySelector(".btn-clear-filters");
        if (clearBtn) {
            clearBtn.addEventListener("click", () => {
                state.activeFiltersMap = {};
                updateTextareaDisplay();
                updateLegendTable(state.currentActiveTab);
                updateTabVisualIndicators();
                updateDataTableDisplay(section, docId, state.currentActiveTab, textarea.value);
            });
        }

        // 「選択解除」ボタンのクリックイベント
        const clearFromListBtn = section.querySelector(`#btn-clear-from-list-${docId}`);
        if (clearFromListBtn) {
            clearFromListBtn.addEventListener("click", () => {
                let hasChanged = false;
                
                // 現在アクティブなタブ（カテゴリ）のフィルターをすべて削除
                Object.keys(state.activeFiltersMap).forEach(label => {
                    if (state.activeFiltersMap[label].category === state.currentActiveTab) {
                        delete state.activeFiltersMap[label];
                        hasChanged = true;
                    }
                });

                if (hasChanged) {
                    // 1. テキストエリアの表示を更新（ここで元の全データ、または残った条件に再計算されます）
                    updateTextareaDisplay();
                    
                    // 2. サイドバーの凡例リストの選択表示をリセット
                    updateLegendTable(state.currentActiveTab);
                    
                    // 3. タブの選択中インジケーターを更新
                    updateTabVisualIndicators();

                    // 💡【ここを修正・追記】
                    // テキストエリアが更新された後の最新の文字列（textarea.value）を
                    // テーブル描画関数に確実に引き渡して、表をリアルタイムに再描画させます
                    if (typeof updateDataTableDisplay === "function") {
                        updateDataTableDisplay(section, docId, state.currentActiveTab, textarea.value);
                    }
                }
            });
        }

        // タブ切り替えロジック
        tabs.forEach((tab) => {
            tab.addEventListener("click", () => {
                tabs.forEach(t => t.classList.remove("active"));
                tab.classList.add("active");

                const targetTab = tab.getAttribute("data-tab"); 

                panes.forEach((pane) => {
                    const contentName = pane.getAttribute("data-content");
                    if (contentName === targetTab) {
                        pane.classList.add("active");
                        pane.style.display = "flex"; 
                    } else {
                        pane.classList.remove("active");
                        pane.style.display = "none";
                    }
                });

                if (targetTab === "diagram") {
                    syncGraphWithCurrentText();
                    if (state.network) {
                        setTimeout(() => { 
                            state.network.setSize("100%", "100%"); 
                            state.network.redraw(); 
                            state.network.fit(); 
                        }, 60);
                    }
                }
                if (targetTab === "table") {
                    updateDataTableDisplay(section, docId, state.currentActiveTab, textarea.value);
                }
            });
        });

        if (physicsBtn) {
            physicsBtn.addEventListener("click", () => {
                if (!state.network) return;
                const isOn = physicsBtn.getAttribute("data-on") === "true";
                if (isOn) {
                    state.network.setOptions({ physics: { enabled: false } });
                    physicsBtn.innerText = "自動レイアウト：OFF";
                    physicsBtn.setAttribute("data-on", "false");
                    physicsBtn.style.backgroundColor = "#6c757d";
                } else {
                    state.network.setOptions({ physics: { enabled: true } });
                    physicsBtn.innerText = "自動レイアウト：ON";
                    physicsBtn.setAttribute("data-on", "true");
                    physicsBtn.style.backgroundColor = "#2196F3";
                }
            });
        }
    };

    const initialize = () => {
        renderUI();
        bindEvents();

        let defaultTarget = "triple";
        if (!state.config.isSubjectEnabled) {
            if (state.config.isStakeholderEnabled) defaultTarget = "stakeholder";
            else if (state.config.isPredicateEnabled) defaultTarget = "p";
        }
        if (statsTable) {
            const defaultBtn = statsTable.querySelector(`.stats-toggle-btn[data-target="${defaultTarget}"]`);
            if (defaultBtn) defaultBtn.click();
        }

        // 💡 修正: 初期ロード時はグラフの同期(重い初期計算)をスキップ、またはバックグラウンド処理とし、
        // テーブルを最優先で即座にビルドして描画します。
        updateDataTableDisplay(section, docId, state.currentActiveTab, textarea.value); 
    };

    initialize();
}
