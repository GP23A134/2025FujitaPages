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
// ------------------------------------------------------------------------
// ご提示いただいたローディング表示・消去関数
// ------------------------------------------------------------------------
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
                // 該当データがない場合はアニメーションを消してアラート
                removeSearchIng();
                alert("該当するデータが見つかりませんでした。");
                if (execBtn) execBtn.disabled = false;
                return;
            }

            let globalColorCounter = 0; // カラーパレットのインデックス管理カウンター

            // メイン処理が始まったので、描画直前にローディング表示を消去
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
                const comboToTrMap = {};           // トリプルIDマップ
                let trCounter = 0;                 // トリプル(T0, T1...)カウンター
                let docOutputBuffer = "";          // タブ区切り文字列の一時保存バッファ
                const stakeholderLabelMap = {}; 
                const stClassLabelMap = {};

                // 【ループ第1期】カラー割当および名称マッピングの先行確定
                for (let item of wrappedBindings) {
                    let b = item.binding;
                    let shId      = extractIdFromUri(getValueFromBinding(b, "stakeholder"));
                    let stClassId = extractIdFromUri(getValueFromBinding(b, "stClass") || getValueFromBinding(b, "?stClass"));
                    let shLabel   = "st_" + clean(getValueFromBinding(b, "stakeholderLabel"));
                    let stClassLabel = "stc_" + clean(getValueFromBinding(b, "stClassLabel"));
                    if (shId !== "") {
                        stakeholderLabelMap[shId] = shLabel;
                        if (stClassId !== "") stClassLabelMap[stClassId] = stClassLabel;
                        // 【修正】すでに同じ shId のカラー設定が解決されている場合は、重複処理を避けるためスキップ
                        if (finalSpeakerColorMap[shId]) continue;
                        resolveColors(shId, stClassId);
                    }
                }
                // ナンバリング（連番）適用後の名前と色を正しく紐付けるための凡例用マップ
                const legendDisplayColorMap = {};

                // 【ループ第2期】メインのタブ区切りデータ変換、及び独立接続の判定
                for (let item of wrappedBindings) {
                    let b = item.binding;
                    let currentDocId = item.originalDocId; 

                    // URIからローカル名（ID）を抽出
                    let sId      = extractIdFromUri(getValueFromBinding(b, "s"));
                    let sClassId = extractIdFromUri(getValueFromBinding(b, "sClass"));
                    let pId      = extractIdFromUri(getValueFromBinding(b, "p"));
                    let oId      = extractIdFromUri(getValueFromBinding(b, "o"));
                    let oClassId = extractIdFromUri(getValueFromBinding(b, "oClass"));
                    let shId     = extractIdFromUri(getValueFromBinding(b, "stakeholder"));
                    let stClassId= extractIdFromUri(getValueFromBinding(b, "stClass") || getValueFromBinding(b, "?stClass"));
                    let opId     = extractIdFromUri(getValueFromBinding(b, "opinion"));

                    // 各種ラベルのクレンジングとプレフィックス付与
                    let sLabel      = "s_" + clean(getValueFromBinding(b, "sLabel"));
                    let sClassLabel = "sc_" + clean(getValueFromBinding(b, "sClassLabel"));
                    let pLabel      = clean(getValueFromBinding(b, "pLabel")); 
                    let oLabel      = "o_" + clean(getValueFromBinding(b, "oLabel"));
                    let ocLabel     = "oc_" + clean(getValueFromBinding(b, "oClassLabel"));
                    let shLabel_cleansed = "st_" + clean(getValueFromBinding(b, "stakeholderLabel"));
                    let stClassLabel= "stc_" + clean(getValueFromBinding(b, "stClassLabel"));
                    let opContent   = "op_" + clean(getValueFromBinding(b, "opinionContent"));
                    let evContent   = "ev_" + clean(getValueFromBinding(b, "evidence"));

                    // 必須である主語と目的語が欠落しているデータ行はスキップ
                    if (sId === "" || oId === "") continue;

                    // 統計用のユニーク数カウント（Setに追加）
                    if (sId !== "") uniqueSubjects.add(sLabel);
                    if (oId !== "") uniqueObjects.add(oLabel);
                    if (sClassId !== "") uniqueSClasses.add(sClassLabel);
                    if (oClassId !== "") uniqueOClasses.add(ocLabel);
                    if (shId !== "") uniqueStakeholders.add(shId);
                    if (opId !== "") uniqueOpinions.add(opContent);
                    if (evContent !== "") uniqueEvidences.add(evContent);

                    let displaySLabel = sLabel;
                    let displayOLabel = oLabel;

                    // トリプルIDの一意発行
                    let comboKey = `${currentDocId}_${sId}|${pId}|${oId}`;
                    let isFirstTimeTr = false;
                    if (!comboToTrMap[comboKey]) {
                        comboToTrMap[comboKey] = "T" + trCounter;
                        trCounter++;
                        isFirstTimeTr = true; 
                    }
                    let trId = comboToTrMap[comboKey];

                    // 主語・目的語の個別ナンバリング設定時の名称書き換え
                    if (config.soNum) {
                        displaySLabel = `${sLabel}_${trId}`;
                        displayOLabel = `${oLabel}_${trId}`;
                    }

                    // ステークホルダーの発言順ナンバリング処理
                    let shNodeName = "";
                    let speakerColor = config.cFixedSH;
                    if (shId !== "") {
                        shNodeName = shLabel_cleansed;
                        let stCount = (wordAppearanceMap[shId] || 0) + 1;
                        wordAppearanceMap[shId] = stCount;
                        if (config.shNum) shNodeName = `${shNodeName}_${stCount}`; 
                        speakerColor = finalSpeakerColorMap[shId] || config.cFixedSH;

                        // 表示用オブジェクト用にナンバリング確定後の名称でマッピングを保持
                        if (config.shColorMode === "group") {
                            const className = stClassLabelMap[stClassId] || "不明な分類";
                            legendDisplayColorMap[`stClass_${stClassId}`] = { name: `【分類】${className}`, color: finalStClassColorMap[stClassId] };
                            legendDisplayColorMap[`sh_${shId}_${stCount}`] = { name: `【個人】${shNodeName}`, color: speakerColor };
                        } else {
                            legendDisplayColorMap[`sh_${shId}_${stCount}`] = { name: `【個人】${shNodeName}`, color: speakerColor };
                        }
                    }

                    // 一括出力モード時のみ、最左列にファイル識別用の一括プレフィックス列を挿入
                    let prefix = (config.targetId === "") ? `${currentDocId}\t` : "";
                    
                    // 初めて登場したトリプルの場合の基本ストラクチャ構築
                    if (isFirstTimeTr) {
                        // 主語 ➔ 目的語 の関係性エッジ（述語）の出力
                        if (config.pEnabled) {
                            docOutputBuffer += `${prefix}${displaySLabel}\t${pLabel}\t${displayOLabel}\t${config.cSubj}\t${config.cObj}\t${config.cPred}\n`;
                        }

                        // 主語の接続関係を完全別ルートで判定
                        if (config.sEnabled) {
                            docOutputBuffer += `${prefix}${trId}\t主語\t${displaySLabel}\t${config.cDefaultEdge}\t${config.cSubj}\t${config.cSubj}\n`;
                        } else if (config.sClassEnabled && sClassId !== "") {
                            let directSClassKey = `${currentDocId}_${trId}_direct_sClass_${sClassId}`;
                            if (!classLinkSet.has(directSClassKey)) {
                                classLinkSet.add(directSClassKey);
                                docOutputBuffer += `${prefix}${trId}\tsClass\t${sClassLabel}\t${config.cDefaultEdge}\t${config.cSClass}\t${config.cSClass}\n`;
                            }
                        }

                        // 目的語の接続関係を完全別ルートで判定
                        if (config.oEnabled) {
                            docOutputBuffer += `${prefix}${trId}\t目的語\t${displayOLabel}\t${config.cDefaultEdge}\t${config.cObj}\t${config.cObj}\n`;
                        } else if (config.oClassEnabled && oClassId !== "") {
                            let directOClassKey = `${currentDocId}_${trId}_direct_oClass_${oClassId}`;
                            if (!classLinkSet.has(directOClassKey)) {
                                classLinkSet.add(directOClassKey);
                                docOutputBuffer += `${prefix}${trId}\toClass\t${ocLabel}\t${config.cDefaultEdge}\t${config.cOClass}\t${config.cOClass}\n`;
                            }
                        }
                    }

                    // 主語 ➔ 主語クラス への所属エッジ
                    if (config.sEnabled && config.sClassEnabled && sClassId !== "") {
                        let sClassKey = `${currentDocId}_${displaySLabel}_to_sClass_${sClassId}`;
                        if (!classLinkSet.has(sClassKey)) {
                            classLinkSet.add(sClassKey);
                            docOutputBuffer += `${prefix}${displaySLabel}\tsClass\t${sClassLabel}\t${config.cSubj}\t${config.cSClass}\t${config.cSClass}\n`;
                        }
                    }
                    
                    // 目的語 ➔ 目的語クラス への所属エッジ
                    if (config.oEnabled && config.oClassEnabled && oClassId !== "") {
                        let oClassKey = `${currentDocId}_${displayOLabel}_to_oClass_${oClassId}`;
                        if (!classLinkSet.has(oClassKey)) {
                            classLinkSet.add(oClassKey);
                            docOutputBuffer += `${prefix}${displayOLabel}\toClass\t${ocLabel}\t${config.cObj}\t${config.cOClass}\t${config.cOClass}\n`;
                        }
                    }

                    // クラス間直結エッジ
                    if (config.classLinkEnabled && sClassId !== "" && oClassId !== "") {
                        let sToOClassKey = `${currentDocId}_${trId}_${sClassId}_to_${oClassId}`;
                        if (!classLinkSet.has(sToOClassKey)) {
                            classLinkSet.add(sToOClassKey);
                            docOutputBuffer += `${prefix}${sClassLabel}\t-\t${ocLabel}\t${config.cSClass}\t${config.cOClass}\t${config.cSClassEdge}\n`;
                        }
                    }

                    // 根拠(evidence)のテキストノード接続処理
                    if (config.evEnabled && evContent !== "") {
                        let safeEvContent = evContent.replace(/\n/g, " "); 
                        let trToEvidenceKey = `${currentDocId}_${trId}_evidence_${safeEvContent}`;
                        if (!metadataLinkSet.has(trToEvidenceKey)) {
                            metadataLinkSet.add(trToEvidenceKey);
                            docOutputBuffer += `${prefix}${trId}\tevidence\t${safeEvContent}\t${config.cDefaultEdge}\t${config.cEv}\t${config.cEv}\n`;
                        }
                    }

                    // ステークホルダー・意見発言関係ノードの結合
                    if (config.shEnabled && opId !== "") {
                        let opinionNodeName = opContent;
                        let opinionColor = darkenColor(speakerColor, 0.80); 
                        
                        let trToOpinionKey = `${currentDocId}_${trId}_instance_${opId}`;
                        if (!metadataLinkSet.has(trToOpinionKey)) {
                            metadataLinkSet.add(trToOpinionKey);
                            docOutputBuffer += `${prefix}${opinionNodeName}\t意見\t${trId}\t${opinionColor}\t${config.cDefaultEdge}\t${config.cDefaultEdge}\n`;
                        }

                        if (shId !== "") {
                            let opinionToSpeakerKey = `${currentDocId}_${opId}_speaker_${shNodeName}`;
                            if (!metadataLinkSet.has(opinionToSpeakerKey)) {
                                metadataLinkSet.add(opinionToSpeakerKey);
                                docOutputBuffer += `${prefix}${opinionNodeName}\tステークホルダー\t${shNodeName}\t${opinionColor}\t${speakerColor}\t${speakerColor}\n`;
                            }

                            if (config.stClass && stClassId !== "") {
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
                
               // --- 5. 各種要素の一覧リストの抽出・オブジェクト組み立て ---
                const customColorList = [];
                if (config.shEnabled) {
                    const seenNames = new Set(); // 重複チェック用のセットを追加
                    Object.keys(legendDisplayColorMap).forEach(key => {
                        const item = legendDisplayColorMap[key];
        
                        // まだ追加されていない名前の組み合わせのみリストに格納
                        if (!seenNames.has(item.name)) {
                            seenNames.add(item.name);
                            customColorList.push({
                                name: item.name,
                                color: item.color
                            });
                        }
                    });
                }

                // 各種リストの生成
                const subjList = Array.from(uniqueSubjects).map(name => ({ name: name, color: config.cSubj }));
                const objList  = Array.from(uniqueObjects).map(name => ({ name: name, color: config.cObj }));
                const sClassList = Array.from(uniqueSClasses).map(name => ({ name: name, color: config.cSClass }));
                const oClassList = Array.from(uniqueOClasses).map(name => ({ name: name, color: config.cOClass }));
                const evList = Array.from(uniqueEvidences).map(text => ({ name: text, color: config.cEv }));

                // ✨【修正】意見（Opinion）のテキストと、その発言者の色を紐付けます
                // --- 意見（Opinion）のテキストと、その発言者の色を紐付けます ---
                const opList = [];
                if (config.shEnabled) {
                    const seenOpinions = new Set();
                    
                    for (let item of wrappedBindings) {
                        let b = item.binding;
                        let shId = extractIdFromUri(getValueFromBinding(b, "stakeholder"));
                        let opId = extractIdFromUri(getValueFromBinding(b, "opinion") || getValueFromBinding(b, "?opinion"));
                        let opContent = getValueFromBinding(b, "opinionContent");
                        
                        if (opId !== "" && opContent) {
                            let opLabel = "op_" + clean(opContent);
                            
                            if (!seenOpinions.has(opLabel)) {
                                seenOpinions.add(opLabel);
                                
                                // 💡 解決済みの全カラーが格納されている「finalSpeakerColorMap」から色を引きます
                                let shColor = "#adadad"; // 見つからない場合のデフォルト
                                
                                if (shId && finalSpeakerColorMap && finalSpeakerColorMap[shId]) {
                                    // 1. ID単体で登録されている場合
                                    shColor = finalSpeakerColorMap[shId];
                                } else if (shId && legendDisplayColorMap && legendDisplayColorMap[shId]) {
                                    // 2. 凡例マップ側にある場合
                                    shColor = legendDisplayColorMap[shId].color;
                                }
                                
                                opList.push({
                                    name: opLabel,
                                    color: shColor // ステークホルダーの色を確実にセット
                                });
                            }
                        }
                    }
                }

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
                        opinion: opList // 作成した意見リストを登録
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

    let tableHtml = `<b class="badge-main-title">解析結果統計</b>`;
    tableHtml += `<table class="stats-table">`;

    // 凡例用カラーサンプルボックス表示用インラインスタイルヘルパー
    const getBox = (color) => {
        if (docId === "ALL_DOCUMENTS") return "";
        return `<span class="legend-color-box" style="background-color:${color}; display:inline-block; width:12px; height:12px; border-radius:3px; margin-right:5px; vertical-align:middle;"></span>`;
    };

    const isAllDoc = (docId === "ALL_DOCUMENTS");
    
    // 総トリプル数（切り替え対象外なのでテキストのまま）
    tableHtml += `<tr><td>${getBox("#adadad")}総トリプル数</td><td>${stats.tripleCount}</td></tr>`;
    
    // 各統計行をボタン化 (isAllDocの時はボタンにしない)
    if (stats.sEnabled) {
        tableHtml += `<tr>
            <td>${getBox(stats.cSubj)}${isAllDoc ? '主語数' : `<button class="stats-toggle-btn" data-target="subject" data-doc="${docId}">主語数</button>`}</td>
            <td>${stats.subjectCount}</td>
        </tr>`;
    }
    if (stats.oEnabled) {
        tableHtml += `<tr>
            <td>${getBox(stats.cObj)}${isAllDoc ? '目的語数' : `<button class="stats-toggle-btn" data-target="object" data-doc="${docId}">目的語数</button>`}</td>
            <td>${stats.objectCount}</td>
        </tr>`;
    }
    if (stats.sClassEnabled) {
        tableHtml += `<tr>
            <td>${getBox(stats.cSClass)}${isAllDoc ? '主語クラス数' : `<button class="stats-toggle-btn" data-target="sClass" data-doc="${docId}">主語クラス数</button>`}</td>
            <td>${stats.sClassCount}</td>
        </tr>`;
    }
    if (stats.oClassEnabled) {
        tableHtml += `<tr>
            <td>${getBox(stats.cOClass)}${isAllDoc ? '目的語クラス数' : `<button class="stats-toggle-btn" data-target="oClass" data-doc="${docId}">目的語クラス数</button>`}</td>
            <td>${stats.oClassCount}</td>
        </tr>`;
    }
    if (stats.shEnabled) {
        tableHtml += `<tr>
            <td>${getBox("#adadad")}${isAllDoc ? 'ステークホルダー数' : `<button class="stats-toggle-btn" data-target="stakeholder" data-doc="${docId}">ステークホルダー数</button>`}</td>
            <td>${stats.stakeholderCount}</td>
        </tr>`;
        tableHtml += `<tr>
            <td>${getBox("#adadad")}${isAllDoc ? '意見数' : `<button class="stats-toggle-btn" data-target="opinion" data-doc="${docId}">意見数</button>`}</td>
            <td>${stats.opinionCount}</td>
            </tr>`;
    }
    if (stats.evEnabled) {
        tableHtml += `<tr>
            <td>${getBox(stats.cEv)}${isAllDoc ? '根拠数' : `<button class="stats-toggle-btn" data-target="evidence" data-doc="${docId}">根拠数</button>`}</td>
            <td>${stats.evidenceCount}</td>
        </tr>`;
    }
    tableHtml += `</table>`;

    // 下部の一覧リスト表示エリア
    if (!isAllDoc) {
        tableHtml += `<hr class="badge-divider" style="border:none; border-top:1px dashed #ccc; margin:25px 0 15px 0;">`;
        tableHtml += `<b id="legend-current-title-${docId}" class="badge-sub-title" style="display:block; margin-bottom:8px;"></b>`;

        //containerに横スクロール（overflow-x: auto）をつけ、テキストが勝手に折り返さないように（white-space: nowrap）します
        tableHtml += `<div class="legend-scroll-container" style="overflow-y: auto; overflow-x: auto; max-height: 200px;">`;
        tableHtml += `<table id="dynamic-legend-table-${docId}" class="dynamic-legend-table" style="width: max-content; min-width: 100%; white-space: nowrap;"></table>`;
        tableHtml += `</div>`;
        tableHtml += `<table id="dynamic-legend-table-${docId}" class="dynamic-legend-table" style="width:100%;"></table>`;
        tableHtml += `</div>`;
    }

    metaBadge.innerHTML = tableHtml;
    sidePanel.appendChild(metaBadge);
    mainContent.appendChild(sidePanel);

    // --- 【右ペイン】テキストエリアパネル ---
    const textPanel = document.createElement("div");
    textPanel.className = "doc-text-panel";

    const textarea = document.createElement("textarea");
    textarea.readOnly = true;
    textarea.value = textContent; 
    
    textPanel.appendChild(textarea);
    mainContent.appendChild(textPanel);

    section.appendChild(mainContent);
    container.appendChild(section);

    // --- ボタンによる一覧の動的切り替えロジック ---
    if (!isAllDoc) {
        const legendTable = document.getElementById(`dynamic-legend-table-${docId}`);
        const titleEl = document.getElementById(`legend-current-title-${docId}`);

        // 現在どの項目で本文を絞り込んでいるかを保持する変数
        let currentFilterTarget = null;

        // 下部の一覧テーブルと見出しを書き換える関数
        const updateLegendTable = (targetKey, labelText) => {
            const currentList = stats.lists[targetKey] || [];
            let rowsHtml = "";
            
            if (titleEl && labelText) {
                const cleanLabel = labelText.replace('・', '').replace('数', '');
                titleEl.textContent = `${cleanLabel}一覧（または配色）`;
            }
            
            if (currentList.length === 0) {
                rowsHtml = `<tr><td style="color:#888; font-style:italic; padding:5px;">データがありません</td></tr>`;
            } else {
                currentList.forEach(item => {
                    // 💡 リストの各行に「フィルター用クラス」と、クリック可能にするためのスタイル（cursor: pointer）を付与
                    // 💡 選択中の項目には視覚的に分かるよう active-filter-item クラスを付与
                    const isActive = (currentFilterTarget === item.name) ? "active-filter-item" : "";
                    const activeBg = (currentFilterTarget === item.name) ? "background-color: rgba(0,0,0,0.05);" : "";

                    rowsHtml += `<tr class="filter-trigger-row ${isActive}" data-value="${item.name}" style="cursor: pointer; ${activeBg}">
                        <td style="padding:6px 4px; vertical-align:middle;">
                            ${getBox(item.color)}
                            <span class="legend-item-name" style="vertical-align:middle; font-weight: ${isActive ? 'bold' : 'normal'};">${item.name}</span>
                        </td>
                    </tr>`;
                });
            }
            legendTable.innerHTML = rowsHtml;

            // 💡 一覧リストの行がクリックされたときの絞り込みイベントを設定
            const rows = legendTable.querySelectorAll(".filter-trigger-row");
            rows.forEach(row => {
                row.onclick = () => {
                    const clickedValue = row.getAttribute("data-value");
                    
                    // 1. 本文エリア内の「トリプルが描画されている1行ずつの塊（divやtrなど）」を取得
                    // ※お使いの出力バッファの構造に合わせて、適切なセレクタ（.triple-row や div.line など）に変えてください
                    // ここでは一般的なドキュメントセクション内の各行（段落やリスト項目）を対象にします
                    const textLines = section.querySelectorAll(".doc-text-container p, .doc-text-container div, .triple-item");

                    // もしすでに同じ項目で絞り込まれていたら解除
                    if (currentFilterTarget === clickedValue) {
                        currentFilterTarget = null;
                        textLines.forEach(line => line.style.display = ""); // 全表示に戻す
                        row.classList.remove("active-filter-item");
                        row.style.backgroundColor = "";
                        row.querySelector(".legend-item-name").style.fontWeight = "normal";
                    } else {
                        // 新しい項目で絞り込み
                        currentFilterTarget = clickedValue;
                        
                        // リスト側のハイライト表示を一旦リセットして再設定
                        rows.forEach(r => {
                            r.classList.remove("active-filter-item");
                            r.style.backgroundColor = "";
                            r.querySelector(".legend-item-name").style.fontWeight = "normal";
                        });
                        row.classList.add("active-filter-item");
                        row.style.backgroundColor = "rgba(0,0,0,0.08)";
                        row.querySelector(".legend-item-name").style.fontWeight = "bold";

                        // 本文の各行をループし、クリックしたキーワード（IDや意見文）が含まれているかチェック
                        textLines.forEach(line => {
                            // 行のテキスト（HTML含む）からキーワードを検索
                            // ID（s_001など）や意見テキストそのものが含まれているか判定
                            if (line.textContent.includes(clickedValue)) {
                                line.style.display = ""; // 含まれるものは表示
                            } else {
                                line.style.display = "none"; // 含まれないものは隠す
                            }
                        });
                    }
                };
            });
        };

        // 最初はどのデータを表示しておくかの初期値設定
        let defaultKey = "subject";
        let defaultLabel = "・主語数"; 

        if (stats.shEnabled) {
            defaultKey = "stakeholder";
            defaultLabel = "・ステークホルダー数";
        }

        updateLegendTable(defaultKey, defaultLabel);

        // 各ボタンにクリックイベントを設定
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
                
                // タブ（主語・意見など）が切り替わったら、一旦絞り込みはクリアする
                currentFilterTarget = null;
                updateLegendTable(targetKey, labelText);
            };
        });
    }
}
