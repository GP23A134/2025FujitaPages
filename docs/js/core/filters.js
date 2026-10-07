/** フィルタ・ソート・ページ送りの状態と判定を管理する。 */
let page = 1;
let sortKey = null;
let sortAscending = true;
let keyword = "";
// データ概要から選択してテーブルへ移動したトリプルを1件に絞り込む。
let selectedOverviewTripleId = null;
const PAGE_SIZE = 100;
// 各フィルタで選択されている値を保持する。
const selectedTerms = new Set();
const selectedPrefectures = new Set();
const selectedSubjects = new Set();
const selectedObjects = new Set();
const selectedDocumentTypes = new Set();
const selectedStakeholderClasses = new Set();
const selectedStakeholderNames = new Set();
const selectedRelations = new Set();
const selectedTripleFirst = new Set();
const selectedTripleSecond = new Set();
// テキスト検索のアノテーション対象。プルダウンで選ぶ一方だけを保持する。
const selectedAnnotationTargets = new Set(["intermediate"]);
// テキスト入力から自動抽出した語で、主語・目的語の組を検索している状態。
let annotationTripleSearchActive = false;
const annotationTerms = new Set();
const excludedAnnotationTerms = new Set();
// 因果構造検索専用。テーブル上の発言者フィルタとは状態を共有しない。
const selectedStructuredStakeholderClasses = new Set();
const selectedStructuredStakeholderNames = new Set();

// 選択中のすべてのフィルタ条件を満たすトリプルだけを表示対象にする。
function matchesSelectedFilters(item) {
  const { triple } = item;
  const subjectClassLabels = getTripleClassLabels(triple, "s");
  const objectClassLabels = getTripleClassLabels(triple, "o");
  const classLabels = [...getTripleClassLabels(triple, "s"), ...getTripleClassLabels(triple, "o")];
  const matchesTerms = [...selectedTerms]
    .every(term => classLabels.some(label => isSameValue(label, term)));
  const matchesAnnotationSearch = matchesAnnotationTerms(triple);
  const matchesPrefectures = [...selectedPrefectures]
    .every(term => item.prefectures.some(prefecture => isSameValue(prefecture, term)));
  const matchesSubjects = [...selectedSubjects]
    .every(term => isSameValue(triple.sLabel, term));
  const matchesObjects = [...selectedObjects]
    .every(term => isSameValue(triple.oLabel, term));
  const matchesDocumentTypes = [...selectedDocumentTypes]
    .every(term => item.documentTypes.some(documentType => isSameValue(documentType, term)));
  const matchesStakeholderClasses = !selectedStakeholderClasses.size
    || [...selectedStakeholderClasses].some(term => item.stakeholderContexts.some(context => isSameValue(context.typeName || "未指定", term) || isSameValue(context.className || "未指定", term)));
  const matchesStakeholderNames = !selectedStakeholderNames.size
    || [...selectedStakeholderNames].some(term => item.stakeholderContexts.some(context => isSameValue(context.name, term)));
  const matchesStructuredStakeholderClasses = !selectedStructuredStakeholderClasses.size
    || [...selectedStructuredStakeholderClasses].some(term => item.stakeholderContexts.some(context => isSameValue(context.typeName || context.className || "未指定", term)));
  const matchesStructuredStakeholderNames = !selectedStructuredStakeholderNames.size
    || [...selectedStructuredStakeholderNames].some(term => item.stakeholderContexts.some(context => isSameValue(context.name, term)));
  const matchesRelations = !selectedRelations.size
    || [...selectedRelations].some(term => isSameValue(triple.pLabel, term));
  const matchesTripleFirst = !selectedTripleFirst.size
    || [...selectedTripleFirst].some(term => subjectClassLabels.some(classLabel => isSameValue(classLabel, term)));
  const matchesTripleSecond = !selectedTripleSecond.size
    || [...selectedTripleSecond].some(term => objectClassLabels.some(classLabel => isSameValue(classLabel, term)));

  const matchesOverviewTriple = selectedOverviewTripleId == null || String(item.triple.tplId) === String(selectedOverviewTripleId);
  return matchesKeyword(item)
    && matchesTerms && matchesAnnotationSearch && matchesPrefectures && matchesSubjects && matchesObjects && matchesRelations && matchesTripleFirst && matchesTripleSecond
    && matchesDocumentTypes && matchesStakeholderClasses && matchesStakeholderNames
    && matchesStructuredStakeholderClasses && matchesStructuredStakeholderNames && matchesOverviewTriple;
}

function matchesAnnotationTerms(triple) {
  if (!annotationTripleSearchActive) return true;

  const terms = getActiveAnnotationTerms();
  if (terms.length < 2) return false;
  const subjectMatches = terms.filter(term =>
    getAnnotationLabelsForSide(triple, "s").some(label => isSameValue(label, term))
  );
  const objectMatches = terms.filter(term =>
    getAnnotationLabelsForSide(triple, "o").some(label => isSameValue(label, term))
  );
  return subjectMatches.some(subjectTerm =>
    objectMatches.some(objectTerm => !isSameValue(subjectTerm, objectTerm))
  );
}

function getActiveAnnotationTerms() {
  return [...annotationTerms].filter(term => !excludedAnnotationTerms.has(term));
}

// 選択された種別だけを、テキスト検索のアノテーションおよび絞り込みに用いる。
function getAnnotationLabels(triple) {
  const labels = [
    ...getAnnotationLabelsForSide(triple, "s"),
    ...getAnnotationLabelsForSide(triple, "o")
  ];
  return [...new Set(labels)];
}

function getAnnotationLabelsForSide(triple, side) {
  const labels = [];
  if (selectedAnnotationTargets.has("intermediate")) labels.push(...(triple[`${side}TypeLabels`] || []));
  if (selectedAnnotationTargets.has("class")) labels.push(...(triple[`${side}ClassLabels`] || []));
  return [...new Set(labels)];
}

// キーワードはトリプル、ステークホルダー、意見を対象に部分一致で判定する。
function matchesKeyword(item) {
  const searchWord = normalize(keyword);
  if (!searchWord) return true;

  const { triple } = item;
  const values = [
    triple.sLabel, triple.pLabel, triple.oLabel,
    ...getTripleClassLabels(triple, "s"), ...getTripleClassLabels(triple, "o"),
    ...item.stakeholderContexts.flatMap(context => [context.typeName, context.className, context.name, ...context.opinions])
  ];
  return values.some(value => normalize(value).includes(searchWord));
}

// クリックされた要素の種類に対応する選択状態を返す。
function getSelectionSet(kind) {
  if (kind === "prefecture") return selectedPrefectures;
  if (kind === "subject") return selectedSubjects;
  if (kind === "object") return selectedObjects;
  if (kind === "document-type") return selectedDocumentTypes;
  if (kind === "stakeholder-class") return selectedStakeholderClasses;
  if (kind === "stakeholder-name") return selectedStakeholderNames;
  return selectedTerms;
}

// すべてのフィルタ選択を初期状態へ戻す。
function clearFilters() {
  selectedOverviewTripleId = null;
  annotationTripleSearchActive = false;
  annotationTerms.clear();
  excludedAnnotationTerms.clear();
  selectedTerms.clear();
  selectedPrefectures.clear();
  selectedSubjects.clear();
  selectedObjects.clear();
  selectedDocumentTypes.clear();
  selectedStakeholderClasses.clear();
  selectedStakeholderNames.clear();
  selectedRelations.clear();
  selectedTripleFirst.clear();
  selectedTripleSecond.clear();
  selectedStructuredStakeholderClasses.clear();
  selectedStructuredStakeholderNames.clear();
}
