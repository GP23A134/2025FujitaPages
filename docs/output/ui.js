// uiTemplate.js

function generateHTML(docId, isAllDoc, config, stats) {
    return `
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
                        <tr data-row="triple"><td><button class="stats-toggle-btn" data-target="triple" data-label="トリプル"><span class="cat-color-badge" style="background-color:${stats.configColors.triple};"></span>トリプル数</button></td><td class="stat-count-value" data-stat=\"triple\">${stats.tripleCount}</td></tr>
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
                        <button type="button" id="btn-clear-from-list-${docId}" class="btn-clear-from-list" style="padding: 4px 8px; background-color: #f8f9fa; color: #6c757d; border: 1px solid #ced4da; border-radius: 4px; cursor: pointer; font-size: 0.85em; margin: 0;" onmouseover="this.style.backgroundColor='#e2e6ea'; this.style.color='#343a40';" onmouseout="this.style.backgroundColor='#f8f9fa'; this.style.color='#6c757d';">
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
                    <button class="doc-panel-tab active" data-tab="table">テーブル表示</button>
                    <button class="doc-panel-tab" data-tab="diagram">グラフ表示</button>
                    <button class="doc-panel-tab" data-tab="text">テキスト表示</button>
                </div>
                
                <div class="doc-tabs-content" style="flex-grow: 1; height: 0; position: relative; background-color: #ffffff; display: flex; flex-direction: column;">
                    
                    <div class="tab-pane pane-table active" data-content="table" style="display: flex; width: 100%; height: 100%; overflow: hidden;">
                        <div class="table-scroll-wrapper" style="height: 100%; overflow-y: auto; overflow-x: hidden; border: 1px solid #e0e0e0; border-radius: 4px; width: 100%;">
                            <table id="data-content-table-${docId}" class="data-content-table" style="width: 100%; border-collapse: collapse; font-size: 0.9em; table-layout: fixed;">
                                <thead style="background-color: #f5f5f5; position: sticky; top: 0; z-index: 10; box-shadow: 0 1px 0 #e0e0e0;">
                                    <tr>
                                        <th style="padding: 10px; border-bottom: 2px solid #e0e0e0; width: 5%; text-align: center;">ID</th>
                                        <th style="padding: 10px; border-bottom: 2px solid #e0e0e0; width: 25%; text-align: center;">主語 (Subject)</th>
                                        <th style="padding: 10px; border-bottom: 2px solid #e0e0e0; width: 5%; text-align: center;">述語 (Predicate)</th>
                                        <th style="padding: 10px; border-bottom: 2px solid #e0e0e0; width: 25%; text-align: center;">目的語 (Object)</th>
                                        <th style="padding: 10px; border-bottom: 2px solid #e0e0e0; width: 40%; text-align: center;">発話者 (Stakeholder)</th>
                                    </tr>
                                </thead>
                                <tbody id="data-content-tbody-${docId}"></tbody>
                            </table>
                        </div>
                    </div>

                    <div class="tab-pane pane-diagram" data-content="diagram" style="display: none; width: 100%; height: 100%; flex-direction: column;">
                        <div class="diagram-container" style="display: flex; flex-direction: column; height: 100%; width: 100%;">
                            <div class="control-actions-bar" style="display: flex; justify-content: flex-start; width: 100%; margin-bottom: 12px; flex-shrink: 0;">
                                <button id="physicsBtn-${docId}" data-on="false" class="btn-small btn-physics" style="margin: 0; background-color: #6c757d; color: white;">自動レイアウト：OFF</button>
                            </div>
                            <div class="map_box" style="position: relative; width: 100%; flex-grow: 1; height: 0; margin: 0;">
                                <div id="mynetwork-${docId}" class="network-canvas" style="position: absolute; top: 0; left: 0; width: 100%; height: 100%; contain: strict; will-change: transform;"></div>
                                <input id="editBox-${docId}" type="text" class="network-edit-box" style="position: absolute; text-align: center; display: none; z-index: 1000; outline: none; padding: 2px;" />
                                <input id="colorPicker-${docId}" type="color" class="network-color-picker" style="position: absolute; display: none; z-index: 101;" />
                                <div id="colorPreset-${docId}" class="network-color-preset" style="position: absolute; display: none; z-index: 1002; background: #ffffff; border: 1px solid #cccccc; padding: 4px;"></div>
                            </div>
                        </div>
                    </div>

                    <div class="tab-pane pane-text" data-content="text" style="display: none; flex-direction: column; height: 100%; width: 100%;">
                        <div class="pane-action-row" style="display: flex; justify-content: flex-end; width: 100%; margin-bottom: 12px; flex-shrink: 0;">
                            <button class="btn-small btn-copy-small" style="cursor: pointer;">このデータをコピー</button>
                        </div>
                        <textarea id="main-textarea-${docId}" class="textarea" style="display: block; width: 100%; flex-grow: 1; min-height: 0; resize: none; margin: 0;" readonly></textarea>
                    </div>
                    
                </div>
            </div>
        </div>`;
}
