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

                        if (shId && shLabelRaw) {
                            let opinionToSpeakerKey = `${currentDocId}_${opId}_speaker_${shNodeName}`;
                            if (!metadataLinkSet.has(opinionToSpeakerKey)) {
                                metadataLinkSet.add(opinionToSpeakerKey);
                                docOutputBuffer += `${prefix}${opinionNodeName}\tステークホルダー\t${shNodeName}\t${opinionColor}\t${speakerColor}\t${speakerColor}\n`;
                            }

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
                const sortByCountDesc = (a, b) => b.count - a.count || a.name.localeCompare(b.name, 'ja');

                const customColorList = [];
                if (config.shEnabled) {
                    const seenNames = new Set();
                    Object.keys(legendDisplayColorMap).forEach(key => {
                        const item = legendDisplayColorMap[key];
                        if (!item.name || /^st_(|【個人】|個人)$/.test(item.name)) return;
        
                        if (!seenNames.has(item.name)) {
                            seenNames.add(item.name);
                            customColorList.push({
                                name: item.name,
                                color: item.color,
                                count: shExactCountMap[item.name] || 0,
                                uri: item.uri
                            });
                        }
                    });
                    customColorList.sort(sortByCountDesc);
                }

                const createList = (uniqueSet, color, countMap, uriMap) => 
                    Array.from(uniqueSet).map(name => ({
                        name, color, count: countMap[name] || 0, uri: uriMap[name]
                    })).sort(sortByCountDesc);

                const subjList = createList(uniqueSubjects, config.cSubj, jsonCountMap.subject, idToUriMap.subject);
                const objList = createList(uniqueObjects, config.cObj, jsonCountMap.object, idToUriMap.object);
                const sClassList = createList(uniqueSClasses, config.cSClass, jsonCountMap.sClass, idToUriMap.sClass);
                const oClassList = createList(uniqueOClasses, config.cOClass, jsonCountMap.oClass, idToUriMap.oClass);
                const evList = createList(uniqueEvidences, config.cEv, jsonCountMap.evidence, idToUriMap.evidence);

                const opList = [];
                if (config.shEnabled) {
                    const seenOpinions = new Set();
                    for (let item of wrappedBindings) {
                        let b = item.binding;
                        let opContentRaw = clean(getValueFromBinding(b, "opinionContent"));
                        if (!opContentRaw || /^【個人】|個人$/.test(opContentRaw)) continue;

                        let opId = extractIdFromUri(getValueFromBinding(b, "opinion") || getValueFromBinding(b, "?opinion"));
                        if (opId) {
                            if (!seenOpinions.has(opContentRaw)) {
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
                    }
                    opList.sort(sortByCountDesc);
                }

                const tripleList = Array.from(uniqueTriples).map(key => ({
                    name: tripleLabelMap[key], 
                    color: config.cPred,       
                    count: jsonCountMap.triple[key] || 0,
                    isTriple: true
                })).sort((a, b) => {
                    return parseInt(a.name.match(/^T(\d+)_/)[1], 10) - parseInt(b.name.match(/^T(\d+)_/)[1], 10);
                });

                let dynamicTitle = "ステークホルダー";
                if (config.shEnabled) {
                    if (config.shColorMode === "group") dynamicTitle = "stClass";
                    else if (config.shColorMode === "select") dynamicTitle = "単一固定指定";
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
function createDocumentSection(docId, textContent, stats) {
    const container = document.getElementById("outputContainer");
    const isAllDoc = (docId === "ALL_DOCUMENTS");

    const section = document.createElement("div");
    section.className = "doc-section";

    const textarea = document.createElement("textarea");
    textarea.readOnly = true;
    textarea.value = textContent; 

    // コピー通知の共通処理
    const alertCopied = () => alert(`${docId} のデータをコピーしました。`);

    // UIレンダリング (innerHTMLで構造をスマートに生成)
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

    // テキストエリアの挿入とコピーイベントのバインド
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

            // 各行のクリックイベント
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
                            // 3列目(インデックス2)にIDが入る前提として最適化
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
                            // 前のステップの要求通り、トリプル以外のID（URI）をコンソール表示
                            console.log(`[選択] カテゴリ: ${targetKey} | 名称: ${item.name} | ID/URI: ${item.uri || "IDが存在しません"}`);
                        }
                    }
                    updateLegendTable(targetKey); // 表示更新（選択背景のトグル用）
                };
            });
        };

        // 統計数ボタン
        const statsTable = section.querySelector(".stats-table");
        statsTable.onclick = (e) => {
            const btn = e.target.closest(".stats-toggle-btn");
            if (!btn) return;

            statsTable.querySelectorAll(".stats-toggle-btn").forEach(b => b.classList.remove("active"));
            btn.classList.add("active");

            const targetKey = btn.getAttribute("data-target");
            const labelText = btn.textContent;

            // テキスト更新
            if (titleEl) titleEl.textContent = `${labelText.replace(/[・数]/g, '')}一覧`;
            if (noticeEl) {
                noticeEl.textContent = targetKey === "triple" 
                    ? "※行をクリックで本文をトリプル番号（T1など）で絞り込み"
                    : "";
            }

            currentFilterTarget = null;
            textarea.value = textContent;
            if (window.cy) window.cy.elements().removeClass("highlighted-node dimmed-node");

            updateLegendTable(targetKey);
        };

        // 初期選択発火
        let defaultKey = stats.shEnabled ? "stakeholder" : "subject";
        const initialBtn = statsTable.querySelector(`.stats-toggle-btn[data-target="${defaultKey}"]`);
        if (initialBtn) initialBtn.click();
    }
}
