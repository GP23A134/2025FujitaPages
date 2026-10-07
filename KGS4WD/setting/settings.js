// ========================================================================
// GUI 構築・編集・LocalStorage 保存専用処理 (settings.js)
// ========================================================================
document.addEventListener("DOMContentLoaded", () => {
    updatePreloadStatusHeader();

    const nodeTableBody = document.getElementById("guiNodeTable") ? document.getElementById("guiNodeTable").querySelector("tbody") : null;
    const ruleTableBody = document.getElementById("guiRuleTable") ? document.getElementById("guiRuleTable").querySelector("tbody") : null;

    if (!nodeTableBody || !ruleTableBody) return;

    // 1. ノード設定テーブルの初期化表示
    const savedNodesRaw = localStorage.getItem("graphNodeSettings");
    const nodeSettings = savedNodesRaw ? JSON.parse(savedNodesRaw) : CONFIG_MASTER.nodeSettings;
    
    nodeSettings.forEach(node => {
        const masterNode = CONFIG_MASTER.nodeSettings.find(n => n.id === node.id) || {};
        const bindVars = masterNode.bindVars || [];
        const label = masterNode.label || node.id; 
        
        const tr = document.createElement("tr");
        tr.dataset.id = node.id;

        let splitSelectHtml = `
            <select class="node-split">
                <option value="none">なし</option>
                <option value="number">数字 (連番)</option>
                <option value="triple">トリプルID</option>
            </select>
        `;
        if (node.id === "trId") {
            splitSelectHtml = `<span style="color:#999; font-size:12px;">対象外</span>`;
        }

        let varBadgeHtml = "";
        if (node.id === "trId") {
            varBadgeHtml = `<span class="var-badge badge-trid">trId (自動生成)</span>`;
        } else {
            bindVars.forEach(v => {
                varBadgeHtml += `<span class="var-badge badge-var">?${v}</span>`;
            });
        }

        tr.innerHTML = `
            <td class="node-label-cell"><b>${label}</b></td>
            <td>
                <div class="prefix-container">
                    <input type="text" class="node-prefix" value="${node.formatNormal ?? ''}" placeholder="例: s_" style="width: 120px;" />
                    <span style="color: #666; font-size: 14px;">＋</span>
                    ${varBadgeHtml}
                </div>
                ${masterNode.hint ? `<div style="color:#ee5d5d; font-size:11px; margin-top:4px;">※ ${masterNode.hint}</div>` : ''}
            </td>
            <td>${splitSelectHtml}</td>
        `;

        if (node.id !== "trId" && node.splitType) {
            const selectEl = tr.querySelector(".node-split");
            if (selectEl) selectEl.value = node.splitType;
        }

        nodeTableBody.appendChild(tr);
    });

    // 2. 繋がり設定テーブルの初期化表示
    const savedRulesRaw = localStorage.getItem("graphConnectionRules");
    const ruleSettings = savedRulesRaw ? JSON.parse(savedRulesRaw) : CONFIG_MASTER.defaultRules;
    
    ruleSettings.forEach(rule => {
        addRuleRow(rule);
    });

    // 新規ルールを追加ボタン
    const addRuleBtn = document.getElementById("addRuleBtn");
    if (addRuleBtn) {
        addRuleBtn.addEventListener("click", () => {
            addRuleRow({ ruleName: "", from: "sLabel", relation: "", to: "oLabel", checked: true, conditionScript: "" });
        });
    }

    // 設定を保存するボタン
    const saveSettingsBtn = document.getElementById("saveSettingsBtn");
    if (saveSettingsBtn) {
        saveSettingsBtn.addEventListener("click", () => {
            saveAllSettings();
        });
    }

    function addRuleRow(rule) {
        const tr = document.createElement("tr");
        const isChecked = rule.checked !== false;
        
        let fromOptions = "";
        let toOptions = "";
        CONFIG_MASTER.nodeSettings.forEach(n => {
            fromOptions += `<option value="${n.id}">${n.label}</option>`;
            toOptions += `<option value="${n.id}">${n.label}</option>`;
        });

        // スイッチ変数IDの挿入用補助ヘルパーの組み立て
        const switchVars = [
            { id: "enableSubject", name: "主語" },
            { id: "enablePredicate", name: "述語" },
            { id: "enableObject", name: "目的語" },
            { id: "enableSClass", name: "主語クラス" },
            { id: "enableOClass", name: "目的語クラス" },
            { id: "enableClassLink", name: "クラス間直結" },
            { id: "enableStakeholder", name: "ステークホルダー" },
            { id: "enableStClass", name: "発話者属性" },
            { id: "enableEvidence", name: "根拠" }
        ];
        let helperOptions = `<option value="">(変数IDを挿入して式を構築できます)</option>`;
        switchVars.forEach(v => {
            helperOptions += `<option value="${v.id}">${v.id} (${v.name})</option>`;
        });

        tr.innerHTML = `
            <td class="rule-check-cell"><input type="checkbox" class="rule-output-enable" ${isChecked ? 'checked' : ''} /></td>
            <td><input type="text" class="rule-name" value="${rule.ruleName ?? ''}" placeholder="自動生成されます" /></td>
            <td><select class="rule-from">${fromOptions}</select></td>
            <td><input type="text" class="rule-relation" value="${rule.relation ?? ''}" placeholder="例: pLabel" /></td>
            <td><select class="rule-to">${toOptions}</select></td>
            <td>
                <div class="script-input-container">
                    <input type="text" class="rule-script" value="${rule.conditionScript ?? ''}" placeholder="例: !enableStakeholder && enableStClass" />
                    <select class="script-helper-select">${helperOptions}</select>
                </div>
            </td>
            <td style="text-align: center;"><button class="btn btn-delete JSON-delete-btn">削除</button></td>
        `;

        const fromSelect = tr.querySelector(".rule-from");
        const toSelect = tr.querySelector(".rule-to");
        const nameInput = tr.querySelector(".rule-name");
        const scriptInput = tr.querySelector(".rule-script");
        const helperSelect = tr.querySelector(".script-helper-select");

        fromSelect.value = rule.from || "sLabel";
        toSelect.value = rule.to || "oLabel";

        const updateRuleNameAutomatically = () => {
            if (!nameInput.value || nameInput.value.includes("-") || nameInput.value === "") {
                nameInput.value = `${fromSelect.value}-${toSelect.value}`;
            }
        };

        fromSelect.addEventListener("change", updateRuleNameAutomatically);
        toSelect.addEventListener("change", updateRuleNameAutomatically);

        // スイッチ名選択時にテキストボックスへ追記するヘルパー処理
        helperSelect.addEventListener("change", () => {
            if (helperSelect.value) {
                const currentVal = scriptInput.value.trim();
                scriptInput.value = currentVal ? `${currentVal} && ${helperSelect.value}` : helperSelect.value;
                helperSelect.value = "";
            }
        });
        
        tr.querySelector(".JSON-delete-btn").addEventListener("click", () => { 
            tr.remove(); 
        });
        
        ruleTableBody.appendChild(tr);
    }

    function saveAllSettings() {
        // ノード設定の抽出保存
        const nodesToSave = [];
        nodeTableBody.querySelectorAll("tr").forEach(tr => {
            const id = tr.dataset.id;
            nodesToSave.push({
                id: id,
                formatNormal: tr.querySelector(".node-prefix").value.trim(),
                splitType: id === "trId" ? "none" : tr.querySelector(".node-split").value
            });
        });

        // 繋がりルールの抽出保存 (複雑な式文字列 conditionScript も一括格納)
        const rulesToSave = [];
        ruleTableBody.querySelectorAll("tr").forEach(tr => {
            const checked = tr.querySelector(".rule-output-enable").checked;
            const ruleName = tr.querySelector(".rule-name").value.trim();
            const from = tr.querySelector(".rule-from").value;
            const relation = tr.querySelector(".rule-relation").value.trim();
            const to = tr.querySelector(".rule-to").value;
            const conditionScript = tr.querySelector(".rule-script").value.trim();
            if (from && to) {
                rulesToSave.push({ checked, ruleName, from, relation, to, conditionScript });
            }
        });

        localStorage.setItem("graphNodeSettings", JSON.stringify(nodesToSave));
        localStorage.setItem("graphConnectionRules", JSON.stringify(rulesToSave));
        alert("詳細設定を LocalStorage に完全保存しました。\nメイン画面の変換エンジンへ動的条件が即座に反映されます。");
    }

    function updatePreloadStatusHeader() {
        const statusEl = document.getElementById("settingsDocStatus");
        if (!statusEl) return;

        if (window.output_json_data && window.output_json_data.results && window.output_json_data.results.bindings) {
            const bindings = window.output_json_data.results.bindings;
            const docIdSet = new Set();
            bindings.forEach(b => {
                const gObj = b.g || b["?g"];
                if (gObj && gObj.value) {
                    const match = gObj.value.match(/\/([^\/]+)$/);
                    if (match) docIdSet.add(match[1]);
                    else docIdSet.add(gObj.value);
                }
            });
            statusEl.style.color = "#2e7d32";
            statusEl.textContent = `データ検出完了: 計 ${bindings.length} 件のトリプル (ドキュメント: ${docIdSet.size} 個)`;
        } else {
            statusEl.style.color = "#d32f2f";
            statusEl.textContent = `事前配置データが見つかりません。マスタのみ編集可能です。`;
        }
    }
});