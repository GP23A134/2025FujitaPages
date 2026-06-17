/**
 * ========================================================================
 * CCO4KG 変換・特定ID指定抽出ツール メインロジック（ローカル連携・相互ロック版）
 * ========================================================================
 */

// ------------------------------------------------------------------------
// 1. 画面初期化 ＆ イベントリスナー登録
// ------------------------------------------------------------------------
window.addEventListener('DOMContentLoaded', () => {
    if (typeof window.output_json_data !== 'undefined' && window.output_json_data !== null) {
        console.log("[CCO4KG Loader] 相互ロック・カテゴリカラー対応版プロセスを読み込みました。");
        
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
        
        document.getElementById("execBtn").addEventListener("click", splitAndProcessData);
        updateUIControls();
        document.getElementById("execBtn").disabled = false;
    } else {
        console.error("[CCO4KG Loader] エラー: データが見つかりません。");
        const statusEl = document.getElementById("statusMessage");
        if (statusEl) {
            statusEl.className = "status-panel error";
            statusEl.style.display = "block";
            statusEl.textContent = "[エラー] output_CCO4KG.js からデータが見つかりません。";
        }
    }
});

function setupAccordion(headerId, contentId) {
    const header = document.getElementById(headerId);
    const content = document.getElementById(contentId);
    const icon = header ? header.querySelector(".toggle-icon") : null;
    if (!header || !content) return;

    header.addEventListener("click", () => {
        const isOpen = content.classList.contains("open");
        if (isOpen) {
            content.classList.remove("open");
            if (icon) icon.textContent = "▼";
        } else {
            content.classList.add("open");
            if (icon) icon.textContent = "▲";
        }
    });
}

// ------------------------------------------------------------------------
// 2. 設定パネルの有効・無効リアクティブ制御 (UI連動)
// ------------------------------------------------------------------------
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

    const cbPredicate = document.getElementById("enablePredicate");
    if (!sEnabled || !oEnabled) {
        cbPredicate.disabled = true;
        cbPredicate.checked = false;
        pEnabled = false;
    } else {
        cbPredicate.disabled = false;
    }

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

    const toggleElementPalette = (id, enabled) => {
        const el = document.getElementById(id);
        if (!el) return;
        el.disabled = !enabled;
        el.parentElement.style.opacity = enabled ? "1.0" : "0.3";
    };

    toggleElementPalette("cpSubject", sEnabled);
    toggleElementPalette("cpObject", oEnabled);
    toggleElementPalette("cpPredicate", pEnabled);
    toggleElementPalette("cpSClass", sClassEnabled);
    toggleElementPalette("cpOClass", oClassEnabled);
    toggleElementPalette("cpSClassEdge", classLinkEnabled);

    document.getElementById("enableStakeholderNumbering").disabled = !shEnabled;
    document.getElementById("enableStClass").disabled = !shEnabled;
    document.getElementById("secShColor").style.opacity = shEnabled ? "1.0" : "0.3";
    document.getElementsByName("shColorMode").forEach(r => r.disabled = !shEnabled);

    const selectedMode = document.querySelector('input[name="shColorMode"]:checked')?.value || "random";
    const isFixed = (selectedMode === "select");
    const isRandom = (selectedMode === "random");

    toggleElementPalette("cpStakeholder", shEnabled && isFixed);
    document.getElementById("shFixedColorRow").style.opacity = (shEnabled && isFixed) ? "1.0" : "0.3";

    const stClassActive = shEnabled && stClassEnabled && (isRandom || isFixed);
    toggleElementPalette("cpStClass", stClassActive);
    document.getElementById("stClassColorRow").style.opacity = stClassActive ? "1.0" : "0.3";

    toggleElementPalette("cpEvidence", evEnabled);
    document.getElementById("secEvColor").style.opacity = evEnabled ? "1.0" : "0.3";
}

// ------------------------------------------------------------------------
// 3. データ処理ユーティリティ
// ------------------------------------------------------------------------
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
    if (!selectEl) return;
    
    selectEl.innerHTML = '<option value="">-- すべてのドキュメント (一括出力) --</option>';
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
    const orgDiv = resultArea.innerHTML;
    resultArea.innerHTML = orgDiv + '<div id="searching"><h2>解析中...</h2>'
       + '<div class="flower-spinner"><div class="dots-container">'
       + '<div class="bigger-dot"><div class="smaller-dot"></div>'
       + '</div></div></div><br></div>';
}

function removeSearchIng() {
    const searchingDiv = document.getElementById("searching");
    if (searchingDiv != null) searchingDiv.remove();
}

// ------------------------------------------------------------------------
// 4. メイン変換処理 ＆ 相互接続連動フィルタ
// ------------------------------------------------------------------------
function splitAndProcessData() {
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
                docGroups[groupKey].push({ binding: b, originalDocId: docId, lineIndex: i });
            }

            if (Object.keys(docGroups).length === 0) {
                removeSearchIng();
                alert("該当するデータが見つかりませんでした。");
                if (execBtn) execBtn.disabled = false;
                return;
            }

            let globalColorCounter = 0;
            removeSearchIng();

            for (let groupKey in docGroups) {
                let wrappedBindings = docGroups[groupKey];
                
                const wordAppearanceMap = {}; 
                const localSpeakerColorMap = {}; 
                const localStClassColorMap = {}; 
                const finalSpeakerColorMap = {}; 
                const finalStClassColorMap = {}; 

                const uniqueSubjects = new Set();
                const uniqueObjects = new Set();
                const uniqueSClasses = new Set();
                const uniqueOClasses = new Set();
                const uniqueStakeholders = new Set();
                const uniqueOpinions = new Set();
                const uniqueEvidences = new Set();
                const uniqueTriples = new Set();
                const tripleLabelMap = {};

                const bindingIndexesMap = {
                    triple: {}, subject: {}, object: {}, sClass: {}, oClass: {}, stakeholder: {}, opinion: {}, evidence: {}
                };

                const jsonCountMap = {
                    stakeholder: {}, subject: {}, object: {}, sClass: {}, oClass: {}, evidence: {}, opinion: {}, triple: {}
                };

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
                        } else if (!finalSpeakerColorMap[shId]) {
                            finalSpeakerColorMap[shId] = getIndividualSpeakerColor(shId);
                        }
                        return;
                    }
                    if (config.shColorMode === "random") {
                        finalSpeakerColorMap[shId] = getIndividualSpeakerColor(shId);
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
                    let shId = extractIdFromUri(getValueFromBinding(b, "stakeholder"));
                    let stClassId = extractIdFromUri(getValueFromBinding(b, "stClass") || getValueFromBinding(b, "?stClass"));
                    let cleanShName = clean(getValueFromBinding(b, "stakeholderLabel"));
                    
                    if (/^(【個人】|個人|)$/.test(cleanShName)) continue;

                    let shLabel = "st_" + cleanShName;
                    let stClassLabel = "stc_" + clean(getValueFromBinding(b, "stClassLabel"));
                    if (shId !== "") {
                        stakeholderLabelMap[shId] = shLabel;
                        if (stClassId !== "") stClassLabelMap[stClassId] = stClassLabel;
                        if (!finalSpeakerColorMap[shId]) resolveColors(shId, stClassId);
                    }
                }
                
                const legendDisplayColorMap = {};
                const shExactCountMap = {};

                const pushIndex = (category, key, idx) => {
                    if (!key) return;
                    if (!bindingIndexesMap[category][key]) bindingIndexesMap[category][key] = [];
                    if (!bindingIndexesMap[category][key].includes(idx)) {
                        bindingIndexesMap[category][key].push(idx);
                    }
                };

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
                    let evContent = "ev_" + evContentRaw;

                    if (sId === "" || oId === "") continue;

                    let comboKeyForId = `${currentDocId}_${sId}|${pId}|${oId}`;
                    let isFirstTimeTr = false;
                    
                    if (!comboToTrMap[comboKeyForId]) {
                        comboToTrMap[comboKeyForId] = "T" + trCounter;
                        trCounter++;
                        isFirstTimeTr = true; 
                    }
                    let trId = comboToTrMap[comboKeyForId]; 

                    let tripleMapKey = `${sLabelRaw} | ${pLabel} | ${oLabelRaw}`;
                    let tripleDisplayLabel = `${trId}_${sLabelRaw}_${pLabel}_${oLabelRaw}`; 

                    uniqueTriples.add(tripleMapKey);
                    tripleLabelMap[tripleMapKey] = tripleDisplayLabel;
                    jsonCountMap.triple[tripleMapKey] = (jsonCountMap.triple[tripleMapKey] || 0) + 1;
                    pushIndex("triple", tripleDisplayLabel, curIdx);

                    if (sId !== "") {
                        uniqueSubjects.add(sLabel);
                        jsonCountMap.subject[sLabel] = (jsonCountMap.subject[sLabel] || 0) + 1;
                        pushIndex("subject", sLabel, curIdx);
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
                        
                        shExactCountMap[shLabel_cleansed] = (shExactCountMap[shLabel_cleansed] || 0) + 1;
                        jsonCountMap.stakeholder[shNodeName] = (jsonCountMap.stakeholder[shNodeName] || 0) + 1;
                        pushIndex("stakeholder", shLabel_cleansed, curIdx);

                        if (opContentRaw) {
                            uniqueOpinions.add(opContentRaw);
                            jsonCountMap.opinion[opContentRaw] = (jsonCountMap.opinion[opContentRaw] || 0) + 1;
                            pushIndex("opinion", opContentRaw, curIdx);
                        }

                        if (config.shColorMode === "group") {
                            const className = stClassLabelMap[stClassId] || "不明な分類";
                            legendDisplayColorMap[`stClass_${stClassId}`] = { name: `【分類】${className}`, color: finalStClassColorMap[stClassId], uri: sClassUri };
                        }
                        legendDisplayColorMap[`sh_${shId}`] = { name: `${shLabel_cleansed}`, color: speakerColor, uri: shUri };
                    }

                    let prefix = (config.targetId === "") ? `${currentDocId}\t` : "";

                    if (isFirstTimeTr) {
                        if (config.pEnabled) {
                            docOutputBuffer += `${prefix}${displaySLabel}\t${pLabel}\t${displayOLabel}\t${config.cSubj}\t${config.cObj}\t${config.cPred}\n`;
                        }
                        if (config.sEnabled) {
                            docOutputBuffer += `${prefix}${trId}\t主語\t${displaySLabel}\t${config.cDefaultEdge}\t${config.cSubj}\t${config.cSubj}\n`;
                        } else if (config.sClassEnabled && sClassId !== "" && sClassLabelRaw) {
                            let directSClassKey = `${currentDocId}_${trId}_direct_sClass_${sClassId}`;
                            if (!classLinkSet.has(directSClassKey)) {
                                classLinkSet.add(directSClassKey);
                                docOutputBuffer += `${prefix}${trId}\tsClass\t${sClassLabel}\t${config.cDefaultEdge}\t${config.cSClass}\t${config.cSClass}\n`;
                            }
                        }
                        if (config.oEnabled) {
                            docOutputBuffer += `${prefix}${trId}\t目的語\t${displayOLabel}\t${config.cDefaultEdge}\t${config.cObj}\t${config.cObj}\n`;
                        } else if (config.oClassEnabled && oClassId !== "" && oClassLabelRaw) {
                            let directOClassKey = `${currentDocId}_${trId}_direct_oClass_${oClassId}`;
                            if (!classLinkSet.has(directOClassKey)) {
                                classLinkSet.add(directOClassKey);
                                docOutputBuffer += `${prefix}${trId}\toClass\t${ocLabel}\t${config.cDefaultEdge}\t${config.cOClass}\t${config.cOClass}\n`;
                            }
                        }
                    }

                    if (config.sEnabled && config.sClassEnabled && sClassId !== "" && sClassLabelRaw) {
                        let scKey = `${currentDocId}_${sId}_${sClassId}`;
                        if (!classLinkSet.has(scKey)) {
                            classLinkSet.add(scKey);
                            docOutputBuffer += `${prefix}${displaySLabel}\tsClass\t${sClassLabel}\t${config.cDefaultEdge}\t${config.cSClass}\t${config.cSClass}\n`;
                        }
                    }
                    if (config.oEnabled && config.oClassEnabled && oClassId !== "" && oClassLabelRaw) {
                        let ocKey = `${currentDocId}_${oId}_${oClassId}`;
                        if (!classLinkSet.has(ocKey)) {
                            classLinkSet.add(ocKey);
                            docOutputBuffer += `${prefix}${displayOLabel}\toClass\t${ocLabel}\t${config.cDefaultEdge}\t${config.cOClass}\t${config.cOClass}\n`;
                        }
                    }
                    if (config.classLinkEnabled && sClassId !== "" && sClassLabelRaw && oClassId !== "" && oClassLabelRaw) {
                        let linkKey = `${currentDocId}_${sClassId}_${oClassId}`;
                        if (!classLinkSet.has(linkKey)) {
                            classLinkSet.add(linkKey);
                            docOutputBuffer += `${prefix}${sClassLabel}\tclassLink\t${ocLabel}\t${config.cSClassEdge}\t${config.cSClass}\t${config.cOClass}\n`;
                        }
                    }

                    if (shId !== "" && shLabelRaw) {
                        let shMetaKey = `${currentDocId}_${trId}_${shNodeName}`;
                        if (!metadataLinkSet.has(shMetaKey)) {
                            metadataLinkSet.add(shMetaKey);
                            docOutputBuffer += `${prefix}${trId}\t発話者\t${shNodeName}\t${config.cDefaultEdge}\t${speakerColor}\t${speakerColor}\n`;
                        }
                        
                        if (config.stClass && stClassId !== "" && stClassLabelRaw) {
                            let stcKey = `${currentDocId}_${shNodeName}_${stClassId}`;
                            if (!classLinkSet.has(stcKey)) {
                                classLinkSet.add(stcKey);
                                let classColor = finalStClassColorMap[stClassId] || config.cStClass;
                                docOutputBuffer += `${prefix}${shNodeName}\t所属\t${stClassLabel}\t${config.cDefaultEdge}\t${classColor}\t${classColor}\n`;
                            }
                        }
                        if (opContentRaw) {
                            let opMetaKey = `${currentDocId}_${shNodeName}_opinion_${opId}`;
                            if (!metadataLinkSet.has(opMetaKey)) {
                                metadataLinkSet.add(opMetaKey);
                                docOutputBuffer += `${prefix}${shNodeName}\t意見\t${opContentRaw}\t${config.cDefaultEdge}\t#f0f0f0\t#f0f0f0\n`;
                            }
                        }
                    }

                    if (config.evEnabled && evContentRaw !== "") {
                        let evMetaKey = `${currentDocId}_${trId}_evidence_${evContent}`;
                        if (!metadataLinkSet.has(evMetaKey)) {
                            metadataLinkSet.add(evMetaKey);
                            docOutputBuffer += `${prefix}${trId}\t根拠\t${evContent}\t${config.cDefaultEdge}\t${config.cEv}\t${config.cEv}\n`;
                        }
                    }
                }

                const createSortedObjList = (setObj, countSubMap, categoryKey) => {
                    return Array.from(setObj).map(item => {
                        let rawName = item;
                        if (categoryKey === "triple") rawName = tripleLabelMap[item] || item;
                        
                        let baseColor = null;
                        if (categoryKey === "subject") baseColor = config.cSubj;
                        if (categoryKey === "object") baseColor = config.cObj;
                        if (categoryKey === "sClass") baseColor = config.cSClass;
                        if (categoryKey === "oClass") baseColor = config.cOClass;
                        if (categoryKey === "evidence") baseColor = config.cEv;
                        
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
                        triple: config.cPred,
                        subject: config.cSubj,
                        object: config.cObj,
                        sClass: config.cSClass,
                        oClass: config.cOClass,
                        stakeholder: config.cFixedSH, 
                        opinion: "#f0f0f0",
                        evidence: config.cEv
                    },
                    tripleCount: uniqueTriples.size,
                    subjectCount: uniqueSubjects.size,
                    objectCount: uniqueObjects.size,
                    sClassCount: uniqueSClasses.size,
                    oClassCount: uniqueOClasses.size,
                    stakeholderCount: Object.keys(shExactCountMap).length,
                    opinionCount: uniqueOpinions.size,
                    evidenceCount: uniqueEvidences.size,
                    lists: {
                        triple: createSortedObjList(uniqueTriples, jsonCountMap.triple, "triple"),
                        subject: createSortedObjList(uniqueSubjects, jsonCountMap.subject, "subject"),
                        object: createSortedObjList(uniqueObjects, jsonCountMap.object, "object"),
                        sClass: createSortedObjList(uniqueSClasses, jsonCountMap.sClass, "sClass"),
                        oClass: createSortedObjList(uniqueOClasses, jsonCountMap.oClass, "oClass"),
                        stakeholder: createSortedObjList(Object.keys(shExactCountMap), shExactCountMap, "stakeholder"),
                        opinion: createSortedObjList(uniqueOpinions, jsonCountMap.opinion, "opinion"),
                        evidence: createSortedObjList(uniqueEvidences, jsonCountMap.evidence, "evidence")
                    }
                };

                createDocumentSection(groupKey, docOutputBuffer, stats);
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
// 5. レンダラー＆相互連動型リストフィルタ（テキストエリア非連動）
// ------------------------------------------------------------------------
function createDocumentSection(docId, textContent, stats) {
    const container = document.getElementById("outputContainer");
    if (!container) return;
    const isAllDoc = (docId === "ALL_DOCUMENTS");

    const section = document.createElement("div");
    section.className = "doc-section";

    const textarea = document.createElement("textarea");
    textarea.readOnly = true;
    textarea.value = textContent; 

    section.innerHTML = `
        <div class="doc-header">
            <div class="doc-title">${isAllDoc ? '出力モード: 一括出力' : `出力モード: ${docId}`}</div>
            <div class="doc-actions">
                ${!isAllDoc ? `<button class="btn-small btn-clear-filters" style="background-color: #6c757d; color: white; border: none; margin-right: 8px; cursor: pointer; border-radius: 4px; padding: 6px 12px; font-weight: bold;">選択をクリア</button>` : ''}
                <button class="btn-small btn-copy-small">このデータをコピー</button>
            </div>
        </div>
        <div class="doc-main-content">
            <div class="doc-side-panel">
                <div class="doc-meta-badge">
                    <b class="badge-main-title">解析結果統計</b>
                    <table class="stats-table">
                        <tr><td><button class="stats-toggle-btn" data-target="triple"><span class="cat-color-badge" style="background-color:${stats.configColors.triple};"></span>トリプル数</button></td><td>${stats.tripleCount}</td></tr>
                        <tr><td><button class="stats-toggle-btn" data-target="subject"><span class="cat-color-badge" style="background-color:${stats.configColors.subject};"></span>主語数</button></td><td>${stats.subjectCount}</td></tr>
                        <tr><td><button class="stats-toggle-btn" data-target="object"><span class="cat-color-badge" style="background-color:${stats.configColors.object};"></span>目的語数</button></td><td>${stats.objectCount}</td></tr>
                        <tr><td><button class="stats-toggle-btn" data-target="sClass"><span class="cat-color-badge" style="background-color:${stats.configColors.sClass};"></span>主語クラス数</button></td><td>${stats.sClassCount}</td></tr>
                        <tr><td><button class="stats-toggle-btn" data-target="oClass"><span class="cat-color-badge" style="background-color:${stats.configColors.oClass};"></span>目的語クラス数</button></td><td>${stats.oClassCount}</td></tr>
                        <tr><td><button class="stats-toggle-btn" data-target="stakeholder"><span class="cat-color-badge" style="background-color:${stats.configColors.stakeholder};"></span>ステークホルダー数</button></td><td>${stats.stakeholderCount}</td></tr>
                        <tr><td><button class="stats-toggle-btn" data-target="opinion"><span class="cat-color-badge" style="background-color:${stats.configColors.opinion};"></span>意見数</button></td><td>${stats.opinionCount}</td></tr>
                        <tr><td><button class="stats-toggle-btn" data-target="evidence"><span class="cat-color-badge" style="background-color:${stats.configColors.evidence};"></span>根拠数</button></td><td>${stats.evidenceCount}</td></tr>
                    </table>
                    
                    ${!isAllDoc ? `
                        <hr class="badge-divider">
                        <b id="legend-current-title-${docId}" class="badge-sub-title">一覧</b>
                        <span id="legend-notice-${docId}" style="font-size:0.8em; color:#2196F3; display:block; margin-bottom:8px; font-weight:bold;"></span>
                        <div class="legend-scroll-container">
                            <table id="dynamic-legend-table-${docId}" class="dynamic-legend-table"></table>
                        </div>
                    ` : ''}
                </div>
            </div>
            <div class="doc-text-panel"></div>
        </div>
    `;

    section.querySelector(".doc-text-panel").appendChild(textarea);
    
    section.querySelector(".btn-copy-small").onclick = () => {
        navigator.clipboard.writeText(textarea.value).then(() => alert("データをコピーしました。"));
    };

    container.appendChild(section);

    if (!isAllDoc) {
        const legendTable = document.getElementById(`dynamic-legend-table-${docId}`);
        const titleEl = document.getElementById(`legend-current-title-${docId}`);
        const noticeEl = document.getElementById(`legend-notice-${docId}`);
        const statsTable = section.querySelector(".stats-table");
        
        let activeFiltersMap = {}; 
        let currentActiveTab = ""; 

        const getIntersectedIndexes = () => {
            const filterItems = Object.values(activeFiltersMap);
            if (filterItems.length === 0) return null;

            let intersected = null;
            filterItems.forEach(item => {
                const idxSet = new Set(item.bindingIndexes || []);
                if (intersected === null) {
                    intersected = idxSet;
                } else {
                    intersected = new Set([...intersected].filter(x => idxSet.has(x)));
                }
            });
            return intersected;
        };

        const updateTabVisualIndicators = () => {
            const intersectedIndexes = getIntersectedIndexes();

            statsTable.querySelectorAll(".stats-toggle-btn").forEach(btn => {
                // ボタンのdata-target属性から確実にカテゴリ名（"triple", "subject"等）を取得
                const targetKey = btn.getAttribute("data-target");
                if (!targetKey) return;
                
                // 1. 選択バッジの更新 (✓がついている選択中アイテム数)
                const activeCount = Object.values(activeFiltersMap).filter(item => item.category === targetKey).length;
                const oldBadge = btn.querySelector(".tab-badge");
                if (oldBadge) oldBadge.remove();

                if (activeCount > 0) {
                    const badge = document.createElement("span");
                    badge.className = "tab-badge";
                    badge.textContent = `${activeCount}`;
                    btn.appendChild(badge);
                }

                // 2. 解析結果統計のカウント数(右側の列)を動的に変化させる
                const row = btn.closest("tr");
                if (row) {
                    const murderousTd = row.cells[1]; // 右側の数値が入っている td 要素
                    if (murderousTd) {
                        const currentList = stats.lists[targetKey] || [];
                        
                        if (intersectedIndexes === null) {
                            // 【確実な判定に修正】ボタンのテキストに依存せず、targetKeyの値で直接初期の総数をセット
                            if (targetKey === "triple") murderousTd.textContent = stats.tripleCount;
                            else if (targetKey === "subject") murderousTd.textContent = stats.subjectCount;
                            else if (targetKey === "object") murderousTd.textContent = stats.objectCount;
                            else if (targetKey === "sClass") murderousTd.textContent = stats.sClassCount;
                            else if (targetKey === "oClass") murderousTd.textContent = stats.oClassCount;
                            else if (targetKey === "stakeholder") murderousTd.textContent = stats.stakeholderCount;
                            else if (targetKey === "opinion") murderousTd.textContent = stats.opinionCount;
                            else if (targetKey === "evidence") murderousTd.textContent = stats.evidenceCount;
                            
                            // 通常の文字色(黒)に戻す
                            murderousTd.style.color = "#333333";
                        } else {
                            // 絞り込みが発生している場合：
                            // 該当カテゴリのリスト内で、現在選択可能（共通の bindingIndexes を持つ）なアイテム数を計算
                            let availableUniqueCount = 0;
                            currentList.forEach(item => {
                                const isSelected = !!activeFiltersMap[item.name];
                                const hasIntersection = item.bindingIndexes && item.bindingIndexes.some(i => intersectedIndexes.has(i));
                                
                                if (isSelected || hasIntersection) {
                                    availableUniqueCount++;
                                }
                            });
                            
                            // 計算された動的な数値を上書き
                            murderousTd.textContent = availableUniqueCount;
                            // 絞り込み中は赤字にする
                            murderousTd.style.color = "#d32f2f";
                        }
                    }
                }
            });
        };

            // 1. 選択中を上、2. 選択可能（件数 > 0）を中、3. 選択不可（件数 == 0）を下、の順にソート
            processedList.sort((a, b) => {
                if (a.isSelected !== b.isSelected) return a.isSelected ? -1 : 1;
                const aAvailable = a.displayCount > 0;
                const bAvailable = b.displayCount > 0;
                if (aAvailable !== bAvailable) return aAvailable ? -1 : 1;
                return b.displayCount - a.displayCount;
            });

            // HTMLの生成
            // HTMLの生成
            legendTable.innerHTML = processedList.map((item, index) => {
                // 絞り込みが発生している（intersectedIndexesがある）かつ 未選択 の場合、件数を「赤字」にするクラス・スタイル
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

            // クリックイベントと不活性（件数0）の制御
            const rows = legendTable.querySelectorAll(".filter-trigger-row");
            rows.forEach(row => {
                const idx = parseInt(row.getAttribute("data-index"), 10);
                const item = processedList[idx];
                if (!item) return;

                // 選択可能な件数が 0件 のものは不活性（薄暗くしてクリック不可）にする
                if (item.displayCount > 0 || item.isSelected) {
                    row.style.opacity = "1";
                    row.style.pointerEvents = "auto";
                } else {
                    row.style.opacity = "0.25"; 
                    row.style.pointerEvents = "none";
                }

                row.onclick = () => {
                    const clickedValue = row.getAttribute("data-value");

                    if (activeFiltersMap[clickedValue]) {
                        delete activeFiltersMap[clickedValue]; 
                    } else {
                        // 元のフルリストから bindingIndexes を復元して保存
                        const originalItem = currentList.find(c => c.name === clickedValue);
                        activeFiltersMap[clickedValue] = { 
                            ...originalItem, 
                            category: targetKey 
                        }; 
                    }

                    updateLegendTable(targetKey); 
                    updateTabVisualIndicators(); 
                };
            });
        };

        const updateTabVisualIndicators = () => {
            const intersectedIndexes = getIntersectedIndexes();

            statsTable.querySelectorAll(".stats-toggle-btn").forEach(btn => {
                const targetKey = btn.getAttribute("data-target");
                
                // 1. 選択バッジの更新 (✓がついている選択中アイテム数)
                const activeCount = Object.values(activeFiltersMap).filter(item => item.category === targetKey).length;
                const oldBadge = btn.querySelector(".tab-badge");
                if (oldBadge) oldBadge.remove();

                if (activeCount > 0) {
                    const badge = document.createElement("span");
                    badge.className = "tab-badge";
                    badge.textContent = `${activeCount}`;
                    btn.appendChild(badge);
                }

                // 2. ★新規追加：解析結果統計のカウント数(右側の列)を絞り込みに連動して動的に変化させる
                const row = btn.closest("tr");
                if (row) {
                    const murderousTd = row.cells[1]; // 右側の数値が入っている td 要素
                    if (murderousTd) {
                        const currentList = stats.lists[targetKey] || [];
                        
                        if (intersectedIndexes === null) {
                            // 絞り込みがない初期状態は、全体のユニーク件数（元の初期値）を表示
                            if (targetKey === "triple") murderousTd.textContent = stats.tripleCount;
                            else if (targetKey === "subject") murderousTd.textContent = stats.subjectCount;
                            else if (targetKey === "object") murderousTd.textContent = stats.objectCount;
                            else if (targetKey === "sClass") murderousTd.textContent = stats.sClassCount;
                            else if (targetKey === "oClass") murderousTd.textContent = stats.oClassCount;
                            else if (targetKey === "stakeholder") murderousTd.textContent = stats.stakeholderCount;
                            else if (targetKey === "opinion") murderousTd.textContent = stats.opinionCount;
                            else if (targetKey === "evidence") murderousTd.textContent = stats.evidenceCount;
                            
                            // 通常の文字色に戻す
                            murderousTd.style.color = "#333333";
                        } else {
                            // 絞り込みが発生している場合：
                            // 該当カテゴリのリスト内で、現在選択可能（共通の bindingIndexes を1つ以上持つ）なアイテムの総数を数える
                            let availableUniqueCount = 0;
                            currentList.forEach(item => {
                                // 自身がすでに選択されている、または他とのつながり（交差）がある場合
                                const isSelected = !!activeFiltersMap[item.name];
                                const hasIntersection = item.bindingIndexes && item.bindingIndexes.some(i => intersectedIndexes.has(i));
                                
                                if (isSelected || hasIntersection) {
                                    availableUniqueCount++;
                                }
                            });
                            
                            // 計算された動的な数値を上書き
                            murderousTd.textContent = availableUniqueCount;
                            
                            // 絞り込まれて数値が減っていることが視覚的にわかりやすいよう、赤字・太字にする（お好みでスタイル変更可）
                            murderousTd.style.color = "#d32f2f";
                        }
                    }
                }
            });
        };

        statsTable.onclick = (e) => {
            const btn = e.target.closest(".stats-toggle-btn");
            if (!btn) return;

            statsTable.querySelectorAll(".stats-toggle-btn").forEach(b => b.classList.remove("active"));
            btn.classList.add("active");

            const targetKey = btn.getAttribute("data-target");
            const labelText = btn.textContent.replace(/[0-9()✓\s]/g, '').trim(); 

            if (titleEl) titleEl.textContent = `${labelText.replace(/[・数]/g, '')}一覧`;
            if (noticeEl) {
                noticeEl.textContent = "";
            }

            updateLegendTable(targetKey);
            updateTabVisualIndicators();
        };

        const clearBtn = section.querySelector(".btn-clear-filters");
        if (clearBtn) {
            clearBtn.onclick = () => {
                activeFiltersMap = {}; 
                updateLegendTable(currentActiveTab);
                updateTabVisualIndicators();
            };
        }

        const defaultBtn = statsTable.querySelector(`.stats-toggle-btn[data-target="stakeholder"]`) || statsTable.querySelector(`.stats-toggle-btn[data-target="subject"]`);
        if (defaultBtn) defaultBtn.click();
    }
}
