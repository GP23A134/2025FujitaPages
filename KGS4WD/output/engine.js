// dataEngine.js

function getCleanFullText(linesArray, isAllDoc) {
    const cleanLines = [];
    linesArray.forEach(lineObj => {
        if (!lineObj || !lineObj.text) return;
        const lines = lineObj.text.split("\n");
        lines.forEach(edgeStr => {
            if (!edgeStr) return;
            const columns = edgeStr.split("\t");
            columns.pop();
            if (isAllDoc && columns.length > 0) columns.shift();
            cleanLines.push(columns.join("\t"));
        });
    });
    return Array.from(new Set(cleanLines)).join("\n");
}

function parseTableData(currentText) {
    if (!currentText) return null;
    const lines = currentText.split("\n");
    const stringToSClassMap = new Map(); 
    const stringToOClassMap = new Map(); 
    const idGroupMap = {}; 
    const idToOpinionsMap = new Map(); 
    const opinionToStakeholderMap = new Map(); 

    lines.forEach(lineStr => {
        if (!lineStr.trim()) return;
        const columns = lineStr.split("\t");
        if (columns.length < 3) return;
        const col0 = columns[0].trim();
        const col1 = columns[1].trim();
        const col2 = columns[2].trim();
        if (!/^T\d+$/.test(col0)) {
            if (col1 === "sClass") stringToSClassMap.set(col0, col2);
            if (col1 === "oClass") stringToOClassMap.set(col0, col2);
            if (col1 === "発話者") opinionToStakeholderMap.set(col0, col2);
        }
    });

    lines.forEach(lineStr => {
        if (!lineStr.trim()) return;
        const columns = lineStr.split("\t");
        if (columns.length < 3) return;
        const col0 = columns[0].trim();
        const col1 = columns[1].trim();
        const col2 = columns[2].trim();
        if (/^T\d+$/.test(col0)) {
            if (!idGroupMap[col0]) idGroupMap[col0] = { rawSubject: "", rawObject: "", predicates: [] };
            if (col1 === "主語") idGroupMap[col0].rawSubject = col2;
            if (col1 === "目的語") idGroupMap[col0].rawObject = col2;
            if (col1 === "意見") {
                if (!idToOpinionsMap.has(col0)) idToOpinionsMap.set(col0, new Set());
                idToOpinionsMap.get(col0).add(col2);
            }
        }
    });

    lines.forEach(lineStr => {
        if (!lineStr.trim()) return;
        const columns = lineStr.split("\t");
        if (columns.length < 3) return;
        const subStr = columns[0].trim();
        const predStr = columns[1].trim();
        const objStr = columns[2].trim();
        if (/^T\d+$/.test(subStr) || predStr === "sClass" || predStr === "oClass" || predStr === "-" || predStr === "意見" || predStr === "発話者") return;
        Object.keys(idGroupMap).forEach(tId => {
            const group = idGroupMap[tId];
            if (group.rawSubject === subStr && group.rawObject === objStr) {
                if (!group.predicates.includes(predStr)) group.predicates.push(predStr);
            }
        });
    });

    return { stringToSClassMap, stringToOClassMap, idGroupMap, idToOpinionsMap, opinionToStakeholderMap };
}

// dataEngine.js の一番最後にある createSortedObjList をこの形に書き換えます。

function createSortedObjList(setObj, countSubMap, categoryKey) {
    // 【重要】process.js を変えないため、グローバル（window）やスコープ上から
    // 存在する変数を自動的に探し出し、なければ空のオブジェクトを代入して安全を確保します。
    const cfg = (typeof config !== 'undefined') ? config : {};
    const tLabelMap = (typeof tripleLabelMap !== 'undefined') ? tripleLabelMap : {};
    const oColorMap = (typeof opinionColorMap !== 'undefined') ? opinionColorMap : {};
    const stClsLabelMap = (typeof stClassLabelMap !== 'undefined') ? stClassLabelMap : {};
    const finalStClsColorMap = (typeof finalStClassColorMap !== 'undefined') ? finalStClassColorMap : {};
    const legendDispColorMap = (typeof legendDisplayColorMap !== 'undefined') ? legendDisplayColorMap : {};
    const bndIndexesMap = (typeof bindingIndexesMap !== 'undefined') ? bindingIndexesMap : {};

    return Array.from(setObj).map(item => {
        let rawName = item;
        // tripleカテゴリのときはラベルマップを適用
        if (categoryKey === "triple") rawName = tLabelMap[item] || item;
        
        let baseColor = null;
        // 各カテゴリに応じた設定カラーを config から取得
        if (categoryKey === "subject") baseColor = cfg.cSubj;
        if (categoryKey === "p") baseColor = cfg.cPred; 
        if (categoryKey === "object") baseColor = cfg.cObj;
        if (categoryKey === "sClass") baseColor = cfg.cSClass;
        if (categoryKey === "oClass") baseColor = cfg.cOClass;
        if (categoryKey === "evidence") baseColor = cfg.cEv;
        if (categoryKey === "opinion") baseColor = oColorMap[item] || "#f0f0f0";

        // 発話者クラス（stClass）の特殊な色判定
        if (categoryKey === "stClass") {
            let origId = Object.keys(stClsLabelMap).find(k => stClsLabelMap[k] === item) || "";
            baseColor = finalStClsColorMap[origId] || cfg.cStClass;
        }

        // ステークホルダーの色判定
        if (categoryKey === "stakeholder") {
            const found = Object.values(legendDispColorMap).find(m => m.name === item);
            if (found) baseColor = found.color;
        }

        // インデックスマップの安全な取得
        const categoryBindings = bndIndexesMap[categoryKey] || {};

        return {
            name: rawName,
            count: countSubMap[item] || 0, 
            color: baseColor, 
            bindingIndexes: categoryBindings[rawName] || [] 
        };
    }).sort((a, b) => b.count - a.count); 
}