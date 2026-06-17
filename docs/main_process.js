/**
 * ========================================================================
 * CCO4KG 変換・特定ID指定抽出ツール メインロジック
 * ========================================================================
 */

// ------------------------------------------------------------------------
// 1. 画面初期化 ＆ イベントリスナー登録
// ------------------------------------------------------------------------
window.addEventListener('DOMContentLoaded', () => {
    // 外部ファイル（output_CCO4KG.js）からデータが正常に読み込まれているか確認
    if (typeof window.output_json_data !== 'undefined' && window.output_json_data !== null) {
        console.log("[CCO4KG Loader] 統計・カラー完全統合プロセスを読み込みました。");
        
        // ドキュメントID選択ドロップダウンの生成
        initDocIdDropdown();
        // 設定パネルのアコーディオン開閉設定
        setupAccordion("headerOutput", "contentOutput");
        setupAccordion("headerColor", "contentColor");
        
        // 各チェックボックスの変更イベントを監視し、UIの有効/無効をリアルタイムに切り替える
        const targetIds = [
            "enableSubject", "enableObject", "enablePredicate", 
            "enableSClass", "enableOClass", "enableClassLink", 
            "enableStakeholder", "enableStClass", "enableEvidence"
        ];
        targetIds.forEach(id => document.getElementById(id).addEventListener("change", updateUIControls));
        
        // ステークホルダーの配色モード（ラジオボタン）の変更イベント監視
        document.getElementsByName("shColorMode").forEach(radio => {
            radio.addEventListener("change", updateUIControls);
        });
        
        // 変換実行ボタンのクリックイベントを設定
        document.getElementById("execBtn").addEventListener("click", splitAndProcessData);
        // 初回読み込み時のUI状態を同期
        updateUIControls();
        document.getElementById("execBtn").disabled = false;
    } else {
        // データが存在しない場合はエラーを表示
        console.error("[CCO4KG Loader] エラー: データが見つかりません。");
        const statusEl = document.getElementById("statusMessage");
        statusEl.className = "status-panel error";
        statusEl.style.display = "block";
        statusEl.textContent = "[エラー] output_CCO4KG.js からデータが見つかりません。";
    }
});

/**
 * アコーディオンメニューの開閉制御
 */
function setupAccordion(headerId, contentId) {
    const header = document.getElementById(headerId);
    const content = document.getElementById(contentId);
    const icon = header.querySelector(".toggle-icon");

    header.addEventListener("click", () => {
        const isOpen = content.classList.contains("open");
        if (isOpen) {
            content.classList.remove("open");
            icon.textContent = "▼";
        } else {
            content.classList.add("open");
            icon.textContent = "▲";
        }
    });
}

// ------------------------------------------------------------------------
// 2. 設定パネルの有効・無効リアクティブ制御 (UI連動)
// ------------------------------------------------------------------------
/**
 * 各種要素のチェック状態に応じて、関連するカラーピッカーや設定項目の有効/無効（グレーアウト）を制御する
 */
function updateUIControls() {
    let sEnabled = document.getElementById("enableSubject").checked;
    let oEnabled = document.getElementById("enableObject").checked;
    let pEnabled = document.getElementById("enablePredicate").checked;
    let sClassEnabled = document.getElementById("enableSClass").checked;
    let oClassEnabled = document.getElementById("enableOClass").checked;
    let classLinkEnabled = document.getElementById("enableClassLink").checked;
    
    const shEnabled = document.getElementById("enableStakeholder").checked;
    const stClassEnabled = document.getElementById("enableStClass").checked;
    const evEnabled = document.getElementById("enableEvidence").checked;

    // 【主語・目的語の依存】双方が有効でない場合、述語（エッジ）の設定は強制無効
    const cbPredicate = document.getElementById("enablePredicate");
    if (!sEnabled || !oEnabled) {
        cbPredicate.disabled = true;
        cbPredicate.checked = false;
        pEnabled = false;
    } else {
        cbPredicate.disabled = false;
    }

    // 【主語クラス・目的語クラスの依存】双方が有効でない場合、クラス間リンクは強制無効
    const cbClassLink = document.getElementById("enableClassLink");
    if (!sClassEnabled || !oClassEnabled) {
        cbClassLink.disabled = true;
        cbClassLink.checked = false;
        classLinkEnabled = false;
    } else {
        cbClassLink.disabled = false;
    }

    // 【インスタンス番号付与の依存】主語・目的語のどちらもチェックがない場合は無効化
    const cbSoNum = document.getElementById("enableSubjectObjectNumbering");
    if (!sEnabled && !oEnabled) {
        cbSoNum.disabled = true;
        cbSoNum.checked = false;
    } else {
        cbSoNum.disabled = false;
    }

    // 要素の有効・無効スタイル（不透明度）を切り替える汎用関数
    const toggleElementPalette = (id, enabled) => {
        const el = document.getElementById(id);
        el.disabled = !enabled;
        el.parentElement.style.opacity = enabled ? "1.0" : "0.3";
    };

    // 各要素のカラーパレット（カラーピッカー）の制御
    toggleElementPalette("cpSubject", sEnabled);
    toggleElementPalette("cpObject", oEnabled);
    toggleElementPalette("cpPredicate", pEnabled);
    toggleElementPalette("cpSClass", sClassEnabled);
    toggleElementPalette("cpOClass", oClassEnabled);
    toggleElementPalette("cpSClassEdge", classLinkEnabled);

    // ステークホルダー関連コントロールの制御
    document.getElementById("enableStakeholderNumbering").disabled = !shEnabled;
    document.getElementById("enableStClass").disabled = !shEnabled;
    document.getElementById("secShColor").style.opacity = shEnabled ? "1.0" : "0.3";
    document.getElementsByName("shColorMode").forEach(r => r.disabled = !shEnabled);

    // 選択されている配色モード（ランダム/固定/グループ）を取得
    const selectedMode = document.querySelector('input[name="shColorMode"]:checked')?.value || "random";
    const isFixed = (selectedMode === "select");
    const isRandom = (selectedMode === "random");

    // 「単一固定指定」モードのときのみ、ステークホルダー全体の固定カラーピッカーを有効化
    toggleElementPalette("cpStakeholder", shEnabled && isFixed);
    document.getElementById("shFixedColorRow").style.opacity = (shEnabled && isFixed) ? "1.0" : "0.3";

    // ステークホルダーの所属クラス（stClass）用カラーピッカーの有効化条件判定
    const stClassActive = shEnabled && stClassEnabled && (isRandom || isFixed);
    toggleElementPalette("cpStClass", stClassActive);
    document.getElementById("stClassColorRow").style.opacity = stClassActive ? "1.0" : "0.3";

    // 根拠（Evidence）セクションの制御
    toggleElementPalette("cpEvidence", evEnabled);
    document.getElementById("secEvColor").style.opacity = evEnabled ? "1.0" : "0.3";
}

// ------------------------------------------------------------------------
// 3. データ処理ユーティリティ
// ------------------------------------------------------------------------
// ステークホルダーのランダムカラー決定時に使用するカラーパレット（パステルカラー20色）
const SPEAKER_PALETTE = [
    "#FFB3BA", "#FFDFBA", "#FFFFBA", "#BAFFC9", "#BAE1FF",
    "#E8B4B8", "#F2D1B3", "#EDE8B7", "#BCE6CD", "#B5D5E6",
    "#FAD2E1", "#E2ECE9", "#BEE3DB", "#89B0A5", "#E0BBE4",
    "#957DAD", "#D291BC", "#FEC8D8", "#FFDFD3", "#D8E2DC"
];

/**
 * JSON内のエスケープされたUnicode（\uXXXX）を通常の日本語文字列にデコードする
 */
function decodeFromUnicode(str) {
    if (!str) return "";
    return str.replace(/\\u([0-9a-fA-F]{4})/g, (match, grp) => String.fromCharCode(parseInt(grp, 16)));
}

/**
 * データクレンジング（デコード、スペース除去、@jaタグの削除、ダブルクォーテーションの除去）
 */
function clean(input) {
    if (!input) return "";
    return decodeFromUnicode(input).replace(/ /g, "").replace(/@ja/g, "").replace(/"/g, "").trim();
}

/**
 * SPARQL結果の変数バインディングから安全に値を取り出す
 */
function getValueFromBinding(binding, key) {
    return (binding && binding[key]) ? (binding[key].value || "") : "";
}

/**
 * URI文字列から、末尾の個別ID（ローカルネーム）部分のみを抽出する
 */
function extractIdFromUri(uriString) {
    if (!uriString) return "";
    const cleanUri = clean(uriString);
    const parts = cleanUri.split('/');
    return parts[parts.length - 1] || "";
}

/**
 * カラーピッカーの16進数カラーコードを、指定した係数(factor)で乗算して暗くしたカラーコードを返す
 */
function darkenColor(hexColor, factor) {
    if (!hexColor || !hexColor.startsWith("#") || hexColor.length !== 7) return "#adadad";
    try {
        let r = Math.max(0, Math.floor(parseInt(hexColor.substring(1, 3), 16) * factor));
        let g = Math.max(0, Math.floor(parseInt(hexColor.substring(3, 5), 16) * factor));
        let b = Math.max(0, Math.floor(parseInt(hexColor.substring(5, 7), 16) * factor));
        return `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`;
    } catch (e) { return hexColor; }
}

/**
 * 初期化時に全データから一意のドキュメントID（グラフ名 g）を抽出し、セレクトボックス（ドロップダウン）を構築する
 */
function initDocIdDropdown() {
    const bindings = window.output_json_data.results.bindings;
    const selectEl = document.getElementById("targetDocId");
    const idSet = new Set();
    
    for (let i = 0; i < bindings.length; i++) {
        let rawDocUri = getValueFromBinding(bindings[i], "g") || getValueFromBinding(bindings[i], "?g");
        if (rawDocUri) idSet.add(extractIdFromUri(rawDocUri));
    }
    
    // アルファベット順にソートしてoptionタグを追加
    Array.from(idSet).sort().forEach(docId => {
        const option = document.createElement("option");
        option.value = docId;
        option.textContent = docId;
        selectEl.appendChild(option);
    });
}

/**
 * 検索中アニメーション（スピナー）を表示
 */
function showSearchIng(resultArea) {
    const orgDiv = resultArea.innerHTML;
    resultArea.innerHTML = orgDiv + '<div id="searching"><h2>検索中...</h2>'
       + '<div class="flower-spinner"><div class="dots-container">'
       + '<div class="bigger-dot"><div class="smaller-dot"></div>'
       + '</div></div></div><br></div>';
}

/**
 * 検索中アニメーション（スピナー）を削除
 */
function removeSearchIng() {
    const searchingDiv = document.getElementById("searching");
    if (searchingDiv != null) searchingDiv.remove();
}

// ------------------------------------------------------------------------
// 4. メイン変換処理 ＆ 依存関係ロジック
// ------------------------------------------------------------------------
/**
 * 画面上の設定パラメータをすべて読み込み、生データを処理して3部形式（ノード・エッジテキスト）に変換・出力するメイン関数
 */
function splitAndProcessData() {
    const execBtn = document.getElementById("execBtn");
    const outputContainer = document.getElementById("outputContainer");
    
    if (execBtn) execBtn.disabled = true;
    outputContainer.innerHTML = ""; 
    showSearchIng(outputContainer);

    // UIの描画更新（スピナー表示）を確実に挟むため、setTimeoutで処理を非同期に遅延実行
    setTimeout(() => {
        try {
            const bindings = window.output_json_data.results.bindings;
            const shEnabledRaw = document.getElementById("enableStakeholder").checked;
            const sEnabled = document.getElementById("enableSubject").checked;
            const oEnabled = document.getElementById("enableObject").checked;
            const sClassEnabled = document.getElementById("enableSClass").checked;
            const oClassEnabled = document.getElementById("enableOClass").checked;

            // 各種コントロール設定値の集約オブジェクト
            const config = {
                sEnabled: sEnabled,
                oEnabled: oEnabled,
                pEnabled: sEnabled && oEnabled && document.getElementById("enablePredicate").checked, 
                sClassEnabled: sClassEnabled,
                oClassEnabled: oClassEnabled,
                classLinkEnabled: sClassEnabled && oClassEnabled && document.getElementById("enableClassLink").checked, 
                shEnabled: shEnabledRaw,
                evEnabled: document.getElementById("enableEvidence").checked,
                shNum: shEnabledRaw && document.getElementById("enableStakeholderNumbering").checked,
                stClass: shEnabledRaw && document.getElementById("enableStClass").checked,
                soNum: document.getElementById("enableSubjectObjectNumbering").checked,
                targetId: document.getElementById("targetDocId").value,
                shColorMode: document.querySelector('input[name="shColorMode"]:checked').value,
                cSubj: document.getElementById("cpSubject").value,
                cObj: document.getElementById("cpObject").value,
                cPred: document.getElementById("cpPredicate").value,
                cSClass: document.getElementById("cpSClass").value,
                cOClass: document.getElementById("cpOClass").value,
                cSClassEdge: document.getElementById("cpSClassEdge").value, 
                cEv: document.getElementById("cpEvidence").value,
                cStClass: document.getElementById("cpStClass").value,
                cFixedSH: document.getElementById("cpStakeholder").value,
                cDefaultEdge: "#adadad" // 標準の接続線（トリプルIDからの仲介線など）の色
            };

            // ドキュメントIDごとにデータをグループ分けする
            let docGroups = {};
            for (let i = 0; i < bindings.length; i++) {
                let b = bindings[i];
                let docId = extractIdFromUri(getValueFromBinding(b, "g") || getValueFromBinding(b, "?g"));
                
                // ドロップダウンで特定IDが指定されており、それに合致しない場合はスキップ
                if (config.targetId !== "" && docId !== config.targetId) continue; 
                
                // 全件一括出力の場合は固定キー、個別指定の場合はドキュメントIDをグループキーとする
                let groupKey = (config.targetId === "") ? "ALL_DOCUMENTS" : docId;
                if (!docGroups[groupKey]) docGroups[groupKey] = [];
                docGroups[groupKey].push({ binding: b, originalDocId: docId });
            }

            if (Object.keys(docGroups).length === 0) {
                removeSearchIng();
                alert("該当するデータが見つかりませんでした。");
                if (execBtn) execBtn.disabled = false;
                return;
            }

            let globalColorCounter = 0; // ランダム配色用カラーインデックス
            removeSearchIng();

            // グループ（ドキュメント）ごとにテキスト生成・統計処理を実行
            for (let groupKey in docGroups) {
                let wrappedBindings = docGroups[groupKey];
                
                // 特定ドキュメントローカル内での出現数カウント・カラーマップ用変数
                const wordAppearanceMap = {}; 
                const localSpeakerColorMap = {}; 
                const localStClassColorMap = {}; 
                const finalSpeakerColorMap = {}; 
                const finalStClassColorMap = {}; 

                // 統計表示用：重複のない一意の要素セット
                const uniqueSubjects = new Set();
                const uniqueObjects = new Set();
                const uniqueSClasses = new Set();
                const uniqueOClasses = new Set();
                const uniqueStakeholders = new Set();
                const uniqueOpinions = new Set();
                const uniqueEvidences = new Set();
                const uniqueTriples = new Set();
                const tripleLabelMap = {}; // 表記用ラベルマッピング

                // 各構成要素の正確な出現回数（件数）集計用マップ
                const jsonCountMap = {
                    stakeholder: {}, subject: {}, object: {}, sClass: {}, oClass: {}, evidence: {}, opinion: {}, triple: {}
                };

                // ステークホルダー単位（個別ランダム）の配色処理
                function getIndividualSpeakerColor(shId) {
                    if (localSpeakerColorMap[shId]) return localSpeakerColorMap[shId];
                    let color = SPEAKER_PALETTE[globalColorCounter % SPEAKER_PALETTE.length];
                    localSpeakerColorMap[shId] = color;
                    globalColorCounter++;
                    return color;
                }

                // 所属クラス（stClassグループ）単位の配色処理
                function getGroupStClassColor(stClassId) {
                    if (localStClassColorMap[stClassId]) return localStClassColorMap[stClassId];
                    let color = SPEAKER_PALETTE[globalColorCounter % SPEAKER_PALETTE.length];
                    localStClassColorMap[stClassId] = color;
                    globalColorCounter++;
                    return color;
                }

                // UI設定（配色モード）に基づく最終的な色の確定処理
                function resolveColors(shId, stClassId) {
                    if (config.shColorMode === "select") { // 単一固定指定
                        finalSpeakerColorMap[shId] = config.cFixedSH;
                        if (stClassId !== "") finalStClassColorMap[stClassId] = config.cStClass;
                        return;
                    }
                    if (config.shColorMode === "group") { // クラスグループ配色
                        if (stClassId !== "") {
                            let groupColor = getGroupStClassColor(stClassId);
                            finalStClassColorMap[stClassId] = groupColor; 
                            finalSpeakerColorMap[shId] = darkenColor(groupColor, 0.85); // 判別のため、ステークホルダー本体の色をやや暗く補正
                        } else if (!finalSpeakerColorMap[shId]) {
                            finalSpeakerColorMap[shId] = getIndividualSpeakerColor(shId);
                        }
                        return;
                    }
                    if (config.shColorMode === "random") { // 完全ランダム配色
                        finalSpeakerColorMap[shId] = getIndividualSpeakerColor(shId);
                        if (stClassId !== "") finalStClassColorMap[stClassId] = config.cStClass; 
                    }
                }

                // 冗長な重複接続線（リンク出力）を防止するための既出チェック用Set
                const classLinkSet = new Set(); 
                const metadataLinkSet = new Set(); 
                const comboToTrMap = {}; // 完全に同一の[主語|述語|目的語]トリプルに対して同一の「T番号」を維持するためのマップ
                let trCounter = 0; // トリプル通し番号カウンター
                let docOutputBuffer = ""; // タブ区切りテキストの一時保存バッファ
                
                const stakeholderLabelMap = {}; 
                const stClassLabelMap = {};
                const idToUriMap = { subject: {}, object: {}, sClass: {}, oClass: {}, evidence: {} }; // 凡例クリック時追跡用のURI保持

                // 【第1期ループ】全データを事前に巡回し、ステークホルダー名やクラス名のラベル確定、および配色カラーの事前決定を完了させる
                for (let item of wrappedBindings) {
                    let b = item.binding;
                    let shId = extractIdFromUri(getValueFromBinding(b, "stakeholder"));
                    let stClassId = extractIdFromUri(getValueFromBinding(b, "stClass") || getValueFromBinding(b, "?stClass"));
                    let cleanShName = clean(getValueFromBinding(b, "stakeholderLabel"));
                    
                    // 「個人」などの意味を持たない空データやメタデータは集計・描画のノイズになるためスキップ
                    if (/^(【個人】|個人|)$/.test(cleanShName)) continue;

                    let shLabel = "st_" + cleanShName;
                    let stClassLabel = "stc_" + clean(getValueFromBinding(b, "stClassLabel"));
                    if (shId !== "") {
                        stakeholderLabelMap[shId] = shLabel;
                        if (stClassId !== "") stClassLabelMap[stClassId] = stClassLabel;
                        if (!finalSpeakerColorMap[shId]) resolveColors(shId, stClassId);
                    }
                }
                
                const legendDisplayColorMap = {};
                const shExactCountMap = {};

                // 【第2期ループ】メインのテキスト変換および構造化データ（Cytoscape用接続定義）の生成展開
                for (let item of wrappedBindings) {
                    let b = item.binding;
                    let currentDocId = item.originalDocId; 

                    // 各リレーション要素のURIおよび個別IDを取得
                    let sUri = getValueFromBinding(b, "s");
                    let sClassUri = getValueFromBinding(b, "sClass");
                    let oUri = getValueFromBinding(b, "o");
                    let oClassUri = getValueFromBinding(b, "oClass");
                    let shUri = getValueFromBinding(b, "stakeholder");
                    let opUri = getValueFromBinding(b, "opinion");
                    let evUri = getValueFromBinding(b, "evidence");

                    let sId = extractIdFromUri(sUri);
                    let sClassId = extractIdFromUri(sClassUri);
                    let pId = extractIdFromUri(getValueFromBinding(b, "p"));
                    let oId = extractIdFromUri(oUri);
                    let oClassId = extractIdFromUri(oClassUri);
                    let shId = extractIdFromUri(shUri);
                    let stClassId = extractIdFromUri(getValueFromBinding(b, "stClass") || getValueFromBinding(b, "?stClass"));
                    let opId = extractIdFromUri(opUri);

                    // 表示用ラベルテキストのクレンジング
                    let sLabelRaw = clean(getValueFromBinding(b, "sLabel"));
                    let oLabelRaw = clean(getValueFromBinding(b, "oLabel"));
                    let shLabelRaw = clean(getValueFromBinding(b, "stakeholderLabel"));
                    let opContentRaw = clean(getValueFromBinding(b, "opinionContent"));
                    let evContentRaw = clean(getValueFromBinding(b, "evidence"));
                    let sClassLabelRaw = clean(getValueFromBinding(b, "sClassLabel"));
                    let oClassLabelRaw = clean(getValueFromBinding(b, "oClassLabel"));
                    let stClassLabelRaw = clean(getValueFromBinding(b, "stClassLabel"));

                    // 各ノードの接頭辞を付与した内部管理用識別名（一意なキー）
                    let sLabel = "s_" + sLabelRaw;
                    let sClassLabel = "sc_" + sClassLabelRaw;
                    let pLabel = clean(getValueFromBinding(b, "pLabel")); 
                    let oLabel = "o_" + oLabelRaw;
                    let ocLabel = "oc_" + oClassLabelRaw;
                    let shLabel_cleansed = "st_" + shLabelRaw;
                    let stClassLabel = "stc_" + stClassLabelRaw;
                    let evContent = "ev_" + evContentRaw;

                    // ナレッジグラフの基本コアとなる主語・目的語が存在しない場合は処理をスキップ
                    if (sId === "" || oId === "") continue;

                    // 凡例から外部情報へのリンクを可能にするため、URIをマッピング保管
                    if (sId !== "") idToUriMap.subject[sLabel] = sUri;
                    if (oId !== "") idToUriMap.object[oLabel] = oUri;
                    if (sClassId !== "" && sClassLabelRaw) idToUriMap.sClass[sClassLabel] = sClassUri;
                    if (oClassId !== "" && oClassLabelRaw) idToUriMap.oClass[ocLabel] = oClassUri;
                    if (evContentRaw !== "") idToUriMap.evidence[evContent] = evUri || "ローカルデータ";

                    // 同一リレーションに対するユニークID（T0, T1...）の割り当て判定
                    let comboKeyForId = `${currentDocId}_${sId}|${pId}|${oId}`;
                    let isFirstTimeTr = false;
                    
                    if (!comboToTrMap[comboKeyForId]) {
                        comboToTrMap[comboKeyForId] = "T" + trCounter;
                        trCounter++;
                        isFirstTimeTr = true; // このドキュメント内で初めて出現したトリプル
                    }
                    let trId = comboToTrMap[comboKeyForId]; 

                    let tripleMapKey = `${sLabelRaw} | ${pLabel} | ${oLabelRaw}`;
                    let tripleDisplayLabel = `${trId}_${sLabelRaw}_${pLabel}_${oLabelRaw}`; 

                    // 統計収集用のセットおよびカウンター登録
                    uniqueTriples.add(tripleMapKey);
                    tripleLabelMap[tripleMapKey] = tripleDisplayLabel;
                    jsonCountMap.triple[tripleMapKey] = (jsonCountMap.triple[tripleMapKey] || 0) + 1;

                    if (sId !== "") uniqueSubjects.add(sLabel);
                    if (oId !== "") uniqueObjects.add(oLabel);
                    if (sClassId !== "" && sClassLabelRaw) uniqueSClasses.add(sClassLabel);
                    if (oClassId !== "" && oClassLabelRaw) uniqueOClasses.add(ocLabel);
                    if (shId !== "" && shLabelRaw) uniqueStakeholders.add(shId);
                    if (opId !== "" && opContentRaw) uniqueOpinions.add(opContentRaw);
                    if (evContentRaw !== "") uniqueEvidences.add(evContent);

                    if (sId !== "") jsonCountMap.subject[sLabel] = (jsonCountMap.subject[sLabel] || 0) + 1;
                    if (oId !== "") jsonCountMap.object[oLabel] = (jsonCountMap.object[oLabel] || 0) + 1;
                    if (sClassId !== "" && sClassLabelRaw) jsonCountMap.sClass[sClassLabel] = (jsonCountMap.sClass[sClassLabel] || 0) + 1;
                    if (oClassId !== "" && oClassLabelRaw) jsonCountMap.oClass[ocLabel] = (jsonCountMap.oClass[ocLabel] || 0) + 1;
                    if (evContentRaw !== "") jsonCountMap.evidence[evContent] = (jsonCountMap.evidence[evContent] || 0) + 1;

                    // 【重複分離ナンバリング】設定が有効な場合、ノード名の末尾にトリプルID（_T0など）を付与してグラフ上でノードを分離独立させる
                    let displaySLabel = config.soNum ? `${sLabel}_${trId}` : sLabel;
                    let displayOLabel = config.soNum ? `${oLabel}_${trId}` : oLabel;

                    let shNodeName = "";
                    let speakerColor = config.cFixedSH;
                    if (shId !== "" && shLabelRaw) {
                        shNodeName = shLabel_cleansed;
                        let stCount = (wordAppearanceMap[shId] || 0) + 1;
                        wordAppearanceMap[shId] = stCount;
                        
                        // ステークホルダー重複分離（発話ごとに独立したノードにする場合）
                        shNodeName = config.shNum ? `${shNodeName}_${stCount}` : shNodeName;
                        speakerColor = finalSpeakerColorMap[shId] || config.cFixedSH;

                        shExactCountMap[shLabel_cleansed] = (shExactCountMap[shLabel_cleansed] || 0) + 1;
                        jsonCountMap.stakeholder[shNodeName] = (jsonCountMap.stakeholder[shNodeName] || 0) + 1;
                        
                        if (opContentRaw) jsonCountMap.opinion[opContentRaw] = (jsonCountMap.opinion[opContentRaw] || 0) + 1;

                        if (config.shColorMode === "group") {
                            const className = stClassLabelMap[stClassId] || "不明な分類";
                            legendDisplayColorMap[`stClass_${stClassId}`] = { name: `【分類】${className}`, color: finalStClassColorMap[stClassId], uri: sClassUri };
                        }
                        legendDisplayColorMap[`sh_${shId}`] = { name: `${shLabel_cleansed}`, color: speakerColor, uri: shUri };
                    }

                    // 一括出力モードの場合は先頭列にドキュメントIDを出力、個別モードの場合はIDを排除
                    let prefix = (config.targetId === "") ? `${currentDocId}\t` : "";
                    
                    // 【ノード接続ロジック定義】
                    if (isFirstTimeTr) {
                        // コアトリプル（主語 -> 述語 -> 目的語）の直接接続定義の書き出し
                        if (config.pEnabled) {
                            docOutputBuffer += `${prefix}${displaySLabel}\t${pLabel}\t${displayOLabel}\t${config.cSubj}\t${config.cObj}\t${config.cPred}\n`;
                        }
                        // トリプルIDノード（仲介点）から主語への接続（主語単体の独立出力が有効な場合）
                        if (config.sEnabled) {
                            docOutputBuffer += `${prefix}${trId}\t主語\t${displaySLabel}\t${config.cDefaultEdge}\t${config.cSubj}\t${config.cSubj}\n`;
                        } else if (config.sClassEnabled && sClassId !== "" && sClassLabelRaw) {
                            // 主語インスタンスが非表示だが主語クラスが有効な場合、トリプルIDからクラスへ直接接続（孤立防止）
                            let directSClassKey = `${currentDocId}_${trId}_direct_sClass_${sClassId}`;
                            if (!classLinkSet.has(directSClassKey)) {
                                classLinkSet.add(directSClassKey);
                                docOutputBuffer += `${prefix}${trId}\tsClass\t${sClassLabel}\t${config.cDefaultEdge}\t${config.cSClass}\t${config.cSClass}\n`;
                            }
                        }
                        // トリプルIDノード（仲介点）から目的語への接続
                        if (config.oEnabled) {
                            docOutputBuffer += `${prefix}${trId}\t目的語\t${displayOLabel}\t${config.cDefaultEdge}\t${config.cObj}\t${config.cObj}\n`;
                        } else if (config.oClassEnabled && oClassId !== "" && oClassLabelRaw) {
                            // 目的語インスタンスが非表示だが目的語クラスが有効な場合、トリプルIDからクラスへ直接接続（孤立防止）
                            let directOClassKey = `${currentDocId}_${trId}_direct_oClass_${oClassId}`;
                            if (!classLinkSet.has(directOClassKey)) {
                                classLinkSet.add(directOClassKey);
                                docOutputBuffer += `${prefix}${trId}\toClass\t${ocLabel}\t${config.cOClass}\t${config.cOClass}\n`;
                            }
                        }
                    }

                    // 主語インスタンスから主語クラス（sClass）への接続定義
                    if (config.sEnabled && config.sClassEnabled && sClassId !== "" && sClassLabelRaw) {
                        let sClassKey = `${currentDocId}_${displaySLabel}_to_sClass_${sClassId}`;
                        if (!classLinkSet.has(sClassKey)) {
                            classLinkSet.add(sClassKey);
                            docOutputBuffer += `${prefix}${displaySLabel}\tsClass\t${sClassLabel}\t${config.cSubj}\t${config.cSClass}\t${config.cSClass}\n`;
                        }
                    }
                    // 目的語インスタンスから目的語クラス（oClass）への接続定義
                    if (config.oEnabled && config.oClassEnabled && oClassId !== "" && oClassLabelRaw) {
                        let oClassKey = `${currentDocId}_${displayOLabel}_to_oClass_${oClassId}`;
                        if (!classLinkSet.has(oClassKey)) {
                            classLinkSet.add(oClassKey);
                            docOutputBuffer += `${prefix}${displayOLabel}\toClass\t${ocLabel}\t${config.cObj}\t${config.cOClass}\t${config.cOClass}\n`;
                        }
                    }
                    // 主語クラスから目的語クラスへの直接リンク定義（マッピング知識用）
                    if (config.classLinkEnabled && sClassId !== "" && oClassId !== "" && sClassLabelRaw && oClassLabelRaw) {
                        let sToOClassKey = `${currentDocId}_${trId}_${sClassId}_to_${oClassId}`;
                        if (!classLinkSet.has(sToOClassKey)) {
                            classLinkSet.add(sToOClassKey);
                            docOutputBuffer += `${prefix}${sClassLabel}\t-\t${ocLabel}\t${config.cSClass}\t${config.cOClass}\t${config.cSClassEdge}\n`;
                        }
                    }
                    // トリプルIDからエビデンス（根拠文献等）への接続定義
                    if (config.evEnabled && evContentRaw !== "") {
                        let safeEvContent = evContent.replace(/\n/g, " "); // 改行によるテキスト崩れ防止
                        let trToEvidenceKey = `${currentDocId}_${trId}_evidence_${safeEvContent}`;
                        if (!metadataLinkSet.has(trToEvidenceKey)) {
                            metadataLinkSet.add(trToEvidenceKey);
                            docOutputBuffer += `${prefix}${trId}\tevidence\t${safeEvContent}\t${config.cDefaultEdge}\t${config.cEv}\t${config.cEv}\n`;
                        }
                    }

                    // ステークホルダーおよびその発言（意見オピニオン）をトリプルIDへ紐付ける定義
                    if (config.shEnabled && opId !== "" && opContentRaw) {
                        let opinionColor = darkenColor(speakerColor, 0.80); 
                        let trToOpinionKey = `${currentDocId}_${trId}_instance_${opId}`;
                        if (!metadataLinkSet.has(trToOpinionKey)) {
                            metadataLinkSet.add(trToOpinionKey);
                            docOutputBuffer += `${prefix}${shNodeName}\t意見\t${trId}\t${opinionColor}\t${config.cDefaultEdge}\t${config.cDefaultEdge}\n`;
                        }

                        if (shId && shLabelRaw) {
                            let opinionToSpeakerKey = `${currentDocId}_${opId}_speaker_${shNodeName}`;
                            if (!metadataLinkSet.has(opinionToSpeakerKey)) {
                                metadataLinkSet.add(opinionToSpeakerKey);
                                docOutputBuffer += `${prefix}${opContentRaw}\tステークホルダー\t${shNodeName}\t${opinionColor}\t${speakerColor}\t${speakerColor}\n`;
                            }

                            // ステークホルダーが属するクラス（stClass、有識者・自治体など）へのリンク定義
                            if (config.stClass && stClassId && stClassLabelRaw) {
                                let currentStClassColor = finalStClassColorMap[stClassId] || config.cStClass;
                                let stClassKey = `${currentDocId}_${shNodeName}_stClass_${stClassId}`;
                                if (!classLinkSet.has(stClassKey)) {
                                    classLinkSet.add(stClassKey);
                                    docOutputBuffer += `${prefix}${shNodeName}\tstClass\t${stClassLabel}\t${speakerColor}\t${currentStClassColor}\t${currentStClassColor}\n`;
                                }
                            }
                        }
                    }
                }
                
                // =================================================================
                // --- 5. 各種要素の一覧リストの抽出・オブジェクト組み立て ---
                // =================================================================
                // カウント順（降順）ソート、同数の場合は文字列の辞書順でソートする比較関数
                const sortByCountDesc = (a, b) => b.count - a.count || a.name.localeCompare(b.name, 'ja');

                // 凡例表示用のステークホルダーリストの構築
                const customColorList = [];
                if (config.shEnabled) {
                    const seenNames = new Set();
                    Object.keys(legendDisplayColorMap).forEach(key => {
                        const item = legendDisplayColorMap[key];
                        if (!item.name || /^(st_(|【個人】|個人))$/.test(item.name)) return;
        
                        if (!seenNames.has(item.name)) {
                            seenNames.add(item.name);
                            customColorList.push({
                                name: item.name, color: item.color, count: shExactCountMap[item.name] || 0, uri: item.uri
                            });
                        }
                    });
                    customColorList.sort(sortByCountDesc);
                }

                // 各カテゴリ一覧（主語・目的語・クラス等）のリソース配列を生成する汎用生成クロージャ
                const createList = (uniqueSet, color, countMap, uriMap) => 
                    Array.from(uniqueSet).map(name => ({
                        name, color, count: countMap[name] || 0, uri: uriMap[name]
                    })).sort(sortByCountDesc);

                const subjList = createList(uniqueSubjects, config.cSubj, jsonCountMap.subject, idToUriMap.subject);
                const objList = createList(uniqueObjects, config.cObj, jsonCountMap.object, idToUriMap.object);
                const sClassList = createList(uniqueSClasses, config.cSClass, jsonCountMap.sClass, idToUriMap.sClass);
                const oClassList = createList(uniqueOClasses, config.cOClass, jsonCountMap.oClass, idToUriMap.oClass);
                const evList = createList(uniqueEvidences, config.cEv, jsonCountMap.evidence, idToUriMap.evidence);

                // 意見（オピニオン）一覧配列の構築
                const opList = [];
                if (config.shEnabled) {
                    const seenOpinions = new Set();
                    for (let item of wrappedBindings) {
                        let b = item.binding;
                        let opContentRaw = clean(getValueFromBinding(b, "opinionContent"));
                        if (/^(【個人】|個人|)$/.test(opContentRaw)) continue;

                        let opId = extractIdFromUri(getValueFromBinding(b, "opinion") || getValueFromBinding(b, "?opinion"));
                        if (opId && !seenOpinions.has(opContentRaw)) {
                            seenOpinions.add(opContentRaw);
                            let shId = extractIdFromUri(getValueFromBinding(b, "stakeholder"));
                            opList.push({
                                name: opContentRaw,
                                color: (shId && finalSpeakerColorMap?.[shId]) || "#adadad",
                                count: jsonCountMap.opinion[opContentRaw] || 0,
                                uri: getValueFromBinding(b, "opinion")
                            });
                        }
                    }
                    opList.sort(sortByCountDesc);
                }

                // トリプル（関係性）一覧の構築。これのみID順（T0, T1, T2...）でソート
                const tripleList = Array.from(uniqueTriples).map(key => ({
                    name: tripleLabelMap[key], color: config.cPred, count: jsonCountMap.triple[key] || 0, isTriple: true
                })).sort((a, b) => parseInt(a.name.match(/^T(\d+)_/)[1], 10) - parseInt(b.name.match(/^T(\d+)_/)[1], 10));

                // 配色方法に応じた凡例のヘッダータイトル動的切り替え
                let dynamicTitle = "ステークホルダー";
                if (config.shEnabled) {
                    if (config.shColorMode === "group") dynamicTitle = "stClass";
                    else if (config.shColorMode === "select") dynamicTitle = "単一固定指定";
                }

                // 描画関数へ渡す最終統計情報サマリーの格納
                const statsSummary = {
                    titleName: dynamicTitle, tripleCount: trCounter, subjectCount: uniqueSubjects.size,
                    objectCount: uniqueObjects.size, sClassCount: uniqueSClasses.size, oClassCount: uniqueOClasses.size,
                    stakeholderCount: uniqueStakeholders.size, opinionCount: uniqueOpinions.size, evidenceCount: uniqueEvidences.size,
                    sEnabled: config.sEnabled, oEnabled: config.oEnabled, sClassEnabled: config.sClassEnabled,
                    oClassEnabled: config.oClassEnabled, shEnabled: config.shEnabled, evEnabled: config.evEnabled,
                    cSubj: config.cSubj, cObj: config.cObj, cPred: config.cPred, cSClass: config.cSClass,
                    cOClass: config.cOClass, cEv: config.cEv,
                    lists: {
                        stakeholder: customColorList, subject: subjList, object: objList,
                        sClass: sClassList, oClass: oClassList, evidence: evList, opinion: opList, triple: tripleList 
                    }
                };

                // 生成した文字列バッファと統計をDOMレンダラーへ転送
                createDocumentSection((groupKey === "ALL_DOCUMENTS") ? "ALL_DOCUMENTS" : groupKey, docOutputBuffer, statsSummary);
            }
        } catch (error) {
            console.error(error);
            removeSearchIng();
            alert("変換処理中にエラーが発生しました。");
        } finally {
            if (execBtn) execBtn.disabled = false;
        }
    }, 50);
}

// ------------------------------------------------------------------------
// 6. 出力コンテナ（左右2ペイン構造）のHTMLレンダリング描画
// ------------------------------------------------------------------------
/**
 * 画面下部の出力エリアに、1つのドキュメント単位の「タブ区切りテキスト」出力枠と「左側インタラクティブ凡例パネル」のUIを生成・描画する
 */
function createDocumentSection(docId, textContent, stats) {
    const container = document.getElementById("outputContainer");
    const isAllDoc = (docId === "ALL_DOCUMENTS");

    const section = document.createElement("div");
    section.className = "doc-section";

    const textarea = document.createElement("textarea");
    textarea.readOnly = true;
    textarea.value = textContent; 

    const alertCopied = () => alert(`${docId} のデータをコピーしました。`);

    // 動的HTML構造（統計数表示テーブル、およびスクロール凡例用のプレースホルダーをインジェクション）
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
                        <!-- 操作プレビュー補助テキスト（トリプルと通常要素で案内メッセージがリアクティブ変化） -->
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

    // コピーボタンの動作設定
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

    // 単一ドキュメント抽出モード時のみ、クリック連動のインタラクティブ凡例テーブルを有効化
    if (!isAllDoc) {
        const legendTable = document.getElementById(`dynamic-legend-table-${docId}`);
        const titleEl = document.getElementById(`legend-current-title-${docId}`);
        const noticeEl = document.getElementById(`legend-notice-${docId}`);
        let currentFilterTarget = null; // 現在選択中のハイライト/フィルタ項目を記憶

        /**
         * 選択された統計カテゴリ（主語、トリプル、ステークホルダー等）に応じて、下部のスクロールテーブルの中身を再描画する内包関数
         */
        const updateLegendTable = (targetKey) => {
            const currentList = stats.lists[targetKey] || [];
            
            if (currentList.length === 0) {
                legendTable.innerHTML = `<tr><td style="color:#888; font-style:italic; padding:5px; font-size:1em;">データがありません</td></tr>`;
                return;
            }

            // 各要素の行（カラーボックス、名称、出現件数）を出力
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

            // 各行に対してクリックイベントリスナーをマッピング
            legendTable.querySelectorAll(".filter-trigger-row").forEach(row => {
                row.onclick = () => {
                    const clickedValue = row.getAttribute("data-value");
                    const idx = parseInt(row.getAttribute("data-index"), 10);
                    const item = currentList[idx];

                    if (item.isTriple) {
                        // 【トリプル型フィルタ】クリック時、右側のテキストエリアの内容を、そのトリプルID（T0, T1など）が含まれる接続定義行のみに絞り込む
                        const allLines = textContent.split("\n");
                        if (currentFilterTarget === clickedValue) {
                            currentFilterTarget = null;
                            textarea.value = textContent; // トグル解除時は全体表示に戻す
                        } else {
                            currentFilterTarget = clickedValue;
                            const trPrefix = clickedValue.split('_')[0]; // 先頭の "T0" などの文字列を取得
                            textarea.value = allLines.filter(line => line.split('\t')[2] === trPrefix).join("\n");
                        }
                    } else {
                        // 【ノード型ハイライト】同画面内にCytoscapeインスタンス(window.cy)がある場合、該当ノードを一括強調表示する
                        if (window.cy) window.cy.elements().removeClass("highlighted-node dimmed-node");

                        if (currentFilterTarget === clickedValue) {
                            currentFilterTarget = null; // トグル解除
                        } else {
                            currentFilterTarget = clickedValue;
                            if (window.cy) {
                                let prefix = { stakeholder: "st_", subject: "s_", object: "o_" }[targetKey] || "";
                                window.cy.elements().addClass("dimmed-node"); // 一旦すべてを暗転
                                window.cy.nodes().forEach(node => {
                                    const nodeId = node.id();
                                    // インスタンス分離で付与された「_1, _2」や「_T0」などの接尾辞に関わらず、前方一致で対象ノードをすべて抽出・ハイライト
                                    if (nodeId === item.name || nodeId.startsWith(prefix + item.name)) {
                                        node.removeClass("dimmed-node").addClass("highlighted-node");
                                        node.connectedEdges().removeClass("dimmed-node"); // 隣接する線も可視化
                                    }
                                });
                            }
                            console.log(`[選択] カテゴリ: ${targetKey} | 名称: ${item.name} | ID/URI: ${item.uri || "IDが存在しません"}`);
                        }
                    }
                    updateLegendTable(targetKey); // 選択状態の背景色（アクティブ行スタイル）を反映するため再描画
                };
            });
        };

        // 統計情報の各行（ボタン付きセル）がクリックされた際の一覧トグル制御
        const statsTable = section.querySelector(".stats-table");
        statsTable.onclick = (e) => {
            const btn = e.target.closest(".stats-toggle-btn");
            if (!btn) return;

            statsTable.querySelectorAll(".stats-toggle-btn").forEach(b => b.classList.remove("active"));
            btn.classList.add("active");

            const targetKey = btn.getAttribute("data-target");
            const labelText = btn.textContent;

            // 凡例パネルの上部ヘッダータイトルを更新
            if (titleEl) titleEl.textContent = `${labelText.replace(/[・数]/g, '')}一覧`;
            
            // 操作案内プレビューテキストを「トリプル時」と「通常要素時」で正確に切り替え
            if (noticeEl) {
                noticeEl.textContent = targetKey === "triple" 
                    ? "※行をクリックで本文をトリプル番号（T1など）で絞り込み"
                    : "";
            }

            // カテゴリ切り替え時はフィルタとハイライト状態を安全に全面初期化
            currentFilterTarget = null;
            textarea.value = textContent;
            if (window.cy) window.cy.elements().removeClass("highlighted-node dimmed-node");

            updateLegendTable(targetKey);
        };

        // 初回レンダリング時、ステークホルダー（無効なら主語）の一覧をデフォルトで展開しておく
        let defaultKey = stats.shEnabled ? "stakeholder" : "subject";
        const initialBtn = statsTable.querySelector(`.stats-toggle-btn[data-target="${defaultKey}"]`);
        if (initialBtn) initialBtn.click();
    }
}
