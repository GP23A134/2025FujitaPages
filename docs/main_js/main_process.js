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
