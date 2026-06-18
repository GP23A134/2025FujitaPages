/**
 * ========================================================================
 * CCO4KG 変換・特定ID指定抽出ツール メインロジック（ローカル連携・相互ロック版）
 * ========================================================================
 */

// ------------------------------------------------------------------------
// 1. 画面初期化 ＆ イベントリスナー登録
// ------------------------------------------------------------------------
window.addEventListener('DOMContentLoaded', () => {
    // データの存在チェック
    if (typeof window.output_json_data !== 'undefined' && window.output_json_data !== null) {
        console.log("[CCO4KG Loader] 相互ロック・カテゴリカラー対応版プロセスを読み込みました。");
        
        // 初期化処理
        initDocIdDropdown();
        setupAccordion("headerOutput", "contentOutput");
        setupAccordion("headerColor", "contentColor");
        
        // 各種チェックボックスのイベントリスナー登録（安全対策版）
        const targetIds = [
            "enableSubject", "enableObject", "enablePredicate", 
            "enableSClass", "enableOClass", "enableClassLink", 
            "enableStakeholder", "enableStClass", "enableEvidence"
        ];
        targetIds.forEach(id => {
            const el = document.getElementById(id);
            if (el) el.addEventListener("change", updateUIControls);
        });
        
        // ラジオボタンのイベントリスナー登録
        const shRadios = document.getElementsByName("shColorMode");
        if (shRadios.length > 0) {
            shRadios.forEach(radio => radio.addEventListener("change", updateUIControls));
        }
        
        // 実行ボタンの設定
        const execBtn = document.getElementById("execBtn");
        if (execBtn) {
            execBtn.addEventListener("click", splitAndProcessData);
            execBtn.disabled = false;
        }

        // 初回UI更新
        if (typeof updateUIControls === 'function') {
            updateUIControls();
        }
        
    } else {
        console.error("[CCO4KG Loader] エラー: データが見つかりません。");
        const statusEl = document.getElementById("statusMessage");
        if (statusEl) {
            statusEl.className = "status-panel error";
            statusEl.style.display = "block";
            statusEl.textContent = "[エラー] output_CCO4KG.js からデータが見つかりません。";
        }
    }
});

/**
 * アコーディオン機能のセットアップ
 * @param {string} headerId - ヘッダー要素のID
 * @param {string} contentId - コンテンツ要素のID
 */
function setupAccordion(headerId, contentId) {
    const header = document.getElementById(headerId);
    const content = document.getElementById(contentId);
    if (!header || !content) return;

    const icon = header.querySelector(".toggle-icon");

    // 初期状態のアクセシビリティ属性を設定
    const isInitialOpen = content.classList.contains("open");
    header.setAttribute("aria-expanded", isInitialOpen ? "true" : "false");
    header.setAttribute("role", "button"); // クリック可能であることを明示

    header.addEventListener("click", () => {
        const isOpen = content.classList.toggle("open");
        if (icon) icon.textContent = isOpen ? "▲" : "▼";
        header.setAttribute("aria-expanded", isOpen ? "true" : "false");
    });
}

// ------------------------------------------------------------------------
// 2. 設定パネルの有効・無効リアクティブ制御 (UI連動)
// ------------------------------------------------------------------------
function updateUIControls() {
    // ユーティリティ: 要素のチェック状態を安全に取得（存在しない場合は false）
    const isChecked = (id) => document.getElementById(id)?.checked ?? false;

    // --- 1. 各種フラグの取得 ---
    let sEnabled         = isChecked("enableSubject");
    let oEnabled         = isChecked("enableObject");
    let pEnabled         = isChecked("enablePredicate");
    let sClassEnabled    = isChecked("enableSClass");
    let oClassEnabled    = isChecked("enableOClass");
    let classLinkEnabled = isChecked("enableClassLink");
    
    const shEnabled      = isChecked("enableStakeholder");
    const stClassEnabled = isChecked("enableStClass");
    const evEnabled      = isChecked("enableEvidence");

    // ユーティリティ: 汎用的な要素の状態・視覚制御（最終的な有効/無効状態を返す）
    const toggleUIState = (id, enabled, isCheckbox = false) => {
        const el = document.getElementById(id);
        if (!el) return false;
        
        el.disabled = !enabled;
        
        // チェックスボックスが非活性化される場合は強制オフにする（相互ロック連動）
        if (!enabled && isCheckbox) {
            el.checked = false;
        }

        // ラジオボタンやパレット単体で親を巻き添えにしないよう、特定の要素のみ透明度を制御
        // または、対象要素自身に 'control-item' などのクラスがあるかチェック
        const container = el.classList.contains("control-section") ? el : el.parentElement;
        if (container && !el.name) { // ラジオボタン(nameあり)は親の透明度をいじらない
            container.style.opacity = enabled ? "1.0" : "0.3";
        }
        
        return enabled && (isCheckbox ? el.checked : true);
    };

    // --- 2. 依存関係（相互ロック）の判定と制御 ---
    
    // 主語(S) または 目的語(O) のどちらかが欠けていたら 述語(P) は不可
    pEnabled = toggleUIState("enablePredicate", (sEnabled && oEnabled), true);

    // クラス(S) または クラス(O) のどちらかが欠けていたら クラスリンク は不可
    classLinkEnabled = toggleUIState("enableClassLink", (sClassEnabled && oClassEnabled), true);

    // 主語(S)・目的語(O) が両方オフなら ナンバリング も不可
    toggleUIState("enableSubjectObjectNumbering", (sEnabled || oEnabled), true);

    // --- 3. ステークホルダー(SH) 関連の連動制御 ---
    toggleUIState("enableStakeholderNumbering", shEnabled);
    // stClass自体の有効・無効フラグも、shEnabledに連動した結果で上書き
    const actualStClassEnabled = toggleUIState("enableStClass", shEnabled, true);
    
    // ステークホルダー色設定セクション全体の不透明度制御
    const secShColor = document.getElementById("secShColor");
    if (secShColor) secShColor.style.opacity = shEnabled ? "1.0" : "0.3";
    
    // ラジオボタンの制御
    document.getElementsByName("shColorMode").forEach(r => r.disabled = !shEnabled);

    // カラーモードの判定
    const selectedMode = document.querySelector('input[name="shColorMode"]:checked')?.value || "random";
    const isFixed = (selectedMode === "select");
    const isGroup = (selectedMode === "group");

    // ステークホルダー固定色
    const shFixedActive = shEnabled && isFixed;
    toggleUIState("cpStakeholder", shFixedActive);
    const shFixedRow = document.getElementById("shFixedColorRow");
    if (shFixedRow) shFixedRow.style.opacity = shFixedActive ? "1.0" : "0.3";

    // ステークホルダー関係クラス色（"group" モード時も活性化するよう修正）
    const stClassActive = shEnabled && actualStClassEnabled && (isGroup || isFixed || selectedMode === "random");
    toggleUIState("cpStClass", stClassActive);
    const stClassRow = document.getElementById("stClassColorRow");
    if (stClassRow) stClassRow.style.opacity = stClassActive ? "1.0" : "0.3";

    // --- 4. エビデンス(EV) 関連の制御 ---
    toggleUIState("cpEvidence", evEnabled);
    const secEvColor = document.getElementById("secEvColor");
    if (secEvColor) secEvColor.style.opacity = evEnabled ? "1.0" : "0.3";

    // --- 5. カラーパレット(CP) の最終適用（依存関係解決後の変数を使用） ---
    toggleUIState("cpSubject", sEnabled);
    toggleUIState("cpObject", oEnabled);
    toggleUIState("cpPredicate", pEnabled);
    toggleUIState("cpSClass", sClassEnabled);
    toggleUIState("cpOClass", oClassEnabled);
    toggleUIState("cpSClassEdge", classLinkEnabled);
}

// ------------------------------------------------------------------------
// 3. データ処理ユーティリティ
// ------------------------------------------------------------------------
const SPEAKER_PALETTE = [
    "#FFB3BA", "#FFDFBA", "#FFFFBA", "#BAFFC9", "#BAE1FF",
    "#E8B4B8", "#F2D1B3", "#EDE8B7", "#BCE6CD", "#B5D5E6",
    "#FAD2E1", "#E2ECE9", "#BEE3DB", "#89B0A5", "#E0BBE4",
    "#957DAD", "#D291BC", "#FEC8D8", "#FFDFD3", "#D8E2DC"
];

/**
 * Unicodeエスケープ文字 (\uXXXX) をデコード
 */
function decodeFromUnicode(str) {
    if (!str) return "";
    // トライキャッチで囲むか、不正なエスケープによるエラーを防止
    try {
        return str.replace(/\\u([0-9a-fA-F]{4})/g, (_, grp) => String.fromCharCode(parseInt(grp, 16)));
    } catch (e) {
        return str;
    }
}

/**
 * RDF/SPARQL 特有の不要なリテラル文字・トリム処理を一括クリア
 */
function clean(input) {
    if (!input) return "";
    // 空白（全角含む）、@ja、ダブルクォーテーションを一括で効率よく置換
    return decodeFromUnicode(input)
        .replace(/[\s"']|@ja/g, "")
        .trim();
}

/**
 * SPARQL binding オブジェクトから安全に値を取得
 */
function getValueFromBinding(binding, key) {
    return binding?.[key]?.value ?? "";
}

/**
 * URI の末尾（スラッシュ区切り）からローカルIDを抽出
 */
function extractIdFromUri(uriString) {
    if (!uriString) return "";
    const cleanUri = clean(uriString);
    // 末尾のスラッシュの有無を考慮
    const trimmedUri = cleanUri.endsWith('/') ? cleanUri.slice(0, -1) : cleanUri;
    const lastSegment = trimmedUri.split('/').pop() || "";
    return lastSegment.split('#').pop() || "";
}

/**
 * カラーコードの輝度を下げて暗い色を生成（エッジやテキスト用）
 */
function darkenColor(hexColor, factor) {
    if (!hexColor || !hexColor.startsWith("#") || hexColor.length !== 7) return "#adadad";
    try {
        const r = Math.min(255, Math.max(0, Math.floor(parseInt(hexColor.slice(1, 3), 16) * factor)));
        const g = Math.min(255, Math.max(0, Math.floor(parseInt(hexColor.slice(3, 5), 16) * factor)));
        const b = Math.min(255, Math.max(0, Math.floor(parseInt(hexColor.slice(5, 7), 16) * factor)));
        
        // 16進数文字列への変換を確実に2桁にする
        return `#${((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1)}`;
    } catch (e) { 
        return hexColor; 
    }
}

/**
 * SPARQL結果から一意のドキュメントIDを抽出してドロップダウンを初期化
 */
function initDocIdDropdown() {
    const bindings = window.output_json_data?.results?.bindings;
    const selectEl = document.getElementById("targetDocId");
    if (!bindings || !selectEl) return;
    
    selectEl.innerHTML = '<option value="">-- すべてのドキュメント (一括出力) --</option>';
    const idSet = new Set();
    
    // 高速なループ処理
    for (let i = 0; i < bindings.length; i++) {
        const b = bindings[i];
        const rawDocUri = getValueFromBinding(b, "g") || getValueFromBinding(b, "?g");
        if (rawDocUri) {
            idSet.add(extractIdFromUri(rawDocUri));
        }
    }
    
    // ソートして要素を追加（DocumentFragmentを使うとDOM描画が高速化します）
    const fragment = document.createDocumentFragment();
    Array.from(idSet).sort().forEach(docId => {
        const option = document.createElement("option");
        option.value = docId;
        option.textContent = docId;
        fragment.appendChild(option);
    });
    selectEl.appendChild(fragment);
}

/**
 * ローディングスピナーの表示（既存DOMのイベントを破壊しない設計）
 */
function showSearchIng(resultArea) {
    if (!resultArea) return;
    
    const spinnerHtml = `
        <div id="searching">
            <h2>解析中...</h2>
            <div class="flower-spinner">
                <div class="dots-container">
                    <div class="bigger-dot">
                        <div class="smaller-dot"></div>
                    </div>
                </div>
            </div>
            <br>
        </div>`;
    
    // innerHTML = org + new ではなく、末尾に安全に挿入する
    resultArea.insertAdjacentHTML('beforeend', spinnerHtml);
}

/**
 * ローディングスピナーの削除
 */
function removeSearchIng() {
    document.getElementById("searching")?.remove();
}

// ------------------------------------------------------------------------
// 4. メイン変換処理 ＆ 相互接続連動フィルタ
// ------------------------------------------------------------------------
function splitAndProcessData() {
    const execBtn = document.getElementById("execBtn");
    const outputContainer = document.getElementById("outputContainer");
    
    if (execBtn) execBtn.disabled = true;
    if (outputContainer) outputContainer.innerHTML = ""; 
    showSearchIng(outputContainer);

    // 重い処理のために1フレーム（50ms）空けて描画を確定
    setTimeout(() => {
        try {
            const bindings = window.output_json_data?.results?.bindings;
            if (!bindings) throw new Error("Bindings data not found");

            const shEnabledRaw = document.getElementById("enableStakeholder")?.checked ?? false;
            const sEnabled       = document.getElementById("enableSubject")?.checked ?? false;
            const oEnabled       = document.getElementById("enableObject")?.checked ?? false;
            const sClassEnabled  = document.getElementById("enableSClass")?.checked ?? false;
            const oClassEnabled  = document.getElementById("enableOClass")?.checked ?? false;

            // コンフィグ設定の集約
            const config = {
                sEnabled: sEnabled,
                oEnabled: oEnabled,
                pEnabled: sEnabled && oEnabled && (document.getElementById("enablePredicate")?.checked ?? false), 
                sClassEnabled: sClassEnabled,
                oClassEnabled: oClassEnabled,
                classLinkEnabled: sClassEnabled && oClassEnabled && (document.getElementById("enableClassLink")?.checked ?? false), 
                shEnabled: shEnabledRaw,
                evEnabled: document.getElementById("enableEvidence")?.checked ?? false,
                shNum: shEnabledRaw && (document.getElementById("enableStakeholderNumbering")?.checked ?? false),
                stClass: shEnabledRaw && (document.getElementById("enableStClass")?.checked ?? false),
                soNum: document.getElementById("enableSubjectObjectNumbering")?.checked ?? false,
                targetId: document.getElementById("targetDocId")?.value ?? "",
                shColorMode: document.querySelector('input[name="shColorMode"]:checked')?.value || "random",
                cSubj: document.getElementById("cpSubject")?.value || "#000000",
                cObj: document.getElementById("cpObject")?.value || "#000000",
                cPred: document.getElementById("cpPredicate")?.value || "#000000",
                cSClass: document.getElementById("cpSClass")?.value || "#000000",
                cOClass: document.getElementById("cpOClass")?.value || "#000000",
                cSClassEdge: document.getElementById("cpSClassEdge")?.value || "#000000", 
                cEv: document.getElementById("cpEvidence")?.value || "#000000",
                cStClass: document.getElementById("cpStClass")?.value || "#000000",
                cFixedSH: document.getElementById("cpStakeholder")?.value || "#000000",
                cDefaultEdge: "#adadad"
            };

            // ドキュメントごとのグルーピング
            const docGroups = {};
            for (let i = 0; i < bindings.length; i++) {
                const b = bindings[i];
                const docId = extractIdFromUri(getValueFromBinding(b, "g") || getValueFromBinding(b, "?g"));
                if (config.targetId !== "" && docId !== config.targetId) continue; 
                
                const groupKey = (config.targetId === "") ? "ALL_DOCUMENTS" : docId;
                if (!docGroups[groupKey]) docGroups[groupKey] = [];
                docGroups[groupKey].push({ binding: b, originalDocId: docId, lineIndex: i });
            }

            if (Object.keys(docGroups).length === 0) {
                removeSearchIng();
                alert("該当するデータが見つかりませんでした。");
                if (execBtn) execBtn.disabled = false;
                return;
            }

            let globalColorCounter = 0;
            removeSearchIng();

            // カラー解決用ヘルパー（ループ外に定義してGCとメモリを節約）
            const colorResolver = {
                localSpeakerMap: {},
                localStClassMap: {},
                getIndividualColor(id) {
                    if (this.localSpeakerMap[id]) return this.localSpeakerMap[id];
                    const color = SPEAKER_PALETTE[globalColorCounter % SPEAKER_PALETTE.length];
                    this.localSpeakerMap[id] = color;
                    globalColorCounter++;
                    return color;
                },
                getGroupColor(id) {
                    if (this.localStClassMap[id]) return this.localStClassMap[id];
                    const color = SPEAKER_PALETTE[globalColorCounter % SPEAKER_PALETTE.length];
                    this.localStClassMap[id] = color;
                    globalColorCounter++;
                    return color;
                },
                resolve(shId, stClassId, finalSpeakerMap, finalStClassMap) {
                    if (config.shColorMode === "select") {
                        finalSpeakerMap[shId] = config.cFixedSH;
                        if (stClassId) finalStClassMap[stClassId] = config.cStClass;
                        return;
                    }
                    if (config.shColorMode === "group") {
                        if (stClassId) {
                            const groupColor = this.getGroupColor(stClassId);
                            finalStClassMap[stClassId] = groupColor; 
                            finalSpeakerMap[shId] = darkenColor(groupColor, 0.85);
                        } else if (!finalSpeakerMap[shId]) {
                            finalSpeakerMap[shId] = this.getIndividualColor(shId);
                        }
                        return;
                    }
                    if (config.shColorMode === "random") {
                        finalSpeakerMap[shId] = this.getIndividualColor(shId);
                        if (stClassId) finalStClassMap[stClassId] = config.cStClass;
                    }
                }
            };

            // 安全なプロパティ走査（Object.keys）
            for (const groupKey of Object.keys(docGroups)) {
                const wrappedBindings = docGroups[groupKey];
                
                const wordAppearanceMap = {}; 
                const finalSpeakerColorMap = {}; 
                const finalStClassColorMap = {}; 

                const uniqueSubjects = new Set();
                const uniqueObjects = new Set();
                const uniqueSClasses = new Set();
                const uniqueOClasses = new Set();
                const uniqueEvidences = new Set();
                const uniqueOpinions = new Set();
                const uniqueTriples = new Set();
                
                const tripleLabelMap = {};
                const stakeholderLabelMap = {}; 
                const stClassLabelMap = {};
                const legendDisplayColorMap = {};
                const shExactCountMap = {};
                const nameToColorCacheMap = {}; // 高速カラー参照用マップ

                const bindingIndexesMap = {
                    triple: {}, subject: {}, object: {}, sClass: {}, oClass: {}, stakeholder: {}, opinion: {}, evidence: {}
                };

                const jsonCountMap = {
                    stakeholder: {}, subject: {}, object: {}, sClass: {}, oClass: {}, evidence: {}, opinion: {}, triple: {}
                };

                // インデックスプッシュ用共通処理
                const pushIndex = (category, key, idx) => {
                    if (!key) return;
                    if (!bindingIndexesMap[category][key]) bindingIndexesMap[category][key] = [];
                    if (!bindingIndexesMap[category][key].includes(idx)) {
                        bindingIndexesMap[category][key].push(idx);
                    }
                };

                // 第1パス: 発話者とクラスのカラー情報を事前マッピング
                for (let i = 0; i < wrappedBindings.length; i++) {
                    const b = wrappedBindings[i].binding;
                    const shId = extractIdFromUri(getValueFromBinding(b, "stakeholder"));
                    const stClassId = extractIdFromUri(getValueFromBinding(b, "stClass") || getValueFromBinding(b, "?stClass"));
                    const cleanShName = clean(getValueFromBinding(b, "stakeholderLabel"));
                    
                    if (/^(【個人】|個人|)$/.test(cleanShName)) continue;

                    const shLabel = "st_" + cleanShName;
                    const stClassLabel = "stc_" + clean(getValueFromBinding(b, "stClassLabel"));
                    if (shId !== "") {
                        stakeholderLabelMap[shId] = shLabel;
                        if (stClassId !== "") stClassLabelMap[stClassId] = stClassLabel;
                        if (!finalSpeakerColorMap[shId]) {
                            colorResolver.resolve(shId, stClassId, finalSpeakerColorMap, finalStClassColorMap);
                        }
                    }
                }

                const classLinkSet = new Set(); 
                const metadataLinkSet = new Set(); 
                const comboToTrMap = {}; 
                const opinionToColorMap = {};
                let trCounter = 0; 
                let docOutputBuffer = ""; 

                // 第2パス: トリプルの構築と出力バッファリング
                for (let i = 0; i < wrappedBindings.length; i++) {
                    const item = wrappedBindings[i];
                    const b = item.binding;
                    const currentDocId = item.originalDocId; 
                    const curIdx = item.lineIndex;

                    const sUri = getValueFromBinding(b, "s");
                    const sClassUri = getValueFromBinding(b, "sClass");
                    const oUri = getValueFromBinding(b, "o");
                    const oClassUri = getValueFromBinding(b, "oClass");
                    const shUri = getValueFromBinding(b, "stakeholder");
                    const opUri = getValueFromBinding(b, "opinion");

                    const sId = extractIdFromUri(sUri);
                    const sClassId = extractIdFromUri(sClassUri);
                    const pId = extractIdFromUri(getValueFromBinding(b, "p"));
                    const oId = extractIdFromUri(oUri);
                    const oClassId = extractIdFromUri(oClassUri);
                    const shId = extractIdFromUri(shUri);
                    const stClassId = extractIdFromUri(getValueFromBinding(b, "stClass") || getValueFromBinding(b, "?stClass"));
                    const opId = extractIdFromUri(opUri);

                    const sLabelRaw = clean(getValueFromBinding(b, "sLabel"));
                    const oLabelRaw = clean(getValueFromBinding(b, "oLabel"));
                    const shLabelRaw = clean(getValueFromBinding(b, "stakeholderLabel"));
                    const opContentRaw = clean(getValueFromBinding(b, "opinionContent"));
                    const evContentRaw = clean(getValueFromBinding(b, "evidence"));
                    const sClassLabelRaw = clean(getValueFromBinding(b, "sClassLabel"));
                    const oClassLabelRaw = clean(getValueFromBinding(b, "oClassLabel"));
                    const stClassLabelRaw = clean(getValueFromBinding(b, "stClassLabel"));

                    if (sId === "" || oId === "") continue;

                    const sLabel = "s_" + sLabelRaw;
                    const sClassLabel = "sc_" + sClassLabelRaw;
                    const pLabel = clean(getValueFromBinding(b, "pLabel")); 
                    const oLabel = "o_" + oLabelRaw;
                    const ocLabel = "oc_" + oClassLabelRaw;
                    const shLabel_cleansed = "st_" + shLabelRaw;
                    const stClassLabel = "stc_" + stClassLabelRaw;
                    const evContent = "ev_" + evContentRaw;

                    const comboKeyForId = `${currentDocId}_${sId}|${pId}|${oId}`;
                    let isFirstTimeTr = false;
                    
                    if (!comboToTrMap[comboKeyForId]) {
                        comboToTrMap[comboKeyForId] = "T" + trCounter;
                        trCounter++;
                        isFirstTimeTr = true; 
                    }
                    const trId = comboToTrMap[comboKeyForId]; 

                    const tripleMapKey = `${sLabelRaw} | ${pLabel} | ${oLabelRaw}`;
                    const tripleDisplayLabel = `${trId}_${sLabelRaw}_${pLabel}_${oLabelRaw}`; 

                    uniqueTriples.add(tripleMapKey);
                    tripleLabelMap[tripleMapKey] = tripleDisplayLabel;
                    jsonCountMap.triple[tripleMapKey] = (jsonCountMap.triple[tripleMapKey] || 0) + 1;
                    pushIndex("triple", tripleDisplayLabel, curIdx);

                    if (sId !== "") {
                        uniqueSubjects.add(sLabel);
                        jsonCountMap.subject[sLabel] = (jsonCountMap.subject[sLabel] || 0) + 1;
                        pushIndex("subject", sLabel, curIdx);
                    }
                    if (oId !== "") {
                        uniqueObjects.add(oLabel);
                        jsonCountMap.object[oLabel] = (jsonCountMap.object[oLabel] || 0) + 1;
                        pushIndex("object", oLabel, curIdx);
                    }
                    if (sClassId !== "" && sClassLabelRaw) {
                        uniqueSClasses.add(sClassLabel);
                        jsonCountMap.sClass[sClassLabel] = (jsonCountMap.sClass[sClassLabel] || 0) + 1;
                        pushIndex("sClass", sClassLabel, curIdx);
                    }
                    if (oClassId !== "" && oClassLabelRaw) {
                        uniqueOClasses.add(ocLabel);
                        jsonCountMap.oClass[ocLabel] = (jsonCountMap.oClass[ocLabel] || 0) + 1;
                        pushIndex("oClass", ocLabel, curIdx);
                    }
                    if (evContentRaw !== "") {
                        uniqueEvidences.add(evContent);
                        jsonCountMap.evidence[evContent] = (jsonCountMap.evidence[evContent] || 0) + 1;
                        pushIndex("evidence", evContent, curIdx);
                    }

                    const displaySLabel = config.soNum ? `${sLabel}_${trId}` : sLabel;
                    const displayOLabel = config.soNum ? `${oLabel}_${trId}` : oLabel;
                    
                    let shNodeName = "";
                    let speakerColor = config.cFixedSH;
                    if (shId !== "" && shLabelRaw) {
                        shNodeName = shLabel_cleansed;
                        const stCount = (wordAppearanceMap[shId] || 0) + 1;
                        wordAppearanceMap[shId] = stCount;
                        shNodeName = config.shNum ? `${shNodeName}_${stCount}` : shNodeName;
                        speakerColor = finalSpeakerColorMap[shId] || config.cFixedSH;
                        
                        shExactCountMap[shLabel_cleansed] = (shExactCountMap[shLabel_cleansed] || 0) + 1;
                        jsonCountMap.stakeholder[shNodeName] = (jsonCountMap.stakeholder[shNodeName] || 0) + 1;
                        pushIndex("stakeholder", shLabel_cleansed, curIdx);

                        if (opContentRaw) {
                            uniqueOpinions.add(opContentRaw);
                            jsonCountMap.opinion[opContentRaw] = (jsonCountMap.opinion[opContentRaw] || 0) + 1;
                            pushIndex("opinion", opContentRaw, curIdx);
                            opinionToColorMap[opContentRaw] = speakerColor;
                        }

                        if (config.shColorMode === "group") {
                            const className = stClassLabelMap[stClassId] || "不明な分類";
                            legendDisplayColorMap[`stClass_${stClassId}`] = { name: `【分類】${className}`, color: finalStClassColorMap[stClassId], uri: sClassUri };
                        }
                        legendDisplayColorMap[`sh_${shId}`] = { name: `${shLabel_cleansed}`, color: speakerColor, uri: shUri };
                        
                        // 高速化用のインデックスキャッシュに格納
                        nameToColorCacheMap[shLabel_cleansed] = speakerColor;
                    }

                    const prefix = (config.targetId === "") ? `${currentDocId}\t` : "";

                    if (isFirstTimeTr) {
                        if (config.pEnabled) {
                            docOutputBuffer += `${prefix}${displaySLabel}\t${pLabel}\t${displayOLabel}\t${config.cSubj}\t${config.cObj}\t${config.cPred}\n`;
                        }
                        if (config.sEnabled) {
                            docOutputBuffer += `${prefix}${trId}\t主語\t${displaySLabel}\t${config.cDefaultEdge}\t${config.cSubj}\t${config.cSubj}\n`;
                        } else if (config.sClassEnabled && sClassId !== "" && sClassLabelRaw) {
                            const directSClassKey = `${currentDocId}_${trId}_direct_sClass_${sClassId}`;
                            if (!classLinkSet.has(directSClassKey)) {
                                classLinkSet.add(directSClassKey);
                                docOutputBuffer += `${prefix}${trId}\tsClass\t${sClassLabel}\t${config.cDefaultEdge}\t${config.cSClass}\t${config.cSClass}\n`;
                            }
                        }
                        if (config.oEnabled) {
                            docOutputBuffer += `${prefix}${trId}\t目的語\t${displayOLabel}\t${config.cDefaultEdge}\t${config.cObj}\t${config.cObj}\n`;
                        } else if (config.oClassEnabled && oClassId !== "" && oClassLabelRaw) {
                            const directOClassKey = `${currentDocId}_${trId}_direct_oClass_${oClassId}`;
                            if (!classLinkSet.has(directOClassKey)) {
                                classLinkSet.add(directOClassKey);
                                docOutputBuffer += `${prefix}${trId}\toClass\t${ocLabel}\t${config.cDefaultEdge}\t${config.cOClass}\t${config.cOClass}\n`;
                            }
                        }
                    }

                    if (config.sEnabled && config.sClassEnabled && sClassId !== "" && sClassLabelRaw) {
                        const scKey = `${currentDocId}_${sId}_${sClassId}`;
                        if (!classLinkSet.has(scKey)) {
                            classLinkSet.add(scKey);
                            docOutputBuffer += `${prefix}${displaySLabel}\tsClass\t${sClassLabel}\t${config.cDefaultEdge}\t${config.cSClass}\t${config.cSClass}\n`;
                        }
                    }
                    if (config.oEnabled && config.oClassEnabled && oClassId !== "" && oClassLabelRaw) {
                        const ocKey = `${currentDocId}_${oId}_${oClassId}`;
                        if (!classLinkSet.has(ocKey)) {
                            classLinkSet.add(ocKey);
                            docOutputBuffer += `${prefix}${displayOLabel}\toClass\t${ocLabel}\t${config.cDefaultEdge}\t${config.cOClass}\t${config.cOClass}\n`;
                        }
                    }
                    if (config.classLinkEnabled && sClassId !== "" && sClassLabelRaw && oClassId !== "" && oClassLabelRaw) {
                        const linkKey = `${currentDocId}_${sClassId}_${oClassId}`;
                        if (!classLinkSet.has(linkKey)) {
                            classLinkSet.add(linkKey);
                            docOutputBuffer += `${prefix}${sClassLabel}\tclassLink\t${ocLabel}\t${config.cSClassEdge}\t${config.cSClass}\t${config.cOClass}\n`;
                        }
                    }

                    if (shId !== "" && shLabelRaw) {
                        const shMetaKey = `${currentDocId}_${trId}_${shNodeName}`;
                        if (!metadataLinkSet.has(shMetaKey)) {
                            metadataLinkSet.add(shMetaKey);
                            docOutputBuffer += `${prefix}${trId}\t発話者\t${shNodeName}\t${config.cDefaultEdge}\t${speakerColor}\t${speakerColor}\n`;
                        }
                        
                        if (config.stClass && stClassId !== "" && stClassLabelRaw) {
                            const stcKey = `${currentDocId}_${shNodeName}_${stClassId}`;
                            if (!classLinkSet.has(stcKey)) {
                                classLinkSet.add(stcKey);
                                const classColor = finalStClassColorMap[stClassId] || config.cStClass;
                                docOutputBuffer += `${prefix}${shNodeName}\t所属\t${stClassLabel}\t${config.cDefaultEdge}\t${classColor}\t${classColor}\n`;
                            }
                        }
                        if (opContentRaw) {
                            const opMetaKey = `${currentDocId}_${shNodeName}_opinion_${opId}`;
                            if (!metadataLinkSet.has(opMetaKey)) {
                                metadataLinkSet.add(opMetaKey);
                                docOutputBuffer += `${prefix}${shNodeName}\t意見\t${opContentRaw}\t${config.cDefaultEdge}\t#f0f0f0\t#f0f0f0\n`;
                            }
                        }
                    }

                    if (config.evEnabled && evContentRaw !== "") {
                        const evMetaKey = `${currentDocId}_${trId}_evidence_${evContent}`;
                        if (!metadataLinkSet.has(evMetaKey)) {
                            metadataLinkSet.add(evMetaKey);
                            docOutputBuffer += `${prefix}${trId}\t根拠\t${evContent}\t${config.cDefaultEdge}\t${config.cEv}\t${config.cEv}\n`;
                        }
                    }
                }

                // 統計オブジェクトリストの生成（O(1) カラーマップアクセスへ改善）
                const createSortedObjList = (setObj, countSubMap, categoryKey) => {
                    return Array.from(setObj).map(item => {
                        let rawName = item;
                        if (categoryKey === "triple") rawName = tripleLabelMap[item] || item;
                        
                        let baseColor = null;
                        switch (categoryKey) {
                            case "subject":     baseColor = config.cSubj; break;
                            case "object":      baseColor = config.cObj; break;
                            case "sClass":      baseColor = config.cSClass; break;
                            case "oClass":      baseColor = config.cOClass; break;
                            case "evidence":    baseColor = config.cEv; break;
                            case "stakeholder": baseColor = nameToColorCacheMap[item] || null; break;
                            case "opinion":     baseColor = opinionToColorMap[item] || "#f0f0f0"; break; 
                        }

                        return {
                            name: rawName,
                            count: countSubMap[item] || 0,
                            color: baseColor,
                            bindingIndexes: bindingIndexesMap[categoryKey][rawName] || []
                        };
                    }).sort((a, b) => b.count - a.count);
                };

                const stats = {
                    configColors: {
                        triple: config.cPred, subject: config.cSubj, object: config.cObj,
                        sClass: config.cSClass, oClass: config.cOClass, stakeholder: config.cFixedSH,
                        opinion: "#f0f0f0", evidence: config.cEv
                    },
                    tripleCount: uniqueTriples.size,
                    subjectCount: uniqueSubjects.size,
                    objectCount: uniqueObjects.size,
                    sClassCount: uniqueSClasses.size,
                    oClassCount: uniqueOClasses.size,
                    stakeholderCount: Object.keys(shExactCountMap).length,
                    opinionCount: uniqueOpinions.size,
                    evidenceCount: uniqueEvidences.size,
                    lists: {
                        triple: createSortedObjList(uniqueTriples, jsonCountMap.triple, "triple"),
                        subject: createSortedObjList(uniqueSubjects, jsonCountMap.subject, "subject"),
                        object: createSortedObjList(uniqueObjects, jsonCountMap.object, "object"),
                        sClass: createSortedObjList(uniqueSClasses, jsonCountMap.sClass, "sClass"),
                        oClass: createSortedObjList(uniqueOClasses, jsonCountMap.oClass, "oClass"),
                        stakeholder: createSortedObjList(Object.keys(shExactCountMap), shExactCountMap, "stakeholder"),
                        opinion: createSortedObjList(uniqueOpinions, jsonCountMap.opinion, "opinion"),
                        evidence: createSortedObjList(uniqueEvidences, jsonCountMap.evidence, "evidence")
                    }
                };

                // 出力セクションのレンダリングへ
                createDocumentSection(groupKey, docOutputBuffer, stats);
            }

            if (execBtn) execBtn.disabled = false;
        } catch (err) {
            removeSearchIng();
            console.error(err);
            alert("変換処理中にエラーが発生しました。");
            if (execBtn) execBtn.disabled = false;
        }
    }, 50);
}

// ------------------------------------------------------------------------
// 5. レンダラー＆相互連動型リストフィルタ（テキストエリア非連動）
// ------------------------------------------------------------------------
function createDocumentSection(docId, textContent, stats) {
    const container = document.getElementById("outputContainer");
    if (!container) return;
    const isAllDoc = (docId === "ALL_DOCUMENTS");

    const section = document.createElement("div");
    section.className = "doc-section";

    const textarea = document.createElement("textarea");
    textarea.readOnly = true;
    textarea.value = textContent; 

    //【追加】行ごとの配列を保持（空行を除外）
    const originalLines = textContent.split("\n").filter(line => line.trim() !== "");
    
    section.innerHTML = `
        <div class="doc-header">
            <div class="doc-title">${isAllDoc ? '出力モード: 一括出力' : `出力モード: ${docId}`}</div>
            <div class="doc-actions">
                ${!isAllDoc ? `<button class="btn-small btn-clear-filters" style="background-color: #6c757d; color: white; border: none; margin-right: 8px; cursor: pointer; border-radius: 4px; padding: 6px 12px; font-weight: bold;">選択をクリア</button>` : ''}
                <button class="btn-small btn-copy-small">このデータをコピー</button>
            </div>
        </div>
        <div class="doc-main-content">
            <div class="doc-side-panel">
                <div class="doc-meta-badge">
                    <b class="badge-main-title">解析結果統計</b>
                    <table class="stats-table">
                        <tr><td><button class="stats-toggle-btn" data-target="triple"><span class="cat-color-badge" style="background-color:${stats.configColors.triple};"></span>トリプル数</button></td><td class="stat-count-value" data-stat="triple">${stats.tripleCount}</td></tr>
                        <tr><td><button class="stats-toggle-btn" data-target="subject"><span class="cat-color-badge" style="background-color:${stats.configColors.subject};"></span>主語数</button></td><td class="stat-count-value" data-stat="subject">${stats.subjectCount}</td></tr>
                        <tr><td><button class="stats-toggle-btn" data-target="object"><span class="cat-color-badge" style="background-color:${stats.configColors.object};"></span>目的語数</button></td><td class="stat-count-value" data-stat="object">${stats.objectCount}</td></tr>
                        <tr><td><button class="stats-toggle-btn" data-target="sClass"><span class="cat-color-badge" style="background-color:${stats.configColors.sClass};"></span>主語クラス数</button></td><td class="stat-count-value" data-stat="sClass">${stats.sClassCount}</td></tr>
                        <tr><td><button class="stats-toggle-btn" data-target="oClass"><span class="cat-color-badge" style="background-color:${stats.configColors.oClass};"></span>目的語クラス数</button></td><td class="stat-count-value" data-stat="oClass">${stats.oClassCount}</td></tr>
                        <tr><td><button class="stats-toggle-btn" data-target="stakeholder"><span class="cat-color-badge" style="background-color:${stats.configColors.stakeholder};"></span>ステークホルダー数</button></td><td class="stat-count-value" data-stat="stakeholder">${stats.stakeholderCount}</td></tr>
                        <tr><td><button class="stats-toggle-btn" data-target="opinion"><span class="cat-color-badge" style="background-color:${stats.configColors.opinion};"></span>意見数</button></td><td class="stat-count-value" data-stat="opinion">${stats.opinionCount}</td></tr>
                        <tr><td><button class="stats-toggle-btn" data-target="evidence"><span class="cat-color-badge" style="background-color:${stats.configColors.evidence};"></span>根拠数</button></td><td class="stat-count-value" data-stat="evidence">${stats.evidenceCount}</td></tr>
                    </table>
                    
                    ${!isAllDoc ? `
                        <hr class="badge-divider">
                        <b id="legend-current-title-${docId}" class="badge-sub-title">一覧</b>
                        <span id="legend-notice-${docId}" style="font-size:0.8em; color:#2196F3; display:block; margin-bottom:8px; font-weight:bold;"></span>
                        <div class="legend-scroll-container">
                            <table id="dynamic-legend-table-${docId}" class="dynamic-legend-table"></table>
                        </div>
                    ` : ''}
                </div>
            </div>
            <div class="doc-text-panel"></div>
        </div>
    `;

    section.querySelector(".doc-text-panel").appendChild(textarea);
    
    section.querySelector(".btn-copy-small").onclick = () => {
        navigator.clipboard.writeText(textarea.value).then(() => alert("データをコピーしました。"));
    };

    container.appendChild(section);

    if (!isAllDoc) {
        const legendTable = document.getElementById(`dynamic-legend-table-${docId}`);
        const titleEl = document.getElementById(`legend-current-title-${docId}`);
        const noticeEl = document.getElementById(`legend-notice-${docId}`);
        const statsTable = section.querySelector(".stats-table");
        
        let activeFiltersMap = {}; 
        let currentActiveTab = ""; 

        // 共通して含まれるインデックスを抽出
        const getIntersectedIndexes = () => {
            const filterItems = Object.values(activeFiltersMap);
            if (filterItems.length === 0) return null;

            let intersected = null;
            filterItems.forEach(item => {
                const idxSet = new Set(item.bindingIndexes || []);
                if (intersected === null) {
                    intersected = idxSet;
                } else {
                    intersected = new Set([...intersected].filter(x => idxSet.has(x)));
                }
            });
            return intersected;
        };

        // 上部統計タブの選択数バッジと件数をリフレッシュする関数
        const updateTabVisualIndicators = () => {
            const intersectedIndexes = getIntersectedIndexes();

            statsTable.querySelectorAll(".stats-toggle-btn").forEach(btn => {
                const targetKey = btn.getAttribute("data-target");
                if (!targetKey) return;
                
                // 1. 選択中バッジの更新
                const activeCount = Object.values(activeFiltersMap).filter(item => item.category === targetKey).length;
                const oldBadge = btn.querySelector(".tab-badge");
                if (oldBadge) oldBadge.remove();

                if (activeCount > 0) {
                    const badge = document.createElement("span");
                    badge.className = "tab-badge";
                    badge.textContent = `${activeCount}`;
                    btn.appendChild(badge);
                }

                // 2. カウント表示の更新
                const murderousTd = statsTable.querySelector(`.stat-count-value[data-stat="${targetKey}"]`);
                if (murderousTd) {
                    const currentList = stats.lists[targetKey] || [];
                    
                    if (intersectedIndexes === null) {
                        if (targetKey === "triple") murderousTd.textContent = stats.tripleCount;
                        else if (targetKey === "subject") murderousTd.textContent = stats.subjectCount;
                        else if (targetKey === "object") murderousTd.textContent = stats.objectCount;
                        else if (targetKey === "sClass") murderousTd.textContent = stats.sClassCount;
                        else if (targetKey === "oClass") murderousTd.textContent = stats.oClassCount;
                        else if (targetKey === "stakeholder") murderousTd.textContent = stats.stakeholderCount;
                        else if (targetKey === "opinion") murderousTd.textContent = stats.opinionCount;
                        else if (targetKey === "evidence") murderousTd.textContent = stats.evidenceCount;
                        
                        murderousTd.style.color = "#333333";
                    } else {
                        let availableUniqueCount = 0;
                        currentList.forEach(item => {
                            const isSelected = !!activeFiltersMap[item.name];
                            const hasIntersection = item.bindingIndexes && item.bindingIndexes.some(i => intersectedIndexes.has(i));
                            
                            if (isSelected || hasIntersection) {
                                availableUniqueCount++;
                            }
                        });
                        
                        murderousTd.textContent = availableUniqueCount;
                        murderousTd.style.color = "#d32f2f";
                    }
                }
            });
        };

        // 下部の一覧テーブルを更新する関数
        const updateLegendTable = (targetKey) => {
            if (!targetKey || !legendTable) return;
            currentActiveTab = targetKey;

            const currentList = stats.lists[targetKey] || [];
            const intersectedIndexes = getIntersectedIndexes();

            // 表示用データの加工
            const processedList = currentList.map(item => {
                const isSelected = !!activeFiltersMap[item.name];
                let displayCount = 0;

                if (intersectedIndexes === null) {
                    displayCount = item.bindingIndexes ? item.bindingIndexes.length : 0;
                } else {
                    if (item.bindingIndexes) {
                        displayCount = item.bindingIndexes.filter(i => intersectedIndexes.has(i)).length;
                    }
                }

                return {
                    name: item.name,
                    color: item.color || stats.configColors[targetKey],
                    isSelected: isSelected,
                    displayCount: displayCount
                };
            });

            // 順序ソート（安全対策を強化）
            processedList.sort((a, b) => {
                if (a.isSelected !== b.isSelected) return a.isSelected ? -1 : 1;
                const countA = a.displayCount || 0;
                const countB = b.displayCount || 0;
                const aAvailable = countA > 0;
                const bAvailable = countB > 0;
                if (aAvailable !== bAvailable) return aAvailable ? -1 : 1;
                return countB - countA;
            });

            // HTMLの生成
            legendTable.innerHTML = processedList.map((item, index) => {
                const useRedColor = (intersectedIndexes !== null && !item.isSelected);
                const countStyle = useRedColor 
                    ? 'color: #d32f2f; margin-left: 4px; font-weight: bold;' 
                    : 'color: #666666; margin-left: 4px;';

                return `
                    <tr class="filter-trigger-row" data-index="${index}" data-value="${item.name}" style="cursor:pointer; transition: background 0.2s; ${item.isSelected ? 'background-color: #cce5ff; border-left: 4px solid #004085;' : ''}">
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

            // 各行のクリックイベントと活性・不活性制御
            const rows = legendTable.querySelectorAll(".filter-trigger-row");
            rows.forEach(row => {
                const idx = parseInt(row.getAttribute("data-index"), 10);
                const item = processedList[idx];
                if (!item) return;

                if (item.displayCount > 0 || item.isSelected) {
                    row.style.opacity = "1";
                    row.style.pointerEvents = "auto";
                } else {
                    row.style.opacity = "0.25"; 
                    row.style.pointerEvents = "none";
                }

                row.onclick = () => {
                    const clickedValue = row.getAttribute("data-value");

                    if (activeFiltersMap[clickedValue]) {
                        delete activeFiltersMap[clickedValue]; 
                    } else {
                        const originalItem = currentList.find(c => c.name === clickedValue);
                        activeFiltersMap[clickedValue] = { 
                            ...originalItem, 
                            category: targetKey 
                        }; 
                    }

                    updateLegendTable(targetKey); 
                    updateTabVisualIndicators(); 
                };
            });
            // ─── ここから【追加】テキストエリアのリアルタイム絞り込み ───
            if (intersectedIndexes === null) {
                // 💡 フィルターが何も選択されていない（初期状態）なら、元の全テキストをそのまま表示
                textarea.value = textContent;
            } else {
                // 1. 元の全テキストを「改行」で1行ずつの配列にバラバラにする
                // (Windowsの改行 \r\n と Mac/Linuxの \n の両方に対応)
                const allLines = textContent.split(/\r?\n/);
                
                // 2. 「見出し（ヘッダー）」と「データ中身」を綺麗に分離する
                // 0番目は Subject\tObject... などの見出し
                const headerLine = allLines[0]; 
                // 1番目以降が実際のデータ行（空行やスペースだけの行は除外）
                const dataLines = allLines.slice(1).filter(line => line.trim() !== "");

                // 現在の相互連動で生き残っている「背番号（インデックス）」のSetを取得
                const allowedIndexes = intersectedIndexes;

                // 3. 生き残っている背番号と同じ「部屋番号」のデータ行だけをすくい取る
                const filteredDataLines = dataLines.filter((line, dataIdx) => {
                    // プログラムが持つ背番号（allowedIndexes）に、この行の番号（dataIdx）が含まれるか判定
                    return allowedIndexes.has(dataIdx);
                });

                // 4. 見出し行のすぐ下に、すくい取ったデータ行だけをガッチャンコする
                const regeneratedLines = [headerLine, ...filteredDataLines];

                // 5. 配列をもう一度「改行（\n）」で繋ぎ直して、1つのテキスト（文字列）に再生成！
                // 最後にテキストエリア（左側の画面）に上書きデプロイします
                textarea.value = regeneratedLines.join("\n") + "\n";
            }
        };

        // 統計テーブル（タブ）全体のクリックイベント
        statsTable.onclick = (e) => {
            const btn = e.target.closest(".stats-toggle-btn");
            if (!btn) return;

            statsTable.querySelectorAll(".stats-toggle-btn").forEach(b => b.classList.remove("active"));
            btn.classList.add("active");

            const targetKey = btn.getAttribute("data-target");
            
            // 子要素を巻き込まないように、テキストノードの先頭文字からタイトルを安全に抽出
            const rawText = btn.childNodes[1]?.textContent || btn.textContent;
            const labelText = rawText.replace(/[数]/g, '').trim(); 

            if (titleEl) titleEl.textContent = `${labelText}一覧`;
            if (noticeEl) noticeEl.textContent = "";

            updateLegendTable(targetKey);
            updateTabVisualIndicators();
        };

        // 選択クリアボタン
        const clearBtn = section.querySelector(".btn-clear-filters");
        if (clearBtn) {
            clearBtn.onclick = () => {
                activeFiltersMap = {}; 
                // 現在アクティブになっているクラスを持つボタンのキーをフォールバックに利用
                const currentActiveBtn = statsTable.querySelector(".stats-toggle-btn.active");
                const fallbackKey = currentActiveBtn ? currentActiveBtn.getAttribute("data-target") : currentActiveTab;
                
                updateLegendTable(fallbackKey);
                updateTabVisualIndicators();
            };
        }

        // 初期選択のシミュレート
        const defaultBtn = statsTable.querySelector(`.stats-toggle-btn[data-target="stakeholder"]`) || statsTable.querySelector(`.stats-toggle-btn[data-target="subject"]`);
        if (defaultBtn) defaultBtn.click();
    }
}
