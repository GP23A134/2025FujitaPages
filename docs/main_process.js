/**
 * ========================================================================
 * CCO4KG 変換・特定ID指定抽出ツール メインロジック
 * 【機能】統計情報算出・高精度スクロール凡例・独立ノード接続・バグ修正 統合版
 * ========================================================================
 */

// ------------------------------------------------------------------------
// 1. 画面初期化 ＆ イベントリスナー登録
// ------------------------------------------------------------------------
window.addEventListener('DOMContentLoaded', () => {
    // グローバル変数にデータが存在するかチェック
    if (typeof window.output_json_data !== 'undefined' && window.output_json_data !== null) {
        console.log("[CCO4KG Loader] 統計・カラー完全統合プロセスを読み込みました。");
        
        // ドキュメントID選択ドロップダウンの生成
        initDocIdDropdown();
        
        // UI設定エリアのアコーディオン（開閉表示）設定
        setupAccordion("headerOutput", "contentOutput");
        setupAccordion("headerColor", "contentColor");
        
        // 各種チェックボックス変更時にリアルタイムでUI制御（無効化/不透明度）を連動
        document.getElementById("enableSubject").addEventListener("change", updateUIControls);
        document.getElementById("enableObject").addEventListener("change", updateUIControls);
        document.getElementById("enablePredicate").addEventListener("change", updateUIControls);
        document.getElementById("enableSClass").addEventListener("change", updateUIControls);
        document.getElementById("enableOClass").addEventListener("change", updateUIControls);
        document.getElementById("enableClassLink").addEventListener("change", updateUIControls);
        document.getElementById("enableStakeholder").addEventListener("change", updateUIControls);
        document.getElementById("enableStClass").addEventListener("change", updateUIControls);
        document.getElementById("enableEvidence").addEventListener("change", updateUIControls);
        
        // ステークホルダーのカラーモード（ラジオボタン）変更イベント
        document.getElementsByName("shColorMode").forEach(radio => {
            radio.addEventListener("change", updateUIControls);
        });
        
        // 「実行」ボタンにメインのデータ処理関数を紐付け
        document.getElementById("execBtn").addEventListener("click", splitAndProcessData);

        // 初回読み込み時のUI状態を反映
        updateUIControls();
        document.getElementById("execBtn").disabled = false;
    } else {
        // データが存在しない場合のนี่エラーハンドリング
        console.error("[CCO4KG Loader] エラー: データが見つかりません。");
        const statusEl = document.getElementById("statusMessage");
        statusEl.className = "status-panel error";
        statusEl.style.display = "block";
        statusEl.textContent = "[エラー] output_CCO4KG.js からデータが見つかりません。";
    }
});

/**
 * 設定エリアの開閉（アコーディオン）を制御する関数
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
function updateUIControls() {
    // 現在の画面のチェック状態を取得
    let sEnabled = document.getElementById("enableSubject").checked;
    let oEnabled = document.getElementById("enableObject").checked;
    let pEnabled = document.getElementById("enablePredicate").checked;
    let sClassEnabled = document.getElementById("enableSClass").checked;
    let oClassEnabled = document.getElementById("enableOClass").checked;
    let classLinkEnabled = document.getElementById("enableClassLink").checked;
    
    const shEnabled = document.getElementById("enableStakeholder").checked;
    const stClassEnabled = document.getElementById("enableStClass").checked;
    const evEnabled = document.getElementById("enableEvidence").checked;

    // 【述語の制御】主語または目的語がOFFなら、述語は強制的にOFF＆無効化
    const cbPredicate = document.getElementById("enablePredicate");
    if (!sEnabled || !oEnabled) {
        cbPredicate.disabled = true;
        cbPredicate.checked = false;
        pEnabled = false;
    } else {
        cbPredicate.disabled = false;
    }

    // 【クラス間リンクの制御】主語クラスまたは目的語クラスがOFFなら、直結リンクは強制OFF＆無効化
    const cbClassLink = document.getElementById("enableClassLink");
    if (!sClassEnabled || !oClassEnabled) {
        cbClassLink.disabled = true;
        cbClassLink.checked = false;
        classLinkEnabled = false;
    } else {
        cbClassLink.disabled = false;
    }

    // 【ID付与の制御】主語も目的語もOFFなら、個別番号付与オプションを無効化
    const cbSoNum = document.getElementById("enableSubjectObjectNumbering");
    if (!sEnabled && !oEnabled) {
        cbSoNum.disabled = true;
        cbSoNum.checked = false;
    } else {
        cbSoNum.disabled = false;
    }

    // --- カラーパレット設定行の見た目（透過度・有効化）を制御 ---
    const cpSubject = document.getElementById("cpSubject");
    cpSubject.disabled = !sEnabled;
    cpSubject.parentElement.style.opacity = sEnabled ? "1.0" : "0.3";

    const cpObject = document.getElementById("cpObject");
    cpObject.disabled = !oEnabled;
    cpObject.parentElement.style.opacity = oEnabled ? "1.0" : "0.3";

    const cpPredicate = document.getElementById("cpPredicate");
    cpPredicate.disabled = !pEnabled;
    cpPredicate.parentElement.style.opacity = pEnabled ? "1.0" : "0.3";

    const cpSClass = document.getElementById("cpSClass");
    cpSClass.disabled = !sClassEnabled;
    cpSClass.parentElement.style.opacity = sClassEnabled ? "1.0" : "0.3";

    const cpOClass = document.getElementById("cpOClass");
    cpOClass.disabled = !oClassEnabled;
    cpOClass.parentElement.style.opacity = oClassEnabled ? "1.0" : "0.3";

    const cpSClassEdge = document.getElementById("cpSClassEdge");
    cpSClassEdge.disabled = !classLinkEnabled;
    cpSClassEdge.parentElement.style.opacity = classLinkEnabled ? "1.0" : "0.3";

    // ステークホルダー関連の連動設定
    document.getElementById("enableStakeholderNumbering").disabled = !shEnabled;
    document.getElementById("enableStClass").disabled = !shEnabled;
    document.getElementById("secShColor").style.opacity = shEnabled ? "1.0" : "0.3";
    document.getElementsByName("shColorMode").forEach(r => r.disabled = !shEnabled);

    // ラジオボタンの選択状態を取得
    const selectedMode = document.querySelector('input[name="shColorMode"]:checked')?.value || "random";
    const isFixed = (selectedMode === "select");
    const isRandom = (selectedMode === "random");

    // 単一固定色のパレット有効化制御
    const cpSh = document.getElementById("cpStakeholder");
    const fixedRow = document.getElementById("shFixedColorRow");
    if (shEnabled && isFixed) {
        cpSh.disabled = false;
        fixedRow.style.opacity = "1.0";
    } else {
        cpSh.disabled = true;
        fixedRow.style.opacity = "0.3";
    }

    // 所属クラス(stClass)のパレット有効化制御
    const cpStC = document.getElementById("cpStClass");
    const classRow = document.getElementById("stClassColorRow");
    if (shEnabled && stClassEnabled && (isRandom || isFixed)) {
        cpStC.disabled = false;
        classRow.style.opacity = "1.0";
    } else {
        cpStC.disabled = true;
        classRow.style.opacity = "0.3";
    }

    // 根拠(evidence)のパレット有効化制御
    document.getElementById("cpEvidence").disabled = !evEnabled;
    document.getElementById("secEvColor").style.opacity = evEnabled ? "1.0" : "0.3";
}

// ------------------------------------------------------------------------
// 3. データ処理ユーティリティ（テキストクレンジング・カラー処理）
// ------------------------------------------------------------------------

// ステークホルダーのランダム割当用カラーパレット (パステルカラー20色)
const SPEAKER_PALETTE = [
    "#FFB3BA", "#FFDFBA", "#FFFFBA", "#BAFFC9", "#BAE1FF",
    "#E8B4B8", "#F2D1B3", "#EDE8B7", "#BCE6CD", "#B5D5E6",
    "#FAD2E1", "#E2ECE9", "#BEE3DB", "#89B0A5", "#E0BBE4",
    "#957DAD", "#D291BC", "#FEC8D8", "#FFDFD3", "#D8E2DC"
];

/** Unicodeエスケープ文字(\\uXXXX)を通常の文字に復元 */
function decodeFromUnicode(str) {
    if (!str) return "";
    return str.replace(/\\u([0-9a-fA-F]{4})/g, (match, grp) => String.fromCharCode(parseInt(grp, 16)));
}

/** データの文字列からスペース、言語タグ、ダブルクォーテーションを除去 */
function clean(input) {
    if (!input) return "";
    return decodeFromUnicode(input).replace(/ /g, "").replace(/@ja/g, "").replace(/"/g, "").trim();
}

/** JSONデータ構造から値を安全に抽出 */
function getValueFromBinding(binding, key) {
    return (binding && binding[key]) ? (binding[key].value || "") : "";
}

/** URIの末尾からローカルネーム(ID)のみを抽出 */
function extractIdFromUri(uriString) {
    if (!uriString) return "";
    const cleanUri = clean(uriString);
    const parts = cleanUri.split('/');
    return parts[parts.length - 1] || "";
}

/**
 * 指定された背景色（HEX）より少し暗い色（エッジ・文字用カラー）を生成する関数
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

/** ドロップダウンメニューにデータ内のドキュメントID(グラフID)をソートして追加 */
function initDocIdDropdown() {
    const bindings = window.output_json_data.results.bindings;
    const selectEl = document.getElementById("targetDocId");
    const idSet = new Set();
    
    for (let i = 0; i < bindings.length; i++) {
        let rawDocUri = getValueFromBinding(bindings[i], "g") || getValueFromBinding(bindings[i], "?g");
        if (rawDocUri) idSet.add(extractIdFromUri(rawDocUri));
    }
    
    Array.from(idSet).sort().forEach(docId => {
        const option = document.createElement("option");
        option.value = docId;
        option.textContent = docId;
        selectEl.appendChild(option);
    });
}
/** ローディング表示・消去関数 */
function showSearchIng(resultArea) {
    const orgDiv = resultArea.innerHTML;
    resultArea.innerHTML = orgDiv + '<div id="searching"><h2>検索中...</h2>'
       + '<div class="flower-spinner"><div class="dots-container">'
       + '<div class="bigger-dot"><div class="smaller-dot"></div>'
       + '</div></div></div>'+'<br></div>' ;
}

function removeSearchIng() {
    const searchingDiv = document.getElementById("searching");
    if (searchingDiv != null) {
        // 親要素から完全に削除して、次回の差し込み時に重複しないようにします
        searchingDiv.remove();
    }
}

// ------------------------------------------------------------------------
// 4. メイン変換処理 ＆ 依存関係ロジック
// ------------------------------------------------------------------------
function splitAndProcessData() {
    const execBtn = document.getElementById("execBtn");
    const outputContainer = document.getElementById("outputContainer");
    
    // 1. ボタンの連打防止
    if (execBtn) execBtn.disabled = true;
    
    // 2. 前回の結果をクリアした上で、ローディングアニメーションを表示
    outputContainer.innerHTML = ""; 
    showSearchIng(outputContainer);

    // 画面描画（ローディング表示）の時間を確保するため、非同期でメイン処理を実行
    setTimeout(() => {
        try {
            const bindings = window.output_json_data.results.bindings;

            const shEnabledRaw = document.getElementById("enableStakeholder").checked;
            const sEnabled = document.getElementById("enableSubject").checked;
            const oEnabled = document.getElementById("enableObject").checked;
            const sClassEnabled = document.getElementById("enableSClass").checked;
            const oClassEnabled = document.getElementById("enableOClass").checked;

            // 現在設定されているすべてのパラメータを一括オブジェクト化
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
                cDefaultEdge: "#adadad"
            };

            // --- ドキュメントごとのグループ分け処理 ---
            let docGroups = {};
            for (let i = 0; i < bindings.length; i++) {
                let b = bindings[i];
                let docId = extractIdFromUri(getValueFromBinding(b, "g") || getValueFromBinding(b, "?g"));
                if (config.targetId !== "" && docId !== config.targetId) continue; // 特定ID抽出時のフィルタリング
                
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

            let globalColorCounter = 0; // カラーパレットのインデックス管理カウンター

            removeSearchIng();

            // --- 各ドキュメントグループのメイン解析ループ ---
            for (let groupKey in docGroups) {
                let wrappedBindings = docGroups[groupKey];
                
                // 内部マップ・統計カウンタの初期化
                const wordAppearanceMap = {}; 
                const localSpeakerColorMap = {}; 
                const localStClassColorMap = {}; 
                const finalSpeakerColorMap = {}; 
                const finalStClassColorMap = {}; 

                const uniqueSubjects = new Set();
                const uniqueObjects = new Set();
                const uniqueSClasses = new Set();
                const uniqueOClasses = new Set();
                const uniqueStakeholders = new Set();
                const uniqueOpinions = new Set();
                const uniqueEvidences = new Set();
                const uniqueTriples = new Set();

                const tripleLabelMap = {};

                // 【位置修正】直線カウント用の正確な集計マップ
                const jsonCountMap = {
                    stakeholder: {},
                    subject: {},
                    object: {},
                    sClass: {},
                    oClass: {},
                    evidence: {},
                    opinion: {},
                    triple: {}
                };

                // 各個人のランダムカラー配給ヘルパー
                function getIndividualSpeakerColor(shId) {
                    if (localSpeakerColorMap[shId]) return localSpeakerColorMap[shId];
                    let color = SPEAKER_PALETTE[globalColorCounter % SPEAKER_PALETTE.length];
                    localSpeakerColorMap[shId] = color;
                    globalColorCounter++;
                    return color;
                }

                // 所属分類ごとのランダムカラー配給ヘルパー
                function getGroupStClassColor(stClassId) {
                    if (localStClassColorMap[stClassId]) return localStClassColorMap[stClassId];
                    let color = SPEAKER_PALETTE[globalColorCounter % SPEAKER_PALETTE.length];
                    localStClassColorMap[stClassId] = color;
                    globalColorCounter++;
                    return color;
                }

                // カラーモード設定を判定して色を確定させる処理
                function resolveColors(shId, stClassId) {
                    if (config.shColorMode === "select") {
                        finalSpeakerColorMap[shId] = config.cFixedSH;
                        if (stClassId !== "") finalStClassColorMap[stClassId] = config.cStClass;
                        return;
                    }
                    if (config.shColorMode === "group") {
                        if (stClassId !== "") {
                            let groupColor = getGroupStClassColor(stClassId);
                            finalStClassColorMap[stClassId] = groupColor; 
                            finalSpeakerColorMap[shId] = darkenColor(groupColor, 0.85); // 個人は分類色より少し濃く
                        } else {
                            if (!finalSpeakerColorMap[shId]) {
                                finalSpeakerColorMap[shId] = getIndividualSpeakerColor(shId);
                            }
                        }
                        return;
                    }
                    if (config.shColorMode === "random") {
                        let pColor = getIndividualSpeakerColor(shId);
                        finalSpeakerColorMap[shId] = pColor;
                        if (stClassId !== "") finalStClassColorMap[stClassId] = config.cStClass; 
                    }
                }

                const classLinkSet = new Set();    // クラス構造用 重複排除用セット
                const metadataLinkSet = new Set(); // 意見・根拠用 重複排除用セット
                const comboToTrMap = {};           // トリプルIDマップ (要素の組み合わせ -> T0, T1...)
                let trCounter = 0;                 // トリプル(T0, T1...)カウンター
                let docOutputBuffer = "";          // タブ区切り文字列の一時保存バッファ
                const stakeholderLabelMap = {}; 
                const stClassLabelMap = {};

                // URI情報を後から参照できるように一時格納するマップを用意
                const idToUriMap = { subject: {}, object: {}, sClass: {}, oClass: {}, evidence: {} };

                // =================================================================
                // 【ループ第1期】カラー割当および名称マッピングの先行確定
                // =================================================================
                for (let item of wrappedBindings) {
                    let b = item.binding;
                    let shId      = extractIdFromUri(getValueFromBinding(b, "stakeholder"));
                    let stClassId = extractIdFromUri(getValueFromBinding(b, "stClass") || getValueFromBinding(b, "?stClass"));
                    
                    let cleanShName = clean(getValueFromBinding(b, "stakeholderLabel"));
                    
                    // 【除外徹底】「【個人】」や「個人」はステークホルダー確定処理から完全除外
                    if (cleanShName === "【個人】" || cleanShName === "個人" || !cleanShName) continue;

                    let shLabel   = "st_" + cleanShName;
                    let stClassLabel = "stc_" + clean(getValueFromBinding(b, "stClassLabel"));
                    if (shId !== "") {
                        stakeholderLabelMap[shId] = shLabel;
                        if (stClassId !== "") stClassLabelMap[stClassId] = stClassLabel;
                        if (finalSpeakerColorMap[shId]) continue;
                        resolveColors(shId, stClassId); // カラーの確定処理
                    }
                }
                
                // ナンバリング（連番）適用後の名前と色を正しく紐付けるための凡例用マップ
                const legendDisplayColorMap = {};
                //  ステークホルダー単体の純粋な出現回数を集計するための独立マップ
                const shExactCountMap = {};

                // =================================================================
                // 【ループ第2期】メインのタブ区切りデータ変換、及び独立接続の判定
                // =================================================================
                for (let item of wrappedBindings) {
                    let b = item.binding;
                    let currentDocId = item.originalDocId; 

                    // URIの生の値を取得
                    let sUri      = getValueFromBinding(b, "s");
                    let sClassUri = getValueFromBinding(b, "sClass");
                    let oUri      = getValueFromBinding(b, "o");
                    let oClassUri = getValueFromBinding(b, "oClass");
                    let shUri     = getValueFromBinding(b, "stakeholder");
                    let opUri     = getValueFromBinding(b, "opinion");
                    let evUri     = getValueFromBinding(b, "evidence");

                    // URIからローカル名（ID）を抽出
                    let sId      = extractIdFromUri(sUri);
                    let sClassId = extractIdFromUri(sClassUri);
                    let pId      = extractIdFromUri(getValueFromBinding(b, "p"));
                    let oId      = extractIdFromUri(oUri);
                    let oClassId = extractIdFromUri(oClassUri);
                    let shId     = extractIdFromUri(shUri);
                    let stClassId= extractIdFromUri(getValueFromBinding(b, "stClass") || getValueFromBinding(b, "?stClass"));
                    let opId     = extractIdFromUri(opUri);

                    // 各種ラベルのクレンジング
                    let sLabelRaw   = clean(getValueFromBinding(b, "sLabel"));
                    let oLabelRaw   = clean(getValueFromBinding(b, "oLabel"));
                    let shLabelRaw  = clean(getValueFromBinding(b, "stakeholderLabel"));
                    let opContentRaw= clean(getValueFromBinding(b, "opinionContent"));
                    let evContentRaw= clean(getValueFromBinding(b, "evidence"));
                    let sClassLabelRaw = clean(getValueFromBinding(b, "sClassLabel"));
                    let oClassLabelRaw = clean(getValueFromBinding(b, "oClassLabel"));
                    let stClassLabelRaw = clean(getValueFromBinding(b, "stClassLabel"));

                    let sLabel      = "s_" + sLabelRaw;
                    let sClassLabel = "sc_" + sClassLabelRaw;
                    let pLabel      = clean(getValueFromBinding(b, "pLabel")); 
                    let oLabel      = "o_" + oLabelRaw;
                    let ocLabel     = "oc_" + oClassLabelRaw;
                    let shLabel_cleansed = "st_" + shLabelRaw;
                    let stClassLabel= "stc_" + stClassLabelRaw;
                    
                    let opContent   = opContentRaw; 
                    let evContent   = "ev_" + evContentRaw;

                    // 必須である主語と目的語が欠落しているデータ行はスキップ
                    if (sId === "" || oId === "") continue;

                    // URIマッピングの保持
                    if (sId !== "") idToUriMap.subject[sLabel] = sUri;
                    if (oId !== "") idToUriMap.object[oLabel] = oUri;
                    if (sClassId !== "" && sClassLabelRaw) idToUriMap.sClass[sClassLabel] = sClassUri;
                    if (oClassId !== "" && oClassLabelRaw) idToUriMap.oClass[ocLabel] = oClassUri;
                    if (evContentRaw !== "") idToUriMap.evidence[evContent] = evUri || "ローカルデータ";

                    // トリプル管理ロジック
                    let comboKeyForId = `${currentDocId}_${sId}|${pId}|${oId}`;
                    let isFirstTimeTr = false;
                    
                    if (!comboToTrMap[comboKeyForId]) {
                        comboToTrMap[comboKeyForId] = "T" + trCounter;
                        trCounter++;
                        isFirstTimeTr = true; 
                    }
                    let trId = comboToTrMap[comboKeyForId]; 

                    let tripleMapKey = `${sLabelRaw} | ${pLabel} | ${oLabelRaw}`;
                    let tripleDisplayLabel = `${trId}_${sLabelRaw}_${pLabel}_${oLabelRaw}`; 

                    uniqueTriples.add(tripleMapKey);
                    tripleLabelMap[tripleMapKey] = tripleDisplayLabel;
                    jsonCountMap.triple[tripleMapKey] = (jsonCountMap.triple[tripleMapKey] || 0) + 1;

                    if (sId !== "") uniqueSubjects.add(sLabel);
                    if (oId !== "") uniqueObjects.add(oLabel);
                    if (sClassId !== "" && sClassLabelRaw) uniqueSClasses.add(sClassLabel);
                    if (oClassId !== "" && oClassLabelRaw) uniqueOClasses.add(ocLabel);
                    if (shId !== "" && shLabelRaw) uniqueStakeholders.add(shId);
                    if (opId !== "" && opContent) uniqueOpinions.add(opContent);
                    if (evContentRaw !== "") uniqueEvidences.add(evContent);

                    if (sId !== "") jsonCountMap.subject[sLabel] = (jsonCountMap.subject[sLabel] || 0) + 1;
                    if (oId !== "") jsonCountMap.object[oLabel] = (jsonCountMap.object[oLabel] || 0) + 1;
                    if (sClassId !== "" && sClassLabelRaw) jsonCountMap.sClass[sClassLabel] = (jsonCountMap.sClass[sClassLabel] || 0) + 1;
                    if (oClassId !== "" && oClassLabelRaw) jsonCountMap.oClass[ocLabel] = (jsonCountMap.oClass[ocLabel] || 0) + 1;
                    if (evContentRaw !== "") jsonCountMap.evidence[evContent] = (jsonCountMap.evidence[evContent] || 0) + 1;

                    let displaySLabel = sLabel;
                    let displayOLabel = oLabel;

                    if (config.soNum) {
                        displaySLabel = `${sLabel}_${trId}`;
                        displayOLabel = `${oLabel}_${trId}`;
                    }

                    //  ステークホルダーの発言順ナンバリングと、出現数の確実なカウントアップ
                    let shNodeName = "";
                    let speakerColor = config.cFixedSH;
                    if (shId !== "" && shLabelRaw) {
                        shNodeName = shLabel_cleansed;
                        let stCount = (wordAppearanceMap[shId] || 0) + 1;
                        wordAppearanceMap[shId] = stCount;
                        
                        let finalTrackedName = config.shNum ? `${shNodeName}_${stCount}` : shNodeName;
                        shNodeName = finalTrackedName;

                        speakerColor = finalSpeakerColorMap[shId] || config.cFixedSH;

                        //  ここで「st_名前」のキーに対して、純粋な出現数をインクリメント
                        shExactCountMap[shLabel_cleansed] = (shExactCountMap[shLabel_cleansed] || 0) + 1;
                        // ナンバリング付きノード名用も一応バックアップ
                        jsonCountMap.stakeholder[shNodeName] = (jsonCountMap.stakeholder[shNodeName] || 0) + 1;
                        
                        if (opContent) jsonCountMap.opinion[opContent] = (jsonCountMap.opinion[opContent] || 0) + 1;

                        if (config.shColorMode === "group") {
                            const className = stClassLabelMap[stClassId] || "不明な分類";
                            legendDisplayColorMap[`stClass_${stClassId}`] = { name: `【分類】${className}`, color: finalStClassColorMap[stClassId], uri: sClassUri };
                            legendDisplayColorMap[`sh_${shId}`] = { name: `${shLabel_cleansed}`, color: speakerColor, uri: shUri };
                        } else {
                            legendDisplayColorMap[`sh_${shId}`] = { name: `${shLabel_cleansed}`, color: speakerColor, uri: shUri };
                        }
                    }

                    let prefix = (config.targetId === "") ? `${currentDocId}\t` : "";
                    
                    if (isFirstTimeTr) {
                        if (config.pEnabled) {
                            docOutputBuffer += `${prefix}${displaySLabel}\t${pLabel}\t${displayOLabel}\t${config.cSubj}\t${config.cObj}\t${config.cPred}\n`;
                        }
                        if (config.sEnabled) {
                            docOutputBuffer += `${prefix}${trId}\t主語\t${displaySLabel}\t${config.cDefaultEdge}\t${config.cSubj}\t${config.cSubj}\n`;
                        } else if (config.sClassEnabled && sClassId !== "" && sClassLabelRaw) {
                            let directSClassKey = `${currentDocId}_${trId}_direct_sClass_${sClassId}`;
                            if (!classLinkSet.has(directSClassKey)) {
                                classLinkSet.add(directSClassKey);
                                docOutputBuffer += `${prefix}${trId}\tsClass\t${sClassLabel}\t${config.cDefaultEdge}\t${config.cSClass}\t${config.cSClass}\n`;
                            }
                        }
                        if (config.oEnabled) {
                            docOutputBuffer += `${prefix}${trId}\t目的語\t${displayOLabel}\t${config.cDefaultEdge}\t${config.cObj}\t${config.cObj}\n`;
                        } else if (config.oClassEnabled && oClassId !== "" && oClassLabelRaw) {
                            let directOClassKey = `${currentDocId}_${trId}_direct_oClass_${oClassId}`;
                            if (!classLinkSet.has(directOClassKey)) {
                                classLinkSet.add(directOClassKey);
                                docOutputBuffer += `${prefix}${trId}\toClass\t${ocLabel}\t${config.cDefaultEdge}\t${config.cOClass}\t${config.cOClass}\n`;
                            }
                        }
                    }

                    if (config.sEnabled && config.sClassEnabled && sClassId !== "" && sClassLabelRaw) {
                        let sClassKey = `${currentDocId}_${displaySLabel}_to_sClass_${sClassId}`;
                        if (!classLinkSet.has(sClassKey)) {
                            classLinkSet.add(sClassKey);
                            docOutputBuffer += `${prefix}${displaySLabel}\tsClass\t${sClassLabel}\t${config.cSubj}\t${config.cSClass}\t${config.cSClass}\n`;
                        }
                    }
                    if (config.oEnabled && config.oClassEnabled && oClassId !== "" && oClassLabelRaw) {
                        let oClassKey = `${currentDocId}_${displayOLabel}_to_oClass_${oClassId}`;
                        if (!classLinkSet.has(oClassKey)) {
                            classLinkSet.add(oClassKey);
                            docOutputBuffer += `${prefix}${displayOLabel}\toClass\t${ocLabel}\t${config.cObj}\t${config.cOClass}\t${config.cOClass}\n`;
                        }
                    }
                    if (config.classLinkEnabled && sClassId !== "" && oClassId !== "" && sClassLabelRaw && oClassLabelRaw) {
                        let sToOClassKey = `${currentDocId}_${trId}_${sClassId}_to_${oClassId}`;
                        if (!classLinkSet.has(sToOClassKey)) {
                            classLinkSet.add(sToOClassKey);
                            docOutputBuffer += `${prefix}${sClassLabel}\t-\t${ocLabel}\t${config.cSClass}\t${config.cOClass}\t${config.cSClassEdge}\n`;
                        }
                    }
                    if (config.evEnabled && evContentRaw !== "") {
                        let safeEvContent = evContent.replace(/\n/g, " "); 
                        let trToEvidenceKey = `${currentDocId}_${trId}_evidence_${safeEvContent}`;
                        if (!metadataLinkSet.has(trToEvidenceKey)) {
                            metadataLinkSet.add(trToEvidenceKey);
                            docOutputBuffer += `${prefix}${trId}\tevidence\t${safeEvContent}\t${config.cDefaultEdge}\t${config.cEv}\t${config.cEv}\n`;
                        }
                    }

                    if (config.shEnabled && opId !== "" && opContent) {
                        let opinionNodeName = opContent;
                        let opinionColor = darkenColor(speakerColor, 0.80); 
                        
                        let trToOpinionKey = `${currentDocId}_${trId}_instance_${opId}`;
                        if (!metadataLinkSet.has(trToOpinionKey)) {
                            metadataLinkSet.add(trToOpinionKey);
                            docOutputBuffer += `${prefix}${opinionNodeName}\t意見\t${trId}\t${opinionColor}\t${config.cDefaultEdge}\t${config.cDefaultEdge}\n`;
                        }

                        if (shId !== "" && shLabelRaw) {
                            let opinionToSpeakerKey = `${currentDocId}_${opId}_speaker_${shNodeName}`;
                            if (!metadataLinkSet.has(opinionToSpeakerKey)) {
                                metadataLinkSet.add(opinionToSpeakerKey);
                                docOutputBuffer += `${prefix}${opinionNodeName}\tステークホルダー\t${shNodeName}\t${opinionColor}\t${speakerColor}\t${speakerColor}\n`;
                            }

                            if (config.stClass && stClassId !== "" && stClassLabelRaw) {
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
                const sortByCountDesc = (a, b) => {
                    if (b.count !== a.count) return b.count - a.count; 
                    return a.name.localeCompare(b.name, 'ja'); 
                };

                const customColorList = [];
                if (config.shEnabled) {
                    const seenNames = new Set();
                    Object.keys(legendDisplayColorMap).forEach(key => {
                        const item = legendDisplayColorMap[key];
                        if (item.name === "st_" || item.name === "st_【個人】" || item.name === "st_個人" || !item.name) return;
        
                        if (!seenNames.has(item.name)) {
                            seenNames.add(item.name);
                            
                            //  ここで集計した「純粋な発言出現件数」を確実にバインドします
                            const finalExactCount = shExactCountMap[item.name] || 0;

                            customColorList.push({
                                name: item.name,
                                color: item.color,
                                count: finalExactCount,
                                uri: item.uri
                            });
                        }
                    });
                    customColorList.sort(sortByCountDesc);
                }

                const subjList = Array.from(uniqueSubjects)
                    .map(name => ({ name: name, color: config.cSubj, count: jsonCountMap.subject[name] || 0, uri: idToUriMap.subject[name] }))
                    .sort(sortByCountDesc);

                const objList = Array.from(uniqueObjects)
                    .map(name => ({ name: name, color: config.cObj, count: jsonCountMap.object[name] || 0, uri: idToUriMap.object[name] }))
                    .sort(sortByCountDesc);

                const sClassList = Array.from(uniqueSClasses)
                    .map(name => ({ name: name, color: config.cSClass, count: jsonCountMap.sClass[name] || 0, uri: idToUriMap.sClass[name] }))
                    .sort(sortByCountDesc);

                const oClassList = Array.from(uniqueOClasses)
                    .map(name => ({ name: name, color: config.cOClass, count: jsonCountMap.oClass[name] || 0, uri: idToUriMap.oClass[name] }))
                    .sort(sortByCountDesc);

                const evList = Array.from(uniqueEvidences)
                    .map(text => ({ name: text, color: config.cEv, count: jsonCountMap.evidence[text] || 0, uri: idToUriMap.evidence[text] }))
                    .sort(sortByCountDesc);

                const opList = [];
                if (config.shEnabled) {
                    const seenOpinions = new Set();
                    for (let item of wrappedBindings) {
                        let b = item.binding;
                        let shId = extractIdFromUri(getValueFromBinding(b, "stakeholder"));
                        let opId = extractIdFromUri(getValueFromBinding(b, "opinion") || getValueFromBinding(b, "?opinion"));
                        let opContentRaw = clean(getValueFromBinding(b, "opinionContent"));
                        let opUri = getValueFromBinding(b, "opinion");
                        
                        if (opContentRaw === "【個人】" || opContentRaw === "個人" || !opContentRaw) continue;

                        if (opId !== "") {
                            let opLabel = opContentRaw; 
                            if (!seenOpinions.has(opLabel)) {
                                seenOpinions.add(opLabel);
                                
                                let shColor = "#adadad";
                                if (shId && finalSpeakerColorMap && finalSpeakerColorMap[shId]) {
                                    shColor = finalSpeakerColorMap[shId];
                                }
                                
                                opList.push({
                                    name: opLabel,
                                    color: shColor,
                                    count: jsonCountMap.opinion[opLabel] || 0,
                                    uri: opUri
                                });
                            }
                        }
                    }
                    opList.sort(sortByCountDesc);
                }

                const tripleList = Array.from(uniqueTriples)
                    .map(key => ({
                        name: tripleLabelMap[key], 
                        color: config.cPred,       
                        count: jsonCountMap.triple[key] || 0,
                        isTriple: true
                    }));

                tripleList.sort((a, b) => {
                    const numA = parseInt(a.name.match(/^T(\d+)_/)[1], 10);
                    const numB = parseInt(b.name.match(/^T(\d+)_/)[1], 10);
                    return numA - numB; 
                });

                let dynamicTitle = "ステークホルダー";
                if (config.shEnabled && config.shColorMode === "group") {
                    dynamicTitle = "stClass";
                } else if (config.shEnabled && config.shColorMode === "select") {
                    dynamicTitle = "単一固定指定";
                }

                const statsSummary = {
                    titleName: dynamicTitle,
                    tripleCount: trCounter,
                    subjectCount: uniqueSubjects.size,
                    objectCount: uniqueObjects.size,
                    sClassCount: uniqueSClasses.size,
                    oClassCount: uniqueOClasses.size,
                    stakeholderCount: uniqueStakeholders.size,
                    opinionCount: uniqueOpinions.size,
                    evidenceCount: uniqueEvidences.size,
                    
                    sEnabled: config.sEnabled,
                    oEnabled: config.oEnabled,
                    sClassEnabled: config.sClassEnabled,
                    oClassEnabled: config.oClassEnabled,
                    shEnabled: config.shEnabled,
                    evEnabled: config.evEnabled,

                    cSubj: config.cSubj,
                    cObj: config.cObj,
                    cPred: config.cPred,
                    cSClass: config.cSClass,
                    cOClass: config.cOClass,
                    cEv: config.cEv,
                    
                    lists: {
                        stakeholder: customColorList,
                        subject: subjList,
                        object: objList,
                        sClass: sClassList,
                        oClass: oClassList,
                        evidence: evList,
                        opinion: opList,
                        triple: tripleList 
                    }
                };

                let displayTitleId = (groupKey === "ALL_DOCUMENTS") ? "ALL_DOCUMENTS" : groupKey;
                createDocumentSection(displayTitleId, docOutputBuffer, statsSummary);
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
function createDocumentSection(docId, textContent, stats) {
    const container = document.getElementById("outputContainer");

    const section = document.createElement("div");
    section.className = "doc-section";

    const header = document.createElement("div");
    header.className = "doc-header";

    const title = document.createElement("div");
    title.className = "doc-title";
    title.textContent = (docId === "ALL_DOCUMENTS") ? "出力モード: すべてのドキュメント（一括出力）" : `出力モード: ${docId}`;

    const actions = document.createElement("div");
    actions.className = "doc-actions";

    const copyBtn = document.createElement("button");
    copyBtn.className = "btn-small btn-copy-small";
    copyBtn.textContent = "このデータをコピー";
    
    const textarea = document.createElement("textarea");
    textarea.readOnly = true;
    textarea.value = textContent; 

    copyBtn.onclick = () => {
        navigator.clipboard.writeText(textarea.value)
            .then(() => {
                alert(`${docId} のデータをコピーしました。`);
            })
            .catch(err => {
                console.error("コピーに失敗しました: ", err);
                textarea.select();
                document.execCommand("copy");
                alert(`${docId} のデータをコピーしました。`);
            });
    };

    actions.appendChild(copyBtn);
    header.appendChild(title);
    header.appendChild(actions);
    section.appendChild(header);

    const mainContent = document.createElement("div");
    mainContent.className = "doc-main-content";

    // --- 【左ペイン】統計・凡例サイドパネル ---
    const sidePanel = document.createElement("div");
    sidePanel.className = "doc-side-panel";

    const metaBadge = document.createElement("div");
    metaBadge.className = "doc-meta-badge";

    let tableHtml = `<b class="badge-main-title" style="font-size: 1.1em;">解析結果統計</b>`;
    tableHtml += `<table class="stats-table" style="font-size: 1.05em; width: 100%;">`;

    const getBox = (color) => {
        if (docId === "ALL_DOCUMENTS") return "";
        return `<span class="legend-color-box" style="background-color:${color}; display:inline-block; width:12px; height:12px; border-radius:3px; margin-right:5px; vertical-align:middle;"></span>`;
    };

    const isAllDoc = (docId === "ALL_DOCUMENTS");
    
    tableHtml += `<tr>
    <td>${getBox("#adadad")}${isAllDoc ? 'トリプル数' : `<button class="stats-toggle-btn" data-target="triple" data-doc="${docId}" style="font-size: 1em;">トリプル数</button>`}</td>
    <td>${stats.tripleCount}</td>
</tr>`;
    
    if (stats.sEnabled) {
        tableHtml += `<tr>
            <td>${getBox(stats.cSubj)}${isAllDoc ? '主語数' : `<button class="stats-toggle-btn" data-target="subject" data-doc="${docId}" style="font-size: 1em;">主語数</button>`}</td>
            <td>${stats.subjectCount}</td>
        </tr>`;
    }
    if (stats.oEnabled) {
        tableHtml += `<tr>
            <td>${getBox(stats.cObj)}${isAllDoc ? '目的語数' : `<button class="stats-toggle-btn" data-target="object" data-doc="${docId}" style="font-size: 1em;">目的語数</button>`}</td>
            <td>${stats.objectCount}</td>
        </tr>`;
    }
    if (stats.sClassEnabled) {
        tableHtml += `<tr>
            <td>${getBox(stats.cSClass)}${isAllDoc ? '主語クラス数' : `<button class="stats-toggle-btn" data-target="sClass" data-doc="${docId}" style="font-size: 1em;">主語クラス数</button>`}</td>
            <td>${stats.sClassCount}</td>
        </tr>`;
    }
    if (stats.oClassEnabled) {
    tableHtml += `<tr>
        <td>${getBox(stats.cOClass)}${isAllDoc ? '目的語クラス数' : `<button class="stats-toggle-btn" data-target="oClass" data-doc="${docId}" style="font-size: 1em;">目的語クラス数</button>`}</td>
        <td>${stats.oClassCount}</td>
        </tr>`;
    }
    if (stats.shEnabled) {
        tableHtml += `<tr>
            <td>${getBox("#adadad")}${isAllDoc ? 'ステークホルダー数' : `<button class="stats-toggle-btn" data-target="stakeholder" data-doc="${docId}" style="font-size: 1em;">${stats.titleName || 'ステークホルダー'}数</button>`}</td>
            <td>${stats.stakeholderCount}</td>
        </tr>`;
        tableHtml += `<tr>
            <td>${getBox("#adadad")}${isAllDoc ? '意見数' : `<button class="stats-toggle-btn" data-target="opinion" data-doc="${docId}" style="font-size: 1em;">意見数</button>`}</td>
            <td>${stats.opinionCount}</td>
        </tr>`;
    }
    if (stats.evEnabled) {
        tableHtml += `<tr>
            <td>${getBox(stats.cEv)}${isAllDoc ? '根拠数' : `<button class="stats-toggle-btn" data-target="evidence" data-doc="${docId}" style="font-size: 1em;">根拠数</button>`}</td>
            <td>${stats.evidenceCount}</td>
        </tr>`;
    }
    tableHtml += `</table>`;

    if (!isAllDoc) {
        tableHtml += `<hr class="badge-divider" style="border:none; border-top:1px dashed #ccc; margin:25px 0 15px 0;">`;
        tableHtml += `<b id="legend-current-title-${docId}" class="badge-sub-title" style="display:block; margin-bottom:4px; font-size:1.05em; color:#444;"></b>`;
        tableHtml += `<span id="legend-notice-${docId}" style="font-size:0.8em; color:#888; display:block; margin-bottom:8px;"></span>`;
        
        tableHtml += `<div class="legend-scroll-container" style="overflow-y: auto; overflow-x: auto; max-height: 200px; border: 1px solid #eee; padding: 5px; background: #fff; border-radius: 4px;">`;
        tableHtml += `<table id="dynamic-legend-table-${docId}" class="dynamic-legend-table" style="width: max-content; min-width: 100%; white-space: nowrap; border-collapse: collapse;"></table>`;
        tableHtml += `</div>`;
    }

    metaBadge.innerHTML = tableHtml;
    sidePanel.appendChild(metaBadge);
    mainContent.appendChild(sidePanel);

    // --- 【右ペイン】テキストエリアパネル ---
    const textPanel = document.createElement("div");
    textPanel.className = "doc-text-panel";
    
    textPanel.appendChild(textarea);
    mainContent.appendChild(textPanel);

    section.appendChild(mainContent);
    container.appendChild(section);

    // --- ボタンによる一覧の動的切り替え & 絞り込みロジック ---
    if (!isAllDoc) {
        const legendTable = document.getElementById(`dynamic-legend-table-${docId}`);
        const titleEl = document.getElementById(`legend-current-title-${docId}`);
        const noticeEl = document.getElementById(`legend-notice-${docId}`);
        
        // 選択中のフィルター状態を保持する変数
        let currentFilterTarget = null;

        const updateLegendTable = (targetKey, labelText) => {
            const currentList = stats.lists[targetKey] || [];
            let rowsHtml = "";
            
            if (titleEl && labelText) {
                const cleanLabel = labelText.replace('・', '').replace('数', '');
                titleEl.textContent = `${cleanLabel}一覧`;
            }

            if (noticeEl) {
                if (targetKey === "triple") {
                    noticeEl.textContent = "※行をクリックで本文をトリプル番号（T1など）で絞り込み";
                } else {
                    noticeEl.textContent = "※行をクリックでグラフ上の該当ノード（重複分離分含む）を一括ハイライト";
                }
            }
            
            if (currentList.length === 0) {
                rowsHtml = `<tr><td style="color:#888; font-style:italic; padding:5px; font-size:1em;">データがありません</td></tr>`;
                if (legendTable) legendTable.innerHTML = rowsHtml;
            } else {
                currentList.forEach((item, index) => {
                    const listLabel = item.name; 
                    const appearanceCount = item.count || 0;

                    rowsHtml += `<tr class="filter-trigger-row" data-index="${index}" data-value="${listLabel}" style="cursor:pointer; transition: background 0.2s;">
                        <td style="padding:6px 4px; border-bottom:1px dashed #eee; vertical-align:middle;">
                            ${getBox(item.color)}
                            <span class="legend-item-name" style="vertical-align:middle; font-size:1.05em; color:#333;">
                                ${item.name} <span style="color: #d32f2f; font-size: 0.9em; margin-left: 4px; font-weight: bold;">(${appearanceCount}件)</span>
                            </span>
                        </td>
                    </tr>`;
                });
                
                if (legendTable) {
                    legendTable.innerHTML = rowsHtml;
                    
                    const rows = legendTable.querySelectorAll(".filter-trigger-row");
                    rows.forEach(row => {
                        const clickedValue = row.getAttribute("data-value");
                        const idx = parseInt(row.getAttribute("data-index"), 10);
                        const item = currentList[idx];

                        // タブ切り替え時、選択中アイテムがあればグレー状態を復元
                        if (currentFilterTarget === clickedValue) {
                            row.style.backgroundColor = "#e0e0e0";
                            row.querySelector(".legend-item-name").style.fontWeight = "bold";
                        }

                        row.onclick = () => {
                            if (item.isTriple) {
                                // --- 1. トリプルの場合の既存処理 ---
                                const allLines = textContent.split("\n");
                                if (currentFilterTarget === clickedValue) {
                                    currentFilterTarget = null;
                                    textarea.value = textContent; 
                                    row.style.backgroundColor = "";
                                    row.querySelector(".legend-item-name").style.fontWeight = "normal";
                                } else {
                                    currentFilterTarget = clickedValue;
                                    rows.forEach(r => {
                                        r.style.backgroundColor = "";
                                        r.querySelector(".legend-item-name").style.fontWeight = "normal";
                                    });
                                    row.style.backgroundColor = "#e0e0e0";
                                    row.querySelector(".legend-item-name").style.fontWeight = "bold";

                                    const trPrefix = clickedValue.split('_')[0]; 
                                    const filteredLines = allLines.filter(line => {
                                        const columns = line.split('\t');
                                        return columns.some(col => col === trPrefix);
                                    });
                                    textarea.value = filteredLines.join("\n");
                                }
                            } else {
                                //2. トリプル以外（主語・ステークホルダー等）の場合の連動処理 
                                if (window.cy) {
                                    window.cy.elements().removeClass("highlighted-node dimmed-node");
                                }

                                if (currentFilterTarget === clickedValue) {
                                    // すでに選択済みなら解除
                                    currentFilterTarget = null;
                                    row.style.backgroundColor = "";
                                    row.querySelector(".legend-item-name").style.fontWeight = "normal";
                                    console.log(`[解除] 名称: ${item.name}`);
                                } else {
                                    // 新しく選択された場合
                                    currentFilterTarget = clickedValue;
                                    rows.forEach(r => {
                                        r.style.backgroundColor = "";
                                        r.querySelector(".legend-item-name").style.fontWeight = "normal";
                                    });
                                    // 指定のグレー反転と太字の適用
                                    row.style.backgroundColor = "#e0e0e0"; 
                                    row.querySelector(".legend-item-name").style.fontWeight = "bold";

                                    // Cytoscape.jsグラフ上のノード・エッジの抽出とハイライト
                                    if (window.cy) {
                                        const clickedName = item.name;
                                        // カテゴリごとのID接頭辞を判定
                                        let prefix = "";
                                        if (targetKey === "stakeholder") prefix = "st_";
                                        else if (targetKey === "subject") prefix = "s_";
                                        else if (targetKey === "object") prefix = "o_";

                                        // 全体を一旦薄くする
                                        window.cy.elements().addClass("dimmed-node");

                                        // 重複分離されたノード（例: st_Aさん_1, st_Aさん_2）を前方一致で一括ヒットさせる
                                        window.cy.nodes().forEach(node => {
                                            const nodeId = node.id();
                                            if (nodeId === clickedName || nodeId.startsWith(prefix + clickedName)) {
                                                node.removeClass("dimmed-node").addClass("highlighted-node");
                                                node.connectedEdges().removeClass("dimmed-node");
                                            }
                                        });
                                    }
                                    console.log(`[${labelText.replace('数', '')}] 名称: ${item.name} | URI:`, item.uri || "URIが存在しません");
                                }
                            }
                        };
                    });
                }
            }
        };

        // 初期選択状態の決定
        let defaultKey = "subject";
        let defaultLabel = "主語"; 

        if (stats.shEnabled) {
            defaultKey = "stakeholder";
            defaultLabel = stats.titleName || "ステークホルダー";
        }

        updateLegendTable(defaultKey, defaultLabel);

        const buttons = section.querySelectorAll(`.stats-toggle-btn[data-doc="${docId}"]`);
        buttons.forEach(btn => {
            if (btn.getAttribute("data-target") === defaultKey) {
                btn.classList.add("active");
            }

            btn.onclick = (e) => {
                buttons.forEach(b => b.classList.remove("active"));
                e.target.classList.add("active");

                const targetKey = e.target.getAttribute("data-target");
                const labelText = e.target.textContent;
                
                // タブが切り替わったら選択状態・グラフハイライトは全リセットして原本に戻す
                currentFilterTarget = null;
                textarea.value = textContent; 
                if (window.cy) {
                    window.cy.elements().removeClass("highlighted-node dimmed-node");
                }
                
                updateLegendTable(targetKey, labelText);
            };
        });
    }
}
