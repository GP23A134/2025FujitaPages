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
// 4. メイン変換処理 ＆ 依存関係ロジック
// ------------------------------------------------------------------------
function splitAndProcessData() {
    const bindings = window.output_json_data.results.bindings;
    document.getElementById("outputContainer").innerHTML = ""; // 前回の結果をクリア

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
        alert("該当するデータが見つかりませんでした。");
        return;
    }

    let globalColorCounter = 0; // カラーパレットのインデックス管理カウンター

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
                resolveColors(shId, stClassId);
            }
        }

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
            let shLabel     = "st_" + clean(getValueFromBinding(b, "stakeholderLabel"));
            let stClassLabel= "stc_" + clean(getValueFromBinding(b, "stClassLabel"));
            let opContent   = "op_" + clean(getValueFromBinding(b, "opinionContent"));
            let evContent   = "ev_" + clean(getValueFromBinding(b, "evidence"));

            // 必須である主語と目的語が欠落しているデータ行はスキップ
            if (sId === "" || oId === "") continue;

            // 統計用のユニーク数カウント（Setに追加）
            if (sId !== "") uniqueSubjects.add(sId);
            if (oId !== "") uniqueObjects.add(oId);
            if (sClassId !== "") uniqueSClasses.add(sClassId);
            if (oClassId !== "") uniqueOClasses.add(oClassId);
            if (shId !== "") uniqueStakeholders.add(shId);
            if (opId !== "") uniqueOpinions.add(opId);
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
                shNodeName = shLabel;
                let stCount = (wordAppearanceMap[shId] || 0) + 1;
                wordAppearanceMap[shId] = stCount;
                if (config.shNum) shNodeName = `${shNodeName}_${stCount}`; 
                speakerColor = finalSpeakerColorMap[shId] || config.cFixedSH;
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
                    // 主語がONなら：トリプルID から 主語テキストへ接続
                    docOutputBuffer += `${prefix}${trId}\t主語\t${displaySLabel}\t${config.cDefaultEdge}\t${config.cSubj}\t${config.cSubj}\n`;
                } else if (config.sClassEnabled && sClassId !== "") {
                    // 主語がOFFでも主語クラスがONなら：トリプルID から sClassノードへダイレクト接続
                    let directSClassKey = `${currentDocId}_${trId}_direct_sClass_${sClassId}`;
                    if (!classLinkSet.has(directSClassKey)) {
                        classLinkSet.add(directSClassKey);
                        docOutputBuffer += `${prefix}${trId}\tsClass\t${sClassLabel}\t${config.cDefaultEdge}\t${config.cSClass}\t${config.cSClass}\n`;
                    }
                }

                // 目的語の接続関係を完全別ルートで判定
                if (config.oEnabled) {
                    // 目的語がONなら：トリプルID から 目的語テキストへ接続
                    docOutputBuffer += `${prefix}${trId}\t目的語\t${displayOLabel}\t${config.cDefaultEdge}\t${config.cObj}\t${config.cObj}\n`;
                } else if (config.oClassEnabled && oClassId !== "") {
                    // 目的語がOFFでも目的語クラスがONなら：トリプルID から oClassノードへダイレクト接続
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

            // 主語・目的語不在時でもクラス直結がトリプル単位で欠落しないよう、キーにtrIdを含めて出力
            if (config.classLinkEnabled && sClassId !== "" && oClassId !== "") {
                let sToOClassKey = `${currentDocId}_${trId}_${sClassId}_to_${oClassId}`;
                if (!classLinkSet.has(sToOClassKey)) {
                    classLinkSet.add(sToOClassKey);
                    docOutputBuffer += `${prefix}${sClassLabel}\t-\t${ocLabel}\t${config.cSClass}\t${config.cOClass}\t${config.cSClassEdge}\n`;
                }
            }

            // 根拠(evidence)のテキストノード接続処理
            if (config.evEnabled && evContent !== "") {
                let safeEvContent = evContent.replace(/\n/g, " "); // 改行を半角スペースにエスケープ
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
                
                // 意見のテキストノード ➔ トリプルID への接続
                let trToOpinionKey = `${currentDocId}_${trId}_instance_${opId}`;
                if (!metadataLinkSet.has(trToOpinionKey)) {
                    metadataLinkSet.add(trToOpinionKey);
                    docOutputBuffer += `${prefix}${opinionNodeName}\t意見\t${trId}\t${opinionColor}\t${config.cDefaultEdge}\t${config.cDefaultEdge}\n`;
                }

                if (shId !== "") {
                    // 意見のテキストノード ➔ ステークホルダー名 への接続
                    let opinionToSpeakerKey = `${currentDocId}_${opId}_speaker_${shId}`;
                    if (!metadataLinkSet.has(opinionToSpeakerKey)) {
                        metadataLinkSet.add(opinionToSpeakerKey);
                        docOutputBuffer += `${prefix}${opinionNodeName}\tステークホルダー\t${shNodeName}\t${opinionColor}\t${speakerColor}\t${speakerColor}\n`;
                    }

                    // ステークホルダー名 ➔ 所属組織・クラス（stClass）への所属エッジ
                    if (config.stClass && stClassId !== "") {
                        let currentStClassColor = finalStClassColorMap[stClassId] || config.cStClass;
                        let stClassKey = `${currentDocId}_shNodeName_stClass_${stClassId}`;
                        
                        if (!classLinkSet.has(stClassKey)) {
                            classLinkSet.add(stClassKey);
                            docOutputBuffer += `${prefix}${shNodeName}\tstClass\t${stClassLabel}\t${speakerColor}\t${currentStClassColor}\t${currentStClassColor}\n`;
                        }
                    }
                }
            }
        }
        
        // ------------------------------------------------------------------------
        // 5. 左側：統計結果表示 ＆ スクロール凡例オブジェクト組み立て
        // ------------------------------------------------------------------------
        const customColorList = [];

        // ステークホルダーが有効な時、現在生成されたカラーマップを内訳リストに追加
        if (config.shEnabled) {
            if (config.shColorMode === "group") {
                Object.keys(finalStClassColorMap).forEach(stClassId => {
                    const className = stClassLabelMap[stClassId] || "不明な分類";
                    customColorList.push({ name: `【分類】${className}`, color: finalStClassColorMap[stClassId] });
                });
                Object.keys(finalSpeakerColorMap).forEach(shId => {
                    const shName = stakeholderLabelMap[shId] || "不明なステークホルダー";
                    customColorList.push({ name: `【個人】${shName}`, color: finalSpeakerColorMap[shId] });
                });
            } else {
                Object.keys(finalSpeakerColorMap).forEach(shId => {
                    const shName = stakeholderLabelMap[shId] || "不明なステークホルダー";
                    customColorList.push({ name: `【個人】${shName}`, color: finalSpeakerColorMap[shId] });
                });
            }
        }

        // カラーモード設定に基づいて凡例サブタイトルを決定
        let dynamicTitle = "ステークホルダー配色";
        if (config.shEnabled && config.shColorMode === "group") {
            dynamicTitle = "stClass配色";
        } else if (config.shEnabled && config.shColorMode === "select") {
            dynamicTitle = "単一固定指定配色";
        }

        // 描画関数用サマリーオブジェクトの構築
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
            dynamicColors: customColorList
        };

        let displayTitleId = (groupKey === "ALL_DOCUMENTS") ? "ALL_DOCUMENTS" : groupKey;
        
        // HTML要素を動的に構築・描画する処理へ引渡し
        createDocumentSection(displayTitleId, docOutputBuffer, statsSummary);
    }
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
        textarea.select();
        document.execCommand("copy");
        alert(`${docId} のデータをコピーしました。`);
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
        return `<span class="legend-color-box" style="background-color:${color};"></span>`;
    };

    // 条件ごとの統計行組み立て
    tableHtml += `<tr><td>${getBox("#adadad")}・総トリプル数</td><td>${stats.tripleCount}</td></tr>`;
    
    if (stats.sEnabled) {
        tableHtml += `<tr><td>${getBox(stats.cSubj)}・主語数</td><td>${stats.subjectCount}</td></tr>`;
    }
    if (stats.oEnabled) {
        tableHtml += `<tr><td>${getBox(stats.cObj)}・目的語数</td><td>${stats.objectCount}</td></tr>`;
    }
    if (stats.sClassEnabled) {
        tableHtml += `<tr><td>${getBox(stats.cSClass)}・主語クラス数</td><td>${stats.sClassCount}</td></tr>`;
    }
    if (stats.oClassEnabled) {
        tableHtml += `<tr><td>${getBox(stats.cOClass)}・目的語クラス数</td><td>${stats.oClassCount}</td></tr>`;
    }
    if (stats.shEnabled) {
        tableHtml += `<tr><td>${getBox("#adadad")}・ステークホルダー数</td><td>${stats.stakeholderCount}</td></tr>`;
        tableHtml += `<tr><td>${getBox("#adadad")}・意見数</td><td>${stats.opinionCount}</td></tr>`;
    }
    if (stats.evEnabled) {
        tableHtml += `<tr><td>${getBox(stats.cEv)}・根拠数</td><td>${stats.evidenceCount}</td></tr>`;
    }
    tableHtml += `</table>`;

    // 【左ペイン下部】スクロール対応の動的配色リスト構築
    if (docId !== "ALL_DOCUMENTS" && stats.dynamicColors.length > 0) {
        tableHtml += `<hr class="badge-divider">`;
        tableHtml += `<b class="badge-sub-title">${stats.titleName}</b>`;
        
        tableHtml += `<div class="legend-scroll-container">`;
        tableHtml += `<table class="dynamic-legend-table">`;
        
        stats.dynamicColors.forEach(item => {
            tableHtml += `<tr><td>${getBox(item.color)}<span class="legend-item-name">${item.name}</span></td></tr>`;
        });
        
        tableHtml += `</table>`;
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
    textarea.value = textContent; // 変換されたタブ区切りテキストを流し込み
    
    textPanel.appendChild(textarea);
    mainContent.appendChild(textPanel);

    section.appendChild(mainContent);
    container.appendChild(section);
}
