/**
 * ========================================================================
 * CCO4KG 変換・特定ID指定抽出ツール メインロジック（ボタンクリック実行限定版）
 * ========================================================================
 */

window.addEventListener('DOMContentLoaded', () => {
    if (typeof window.output_json_data !== 'undefined' && window.output_json_data !== null) {
        console.log("[CCO4KG Loader] ボタン実行限定・プロセスを読み込みました。");
        
        // ドキュメント識別子抽出用のドロップダウンメニューを生成
        initDocIdDropdown();
        
        // アコーディオン開閉
        setupAccordion("headerOutput", "contentOutput");
        setupAccordion("headerColor", "contentColor");
        
        // 💡 変更イベントでの自動実行を廃止し、実行ボタンのクリックのみで動作させます
        const execBtn = document.getElementById("execBtn");
        if (execBtn) {
            execBtn.disabled = false;
            execBtn.onclick = splitAndProcessData; 
        }
        
    } else {
        console.error("[CCO4KG Loader] エラー: window.output_json_data が見つかりません。");
    }
});

function setupAccordion(headerId, contentId) {
    const header = document.getElementById(headerId);
    const content = document.getElementById(contentId);
    if (!header || !content) return;
    
    header.addEventListener('click', () => {
        header.classList.toggle('active');
        if (content.style.display === 'block' || content.style.display === '') {
            content.style.display = 'none';
        } else {
            content.style.display = 'block';
        }
    });
}

function getValueFromBinding(binding, key) {
    if (!binding) return "";
    if (binding[key]) return binding[key].value || "";
    if (binding[`?${key}`]) return binding[`?${key}`].value || "";
    return "";
}

function extractIdFromUri(uri) {
    if (!uri) return "";
    const match = uri.match(/\/([^\/]+)$/);
    return match ? match[1] : uri;
}

function initDocIdDropdown() {
    const selectEl = document.getElementById("targetDocId");
    if (!selectEl) return;
    
    const bindings = window.output_json_data.results.bindings;
    if (!bindings || bindings.length === 0) return;
    
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

function showSearchIng(resultArea) {
    resultArea.innerHTML = '<div id="searching"><h2>解析中...</h2></div>';
}

function removeSearchIng() {
    const searchingEl = document.getElementById("searching");
    if (searchingEl) searchingEl.remove();
}