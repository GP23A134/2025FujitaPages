/**
 * データのクレンジング、集計、3部形式テキストの生成ロジックを担当
 */
import { createDocumentSection } from './domRenderer.js';

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

export function extractIdFromUri(uriString) {
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

/**
 * データをグループ化し、テキストおよび統計サマリーを生成してレンダラーへ渡す
 */
export function processGraphData(bindings, config) {
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
        throw new Error("EMPTY_DATA");
    }

    let globalColorCounter = 0;

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
        const idToUriMap = { subject: {}, object: {}, sClass: {}, oClass: {}, evidence: {} };

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

        for (let item of wrappedBindings) {
            let b = item.binding;
            let currentDocId = item.originalDocId; 

            let sUri = getValueFromBinding(b, "s");
            let sClassUri = getValueFromBinding(b, "sClass");
            let oUri = getValueFromBinding(b, "o");
            let oClassUri = getValueFromBinding(b, "oClass");
            let shUri = getValueFromBinding(b, "stakeholder");
            let opUri = getValueFromBinding(b, "opinion");
            let evUri = getValueFromBinding(b, "evidence");

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

            if (sId !== "") idToUriMap.subject[sLabel] = sUri;
            if (oId !== "") idToUriMap.object[oLabel] = oUri;
            if (sClassId !== "" && sClassLabelRaw) idToUriMap.sClass[sClassLabel] = sClassUri;
            if (oClassId !== "" && oClassLabelRaw) idToUriMap.oClass[ocLabel] = oClassUri;
            if (evContentRaw !== "") idToUriMap.evidence[evContent] = evUri || "ローカルデータ";

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

            if (sId !== "") uniqueSubjects.add(sLabel);
            if (oId !== "") uniqueObjects.add(oLabel);
            if (sClassId !== "" && sClassLabelRaw) uniqueSClasses.add(sClassLabel);
            if (oClassId !== "" && oClassLabelRaw) uniqueOClasses.add(ocLabel);
            if (shId !== "" && shLabelRaw) uniqueStakeholders.add(shId);
            if (opId !== "" && opContentRaw) uniqueOpinions.add(opContentRaw);
            if (evContentRaw !== "") uniqueEvidences.add(evContent);

            if (sId !== "") jsonCountMap.subject[sLabel] = (jsonCountMap.subject[sLabel] || 0) + 1;
            if (oId !== "") jsonCountMap.object[oLabel] = (jsonCountMap.object[oLabel] || 0) + 1;
            if (sClassId !== "" && sClassLabelRaw) jsonCountMap.sClass[sClassLabel] = (jsonCountMap.sClass[sClassLabel] || 0) + 1;
            if (oClassId !== "" && oClassLabelRaw) jsonCountMap.oClass[ocLabel] = (jsonCountMap.oClass[ocLabel] || 0) + 1;
            if (evContentRaw !== "") jsonCountMap.evidence[evContent] = (jsonCountMap.evidence[evContent] || 0) + 1;

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
                
                if (opContentRaw) jsonCountMap.opinion[opContentRaw] = (jsonCountMap.opinion[opContentRaw] || 0) + 1;

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
                        docOutputBuffer += `${prefix}${trId}\toClass\t${ocLabel}\t${config.cOClass}\t${config.cOClass}\n`;
                    }
                }
            }

            if (config.sEnabled && config.sClassEnabled && sClassId !== "" && sClassLabelRaw) {
                let sClassKey = `${currentDocId}_${displaySLabel}_to_sClass_${sClassId}`;
                if (!classLinkSet.has(sClassKey)) {
                    classLinkSet.add(sClassKey);
                    docOutputBuffer += `${prefix}${displaySLabel}\tsClass\t${sClassLabel}\t${config.cSubj}\t${config.cSClass}\t${config.cSClass}\n`;
                }
            }
            if (config.oEnabled && config.oClassEnabled && oClassId !== "" && oClassLabelRaw) {
                let oClassKey = `${currentDocId}_${displayOLabel}_to_oClass_${oClassId}`;
                if (!classLinkSet.has(oClassKey)) {
                    classLinkSet.add(oClassKey);
                    docOutputBuffer += `${prefix}${displayOLabel}\toClass\t${ocLabel}\t${config.cObj}\t${config.cOClass}\t${config.cOClass}\n`;
                }
            }
            if (config.classLinkEnabled && sClassId !== "" && oClassId !== "" && sClassLabelRaw && oClassLabelRaw) {
                let sToOClassKey = `${currentDocId}_${trId}_${sClassId}_to_${oClassId}`;
                if (!classLinkSet.has(sToOClassKey)) {
                    classLinkSet.add(sToOClassKey);
                    docOutputBuffer += `${prefix}${sClassLabel}\t-\t${ocLabel}\t${config.cSClass}\t${config.cOClass}\t${config.cSClassEdge}\n`;
                }
            }
            if (config.evEnabled && evContentRaw !== "") {
                let safeEvContent = evContent.replace(/\n/g, " ");
                let trToEvidenceKey = `${currentDocId}_${trId}_evidence_${safeEvContent}`;
                if (!metadataLinkSet.has(trToEvidenceKey)) {
                    metadataLinkSet.add(trToEvidenceKey);
                    docOutputBuffer += `${prefix}${trId}\tevidence\t${safeEvContent}\t${config.cDefaultEdge}\t${config.cEv}\t${config.cEv}\n`;
                }
            }

            if (config.shEnabled && opId !== "" && opContentRaw) {
                let opinionColor = darkenColor(speakerColor, 0.80); 
                let trToOpinionKey = `${currentDocId}_${trId}_instance_${opId}`;
                if (!metadataLinkSet.has(trToOpinionKey)) {
                    metadataLinkSet.add(trToOpinionKey);
                    docOutputBuffer += `${prefix}${shNodeName}\t意見\t${trId}\t${opinionColor}\t${config.cDefaultEdge}\t${config.cDefaultEdge}\n`;
                }

                if (shId && shLabelRaw) {
                    let opinionToSpeakerKey = `${currentDocId}_${opId}_speaker_${shNodeName}`;
                    if (!metadataLinkSet.has(opinionToSpeakerKey)) {
                        metadataLinkSet.add(opinionToSpeakerKey);
                        docOutputBuffer += `${prefix}${opContentRaw}\tステークホルダー\t${shNodeName}\t${opinionColor}\t${speakerColor}\t${speakerColor}\n`;
                    }

                    if (config.stClass && stClassId && stClassLabelRaw) {
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
        
        const sortByCountDesc = (a, b) => b.count - a.count || a.name.localeCompare(b.name, 'ja');

        const customColorList = [];
        if (config.shEnabled) {
            const seenNames = new Set();
            Object.keys(legendDisplayColorMap).forEach(key => {
                const item = legendDisplayColorMap[key];
                if (!item.name || /^(st_(|【個人】|個人))$/.test(item.name)) return;

                if (!seenNames.has(item.name)) {
                    seenNames.add(item.name);
                    customColorList.push({
                        name: item.name, color: item.color, count: shExactCountMap[item.name] || 0, uri: item.uri
                    });
                }
            });
            customColorList.sort(sortByCountDesc);
        }

        const createList = (uniqueSet, color, countMap, uriMap) => 
            Array.from(uniqueSet).map(name => ({
                name, color, count: countMap[name] || 0, uri: uriMap[name]
            })).sort(sortByCountDesc);

        const subjList = createList(uniqueSubjects, config.cSubj, jsonCountMap.subject, idToUriMap.subject);
        const objList = createList(uniqueObjects, config.cObj, jsonCountMap.object, idToUriMap.object);
        const sClassList = createList(uniqueSClasses, config.cSClass, jsonCountMap.sClass, idToUriMap.sClass);
        const oClassList = createList(uniqueOClasses, config.cOClass, jsonCountMap.oClass, idToUriMap.oClass);
        const evList = createList(uniqueEvidences, config.cEv, jsonCountMap.evidence, idToUriMap.evidence);

        const opList = [];
        if (config.shEnabled) {
            const seenOpinions = new Set();
            for (let item of wrappedBindings) {
                let b = item.binding;
                let opContentRaw = clean(getValueFromBinding(b, "opinionContent"));
                if (/^(【個人】|個人|)$/.test(opContentRaw)) continue;

                let opId = extractIdFromUri(getValueFromBinding(b, "opinion") || getValueFromBinding(b, "?opinion"));
                if (opId && !seenOpinions.has(opContentRaw)) {
                    seenOpinions.add(opContentRaw);
                    let shId = extractIdFromUri(getValueFromBinding(b, "stakeholder"));
                    opList.push({
                        name: opContentRaw,
                        color: (shId && finalSpeakerColorMap?.[shId]) || "#adadad",
                        count: jsonCountMap.opinion[opContentRaw] || 0,
                        uri: getValueFromBinding(b, "opinion")
                    });
                }
            }
            opList.sort(sortByCountDesc);
        }

        const tripleList = Array.from(uniqueTriples).map(key => ({
            name: tripleLabelMap[key], color: config.cPred, count: jsonCountMap.triple[key] || 0, isTriple: true
        })).sort((a, b) => parseInt(a.name.match(/^T(\d+)_/)[1], 10) - parseInt(b.name.match(/^T(\d+)_/)[1], 10));

        let dynamicTitle = "ステークホルダー";
        if (config.shEnabled) {
            if (config.shColorMode === "group") dynamicTitle = "stClass";
            else if (config.shColorMode === "select") dynamicTitle = "単一固定指定";
        }

        const statsSummary = {
            titleName: dynamicTitle, tripleCount: trCounter, subjectCount: uniqueSubjects.size,
            objectCount: uniqueObjects.size, sClassCount: uniqueSClasses.size, oClassCount: uniqueOClasses.size,
            stakeholderCount: uniqueStakeholders.size, opinionCount: uniqueOpinions.size, evidenceCount: uniqueEvidences.size,
            sEnabled: config.sEnabled, oEnabled: config.oEnabled, sClassEnabled: config.sClassEnabled,
            oClassEnabled: config.oClassEnabled, shEnabled: config.shEnabled, evEnabled: config.evEnabled,
            cSubj: config.cSubj, cObj: config.cObj, cPred: config.cPred, cSClass: config.cSClass,
            cOClass: config.cOClass, cEv: config.cEv,
            lists: {
                stakeholder: customColorList, subject: subjList, object: objList,
                sClass: sClassList, oClass: oClassList, evidence: evList, opinion: opList, triple: tripleList 
            }
        };

        createDocumentSection((groupKey === "ALL_DOCUMENTS") ? "ALL_DOCUMENTS" : groupKey, docOutputBuffer, statsSummary);
    }
}
