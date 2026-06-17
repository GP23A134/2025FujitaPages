/**
 * main.js
 * 全体のエントリーポイント。初期化、イベントリスナー、処理呼び出しの統合
 */
import { setupAccordion, updateUIControls } from 'js/UI_Controller.js';
import { extractIdFromUri, processGraphData } from 'js/dataProcessor.js';
import { showSearchIng, removeSearchIng } from 'js/domRenderer.js';

window.addEventListener('DOMContentLoaded', () => {
    if (typeof window.output_json_data !== 'undefined' && window.output_json_data !== null) {
        console.log("[CCO4KG Loader] モジュール分割版システムを読み込みました。");
        
        initDocIdDropdown();
        setupAccordion("headerOutput", "contentOutput");
        setupAccordion("headerColor", "contentColor");
        
        const targetIds = [
            "enableSubject", "enableObject", "enablePredicate", 
            "enableSClass", "enableOClass", "enableClassLink", 
            "enableStakeholder", "enableStClass", "enableEvidence"
        ];
        targetIds.forEach(id => document.getElementById(id).addEventListener("change", updateUIControls));
        
        document.getElementsByName("shColorMode").forEach(radio => {
            radio.addEventListener("change", updateUIControls);
        });
        
        document.getElementById("execBtn").addEventListener("click", handleExecConversion);
        
        updateUIControls();
        document.getElementById("execBtn").disabled = false;
    } else {
        console.error("[CCO4KG Loader] エラー: データが見つかりません。");
        const statusEl = document.getElementById("statusMessage");
        statusEl.className = "status-panel error";
        statusEl.style.display = "block";
        statusEl.textContent = "[エラー] output_CCO4KG.js からデータが見つかりません。";
    }
});

/**
 * ドキュメントIDのドロップダウン初期化
 */
function initDocIdDropdown() {
    const bindings = window.output_json_data.results.bindings;
    const selectEl = document.getElementById("targetDocId");
    const idSet = new Set();
    
    for (let i = 0; i < bindings.length; i++) {
        let binding = bindings[i];
        let rawDocUri = binding.g ? binding.g.value : (binding["?g"] ? binding["?g"].value : "");
        if (rawDocUri) idSet.add(extractIdFromUri(rawDocUri));
    }
    
    Array.from(idSet).sort().forEach(docId => {
        const option = document.createElement("option");
        option.value = docId;
        option.textContent = docId;
        selectEl.appendChild(option);
    });
}

/**
 * 変換実行ボタン押下時のハンドラ
 */
function handleExecConversion() {
    const execBtn = document.getElementById("execBtn");
    const outputContainer = document.getElementById("outputContainer");
    
    if (execBtn) execBtn.disabled = true;
    outputContainer.innerHTML = ""; 
    showSearchIng(outputContainer);

    setTimeout(() => {
        try {
            const bindings = window.output_json_data.results.bindings;
            const shEnabledRaw = document.getElementById("enableStakeholder").checked;
            const sEnabled = document.getElementById("enableSubject").checked;
            const oEnabled = document.getElementById("enableObject").checked;
            const sClassEnabled = document.getElementById("enableSClass").checked;
            const oClassEnabled = document.getElementById("enableOClass").checked;

            // UIから現在の設定パラメータオブジェクトを構築
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

            removeSearchIng();
            // データ処理専門モジュールへ仕事を委譲
            processGraphData(bindings, config);

        } catch (error) {
            removeSearchIng();
            if (error.message === "EMPTY_DATA") {
                alert("該当するデータが見つかりませんでした。");
            } else {
                console.error(error);
                alert("変換処理中にエラーが発生しました。");
            }
        } finally {
            if (execBtn) execBtn.disabled = false;
        }
    }, 50);
}
