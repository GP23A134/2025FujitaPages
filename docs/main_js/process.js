// ------------------------------------------------------------------------
// 4. メイン変換処理 ＆ 相互接続連動フィルタ（一括処理・最適化高速版）
// ------------------------------------------------------------------------
function splitAndProcessData() {
    const execBtn = document.getElementById("execBtn");
    const outputContainer = document.getElementById("outputContainer");
    
    if (execBtn) execBtn.disabled = true;
    outputContainer.innerHTML = ""; 
    showSearchIng(outputContainer);

    setTimeout(async () => {
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

            removeSearchIng(); 

            // 💡【重要改善】ドキュメントのグループ一覧（キー）を配列化
            const groupKeys = Object.keys(docGroups);
            
            // 💡【非同期チャンク処理】1個ずつドキュメント枠を生成し、隙間でブラウザに描画させる関数
            async function processGroupSequentially(index) {
                if (index >= groupKeys.length) {
                    // 全てのドキュメントの処理が完了
                    if (execBtn) execBtn.disabled = false;
                    return;
                }

                let groupKey = groupKeys[index];
                let wrappedBindings = docGroups[groupKey];
                
                const wordAppearanceMap = {}; 
                const finalSpeakerColorMap = {}; 
                const finalStClassColorMap = {}; 
                const opinionColorMap = {};

                const uniqueSubjects = new Set();
                const uniquePs = new Set(); 
                const uniqueObjects = new Set();
                const uniqueSClasses = new Set();
                const uniqueOClasses = new Set();
                const uniqueStakeholders = new Set();
                const uniqueOpinions = new Set();
                const uniqueEvidences = new Set();
                const uniqueTriples = new Set();
                const uniqueStClasses = new Set(); 
                const tripleLabelMap = {}; 

                const bindingIndexesMap = {
                    triple: {}, subject: {}, p: {}, object: {}, sClass: {}, oClass: {}, stakeholder: {}, opinion: {}, evidence: {}, stClass: {}
                };

                const jsonCountMap = {
                    stakeholder: {}, subject: {}, p: {}, object: {}, sClass: {}, oClass: {}, evidence: {}, opinion: {}, triple: {}, stClass: {}
                };

                let paletteIndex = 0; 
                const getNextPaletteColor = () => {
                    const color = SPEAKER_PALETTE[paletteIndex % SPEAKER_PALETTE.length];
                    paletteIndex++;
                    return color;
                };

                function resolveColors(shId, stClassId, hasStClassLabel) {
                    if (config.shColorMode === "select") {
                        finalSpeakerColorMap[shId] = config.cFixedSH; 
                        if (stClassId !== "") finalStClassColorMap[stClassId] = config.cStClass; 
                        return;
                    }
                    if (config.shColorMode === "group") {
                        if (stClassId !== "" && hasStClassLabel && config.stClass) {
                            if (!finalStClassColorMap[stClassId]) {
                                finalStClassColorMap[stClassId] = getNextPaletteColor(); 
                            }
                            let groupClassColor = finalStClassColorMap[stClassId];
                            finalSpeakerColorMap[shId] = darkenColor(groupClassColor, 0.85); 
                        } else {
                            if (!finalSpeakerColorMap[shId]) {
                                finalSpeakerColorMap[shId] = getNextPaletteColor(); 
                            }
                        }
                        return;
                    }
                    if (config.shColorMode === "random") {
                        finalSpeakerColorMap[shId] = getNextPaletteColor(); 
                        if (stClassId !== "") finalStClassColorMap[stClassId] = config.cStClass; 
                    }
                }

                const comboToTrMap = {}; 
                let trCounter = 0; 
                const structuredLines = []; 
                
                const stakeholderLabelMap = {}; 
                const stClassLabelMap = {};

                for (let item of wrappedBindings) {
                    let b = item.binding;
                    let shId = extractIdFromUri(getValueFromBinding(b, "stakeholder"));
                    let stClassId = extractIdFromUri(getValueFromBinding(b, "stClass") || getValueFromBinding(b, "?stClass"));
                    let cleanShName = clean(getValueFromBinding(b, "stakeholderLabel"));
                    let stClassLabelRaw = clean(getValueFromBinding(b, "stClassLabel"));
                    
                    let shLabel = "st_" + cleanShName;
                    let stClassLabel = "stc_" + stClassLabelRaw;
                    if (shId !== "") {
                        stakeholderLabelMap[shId] = shLabel;
                        if (stClassId !== "" && stClassLabelRaw) stClassLabelMap[stClassId] = stClassLabel;
                        if (!finalSpeakerColorMap[shId]) {
                            resolveColors(shId, stClassId, !!stClassLabelRaw);
                        }
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
                    
                    let opContent = "op_" + opContentRaw;
                    let evContent = "ev_" + evContentRaw;

                    if (sId === "" || oId === "") continue;

                    let comboKeyForId = `${currentDocId}_${sId}|${pId}|${oId}`;
                    if (!comboToTrMap[comboKeyForId]) {
                        comboToTrMap[comboKeyForId] = "T" + trCounter;
                        trCounter++;
                    }
                    
                    let trId = comboToTrMap[comboKeyForId];
                    let tripleMapKey = `${sLabelRaw} | ${pLabel} | ${oLabelRaw}`;
                    let tripleDisplayLabel = trId; 

                    uniqueTriples.add(tripleMapKey);
                    tripleLabelMap[tripleMapKey] = tripleDisplayLabel;
                    jsonCountMap.triple[tripleMapKey] = (jsonCountMap.triple[tripleMapKey] || 0) + 1;
                    pushIndex("triple", tripleDisplayLabel, curIdx);

                    if (sId !== "") {
                        uniqueSubjects.add(sLabel);
                        jsonCountMap.subject[sLabel] = (jsonCountMap.subject[sLabel] || 0) + 1;
                        pushIndex("subject", sLabel, curIdx);
                    }
                    if (pId !== "" && pLabel) {
                        uniquePs.add(pLabel);
                        jsonCountMap.p[pLabel] = (jsonCountMap.p[pLabel] || 0) + 1;
                        pushIndex("p", pLabel, curIdx);
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
                        
                        if (opContentRaw) {
                            uniqueOpinions.add(opContent);
                            jsonCountMap.opinion[opContent] = (jsonCountMap.opinion[opContent] || 0) + 1;
                            pushIndex("opinion", opContent, curIdx);
                            opinionColorMap[opContent] = darkenColor(speakerColor, 0.85);
                        }

                        if (config.stClass && stClassId !== "" && stClassLabelRaw) {
                            uniqueStClasses.add(stClassLabel);
                            jsonCountMap.stClass[stClassLabel] = (jsonCountMap.stClass[stClassLabel] || 0) + 1;
                            pushIndex("stClass", stClassLabel, curIdx);
                        }

                        shExactCountMap[shLabel_cleansed] = (shExactCountMap[shLabel_cleansed] || 0) + 1;
                        jsonCountMap.stakeholder[shNodeName] = (jsonCountMap.stakeholder[shNodeName] || 0) + 1;
                        pushIndex("stakeholder", shLabel_cleansed, curIdx);

                        if (config.shColorMode === "group" && config.stClass && stClassId !== "" && stClassLabelRaw) {
                            const className = stClassLabelMap[stClassId] || "不明な分類";
                            legendDisplayColorMap[`stClass_${stClassId}`] = { name: `【分類】${className}`, color: finalStClassColorMap[stClassId], uri: sClassUri };
                        }
                        legendDisplayColorMap[`sh_${shId}`] = { name: `${shLabel_cleansed}`, color: speakerColor, uri: shUri };
                    }

                    let prefix = (config.targetId === "") ? `${currentDocId}\t` : "";
                    let localLinesBuffer = []; 

                    if (config.pEnabled) {
                        localLinesBuffer.push(`${prefix}${displaySLabel}\t${pLabel}\t${displayOLabel}\t${config.cSubj}\t${config.cObj}\t${config.cPred}\t${curIdx}`);
                    }
                    if (config.sEnabled) {
                        localLinesBuffer.push(`${prefix}${trId}\t主語\t${displaySLabel}\t${config.cDefaultEdge}\t${config.cSubj}\t${config.cSubj}\t${curIdx}`);
                    } else if (config.sClassEnabled && sClassId !== "" && sClassLabelRaw) {
                        localLinesBuffer.push(`${prefix}${trId}\tsClass\t${sClassLabel}\t${config.cDefaultEdge}\t${config.cSClass}\t${config.cSClass}\t${curIdx}`);
                    }
                    if (config.oEnabled) {
                        localLinesBuffer.push(`${prefix}${trId}\t目的語\t${displayOLabel}\t${config.cDefaultEdge}\t${config.cObj}\t${config.cObj}\t${curIdx}`);
                    } else if (config.oClassEnabled && oClassId !== "" && oClassLabelRaw) {
                        localLinesBuffer.push(`${prefix}${trId}\toClass\t${ocLabel}\t${config.cDefaultEdge}\t${config.cOClass}\t${config.cOClass}\t${curIdx}`);
                    }

                    if (config.sEnabled && config.sClassEnabled && sClassId !== "" && sClassLabelRaw) {
                        localLinesBuffer.push(`${prefix}${displaySLabel}\tsClass\t${sClassLabel}\t${config.cDefaultEdge}\t${config.cSClass}\t${config.cSClass}\t${curIdx}`);
                    }
                    if (config.oEnabled && config.oClassEnabled && oClassId !== "" && oClassLabelRaw) {
                        localLinesBuffer.push(`${prefix}${displayOLabel}\toClass\t${ocLabel}\t${config.cDefaultEdge}\t${config.cOClass}\t${config.cOClass}\t${curIdx}`);
                    }
                    if (config.classLinkEnabled && sClassId !== "" && sClassLabelRaw && oClassId !== "" && oClassLabelRaw) {
                        localLinesBuffer.push(`${prefix}${sClassLabel}\t-\t${ocLabel}\t${config.cSClassEdge}\t${config.cSClass}\t${config.cOClass}\t${curIdx}`);
                    }

                    if (shId !== "" && shLabelRaw) {
                        if (opContentRaw) {
                            let opinionColor = opinionColorMap[opContent] || "#f0f0f0";
                            localLinesBuffer.push(`${prefix}${trId}\t意見\t${opContent}\t${config.cDefaultEdge}\t${opinionColor}\t${opinionColor}\t${curIdx}`);
                            localLinesBuffer.push(`${prefix}${opContent}\t発話者\t${shNodeName}\t${config.cDefaultEdge}\t${speakerColor}\t${speakerColor}\t${curIdx}`);
                        } else {
                            localLinesBuffer.push(`${prefix}${trId}\t発話者\t${shNodeName}\t${config.cDefaultEdge}\t${speakerColor}\t${speakerColor}\t${curIdx}`);
                        }
                        if (config.stClass && stClassId !== "" && stClassLabelRaw) {
                            let classColor = finalStClassColorMap[stClassId] || config.cStClass;
                            localLinesBuffer.push(`${prefix}${shNodeName}\tstClass\t${stClassLabel}\t${config.cDefaultEdge}\t${classColor}\t${classColor}\t${curIdx}`);
                        }
                    }

                    if (config.evEnabled && evContentRaw !== "") {
                        localLinesBuffer.push(`${prefix}${trId}\t根拠\t${evContent}\t${config.cDefaultEdge}\t${config.cEv}\t${config.cEv}\t${curIdx}`);
                    }

                    if (localLinesBuffer.length > 0) {
                        structuredLines.push({
                            index: curIdx, 
                            text: localLinesBuffer.join("\n"), 
                            tripleData: { 
                                subject: sLabelRaw, predicate: pLabel, object: oLabelRaw,
                                sClass: sClassLabelRaw, oClass: oClassLabelRaw,
                                stakeholder: shLabelRaw, opinion: opContentRaw, evidence: evContentRaw
                            }
                        });
                    }
                }

                const createSortedObjList = (setObj, countSubMap, categoryKey) => {
                    return Array.from(setObj).map(item => {
                        let rawName = item;
                        if (categoryKey === "triple") rawName = tripleLabelMap[item] || item;
                        
                        let baseColor = null;
                        if (categoryKey === "subject") baseColor = config.cSubj;
                        if (categoryKey === "p") baseColor = config.cPred; 
                        if (categoryKey === "object") baseColor = config.cObj;
                        if (categoryKey === "sClass") baseColor = config.cSClass;
                        if (categoryKey === "oClass") baseColor = config.cOClass;
                        if (categoryKey === "evidence") baseColor = config.cEv;
                        if (categoryKey === "opinion") baseColor = opinionColorMap[item] || "#f0f0f0";

                        if (categoryKey === "stClass") {
                            let origId = Object.keys(stClassLabelMap).find(k => stClassLabelMap[k] === item) || "";
                            baseColor = finalStClassColorMap[origId] || config.cStClass;
                        }

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
                        triple: "#adadad", subject: config.cSubj, object: config.cObj, p: config.cPred, sClass: config.cSClass, oClass: config.cOClass,
                        stakeholder: config.cFixedSH, opinion: config.cFixedSH, evidence: config.cEv, stClass: config.cStClass 
                    },
                    tripleCount: uniqueTriples.size,
                    subjectCount: uniqueSubjects.size,
                    pCount: uniquePs.size, 
                    objectCount: uniqueObjects.size,
                    sClassCount: uniqueSClasses.size,
                    oClassCount: uniqueOClasses.size,
                    stakeholderCount: Object.keys(shExactCountMap).length,
                    opinionCount: uniqueOpinions.size,
                    evidenceCount: uniqueEvidences.size,
                    stClassCount: uniqueStClasses.size, 
                    lists: {
                        triple: createSortedObjList(uniqueTriples, jsonCountMap.triple, "triple"),
                        subject: createSortedObjList(uniqueSubjects, jsonCountMap.subject, "subject"),
                        p: createSortedObjList(uniquePs, jsonCountMap.p, "p"),
                        object: createSortedObjList(uniqueObjects, jsonCountMap.object, "object"),
                        sClass: createSortedObjList(uniqueSClasses, jsonCountMap.sClass, "sClass"),
                        oClass: createSortedObjList(uniqueOClasses, jsonCountMap.oClass, "oClass"),
                        stakeholder: createSortedObjList(Object.keys(shExactCountMap), shExactCountMap, "stakeholder"),
                        opinion: createSortedObjList(uniqueOpinions, jsonCountMap.opinion, "opinion"),
                        evidence: createSortedObjList(uniqueEvidences, jsonCountMap.evidence, "evidence"),
                        stClass: createSortedObjList(uniqueStClasses, jsonCountMap.stClass, "stClass") 
                    }
                };

                // 💡 今処理したドキュメントを描画
                createDocumentSection(groupKey, structuredLines, stats);

                // 💡【最重要】描画後に16ミリ秒（1フレーム分）の隙間をあけて、次のドキュメントの処理をスケジュールする
                setTimeout(() => {
                    processGroupSequentially(index + 1);
                }, 16);
            }

            // 最初のグループの処理を開始
            processGroupSequentially(0);

        } catch (err) {
            removeSearchIng();
            console.error(err);
            alert("変換処理中にエラーが発生しました。");
            if (execBtn) execBtn.disabled = false; 
        }
    }, 50); 
}