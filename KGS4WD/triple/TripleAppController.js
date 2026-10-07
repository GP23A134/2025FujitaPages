/**
 * 個別のドキュメントセクション（UI、グラフ、データフィルタリング）を統括するコントローラー
 */
class TripleAppController {
    constructor(parentContainerId, docId, appConfig, linesArray, viewMap) {
        this.parentContainer = typeof parentContainerId === "string" 
            ? document.getElementById(parentContainerId) || document.getElementById("outputContainer")
            : parentContainerId;
        this.docId = docId;
        this.config = appConfig;
        this.linesArray = linesArray;
        this.viewMap = viewMap;

        // セクション全体のラッパーDOM要素の作成
        this.sectionEl = document.createElement("div");
        this.sectionEl.className = "document-section-wrapper";
        this.sectionEl.style.marginBottom = "40px";
        this.parentContainer.appendChild(this.sectionEl);

        this.init();
    }

    init() {
        // 1. 各ドキュメントヘッダーや枠組みのレンダリング
        this.renderHeader();

        // 2. UIコンポーネント（統計テーブルやフィルターボタン）の構築・描画
        // ※ 以前設計した TripleUIComponent を呼び出します。
        this.uiComponent = new TripleUIComponent(this.sectionEl, this.config.stats, this);

        // 3. ネットワークグラフ表示コンポーネントの構築・描画
        // ※ 以前設計した NetworkGraphWrapper などを呼び出します。
        this.graphWrapper = new NetworkGraphWrapper(this.sectionEl, this.linesArray, this.config);
    }

    renderHeader() {
        const title = document.createElement("h3");
        title.innerText = `Document: ${this.docId}`;
        title.className = "document-section-title";
        this.sectionEl.appendChild(title);
    }

    /**
     * UI（統計テーブル）で行クリックが発生した際に、FilterLogic を介してグラフへ通知する
     */
    handleFilterChange(selectedRowData, activeFilters) {
        // 相互接続連動フィルターのロジックを実行
        const filteredLines = FilterLogic.apply(this.linesArray, activeFilters);
        
        // ネットワークグラフを更新
        this.graphWrapper.updateGraph(filteredLines);
    }
}