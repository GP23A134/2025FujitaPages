/**
 * 詳細ダイアログの開閉と、一覧から詳細を選ぶダイアログを担当する。
 * 内容の組み立ては triple_detail_view.js、一覧の描画は views.js に分離する。
 */

// ダイアログを閉じたら、関連トリプルの閲覧状態を次回表示用に初期化する。
document.addEventListener("DOMContentLoaded", () => {
  const details = document.getElementById("detailDialog");
  if (!details) return;
  details.addEventListener("close", () => {
    if (typeof resetVisitedTriples === "function") resetVisitedTriples();
  });
});

function showDetails(tripleId) {
  const item = getDetailData().find(data => String(data.triple.tplId) === String(tripleId));
  if (!item) return;

  const details = document.getElementById("detailDialog");
  details.querySelector(".detail-content").innerHTML = createDetailContent(item);
  details.showModal();
}
