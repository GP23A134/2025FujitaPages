/**
 * 入力データを画面表示向けのトリプル一覧に変換する。
 * DOM操作は行わず、データの取得・統合・語彙作成だけを担当する。
 */
let cachedData;
let cachedDetailData;
const intermediateClassMaps = { subject: new Map(), object: new Map(), stakeholder: new Map() };

// 追加データはクラス URI と中間クラス名の対応として読み込む。
async function loadIntermediateClassData() {
  const sources = [
    ["subject", "outputSubjectTypes", "data/output_sTyoe.js", "sClass", "sTypeLabel"],
    ["object", "outputObjectTypes", "data/output_oType.js", "oClass", "oTypeLabel"],
    ["stakeholder", "outputStakeholderTypes", "data/output_stType.js", "stClass", "stTypeLabel"]
  ];
  const addMappings = (kind, json, classField, typeLabelField) => {
    (json?.results?.bindings || []).forEach(row => {
      const classUri = getField(row, classField);
      const typeLabel = getField(row, typeLabelField);
      if (classUri && typeLabel) intermediateClassMaps[kind].set(classUri, typeLabel);
    });
  };
  await Promise.all(sources.map(async ([kind, globalName, url, classField, typeLabelField]) => {
    try {
      // script タグで先に読み込めている場合は、Web サーバーなしでも利用できる。
      if (window[globalName]) {
        addMappings(kind, window[globalName], classField, typeLabelField);
        return;
      }
      const response = await fetch(url);
      if (!response.ok) return;
      addMappings(kind, await response.json(), classField, typeLabelField);
    } catch (_) {
      // 中間クラスのデータがない場合も、従来のクラス表示を維持する。
    }
  }));
}

function getIntermediateClassLabel(row, kind, classField) {
  return intermediateClassMaps[kind].get(getField(row, classField)) || "";
}

function getTripleClassLabels(triple, side) {
  return [...new Set([...(triple[`${side}TypeLabels`] || []), ...(triple[`${side}ClassLabels`] || [])])];
}

// 入力データがどの形式でも、行の配列として取得する。
function getSourceRows() {
  return window.output?.results?.bindings || window.output?.bindings || window.output || [];
}

// 指定したクラス名を、トリプル内の重複なしの集合へ追加する。
function addTripleLabel(triple, row, fieldName, labelSetName) {
  const label = getField(row, fieldName);
  if (label) triple[labelSetName].add(label);
}

// 描画で扱えるよう、トリプル内の Set を配列へ変換する。
function convertLabelSetsToArrays(item) {
  Object.keys(item.triple).forEach(key => {
    if (item.triple[key] instanceof Set) item.triple[key] = [...item.triple[key]];
  });
  return item;
}

// 1件の入力行から、トリプルを特定するための基本情報を取り出す。
function getTripleValues(row) {
  return {
    subject: getField(row, ["sLabel", "s"]),
    predicate: getField(row, ["pLabel", "p"]),
    object: getField(row, ["oLabel", "o"]),
    evidence: getField(row, "evidence")
  };
}

// 同一トリプルに関連する資料の情報を追加する。
function addDocumentData(item, row) {
  const documentType = getField(row, "gTypeLabel") || "未指定";
  const documentTitle = getField(row, "gLabel");
  const sourceFolder = getField(row, "sourceFolderPath");
  const documentUrl = getField(row, "g");
  const documentText = getField(row, "evidence");

  item.documentTypes.add(documentType);
  if (documentTitle) item.documentTitles.add(documentTitle);
  if (sourceFolder) {
    item.sourceFolders.add(sourceFolder);
    item.prefectures.add(sourceFolder.split("/")[0]);
  }
  if (documentUrl) item.documentUrls.add(documentUrl);
  if (documentText) item.documentTexts.add(documentText);
}

// 同一の発言者・クラスごとに、意見をまとめる。
function addStakeholderContext(item, row) {
  const stakeholderName = getField(row, "stakeholderLabel");
  const stakeholderClass = getField(row, "stClassLabel");
  const stakeholderType = getIntermediateClassLabel(row, "stakeholder", "stClass");
  const opinion = getField(row, "opinionContent");
  if (!stakeholderName) return;

  const contextKey = `${stakeholderClass}\u0000${stakeholderName}`;
  if (!item.stakeholderContexts.has(contextKey)) {
    item.stakeholderContexts.set(contextKey, {
      name: stakeholderName,
      className: stakeholderClass,
      typeName: stakeholderType,
      opinions: new Set()
    });
  }
  if (opinion) item.stakeholderContexts.get(contextKey).opinions.add(opinion);
}

// Set と Map を画面描画用の配列へ変換する。
function prepareItemForDisplay(item) {
  item.documentTypes = [...item.documentTypes];
  item.documentTitles = [...item.documentTitles];
  item.sourceFolders = [...item.sourceFolders];
  item.documentUrls = [...item.documentUrls];
  item.prefectures = [...item.prefectures];
  item.documentTexts = [...item.documentTexts];
  item.stakeholderContexts = [...item.stakeholderContexts.values()].map(context => ({
    ...context,
    opinions: [...context.opinions]
  }));
  return convertLabelSetsToArrays(item);
}

// 集約キーだけを切り替え、一覧と詳細で共通の行集約処理を使う。
function buildAggregatedData(keySelector) {
  const triplesByContent = new Map();
  let tripleNumber = 1;
  getSourceRows().forEach(row => {
    const { subject, predicate, object, evidence } = getTripleValues(row);
    const subjectClass = getField(row, "sClassLabel");
    const objectClass = getField(row, "oClassLabel");
    const key = keySelector({ subject, predicate, object, evidence, subjectClass, objectClass });

    if (!triplesByContent.has(key)) {
      triplesByContent.set(key, {
        documentTypes: new Set(),
        documentTitles: new Set(),
        sourceFolders: new Set(),
        documentUrls: new Set(),
        prefectures: new Set(),
        documentTexts: new Set(),
        stakeholderContexts: new Map(),
        triple: {
          tplId: tripleNumber++,
          sLabel: subject,
          pLabel: predicate,
          oLabel: object,
          sClassLabels: new Set(),
          oClassLabels: new Set(),
          sTypeLabels: new Set(),
          oTypeLabels: new Set()
        }
      });
    }

    const item = triplesByContent.get(key);
    addDocumentData(item, row);
    addStakeholderContext(item, row);
    addTripleLabel(item.triple, row, "sClassLabel", "sClassLabels");
    addTripleLabel(item.triple, row, "oClassLabel", "oClassLabels");
    const subjectType = getIntermediateClassLabel(row, "subject", "sClass");
    const objectType = getIntermediateClassLabel(row, "object", "oClass");
    if (subjectType) item.triple.sTypeLabels.add(subjectType);
    if (objectType) item.triple.oTypeLabels.add(objectType);
  });
  return [...triplesByContent.values()].map(prepareItemForDisplay);
}

// 表示する主語クラス・述語・目的語クラスが同じ行を1件にまとめる。
// 根拠：や個別の主語・目的語が違っていても、一覧では同じ因果構造として統合する。
function getAllData() {
  if (cachedData) return cachedData;
  cachedData = buildAggregatedData(({ subjectClass, predicate, objectClass }) =>
    [subjectClass, predicate, objectClass].map(normalize).join("\u0000"));
  const detailIdsByClassTriple = new Map();
  getDetailData().forEach(item => {
    const subjectClasses = item.triple.sClassLabels.length ? item.triple.sClassLabels : [""];
    const objectClasses = item.triple.oClassLabels.length ? item.triple.oClassLabels : [""];
    subjectClasses.forEach(subjectClass => objectClasses.forEach(objectClass => {
      const key = [subjectClass, item.triple.pLabel, objectClass].map(normalize).join("\u0000");
      if (!detailIdsByClassTriple.has(key)) detailIdsByClassTriple.set(key, []);
      detailIdsByClassTriple.get(key).push(item.triple.tplId);
    }));
  });
  cachedData.forEach(item => {
    const subjectClasses = item.triple.sClassLabels.length ? item.triple.sClassLabels : [""];
    const objectClasses = item.triple.oClassLabels.length ? item.triple.oClassLabels : [""];
    const ids = subjectClasses.flatMap(subjectClass => objectClasses.flatMap(objectClass =>
      detailIdsByClassTriple.get([subjectClass, item.triple.pLabel, objectClass].map(normalize).join("\u0000")) || []
    ));
    item.detailIds = [...new Set(ids)];
  });
  return cachedData;
}

// 詳細画面用に、従来どおり個別の主語・述語・目的語・根拠：ごとに保持する。
function getDetailData() {
  if (cachedDetailData) return cachedDetailData;
  cachedDetailData = buildAggregatedData(({ subject, predicate, object, evidence }) =>
    [subject, predicate, object, evidence].map(normalize).join("\u0000"));
  return cachedDetailData;
}

// 主語・目的語のクラス名を、重複なしの検索候補として収集する。
function getVocabulary() {
  const classLabels = getAllData().flatMap(({ triple }) => [...getTripleClassLabels(triple, "s"), ...getTripleClassLabels(triple, "o")]);
  return [...new Set(classLabels.map(normalize).filter(term => term.length > 1))]
    .sort((firstTerm, secondTerm) => secondTerm.length - firstTerm.length);
}
