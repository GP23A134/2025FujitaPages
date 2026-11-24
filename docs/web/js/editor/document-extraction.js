const SOURCE_URL = 'web/data/extraction/documents-classified.tsv';
const GRAPH_DATA_URLS = {
  instances: 'data/integrated/instance-data.json',
  assignments: 'data/integrated/instance-class-data.json',
  hierarchy: 'data/integrated/class-data.json',
  targets: 'data/integrated/target-class-data.json'
};
const PAGE_SIZE = 30;
const PREVIEW_ITEM_LIMIT = 5;

const style = document.createElement('style');
style.textContent = `
.document-extractor-dialog { width: min(92rem, calc(100vw - 2rem)); max-width: none; max-height: min(98dvh, 72rem); overflow: hidden; padding: 1.1rem; border: 1px solid #cbd5e1; border-radius: 14px; color: #1e293b; background: #fff; box-shadow: 0 20px 60px rgba(15,23,42,.28); }
.document-extractor-dialog::backdrop { background: rgba(15,23,42,.48); }
.document-extractor-header { display:flex; align-items:center; justify-content:space-between; gap:1rem; margin-bottom:.5rem; }
.document-extractor-header h2 { margin:0; color:#0f3d63; font-size:1.2rem; }
.document-extractor-close { width:2.3rem; height:2.3rem; border:1px solid #cbd5e1; border-radius:50%; color:#334155; background:#fff; font-size:1.2rem; cursor:pointer; }
.document-extractor-note { margin:.2rem 0 .9rem; color:#64748b; font-size:.85rem; }
.document-extractor-layout { display:grid; grid-template-columns:minmax(18rem,.9fr) minmax(0,1.4fr); gap:1rem; min-height:0; height:min(84dvh,60rem); }
.document-extractor-browser,.document-extractor-preview { display:flex; min-width:0; min-height:0; flex-direction:column; border:1px solid #dbe3ec; border-radius:9px; background:#f8fafc; }
.document-extractor-browser { padding:.75rem; }
.document-extractor-filters { display:grid; grid-template-columns:1fr 1fr; gap:.45rem; }
.document-extractor-filter { display:grid; min-width:0; gap:.2rem; color:#334155; font-size:.72rem; font-weight:700; }
.document-extractor-filter select { box-sizing:border-box; width:100%; min-height:2.25rem; padding:.35rem .45rem; border:1px solid #cbd5e1; border-radius:6px; color:#1e293b; background:#fff; font:inherit; font-weight:400; }
.document-extractor-search-row { display:flex; gap:.4rem; margin:.45rem 0 0; }
.document-extractor-search { box-sizing:border-box; width:100%; min-width:0; min-height:2.25rem; padding:.4rem .55rem; border:1px solid #cbd5e1; border-radius:6px; color:#1e293b; background:#fff; font:inherit; font-size:.78rem; }
.document-extractor-sort-criterion { box-sizing:border-box; flex:0 1 8.5rem; min-width:0; min-height:2.25rem; padding:.3rem .4rem; border:1px solid #cbd5e1; border-radius:6px; color:#334155; background:#fff; font:inherit; font-size:.7rem; }
.document-extractor-sort-direction { flex:0 0 2.25rem; min-height:2.25rem; padding:.3rem; border:1px solid #cbd5e1; border-radius:6px; color:#334155; background:#fff; cursor:pointer; font:inherit; font-size:.85rem; }
.document-extractor-results { display:flex; min-height:0; flex:1 1 auto; flex-direction:column; gap:.35rem; overflow-y:scroll; }
.document-extractor-result { display:block; width:100%; padding:.38rem .5rem; border:1px solid #dbe3ec; border-radius:7px; color:#1e293b; background:#fff; text-align:left; cursor:pointer; }
.document-extractor-result:hover,.document-extractor-result[aria-pressed="true"] { border-color:#0284c7; background:#e0f2fe; }
.document-extractor-result strong,.document-extractor-result span { display:block; overflow-wrap:anywhere; }
.document-extractor-result strong { font-size:.8rem; }
.document-extractor-result span { margin-top:.12rem; color:#64748b; font-size:.68rem; }
.document-extractor-result-meta { color:#64748b; font-size:.68rem; line-height:1.25; }
.document-extractor-pages { display:flex; flex:0 0 auto; align-items:center; justify-content:space-between; gap:.4rem; padding-top:.55rem; }
.document-extractor-pages button,.document-extractor-download { min-height:2.2rem; padding:.35rem .7rem; border:1px solid #cbd5e1; border-radius:6px; color:#334155; background:#fff; cursor:pointer; font:inherit; font-size:.8rem; }
.document-extractor-pages button:disabled,.document-extractor-download:disabled { color:#94a3b8; background:#f1f5f9; cursor:not-allowed; }
.document-extractor-page-label { color:#64748b; font-size:.75rem; }
.document-extractor-preview { padding:.75rem; }
.document-extractor-selected-document { flex:0 0 auto; margin:0 0 .55rem; padding:.55rem .7rem; border:1px solid #d8e2ea; border-radius:8px; color:#334155; background:#f8fafc; font-weight:700; overflow-wrap:anywhere; }
.document-extractor-view-switch { display:flex; flex:0 0 auto; gap:.35rem; margin:0 0 .55rem; }
.document-extractor-view-switch button { min-height:2rem; padding:.3rem .65rem; border:1px solid #cbd5e1; border-radius:6px; color:#334155; background:#fff; cursor:pointer; font:inherit; font-size:.75rem; }
.document-extractor-view-switch button[aria-pressed="true"] { border-color:#0369a1; color:#075985; background:#e0f2fe; font-weight:700; }
.document-extractor-tree { min-height:0; flex:1 1 auto; overflow:scroll; margin:0; padding:.65rem; border:1px solid #dbe3ec; border-radius:7px; background:#fff; }
.document-extractor-dialog [hidden] { display:none !important; }
.document-extractor-card-tree { display:grid; align-content:start; gap:.55rem; }
.document-extractor-tree-search { box-sizing:border-box; width:100%; min-height:2.1rem; padding:.4rem .55rem; border:1px solid #cbd5e1; border-radius:6px; outline:none; color:#334155; background:#fff; font:inherit; font-size:.78rem; }
.document-extractor-tree-search::placeholder { color:#94a3b8; }
.document-extractor-tree-search:focus { border-color:#1682b4; box-shadow:0 0 0 3px rgb(22 130 180 / 14%); }
.document-extractor-search-match { border-radius:2px; color:#713f12; background:#fef08a; font-weight:700; }
.document-extractor-tree-group { display:grid; gap:.45rem; min-width:0; }
.document-extractor-tree details { min-width:0; border-radius:9px; }
.document-extractor-tree details > summary { display:flex; flex-wrap:wrap; align-items:center; gap:.4rem; min-width:0; cursor:pointer; list-style:none; }
.document-extractor-tree details > summary::-webkit-details-marker { display:none; }
.document-extractor-tree details > summary::before { display:inline-grid; flex:0 0 1rem; width:1rem; height:1rem; place-items:center; color:#617184; content:'＋'; }
.document-extractor-tree details[open] > summary::before { content:'−'; }
.document-extractor-tree .level-top { padding:.55rem; border:1px solid #cfe0eb; border-left:4px solid #145b83; background:#f4f9fc; }
.document-extractor-tree .level-middle { margin:.45rem 0 0 .75rem; padding:.48rem; border:1px solid #d3e5e1; border-left:3px solid #167a83; background:#f3faf8; }
.document-extractor-tree .level-target { margin:.35rem 0 0 .6rem; padding:.42rem; border:1px solid #d5dff6; border-left:3px solid #7895e5; background:#f6f7fd; }
.document-extractor-tree-card-title { display:flex; flex:1 1 12rem; min-width:0; align-items:center; flex-wrap:wrap; gap:.35rem; font-size:.8rem; font-weight:700; }
.document-extractor-tree-card-count { flex:0 0 auto; color:#64748b; font-size:.72rem; font-weight:600; }
.document-extractor-tree-card-id { flex:0 1 auto; color:#53677b; font: .7rem ui-monospace,SFMono-Regular,Consolas,monospace; overflow-wrap:anywhere; }
.document-extractor-tree-card-children { min-width:0; }
.document-extractor-tree .level-top > summary .document-extractor-tree-card-title { color:#145b83; }
.document-extractor-tree .level-middle > summary .document-extractor-tree-card-title { color:#167a83; }
.document-extractor-tree .level-target > summary .document-extractor-tree-card-title { color:#315dc5; }
.document-extractor-tree .level-top > summary::before { color:#145b83; }
.document-extractor-tree .level-middle > summary::before { color:#167a83; }
.document-extractor-tree .level-target > summary::before { color:#315dc5; }
.document-extractor-tree-counts { color:#64748b; font-size:.72rem; }
.document-extractor-tree-instance { display:flex; flex-wrap:wrap; align-items:baseline; gap:.25rem .4rem; margin:.35rem 0 0 .55rem; padding:.35rem .45rem; border-left:2px dotted #b9c3ce; color:#596779; background:#fafbfc; font-size:.73rem; }
.document-extractor-tree-instance-name { overflow-wrap:anywhere; }
.document-extractor-tree-instance-id { color:#64748b; font: .73rem ui-monospace,SFMono-Regular,Consolas,monospace; overflow-wrap:anywhere; }
.document-extractor-result-counts { color:#075985 !important; }
.document-extractor-json { min-height:0; flex:1 1 auto; overflow:scroll; margin:0; padding:.75rem; border:1px solid #dbe3ec; border-radius:7px; color:#0f172a; background:#fff; font: .76rem/1.5 ui-monospace,SFMono-Regular,Consolas,monospace; white-space:pre; }
.document-extractor-tsv-preview { min-height:0; flex:1 1 auto; overflow:scroll; border:1px solid #dbe3ec; border-radius:7px; background:#fff; }
.document-extractor-results,.document-extractor-tree,.document-extractor-json,.document-extractor-tsv-preview { scrollbar-width:thin; scrollbar-color:#94a3b8 #f1f5f9; }
.document-extractor-results::-webkit-scrollbar,.document-extractor-tree::-webkit-scrollbar,.document-extractor-json::-webkit-scrollbar,.document-extractor-tsv-preview::-webkit-scrollbar { width:10px; height:10px; }
.document-extractor-results::-webkit-scrollbar-track,.document-extractor-tree::-webkit-scrollbar-track,.document-extractor-json::-webkit-scrollbar-track,.document-extractor-tsv-preview::-webkit-scrollbar-track { background:#f1f5f9; border-radius:999px; }
.document-extractor-results::-webkit-scrollbar-thumb,.document-extractor-tree::-webkit-scrollbar-thumb,.document-extractor-json::-webkit-scrollbar-thumb,.document-extractor-tsv-preview::-webkit-scrollbar-thumb { border:2px solid #f1f5f9; border-radius:999px; background:#94a3b8; }
.document-extractor-tsv-table { width:100%; border-collapse:collapse; color:#334155; font-size:.72rem; }
.document-extractor-tsv-table th,.document-extractor-tsv-table td { padding:.45rem .55rem; border:1px solid #dbe3ec; text-align:left; vertical-align:top; overflow-wrap:anywhere; }
.document-extractor-tsv-table th { position:sticky; top:0; z-index:1; color:#334155; background:#edf4f8; font-weight:700; }
.document-extractor-tsv-table tbody tr:nth-child(even) { background:#f8fafc; }
.document-extractor-preview-expand { min-height:2.2rem; flex:0 0 auto; margin:0; padding:.35rem .7rem; border:1px solid #cbd5e1; border-radius:6px; color:#334155; background:#fff; cursor:pointer; font:inherit; font-size:.8rem; }
.document-extractor-preview-note { align-self:flex-start; flex:0 0 auto; margin:.2rem 0; color:#64748b; font-size:.72rem; }
.document-extractor-empty { display:grid; min-height:0; flex:1 1 auto; place-items:center; padding:1rem; color:#64748b; text-align:center; }
.document-extractor-download { align-self:flex-end; flex:0 0 auto; margin-top:0; border-color:#0369a1; color:#fff; background:#0369a1; font-weight:700; }
.document-extractor-downloads { display:flex; flex:0 0 auto; align-items:center; justify-content:space-between; gap:.5rem; }
.document-extractor-download-actions { display:flex; gap:.5rem; }
.document-extractor-download:disabled { border-color:#cbd5e1; color:#94a3b8; background:#f1f5f9; }
@media (max-width: 760px) { .document-extractor-layout { grid-template-columns:minmax(0,1fr); height:75dvh; grid-template-rows:minmax(12rem,.75fr) minmax(12rem,1.25fr); } .document-extractor-dialog { padding:.75rem; } }
`;
document.head.append(style);

const headerActions = document.querySelector('.page-header-actions');
const isExtractorEnabled = new URLSearchParams(window.location.search).get('dev') === '2';
if (headerActions && isExtractorEnabled) {
  const openButton = document.createElement('button');
  openButton.type = 'button';
  openButton.className = 'page-link-button';
  openButton.textContent = '文書データ抽出';
  openButton.setAttribute('aria-haspopup', 'dialog');
  headerActions.insertBefore(openButton, document.getElementById('browse-link'));

  const dialog = document.createElement('dialog');
  dialog.className = 'document-extractor-dialog';
  dialog.setAttribute('aria-labelledby', 'document-extractor-title');
  dialog.innerHTML = `
    <div class="document-extractor-header">
      <h2 id="document-extractor-title">文書データ抽出</h2>
      <button type="button" class="document-extractor-close" aria-label="閉じる">×</button>
    </div>
    <div class="document-extractor-layout">
      <section class="document-extractor-browser" aria-label="文書一覧">
        <div class="document-extractor-filters">
          <label class="document-extractor-filter">都道府県<select data-filter="prefecture"><option value="">すべて</option></select></label>
          <label class="document-extractor-filter">資料種別<select data-filter="type"><option value="">すべて</option></select></label>
        </div>
        <div class="document-extractor-search-row">
          <input class="document-extractor-search" type="search" placeholder="ファイル名・文書IDを検索" aria-label="ファイル名・文書IDを検索">
          <select class="document-extractor-sort-criterion" data-sort-criterion aria-label="並び替え条件">
            <option value="id">文書ID</option>
            <option value="upper">上位クラス数</option>
            <option value="middle">中間クラス数</option>
            <option value="target">対象クラス数</option>
            <option value="instance" selected>インスタンス数</option>
            <option value="unclassifiedTarget">未分類対象クラス数</option>
          </select>
          <button type="button" class="document-extractor-sort-direction" data-sort-direction aria-label="降順">↓</button>
        </div>
        <div class="document-extractor-results" role="listbox" aria-label="抽出する文書"></div>
        <div class="document-extractor-pages">
          <button type="button" data-page="previous" disabled>前へ</button>
          <span class="document-extractor-page-label"></span>
          <button type="button" data-page="next" disabled>次へ</button>
        </div>
      </section>
      <section class="document-extractor-preview" aria-label="選択した文書のデータ">
        <div class="document-extractor-selected-document" hidden></div>
        <div class="document-extractor-view-switch" role="group" aria-label="表示形式">
          <button type="button" data-view="tree" aria-pressed="true">文書ツリー</button>
          <button type="button" data-view="json" aria-pressed="false">JSONプレビュー</button>
          <button type="button" data-view="tsv" aria-pressed="false">TSVプレビュー</button>
        </div>
        <div class="document-extractor-empty">左の一覧から文書を選択してください。</div>
        <pre class="document-extractor-json" hidden></pre>
        <div class="document-extractor-tsv-preview" hidden></div>
        <p class="document-extractor-preview-note" hidden></p>
        <div class="document-extractor-tree" hidden></div>
        <div class="document-extractor-downloads">
          <button type="button" class="document-extractor-preview-expand" hidden>すべて表示</button>
          <div class="document-extractor-download-actions">
            <button type="button" class="document-extractor-download" data-download="json" disabled>JSONを保存</button>
            <button type="button" class="document-extractor-download" data-download="tsv" disabled>TSVを保存</button>
          </div>
        </div>
      </section>
    </div>`;
  document.body.append(dialog);

  const filterControls = [...dialog.querySelectorAll('[data-filter]')];
  const searchControl = dialog.querySelector('.document-extractor-search');
  const sortCriterion = dialog.querySelector('[data-sort-criterion]');
  const sortDirectionButton = dialog.querySelector('[data-sort-direction]');
  const results = dialog.querySelector('.document-extractor-results');
  const pageLabel = dialog.querySelector('.document-extractor-page-label');
  const previousPage = dialog.querySelector('[data-page="previous"]');
  const nextPage = dialog.querySelector('[data-page="next"]');
  const empty = dialog.querySelector('.document-extractor-empty');
  const jsonPreview = dialog.querySelector('.document-extractor-json');
  const tsvPreview = dialog.querySelector('.document-extractor-tsv-preview');
  const previewNote = dialog.querySelector('.document-extractor-preview-note');
  const previewExpand = dialog.querySelector('.document-extractor-preview-expand');
  const selectedDocumentTitle = dialog.querySelector('.document-extractor-selected-document');
  const downloadActions = dialog.querySelector('.document-extractor-download-actions');
  const treePreview = dialog.querySelector('.document-extractor-tree');
  const viewButtons = [...dialog.querySelectorAll('[data-view]')];
  const downloadButtons = [...dialog.querySelectorAll('[data-download]')];
  let documents = [];
  let selectedDocument = null;
  let selectedJson = '';
  let selectedTsv = '';
  let selectedTsvRows = [];
  let selectedTree = null;
  let sortAscending = false;
  let graphData = null;
  let graphLoading = false;
  let activeView = 'tree';
  let showAllPreview = false;
  let page = 0;
  let loaded = false;

  function parseTsv(text) {
    const rows = [];
    let row = [];
    let field = '';
    let quoted = false;
    for (let index = 0; index < text.length; index += 1) {
      const char = text[index];
      if (quoted) {
        if (char === '"' && text[index + 1] === '"') { field += '"'; index += 1; }
        else if (char === '"') quoted = false;
        else field += char;
      } else if (char === '"' && field.length === 0) quoted = true;
      else if (char === '\t') { row.push(field); field = ''; }
      else if (char === '\n' || char === '\r') {
        if (char === '\r' && text[index + 1] === '\n') index += 1;
        row.push(field); field = '';
        if (row.some((cell) => cell.length)) rows.push(row);
        row = [];
      } else field += char;
    }
    if (field.length || row.length) { row.push(field); rows.push(row); }
    if (!rows.length) return [];
    const headers = rows.shift();
    return rows.map((cells) => Object.fromEntries(headers.map((header, index) => [header, cells[index] || ''])));
  }

  function toGraphRecord(record, state) {
    return {
      '文書情報': {
        'input_file': record.input_file,
        'output_file': record.output_file,
        '都道府県': record.prefecture,
        '資料種別': record['資料種別']
      },
      'クラス一覧': buildComparisonRows(state.tree)
    };
  }

  function shortId(id) {
    return String(id || '').split(/[/?#]/u).filter(Boolean).at(-1) || '';
  }

  function buildComparisonRows(nodes, path = []) {
    return nodes.flatMap((node) => {
      const kind = node.id.match(/\/class\/([tmc])_/u)?.[1];
      const nextPath = [...path, node];
      if (kind === 'c') {
        const ancestors = nextPath.slice(0, -1);
        const upper = ancestors.find((item) => item.id.includes('/class/t_'));
        return [{
          '上位クラス': upper ? toExportClass(upper) : null,
          '中間クラス': ancestors.filter((item) => item.id.includes('/class/m_'))
            .map(toExportClass),
          'クラス': toExportClass(node),
          'インスタンス': node.instances.map(toExportInstance)
        }];
      }
      return buildComparisonRows(node.children, nextPath);
    });
  }

  function toExportClass(item) {
    return { 'ID': shortId(item.id), 'label': item.label || item.id };
  }

  function toExportInstance(instance) {
    return { 'ID': shortId(instance.id), 'label': instance.label || '' };
  }

  function serializeGraphRecord(record, state) {
    return `${formatGraphJson(toGraphRecord(record, state))}\n`;
  }

  function formatGraphJson(value, depth = 0) {
    const indentation = '  '.repeat(depth);
    const childIndentation = '  '.repeat(depth + 1);
    if (Array.isArray(value)) {
      if (!value.length) return '[]';
      return `[\n${value.map((item) => `${childIndentation}${formatGraphJson(item, depth + 1)}`).join(',\n')}\n${indentation}]`;
    }
    if (value && typeof value === 'object') {
      const entries = Object.entries(value);
      if (entries.length === 2 && Object.hasOwn(value, 'ID') && Object.hasOwn(value, 'label')) {
        return JSON.stringify(value);
      }
      if (!entries.length) return '{}';
      return `{\n${entries.map(([key, item]) => `${childIndentation}${JSON.stringify(key)}: ${formatGraphJson(item, depth + 1)}`).join(',\n')}\n${indentation}}`;
    }
    return JSON.stringify(value);
  }

  function buildGraphTsvRows(state) {
    const targetRows = [];
    const appendTargetRows = (nodes, path = []) => nodes.forEach((node) => {
      const nextPath = [...path, node];
      if (node.id.includes('/class/c_')) {
        const matchingInstances = state.instances.filter((instance) => instance.classIds.includes(node.id));
        targetRows.push({ path: nextPath, instances: matchingInstances.length ? matchingInstances : [null] });
      }
      appendTargetRows(node.children, nextPath);
    });
    appendTargetRows(state.tree);
    const middleDepth = Math.max(1, ...targetRows.map(({ path }) => path.filter((item) => item.id.includes('/class/m_')).length));
    const headers = ['上位クラスID', '上位クラス名'];
    for (let level = 1; level <= middleDepth; level += 1) headers.push(`中間クラス${level}ID`, `中間クラス${level}名`);
    headers.push('対象クラスID', '対象クラス名', 'インスタンスID', 'インスタンス名');
    const rows = targetRows.flatMap(({ path, instances }) => instances.map((instance) => {
      const upper = path.find((item) => item.id.includes('/class/t_'));
      const middles = path.filter((item) => item.id.includes('/class/m_'));
      const row = [upper?.id || '', upper?.label || ''];
      for (let level = 0; level < middleDepth; level += 1) {
        row.push(middles[level]?.id || '', middles[level]?.label || '');
      }
      const target = path.at(-1);
      row.push(target.id, target.label || '', instance?.id || '', instance?.label || '');
      return row;
    }));
    return [headers, ...rows];
  }

  function serializeGraphTsv(rows) {
    return `${rows.map((row) => row.map(escapeTsvCell).join('\t')).join('\r\n')}\r\n`;
  }

  function escapeTsvCell(value) {
    const text = String(value ?? '');
    return /[\t\r\n"]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  }

  function documentNumber(record) {
    const iriPath = (record.documentIRI || '').split(/[?#]/u, 1)[0];
    const lastSegment = iriPath.slice(iriPath.lastIndexOf('/') + 1);
    if (/^\d+$/u.test(lastSegment)) return lastSegment;
    return iriPath.match(/id_(\d+)_/u)?.[1] || '';
  }

  function indexGraphData(instanceData, assignmentData, hierarchyData, targetData) {
    const instancesByDocument = new Map();
    const instancesById = new Map();
    const classIdsByInstance = new Map();
    const instancesByClass = new Map();
    const parents = new Map();
    const classes = new Map([...hierarchyData.classes, ...targetData.classes].map((item) => [item.id, item]));
    (instanceData.instances || []).forEach((instance) => {
      instancesById.set(instance.id, instance);
      const number = instance.id.match(/\/id_(\d+)_/u)?.[1];
      if (number) {
        const list = instancesByDocument.get(number) || [];
        list.push(instance);
        instancesByDocument.set(number, list);
      }
    });
    (assignmentData.relations || []).forEach((assignment) => {
      const classIds = classIdsByInstance.get(assignment.instance) || [];
      classIds.push(assignment.class);
      classIdsByInstance.set(assignment.instance, classIds);
      const instance = instancesById.get(assignment.instance);
      if (instance) {
        const list = instancesByClass.get(assignment.class) || [];
        list.push(instance);
        instancesByClass.set(assignment.class, list);
      }
    });
    (hierarchyData.relations || []).forEach((relation) => {
      if (relation.relation !== 'subClassOf') return;
      const list = parents.get(relation.child) || [];
      list.push(relation.parent);
      parents.set(relation.child, list);
    });
    return { instancesByDocument, instancesById, classIdsByInstance, instancesByClass, parents, classes };
  }

  function classesForDocument(record, includeTree = true) {
    if (!graphData) return { available: false, instances: [], targets: [], counts: { upper: 0, middle: 0, target: 0, instance: 0, depth: 0, unclassified: 0 }, tree: [] };
    const number = documentNumber(record);
    const instances = number ? graphData.instancesByDocument.get(number) || [] : [];
    const instanceIds = new Set(instances.map((item) => item.id));
    const targetIds = new Set();
    instances.forEach((instance) => (graphData.classIdsByInstance.get(instance.id) || []).forEach((id) => targetIds.add(id)));
    const parents = graphData.parents;
    const classes = graphData.classes;
    const reachable = new Set();
    const visitParents = (id) => (parents.get(id) || []).forEach((parent) => {
      if (!reachable.has(parent)) { reachable.add(parent); visitParents(parent); }
    });
    targetIds.forEach((id) => { reachable.add(id); visitParents(id); });
    const countKind = (kind) => [...reachable].filter((id) => id.includes(`/class/${kind}_`)).length;
    const isUnderUnclassifiedUpper = (id) => {
      const pending = [...(parents.get(id) || [])];
      const visited = new Set();
      while (pending.length) {
        const parent = pending.pop();
        if (visited.has(parent)) continue;
        visited.add(parent);
        if (parent.includes('/class/t_') && classes.get(parent)?.label === '未分類') return true;
        pending.push(...(parents.get(parent) || []));
      }
      return false;
    };
    const unclassified = [...reachable]
      .filter((id) => id.includes('/class/c_') && isUnderUnclassifiedUpper(id)).length;
    const getDepth = (id, path = new Set()) => {
      if (path.has(id)) return 0;
      const nextPath = new Set(path).add(id);
      const parentDepths = (parents.get(id) || []).filter((parent) => reachable.has(parent))
        .map((parent) => getDepth(parent, nextPath));
      return 1 + Math.max(0, ...parentDepths);
    };
    const depth = Math.max(0, ...[...targetIds].filter((id) => id.includes('/class/c_')).map((id) => getDepth(id)));
    const counts = { upper: countKind('t'), middle: countKind('m'), target: countKind('c'), instance: instances.length, depth, unclassified };
    if (!includeTree) return { available: true, instances: [], targets: [], classLabels: {}, counts, tree: [] };
    const children = new Map();
    [...reachable].forEach((id) => {
      const item = classes.get(id);
      if (!item) return;
      const ancestors = (parents.get(id) || []).filter((parent) => reachable.has(parent));
      const parentId = ancestors[0] || '';
      const list = children.get(parentId) || [];
      list.push(item);
      children.set(parentId, list);
    });
    const makeTree = (parentId) => (children.get(parentId) || []).sort((a, b) => a.label.localeCompare(b.label, 'ja-JP'))
      .map((item) => ({ ...item, children: makeTree(item.id), instances: (graphData.instancesByClass.get(item.id) || []).filter((instance) => instanceIds.has(instance.id)) }));
    const classLabels = Object.fromEntries([...new Set(instances.flatMap((instance) => graphData.classIdsByInstance.get(instance.id) || []))]
      .map((id) => [id, classes.get(id)?.label || id]));
    const instancesWithClasses = instances.map((instance) => ({
      ...instance,
      classIds: [...new Set(graphData.classIdsByInstance.get(instance.id) || [])]
    }));
    return {
      available: true,
      instances: instancesWithClasses,
      targets: [...targetIds],
      classLabels,
      counts,
      tree: makeTree('')
    };
  }

  function renderDocumentTree(data) {
    treePreview.replaceChildren();
    const cardTree = document.createElement('div');
    cardTree.className = 'document-extractor-card-tree';
    const search = document.createElement('input');
    search.type = 'search';
    search.className = 'document-extractor-tree-search';
    search.placeholder = 'クラス名・ID・インスタンスを検索';
    search.setAttribute('aria-label', 'ツリー内を検索');
    const classContainer = document.createElement('div');
    classContainer.className = 'document-extractor-tree-results';
    cardTree.append(search, classContainer);
    const setHighlightedText = (element, text) => {
      const value = String(text ?? '');
      const query = search.value.trim();
      if (!query) { element.textContent = value; return; }
      const escaped = query.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
      const expression = new RegExp(escaped, 'giu');
      let cursor = 0;
      let match;
      element.replaceChildren();
      while ((match = expression.exec(value)) !== null) {
        element.append(document.createTextNode(value.slice(cursor, match.index)));
        const mark = document.createElement('mark');
        mark.className = 'document-extractor-search-match';
        mark.textContent = match[0];
        element.append(mark);
        cursor = match.index + match[0].length;
      }
      element.append(document.createTextNode(value.slice(cursor)));
    };
    const renderClassNodes = (nodes) => {
      const group = document.createElement('div');
      group.className = 'document-extractor-tree-group';
      nodes.forEach((node) => {
        const details = document.createElement('details');
        const kind = node.id.match(/\/class\/([tmc])_/u)?.[1];
        const kindName = { t: 'top', m: 'middle', c: 'target' }[kind] || 'target';
        details.className = `level-${kindName}`;
        details.open = true;
        const summaryNode = document.createElement('summary');
        const label = document.createElement('span');
        label.className = 'document-extractor-tree-card-title';
        setHighlightedText(label, node.label || node.id);
        const kindLabel = { t: '上位クラス', m: '中間クラス', c: '対象クラス' }[kind] || 'クラス';
        label.setAttribute('aria-label', `${kindLabel}: ${node.label || node.id}`);
        const count = document.createElement('span');
        count.className = 'document-extractor-tree-card-count';
        count.textContent = node.children.length ? `下位 ${node.children.length}件` : `${node.instances.length}件`;
        const classId = document.createElement('code');
        classId.className = 'document-extractor-tree-card-id';
        setHighlightedText(classId, node.id.split('/').pop());
        classId.title = node.id;
        summaryNode.append(classId, label, count);
        details.append(summaryNode);
        if (node.children.length || node.instances.length) {
          const nested = document.createElement('div');
          nested.className = 'document-extractor-tree-card-children';
          if (node.children.length) nested.append(renderClassNodes(node.children));
          node.instances.forEach((instance) => {
            const instanceRow = document.createElement('div');
            instanceRow.className = 'document-extractor-tree-instance';
            const instanceName = document.createElement('span');
            instanceName.className = 'document-extractor-tree-instance-name';
            setHighlightedText(instanceName, instance.label || instance.id);
            const instanceId = document.createElement('code');
            instanceId.className = 'document-extractor-tree-instance-id';
            setHighlightedText(instanceId, instance.id.split('/').pop());
            instanceId.title = instance.id;
            instanceRow.append(instanceId, instanceName);
            nested.append(instanceRow);
          });
          details.append(nested);
        }
        group.append(details);
      });
      return group;
    };
    const filterTree = (nodes, query) => {
      if (!query) return nodes;
      const needle = query.toLocaleLowerCase('ja-JP');
      return nodes.flatMap((node) => {
        const matchesNode = `${node.label || ''} ${node.id}`.toLocaleLowerCase('ja-JP').includes(needle);
        if (matchesNode) return [node];
        const children = filterTree(node.children, query);
        const instances = node.instances.filter((instance) => `${instance.label || ''} ${instance.id}`.toLocaleLowerCase('ja-JP').includes(needle));
        return children.length || instances.length ? [{ ...node, children, instances }] : [];
      });
    };
    const renderFilteredTree = () => {
      const filtered = filterTree(data.tree, search.value.trim());
      classContainer.replaceChildren();
      if (filtered.length) classContainer.append(renderClassNodes(filtered));
      else if (data.available && data.instances.length) {
        const noMatches = document.createElement('p');
        noMatches.className = 'document-extractor-tree-counts';
        noMatches.textContent = '一致するクラス・インスタンスはありません。';
        classContainer.append(noMatches);
      }
    };
    search.addEventListener('input', renderFilteredTree);
    renderFilteredTree();
    if (!data.available || !data.instances.length) {
      const message = document.createElement('p');
      message.className = 'document-extractor-tree-counts';
      message.textContent = data.available ? 'この文書IDに一致するインスタンスが見つかりません。' : graphLoading ? 'クラス・インスタンスデータを読み込んでいます…' : 'クラス・インスタンスデータを読み込めません。';
      cardTree.append(message);
    }
    treePreview.append(cardTree);
  }

  function renderActiveView() {
    const hasSelection = Boolean(selectedDocument);
    jsonPreview.hidden = !hasSelection || activeView !== 'json';
    tsvPreview.hidden = !hasSelection || activeView !== 'tsv';
    treePreview.hidden = !hasSelection || activeView !== 'tree';
    viewButtons.forEach((button) => button.setAttribute('aria-pressed', String(button.dataset.view === activeView)));
    const isDataView = activeView === 'json' || activeView === 'tsv';
    downloadActions.hidden = !hasSelection || !isDataView;
    downloadButtons.forEach((button) => { button.hidden = !hasSelection || button.dataset.download !== activeView; });
    const comparisonRows = selectedTree ? buildComparisonRows(selectedTree.tree) : [];
    const hasMore = activeView === 'json'
      ? comparisonRows.length > PREVIEW_ITEM_LIMIT || comparisonRows.some((row) => row['インスタンス'].length > PREVIEW_ITEM_LIMIT)
      : activeView === 'tsv' && selectedTsvRows.length > PREVIEW_ITEM_LIMIT + 1;
    previewNote.hidden = !hasSelection || !isDataView || showAllPreview || !hasMore;
    previewNote.textContent = activeView === 'json'
      ? `一部表示：クラス一覧と各クラスのインスタンスを先頭${PREVIEW_ITEM_LIMIT}件表示しています。保存ファイルには全件含まれます。`
      : `一部表示：先頭${PREVIEW_ITEM_LIMIT}行です。保存ファイルには全行含まれます。`;
    previewExpand.hidden = !hasSelection || !isDataView || !hasMore;
    previewExpand.textContent = showAllPreview ? '一部表示に戻す' : 'すべて表示';
    if (activeView === 'json') jsonPreview.textContent = renderJsonPreview();
    if (activeView === 'tsv') renderTsvPreview();
  }

  function renderJsonPreview() {
    if (showAllPreview || !selectedJson || !selectedTree) return selectedJson;
    const data = JSON.parse(selectedJson);
    const allRows = data['クラス一覧'];
    data['クラス一覧'] = allRows.slice(0, PREVIEW_ITEM_LIMIT).map((row) => ({
      ...row,
      'インスタンス': row['インスタンス'].slice(0, PREVIEW_ITEM_LIMIT)
    }));
    if (allRows.length > PREVIEW_ITEM_LIMIT) data['残りクラス数'] = allRows.length - PREVIEW_ITEM_LIMIT;
    return `${formatGraphJson(data)}\n`;
  }

  function renderTsvPreview() {
    tsvPreview.replaceChildren();
    if (!selectedTsvRows.length) return;
    const [headers, ...dataRows] = selectedTsvRows;
    const visibleRows = showAllPreview ? dataRows : dataRows.slice(0, PREVIEW_ITEM_LIMIT);
    const table = document.createElement('table');
    table.className = 'document-extractor-tsv-table';
    const thead = document.createElement('thead');
    const headerRow = document.createElement('tr');
    headers.forEach((header) => {
      const cell = document.createElement('th');
      cell.scope = 'col';
      cell.textContent = header;
      headerRow.append(cell);
    });
    thead.append(headerRow);
    const tbody = document.createElement('tbody');
    visibleRows.forEach((row) => {
      const tableRow = document.createElement('tr');
      row.forEach((value, columnIndex) => {
        const cell = document.createElement('td');
        const isId = headers[columnIndex]?.endsWith('ID') && /^https?:\/\//u.test(value);
        if (isId) {
          cell.textContent = value.split(/[/?#]/u).filter(Boolean).at(-1) || value;
          cell.title = value;
        } else cell.textContent = value;
        tableRow.append(cell);
      });
      tbody.append(tableRow);
    });
    table.append(thead, tbody);
    tsvPreview.append(table);
  }

  function filteredDocuments() {
    const selected = Object.fromEntries(filterControls.map((control) => [control.dataset.filter, control.value]));
    const query = searchControl.value.trim().toLocaleLowerCase('ja-JP');
    const matches = documents.filter((record) => (!selected.prefecture || record.prefecture === selected.prefecture)
      && (!selected.type || record['資料種別'] === selected.type)
      && (!query || `${record.input_file || ''} ${shortId(record.documentIRI)}`.toLocaleLowerCase('ja-JP').includes(query)));
    const criterion = sortCriterion.value;
    const sortValues = new Map(matches.map((record) => [record, criterion === 'id'
      ? Number(documentNumber(record))
      : classesForDocument(record, false).counts[criterion]]));
    matches.sort((left, right) => {
      const difference = Number(sortValues.get(left)) - Number(sortValues.get(right));
      if (Number.isFinite(difference) && difference !== 0) return sortAscending ? difference : -difference;
      return String(left.documentIRI).localeCompare(String(right.documentIRI), 'ja-JP');
    });
    return matches;
  }

  function populateFilters() {
    const prefectureControl = filterControls.find((control) => control.dataset.filter === 'prefecture');
    [...new Set(documents.map((record) => record.prefecture).filter(Boolean))]
      .sort((a, b) => a.localeCompare(b, 'ja-JP'))
      .forEach((value) => {
        const option = document.createElement('option');
        option.value = value;
        option.dataset.prefectureName = value;
        option.textContent = value;
        prefectureControl.append(option);
      });
    const typeControl = filterControls.find((control) => control.dataset.filter === 'type');
    [...new Set(documents.map((record) => record['資料種別']).filter(Boolean))]
      .sort((a, b) => a.localeCompare(b, 'ja-JP')).forEach((type) => {
      const option = document.createElement('option');
      option.value = type;
      option.dataset.typeName = type;
      typeControl.append(option);
    });
    updateFilterOptionCounts();
  }

  function updateFilterOptionCounts() {
    const prefectureControl = filterControls.find((control) => control.dataset.filter === 'prefecture');
    const typeControl = filterControls.find((control) => control.dataset.filter === 'type');
    const selectedType = typeControl.value;
    [...prefectureControl.options].forEach((option) => {
      const prefecture = option.value;
      const matchedCount = documents.filter((record) => (!prefecture || record.prefecture === prefecture)
        && (!selectedType || record['資料種別'] === selectedType)).length;
      const label = prefecture ? option.dataset.prefectureName : 'すべて';
      option.dataset.count = String(matchedCount);
      option.textContent = `${label}（${matchedCount.toLocaleString('ja-JP')}件）`;
    });

    const selectedPrefecture = prefectureControl.value;
    [...typeControl.options].forEach((option) => {
      const type = option.value;
      const matchedCount = documents.filter((record) => (!selectedPrefecture || record.prefecture === selectedPrefecture)
        && (!type || record['資料種別'] === type)).length;
      const label = type ? option.dataset.typeName : 'すべて';
      option.dataset.count = String(matchedCount);
      option.textContent = `${label}（${matchedCount.toLocaleString('ja-JP')}件）`;
    });

    const sortOptionsByCount = (control, labelKey) => {
      const selectedValue = control.value;
      const allOption = [...control.options].find((option) => !option.value);
      const countedOptions = [...control.options].filter((option) => option.value)
        .sort((left, right) => Number(right.dataset.count) - Number(left.dataset.count)
          || left.dataset[labelKey].localeCompare(right.dataset[labelKey], 'ja-JP'));
      control.replaceChildren(...[allOption, ...countedOptions].filter(Boolean));
      control.value = selectedValue;
    };
    sortOptionsByCount(prefectureControl, 'prefectureName');
    sortOptionsByCount(typeControl, 'typeName');
  }

  function selectDocument(record) {
    selectedDocument = record;
    selectedDocumentTitle.textContent = record.input_file || record.documentIRI;
    selectedDocumentTitle.hidden = false;
    selectedTree = classesForDocument(record);
    selectedJson = serializeGraphRecord(record, selectedTree);
    selectedTsvRows = buildGraphTsvRows(selectedTree);
    selectedTsv = serializeGraphTsv(selectedTsvRows);
    showAllPreview = false;
    empty.hidden = true;
    renderDocumentTree(selectedTree);
    downloadButtons.forEach((button) => { button.disabled = !selectedTree.available; });
    renderActiveView();
  }

  function resetPreview() {
    selectedDocument = null;
    selectedJson = '';
    selectedTsv = '';
    selectedTsvRows = [];
    selectedTree = null;
    selectedDocumentTitle.textContent = '';
    selectedDocumentTitle.hidden = true;
    showAllPreview = false;
    empty.hidden = false;
    empty.textContent = documents.length ? '左の一覧から文書を選択してください。' : '抽出できる文書がありません。';
    jsonPreview.hidden = true;
    jsonPreview.textContent = '';
    tsvPreview.replaceChildren();
    tsvPreview.hidden = true;
    downloadButtons.forEach((button) => { button.disabled = true; });
    renderActiveView();
  }

  function renderResults() {
    const matches = filteredDocuments();
    const pageCount = Math.max(1, Math.ceil(matches.length / PAGE_SIZE));
    page = Math.max(0, Math.min(page, pageCount - 1));
    const start = page * PAGE_SIZE;
    const visible = matches.slice(start, start + PAGE_SIZE);
    results.replaceChildren();
    visible.forEach((record) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'document-extractor-result';
      button.setAttribute('role', 'option');
      button.setAttribute('aria-selected', String(record === selectedDocument));
      button.setAttribute('aria-pressed', String(record === selectedDocument));
      const title = document.createElement('strong');
      title.textContent = record.input_file || record.documentIRI;
      const meta = document.createElement('div');
      meta.className = 'document-extractor-result-meta';
      meta.textContent = `ID: ${shortId(record.documentIRI)} ・ ${record.prefecture} ・ ${record['資料種別']}`;
      button.append(title, meta);
      if (graphData) {
        const state = classesForDocument(record, false);
        const counts = document.createElement('span');
        counts.className = 'document-extractor-result-counts';
        counts.textContent = `上位クラス数 ${state.counts.upper} ・ 中間クラス数 ${state.counts.middle} ・ 対象クラス数 ${state.counts.target} ・ インスタンス数 ${state.counts.instance} ・ 最大深さ ${state.counts.depth} ・ 未分類 ${state.counts.unclassified}`;
        button.append(counts);
      }
      button.addEventListener('click', () => {
        selectDocument(record);
        renderResults();
      });
      results.append(button);
    });
    pageLabel.textContent = `${page + 1} / ${pageCount}ページ`;
    previousPage.disabled = page <= 0;
    nextPage.disabled = page >= pageCount - 1;
    if (!matches.length && loaded) {
      const note = document.createElement('p');
      note.className = 'document-extractor-empty';
      note.textContent = '検索条件に一致する文書はありません。';
      results.append(note);
    }
  }

  async function loadDocuments() {
    if (loaded) return;
    try {
      const response = await fetch(SOURCE_URL, { cache: 'no-cache' });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      documents = parseTsv(await response.text()).filter((record) => record.documentIRI && record.input_file);
      loaded = true;
      populateFilters();
      resetPreview();
      renderResults();
      void loadGraphData();
    } catch {
      documents = [];
      loaded = true;
      resetPreview();
    }
  }

  async function loadGraphData() {
    graphLoading = true;
    try {
      const responses = await Promise.all(Object.values(GRAPH_DATA_URLS).map((url) => fetch(url, { cache: 'force-cache' })));
      if (responses.some((response) => !response.ok)) throw new Error('グラフデータを読み込めません');
      const [instanceData, assignmentData, hierarchyData, targetData] = await Promise.all(responses.map((response) => response.json()));
      graphData = indexGraphData(instanceData, assignmentData, hierarchyData, targetData);
      graphLoading = false;
      renderResults();
      if (selectedDocument) selectDocument(selectedDocument);
    } catch {
      graphData = null;
      graphLoading = false;
      if (selectedDocument) renderDocumentTree(selectedTree);
    }
  }

  openButton.addEventListener('click', () => {
    dialog.showModal();
    void loadDocuments();
    filterControls[0].focus();
  });
  dialog.querySelector('.document-extractor-close').addEventListener('click', () => dialog.close());
  dialog.addEventListener('click', (event) => { if (event.target === dialog) dialog.close(); });
  filterControls.forEach((control) => control.addEventListener('change', () => {
    updateFilterOptionCounts();
    page = 0;
    resetPreview();
    renderResults();
  }));
  searchControl.addEventListener('input', () => {
    page = 0;
    resetPreview();
    renderResults();
  });
  sortCriterion.addEventListener('change', () => {
    page = 0;
    resetPreview();
    renderResults();
  });
  sortDirectionButton.addEventListener('click', () => {
    sortAscending = !sortAscending;
    sortDirectionButton.textContent = sortAscending ? '↑' : '↓';
    sortDirectionButton.setAttribute('aria-label', sortAscending ? '昇順' : '降順');
    page = 0;
    resetPreview();
    renderResults();
  });
  previousPage.addEventListener('click', () => { page -= 1; resetPreview(); renderResults(); });
  nextPage.addEventListener('click', () => { page += 1; resetPreview(); renderResults(); });
  viewButtons.forEach((button) => button.addEventListener('click', () => {
    activeView = button.dataset.view;
    renderActiveView();
  }));
  previewExpand.addEventListener('click', () => {
    showAllPreview = !showAllPreview;
    renderActiveView();
  });
  downloadButtons.forEach((button) => button.addEventListener('click', () => {
    const format = button.dataset.download;
    const content = format === 'tsv' ? selectedTsv : selectedJson;
    if (!selectedDocument || !content) return;
    const blob = new Blob([format === 'tsv' ? `\uFEFF${content}` : content], {
      type: format === 'tsv' ? 'text/tab-separated-values;charset=utf-8' : 'application/json;charset=utf-8'
    });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    const fileStem = (selectedDocument.output_file || selectedDocument.documentIRI.split('/').pop())
      .replace(/\.[^.]+$/u, '').replace(/[^\p{L}\p{N}._-]+/gu, '_');
    anchor.href = url;
    anchor.download = `document-${fileStem || 'record'}.${format}`;
    anchor.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }));
}
