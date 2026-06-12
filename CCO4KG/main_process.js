/**
 * ========================================================================
 * CCO4KG 変換・特定ID指定抽出ツール メインロジック（オン/オフ完全分離・決定版）
 * ========================================================================
 */

window.addEventListener('DOMContentLoaded', () => {
    if (typeof window.output_json_data !== 'undefined' && window.output_json_data !== null) {
        console.log("[CCO4KG Loader] オン/オフ条件完全分離プロセスを読み込みました。");
        
        initDocIdDropdown();
        setupAccordion("headerOutput", "contentOutput");
        setupAccordion("headerColor", "contentColor");
        
        // --- 設定変更時のリアルタイムUI連動イベント登録 ---
        document.getElementById("enableSubject").addEventListener("change", updateUIControls);
        document.getElementById("enableObject").addEventListener("change", updateUIControls);
        document.getElementById("enablePredicate").addEventListener("change", updateUIControls);
        document.getElementById("enableSClass").addEventListener("change", updateUIControls);
        document.getElementById("enableOClass").addEventListener("change", updateUIControls);
        document.getElementById("enableClassLink").addEventListener("change", updateUIControls);
        document.getElementById("enableStakeholder").addEventListener("change", updateUIControls);
        document.getElementById("enableStClass").addEventListener("change", updateUIControls);
        document.getElementById("enableEvidence").addEventListener("change", updateUIControls);
        
        document.getElementsByName("shColorMode").forEach(radio => {
            radio.addEventListener("change", updateUIControls);
        });
        
        document.getElementById("execBtn").addEventListener("click", splitAndProcessData);

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

function setupAccordion(headerId, contentId) {
    const header = document.getElementById(headerId);
    const content = document.getElementById(contentId);
    const icon = header.querySelector(".toggle-icon");

    header.addEventListener("click", () => {
        const isOpen = content.classList.contains("open");
        if (isOpen) {
            content.classList.remove("open");
            icon.textContent = "▼";
        } else {
            content.classList.add("open");
            icon.textContent = "▲";
        }
    });
}

function updateUIControls() {
    let sEnabled = document.getElementById("enableSubject").checked;
    let oEnabled = document.getElementById("enableObject").checked;
    let pEnabled = document.getElementById("enablePredicate").checked;
    let sClassEnabled = document.getElementById("enableSClass").checked;
    let oClassEnabled = document.getElementById("enableOClass").checked;
    let classLinkEnabled = document.getElementById("enableClassLink").checked;
    
    const shEnabled = document.getElementById("enableStakeholder").checked;
    const stClassEnabled = document.getElementById("enableStClass").checked;
    const evEnabled = document.getElementById("enableEvidence").checked;
    
    const selectedMode = document.querySelector('input[name="shColorMode"]:checked')?.value || "random";
    const isFixed = (selectedMode === "select");
    const isRandom = (selectedMode === "random");

    // 【連動ルール1】主語 または 目的語 のどちらかがOFFなら、述語は強制OFF＆非活性化
    const cbPredicate = document.getElementById("enablePredicate");
    if (!sEnabled || !oEnabled) {
        cbPredicate.disabled = true;
        cbPredicate.checked = false;
        pEnabled = false;
    } else {
        cbPredicate.disabled = false;
    }

    // 【連動ルール2】sClass または oClass のどちらかがOFFなら、クラス間エッジは強制OFF＆非活性化
    const cbClassLink = document.getElementById("enableClassLink");
    if (!sClassEnabled || !oClassEnabled) {
        cbClassLink.disabled = true;
        cbClassLink.checked = false;
        classLinkEnabled = false;
    } else {
        cbClassLink.disabled = false;
    }

    const cbSoNum = document.getElementById("enableSubjectObjectNumbering");
    if (!sEnabled && !oEnabled) {
        cbSoNum.disabled = true;
        cbSoNum.checked = false;
    } else {
        cbSoNum.disabled = false;
    }

    const cpSubject = document.getElementById("cpSubject");
    cpSubject.disabled = !sEnabled;
    cpSubject.parentElement.style.opacity = sEnabled ? "1.0" : "0.3";

    const cpObject = document.getElementById("cpObject");
    cpObject.disabled = !oEnabled;
    cpObject.parentElement.style.opacity = oEnabled ? "1.0" : "0.3";

    const cpPredicate = document.getElementById("cpPredicate");
    cpPredicate.disabled = !pEnabled;
    cpPredicate.parentElement.style.opacity = pEnabled ? "1.0" : "0.3";

    const cpSClass = document.getElementById("cpSClass");
    cpSClass.disabled = !sClassEnabled;
    cpSClass.parentElement.style.opacity = sClassEnabled ? "1.0" : "0.3";

    const cpOClass = document.getElementById("cpOClass");
    cpOClass.disabled = !oClassEnabled;
    cpOClass.parentElement.style.opacity = oClassEnabled ? "1.0" : "0.3";

    const cpSClassEdge = document.getElementById("cpSClassEdge");
    cpSClassEdge.disabled = !classLinkEnabled;
    cpSClassEdge.parentElement.style.opacity = classLinkEnabled ? "1.0" : "0.3";

    document.getElementById("enableStakeholderNumbering").disabled = !shEnabled;
    document.getElementById("enableStClass").disabled = !shEnabled;
    document.getElementById("secShColor").style.opacity = shEnabled ? "1.0" : "0.3";
    document.getElementsByName("shColorMode").forEach(r => r.disabled = !shEnabled);

    const cpSh = document.getElementById("cpStakeholder");
    const fixedRow = document.getElementById("shFixedColorRow");
    if (shEnabled && isFixed) {
        cpSh.disabled = false;
        fixedRow.style.opacity = "1.0";
    } else {
        cpSh.disabled = true;
        fixedRow.style.opacity = "0.3";
    }

    const cpStC = document.getElementById("cpStClass");
    const classRow = document.getElementById("stClassColorRow");
    if (shEnabled && stClassEnabled && (isRandom || isFixed)) {
        cpStC.disabled = false;
        classRow.style.opacity = "1.0";
    } else {
        cpStC.disabled = true;
        classRow.style.opacity = "0.3";
    }

    document.getElementById("cpEvidence").disabled = !evEnabled;
    document.getElementById("secEvColor").style.opacity = evEnabled ? "1.0" : "0.3";
}

const SPEAKER_PALETTE = [
    "#FFB3BA", "#FFDFBA", "#FFFFBA", "#BAFFC9", "#BAE1FF",
    "#E8B4B8", "#F2D1B3", "#EDE8B7", "#BCE6CD", "#B5D5E6",
    "#FAD2E1", "#E2ECE9", "#BEE3DB", "#89B0A5", "#E0BBE4",
    "#957DAD", "#D291BC", "#FEC8D8", "#FFDFD3", "#D8E2DC"
];

function decodeFromUnicode(str) {
    if (!str) return "";
    return str.replace(/\\u([0-9a-fA-F]{4})/g, (match, grp) => String.fromCharCode(parseInt(grp, 16)));
}

function clean(input) {
    if (!input) return "";
    return decodeFromUnicode(input).replace(/ /g, "").replace(/@ja/g, "").replace(/"/g, "").trim();
}

function getValueFromBinding(binding, key) {
    return (binding && binding[key]) ? (binding[key].value || "") : "";
}

function extractIdFromUri(uriString) {
    if (!uriString) return "";
    const cleanUri = clean(uriString);
    const parts = cleanUri.split('/');
    return parts[parts.length - 1] || "";
}

function darkenColor(hexColor, factor) {
    if (!hexColor || !hexColor.startsWith("#") || hexColor.length !== 7) return "#adadad";
    try {
        let r = Math.max(0, Math.floor(parseInt(hexColor.substring(1, 3), 16) * factor));
        let g = Math.max(0, Math.floor(parseInt(hexColor.substring(3, 5), 16) * factor));
        let b = Math.max(0, Math.floor(parseInt(hexColor.substring(5, 7), 16) * factor));
        return `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`;
    } catch (e) { return hexColor; }
}

function initDocIdDropdown() {
    const bindings = window.output_json_data.results.bindings;
    const selectEl = document.getElementById("targetDocId");
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

function splitAndProcessData() {
    const bindings = window.output_json_data.results.bindings;
    document.getElementById("outputContainer").innerHTML = ""; 

    const shEnabledRaw = document.getElementById("enableStakeholder").checked;
    
    const sEnabled = document.getElementById("enableSubject").checked;
    const oEnabled = document.getElementById("enableObject").checked;
    const sClassEnabled = document.getElementById("enableSClass").checked;
    const oClassEnabled = document.getElementById("enableOClass").checked;

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

    let docGroups = {};
    for (let i = 0; i < bindings.length; i++) {
        let b = bindings[i];
        let docId = extractIdFromUri(getValueFromBinding(b, "g") || getValueFromBinding(b, "?g"));
        if (config.targetId !== "" && docId !== config.targetId) continue;
        let groupKey = (config.targetId === "") ? "ALL_DOCUMENTS" : docId;
        if (!docGroups[groupKey]) docGroups[groupKey] = [];
        docGroups[groupKey].push({ binding: b, originalDocId: docId });
    }

    if (Object.keys(docGroups).length === 0) {
        alert("該当するデータが見つかりませんでした。");
        return;
    }

    let globalColorCounter = 0;

    for (let groupKey in docGroups) {
        let wrappedBindings = docGroups[groupKey];
        
        const wordAppearanceMap = {}; 
        const uniqueStakeholdersInDoc = new Set(); 
        const localSpeakerColorMap = {}; 
        const localStClassColorMap = {}; 
        const finalSpeakerColorMap = {}; 
        const finalStClassColorMap = {}; 

        function getIndividualSpeakerColor(shId) {
            if (localSpeakerColorMap[shId]) return localSpeakerColorMap[shId];
            let color = SPEAKER_PALETTE[globalColorCounter % SPEAKER_PALETTE.length];
            localSpeakerColorMap[shId] = color;
            globalColorCounter++;
            return color;
        }

        function getGroupStClassColor(stClassId) {
            if (localStClassColorMap[stClassId]) return localStClassColorMap[stClassId];
            let color = SPEAKER_PALETTE[globalColorCounter % SPEAKER_PALETTE.length];
            localStClassColorMap[stClassId] = color;
            globalColorCounter++;
            return color;
        }

        function resolveColors(shId, stClassId) {
            if (config.shColorMode === "select") {
                finalSpeakerColorMap[shId] = config.cFixedSH;
                if (stClassId !== "") finalStClassColorMap[stClassId] = config.cStClass;
                return;
            }
            if (config.shColorMode === "group") {
                if (stClassId !== "") {
                    let groupColor = getGroupStClassColor(stClassId);
                    finalStClassColorMap[stClassId] = groupColor; 
                    finalSpeakerColorMap[shId] = darkenColor(groupColor, 0.85); 
                } else {
                    if (!finalSpeakerColorMap[shId]) {
                        finalSpeakerColorMap[shId] = getIndividualSpeakerColor(shId);
                    }
                }
                return;
            }
            if (config.shColorMode === "random") {
                let pColor = getIndividualSpeakerColor(shId);
                finalSpeakerColorMap[shId] = pColor;
                if (stClassId !== "") finalStClassColorMap[stClassId] = config.cStClass; 
            }
        }

        const classLinkSet = new Set();    
        const metadataLinkSet = new Set(); 
        const comboToTrMap = {};           
        let trCounter = 0;                
        let docOutputBuffer = "";          
        const stakeholderLabelMap = {}; 
        const stClassLabelMap = {};

        for (let item of wrappedBindings) {
            let b = item.binding;
            let shId      = extractIdFromUri(getValueFromBinding(b, "stakeholder"));
            let stClassId = extractIdFromUri(getValueFromBinding(b, "stClass") || getValueFromBinding(b, "?stClass"));
            let shLabel   = "sh_" + clean(getValueFromBinding(b, "stakeholderLabel"));
            let stClassLabel = "stc_" + clean(getValueFromBinding(b, "stClassLabel"));

            if (shId !== "") {
                stakeholderLabelMap[shId] = shLabel;
                if (stClassId !== "") stClassLabelMap[stClassId] = stClassLabel;
                resolveColors(shId, stClassId);
            }
        }

        for (let item of wrappedBindings) {
            let b = item.binding;
            let currentDocId = item.originalDocId; 

            let sId      = extractIdFromUri(getValueFromBinding(b, "s"));
            let sClassId = extractIdFromUri(getValueFromBinding(b, "sClass"));
            let pId      = extractIdFromUri(getValueFromBinding(b, "p"));
            let oId      = extractIdFromUri(getValueFromBinding(b, "o"));
            let oClassId = extractIdFromUri(getValueFromBinding(b, "oClass"));
            let shId     = extractIdFromUri(getValueFromBinding(b, "stakeholder"));
            let stClassId= extractIdFromUri(getValueFromBinding(b, "stClass") || getValueFromBinding(b, "?stClass"));
            let opId     = extractIdFromUri(getValueFromBinding(b, "opinion"));

            let sLabel      = "s_" + clean(getValueFromBinding(b, "sLabel"));
            let sClassLabel = "sc_" + clean(getValueFromBinding(b, "sClassLabel"));
            let pLabel      = clean(getValueFromBinding(b, "pLabel")); 
            let oLabel      = "o_" + clean(getValueFromBinding(b, "oLabel"));
            let oClassLabel = "oc_" + clean(getValueFromBinding(b, "oClassLabel"));
            let shLabel     = "sh_" + clean(getValueFromBinding(b, "stakeholderLabel"));
            let stClassLabel= "stc_" + clean(getValueFromBinding(b, "stClassLabel"));
            let opContent   = "op_" + clean(getValueFromBinding(b, "opinionContent"));
            let evContent   = "ev_" + clean(getValueFromBinding(b, "evidence"));

            if (sId === "" || oId === "") continue;

            let displaySLabel = sLabel;
            let displayOLabel = oLabel;

            let comboKey = `${currentDocId}_${sId}|${pId}|${oId}`;
            let isFirstTimeTr = false;
            if (!comboToTrMap[comboKey]) {
                comboToTrMap[comboKey] = "T" + trCounter;
                trCounter++;
                isFirstTimeTr = true; 
            }
            let trId = comboToTrMap[comboKey];

            if (config.soNum) {
                displaySLabel = `${sLabel}_${trId}`;
                displayOLabel = `${oLabel}_${trId}`;
            }

            let shNodeName = "";
            let speakerColor = config.cFixedSH;
            if (shId !== "") {
                shNodeName = shLabel;
                uniqueStakeholdersInDoc.add(shId);
                let stCount = (wordAppearanceMap[shId] || 0) + 1;
                wordAppearanceMap[shId] = stCount;
                if (config.shNum) shNodeName = `${shNodeName}_${stCount}`; 
                speakerColor = finalSpeakerColorMap[shId] || config.cFixedSH;
            }

            let prefix = (config.targetId === "") ? `${currentDocId}\t` : "";
            
            // --- ① トリプル基本構造出力セクション ---
            if (isFirstTimeTr) {
                if (config.pEnabled) {
                    docOutputBuffer += `${prefix}${displaySLabel}\t${pLabel}\t${displayOLabel}\t${config.cSubj}\t${config.cObj}\t${config.cPred}\n`;
                }

                // 【主語側の接続制御】
                if (config.sEnabled) {
                    docOutputBuffer += `${prefix}${trId}\t主語\t${displaySLabel}\t${config.cDefaultEdge}\t${config.cSubj}\t${config.cSubj}\n`;
                } else {
                    if (config.sClassEnabled && sClassId !== "") {
                        // 💡 直接接続（オフ）の時は「トリプルID（trId）」を混ぜて重複を許容する
                        let directSClassKey = `${currentDocId}_${trId}_direct_sClass_${sClassId}`;
                        if (!classLinkSet.has(directSClassKey)) {
                            classLinkSet.add(directSClassKey);
                            docOutputBuffer += `${prefix}${trId}\tsClass\t${sClassLabel}\t${config.cDefaultEdge}\t${config.cSClass}\t${config.cSClass}\n`;
                        }
                    }
                }

                // 【目的語側の接続制御】
                if (config.oEnabled) {
                    docOutputBuffer += `${prefix}${trId}\t目的語\t${displayOLabel}\t${config.cDefaultEdge}\t${config.cObj}\t${config.cObj}\n`;
                } else {
                    if (config.oClassEnabled && oClassId !== "") {
                        // 💡 直接接続（オフ）の時は「トリプルID（trId）」を混ぜて重複を許容する
                        let directOClassKey = `${currentDocId}_${trId}_direct_oClass_${oClassId}`;
                        if (!classLinkSet.has(directOClassKey)) {
                            classLinkSet.add(directOClassKey);
                            docOutputBuffer += `${prefix}${trId}\toClass\t${oClassLabel}\t${config.cDefaultEdge}\t${config.cOClass}\t${config.cOClass}\n`;
                        }
                    }
                }
            }

            // --- 本体がONのときだけ出力されるクラス所属エッジ（補助出力） ---
            if (config.sEnabled && config.sClassEnabled && sClassId !== "") {
                // 💡 通常接続（オン）の時は「displaySLabel」ベースで重複を削る（trIdを混ぜない！）
                let sClassKey = `${currentDocId}_${displaySLabel}_to_sClass_${sClassId}`;
                if (!classLinkSet.has(sClassKey)) {
                    classLinkSet.add(sClassKey);
                    docOutputBuffer += `${prefix}${displaySLabel}\tsClass\t${sClassLabel}\t${config.cSubj}\t${config.cSClass}\t${config.cSClass}\n`;
                }
            }
            if (config.oEnabled && config.oClassEnabled && oClassId !== "") {
                // 💡 通常接続（オン）の時は「displayOLabel」ベースで重複を削る（trIdを混ぜない！）
                let oClassKey = `${currentDocId}_${displayOLabel}_to_oClass_${oClassId}`;
                if (!classLinkSet.has(oClassKey)) {
                    classLinkSet.add(oClassKey);
                    docOutputBuffer += `${prefix}${displayOLabel}\toClass\t${oClassLabel}\t${config.cObj}\t${config.cOClass}\t${config.cOClass}\n`;
                }
            }

            // --- ② クラス間直結エッジ出力 ---
            if (config.classLinkEnabled && sClassId !== "" && oClassId !== "") {
                let sToOClassKey = `${currentDocId}_${sClassId}_to_${oClassId}`;
                if (!classLinkSet.has(sToOClassKey)) {
                    classLinkSet.add(sToOClassKey);
                    docOutputBuffer += `${prefix}${sClassLabel}\t-\t${oClassLabel}\t${config.cSClass}\t${config.cOClass}\t${config.cSClassEdge}\n`;
                }
            }

            // --- ③ 根拠(evidence) 出力 ---
            if (config.evEnabled && evContent !== "") {
                let safeEvContent = evContent.replace(/\n/g, " ");
                let trToEvidenceKey = `${currentDocId}_${trId}_evidence_${safeEvContent}`;
                if (!metadataLinkSet.has(trToEvidenceKey)) {
                    metadataLinkSet.add(trToEvidenceKey);
                    docOutputBuffer += `${prefix}${trId}\tevidence\t${safeEvContent}\t${config.cDefaultEdge}\t${config.cEv}\t${config.cEv}\n`;
                }
            }

            // --- ④ ステークホルダー・意見出力 ---
            if (config.shEnabled && opId !== "") {
                let opinionNodeName = opContent;
                let opinionColor = darkenColor(speakerColor, 0.80); 
                
                let trToOpinionKey = `${currentDocId}_${trId}_instance_${opId}`;
                if (!metadataLinkSet.has(trToOpinionKey)) {
                    metadataLinkSet.add(trToOpinionKey);
                    docOutputBuffer += `${prefix}${opinionNodeName}\t意見\t${trId}\t${opinionColor}\t${config.cDefaultEdge}\t${config.cDefaultEdge}\n`;
                }

                if (shId !== "") {
                    let opinionToSpeakerKey = `${currentDocId}_${opId}_speaker_${shId}`;
                    if (!metadataLinkSet.has(opinionToSpeakerKey)) {
                        metadataLinkSet.add(opinionToSpeakerKey);
                        docOutputBuffer += `${prefix}${opinionNodeName}\tステークホルダー\t${shNodeName}\t${opinionColor}\t${speakerColor}\t${speakerColor}\n`;
                    }

                    if (config.stClass && stClassId !== "") {
                        let currentStClassColor = finalStClassColorMap[stClassId] || config.cStClass;
                        let stClassKey = `${currentDocId}_${shNodeName}_stClass_${stClassId}`;
                        
                        if (!classLinkSet.has(stClassKey)) {
                            classLinkSet.add(stClassKey);
                            docOutputBuffer += `${prefix}${shNodeName}\tstClass\t${stClassLabel}\t${speakerColor}\t${currentStClassColor}\t${currentStClassColor}\n`;
                        }
                    }
                }
            }
        }
        
        const readableLegendColorMap = {};
        if (config.shColorMode === "group") {
            Object.keys(finalStClassColorMap).forEach(stClassId => {
                const className = stClassLabelMap[stClassId] || "不明な分類";
                readableLegendColorMap[`【原色】${className}`] = finalStClassColorMap[stClassId];
            });
        } else {
            Object.keys(finalSpeakerColorMap).forEach(shId => {
                const shName = stakeholderLabelMap[shId] || "不明なステークホルダー";
                readableLegendColorMap[`【個人】${shName}`] = finalSpeakerColorMap[shId];
            });
        }
        let displayTitleId = (groupKey === "ALL_DOCUMENTS") ? "すべてのドキュメント（一括出力）" : groupKey;
        createDocumentSection(displayTitleId, docOutputBuffer, trCounter, uniqueStakeholdersInDoc.size, readableLegendColorMap);
    }
}

function createDocumentSection(docId, textContent, tripleCount, stakeholderCount, speakerColorMap) {
    const container = document.getElementById("outputContainer");

    const section = document.createElement("div");
    section.className = "doc-section";

    const header = document.createElement("div");
    header.className = "doc-header";

    const title = document.createElement("div");
    title.className = "doc-title";
    title.textContent = `出力モード: ${docId}`;

    const actions = document.createElement("div");
    actions.className = "doc-actions";

    const copyBtn = document.createElement("button");
    copyBtn.className = "btn-small btn-copy-small";
    copyBtn.textContent = "このデータをコピー";
    copyBtn.onclick = () => {
        textarea.select();
        document.execCommand("copy");
        alert(`${docId} のデータをコピーしました。`);
    };

    actions.appendChild(copyBtn);
    header.appendChild(title);
    header.appendChild(actions);
    section.appendChild(header);

    const mainContent = document.createElement("div");
    mainContent.className = "doc-main-content";

    const sidePanel = document.createElement("div");
    sidePanel.className = "doc-side-panel";

    const metaBadge = document.createElement("div");
    metaBadge.className = "doc-meta-badge";
    metaBadge.innerHTML = `総トリプル数: ${tripleCount}<br>総ステークホルダー数: ${stakeholderCount}`;
    sidePanel.appendChild(metaBadge);

    const innerLegend = document.createElement("div");
    innerLegend.className = "doc-inner-legend";

    const legendTitle = document.createElement("div");
    legendTitle.className = "doc-inner-legend-title";
    legendTitle.textContent = "配色凡例サンプル";
    innerLegend.appendChild(legendTitle);

    const legendContainer = document.createElement("div");
    legendContainer.className = "doc-inner-legend-container";

    const speakerKeys = Object.keys(speakerColorMap);
    if (speakerKeys.length > 0) {
        speakerKeys.forEach(name => {
            const color = speakerColorMap[name];
            
            const item = document.createElement("div");
            item.className = "doc-legend-item";

            const colorBox = document.createElement("div");
            colorBox.className = "doc-legend-color";
            colorBox.style.backgroundColor = color; 

            const text = document.createElement("span");
            text.textContent = `${name}`;

            item.appendChild(colorBox);
            item.appendChild(text);
            legendContainer.appendChild(item);
        });
    } else {
        const noDataText = document.createElement("span");
        noDataText.className = "no-data-text";
        noDataText.textContent = "対象 of 未検出";
        legendContainer.appendChild(noDataText);
    }

    innerLegend.appendChild(legendContainer);
    sidePanel.appendChild(innerLegend);
    mainContent.appendChild(sidePanel);

    const textPanel = document.createElement("div");
    textPanel.className = "doc-text-panel";

    const textarea = document.createElement("textarea");
    textarea.readOnly = true;
    textarea.value = textContent;
    
    textPanel.appendChild(textarea);
    mainContent.appendChild(textPanel);

    section.appendChild(mainContent);
    container.appendChild(section);
}