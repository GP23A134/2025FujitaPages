/**
 * =======================================================================
 * CCO4KG 変換・特定ID指定抽出ツール メインロジック
 * 区分: ローカル連携 ＆ カテゴリ間相互ロック（動的絞り込み）完全対応版
 * =======================================================================
 * * 【全体の概要】
 * 本スクリプトは、ナレッジグラフ（KG）データを解析し、画面上で主語、目的語、
 * ステークホルダーなどのカテゴリを横断して動的に絞り込む（相互ロックする）
 * ためのフロントエンド用コアロジックです。
 */

// ------------------------------------------------------------------------
// 1. 画面初期化 ＆ イベントリスナー登録
// ------------------------------------------------------------------------
// ブラウザがHTMLの読み込みを完了し、DOMツリーが構築されたタイミングで実行
window.addEventListener('DOMContentLoaded', () => {
    // グローバル変数（window.output_json_data）に解析元となるデータが存在するかチェック
    if (typeof window.output_json_data !== 'undefined' && window.output_json_data !== null) {
        console.log("[CCO4KG Loader] 相互ロック・カテゴリカラー対応版プロセスを読み込みました。");
        
        // 抽出対象の文書IDを選択するドロップダウン（セレクトボックス）を初期化
        initDocIdDropdown();
        
        // 解析結果出力エリアとカラーピッカーエリアのアコーディオン（開閉）を設定
        setupAccordion("headerOutput", "contentOutput");
        setupAccordion("headerColor", "contentColor");
        
        // 画面上のチェックボックス（主語、目的語、クラスリンクなどの有効化/無効化切替）のIDリスト
        const targetIds = [
            "enableSubject", "enableObject", "enablePredicate", 
            "enableSClass", "enableOClass", "enableClassLink", 
            "enableStakeholder", "enableStClass", "enableEvidence"
        ];
        
        // 各チェックボックスの状態が変化（クリック）されたら、UIの制御関数を実行するよう登録
        targetIds.forEach(id => document.getElementById(id).addEventListener("change", updateUIControls));
        
        // ステークホルダーの着色モード（種類別 or 組織別）を切り替えるラジオボタンのイベント登録
        document.getElementsByName("shColorMode").forEach(radio => {
            radio.addEventListener("change", updateUIControls);
        });
        
        // 「データ処理実行」ボタンをクリックしたときにメイン処理（splitAndProcessData）を呼び出す
        document.getElementById("execBtn").addEventListener("click", splitAndProcessData);
        
        // 初期状態の画面表示を整える
        updateUIControls();
        // 処理準備が完了したため、実行ボタンを押せるように有効化
        document.getElementById("execBtn").disabled = false;
    } else {
        // 元データが読み込めなかった場合はコンソールにエラーを表示
        console.error("[CCO4KG Loader] エラー: window.output_json_data が見つかりません。");
    }
});

/**
 * 共通アコーディオン（開閉枠）の制御関数
 * @param {string} headerId - クリックするヘッダー要素のID
 * @param {string} contentId - 開閉させるコンテンツ要素のID
 */
function setupAccordion(headerId, contentId) {
    const header = document.getElementById(headerId);
    const content = document.getElementById(contentId);
    if (!header || !content) return;

    header.addEventListener("click", () => {
        // 現在「開いている（active）」クラスがついているか判定
        const isActive = header.classList.contains("active");
        if (isActive) {
            header.classList.remove("active");
            content.style.display = "none"; // 非表示にする
        } else {
            header.classList.add("active");
            content.style.style = "block"; // 表示する
            content.style.display = "block"; 
        }
    });
}

/**
 * グローバルデータから、利用可能な文書ID（docId）をすべて抽出してドロップダウンを生成する関数
 */
function initDocIdDropdown() {
    const dropdown = document.getElementById("docIdSelect");
    if (!dropdown) return;

    // 重複のない文書IDを管理するためのSetオブジェクト
    const docIds = new Set();
    
    // 全データ（トリプル配列）をループして、存在する全ての docId を収集
    if (window.output_json_data.triples && Array.isArray(window.output_json_data.triples)) {
        window.output_json_data.triples.forEach(t => {
            if (t.docId) docIds.add(t.docId);
        });
    }

    // 集めた文書IDを並び替えてドロップダウンの選択肢（option）として追加
    Array.from(docIds).sort().forEach(id => {
        const opt = document.createElement("option");
        opt.value = id;
        opt.textContent = id;
        dropdown.appendChild(opt);
    });
}

/**
 * チェックボックスやラジオボタンの選択状況に応じて、入力欄の有効/無効（グレーアウト）を制御する関数
 */
function updateUIControls() {
    // 各種設定欄のDOM要素を取得
    const shColorModeRadio = document.getElementsByName("shColorMode");
    const colorSubjectInput = document.getElementById("colorSubject");
    const colorObjectInput = document.getElementById("colorObject");
    const colorPredicateInput = document.getElementById("colorPredicate");
    const colorSClassInput = document.getElementById("colorSClass");
    const colorOClassInput = document.getElementById("colorOClass");
    const colorClassLinkInput = document.getElementById("colorClassLink");
    const colorEvidenceInput = document.getElementById("colorEvidence");

    // 各機能がチェック（有効化）されているかどうかの真偽値を取得
    const shEnabled = document.getElementById("enableStakeholder").checked;
    const sEnabled = document.getElementById("enableSubject").checked;
    const oEnabled = document.getElementById("enableObject").checked;
    const pEnabled = document.getElementById("enablePredicate").checked;
    const scEnabled = document.getElementById("enableSClass").checked;
    const ocEnabled = document.getElementById("enableOClass").checked;
    const clEnabled = document.getElementById("enableClassLink").checked;
    const evEnabled = document.getElementById("enableEvidence").checked;

    // ステークホルダーが無効化されている場合は、着色モードのラジオボタンをすべて操作不可にする
    shColorModeRadio.forEach(radio => radio.disabled = !shEnabled);

    // 各機能の有効/無効と連動して、対応するカラーピッカー（色選択）の入力可否を切り替える
    if (colorSubjectInput) colorSubjectInput.disabled = !sEnabled;
    if (colorObjectInput) colorObjectInput.disabled = !oEnabled;
    if (colorPredicateInput) colorPredicateInput.disabled = !pEnabled;
    if (colorSClassInput) colorSClassInput.disabled = !scEnabled;
    if (colorOClassInput) colorOClassInput.disabled = !ocEnabled;
    if (colorClassLinkInput) colorClassLinkInput.disabled = !clEnabled;
    if (colorEvidenceInput) colorEvidenceInput.disabled = !evEnabled;
}

// ------------------------------------------------------------------------
// 2. メインデータ処理ロジック
// ------------------------------------------------------------------------
/**
 * 画面で指定された条件（文書ID、チェック状態、指定カラー）に従って、
 * データを抽出し、可視化用のJSONデータおよび「解析結果統計」を生成するメイン関数
 */
function splitAndProcessData() {
    console.log("[CCO4KG Process] データ処理を開始します...");

    // 画面の選択値（文書ID）を取得
    const selectedDocId = document.getElementById("docIdSelect").value;
    
    // ユーザーが指定した各種カラーコード（16進数）を取得
    const colors = {
        subject: document.getElementById("colorSubject").value,
        object: document.getElementById("colorObject").value,
        predicate: document.getElementById("colorPredicate").value,
        sClass: document.getElementById("colorSClass").value,
        oClass: document.getElementById("colorOClass").value,
        classLink: document.getElementById("colorClassLink").value,
        evidence: document.getElementById("colorEvidence").value
    };

    // ユーザーが指定した各種抽出対象の有効化フラグ（チェック状態）を取得
    const flags = {
        subject: document.getElementById("enableSubject").checked,
        object: document.getElementById("enableObject").checked,
        predicate: document.getElementById("enablePredicate").checked,
        sClass: document.getElementById("enableSClass").checked,
        oClass: document.getElementById("enableOClass").checked,
        classLink: document.getElementById("enableClassLink").checked,
        stakeholder: document.getElementById("enableStakeholder").checked,
        stClass: document.getElementById("enableStClass").checked,
        evidence: document.getElementById("enableEvidence").checked
    };

    // ステークホルダーのカラーモード（種類別 'type' または 組織別 'org'）を取得
    let shColorMode = "type";
    const selectedRadio = document.querySelector('input[name="shColorMode"]:checked');
    if (selectedRadio) {
        shColorMode = selectedRadio.value;
    }

    // 元データ（トリプルリスト）を配列として取得
    const rawTriples = window.output_json_data.triples || [];
    
    // 【ステップ1】選択された文書ID（docId）に一致するトリプルのみをフィルタリング
    const filteredTriples = rawTriples.filter(t => t.docId === selectedDocId);
    console.log(`[CCO4KG Process] 文書ID: ${selectedDocId} に合致するトリプル数: ${filteredTriples.length}`);

    if (filteredTriples.length === 0) {
        alert("選択された文書IDに対応するデータがありません。");
        return;
    }

    // 【ステップ2】各要素の出現数や、どのトリプルと紐づいているか(インデックス)を保持する集計用マップ
    const subjectMap = {};
    const objectMap = {};
    const sClassMap = {};
    const oClassMap = {};
    const stakeholderMap = {};
    const opinionMap = {};
    const evidenceMap = {};

    // フィルタリングされたトリプルを1つずつ精査し、要素ごとにインデックス（位置番号）を紐づけて集計
    filteredTriples.forEach((t, index) => {
        // 主語（Subject）の集計
        if (t.subject) {
            if (!subjectMap[t.subject]) subjectMap[t.subject] = { count: 0, indexes: [] };
            subjectMap[t.subject].count++;
            subjectMap[t.subject].indexes.push(index); // この要素が含まれるトリプルのインデックスを記録
        }
        // 目的語（Object）の集計
        if (t.object) {
            if (!objectMap[t.object]) objectMap[t.object] = { count: 0, indexes: [] };
            objectMap[t.object].count++;
            objectMap[t.object].indexes.push(index);
        }
        // 主語クラス（sClass）の集計
        if (t.sClass) {
            if (!sClassMap[t.sClass]) sClassMap[t.sClass] = { count: 0, indexes: [] };
            sClassMap[t.sClass].count++;
            sClassMap[t.sClass].indexes.push(index);
        }
        // 目的語クラス（oClass）の集計
        if (t.oClass) {
            if (!oClassMap[t.oClass]) oClassMap[t.oClass] = { count: 0, indexes: [] };
            oClassMap[t.oClass].count++;
            oClassMap[t.oClass].indexes.push(index);
        }
        // ステークホルダーの集計
        if (t.stakeholder) {
            if (!stakeholderMap[t.stakeholder]) stakeholderMap[t.stakeholder] = { count: 0, indexes: [], type: t.stClass || "未定義" };
            stakeholderMap[t.stakeholder].count++;
            stakeholderMap[t.stakeholder].indexes.push(index);
        }
        // 意見（Opinion/述語）の集計
        if (t.predicate) {
            if (!opinionMap[t.predicate]) opinionMap[t.predicate] = { count: 0, indexes: [] };
            opinionMap[t.predicate].count++;
            opinionMap[t.predicate].indexes.push(index);
        }
        // 根拠（Evidence）の集計
        if (t.evidence) {
            if (!evidenceMap[t.evidence]) evidenceMap[t.evidence] = { count: 0, indexes: [] };
            evidenceMap[t.evidence].count++;
            evidenceMap[t.evidence].indexes.push(index);
        }
    });

    // ステークホルダーのタイプ（種類）に応じて固定のカラーパレットを定義
    const stakeholderTypeColors = {
        "行政": "#e53935",   // 赤系
        "事業者": "#1e88e5", // 青系
        "住民": "#4caf50",   // 緑系
        "有識者": "#ffb300", // 黄・オレンジ系
        "未定義": "#757575"  // グレー
    };

    // 組織名ごとにランダム（固定ハッシュ値）で異なる色を割り当てるためのカラーパレット（組織別モード用）
    const orgPalette = [
        "#8e24aa", "#d81b60", "#00acc1", "#43a047", "#f4511e", 
        "#3949ab", "#00867d", "#5d4037", "#76ff03", "#fdd835"
    ];

    // 文字列から簡易的なハッシュ数値を生成し、パレットのインデックスを決める関数
    const getOrgColor = (name) => {
        let hash = 0;
        for (let i = 0; i < name.length; i++) {
            hash = name.charCodeAt(i) + ((hash << 5) - hash);
        }
        const idx = Math.abs(hash) % orgPalette.length;
        return orgPalette[idx];
    };

    // 【ステップ3】各カテゴリの集計データを、画面の凡例一覧で使いやすいようにオブジェクト配列構造へ整形
    const stats = {
        tripleCount: filteredTriples.length,
        subjectCount: Object.keys(subjectMap).length,
        objectCount: Object.keys(objectMap).length,
        sClassCount: Object.keys(sClassMap).length,
        oClassCount: Object.keys(oClassMap).length,
        stakeholderCount: Object.keys(stakeholderMap).length,
        opinionCount: Object.keys(opinionMap).length,
        evidenceCount: Object.keys(evidenceMap).length,
        configColors: colors,
        lists: {
            // トリプルそのもののリスト（インデックス番号そのものをキーとしてバインド）
            triple: filteredTriples.map((t, idx) => ({ name: `Triple-${idx+1}`, count: 1, bindingIndexes: [idx], color: colors.predicate })),
            // 主語リスト
            subject: Object.keys(subjectMap).map(k => ({ name: k, count: subjectMap[k].count, bindingIndexes: subjectMap[k].indexes, color: colors.subject })),
            // 目的語リスト
            object: Object.keys(objectMap).map(k => ({ name: k, count: objectMap[k].count, bindingIndexes: objectMap[k].indexes, color: colors.object })),
            // 主語クラスリスト
            sClass: Object.keys(sClassMap).map(k => ({ name: k, count: sClassMap[k].count, bindingIndexes: sClassMap[k].indexes, color: colors.sClass })),
            // 目的語クラスリスト
            oClass: Object.keys(oClassMap).map(k => ({ name: k, count: oClassMap[k].count, bindingIndexes: oClassMap[k].indexes, color: colors.oClass })),
            // ステークホルダーリスト（カラーモード設定によって割り当てる色を動的に切り替える）
            stakeholder: Object.keys(stakeholderMap).map(k => {
                const shObj = stakeholderMap[k];
                let finalColor = colors.subject; // デフォルトの予備色
                if (shColorMode === "type") {
                    finalColor = stakeholderTypeColors[shObj.type] || stakeholderTypeColors["未定義"];
                } else {
                    finalColor = getOrgColor(k);
                }
                return { name: k, count: shObj.count, bindingIndexes: shObj.indexes, color: finalColor, type: shObj.type };
            }),
            // 意見リスト
            opinion: Object.keys(opinionMap).map(k => ({ name: k, count: opinionMap[k].count, bindingIndexes: opinionMap[k].indexes, color: colors.predicate })),
            // 根拠リスト
            evidence: Object.keys(evidenceMap).map(k => ({ name: k, count: evidenceMap[k].count, bindingIndexes: evidenceMap[k].indexes, color: colors.evidence }))
        }
    };

    // データの加工がすべて終わったら、画面（UI）へデータを引き渡してレンダリングを開始する
    renderStatsAndInteractiveControls(stats);

    // 【ステップ4】可視化グラフライブラリ（Cytoscape等）に渡すためのノード・エッジの生成処理
    const nodesMap = {};
    const edgesList = [];

    // 画面のフラグで「有効」とされている要素だけを抽出し、グラフのノードを生成する補助関数
    const addNode = (id, label, type, color, shape = "ellipse") => {
        if (!id) return;
        if (!nodesMap[id]) {
            nodesMap[id] = { data: { id: id, label: label, type: type, color: color, shape: shape } };
        }
    };

    // 各トリプルデータから、チェックボックスで有効化されているノードとそれらを結ぶリンクをグラフデータとして構築
    filteredTriples.forEach((t, idx) => {
        const sId = `S_${t.subject}`;
        const oId = `O_${t.object}`;
        const scId = `SC_${t.sClass}`;
        const ocId = `OC_${t.oClass}`;
        const shId = `SH_${t.stakeholder}`;
        const evId = `EV_${t.evidence}`;

        // 各要素が画面上で有効化（チェックあり）されている場合のみノードとして登録
        if (flags.subject && t.subject) addNode(sId, t.subject, "Subject", colors.subject, "round-rectangle");
        if (flags.object && t.object) addNode(oId, t.object, "Object", colors.object, "round-rectangle");
        if (flags.sClass && t.sClass) addNode(scId, t.sClass, "SClass", colors.sClass, "ellipse");
        if (flags.oClass && t.oClass) addNode(ocId, t.oClass, "OClass", colors.oClass, "ellipse");
        if (flags.evidence && t.evidence) addNode(evId, t.evidence, "Evidence", colors.evidence, "hexagon");

        if (flags.stakeholder && t.stakeholder) {
            let shColor = colors.subject;
            if (shColorMode === "type") {
                shColor = stakeholderTypeColors[t.stClass] || stakeholderTypeColors["未定義"];
            } else {
                shColor = getOrgColor(t.stakeholder);
            }
            addNode(shId, t.stakeholder, "Stakeholder", shColor, "diamond");
        }

        // --- エッジ（線）の接続構築ロジック ---
        // 1. 主語 ──(述語)──> 目的語 の基本リンク
        if (flags.subject && flags.object && flags.predicate && t.subject && t.object) {
            edgesList.push({ data: { source: sId, target: oId, label: t.predicate, color: colors.predicate, type: "Predicate" } });
        }
        // 2. 主語 ──> 主語クラス の所属リンク
        if (flags.subject && flags.sClass && t.subject && t.sClass) {
            edgesList.push({ data: { source: sId, target: scId, label: "isA", color: "#999999", type: "isA" } });
        }
        // 3. 目的語 ──> 目的語クラス の所属リンク
        if (flags.object && flags.oClass && t.object && t.oClass) {
            edgesList.push({ data: { source: oId, target: ocId, label: "isA", color: "#999999", type: "isA" } });
        }
        // 4. 主語クラス ──> 目的語クラス のクラス間関係リンク
        if (flags.sClass && flags.oClass && flags.classLink && t.sClass && t.oClass && t.classLink) {
            edgesList.push({ data: { source: scId, target: ocId, label: t.classLink, color: colors.classLink, type: "ClassLink" } });
        }
        // 5. ステークホルダー ──> 主語 の発言・所有関係リンク
        if (flags.stakeholder && flags.subject && t.stakeholder && t.subject) {
            edgesList.push({ data: { source: shId, target: sId, label: "asserts", color: "#444444", type: "asserts" } });
        }
        // 6. 根拠 ──> 主語 のエビデンス裏付けリンク
        if (flags.evidence && flags.subject && t.evidence && t.subject) {
            edgesList.push({ data: { source: evId, target: sId, label: "supports", color: colors.evidence, type: "supports" } });
        }
    });

    // 最終的に出来上がった純粋なノードとエッジのJSONデータを画面下部の大容量テキストエリアに出力
    const resultJson = {
        nodes: Object.values(nodesMap),
        edges: edgesList
    };
    
    document.getElementById("outputJsonTextarea").value = JSON.stringify(resultJson, null, 2);
    console.log("[CCO4KG Process] 解析結果の出力に成功しました。");
}

// ------------------------------------------------------------------------
// 3. 解析出力エリア ＆ 相互ロック（動的インタラクション）処理
// ------------------------------------------------------------------------
/**
 * 解析終了後、画面の「解析結果統計」および「凡例一覧」を生成し、
 * カテゴリをまたいだ双方向絞り込み（相互ロック）を制御するメインUIレンダラー
 * @param {Object} stats - 整形済みの統計データおよびリストデータ
 */
function renderStatsAndInteractiveControls(stats) {
    const section = document.getElementById("interactiveStatsSection");
    if (!section) return;

    // 相互ロック用のUIセクションを表示状態にする
    section.style.display = "block";

    // 画面内の表示を更新するためのDOMターゲット要素をまとめて確保
    const statsTable = section.querySelector(".stats-table");
    const titleEl = section.querySelector(".legend-box-title");
    const noticeEl = section.querySelector(".legend-box-notice");
    const legendTable = section.querySelector(".legend-interactive-table");

    // 現在どのフィルター（どの要素）が選択されているかを保持するメモリマップ（キー: 要素名, 値: カテゴリ等）
    let activeFiltersMap = {};
    // 現在アクティブ（クリックして選択中）になっている統計タブ（カテゴリキー）を管理
    let currentActiveTab = "stakeholder";

    if (statsTable) {
        // 解析結果統計テーブルのHTML構造を生成。各ボタンの左の丸バッジを角丸四角形に変更
        statsTable.innerHTML = `
            <table class="stats-table">
                <tr><td><button class="stats-toggle-btn" data-target="triple"><span class="cat-color-badge" style="background-color:${stats.configColors.predicate};"></span>トリプル数</button></td><td>${stats.tripleCount}</td></tr>
                <tr><td><button class="stats-toggle-btn" data-target="subject"><span class="cat-color-badge" style="background-color:${stats.configColors.subject};"></span>主語数</button></td><td>${stats.subjectCount}</td></tr>
                <tr><td><button class="stats-toggle-btn" data-target="object"><span class="cat-color-badge" style="background-color:${stats.configColors.object};"></span>目的語数</button></td><td>${stats.objectCount}</td></tr>
                <tr><td><button class="stats-toggle-btn" data-target="sClass"><span class="cat-color-badge" style="background-color:${stats.configColors.sClass};"></span>主語クラス数</button></td><td>${stats.sClassCount}</td></tr>
                <tr><td><button class="stats-toggle-btn" data-target="oClass"><span class="cat-color-badge" style="background-color:${stats.configColors.oClass};"></span>目的語クラス数</button></td><td>${stats.oClassCount}</td></tr>
                <tr><td><button class="stats-toggle-btn" data-target="stakeholder"><span class="cat-color-badge" style="background-color:#1e88e5;"></span>ステークホルダー数</button></td><td>${stats.stakeholderCount}</td></tr>
                <tr><td><button class="stats-toggle-btn" data-target="opinion"><span class="cat-color-badge" style="background-color:${stats.configColors.predicate};"></span>意見数</button></td><td>${stats.opinionCount}</td></tr>
                <tr><td><button class="stats-toggle-btn" data-target="evidence"><span class="cat-color-badge" style="background-color:${stats.configColors.evidence};"></span>根拠数</button></td><td>${stats.evidenceCount}</td></tr>
            </table>
        `;

        /**
         * 【ロジックの肝】相互に重なり合う共通の有効トリプルインデックスを計算する関数
         * 他のカテゴリで何か要素が選ばれている場合、それらすべてを満たすトリプルの位置（Set）を返す。
         * 何も選択されていない通常時は null を返す。
         */
        const getIntersectedIndexes = () => {
            const activeItems = Object.values(activeFiltersMap);
            if (activeItems.length === 0) return null; // 何も絞り込まれていない

            // フィルターが所属するカテゴリごとにデータをグループ化（同じカテゴリ内の複数選択はOR、別カテゴリ間はANDで処理するため）
            const categoryGroups = {};
            activeItems.forEach(item => {
                if (!categoryGroups[item.category]) categoryGroups[item.category] = [];
                categoryGroups[item.category].push(item);
            });

            let finalSet = null;

            // 各カテゴリグループ（主語、ステークホルダー等）ごとに条件をマージ
            Object.keys(categoryGroups).forEach(catKey => {
                // 同じカテゴリ内は「OR（和集合）」でインデックスを合算
                const categoryUnionSet = new Set();
                categoryGroups[catKey].forEach(item => {
                    if (item.bindingIndexes) {
                        item.bindingIndexes.forEach(idx => categoryUnionSet.add(idx));
                    }
                });

                // 異なるカテゴリ間は「AND（積集合）」で絞り込む
                if (finalSet === null) {
                    finalSet = new Set(categoryUnionSet);
                } else {
                    const nextIntersectedSet = new Set();
                    categoryUnionSet.forEach(idx => {
                        if (finalSet.has(idx)) nextIntersectedSet.add(idx);
                    });
                    finalSet = nextIntersectedSet;
                }
            });

            return finalSet || new Set();
        };

        /**
         * 【関数】updateLegendTable
         * 選択されている統計タブ（キー）に応じた凡例リストを右側のスクロールテーブル内に構築・描画する
         */
        const updateLegendTable = (targetKey) => {
            currentActiveTab = targetKey;
            let currentList = stats.lists[targetKey] || [];
            
            if (currentList.length === 0) {
                legendTable.innerHTML = `<tr><td style="color:#888; font-style:italic; padding:5px;">データがありません</td></tr>`;
                return;
            }

            // 現在有効な（絞り込まれた）トリプルインデックスの集合を取得
            const intersectedIndexes = getIntersectedIndexes();

            // 画面に表示するためのデータを事前にシミュレーション計算
            const processedList = currentList.map(item => {
                const isSelected = !!activeFiltersMap[item.name];
                let displayCount = item.count; // 初期値は全体の出現数

                // 他のカテゴリで絞り込みが発生している場合、繋がりがある有効な件数を再計算
                if (intersectedIndexes !== null) {
                    if (isSelected) {
                        // 自身がすでに選択されている場合は元の最大数を維持
                        displayCount = item.count;
                    } else {
                        // 自分が属するトリプルインデックスのうち、現在絞り込み条件（intersectedIndexes）をクリアできる数だけをカウント
                        displayCount = item.bindingIndexes ? item.bindingIndexes.filter(i => intersectedIndexes.has(i)).length : 0;
                    }
                }

                return {
                    ...item,
                    isSelected: isSelected,
                    displayCount: displayCount
                };
            });

            // 一覧の見やすさを向上するためソート（1.選択中が一番上、2.次につながりがある有効なもの、3.選択不可の0件は下）
            processedList.sort((a, b) => {
                if (a.isSelected !== b.isSelected) return a.isSelected ? -1 : 1;
                const aAvailable = a.displayCount > 0;
                const bAvailable = b.displayCount > 0;
                if (aAvailable !== bAvailable) return aAvailable ? -1 : 1;
                return b.displayCount - a.displayCount; // 件数の多い順
            });

            // 凡例テーブルのHTMLを動的に組み立て。件数の文字サイズ等はインラインスタイルからCSSクラス制御が効くように修正
            legendTable.innerHTML = processedList.map((item, index) => {
                // 絞り込みが発生していて、かつ未選択の要素の件数は「鮮やかな赤字」にしてアピールする
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

            // 生成した各行要素にクリックイベントを付与し、不活性（0件）のものは選択不可（グレーアウト）にする
            const rows = legendTable.querySelectorAll(".filter-trigger-row");
            rows.forEach(row => {
                const idx = parseInt(row.getAttribute("data-index"), 10);
                const item = processedList[idx];
                if (!item) return;

                // 選択可能なリアルタイム件数が 0件 のアイテムは不活性化する（誤クリック防止）
                if (item.displayCount > 0 || item.isSelected) {
                    row.style.opacity = "1";
                    row.style.pointerEvents = "auto";
                } else {
                    row.style.opacity = "0.25"; // 薄暗くする
                    row.style.pointerEvents = "none"; // マウスイベントを完全に遮断
                }

                // 各行がクリックされた時の処理（フィルターのトグル切り替え）
                row.onclick = () => {
                    const clickedValue = row.getAttribute("data-value");

                    if (activeFiltersMap[clickedValue]) {
                        // すでに選択中であれば、マップから削除して選択を解除
                        delete activeFiltersMap[clickedValue]; 
                    } else {
                        // 未選択であれば、元のフルリストから正しい bindingIndexes の情報を探してフィルターマップに登録
                        const originalItem = currentList.find(c => c.name === clickedValue);
                        activeFiltersMap[clickedValue] = { 
                            ...originalItem, 
                            category: targetKey 
                        }; 
                    }

                    // フィルター変更後に、凡例テーブルと統計の数値表示をすべて再計算してリフレッシュ
                    updateLegendTable(targetKey); 
                    updateTabVisualIndicators(); 
                };
            });
        };

        /**
         * 【関数】updateTabVisualIndicators
         * 目的: 画面左側の「解析結果統計」エリア内の通知バッジ(選択数)と、
         * 他カテゴリでの絞り込みに連動した「リアルタイム有効件数」を更新する
         */
        const updateTabVisualIndicators = () => {
            // 現在他のカテゴリで絞り込まれている要素の全インデックスを取得
            const intersectedIndexes = getIntersectedIndexes();

            // 左側統計テーブル内の、各カテゴリのボタンを1つずつループ走査
            statsTable.querySelectorAll(".stats-toggle-btn").forEach(btn => {
                // ボタンの 'data-target' 属性（"triple", "subject"等）を取得
                const targetKey = btn.getAttribute("data-target");
                if (!targetKey) return; 
                
                /* ------------------------------------------------------------
                 * 1. 選択数バッジ (✓がついている現在アクティブなフィルター数) の更新
                 * ------------------------------------------------------------ */
                const activeCount = Object.values(activeFiltersMap).filter(item => item.category === targetKey).length;
                const oldBadge = btn.querySelector(".tab-badge");
                if (oldBadge) oldBadge.remove(); // 古い通知数字を一度クリア

                if (activeCount > 0) {
                    const badge = document.createElement("span");
                    badge.className = "tab-badge"; 
                    badge.textContent = `${activeCount}`;
                    btn.appendChild(badge); // ボタンの横に現在の選択数を表示
                }

                /* ------------------------------------------------------------
                 * 2. 解析結果統計のカウント数値（右側の列）を動的に変化させる処理
                 * ------------------------------------------------------------ */
                const row = btn.closest("tr");
                if (row) {
                    // 行の2番目のセル（td要素）に数値テキストが入っているため参照
                    const murderousTd = row.cells[1]; 
                    
                    if (murderousTd) {
                        const currentList = stats.lists[targetKey] || [];
                        
                        if (intersectedIndexes === null) {
                            /**
                             * A. 【初期状態 または 絞り込みなし】
                             * ボタンのテキストに依存せず、targetKeyの値で直接初期の正しい総数をセットして復元
                             */
                            if (targetKey === "triple") murderousTd.textContent = stats.tripleCount;
                            else if (targetKey === "subject") murderousTd.textContent = stats.subjectCount;
                            else if (targetKey === "object") murderousTd.textContent = stats.objectCount;
                            else if (targetKey === "sClass") murderousTd.textContent = stats.sClassCount;
                            else if (targetKey === "oClass") murderousTd.textContent = stats.oClassCount;
                            else if (targetKey === "stakeholder") murderousTd.textContent = stats.stakeholderCount;
                            else if (targetKey === "opinion") murderousTd.textContent = stats.opinionCount;
                            else if (targetKey === "evidence") murderousTd.textContent = stats.evidenceCount;
                            
                            // 文字の色を標準の黒（#333333）に戻す
                            murderousTd.style.color = "#333333";
                        } else {
                            /**
                             * B. 【他カテゴリの選択によって絞り込みが発生している場合】
                             * 該当カテゴリ内で、現在選択可能（共通の bindingIndexes を持つ）なアイテム数を数える
                             */
                            let availableUniqueCount = 0;
                            
                            currentList.forEach(item => {
                                const isSelected = !!activeFiltersMap[item.name];
                                const hasIntersection = item.bindingIndexes && item.bindingIndexes.some(i => intersectedIndexes.has(i));
                                
                                // すでに選択されているか、他とのつながり（交差）がある場合はカウント
                                if (isSelected || hasIntersection) {
                                    availableUniqueCount++;
                                }
                            });
                            
                            // リアルタイムに計算された動的な数値を上書き
                            murderousTd.textContent = availableUniqueCount;
                            // 絞り込まれて数値が減っていることが一目でわかるよう「赤字」にする
                            murderousTd.style.color = "#d32f2f";
                        }
                    }
                }
            });
        };

        // 「解析結果統計」の各ボタン（タブ）をクリックしたときの切り替えイベント
        statsTable.onclick = (e) => {
            const btn = e.target.closest(".stats-toggle-btn");
            if (!btn) return;

            // 他のすべてのボタンから active クラスを外し、クリックされたボタンだけに active クラスを付与
            statsTable.querySelectorAll(".stats-toggle-btn").forEach(b => b.classList.remove("active"));
            btn.classList.add("active");

            const targetKey = btn.getAttribute("data-target");
            
            // ボタンの文字列から数字や不要な記号を除去して綺麗な日本語タイトルを抽出
            const labelText = btn.textContent.replace(/[0-9()✓\s]/g, '').trim(); 

            // 右側エリアのタイトルを「〇〇一覧」に書き換える
            if (titleEl) titleEl.textContent = `${labelText.replace(/[・数]/g, '')}一覧`;
            if (noticeEl) {
                // 必要に応じてアナウンス用メッセージを入力可能（現在は空）
                noticeEl.textContent = "";
            }

            // 右側の凡例リストを選択されたカテゴリのデータに切り替えて再描画
            updateLegendTable(targetKey);
            updateTabVisualIndicators();
        };

        // 「選択をクリア」ボタンが押された時の処理
        const clearBtn = section.querySelector(".btn-clear-filters");
        if (clearBtn) {
            clearBtn.onclick = () => {
                activeFiltersMap = {}; // 選択中のフィルターをすべて初期化（空に）
                updateLegendTable(currentActiveTab); // 現在のタブの凡例を全表示に戻す
                updateTabVisualIndicators(); // 統計のカウント数をすべて初期状態の黒文字に戻す
            };
        }

        // 初期表示時、データが存在すれば「ステークホルダー数」または「主語数」をデフォルトで選択状態（クリック）にする
        const defaultBtn = statsTable.querySelector(`.stats-toggle-btn[data-target="stakeholder"]`) || statsTable.querySelector(`.stats-toggle-btn[data-target="subject"]`);
        if (defaultBtn) defaultBtn.click();
    }
}
