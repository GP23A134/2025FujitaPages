/**
 * ========================================================================
 * CCO4KG 変換・特定ID指定抽出ツール メインロジック（ローカル連携・相互ロック版）
 * ========================================================================
 */

// ------------------------------------------------------------------------
// 1. 画面初期化 ＆ イベントリスナー登録
// ------------------------------------------------------------------------

// HTMLドキュメントのパースが完了し、DOMツリーが構築されたタイミングで初期化処理を実行します。
window.addEventListener('DOMContentLoaded', () => {
    // 必須データである window.output_json_data が正常に定義され、かつnullではないかを確認します。
    if (typeof window.output_json_data !== 'undefined' && window.output_json_data !== null) {
        console.log("[CCO4KG Loader] 相互ロック・カテゴリカラー対応版プロセスを読み込みました。");
        
        // セクション3で定義されているドキュメント識別子抽出用のドロップダウンメニューを生成します。
        initDocIdDropdown();
        // 出力形式設定パネルのアコーディオン開閉機構（初期状態管理）をセットアップします。
        setupAccordion("headerOutput", "contentOutput");
        // 配色設定パネルのアコーディオン開閉機構（初期状態管理）をセットアップします。
        setupAccordion("headerColor", "contentColor");
        
        // 状態変化（changeイベント）を監視する対象のチェックボックス要素のID配列を定義します。
        const targetIds = [
            "enableSubject", "enableObject", "enablePredicate", 
            "enableSClass", "enableOClass", "enableClassLink", 
            "enableStakeholder", "enableStClass", "enableEvidence"
        ];
        // ユーザーが設定を変更した際、即座にUIコントロールの活性・不活性を連動（同期）させるため、イベントリスナーを一括登録します。
        targetIds.forEach(id => document.getElementById(id).addEventListener("change", updateUIControls));
        
        // ステークホルダーのカラー配色モード（固定・ランダム・グループ別）を切り替えるラジオボタンの変更イベントを設定します。
        document.getElementsByName("shColorMode").forEach(radio => {
            radio.addEventListener("change", updateUIControls);
        });
        
        // 変換実行ボタンがクリックされた際、セクション4に定義されたメイン変換ロジックをキックするように紐付けます。
        document.getElementById("execBtn").addEventListener("click", splitAndProcessData);
        
        // 画面の初期レンダリング時におけるUIコンポーネントの活性・不活性状態を最新に適合させます。
        updateUIControls();
        // 初期化がすべて正常に完了したため、変換実行ボタンを使用可能（活性化）にします。
        document.getElementById("execBtn").disabled = false;
    } else {
        // 必須のデータファイルが読み込まれていない、もしくは定義エラーが起きた場合の致命的エラーハンドリングです。
        console.error("[CCO4KG Loader] エラー: データが見つかりません。");
        const statusEl = document.getElementById("statusMessage");
        if (statusEl) {
            // 画面上にエラー専用のスタイルを適用したメッセージパネルを明示的に配置・表示します。
            statusEl.className = "status-panel error";
            statusEl.style.display = "block";
            statusEl.textContent = "[エラー] output_CCO4KG.js からデータが見つかりません。";
        }
    }
});

/**
 * 設定パネルの見出しをクリックすることで、コンテンツエリアを表示・非表示にするアコーディオン制御関数です。
 * @param {string} headerId - クリックを検知するヘッダー要素のID
 * @param {string} contentId - 開閉制御の対象となるコンテンツ表示領域のID
 */
function setupAccordion(headerId, contentId) {
    const header = document.getElementById(headerId);
    const content = document.getElementById(contentId);
    const icon = header ? header.querySelector(".toggle-icon") : null;
    if (!header || !content) return; // 対象のDOM要素が見つからない場合は処理を中断します。

    header.addEventListener("click", () => {
        // 対象のコンテンツ要素がすでに「open」クラスを保持しているかを確認し、状態をトグル反転させます。
        const isOpen = content.classList.contains("open");
        if (isOpen) {
            content.classList.remove("open");
            if (icon) icon.textContent = "▼"; // 閉じている状態を示す下向き矢印に変更します。
        } else {
            content.classList.add("open");
            if (icon) icon.textContent = "▲"; // 開いている状態を示す上向き矢印に変更します。
        }
    });
}

// ------------------------------------------------------------------------
// 2. 設定パネルの有効・無効リアクティブ制御 (UI連動)
// ------------------------------------------------------------------------

/**
 * 画面上のチェックボックスやラジオボタンの選択状態を評価し、相互接続ロックの依存関係を満たさないUIコントロールを自動制御する関数です。
 */
function updateUIControls() {
    // 画面の各パラメータの有効・無効チェック状態（true/false）を変数に格納します。
    let sEnabled = document.getElementById("enableSubject").checked;
    let oEnabled = document.getElementById("enableObject").checked;
    let pEnabled = document.getElementById("enablePredicate").checked;
    let sClassEnabled = document.getElementById("enableSClass").checked;
    let oClassEnabled = document.getElementById("enableOClass").checked;
    let classLinkEnabled = document.getElementById("enableClassLink").checked;
    
    const shEnabled = document.getElementById("enableStakeholder").checked;
    const stClassEnabled = document.getElementById("enableStClass").checked;
    const evEnabled = document.getElementById("enableEvidence").checked;

    // ========================================================================
    // 【述語（関係線）の相互ロック連動判定】
    // グラフ理論に基づき、主語（始点）と目的語（終端）の双方が揃っていない場合は述語関係を定義できないため強制ロックします。
    // ========================================================================
    const cbPredicate = document.getElementById("enablePredicate");
    if (!sEnabled || !oEnabled) {
        cbPredicate.disabled = true; // コントロールを非活性化します。
        cbPredicate.checked = false; // 強制的にチェックを外します。
        pEnabled = false; // 後続の設定オブジェクトとの整合性を保つため値を上書きします。
    } else {
        cbPredicate.disabled = false; // 条件を満たしているため活性化します。
    }

    // ========================================================================
    // 【クラス間リンクの相互ロック連動判定】
    // 主語クラスと目的語クラスの双方が画面上に描画される設定になっていない場合は、その中間を結ぶ関係線エッジを出力できないためガードします。
    // ========================================================================
    const cbClassLink = document.getElementById("enableClassLink");
    if (!sClassEnabled || !oClassEnabled) {
        cbClassLink.disabled = true;
        cbClassLink.checked = false;
        classLinkEnabled = false;
    } else {
        cbClassLink.disabled = false;
    }

    // ========================================================================
    // 【主語・目的語の背番号（ナンバリング）の制限解除判定】
    // 主語および目的語がともに非表示である場合は、ノードインスタンス分離用の設定自体が無意味となるため非活性にします。
    // ========================================================================
    const cbSoNum = document.getElementById("enableSubjectObjectNumbering");
    if (!sEnabled && !oEnabled) {
        cbSoNum.disabled = true;
        cbSoNum.checked = false;
    } else {
        cbSoNum.disabled = false;
    }

    // ========================================================================
    // 【カラーパレットコントロールおよび親要素の視覚的不透明度（Opacity）を変更する補助関数】
    // @param {string} id - カラーピッカー要素のID
    // @param {boolean} enabled - 活性（1.0）か不活性（0.3）かの判定フラグ
    // ========================================================================
    const toggleElementPalette = (id, enabled) => {
        const el = document.getElementById(id);
        if (!el) return;
        el.disabled = !enabled; // 要素自体のクリック有効・無効を切り替えます。
        // 親要素（ラベリング領域など）の視覚的明度を落とすことで、操作不可であることをユーザーへ明示します。
        el.parentElement.style.opacity = enabled ? "1.0" : "0.3";
    };

    // 抽出フラグの状態を読み取り、対応するカテゴリのカラーピッカーコントロールの表示トーンを追従させます。
    toggleElementPalette("cpSubject", sEnabled);
    toggleElementPalette("cpObject", oEnabled);
    toggleElementPalette("cpPredicate", pEnabled);
    toggleElementPalette("cpSClass", sClassEnabled);
    toggleElementPalette("cpOClass", oClassEnabled);
    toggleElementPalette("cpSClassEdge", classLinkEnabled);

    // ========================================================================
    // 【発話者（ステークホルダー）関連の下位設定（ラジオ・コントロール）連動制御】
    // ステークホルダー本体の抽出チェックが外れている場合は、配下の枝番（連番）やクラス表示（stClass）を一括ロックします。
    // ========================================================================
    const cbShNum = document.getElementById("enableStakeholderNumbering");
    const cbStClass = document.getElementById("enableStClass");

    if (!shEnabled) {
        // ステークホルダーが無効な場合、連番振りと発話者クラスのチェックを外し、操作不可にします
        cbShNum.checked = false;
        cbShNum.disabled = true;
        
        cbStClass.checked = false;
        cbStClass.disabled = true;
    } else {
        // ステークホルダーが有効な場合は、どちらも操作可能にします
        cbShNum.disabled = false;
        cbStClass.disabled = false;
    }

    // カラー設定セクションなどの見た目の制御
    document.getElementById("secShColor").style.opacity = shEnabled ? "1.0" : "0.3";
    document.getElementsByName("shColorMode").forEach(r => r.disabled = !shEnabled);

    // 現在のアクティブなステークホルダーカラーモードの選択値（select / random / group）を取得します。
    const selectedMode = document.querySelector('input[name="shColorMode"]:checked')?.value || "random";
    const isFixed = (selectedMode === "select");
    const isRandom = (selectedMode === "random");

    // モードが「固定色指定」であり、かつステークホルダー自体が有効な場合にのみ固定カラーピッカーを活性化します。
    toggleElementPalette("cpStakeholder", shEnabled && isFixed);
    document.getElementById("shFixedColorRow").style.opacity = (shEnabled && isFixed) ? "1.0" : "0.3";

    // ========================================================================
    // 【発話者所属クラス（stClass）固定色ピッカーの活性・不活性マトリクス判定】
    // ステークホルダー本体と所属クラスの双方が有効で、かつカラーモードが「固定色」または「ランダム」のときのみ、
    // stClass用のピッカーを活性化します。
    // ========================================================================
    const stClassActive = shEnabled && cbStClass.checked && (isRandom || isFixed);
    toggleElementPalette("cpStClass", stClassActive);
    document.getElementById("stClassColorRow").style.opacity = stClassActive ? "1.0" : "0.3";

    // エビデンス（根拠）コントロールの表示可否に基づいて、カラーピッカーの活性および不透明度を調節します。
    toggleElementPalette("cpEvidence", evEnabled);
    document.getElementById("secEvColor").style.opacity = evEnabled ? "1.0" : "0.3";
}

// ------------------------------------------------------------------------
// 3. データ処理ユーティリティ
// ------------------------------------------------------------------------

// 発話者（ステークホルダー）やその分類クラスに順次割り当てるための16進数カラーパレット配列です。
// 視認性の高いパステル調のカラーコード（計20色）を固定値として定義しています。
const SPEAKER_PALETTE = [
    "#FFB3BA", "#FFDFBA", "#FFFFBA", "#BAFFC9", "#BAE1FF",
    "#E8B4B8", "#F2D1B3", "#EDE8B7", "#BCE6CD", "#B5D5E6",
    "#FAD2E1", "#E2ECE9", "#BEE3DB", "#89B0A5", "#E0BBE4",
    "#957DAD", "#D291BC", "#FEC8D8", "#FFDFD3", "#D8E2DC"
];

/**
 * 文字列内に含まれるUnicodeエスケープシーケンス（例: \u3042）を通常の文字に復元する関数です。
 * @param {string} str - 変換対象の文字列
 * @returns {string} デコード済みの文字列（空値の場合は空文字）
 */
function decodeFromUnicode(str) {
    if (!str) return "";
    // 正規表現を用いて \uXXXX 形式のパターンを検出し、16進数数値から対応する文字コードへ変換します。
    return str.replace(/\\u([0-9a-fA-F]{4})/g, (match, grp) => String.fromCharCode(parseInt(grp, 16)));
}

/**
 * SPARQL取得データのラベル情報等に含まれる不要な記号やメタ文字を排除し、文字列を正規化する関数です。
 * @param {string} input - クリーニング対象の文字列
 * @returns {string} 正規化が完了したプレーンな文字列
 */
function clean(input) {
    if (!input) return "";
    // 1. Unicodeエスケープのデコード
    // 2. 半角スペースの完全除去
    // 3. RDFリテラルに付与される言語タグ（@ja）の除去
    // 4. 文字列を囲む二重引用符（"）の除去
    // 5. 前後の余白（改行やタブ含む）のトリミング
    return decodeFromUnicode(input).replace(/ /g, "").replace(/@ja/g, "").replace(/"/g, "").trim();
}

/**
 * SPARQLクエリ結果の1行（バインディング）から、指定したキーのリテラル値またはURIを安全に抽出する関数です。
 * @param {Object} binding - バインディングオブジェクト
 * @param {string} key - 取得対象の変数名
 * @returns {string} 抽出した文字列値（値が存在しない場合は空文字）
 */
function getValueFromBinding(binding, key) {
    // オブジェクトの存在を確認し、さらにその下にvalueプロパティが存在する場合のみ値を取得します。
    return (binding && binding[key]) ? (binding[key].value || "") : "";
}

/**
 * RDFの完全なURI文字列から、末尾のローカル識別子（ID）のみを切り出す関数です。
 * @param {string} uriString - 変換対象のURI（例: http://example.org/data/doc00001）
 * @returns {string} 抽出されたID（例: doc01）
 */
function extractIdFromUri(uriString) {
    if (!uriString) return "";
    // 事前に文字列のクリーンアップを行った後、スラッシュ（/）で配列に分割します。
    const cleanUri = clean(uriString);
    const parts = cleanUri.split('/');
    // 分割された配列の最後の要素をIDとして返却します。要素がない場合は空文字を返します。
    return parts[parts.length - 1] || "";
}

/**
 * 16進数のカラーコードに対し、指定した係数（0〜1）を乗算することで、安全に明度を落とした（暗くした）カラーコードを算出する関数です。
 * @param {string} hexColor - 元となる7桁の16進数カラーコード（例: #FFB3BA）
 * @param {number} factor - 減算比率を表す係数（例: 0.85 で約15%明度低下）
 * @returns {string} 変換後の大文字16進数カラーコード
 */
function darkenColor(hexColor, factor) {
    // カラーコードが空、または「#」から始まらない、あるいは文字数が7桁でない不正な値の場合は、デフォルトエッジ色（#adadad）を返します。
    if (!hexColor || !hexColor.startsWith("#") || hexColor.length !== 7) return "#adadad";
    try {
        // substringでR、G、Bの各成分を2桁ずつ切り出し、16進数から10進数（0〜255）に変換した上で係数を掛け合わせます。
        // Math.max(0, ...) により、計算結果が負の値にならないよう安全にガードしています。
        let r = Math.max(0, Math.floor(parseInt(hexColor.substring(1, 3), 16) * factor));
        let g = Math.max(0, Math.floor(parseInt(hexColor.substring(3, 5), 16) * factor));
        let b = Math.max(0, Math.floor(parseInt(hexColor.substring(5, 7), 16) * factor));
        
        // 各RGB成分を16進数文字列に戻し、1桁になった場合は先頭を「0」で埋めて2桁の文字列（計6桁）にパディングした上で、すべて大文字として出力します。
        return `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`.toUpperCase();
    } catch (e) { 
        // 予期せぬパースエラーが発生した場合は、処理を中断させず元のカラーコードをそのまま返却します。
        return hexColor; 
    }
}

/**
 * 画面上のドキュメント選択ドロップダウンメニュー（SELECT要素）を初期化し、ソースデータ内に存在する全ドキュメントIDを一意に抽出してリストを生成する関数です。
 */
function initDocIdDropdown() {
    // 保持されているバインディングデータと、画面のターゲットとなるドロップダウン要素を取得します。
    const bindings = window.output_json_data.results.bindings;
    const selectEl = document.getElementById("targetDocId");
    if (!selectEl) return;
    
    // ドロップダウンを初期化し、先頭に「すべてのドキュメント（一括出力）」オプションを設定します。
    selectEl.innerHTML = '<option value="">すべてのドキュメント (一括出力)</option>';
    // 重複のないユニークなドキュメントID群を収集するため、Setオブジェクトを生成します。
    const idSet = new Set();
    
    // 全データ行を走査し、グラフ名（gまたは?g）のURIからドキュメントIDを抽出してSetに追加します。
    for (let i = 0; i < bindings.length; i++) {
        let rawDocUri = getValueFromBinding(bindings[i], "g") || getValueFromBinding(bindings[i], "?g");
        if (rawDocUri) idSet.add(extractIdFromUri(rawDocUri));
    }
    
    // 抽出したユニークID群をアルファベット・数字順にソートし、動的にOPTION要素を作成してセレクトボックスへ追加します。
    Array.from(idSet).sort().forEach(docId => {
        const option = document.createElement("option");
        option.value = docId;
        option.textContent = docId;
        selectEl.appendChild(option);
    });
}

/**
 * データ解析処理が実行中であることをユーザーに視覚的に伝えるため、処理中インジケーター（スピナー等）を画面上に挿入する関数です。
 * @param {HTMLElement} resultArea - インジケーターをレンダリングする描画対象コンテナ要素
 */
function showSearchIng(resultArea) {
    // 既存のHTMLコンテンツを保持したまま、解析中の文言とCSSアニメーション用のインジケーター要素（flower-spinner構造）を末尾に追加します。
    const orgDiv = resultArea.innerHTML;
    resultArea.innerHTML = orgDiv + '<div id="searching"><h2>解析中...</h2>'
       + '<div class="flower-spinner"><div class="dots-container">'
       + '<div class="bigger-dot"><div class="smaller-dot"></div>'
       + '</div></div></div><br></div>';
}

/**
 * データ解析処理および画面描画が完了した際に、画面上の処理中インジケーター（解析中表示）を検知してDOMから完全に消去する関数です。
 */
function removeSearchIng() {
    // 画面内に「searching」のIDを持つ要素が存在する場合にのみ、removeメソッドを実行してノードを削除します。
    const searchingDiv = document.getElementById("searching");
    if (searchingDiv != null) searchingDiv.remove();
}

// ------------------------------------------------------------------------
// 4. メイン変換処理 ＆ 相互接続連動フィルタ
// ------------------------------------------------------------------------
function splitAndProcessData() {
    // 画面上の実行ボタン（execBtn）および出力結果を挿入するコンテナ要素（outputContainer）を取得します。
    const execBtn = document.getElementById("execBtn");
    const outputContainer = document.getElementById("outputContainer");
    
    // 処理中の連続クリックによる二重実行およびブラウザフリーズを防ぐため、実行ボタンを非活性化（無効化）します。
    if (execBtn) execBtn.disabled = true;
    
    // 以前の出力結果が残っている場合は一度コンテナ内を完全にクリアします。
    outputContainer.innerHTML = ""; 
    // ユーザーに処理中であることを明示するため、ローディングインジケーター（解析中スピンアニメーション）を描画します。
    showSearchIng(outputContainer);

    // 画面へのインジケーター描画（DOM反映）を確実に実行させるため、50ミリ秒のわずかなディレイを挟んで非同期にメイン処理を開始します。
    setTimeout(() => {
        try {
            // グローバルスコープ（window）に保持されているSPARQLクエリの実行結果から、RDFバインディングデータの配列を取り出します。
            const bindings = window.output_json_data.results.bindings;
            
            // 画面のUIに配置されている各チェックボックスの現在のチェック状態（true/false）をリアルタイムに取得します。
            const shEnabledRaw = document.getElementById("enableStakeholder").checked;
            const sEnabled = document.getElementById("enableSubject").checked;
            const oEnabled = document.getElementById("enableObject").checked;
            const sClassEnabled = document.getElementById("enableSClass").checked;
            const oClassEnabled = document.getElementById("enableOClass").checked;

            // 各種制御用フラグ、判定しきい値、およびカラーピッカーから取得したユーザー指定カラーコードを一元管理する設定オブジェクトを構築します。
            const config = {
                sEnabled: sEnabled,
                oEnabled: oEnabled,
                
                // 主語と目的語がともに有効、かつ述語チェックボックスが有効な場合のみ述語ラインの出力を許可します。
                pEnabled: sEnabled && oEnabled && document.getElementById("enablePredicate").checked, 
                sClassEnabled: sClassEnabled,
                oClassEnabled: oClassEnabled,

                // 主語クラスと目的語クラスがともに有効、かつクラス間リンクが有効な場合のみリンク出力を許可します。
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
                cDefaultEdge: "#adadad" // デフォルトのエッジ（関係線）の色を16進数で固定定義します。
            };

            // ドキュメントID（グラフURIの末尾識別子）ごとにデータを分類・集約するためのグループ化用オブジェクトを用意します。
            let docGroups = {};
            for (let i = 0; i < bindings.length; i++) {
                let b = bindings[i];
                // グラフ変数（gまたは?g）からドキュメント固有のIDを抽出します。
                let docId = extractIdFromUri(getValueFromBinding(b, "g") || getValueFromBinding(b, "?g"));
                // 画面で特定のドキュメントIDが指定されている場合、合致しないドキュメントのデータはスキップ（フィルタリング）します。
                if (config.targetId !== "" && docId !== config.targetId) continue; 
                // ドキュメント一括出力の場合は固定のキー、個別出力の場合はドキュメントIDをグループキーとします。
                let groupKey = (config.targetId === "") ? "ALL_DOCUMENTS" : docId;
                if (!docGroups[groupKey]) docGroups[groupKey] = [];
                // 元の配列インデックス情報（lineIndex）を保持したまま、バインディングデータをグループに格納します。
                docGroups[groupKey].push({ binding: b, originalDocId: docId, lineIndex: i });
            }

            // 条件に合致するデータが1件も存在しなかった場合は、ローディングを解除して警告を表示し、ボタンを再活性化して処理を抜けます。
            if (Object.keys(docGroups).length === 0) {
                removeSearchIng();
                alert("該当するデータが見つかりませんでした。");
                if (execBtn) execBtn.disabled = false;
                return;
            }

            // 解析処理の本番ループに入るため、処理中インジケーター（解析中表示）をDOMから削除します。
            removeSearchIng(); 

            // 分割・グループ化されたドキュメントの塊（コンテキスト）ごとに独立した集計・マッピング処理を開始します。
            for (let groupKey in docGroups) {
                let wrappedBindings = docGroups[groupKey];
                
                // ステークホルダーの重複出現回数をインクリメント管理するための連想配列です（ナンバリング用）。
                const wordAppearanceMap = {}; 
                // 各ステークホルダーIDに最終決定された16進数カラーコードを紐付けるマップです。
                const finalSpeakerColorMap = {}; 
                // 各ステークホルダー所属クラスIDに最終決定された16進数カラーコードを紐付けるマップです。
                const finalStClassColorMap = {}; 
                // 各意見の文言（テキスト自体）に割り当てられたトーンダウン後の16進数カラーコードを紐付けるマップです。
                const opinionColorMap = {};

                // カウントおよび統計表示用：それぞれの要素のユニークな値を厳密に管理するためのSetオブジェクトです。
                const uniqueSubjects = new Set();
                const uniquePs = new Set(); 
                const uniqueObjects = new Set();
                const uniqueSClasses = new Set();
                const uniqueOClasses = new Set();
                const uniqueStakeholders = new Set();
                const uniqueOpinions = new Set();
                const uniqueEvidences = new Set();
                const uniqueTriples = new Set();
                const uniqueStClasses = new Set(); 
                const tripleLabelMap = {}; // トリプル（主語・述語・目的語の組）の表示名（T0, T1...）を管理するマップです。

                // 統計情報の各要素をクリックした際、ソースデータの何行目に該当するか特定するマップ
                const bindingIndexesMap = {
                    triple: {}, subject: {}, p: {}, object: {}, sClass: {}, oClass: {}, stakeholder: {}, opinion: {}, evidence: {}, stClass: {}
                };

                // 出現頻度（回数）をカウントし、集計画面で降順ソートを行うための件数管理マップです。
                const jsonCountMap = {
                    stakeholder: {}, subject: {}, p: {}, object: {}, sClass: {}, oClass: {}, evidence: {}, opinion: {}, triple: {}, stClass: {}
                };

                // ------------------------------------------------------------------------
                // 【パレット・インデックスカラー決定ロジック】
                // ------------------------------------------------------------------------
                let paletteIndex = 0; // 提供されたカラーパレット（SPEAKER_PALETTE）を参照するためのインデックスカウンタです。
                
                // 呼び出されるたびにパレットから順に色コードを返し、末尾に達した場合は剰余演算によって先頭に戻る安全な循環関数です。
                const getNextPaletteColor = () => {
                    const color = SPEAKER_PALETTE[paletteIndex % SPEAKER_PALETTE.length];
                    paletteIndex++;
                    return color;
                };

                // 対象のステークホルダーおよびその所属クラスの属性値、画面の設定状況を元にカラーリングのルールを確定させる内部関数です。
                function resolveColors(shId, stClassId, hasStClassLabel) {
                    if (config.shColorMode === "select") {
                        finalSpeakerColorMap[shId] = config.cFixedSH; 
                        if (stClassId !== "") finalStClassColorMap[stClassId] = config.cStClass; 
                        return;
                    }
                    if (config.shColorMode === "group") {
                        if (stClassId !== "" && hasStClassLabel && config.stClass) {
                            if (!finalStClassColorMap[stClassId]) {
                                finalStClassColorMap[stClassId] = getNextPaletteColor(); 
                            }
                            let groupClassColor = finalStClassColorMap[stClassId];
                            finalSpeakerColorMap[shId] = darkenColor(groupClassColor, 0.85); 
                        } else {
                            if (!finalSpeakerColorMap[shId]) {
                                finalSpeakerColorMap[shId] = getNextPaletteColor(); 
                            }
                        }
                        return;
                    }
                    if (config.shColorMode === "random") {
                        finalSpeakerColorMap[shId] = getNextPaletteColor(); 
                        if (stClassId !== "") finalStClassColorMap[stClassId] = config.cStClass; 
                    }
                }

                const classLinkSet = new Set(); 
                const metadataLinkSet = new Set(); 
                const comboToTrMap = {}; // 主語・述語・目的語の組み合わせ文字列をトリプルID（T0, T1...）に変換するマップです。
                let trCounter = 0; 
                const structuredLines = []; // TSV形式のテキスト行およびメタデータを格納する構造化バッファ配列です。
                
                const stakeholderLabelMap = {}; 
                const stClassLabelMap = {};

                // プレ走査ループ：事前のカラーマッピングテーブルの確定を先行して完了させます。
                for (let item of wrappedBindings) {
                    let b = item.binding;
                    let shId = extractIdFromUri(getValueFromBinding(b, "stakeholder"));
                    let stClassId = extractIdFromUri(getValueFromBinding(b, "stClass") || getValueFromBinding(b, "?stClass"));
                    let cleanShName = clean(getValueFromBinding(b, "stakeholderLabel"));
                    let stClassLabelRaw = clean(getValueFromBinding(b, "stClassLabel"));
                    
                    let shLabel = "st_" + cleanShName;
                    let stClassLabel = "stc_" + stClassLabelRaw;
                    if (shId !== "") {
                        stakeholderLabelMap[shId] = shLabel;
                        if (stClassId !== "" && stClassLabelRaw) stClassLabelMap[stClassId] = stClassLabel;
                        
                        if (!finalSpeakerColorMap[shId]) {
                            resolveColors(shId, stClassId, !!stClassLabelRaw);
                        }
                    }
                }
                
                const legendDisplayColorMap = {}; 
                const shExactCountMap = {}; 

                // 対象のカテゴリとキーに対して、現在のバインディングインデックスを安全に配列へプッシュする補助関数です。
                const pushIndex = (category, key, idx) => {
                    if (!key) return;
                    if (!bindingIndexesMap[category][key]) bindingIndexesMap[category][key] = [];
                    if (!bindingIndexesMap[category][key].includes(idx)) {
                        bindingIndexesMap[category][key].push(idx);
                    }
                };

                // メイン走査ループ
                for (let item of wrappedBindings) {
                    let b = item.binding;
                    let currentDocId = item.originalDocId; 
                    let curIdx = item.lineIndex;

                    let sUri = getValueFromBinding(b, "s");
                    let sClassUri = getValueFromBinding(b, "sClass");
                    let oUri = getValueFromBinding(b, "o");
                    let oClassUri = getValueFromBinding(b, "oClass");
                    let shUri = getValueFromBinding(b, "stakeholder");
                    let opUri = getValueFromBinding(b, "opinion");

                    let sId = extractIdFromUri(sUri);
                    let sClassId = extractIdFromUri(sClassUri);
                    let pId = extractIdFromUri(getValueFromBinding(b, "p"));
                    let oId = extractIdFromUri(oUri);
                    let oClassId = extractIdFromUri(oClassUri);
                    let shId = extractIdFromUri(shUri);
                    let stClassId = extractIdFromUri(getValueFromBinding(b, "stClass") || getValueFromBinding(b, "?stClass"));
                    let opId = extractIdFromUri(opUri);

                    let sLabelRaw = clean(getValueFromBinding(b, "sLabel"));
                    let oLabelRaw = clean(getValueFromBinding(b, "oLabel"));
                    let shLabelRaw = clean(getValueFromBinding(b, "stakeholderLabel"));
                    let opContentRaw = clean(getValueFromBinding(b, "opinionContent"));
                    let evContentRaw = clean(getValueFromBinding(b, "evidence"));
                    let sClassLabelRaw = clean(getValueFromBinding(b, "sClassLabel"));
                    let oClassLabelRaw = clean(getValueFromBinding(b, "oClassLabel"));
                    let stClassLabelRaw = clean(getValueFromBinding(b, "stClassLabel"));

                    let sLabel = "s_" + sLabelRaw;
                    let sClassLabel = "sc_" + sClassLabelRaw;
                    let pLabel = clean(getValueFromBinding(b, "pLabel")); 
                    let oLabel = "o_" + oLabelRaw;
                    let ocLabel = "oc_" + oClassLabelRaw;
                    let shLabel_cleansed = "st_" + shLabelRaw;
                    let stClassLabel = "stc_" + stClassLabelRaw;
                    
                    // ★【修正点①】意見（Opinion）の文言に op_ プレフィックスを定義
                    let opContent = "op_" + opContentRaw;
                    let evContent = "ev_" + evContentRaw;

                    if (sId === "" || oId === "") continue;

                    let comboKeyForId = `${currentDocId}_${sId}|${pId}|${oId}`;
                    if (!comboToTrMap[comboKeyForId]) {
                        comboToTrMap[comboKeyForId] = "T" + trCounter;
                        trCounter++;
                    }
                    
                    let trId = comboToTrMap[comboKeyForId];

                    let tripleMapKey = `${sLabelRaw} | ${pLabel} | ${oLabelRaw}`;
                    let tripleDisplayLabel = trId; 

                    uniqueTriples.add(tripleMapKey);
                    tripleLabelMap[tripleMapKey] = tripleDisplayLabel;
                    jsonCountMap.triple[tripleMapKey] = (jsonCountMap.triple[tripleMapKey] || 0) + 1;
                    pushIndex("triple", tripleDisplayLabel, curIdx);

                    if (sId !== "") {
                        uniqueSubjects.add(sLabel);
                        jsonCountMap.subject[sLabel] = (jsonCountMap.subject[sLabel] || 0) + 1;
                        pushIndex("subject", sLabel, curIdx);
                    }
                    if (pId !== "" && pLabel) {
                        uniquePs.add(pLabel);
                        jsonCountMap.p[pLabel] = (jsonCountMap.p[pLabel] || 0) + 1;
                        pushIndex("p", pLabel, curIdx);
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

                    let displaySLabel = config.soNum ? `${sLabel}_${trId}` : sLabel;
                    let displayOLabel = config.soNum ? `${oLabel}_${trId}` : oLabel;
                    
                    let shNodeName = "";
                    let speakerColor = config.cFixedSH;

                    if (shId !== "" && shLabelRaw) {
                        shNodeName = shLabel_cleansed;
                        let stCount = (wordAppearanceMap[shId] || 0) + 1;
                        wordAppearanceMap[shId] = stCount;
                        shNodeName = config.shNum ? `${shNodeName}_${stCount}` : shNodeName;
                        speakerColor = finalSpeakerColorMap[shId] || config.cFixedSH;
                        
                        if (opContentRaw) {
                            // ★【修正点②】一貫性を持たせるため、統計管理（Set/Map）のキーもop_付きに統一
                            uniqueOpinions.add(opContent);
                            jsonCountMap.opinion[opContent] = (jsonCountMap.opinion[opContent] || 0) + 1;
                            pushIndex("opinion", opContent, curIdx);
                            opinionColorMap[opContent] = darkenColor(speakerColor, 0.85);
                        }

                        if (config.stClass && stClassId !== "" && stClassLabelRaw) {
                            uniqueStClasses.add(stClassLabel);
                            jsonCountMap.stClass[stClassLabel] = (jsonCountMap.stClass[stClassLabel] || 0) + 1;
                            pushIndex("stClass", stClassLabel, curIdx);
                        }

                        shExactCountMap[shLabel_cleansed] = (shExactCountMap[shLabel_cleansed] || 0) + 1;
                        jsonCountMap.stakeholder[shNodeName] = (jsonCountMap.stakeholder[shNodeName] || 0) + 1;
                        pushIndex("stakeholder", shLabel_cleansed, curIdx);

                        if (config.shColorMode === "group" && config.stClass && stClassId !== "" && stClassLabelRaw) {
                            const className = stClassLabelMap[stClassId] || "不明な分類";
                            legendDisplayColorMap[`stClass_${stClassId}`] = { name: `【分類】${className}`, color: finalStClassColorMap[stClassId], uri: sClassUri };
                        }
                        legendDisplayColorMap[`sh_${shId}`] = { name: `${shLabel_cleansed}`, color: speakerColor, uri: shUri };
                    }

                    let prefix = (config.targetId === "") ? `${currentDocId}\t` : "";
                    let localLinesBuffer = []; 

                    if (config.pEnabled) {
                        localLinesBuffer.push(`${prefix}${displaySLabel}\t${pLabel}\t${displayOLabel}\t${config.cSubj}\t${config.cObj}\t${config.cPred}\t${curIdx}`);
                    }
                    if (config.sEnabled) {
                        localLinesBuffer.push(`${prefix}${trId}\t主語\t${displaySLabel}\t${config.cDefaultEdge}\t${config.cSubj}\t${config.cSubj}\t${curIdx}`);
                    } else if (config.sClassEnabled && sClassId !== "" && sClassLabelRaw) {
                        let directSClassKey = `${currentDocId}_${trId}_direct_sClass_${sClassId}`;
                        localLinesBuffer.push(`${prefix}${trId}\tsClass\t${sClassLabel}\t${config.cDefaultEdge}\t${config.cSClass}\t${config.cSClass}\t${curIdx}`);
                    }
                    if (config.oEnabled) {
                        localLinesBuffer.push(`${prefix}${trId}\t目的語\t${displayOLabel}\t${config.cDefaultEdge}\t${config.cObj}\t${config.cObj}\t${curIdx}`);
                    } else if (config.oClassEnabled && oClassId !== "" && oClassLabelRaw) {
                        let directOClassKey = `${currentDocId}_${trId}_direct_oClass_${oClassId}`;
                        localLinesBuffer.push(`${prefix}${trId}\toClass\t${ocLabel}\t${config.cDefaultEdge}\t${config.cOClass}\t${config.cOClass}\t${curIdx}`);
                    }

                    if (config.sEnabled && config.sClassEnabled && sClassId !== "" && sClassLabelRaw) {
                        localLinesBuffer.push(`${prefix}${displaySLabel}\tsClass\t${sClassLabel}\t${config.cDefaultEdge}\t${config.cSClass}\t${config.cSClass}\t${curIdx}`);
                    }
                    if (config.oEnabled && config.oClassEnabled && oClassId !== "" && oClassLabelRaw) {
                        localLinesBuffer.push(`${prefix}${displayOLabel}\toClass\t${ocLabel}\t${config.cDefaultEdge}\t${config.cOClass}\t${config.cOClass}\t${curIdx}`);
                    }
                    if (config.classLinkEnabled && sClassId !== "" && sClassLabelRaw && oClassId !== "" && oClassLabelRaw) {
                        localLinesBuffer.push(`${prefix}${sClassLabel}\t-\t${ocLabel}\t${config.cSClassEdge}\t${config.cSClass}\t${config.cOClass}\t${curIdx}`);
                    }

                    if (shId !== "" && shLabelRaw) {
                        if (opContentRaw) {
                            let opinionColor = opinionColorMap[opContent] || "#f0f0f0";
                            // ★【修正点③】テキストバッファ（TSV出力行）に格納する箇所も opContent（op_付き）を適用
                            localLinesBuffer.push(`${prefix}${trId}\t意見\t${opContent}\t${config.cDefaultEdge}\t${opinionColor}\t${opinionColor}\t${curIdx}`);
                            localLinesBuffer.push(`${prefix}${opContent}\t発話者\t${shNodeName}\t${config.cDefaultEdge}\t${speakerColor}\t${speakerColor}\t${curIdx}`);
                        } else {
                            localLinesBuffer.push(`${prefix}${trId}\t発話者\t${shNodeName}\t${config.cDefaultEdge}\t${speakerColor}\t${speakerColor}\t${curIdx}`);
                        }
                        if (config.stClass && stClassId !== "" && stClassLabelRaw) {
                            let classColor = finalStClassColorMap[stClassId] || config.cStClass;
                            localLinesBuffer.push(`${prefix}${shNodeName}\tstClass\t${stClassLabel}\t${config.cDefaultEdge}\t${classColor}\t${classColor}\t${curIdx}`);
                        }
                    }

                    if (config.evEnabled && evContentRaw !== "") {
                        localLinesBuffer.push(`${prefix}${trId}\t根拠\t${evContent}\t${config.cDefaultEdge}\t${config.cEv}\t${config.cEv}\t${curIdx}`);
                    }

                    if (localLinesBuffer.length > 0) {
                        structuredLines.push({
                            index: curIdx, 
                            text: localLinesBuffer.join("\n"), 
                            tripleData: { 
                                subject: sLabelRaw, predicate: pLabel, object: oLabelRaw,
                                sClass: sClassLabelRaw, oClass: oClassLabelRaw,
                                stakeholder: shLabelRaw, opinion: opContentRaw, evidence: evContentRaw
                            }
                        });
                    }
                }

                const createSortedObjList = (setObj, countSubMap, categoryKey) => {
                    return Array.from(setObj).map(item => {
                        let rawName = item;
                        if (categoryKey === "triple") rawName = tripleLabelMap[item] || item;
                        
                        let baseColor = null;
                        if (categoryKey === "subject") baseColor = config.cSubj;
                        if (categoryKey === "p") baseColor = config.cPred; 
                        if (categoryKey === "object") baseColor = config.cObj;
                        if (categoryKey === "sClass") baseColor = config.cSClass;
                        if (categoryKey === "oClass") baseColor = config.cOClass;
                        if (categoryKey === "evidence") baseColor = config.cEv;
                        if (categoryKey === "opinion") baseColor = opinionColorMap[item] || "#f0f0f0";

                        if (categoryKey === "stClass") {
                            let origId = Object.keys(stClassLabelMap).find(k => stClassLabelMap[k] === item) || "";
                            baseColor = finalStClassColorMap[origId] || config.cStClass;
                        }

                        if (categoryKey === "stakeholder") {
                            const found = Object.values(legendDisplayColorMap).find(m => m.name === item);
                            if (found) baseColor = found.color;
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
                        triple: "#adadad", 
                        subject: config.cSubj, 
                        object: config.cObj,
                        p: config.cPred, 
                        sClass: config.cSClass, 
                        oClass: config.cOClass,
                        stakeholder: config.cFixedSH, 
                        opinion: config.cFixedSH, 
                        evidence: config.cEv,
                        stClass: config.cStClass 
                    },
                    tripleCount: uniqueTriples.size,
                    subjectCount: uniqueSubjects.size,
                    pCount: uniquePs.size, 
                    objectCount: uniqueObjects.size,
                    sClassCount: uniqueSClasses.size,
                    oClassCount: uniqueOClasses.size,
                    stakeholderCount: Object.keys(shExactCountMap).length,
                    opinionCount: uniqueOpinions.size,
                    evidenceCount: uniqueEvidences.size,
                    stClassCount: uniqueStClasses.size, 
                    lists: {
                        triple: createSortedObjList(uniqueTriples, jsonCountMap.triple, "triple"),
                        subject: createSortedObjList(uniqueSubjects, jsonCountMap.subject, "subject"),
                        p: createSortedObjList(uniquePs, jsonCountMap.p, "p"),
                        object: createSortedObjList(uniqueObjects, jsonCountMap.object, "object"),
                        sClass: createSortedObjList(uniqueSClasses, jsonCountMap.sClass, "sClass"),
                        oClass: createSortedObjList(uniqueOClasses, jsonCountMap.oClass, "oClass"),
                        stakeholder: createSortedObjList(Object.keys(shExactCountMap), shExactCountMap, "stakeholder"),
                        opinion: createSortedObjList(uniqueOpinions, jsonCountMap.opinion, "opinion"),
                        evidence: createSortedObjList(uniqueEvidences, jsonCountMap.evidence, "evidence"),
                        stClass: createSortedObjList(uniqueStClasses, jsonCountMap.stClass, "stClass") 
                    }
                };

                createDocumentSection(groupKey, structuredLines, stats);
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
// 5. レンダラー＆相互連動型リストフィルタ（広々サイズ × 初期表示グラフ版）
// ------------------------------------------------------------------------
function createDocumentSection(docId, structuredLines, stats) {
    // 表示できない項目（カウントが0のものなど）をリストから完全に非表示にするかどうかのフラグ
    const HIDE_UNAVAILABLE = false; 

    // 出力先となるメインコンテナを取得
    const container = document.getElementById("outputContainer");
    if (!container) return;
    
    // ------------------------------------------------------------------------
    // 1. 設定・内部状態の定義 (State Manager)
    // ------------------------------------------------------------------------
    const isAllDoc = (docId === "ALL_DOCUMENTS");
    const linesArray = Array.isArray(structuredLines) ? structuredLines : [];

    // 各項目の表示・非表示設定をチェックボックスから取得
    const getChecked = (id) => {
        const el = document.getElementById(id);
        return el ? el.checked : true;
    };
    
    const config = {
        isSubjectEnabled: getChecked("enableSubject"),
        isPredicateEnabled: getChecked("enablePredicate"),
        isObjectEnabled: getChecked("enableObject"),
        isSClassEnabled: getChecked("enableSClass"),
        oClassEnabled: getChecked("enableOClass"),
        isStakeholderEnabled: getChecked("enableStakeholder"),
        isStClassEnabled: getChecked("enableStClass"),
        isOpinionEnabled: getChecked("enableOpinion"),
        isEvidenceEnabled: getChecked("enableEvidence")
    };

    let activeFiltersMap = {};  // 現在アクティブになっているフィルタ状態を管理
    let currentActiveTab = "";  // 現在アクティブなカテゴリタブ
    let network = null;         // グラフのインスタンス保持用

    // DOM要素参照キャッシュ用
    let section, textarea, legendTable, titleEl, noticeEl, statsTable, physicsBtn;
    let tabs = [], panes = [];
    const targetStatElements = {};

    // グラフ描画クラスのインスタンス化
    const viewMap = new ViewMap(function(updatedText) {});

    // ------------------------------------------------------------------------
    // 2. データ整形・クレンジング (Data Engine)
    // ------------------------------------------------------------------------
    const getCleanFullText = () => {
        const cleanLines = [];
        linesArray.forEach(lineObj => {
            const lines = lineObj.text.split("\n");
            lines.forEach(edgeStr => {
                if (!edgeStr) return;
                const columns = edgeStr.split("\t");
                
                // 末尾のインデックスカラムを除外
                columns.pop();
                
                // 一括出力の場合は先頭のドキュメントIDカラムも除外
                if (isAllDoc && columns.length > 0) {
                    columns.shift();
                }
                
                cleanLines.push(columns.join("\t"));
            });
        });
        // 重複行を排除して改行コードで結合
        return Array.from(new Set(cleanLines)).join("\n");
    };

    // ------------------------------------------------------------------------
    // 3. UIテンプレート生成 (UI Renderer)
    // ------------------------------------------------------------------------
    const renderUI = () => {
        section = document.createElement("div");
        section.className = "doc-section";
        
        section.innerHTML = `
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
                        <tr data-row="triple"><td><button class="stats-toggle-btn" data-target="triple" data-label="トリプル"><span class="cat-color-badge" style="background-color:${stats.configColors.triple};"></span>トリプル数</button></td><td class="stat-count-value" data-stat="triple">${stats.tripleCount}</td></tr>
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
                        <button type="button" id="btn-clear-from-list-${docId}" class="btn-clear-from-list" style="padding: 4px 8px; background-color: #f8f9fa; color: #6c757d; border: 1px solid #ced4da; border-radius: 4px; cursor: pointer; font-size: 0.85em; transition: all 0.2s; margin: 0;" onmouseover="this.style.backgroundColor='#e2e6ea'; this.style.color='#343a40';" onmouseout="this.style.backgroundColor='#f8f9fa'; this.style.color='#6c757d';">
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
                    <button class="doc-panel-tab active" data-tab="diagram">図・グラフ表示</button>
                    <button class="doc-panel-tab" data-tab="table">テーブル表示</button> 
                    <button class="doc-panel-tab" data-tab="text">テキスト表示</button>
                </div>
                
                <div class="doc-tabs-content" style="flex-grow: 1; height: 0; position: relative; background-color: #ffffff; display: flex; flex-direction: column;">
                    
                    <div class="tab-pane pane-text" data-content="text" style="display: none !important; flex-direction: column !important; justify-content: flex-start !important; align-items: stretch !important; height: 100% !important; box-sizing: border-box !important;">
                        <div class="pane-action-row" style="display: flex !important; justify-content: flex-end !important; width: 100% !important; margin-bottom: 12px !important; flex-shrink: 0 !important; box-sizing: border-box !important;">
                            <button class="btn-small btn-copy-small" style="cursor: pointer;">このデータをコピー</button>
                        </div>
                        <textarea id="main-textarea-${docId}" class="textarea" style="display: block !important; width: 100% !important; flex: 1 1 0% !important; min-height: 0 !important; box-sizing: border-box !important; resize: none; margin: 0;" readonly></textarea>
                    </div>

                    <div class="tab-pane pane-diagram active" data-content="diagram" style="width: 100%; height: 100%; display: flex; flex-direction: column;">
                        <div class="diagram-container" style="display: flex; flex-direction: column; height: 100%; width: 100%;">
                            <div class="control-actions-bar" style="display: flex; justify-content: flex-start; width: 100%; margin-bottom: 12px; flex-shrink: 0;">
                                <button id="physicsBtn-${docId}" data-on="true" class="btn-small btn-physics" style="margin: 0; background-color: #2196F3; color: white;">自動レイアウト：ON</button>
                            </div>
                            <div class="map_box" style="position: relative; width: 100%; flex-grow: 1; height: 0; margin: 0;">
                                <div id="mynetwork-${docId}" class="network-canvas" style="position: absolute; top: 0; left: 0; width: 100%; height: 100%; contain: strict; will-change: transform;"></div>
                                <input id="editBox-${docId}" type="text" class="network-edit-box" style="position: absolute; text-align: center; display: none; z-index: 1000; outline: none; padding: 2px;" />
                                <input id="colorPicker-${docId}" type="color" class="network-color-picker" style="position: absolute; display: none; z-index: 101;" />
                                <div id="colorPreset-${docId}" class="network-color-preset" style="position: absolute; display: none; z-index: 1002; background: #ffffff; border: 1px solid #cccccc; padding: 4px;"></div>
                            </div>
                        </div>
                    </div>

                    <div class="tab-pane pane-table" data-content="table" style="display: none; width: 100%; height: 100%; padding: 0px; box-sizing: border-box; overflow: hidden;">
                        <div class="table-scroll-wrapper" style="height: 100%; overflow-y: auto; overflow-x: hidden; border: 1px solid #e0e0e0; border-radius: 4px; width: 100%;">
                            <table id="data-content-table-${docId}" class="data-content-table" style="width: 100%; border-collapse: collapse; font-size: 0.9em; text-align: left; table-layout: fixed; margin: 0 auto;">
                                <thead style="background-color: #f5f5f5; position: sticky; top: 0; z-index: 10; box-shadow: 0 1px 0 #e0e0e0;">
                                    <tr>
                                        <th style="padding: 10px; border-bottom: 2px solid #e0e0e0; width: 7%; text-align: center;">ID</th>
                                        <th style="padding: 10px; border-bottom: 2px solid #e0e0e0; width: 35%;">主語</th>
                                        <th style="padding: 10px; border-bottom: 2px solid #e0e0e0; width: 12%; text-align: center;">述語</th>
                                        <th style="padding: 10px; border-bottom: 2px solid #e0e0e0; width: 35%;">目的語</th>
                                        <th style="padding: 10px; border-bottom: 2px solid #e0e0e0; width: 11%; text-align: center;">ステークホルダー数</th>
                                    </tr>
                                </thead>
                                <tbody id="data-content-tbody-${docId}"></tbody>
                            </table>
                        </div>
                    </div>
                    
                </div>
            </div>
        </div>`;

        // 親コンテナへ追加
        container.appendChild(section);

        // キャッシュ用のDOM参照を取得
        textarea = section.querySelector(`#main-textarea-${docId}`);
        legendTable = document.getElementById(`dynamic-legend-table-${docId}`);
        titleEl = document.getElementById(`legend-current-title-${docId}`);
        noticeEl = document.getElementById(`legend-notice-${docId}`);
        statsTable = section.querySelector(".stats-table");
        physicsBtn = section.querySelector(`#physicsBtn-${docId}`);
        tabs = section.querySelectorAll(".doc-panel-tab");
        panes = section.querySelectorAll(".tab-pane");

        // 統計数値セルのキャッシュ
        if (statsTable) {
            statsTable.querySelectorAll(".stat-count-value").forEach(td => {
                const statKey = td.getAttribute("data-stat");
                if (statKey) targetStatElements[statKey] = td;
            });
        }

        // 初期テキストをセット
        textarea.value = getCleanFullText();
    };

    // ------------------------------------------------------------------------
    // 4. フィルタ＆表示更新ロジック (Filter & Sync Logic)
    // ------------------------------------------------------------------------
    
    // サイドバー下部の凡例一覧テーブルを再描画する関数
    const updateLegendTable = (targetKey) => {
        currentActiveTab = targetKey;
        const currentList = stats.lists[targetKey] || [];
        const activeLabels = Object.keys(activeFiltersMap);

        let globalIntersectionSet = null;
        if (activeLabels.length > 0) {
            activeLabels.forEach(label => {
                const indexes = activeFiltersMap[label].bindingIndexes || [];
                if (globalIntersectionSet === null) {
                    globalIntersectionSet = new Set(indexes);
                } else {
                    const nextInt = new Set();
                    indexes.forEach(idx => {
                        if (globalIntersectionSet.has(idx)) nextInt.add(idx);
                    });
                    globalIntersectionSet = nextInt;
                }
            });
        }

        const processedList = currentList.map(item => {
            let displayCount = item.count;
            if (activeLabels.length > 0) {
                if (globalIntersectionSet && globalIntersectionSet.size > 0) {
                    let matchCount = 0;
                    item.bindingIndexes.forEach(idx => {
                        if (globalIntersectionSet.has(idx)) matchCount++;
                    });
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
                isSelected: !!activeFiltersMap[item.name]
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
            const countStyle = useRedColor 
                ? 'color: #d32f2f; margin-left: 4px; font-weight: bold;' 
                : 'color: #666666; margin-left: 4px;';
            const activeClass = item.isSelected ? 'filter-active' : '';

            return `
                <tr class="filter-trigger-row ${activeClass}" data-index="${index}" data-value="${item.name}" style="cursor:pointer; transition: background 0.2s; ${item.isSelected ? 'background-color: #cce5ff; border-left: 4px solid #004085;' : ''}">
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

        const rows = legendTable.querySelectorAll(".filter-trigger-row");
        rows.forEach(row => {
            const idx = parseInt(row.getAttribute("data-index"), 10);
            const item = processedList[idx];
            if (!item) return;

            const isAvailable = (item.displayCount > 0);
            const shouldShow = item.isSelected || isAvailable; 

            if (shouldShow) {
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
                if (activeFiltersMap[clickedValue]) {
                    delete activeFiltersMap[clickedValue]; 
                } else {
                    const originalItem = currentList.find(c => c.name === clickedValue);
                    activeFiltersMap[clickedValue] = { 
                        ...originalItem, 
                        color: item.color, 
                        category: currentActiveTab 
                    }; 
                }
                updateTextareaDisplay();      
                updateLegendTable(currentActiveTab); 
                updateTabVisualIndicators();  
            });
        });
    };

    // テーブルデータを更新する関数（ステークホルダー数を右端に配置）
    const updateDataTableDisplay = () => {
        const thead = section.querySelector(`#data-content-table-${docId} thead`);
        const tbody = section.querySelector(`#data-content-tbody-${docId}`);
        if (!tbody || !thead) return;

        // 現在どの統計カテゴリが選ばれているかの初期状態
        const isSubjectClassMode = (currentActiveTab === "subject");
        const isObjectClassMode = (currentActiveTab === "object");
        
        // テーブル自体のスタイルを中央揃え・最大幅に設定
        const tableEl = section.querySelector(`#data-content-table-${docId}`);
        if (tableEl) {
            tableEl.style.width = "100%";
            tableEl.style.margin = "0 auto";
            tableEl.style.borderCollapse = "collapse";
        }
        
        // 1. ヘッダーを生成（ステークホルダー数を一番右端に配置）
        thead.innerHTML = `
            <tr>
                <th style="padding: 10px; border-bottom: 2px solid #e0e0e0; width: 7%; text-align: center;">ID</th>
                <th style="padding: 10px; border-bottom: 2px solid #e0e0e0; width: 35%; text-align: left; cursor: help;" title="セルをクリックすると詳細/クラスを切り替え">
                    ${isSubjectClassMode ? '主語クラス (sClass)' : '主語 (Subject)'}
                </th>
                <th style="padding: 10px; border-bottom: 2px solid #e0e0e0; width: 12%; text-align: center;">述語 (Predicate)</th>
                <th style="padding: 10px; border-bottom: 2px solid #e0e0e0; width: 35%; text-align: left; cursor: help;" title="セルをクリックすると詳細/クラスを切り替え">
                    ${isObjectClassMode ? '目的語クラス (oClass)' : '目的語 (Object)'}
                </th>
                <th style="padding: 10px; border-bottom: 2px solid #e0e0e0; width: 11%; text-align: center;">ステークホルダー数</th>
            </tr>
        `;

        tbody.innerHTML = "";
        const currentText = textarea.value.trim();

        if (!currentText) {
            tbody.innerHTML = `<tr><td colspan="5" style="padding: 20px; text-align: center; color: #999;">該当するデータがありません。</td></tr>`;
            return;
        }

        const lines = currentText.split("\n");
        
        // --- データの収集フェーズ ---
        const stringToSClassMap = new Map(); 
        const stringToOClassMap = new Map(); 
        const idGroupMap = {}; 
        
        const idToOpinionsMap = new Map(); 
        const opinionToStakeholderMap = new Map(); 

        // 1次パース：クラス定義（sClass/oClass）および発話者マッピングの収集
        lines.forEach(lineStr => {
            if (!lineStr.trim()) return;
            const columns = lineStr.split("\t");
            if (columns.length < 3) return;
            const col0 = columns[0].trim();
            const col1 = columns[1].trim();
            const col2 = columns[2].trim();

            if (!/^T\d+$/.test(col0)) {
                if (col1 === "sClass") stringToSClassMap.set(col0, col2);
                if (col1 === "oClass") stringToOClassMap.set(col0, col2);
                if (col1 === "発話者") {
                    opinionToStakeholderMap.set(col0, col2);
                }
            }
        });

        // 2次パース：T番号に紐づく主語・目的語、および「意見」の収集
        lines.forEach(lineStr => {
            if (!lineStr.trim()) return;
            const columns = lineStr.split("\t");
            if (columns.length < 3) return;
            const col0 = columns[0].trim();
            const col1 = columns[1].trim();
            const col2 = columns[2].trim();

            if (/^T\d+$/.test(col0)) {
                if (!idGroupMap[col0]) {
                    idGroupMap[col0] = { rawSubject: "", rawObject: "", predicates: [] };
                }
                if (col1 === "主語") idGroupMap[col0].rawSubject = col2;
                if (col1 === "目的語") idGroupMap[col0].rawObject = col2;
                
                if (col1 === "意見") {
                    if (!idToOpinionsMap.has(col0)) {
                        idToOpinionsMap.set(col0, new Set());
                    }
                    idToOpinionsMap.get(col0).add(col2);
                }
            }
        });

        // 3次パース：純粋な関係性（述語）を収集
        lines.forEach(lineStr => {
            if (!lineStr.trim()) return;
            const columns = lineStr.split("\t");
            if (columns.length < 3) return;
            const subStr = columns[0].trim();
            const predStr = columns[1].trim();
            const objStr = columns[2].trim();

            if (/^T\d+$/.test(subStr) || predStr === "sClass" || predStr === "oClass" || predStr === "-" || predStr === "意見" || predStr === "発話者") {
                return;
            }

            Object.keys(idGroupMap).forEach(tId => {
                const group = idGroupMap[tId];
                const isMatchSubject = (group.rawSubject === subStr);
                const isMatchObject = (group.rawObject === objStr);

                if (isMatchSubject && isMatchObject) {
                    if (!group.predicates.includes(predStr)) {
                        group.predicates.push(predStr);
                    }
                }
            });
        });

        // --- HTML出力の組み立てフェーズ ---
        const sortedIds = Object.keys(idGroupMap).sort((a, b) => {
            return parseInt(a.replace("T", ""), 10) - parseInt(b.replace("T", ""), 10);
        });

        let htmlBuffer = "";
        sortedIds.forEach(tId => {
            const group = idGroupMap[tId];
            const rawSub = group.rawSubject || "（未定義）";
            const rawObj = group.rawObject || "（未定義）";
            const sClass = stringToSClassMap.get(rawSub) || rawSub;
            const oClass = stringToOClassMap.get(rawObj) || rawObj;
            
            const displayPred = group.predicates.length > 0 ? group.predicates.join(" / ") : "（関係性なし）";

            const initSubText = isSubjectClassMode ? sClass : rawSub;
            const initObjText = isObjectClassMode ? oClass : rawObj;

            // ステークホルダー数の計算
            const shSet = new Set();
            const opinions = idToOpinionsMap.get(tId);
            if (opinions) {
                opinions.forEach(op => {
                    const sh = opinionToStakeholderMap.get(op);
                    if (sh) shSet.add(sh);
                });
            }
            const stakeholderCount = shSet.size;

            // HTMLの出力順序を入れ替え（ステークホルダー数を一番最後（右側）のtdに）
            htmlBuffer += `
                <tr style="border-bottom: 1px solid #eee; transition: background 0.1s;" onmouseover="this.style.backgroundColor='#f9f9f9'" onmouseout="this.style.backgroundColor='transparent'">
                    <td style="padding: 10px; font-weight: bold; color: #004085; width: 7%; font-size: 0.95em; text-align: center;">${tId}</td>
                    <td class="toggle-cell subject-cell" 
                        style="padding: 10px; word-break: break-all; width: 35%; text-align: left; cursor: pointer; transition: color 0.2s;"
                        data-raw="${rawSub}" 
                        data-class="${sClass}"
                        data-current="${isSubjectClassMode ? 'class' : 'raw'}"
                        onmouseover="this.style.color='#0056b3'; this.style.textDecoration='underline';"
                        onmouseout="this.style.color=''; this.style.textDecoration='';"
                    >${initSubText}</td>
                    <td style="padding: 10px; color: #333; font-weight: 500; width: 12%; font-size: 0.95em; text-align: center;">${displayPred}</td>
                    <td class="toggle-cell object-cell" 
                        style="padding: 10px; word-break: break-all; width: 35%; text-align: left; cursor: pointer; transition: color 0.2s;"
                        data-raw="${rawObj}" 
                        data-class="${oClass}"
                        data-current="${isObjectClassMode ? 'class' : 'raw'}"
                        onmouseover="this.style.color='#0056b3'; this.style.textDecoration='underline';"
                        onmouseout="this.style.color=''; this.style.textDecoration='';"
                    >${initObjText}</td>
                    <td style="padding: 10px; color: #495057; font-weight: bold; width: 11%; font-size: 0.95em; text-align: center;">${stakeholderCount}</td>
                </tr>
            `;
        });

        tbody.innerHTML = htmlBuffer === "" 
            ? `<tr><td colspan="5" style="padding: 20px; text-align: center; color: #999;">該当するデータがありません。</td></tr>` 
            : htmlBuffer;

        // --- 4. クリックイベントのバインド（個別トグル処理） ---
        tbody.querySelectorAll(".toggle-cell").forEach(cell => {
            cell.addEventListener("click", (e) => {
                e.stopPropagation();
                
                const currentStatus = cell.getAttribute("data-current");
                const rawVal = cell.getAttribute("data-raw");
                const classVal = cell.getAttribute("data-class");

                if (currentStatus === "raw") {
                    cell.textContent = classVal;
                    cell.setAttribute("data-current", "class");
                    cell.style.fontWeight = "600";
                } else {
                    cell.textContent = rawVal;
                    cell.setAttribute("data-current", "raw");
                    cell.style.fontWeight = "normal";
                }
            });
        });
    };
    // グラフ描画・同期共通関数
    const syncGraphWithCurrentText = () => {
        const diagramTab = section.querySelector(".doc-panel-tab[data-tab='diagram']");
        if (diagramTab && diagramTab.classList.contains("active")) {
            const currentText = textarea.value.trim();
            if (currentText !== "") {
                viewMap.setData(currentText);
                viewMap.showMap(
                    `mynetwork-${docId}`, 
                    function (updatedText) {
                        textarea.value = updatedText;
                        updateDataTableDisplay(); 
                    },
                    function (net) {
                        network = net;
                        network.setOptions({
                            physics: {
                                enabled: true,
                                stabilization: { iterations: 1000 }
                            }
                        });
                        network.once("stabilizationIterationsDone", function () {
                            network.setOptions({
                                physics: { enabled: false }
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
                if (typeof viewMap.clear === "function") {
                    viewMap.clear();
                } else if (network) {
                    network.setData({ nodes: [], edges: [] });
                }
            }
        }
    };

    // 選択されたフィルタに基づいてテキストエリア表示を更新する関数
    const updateTextareaDisplay = () => {
        const activeLabels = Object.keys(activeFiltersMap); 
        
        if (activeLabels.length === 0) {
            textarea.value = getCleanFullText();
            syncGraphWithCurrentText();
            updateDataTableDisplay(); 
            return;
        }

        let allowedIndexesSet = null;
        activeLabels.forEach(label => {
            const itemIndexes = activeFiltersMap[label].bindingIndexes || [];
            const currentIndexesSet = new Set(itemIndexes);

            if (allowedIndexesSet === null) {
                allowedIndexesSet = new Set(currentIndexesSet);
            } else {
                const nextIntersection = new Set();
                for (let idx of allowedIndexesSet) {
                    if (currentIndexesSet.has(idx)) {
                        nextIntersection.add(idx);
                    }
                }
                allowedIndexesSet = nextIntersection;
            }
        });

        if (!allowedIndexesSet || allowedIndexesSet.size === 0) {
            textarea.value = "";
            syncGraphWithCurrentText();
            updateDataTableDisplay(); 
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

                    if (isAllDoc && columns.length > 0) {
                        columns.shift(); 
                    }
                    filteredLines.push(columns.join("\t"));
                }
            });
        });

        textarea.value = Array.from(new Set(filteredLines)).join("\n");
        syncGraphWithCurrentText();
        updateDataTableDisplay(); 
    };

    // 選択状態に応じて左側の数値バッジや色表示を動的に書き換える関数
    const updateTabVisualIndicators = () => {
        const activeLabels = Object.keys(activeFiltersMap);
        let visibleTrCount = 0;
        const countedTrIds = new Set();

        if (textarea.value) {
            const currentEdges = textarea.value.split("\n");
            currentEdges.forEach(edgeStr => {
                if (!edgeStr) return;
                const columns = edgeStr.split("\t");
                columns.forEach(col => {
                    if (/^T\d+$/.test(col.trim())) countedTrIds.add(col.trim());
                });
            });
            visibleTrCount = countedTrIds.size;
        }

        if (!statsTable) return;

        statsTable.querySelectorAll(".stats-toggle-btn").forEach(btn => {
            const targetKey = btn.getAttribute("data-target");
            if (!targetKey) return;
            
            const activeCount = Object.values(activeFiltersMap).filter(item => item.category === targetKey).length;
            const oldBadge = btn.querySelector(".tab-badge");
            if (oldBadge) oldBadge.remove();

            if (activeCount > 0) {
                const badge = document.createElement("span");
                badge.className = "tab-badge";
                badge.textContent = `${activeCount}`;
                btn.appendChild(badge);
            }

            const targetTd = targetStatElements[targetKey];
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
                            const arr = activeFiltersMap[label].bindingIndexes || [];
                            if (matchedIndexes === null) matchedIndexes = new Set(arr);
                            else {
                                const nextInt = new Set();
                                arr.forEach(id => { if (matchedIndexes.has(id)) nextInt.add(id); });
                                matchedIndexes = nextInt;
                            }
                        });

                        currentList.forEach(item => {
                            const isSelected = !!activeFiltersMap[item.name];
                            const hasOverlap = item.bindingIndexes.some(idx => matchedIndexes && matchedIndexes.has(idx));
                            if (isSelected || hasOverlap) {
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

    // ------------------------------------------------------------------------
    // 5. ビュー制御・イベントハンドリング (View Controller)
    // ------------------------------------------------------------------------
    const bindEvents = () => {
        // 1. コピーボタンの挙動
        const copyBtn = section.querySelector(".btn-copy-small");
        if (copyBtn) {
            copyBtn.addEventListener("click", () => {
                navigator.clipboard.writeText(textarea.value).then(() => {
                    const origText = copyBtn.innerText;
                    copyBtn.innerText = "コピーしました！";
                    copyBtn.style.backgroundColor = "#28a745";
                    copyBtn.style.color = "#ffffff";
                    setTimeout(() => {
                        copyBtn.innerText = origText;
                        copyBtn.style.backgroundColor = "";
                        copyBtn.style.color = "";
                    }, 1500);
                });
            });
        }

        // 2. 凡例テーブルへのダブルクリック（同一カテゴリフィルタの一括解除）
        if (legendTable) {
            legendTable.addEventListener("dblclick", (e) => {
                e.stopPropagation();
                let hasChanged = false;
                Object.keys(activeFiltersMap).forEach(label => {
                    if (activeFiltersMap[label].category === currentActiveTab) {
                        delete activeFiltersMap[label];
                        hasChanged = true;
                    }
                });
                if (hasChanged) {
                    updateTextareaDisplay();
                    updateLegendTable(currentActiveTab);
                    updateTabVisualIndicators();
                }
            });
        }

        // 3. 統計カテゴリの切り替え・クリックイベント処理
        if (statsTable) {
            statsTable.addEventListener("click", (e) => {
                const btn = e.target.closest(".stats-toggle-btn");
                if (!btn) return;

                const targetKey = btn.getAttribute("data-target");
                const parentRow = btn.closest("tr");
                const isHiddenOrDisabled = parentRow && (parentRow.style.display === "none" || btn.disabled);

                if (isHiddenOrDisabled) {
                    Object.keys(activeFiltersMap).forEach(label => {
                        if (activeFiltersMap[label].category === targetKey) {
                            delete activeFiltersMap[label];
                        }
                    });

                    const defaultBtn = statsTable.querySelector('.stats-toggle-btn[data-target="triple"]');
                    if (defaultBtn) {
                        defaultBtn.click();
                    }
                    return;
                }

                statsTable.querySelectorAll(".stats-toggle-btn").forEach(b => b.classList.remove("active"));
                btn.classList.add("active");

                const labelText = btn.getAttribute("data-label") || ""; 

                if (titleEl) titleEl.textContent = `${labelText}一覧`;
                if (noticeEl) noticeEl.textContent = "";

                updateLegendTable(targetKey);
                updateTabVisualIndicators();
            });
        }

        // 4. 全フィルタクリアボタン
        const clearBtn = section.querySelector(".btn-clear-filters");
        if (clearBtn) {
            clearBtn.addEventListener("click", () => {
                activeFiltersMap = {}; 
                updateTextareaDisplay(); 
                updateLegendTable(currentActiveTab);
                updateTabVisualIndicators();
            });
        }

        // 5. 一覧（選択中カテゴリ）の隣にある選択解除ボタン（部分解除に変更）
        const listClearBtn = section.querySelector(`#btn-clear-from-list-${docId}`);
        if (listClearBtn && statsTable) {
            listClearBtn.addEventListener("click", () => {
                // 【修正】現在のカテゴリ(currentActiveTab)に属するフィルタだけを削除する
                Object.keys(activeFiltersMap).forEach(label => {
                    if (activeFiltersMap[label].category === currentActiveTab) {
                        delete activeFiltersMap[label];
                    }
                });

                // 2. 統計テーブル内のすべてのトグルボタンから active クラスを一括削除
                statsTable.querySelectorAll(".stats-toggle-btn").forEach(b => b.classList.remove("active"));

                // 3. 初期状態である「トリプル数 (triple)」ボタンを強制クリック
                // （※もしトリプル数に戻したくない場合は、ここを currentActiveTab のまま再描画する処理に変えることも可能です）
                const defaultBtn = statsTable.querySelector('.stats-toggle-btn[data-target="triple"]');
                if (defaultBtn) {
                    defaultBtn.click();
                } else {
                    updateTextareaDisplay();
                    updateLegendTable(currentActiveTab);
                    updateTabVisualIndicators();
                }

                // 4. 現在アクティブなタブの状態に合わせて表示をリフレッシュする
                const activeTabEl = section.querySelector(".tabs .active"); 
                const currentTabName = activeTabEl ? activeTabEl.getAttribute("data-tab") : "table";

                if (currentTabName === "diagram") {
                    syncGraphWithCurrentText();
                    if (network && typeof network.redraw === "function") {
                        network.setSize("100%", "100%");
                        network.redraw();
                        network.fit();
                    }
                } else if (currentTabName === "table") {
                    if (typeof updateDataTableDisplay === "function") {
                        updateDataTableDisplay();
                    }
                }
            });
        }

        // 6. タブ切り替え制御
        tabs.forEach(tab => {
            tab.addEventListener("click", () => {
                const targetTab = tab.getAttribute("data-tab");

                tabs.forEach(t => t.classList.remove("active"));
                tab.classList.add("active");

                panes.forEach(pane => {
                    if (pane.getAttribute("data-content") === targetTab) {
                        pane.style.setProperty("display", (targetTab === "text") ? "flex" : "block", (targetTab === "text") ? "important" : "");
                        pane.classList.add("active");
                    } else {
                        pane.style.setProperty("display", "none", "important");
                        pane.classList.remove("active");
                    }
                });

                if (targetTab === "diagram") {
                    syncGraphWithCurrentText();
                    if (network && typeof network.redraw === "function") {
                        setTimeout(() => {
                            network.setSize("100%", "100%");
                            network.redraw();
                            network.fit(); 
                        }, 50); 
                    }
                }

                if (targetTab === "table") {
                    updateDataTableDisplay();
                }
            });
        });

        // 7. 自動レイアウトボタンのトグルイベント処理
        if (physicsBtn) {
            physicsBtn.addEventListener("click", () => {
                if (!network) return;
                const isOn = physicsBtn.getAttribute("data-on") === "true";
                if (isOn) {
                    network.setOptions({ physics: { enabled: false } });
                    physicsBtn.innerText = "自動レイアウト：OFF";
                    physicsBtn.setAttribute("data-on", "false");
                    physicsBtn.style.backgroundColor = "#6c757d"; 
                } else {
                    network.setOptions({ physics: { enabled: true } });
                    physicsBtn.innerText = "自動レイアウト：ON";
                    physicsBtn.setAttribute("data-on", "true");
                    physicsBtn.style.backgroundColor = "#2196F3"; 
                }
            });
        }
    };

    // ------------------------------------------------------------------------
    // 6. 初期起動処理 (Initializer)
    // ------------------------------------------------------------------------
    const initialize = () => {
        // UIテンプレートをレンダリング
        renderUI();

        // 各種イベントのバインド
        bindEvents();

        // 初期選択カテゴリ（動的フォールバック）の決定
        let defaultTarget = "triple"; 
        if (!config.isSubjectEnabled) {
            if (config.isStakeholderEnabled) defaultTarget = "stakeholder";
            else if (config.isPredicateEnabled) defaultTarget = "p";
        }
        
        if (statsTable) {
            const defaultBtn = statsTable.querySelector(`.stats-toggle-btn[data-target="${defaultTarget}"]`);
            if (defaultBtn) defaultBtn.click();
        }

        // 初期描画の同期
        syncGraphWithCurrentText();
        updateDataTableDisplay(); 
    };

    // ランタイム実行
    initialize();
}
