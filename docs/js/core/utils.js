// 動的に生成するHTMLへ埋め込む値を安全な文字列へ変換する。
const HTML_ESCAPE_MAP = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" };

// HTMLとして解釈される文字をエスケープする。
function escapeHtml(value) {
  return String(value || "").replace(/[&<>"']/g, character => HTML_ESCAPE_MAP[character]);
}

// 表記ゆれを吸収するため、比較用の文字列を正規化する。
function normalize(value) {
  return String(value || "").toLowerCase().replace(/\s+/g, " ").trim();
}

// 空文字を除き、大文字小文字や連続した空白を無視して比較する。
function isSameValue(firstValue, secondValue) {
  return Boolean(normalize(secondValue)) && normalize(firstValue) === normalize(secondValue);
}

// 複数の候補名を順に確認し、最初に見つかった値を文字列として返す。
function getField(row, fieldNames) {
  const names = Array.isArray(fieldNames) ? fieldNames : [fieldNames];
  for (const name of names) {
    const value = row?.[name];
    if (value != null) return typeof value === "object" ? value.value || "" : String(value);
  }
  return "";
}
