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
// 4. メメイン変換処理 ＆ 相互接続連動フィルタ
// ------------------------------------------------------------------------
function splitAndProcessData() {
    // 画面上の「実行ボタン」と、結果を描画する「出力コンテナ」のエレメントを取得
    const execBtn = document.getElementById("execBtn");
    const outputContainer = document.getElementById("outputContainer");
    
    // 処理中の二重クリックを防止するため、実行ボタンを一時的に無効化
    if (execBtn) execBtn.disabled = true;
    // 前回の処理結果が残っている場合は、コンテナの中身を一度空にする
    if (outputContainer) outputContainer.innerHTML = ""; 
    // ユーザーに処理中であることを伝えるため、ローディングアニメーション（Loading...）を表示
    showSearchIng(outputContainer);

    // 大量のデータを処理する際の画面フリーズを回避するため、50ミリ秒のウェイトを置いてブラウザの描画を確定させる
    setTimeout(() => {
        try {
            // グローバルに保持されているSPARQLクエリの結果（JSONデータ）から、実際のデータ行（bindings）を取り出す
            const bindings = window.output_json_data?.results?.bindings;
            // データが存在しない（クエリが実行されていない、またはエラーだった）場合は例外をスローしてキャッチ処理へ
            if (!bindings) throw new Error("Bindings data not found");

            // 画面上の各チェックボックスの「チェック状態（true/false）」を取得。エレメントが無い場合はfalseをデフォルト値にする
            const shEnabledRaw = document.getElementById("enableStakeholder")?.checked ?? false;
            const sEnabled       = document.getElementById("enableSubject")?.checked ?? false;
            const oEnabled       = document.getElementById("enableObject")?.checked ?? false;
            const sClassEnabled  = document.getElementById("enableSClass")?.checked ?? false;
            const oClassEnabled  = document.getElementById("enableOClass")?.checked ?? false;

            // 変換ロジック内で何度も参照する設定（コンフィグ）を一元管理するためのオブジェクト
            const config = {
                sEnabled: sEnabled, // 主語ノードを出力するかどうか
                oEnabled: oEnabled, // 目的語ノードを出力するかどうか
                // 述語（エッジ）は、主語と目的語の両方が有効、かつ「述語有効」にチェックがある場合のみtrueにする
                pEnabled: sEnabled && oEnabled && (document.getElementById("enablePredicate")?.checked ?? false), 
                sClassEnabled: sClassEnabled,   // 主語のクラス（分類）を出力するかどうか
                oClassEnabled: oClassEnabled,   // 目的語のクラス（分類）を出力するかどうか
                // クラス間リンクは、両方のクラスが有効、かつ「クラス間接続」にチェックがある場合のみtrueにする
                classLinkEnabled: sClassEnabled && oClassEnabled && (document.getElementById("enableClassLink")?.checked ?? false), 
                shEnabled: shEnabledRaw,        // 発話者（ステークホルダー）を出力するかどうか
                evEnabled: document.getElementById("enableEvidence")?.checked ?? false, // 根拠（エビデンス）を出力するかどうか
                shNum: shEnabledRaw && (document.getElementById("enableStakeholderNumbering")?.checked ?? false), // 発話者に通し番号を付与するか
                stClass: shEnabledRaw && (document.getElementById("enableStClass")?.checked ?? false), // 発話者の所属（組織分類）を出力するか
                soNum: document.getElementById("enableSubjectObjectNumbering")?.checked ?? false, // 主語・目的語にトリプルIDベースの番号を付与するか
                targetId: document.getElementById("targetDocId")?.value ?? "", // 特定のドキュメントのみを抽出する場合のターゲットID
                shColorMode: document.querySelector('input[name="shColorMode"]:checked')?.value || "random", // 発話者の色分けモード（ランダム/グループ化/固定）
                // 以下、画面のカラーピッカーから取得した各要素のカラーコード群（未指定時はデフォルトの黒 #000000 を設定）
                cSubj: document.getElementById("cpSubject")?.value || "#000000",
                cObj: document.getElementById("cpObject")?.value || "#000000",
                cPred: document.getElementById("cpPredicate")?.value || "#000000",
                cSClass: document.getElementById("cpSClass")?.value || "#000000",
                cOClass: document.getElementById("cpOClass")?.value || "#000000",
                cSClassEdge: document.getElementById("cpSClassEdge")?.value || "#000000", 
                cEv: document.getElementById("cpEvidence")?.value || "#000000",
                cStClass: document.getElementById("cpStClass")?.value || "#000000",
                cFixedSH: document.getElementById("cpStakeholder")?.value || "#000000",
                cDefaultEdge: "#adadad" // 関係性を示す標準エッジの色（グレー）
            };

            // 全データをドキュメントID（グラフURI）ごとに振り分けてグループ化するための空オブジェクト
            const docGroups = {};
            for (let i = 0; i < bindings.length; i++) {
                const b = bindings[i];
                // URIからドキュメントの固有ID（末尾の文字列など）を抽出する
                const docId = extractIdFromUri(getValueFromBinding(b, "g") || getValueFromBinding(b, "?g"));
                // 指定されたターゲットIDがある場合、それ以外のドキュメントのデータはすべてスキップ（無視）する
                if (config.targetId !== "" && docId !== config.targetId) continue; 
                
                // ターゲットIDの指定が空の場合は「ALL_DOCUMENTS」という1つの巨大なグループに集約し、指定があればドキュメントごとのキーを割り当てる
                const groupKey = (config.targetId === "") ? "ALL_DOCUMENTS" : docId;
                if (!docGroups[groupKey]) docGroups[groupKey] = [];
                // データの塊（binding）、オリジナルのドキュメントID、および元のデータの絶対インデックス（背番号）をセットで配列に格納
                docGroups[groupKey].push({ binding: b, originalDocId: docId, lineIndex: i });
            }

            // 指定した条件に合致するグループやデータが一つも存在しなかった場合の処理
            if (Object.keys(docGroups).length === 0) {
                removeSearchIng(); // ローディングを非表示にする
                alert("該当するデータが見つかりませんでした。");
                if (execBtn) execBtn.disabled = false; // ボタンを再活性化
                return; // 処理を中断
            }

            // ランダム色分けの際に、パレットから重複なく色を割り当てるためのグローバルカウンター
            let globalColorCounter = 0;
            removeSearchIng(); // 振り分けに成功したため、ここで一度ローディングアニメーションを消去

            // 発話者や組織のノードに対して、設定されたモードに基づいたカラーを解決するためのヘルパークラス
            const colorResolver = {
                localSpeakerMap: {}, // 発話者IDごとの決定カラーを記憶する連想配列
                localStClassMap: {},  // 所属組織IDごとの決定カラーを記憶する連想配列
                // 個別の発話者に対してパレットから順番にユニークな色を割り当てて返すメソッド
                getIndividualColor(id) {
                    if (this.localSpeakerMap[id]) return this.localSpeakerMap[id];
                    const color = SPEAKER_PALETTE[globalColorCounter % SPEAKER_PALETTE.length];
                    this.localSpeakerMap[id] = color;
                    globalColorCounter++;
                    return color;
                },
                // 所属組織（グループ）に対してパレットから順番にユニークな色を割り当てて返すメソッド
                getGroupColor(id) {
                    if (this.localStClassMap[id]) return this.localStClassMap[id];
                    const color = SPEAKER_PALETTE[globalColorCounter % SPEAKER_PALETTE.length];
                    this.localStClassMap[id] = color;
                    globalColorCounter++;
                    return color;
                },
                // 画面で指定されたカラーモード（固定・グループ別・ランダム）に従い、オブジェクトに色を代入するメイン処理
                resolve(shId, stClassId, finalSpeakerMap, finalStClassMap) {
                    // 1. 固定色モード（すべての発話者を指定された1色に統一する）
                    if (config.shColorMode === "select") {
                        finalSpeakerMap[shId] = config.cFixedSH;
                        if (stClassId) finalStClassMap[stClassId] = config.cStClass;
                        return;
                    }
                    // 2. グループ別モード（組織ごとに色を変え、その所属メンバーは組織の色を少し暗くした同系色にする）
                    if (config.shColorMode === "group") {
                        if (stClassId) {
                            const groupColor = this.getGroupColor(stClassId);
                            finalStClassColorMap[stClassId] = groupColor; 
                            finalSpeakerMap[shId] = darkenColor(groupColor, 0.85); // 組織色をベースに15%明度を落とす
                        } else if (!finalSpeakerMap[shId]) {
                            finalSpeakerMap[shId] = this.getIndividualColor(shId); // 組織が不明な場合は個別カラーを適用
                        }
                        return;
                    }
                    // 3. ランダムモード（発話者一人一人に全く異なる色をランダムに割り当てる）
                    if (config.shColorMode === "random") {
                        finalSpeakerMap[shId] = this.getIndividualColor(shId);
                        if (stClassId) finalStClassMap[stClassId] = config.cStClass;
                    }
                }
            };

            // グループ化されたドキュメントごとに、ループを回してTSVテキストデータの組み立てと統計処理を開始
            for (const groupKey of Object.keys(docGroups)) {
                const wrappedBindings = docGroups[groupKey];
                
                // 特定の単語や発話者が、このドキュメント内で何回登場したかを数えるためのマップ
                const wordAppearanceMap = {}; 
                const finalSpeakerColorMap = {}; 
                const finalStClassColorMap = {}; 

                // 重複のないユニークな要素の数を正確に把握するためのSet構造
                const uniqueSubjects = new Set();
                const uniqueObjects = new Set();
                const uniqueSClasses = new Set();
                const uniqueOClasses = new Set();
                const uniqueEvidences = new Set();
                const uniqueOpinions = new Set();
                const uniqueTriples = new Set();
                
                // トリプルの識別ラベルや発話者ラベルの対応表を記憶する連想配列
                const tripleLabelMap = {};
                const stakeholderLabelMap = {}; 
                const stClassLabelMap = {};
                const legendDisplayColorMap = {};
                const shExactCountMap = {};
                const nameToColorCacheMap = {}; // ループ内のカラー算出を高速化するためのキャッシュ用配列

                // どの単語（キー）が、元のデータの何番目の行（インデックス）に含まれているかを紐付けるリスト（相互連動の核心部分）
                const bindingIndexesMap = {
                    triple: {}, subject: {}, object: {}, sClass: {}, oClass: {}, stakeholder: {}, opinion: {}, evidence: {}
                };

                // 各カテゴリごとの出現回数をカウントするための整数マップ
                const jsonCountMap = {
                    stakeholder: {}, subject: {}, object: {}, sClass: {}, oClass: {}, evidence: {}, opinion: {}, triple: {}
                };

                // 要素名とそれが登場した絶対インデックス（背番号）を、bindingIndexesMapに安全に追加するための内部共通関数
                const pushIndex = (category, key, idx) => {
                    if (!key) return;
                    if (!bindingIndexesMap[category][key]) bindingIndexesMap[category][key] = [];
                    // 重複登録を避けるため、まだ配列にそのインデックスが存在しない場合のみpushする
                    if (!bindingIndexesMap[category][key].includes(idx)) {
                        bindingIndexesMap[category][key].push(idx);
                    }
                };

                // ─── 【第1パス】 ───
                // 描画やカラー決定に必要な発話者と組織クラスの関係性を事前にスキャンしてマッピングする
                for (let i = 0; i < wrappedBindings.length; i++) {
                    const b = wrappedBindings[i].binding;
                    const shId = extractIdFromUri(getValueFromBinding(b, "stakeholder"));
                    const stClassId = extractIdFromUri(getValueFromBinding(b, "stClass") || getValueFromBinding(b, "?stClass"));
                    const cleanShName = clean(getValueFromBinding(b, "stakeholderLabel"));
                    
                    // 発話者名が空、または「個人」「【個人】」といった意味を持たないプレースホルダーの場合は統計から除外する
                    if (/^(【個人】|個人|)$/.test(cleanShName)) continue;

                    const shLabel = "st_" + cleanShName;
                    const stClassLabel = "stc_" + clean(getValueFromBinding(b, "stClassLabel"));
                    if (shId !== "") {
                        stakeholderLabelMap[shId] = shLabel;
                        if (stClassId !== "") stClassLabelMap[stClassId] = stClassLabel;
                        // まだカラーが決定していない新しい発話者であれば、カラーリゾルバーに問い合わせて色を確定させる
                        if (!finalSpeakerColorMap[shId]) {
                            colorResolver.resolve(shId, stClassId, finalSpeakerColorMap, finalStClassColorMap);
                        }
                    }
                }

                // 同一ドキュメント内でのエッジ（接続線）の重複出力を防ぐための判定用Set群
                const classLinkSet = new Set(); 
                const metadataLinkSet = new Set(); 
                const comboToTrMap = {}; 
                const opinionToColorMap = {};
                let trCounter = 0; // トリプルの通し番号（T0, T1, T2...）を生成するためのカウンタ

                // 📄 【重複排除・改良箇所】
                // 文字列の+=結合をやめ、最初から「行ごとの文字列を格納する配列」として初期化する
                let docOutputLines = []; 

                // 配列の最初の要素（0番目の部屋）として、TSVデータのカラム定義（ヘッダー行）を格納
                const headerPrefix = (config.targetId === "") ? "documentId\t" : "";
                docOutputLines.push(`${headerPrefix}source\ttype\ttarget\tedgeColor\tsourceColor\ttargetColor`);

                // ─── 【第2パス】 ───
                // データを一行ずつ解析し、関係性ネットワーク（トリプル）を構築して配列に格納していく
                for (let i = 0; i < wrappedBindings.length; i++) {
                    const item = wrappedBindings[i];
                    const b = item.binding;
                    const currentDocId = item.originalDocId; 
                    const curIdx = item.lineIndex; // このデータが持っている元データ上の絶対背番号

                    // 各種リソースのURI情報をJSONから取得
                    const sUri = getValueFromBinding(b, "s");
                    const sClassUri = getValueFromBinding(b, "sClass");
                    const oUri = getValueFromBinding(b, "o");
                    const oClassUri = getValueFromBinding(b, "oClass");
                    const shUri = getValueFromBinding(b, "stakeholder");
                    const opUri = getValueFromBinding(b, "opinion");

                    // URIからID文字列のみを抽出
                    const sId = extractIdFromUri(sUri);
                    const sClassId = extractIdFromUri(sClassUri);
                    const pId = extractIdFromUri(getValueFromBinding(b, "p"));
                    const oId = extractIdFromUri(oUri);
                    const oClassId = extractIdFromUri(oClassUri);
                    const shId = extractIdFromUri(shUri);
                    const stClassId = extractIdFromUri(getValueFromBinding(b, "stClass") || getValueFromBinding(b, "?stClass"));
                    const opId = extractIdFromUri(opUri);

                    // 表示用の生ラベル（名称）を取得して特殊文字などをクリーンアップ
                    const sLabelRaw = clean(getValueFromBinding(b, "sLabel"));
                    const oLabelRaw = clean(getValueFromBinding(b, "oLabel"));
                    const shLabelRaw = clean(getValueFromBinding(b, "stakeholderLabel"));
                    const opContentRaw = clean(getValueFromBinding(b, "opinionContent"));
                    const evContentRaw = clean(getValueFromBinding(b, "evidence"));
                    const sClassLabelRaw = clean(getValueFromBinding(b, "sClassLabel"));
                    const oClassLabelRaw = clean(getValueFromBinding(b, "oClassLabel"));
                    const stClassLabelRaw = clean(getValueFromBinding(b, "stClassLabel"));

                    // 主語または目的語が欠落している不完全なデータ行は、ネットワークを構成できないため処理をスキップ
                    if (sId === "" || oId === "") continue;

                    // カテゴリの混同を防ぐため、IDの先頭に識別用のプレフィックス（接頭辞）を結合
                    const sLabel = "s_" + sLabelRaw;
                    const sClassLabel = "sc_" + sClassLabelRaw;
                    const pLabel = clean(getValueFromBinding(b, "pLabel")); 
                    const oLabel = "o_" + oLabelRaw;
                    const ocLabel = "oc_" + oClassLabelRaw;
                    const shLabel_cleansed = "st_" + shLabelRaw;
                    const stClassLabel = "stc_" + stClassLabelRaw;
                    const evContent = "ev_" + evContentRaw;

                    // ドキュメントIDと主語・述語・目的語を組み合わせた一意のコンボキーを作成
                    const comboKeyForId = `${currentDocId}_${sId}|${pId}|${oId}`;
                    let isFirstTimeTr = false;
                    
                    // このコンボキー（トリプル）が初登場の場合のみ、新しいトリプルID（T0, T1...）を割り当てる
                    if (!comboToTrMap[comboKeyForId]) {
                        comboToTrMap[comboKeyForId] = "T" + trCounter;
                        trCounter++;
                        isFirstTimeTr = true; // このトリプルに関する基本情報を出力するフラグを立てる
                    }
                    const trId = comboToTrMap[comboKeyForId]; 

                    // 統計表示用のトリプル名ラベル
                    const tripleMapKey = `${sLabelRaw} | ${pLabel} | ${oLabelRaw}`;
                    const tripleDisplayLabel = `${trId}_${sLabelRaw}_${pLabel}_${oLabelRaw}`; 

                    // 各種Setへの追加と出現件数のインクリメント、および背番号マップ（相互連動用）への登録
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

                    // ナンバリング設定が有効な場合、ラベルの末尾にトリプルIDを付与してノードの重複合体を防止する
                    const displaySLabel = config.soNum ? `${sLabel}_${trId}` : sLabel;
                    const displayOLabel = config.soNum ? `${oLabel}_${trId}` : oLabel;
                    
                    let shNodeName = "";
                    let speakerColor = config.cFixedSH;
                    if (shId !== "" && shLabelRaw) {
                        shNodeName = shLabel_cleansed;
                        const stCount = (wordAppearanceMap[shId] || 0) + 1;
                        wordAppearanceMap[shId] = stCount;
                        // 発話者ナンバリングが有効なら、同じ人でも発言ごとに別ノード（鈴木さん_1, 鈴木さん_2）として扱う
                        shNodeName = config.shNum ? `${shNodeName}_${stCount}` : shNodeName;
                        speakerColor = finalSpeakerColorMap[shId] || config.cFixedSH;
                        
                        shExactCountMap[shLabel_cleansed] = (shExactCountMap[shLabel_cleansed] || 0) + 1;
                        jsonCountMap.stakeholder[shNodeName] = (jsonCountMap.stakeholder[shNodeName] || 0) + 1;
                        pushIndex("stakeholder", shLabel_cleansed, curIdx);

                        if (opContentRaw) {
                            uniqueOpinions.add(opContentRaw);
                            jsonCountMap.opinion[opContentRaw] = (jsonCountMap.opinion[opContentRaw] || 0) + 1;
                            pushIndex("opinion", opContentRaw, curIdx);
                            opinionToColorMap[opContentRaw] = speakerColor; // 意見ノードの背景色を発話者の色と同調させる
                        }

                        if (config.shColorMode === "group") {
                            const className = stClassLabelMap[stClassId] || "不明な分類";
                            legendDisplayColorMap[`stClass_${stClassId}`] = { name: `【分類】${className}`, color: finalStClassColorMap[stClassId], uri: sClassUri };
                        }
                        legendDisplayColorMap[`sh_${shId}`] = { name: `${shLabel_cleansed}`, color: speakerColor, uri: shUri };
                        nameToColorCacheMap[shLabel_cleansed] = speakerColor; // 高速参照用の連想配列に色をプール
                    }

                    // 全ドキュメント出力モードの場合は、行の先頭に所属ドキュメントIDカラムを自動で付与する
                    const prefix = (config.targetId === "") ? `${currentDocId}\t` : "";

                    // 📄 【重複排除・改良箇所】
                    // 文字列への直結合（+=）を全廃し、生成されたTSVの各行データを配列へ直接追加（push）する形に変更
                    if (isFirstTimeTr) {
                        if (config.pEnabled) {
                            // 主語 ─(述語)─> 目的語 の関係性エッジを生成
                            docOutputLines.push(`${prefix}${displaySLabel}\t${pLabel}\t${displayOLabel}\t${config.cSubj}\t${config.cObj}\t${config.cPred}`);
                        }
                        if (config.sEnabled) {
                            // トリプルIDノードから主語ノードへの接続線を生成
                            docOutputLines.push(`${prefix}${trId}\t主語\t${displaySLabel}\t${config.cDefaultEdge}\t${config.cSubj}\t${config.cSubj}`);
                        } else if (config.sClassEnabled && sClassId !== "" && sClassLabelRaw) {
                            const directSClassKey = `${currentDocId}_${trId}_direct_sClass_${sClassId}`;
                            if (!classLinkSet.has(directSClassKey)) {
                                classLinkSet.add(directSClassKey);
                                // 主語ノードが非表示かつ主語クラスが有効な場合、トリプルIDから直接クラスへ繋ぐ線を生成
                                docOutputLines.push(`${prefix}${trId}\tsClass\t${sClassLabel}\t${config.cDefaultEdge}\t${config.cSClass}\t${config.cSClass}`);
                            }
                        }
                        if (config.oEnabled) {
                            // トリプルIDノードから目的語ノードへの接続線を生成
                            docOutputLines.push(`${prefix}${trId}\t目的語\t${displayOLabel}\t${config.cDefaultEdge}\t${config.cObj}\t${config.cObj}`);
                        } else if (config.oClassEnabled && oClassId !== "" && oClassLabelRaw) {
                            const directOClassKey = `${currentDocId}_${trId}_direct_oClass_${oClassId}`;
                            if (!classLinkSet.has(directOClassKey)) {
                                classLinkSet.add(directOClassKey);
                                // 目的語ノードが非表示かつ目的語クラスが有効な場合、トリプルIDから直接クラスへ繋ぐ線を生成
                                docOutputLines.push(`${prefix}${trId}\toClass\t${ocLabel}\t${config.cDefaultEdge}\t${config.cOClass}\t${config.cOClass}`);
                            }
                        }
                    }

                    if (config.sEnabled && config.sClassEnabled && sClassId !== "" && sClassLabelRaw) {
                        const scKey = `${currentDocId}_${sId}_${sClassId}`;
                        if (!classLinkSet.has(scKey)) {
                            classLinkSet.add(scKey);
                            // 主語ノードから、それが属する主語クラス（分類群）への所属エッジを生成
                            docOutputLines.push(`${prefix}${displaySLabel}\tsClass\t${sClassLabel}\t${config.cDefaultEdge}\t${config.cSClass}\t${config.cSClass}`);
                        }
                    }
                    if (config.oEnabled && config.oClassEnabled && oClassId !== "" && oClassLabelRaw) {
                        const ocKey = `${currentDocId}_${oId}_${oClassId}`;
                        if (!classLinkSet.has(ocKey)) {
                            classLinkSet.add(ocKey);
                            // 目的語ノードから、それが属する目的語クラス（分類群）への所属エッジを生成
                            docOutputLines.push(`${prefix}${displayOLabel}\toClass\t${ocLabel}\t${config.cDefaultEdge}\t${config.cOClass}\t${config.cOClass}`);
                        }
                    }
                    if (config.classLinkEnabled && sClassId !== "" && sClassLabelRaw && oClassId !== "" && oClassLabelRaw) {
                        const linkKey = `${currentDocId}_${sClassId}_${oClassId}`;
                        if (!classLinkSet.has(linkKey)) {
                            classLinkSet.add(linkKey);
                            // 主語クラスと目的語クラスの間に直接ブリッジを架けるクラス間エッジを生成
                            docOutputLines.push(`${prefix}${sClassLabel}\tclassLink\t${ocLabel}\t${config.cSClassEdge}\t${config.cSClass}\t${config.cOClass}`);
                        }
                    }

                    if (shId !== "" && shLabelRaw) {
                        const shMetaKey = `${currentDocId}_${trId}_${shNodeName}`;
                        if (!metadataLinkSet.has(shMetaKey)) {
                            metadataLinkSet.add(shMetaKey);
                            // トリプルIDノードから、その発言を行った「発話者」へ繋ぐメタデータエッジを生成
                            docOutputLines.push(`${prefix}${trId}\t発話者\t${shNodeName}\t${config.cDefaultEdge}\t${speakerColor}\t${speakerColor}`);
                        }
                        
                        if (config.stClass && stClassId !== "" && stClassLabelRaw) {
                            const stcKey = `${currentDocId}_${shNodeName}_${stClassId}`;
                            if (!classLinkSet.has(stcKey)) {
                                classLinkSet.add(stcKey);
                                const classColor = finalStClassColorMap[stClassId] || config.cStClass;
                                // 発話者から、その人が所属する組織（ステークホルダー分類クラス）への所属エッジを生成
                                docOutputLines.push(`${prefix}${shNodeName}\t所属\t${stClassLabel}\t${config.cDefaultEdge}\t${classColor}\t${classColor}`);
                            }
                        }
                        if (opContentRaw) {
                            const opMetaKey = `${currentDocId}_${shNodeName}_opinion_${opId}`;
                            if (!metadataLinkSet.has(opMetaKey)) {
                                metadataLinkSet.add(opMetaKey);
                                // 発話者ノードから、具体的な発言の本文テキスト（意見ノード）へ繋ぐエッジを生成
                                docOutputLines.push(`${prefix}${shNodeName}\t意見\t${opContentRaw}\t${config.cDefaultEdge}\t#f0f0f0\t#f0f0f0`);
                            }
                        }
                    }

                    if (config.vEnabled || config.evEnabled && evContentRaw !== "") {
                        const evMetaKey = `${currentDocId}_${trId}_evidence_${evContent}`;
                        if (!metadataLinkSet.has(evMetaKey)) {
                            metadataLinkSet.add(evMetaKey);
                            // トリプルIDノードから、その事実を裏付ける情報（根拠/エビデンスノード）へ繋ぐエッジを生成
                            docOutputLines.push(`${prefix}${trId}\t根拠\t${evContent}\t${config.cDefaultEdge}\t${config.cEv}\t${config.cEv}`);
                        }
                    }
                }

                // 各タブ内の一覧リストを表示する際に、出現件数の多い順番（降順）でソートされたデータ配列を作る内部共通関数
                const createSortedObjList = (setObj, countSubMap, categoryKey) => {
                    return Array.from(setObj).map(item => {
                        let rawName = item;
                        if (categoryKey === "triple") rawName = tripleLabelMap[item] || item;
                        
                        // 各カテゴリの性質に合わせた適切な色ノードカラーを配賦
                        let baseColor = null;
                        switch (categoryKey) {
                            case "subject":     baseColor = config.cSubj; break;
                            case "object":      baseColor = config.cObj; break;
                            case "sClass":      baseColor = config.cSClass; break;
                            case "oClass":      baseColor = config.cOClass; break;
                            case "evidence":    baseColor = config.cEv; break;
                            case "stakeholder": baseColor = nameToColorCacheMap[item] || null; break; // 高速キャッシュマップから色を抽出
                            case "opinion":     baseColor = opinionToColorMap[item] || "#f0f0f0"; break; 
                        }

                        return {
                            name: rawName, // 画面リストに表示するアイテム名
                            count: countSubMap[item] || 0, // 出現回数
                            color: baseColor, // ノードの代表色
                            // 相互連動用：この単語が含まれている元データ行の絶対インデックス配列（背番号リスト）
                            bindingIndexes: bindingIndexesMap[categoryKey][rawName] || []
                        };
                    }).sort((a, b) => b.count - a.count); // sort関数を使って登場カウントが多い順に並び替え
                };

                // セクション5（画面描画処理）に引き渡すための、統計数値およびソート済みリストを格納したオブジェクトの構築
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

                // 📄 【重複排除・改良箇所】
                // 文字列ではなく、綺麗に切り分けられた「行データの配列（docOutputLines）」をそのまま引数としてセクション5へ渡す
                createDocumentSection(groupKey, docOutputLines, stats);
            }

            // すべての処理が正常終了したため、実行ボタンを再びクリックできるように戻す
            if (execBtn) execBtn.disabled = false;
        } catch (err) {
            // 例外エラーが発生した場合はローディングアニメーションを即座に破棄する
            removeSearchIng();
            console.error(err); // 開発者ツールのコンソールに詳細ログを出力
            alert("変換処理中にエラーが発生しました。"); // ユーザーへ通知
            if (execBtn) execBtn.disabled = false; // ボタンを救済（再活性化）
        }
    }, 50); // 50msのタイマーイベントをトリガーとして実行
}

// ------------------------------------------------------------------------
// 5. ドキュメントセクションの動的生成 ＆ テキストエリア相互連動（元の表示形式版）
// ------------------------------------------------------------------------
function createDocumentSection(docId, textContent, stats) {
    // 画面上の親コンテナ（出力エリア）のエレメントを取得
    const outputContainer = document.getElementById("outputContainer");
    if (!outputContainer) return;

    // 前の表示形式と全く同じデザインで外枠（セクション全体のコンテナ）となるDiv要素を生成
    const section = document.createElement("div");
    section.className = "document-section";
    section.style.border = "1px solid #ccc";
    section.style.margin = "20px 0";
    section.style.padding = "15px";
    section.style.borderRadius = "5px";

    // ドキュメントIDを識別するための見出しタイトルを生成
    const title = document.createElement("h3");
    title.innerText = (docId === "ALL_DOCUMENTS") ? "全ドキュメント一括変換結果" : `ドキュメント ID: ${docId}`;
    section.appendChild(title);

    // 画面を元の2カラムレイアウト（左にテキスト、右にリスト）にするためのフレックスボックスを設定
    const flexContainer = document.createElement("div");
    flexContainer.style.display = "flex";
    flexContainer.style.gap = "20px";
    section.appendChild(flexContainer);

    // 【左側カラム】元の表示形式のテキストエリアを構築
    const leftCol = document.createElement("div");
    leftCol.style.flex = "1";
    
    const textareaLabel = document.createElement("label");
    textareaLabel.innerText = "変換後の関係性データ (TSV形式):";
    textareaLabel.style.display = "block";
    textareaLabel.style.fontWeight = "bold";
    leftCol.appendChild(textareaLabel);

    const textarea = document.createElement("textarea");
    textarea.style.width = "100%";
    textarea.style.height = "450px";
    textarea.style.fontFamily = "monospace";
    textarea.style.whiteSpace = "pre";
    textarea.style.overflowX = "auto";
    
    // セクション4から渡されたテキストデータをそのままテキストエリアに復元（元の形式）
    textarea.value = textContent;
    leftCol.appendChild(textarea);
    flexContainer.appendChild(leftCol);

    // 【右側カラム】元の表示形式の統計情報＆切り替えタブ構造を構築
    const rightCol = document.createElement("div");
    rightCol.style.flex = "1";
    rightCol.style.maxHeight = "480px";
    rightCol.style.overflowY = "auto";
    rightCol.style.border = "1px solid #eee";
    rightCol.style.padding = "10px";
    rightCol.style.backgroundColor = "#fafafa";

    const rightTitle = document.createElement("h4");
    rightTitle.innerText = "データ要素の統計（クリックでテキストエリアを絞り込み）";
    rightTitle.style.marginTop = "0";
    rightCol.appendChild(rightTitle);

    // カテゴリをワンクリックで切り替えるためのボタン用HTMLコンテナ
    const tabBtnContainer = document.createElement("div");
    tabBtnContainer.style.display = "flex";
    tabBtnContainer.style.flexWrap = "wrap";
    tabBtnContainer.style.gap = "5px";
    tabBtnContainer.style.marginBottom = "10px";
    rightCol.appendChild(tabBtnContainer);

    // 選択されたリストの中身を展開するためのHTMLコンテナ
    const tabContentContainer = document.createElement("div");
    rightCol.appendChild(tabContentContainer);

    // 表示する各種カテゴリの定義と、statsに格納されている件数のマッピング
    const categories = [
        { key: "triple",      label: `トリプル (${stats.tripleCount})` },
        { key: "subject",     label: `主語 (${stats.subjectCount})` },
        { key: "object",      label: `目的語 (${stats.objectCount})` },
        { key: "sClass",      label: `主語クラス (${stats.sClassCount})` },
        { key: "oClass",      label: `目的語クラス (${stats.oClassCount})` },
        { key: "stakeholder", label: `発話者 (${stats.stakeholderCount})` },
        { key: "opinion",     label: `意見 (${stats.opinionCount})` },
        { key: "evidence",    label: `根拠 (${stats.evidenceCount})` }
    ];

    // 初回に選択されているタブの初期値を設定
    let activeTab = "triple"; 

    // タブおよび単語リストのHTML要素を元の形式に合わせて再描画する内部関数
    const renderTabs = () => {
        // 現在表示されている中身を一度空にする
        tabBtnContainer.innerHTML = "";
        tabContentContainer.innerHTML = "";

        // 定義されたカテゴリーをループしてボタンを生成
        categories.forEach(cat => {
            const btn = document.createElement("button");
            btn.innerText = cat.label;
            btn.style.padding = "5px 10px";
            btn.style.cursor = "pointer";
            btn.style.border = "1px solid #ccc";
            btn.style.borderRadius = "3px";
            
            // アクティブなタブには元の青色ハイライト、それ以外は標準の白背景スタイルを適用
            if (cat.key === activeTab) {
                btn.style.backgroundColor = "#007bff";
                btn.style.color = "#fff";
                btn.style.fontWeight = "bold";
            } else {
                btn.style.backgroundColor = "#fff";
                btn.style.color = "#333";
            }

            // タブクリック時にアクティブなカテゴリを切り替えてHTMLを再構築
            btn.onclick = () => {
                activeTab = cat.key;
                renderTabs();
            };
            tabBtnContainer.appendChild(btn);
        });

        // 選択されたカテゴリに対応するソート済みリストデータを取得
        const currentList = stats.lists[activeTab] || [];
        if (currentList.length === 0) {
            tabContentContainer.innerHTML = "<p style='color:#888; font-style:italic;'>データがありません</p>";
            return;
        }

        // リストを格納するUL（アンオーダーリスト）要素を生成
        const listUl = document.createElement("ul");
        listUl.style.listStyle = "none";
        listUl.style.padding = "0";
        listUl.style.margin = "0";

        // リスト内の各アイテム（単語行）をループで生成
        currentList.forEach(item => {
            const li = document.createElement("li");
            li.style.padding = "6px";
            li.style.borderBottom = "1px solid #eee";
            li.style.cursor = "pointer";
            li.style.display = "flex";
            li.style.justifyContent = "between";
            li.style.alignItems = "center";
            li.style.fontSize = "13px";

            // 元の表示形式のホバーエフェクト（背景色変化）を設定
            li.onmouseover = () => li.style.backgroundColor = "#e9ecef";
            li.onmouseout  = () => li.style.backgroundColor = "transparent";

            // 単語がクリックされた時にテキストエリアを絞り込む、元のインタラクティブ連動処理
            li.onclick = () => {
                const targetIndexes = item.bindingIndexes || [];
                if (targetIndexes.length === 0) return;

                // 絞り込みを行うために、元の全体テキストを改行で分割して1行ずつの配列を作る
                const lines = textContent.split("\n");
                const filteredLines = [];
                
                // 元のロジック通り、1行目のヘッダーは強制的に必ず残す
                if (lines.length > 0) {
                    filteredLines.push(lines[0]);
                }

                // 各データ行（インデックス1以降）をループでチェックして絞り込む
                for (let i = 1; i < lines.length; i++) {
                    const lineStr = lines[i];
                    if (!lineStr) continue;

                    const bindings = window.output_json_data?.results?.bindings;
                    const match = targetIndexes.some(idx => {
                        const b = bindings[idx];
                        if (!b) return false;
                        
                        const sLabelRaw = clean(getValueFromBinding(b, "sLabel"));
                        const oLabelRaw = clean(getValueFromBinding(b, "oLabel"));
                        const pLabelRaw = clean(getValueFromBinding(b, "pLabel"));
                        const shLabelRaw = clean(getValueFromBinding(b, "stakeholderLabel"));
                        const opContentRaw = clean(getValueFromBinding(b, "opinionContent"));
                        const evContentRaw = clean(getValueFromBinding(b, "evidence"));
                        const sClassLabelRaw = clean(getValueFromBinding(b, "sClassLabel"));
                        const oClassLabelRaw = clean(getValueFromBinding(b, "oClassLabel"));

                        // 元の判定形式に戻し、カテゴリの識別プレフィックスがTSV文字列中に存在するかチェック
                        if (activeTab === "subject")     return lineStr.includes("s_" + sLabelRaw);
                        if (activeTab === "object")      return lineStr.includes("o_" + oLabelRaw);
                        if (activeTab === "sClass")      return lineStr.includes("sc_" + sClassLabelRaw);
                        if (activeTab === "oClass")      return lineStr.includes("oc_" + oClassLabelRaw);
                        if (activeTab === "stakeholder") return lineStr.includes("st_" + shLabelRaw);
                        if (activeTab === "opinion")     return lineStr.includes(opContentRaw);
                        if (activeTab === "evidence")    return lineStr.includes("ev_" + evContentRaw);
                        if (activeTab === "triple") {
                            return lineStr.includes(pLabelRaw) && lineStr.includes("s_" + sLabelRaw) && lineStr.includes("o_" + oLabelRaw);
                        }
                        return false;
                    });

                    // 一致した関係性エッジ（行）だけを一時配列に格納
                    if (match) {
                        filteredLines.push(lineStr);
                    }
                }

                // 絞り込まれた行データを改行で繋ぎ直して元の表示形式としてテキストエリアへ反映
                textarea.value = filteredLines.join("\n");
                
                // クリック連動が機能したことを示す元のフラッシュ背景色を設定
                textarea.style.backgroundColor = "#fff3cd";
                setTimeout(() => { textarea.style.backgroundColor = "#fff"; }, 500);
            };

            // 単語の左隣に添える、元のカラー識別用角丸スクエアバッジ
            const colorBadge = document.createElement("span");
            colorBadge.style.display = "inline-block";
            colorBadge.style.width = "12px";
            colorBadge.style.height = "12px";
            colorBadge.style.marginRight = "8px";
            colorBadge.style.borderRadius = "2px";
            colorBadge.style.backgroundColor = item.color || "#ccc";

            // 単語のテキストとカウント数を表示する元の文字コンポーネント
            const textSpan = document.createElement("span");
            textSpan.innerText = `${item.name} (${item.count}件)`;
            textSpan.style.flex = "1";

            // 各パーツをドキュメントHTMLとしてアセンブル（結合）
            li.appendChild(colorBadge);
            li.appendChild(textSpan);
            listUl.appendChild(li);
        });

        tabContentContainer.appendChild(listUl);
    };

    // 初期化表示のために1回目の描画を自動実行
    renderTabs();
    
    // 生成した右カラムと左カラムを出力枠にはめ込み、最後に画面のメインコンテナに統合
    flexContainer.appendChild(rightCol);
    outputContainer.appendChild(section);
}
