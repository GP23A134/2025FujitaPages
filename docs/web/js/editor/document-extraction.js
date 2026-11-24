const SOURCE_URL = 'web/data/extraction/documents-classified.tsv';
const GRAPH_DATA_URLS = {
  instances: 'data/integrated/instance-data.json',
  assignments: 'data/integrated/instance-class-data.json',
  hierarchy: 'data/integrated/class-data.json',
  targets: 'data/integrated/target-class-data.json'
};
const PAGE_SIZE = 30;

const style = document.createElement('style');
style.textContent = `
.document-extractor-dialog { width: min(92rem, calc(100vw - 2rem)); max-width: none; max-height: min(94dvh, 72rem); overflow: hidden; padding: 1.1rem; border: 1px solid #cbd5e1; border-radius: 14px; color: #1e293b; background: #fff; box-shadow: 0 20px 60px rgba(15,23,42,.28); }
.document-extractor-dialog::backdrop { background: rgba(15,23,42,.48); }
.document-extractor-header { display:flex; align-items:center; justify-content:space-between; gap:1rem; margin-bottom:.5rem; }
.document-extractor-header h2 { margin:0; color:#0f3d63; font-size:1.2rem; }
.document-extractor-close { width:2.3rem; height:2.3rem; border:1px solid #cbd5e1; border-radius:50%; color:#334155; background:#fff; font-size:1.2rem; cursor:pointer; }
.document-extractor-note { margin:.2rem 0 .9rem; color:#64748b; font-size:.85rem; }
.document-extractor-layout { display:grid; grid-template-columns:minmax(18rem,.9fr) minmax(0,1.4fr); gap:1rem; min-height:0; height:min(78dvh,56rem); }
.document-extractor-browser,.document-extractor-preview { display:flex; min-width:0; min-height:0; flex-direction:column; border:1px solid #dbe3ec; border-radius:9px; background:#f8fafc; }
.document-extractor-browser { padding:.75rem; }
.document-extractor-filters { display:grid; grid-template-columns:1fr 1fr; gap:.45rem; }
.document-extractor-filter { display:grid; min-width:0; gap:.2rem; color:#334155; font-size:.72rem; font-weight:700; }
.document-extractor-filter select { box-sizing:border-box; width:100%; min-height:2.25rem; padding:.35rem .45rem; border:1px solid #cbd5e1; border-radius:6px; color:#1e293b; background:#fff; font:inherit; font-weight:400; }
.document-extractor-distribution { flex:0 0 auto; max-height:10rem; overflow-y:auto; margin:.45rem 0 0; padding:.5rem .55rem; border:1px solid #dbe3ec; border-radius:7px; background:#fff; }
.document-extractor-distribution h3 { margin:0 0 .35rem; color:#334155; font-size:.75rem; }
.document-extractor-distribution-row { display:grid; grid-template-columns:minmax(5rem,auto) minmax(2rem,1fr) 2.5rem; gap:.35rem; align-items:center; margin:.22rem 0; font-size:.68rem; }
.document-extractor-distribution-label { overflow-wrap:anywhere; color:#475569; }
.document-extractor-distribution-track { height:.42rem; overflow:hidden; border-radius:999px; background:#e2e8f0; }
.document-extractor-distribution-bar { height:100%; border-radius:inherit; background:#0284c7; }
.document-extractor-distribution-value { color:#334155; text-align:right; font-variant-numeric:tabular-nums; }
.document-extractor-count { flex:0 0 auto; margin:.55rem 0; color:#64748b; font-size:.76rem; }
.document-extractor-results { display:flex; min-height:0; flex:1 1 auto; flex-direction:column; gap:.35rem; overflow-y:auto; }
.document-extractor-result { display:block; width:100%; padding:.55rem .6rem; border:1px solid #dbe3ec; border-radius:7px; color:#1e293b; background:#fff; text-align:left; cursor:pointer; }
.document-extractor-result:hover,.document-extractor-result[aria-pressed="true"] { border-color:#0284c7; background:#e0f2fe; }
.document-extractor-result strong,.document-extractor-result span { display:block; overflow-wrap:anywhere; }
.document-extractor-result strong { font-size:.8rem; }
.document-extractor-result span { margin-top:.2rem; color:#64748b; font-size:.7rem; }
.document-extractor-pages { display:flex; flex:0 0 auto; align-items:center; justify-content:space-between; gap:.4rem; padding-top:.55rem; }
.document-extractor-pages button,.document-extractor-download { min-height:2.2rem; padding:.35rem .7rem; border:1px solid #cbd5e1; border-radius:6px; color:#334155; background:#fff; cursor:pointer; font:inherit; font-size:.8rem; }
.document-extractor-pages button:disabled,.document-extractor-download:disabled { color:#94a3b8; background:#f1f5f9; cursor:not-allowed; }
.document-extractor-page-label { color:#64748b; font-size:.75rem; }
.document-extractor-preview { padding:.75rem; }
.document-extractor-preview-title { margin:0 0 .55rem; color:#334155; font-size:.9rem; }
.document-extractor-view-switch { display:flex; flex:0 0 auto; gap:.35rem; margin:0 0 .55rem; }
.document-extractor-view-switch button { min-height:2rem; padding:.3rem .65rem; border:1px solid #cbd5e1; border-radius:6px; color:#334155; background:#fff; cursor:pointer; font:inherit; font-size:.75rem; }
.document-extractor-view-switch button[aria-pressed="true"] { border-color:#0369a1; color:#075985; background:#e0f2fe; font-weight:700; }
.document-extractor-tree { min-height:0; flex:1 1 auto; overflow:auto; margin:0; padding:.65rem; border:1px solid #dbe3ec; border-radius:7px; background:#fff; }
.document-extractor-tree ul { margin:.2rem 0 .2rem 1rem; padding-left:1rem; border-left:1px solid #cbd5e1; list-style:none; }
.document-extractor-tree li { margin:.25rem 0; }
.document-extractor-tree details > summary { cursor:pointer; }
.document-extractor-tree-counts { color:#64748b; font-size:.72rem; }
.document-extractor-tree-label { overflow-wrap:anywhere; }
.document-extractor-result-counts { color:#075985 !important; }
.document-extractor-status { flex:0 0 auto; margin-bottom:.55rem; padding:.55rem .65rem; border:1px solid #cbd5e1; border-radius:7px; background:#fff; }
.document-extractor-status-top { display:flex; flex-wrap:wrap; gap:.35rem .8rem; font-size:.75rem; }
.document-extractor-status-top strong { color:#075985; }
.document-extractor-status-reason { margin:.4rem 0 0; color:#475569; font-size:.72rem; line-height:1.45; }
.document-extractor-json { min-height:0; flex:1 1 auto; overflow:auto; margin:0; padding:.75rem; border:1px solid #dbe3ec; border-radius:7px; color:#0f172a; background:#fff; font: .76rem/1.5 ui-monospace,SFMono-Regular,Consolas,monospace; white-space:pre; }
.document-extractor-empty { display:grid; min-height:0; flex:1 1 auto; place-items:center; padding:1rem; color:#64748b; text-align:center; }
.document-extractor-download { align-self:flex-end; flex:0 0 auto; margin-top:.6rem; border-color:#0369a1; color:#fff; background:#0369a1; font-weight:700; }
.document-extractor-downloads { display:flex; flex:0 0 auto; justify-content:flex-end; gap:.5rem; }
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
    <p class="document-extractor-note">都道府県・資料種別で絞り込み、一覧から文書を選択してください。クラスとインスタンスの構成をJSONまたはTSVで確認・保存できます。文書本文はこの一覧に含まれていません。</p>
    <div class="document-extractor-layout">
      <section class="document-extractor-browser" aria-label="文書一覧">
        <div class="document-extractor-filters">
          <label class="document-extractor-filter">都道府県<select data-filter="prefecture"><option value="">すべて</option></select></label>
          <label class="document-extractor-filter">資料種別<select data-filter="type"><option value="">すべて</option></select></label>
        </div>
        <section class="document-extractor-distribution" aria-label="資料種別の分布">
          <h3>資料種別の分布</h3>
          <div class="document-extractor-distribution-rows"></div>
        </section>
        <p class="document-extractor-count" role="status" aria-live="polite">TSVを読み込みます…</p>
        <div class="document-extractor-results" role="listbox" aria-label="抽出する文書"></div>
        <div class="document-extractor-pages">
          <button type="button" data-page="previous" disabled>前へ</button>
          <span class="document-extractor-page-label"></span>
          <button type="button" data-page="next" disabled>次へ</button>
        </div>
      </section>
      <section class="document-extractor-preview" aria-label="選択した文書のデータ">
        <h3 class="document-extractor-preview-title">JSONプレビュー</h3>
        <div class="document-extractor-view-switch" role="group" aria-label="表示形式">
          <button type="button" data-view="json" aria-pressed="true">JSON</button>
          <button type="button" data-view="tsv" aria-pressed="false">TSV</button>
          <button type="button" data-view="tree" aria-pressed="false">ツリー</button>
        </div>
        <div class="document-extractor-empty">左の一覧から文書を選択してください。</div>
        <div class="document-extractor-status" hidden>
          <div class="document-extractor-status-top"><span>資料種別: <strong data-status="type"></strong></span></div>
          <p class="document-extractor-status-reason" data-status="reason"></p>
        </div>
        <pre class="document-extractor-json" hidden></pre>
        <div class="document-extractor-tree" hidden></div>
        <div class="document-extractor-downloads">
          <button type="button" class="document-extractor-download" data-download="json" disabled>JSONを保存</button>
          <button type="button" class="document-extractor-download" data-download="tsv" disabled>TSVを保存</button>
        </div>
      </section>
    </div>`;
  document.body.append(dialog);

  const filterControls = [...dialog.querySelectorAll('[data-filter]')];
  const count = dialog.querySelector('.document-extractor-count');
  const results = dialog.querySelector('.document-extractor-results');
  const distributionRows = dialog.querySelector('.document-extractor-distribution-rows');
  const pageLabel = dialog.querySelector('.document-extractor-page-label');
  const previousPage = dialog.querySelector('[data-page="previous"]');
  const nextPage = dialog.querySelector('[data-page="next"]');
  const empty = dialog.querySelector('.document-extractor-empty');
  const statusPanel = dialog.querySelector('.document-extractor-status');
  const jsonPreview = dialog.querySelector('.document-extractor-json');
  const treePreview = dialog.querySelector('.document-extractor-tree');
  const viewButtons = [...dialog.querySelectorAll('[data-view]')];
  const downloadButtons = [...dialog.querySelectorAll('[data-download]')];
  let documents = [];
  let selectedDocument = null;
  let selectedJson = '';
  let selectedTsv = '';
  let selectedTree = null;
  let graphData = null;
  let activeView = 'json';
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
      summary: {
        upperClassCount: state.counts.upper,
        middleClassCount: state.counts.middle,
        targetClassCount: state.counts.target,
        instanceCount: state.counts.instance
      },
      classTree: state.tree.map(toExportClassNode),
      instances: state.instances.map((instance) => ({
        id: instance.id,
        name: instance.label || '',
        targetClasses: instance.classIds.map((id) => ({ id, name: state.classLabels[id] || id }))
      }))
    };
  }

  function toExportClassNode(node) {
    const kind = node.id.match(/\/class\/([tmc])_/u)?.[1];
    return {
      id: node.id,
      name: node.label || node.id,
      level: { t: 'upper', m: 'middle', c: 'target' }[kind] || 'class',
      children: node.children.map(toExportClassNode)
    };
  }

  function serializeGraphRecord(record, state) {
    return `${JSON.stringify(toGraphRecord(record, state), null, 2)}\n`;
  }

  function serializeGraphTsv(state) {
    const headers = ['上位クラスID', '上位クラス名', '中間クラスID', '中間クラス名', '対象クラスID', '対象クラス名', 'インスタンスID', 'インスタンス名'];
    const rows = [];
    const appendTargetRows = (nodes, path = []) => nodes.forEach((node) => {
      const nextPath = [...path, node];
      if (node.id.includes('/class/c_')) {
        const matchingInstances = state.instances.filter((instance) => instance.classIds.includes(node.id));
        (matchingInstances.length ? matchingInstances : [null]).forEach((instance) => rows.push([
          nextPath.find((item) => item.id.includes('/class/t_'))?.id || '',
          nextPath.find((item) => item.id.includes('/class/t_'))?.label || '',
          nextPath.find((item) => item.id.includes('/class/m_'))?.id || '',
          nextPath.find((item) => item.id.includes('/class/m_'))?.label || '',
          node.id,
          node.label || '',
          instance?.id || '',
          instance?.label || ''
        ]));
      }
      appendTargetRows(node.children, nextPath);
    });
    appendTargetRows(state.tree);
    const represented = new Set(rows.map((row) => row[6]).filter(Boolean));
    state.instances.filter((instance) => !represented.has(instance.id)).forEach((instance) => {
      rows.push(['', '', '', '', '', '', instance.id, instance.label || '']);
    });
    const escapeCell = (value) => {
      const text = String(value ?? '');
      return /[\t\r\n"]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
    };
    return `${[headers, ...rows].map((row) => row.map(escapeCell).join('\t')).join('\r\n')}\r\n`;
  }

  function documentNumber(record) {
    const match = record.documentIRI.match(/(?:docs\/|id_)(\d+)(?:_|$)/u);
    return match?.[1] || '';
  }

  function classesForDocument(record) {
    if (!graphData) return { available: false, instances: [], targets: [], counts: { upper: 0, middle: 0, target: 0, instance: 0 }, tree: [] };
    const number = documentNumber(record);
    const instances = number ? graphData.instances.filter((item) => item.id.match(new RegExp(`/id_${number}_`, 'u'))) : [];
    const instanceIds = new Set(instances.map((item) => item.id));
    const targetIds = new Set(graphData.assignments.filter((item) => instanceIds.has(item.instance)).map((item) => item.class));
    const parents = new Map();
    graphData.hierarchy.relations.forEach((relation) => {
      if (relation.relation === 'subClassOf') {
        const list = parents.get(relation.child) || [];
        list.push(relation.parent);
        parents.set(relation.child, list);
      }
    });
    const classes = new Map([...graphData.hierarchy.classes, ...graphData.targets].map((item) => [item.id, item]));
    const reachable = new Set();
    const visitParents = (id) => (parents.get(id) || []).forEach((parent) => {
      if (!reachable.has(parent)) { reachable.add(parent); visitParents(parent); }
    });
    targetIds.forEach((id) => { reachable.add(id); visitParents(id); });
    const countKind = (kind) => [...reachable].filter((id) => id.includes(`/class/${kind}_`)).length;
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
      .map((item) => ({ ...item, children: makeTree(item.id), instances: instances.filter((instance) => graphData.assignments.some((assignment) => assignment.instance === instance.id && assignment.class === item.id)) }));
    const classLabels = Object.fromEntries([...classes].map(([id, item]) => [id, item.label || id]));
    const instancesWithClasses = instances.map((instance) => ({
      ...instance,
      classIds: [...new Set(graphData.assignments.filter((assignment) => assignment.instance === instance.id).map((assignment) => assignment.class))]
    }));
    return {
      available: true,
      instances: instancesWithClasses,
      targets: [...targetIds],
      classLabels,
      counts: { upper: countKind('t'), middle: countKind('m'), target: countKind('c'), instance: instances.length },
      tree: makeTree('')
    };
  }

  function renderDocumentTree(data) {
    treePreview.replaceChildren();
    const summary = document.createElement('p');
    summary.className = 'document-extractor-tree-counts';
    summary.textContent = `上位クラス ${data.counts.upper}件 ・ 中間クラス ${data.counts.middle}件 ・ 対象クラス ${data.counts.target}件 ・ インスタンス ${data.counts.instance}件`;
    treePreview.append(summary);
    const root = document.createElement('ul');
    const docItem = document.createElement('li');
    const docDetails = document.createElement('details');
    docDetails.open = true;
    const docSummary = document.createElement('summary');
    docSummary.textContent = selectedDocument.input_file || selectedDocument.documentIRI;
    docDetails.append(docSummary);
    const appendClasses = (parent, nodes) => {
      const list = document.createElement('ul');
      nodes.forEach((node) => {
        const li = document.createElement('li');
        const details = document.createElement('details');
        details.open = true;
        const summaryNode = document.createElement('summary');
        const label = document.createElement('span');
        label.className = 'document-extractor-tree-label';
        label.textContent = node.label || node.id;
        const kind = node.id.match(/\/class\/([tmc])_/u)?.[1];
        const kindLabel = { t: '上位', m: '中間', c: '対象' }[kind] || 'クラス';
        summaryNode.append(label, document.createTextNode(` (${kindLabel})`));
        details.append(summaryNode);
        if (node.children.length || node.instances.length) {
          const nested = document.createElement('ul');
          if (node.children.length) appendClasses(nested, node.children);
          node.instances.forEach((instance) => {
            const instanceLi = document.createElement('li');
            instanceLi.textContent = instance.label || instance.id;
            nested.append(instanceLi);
          });
          details.append(nested);
        }
        li.append(details);
        list.append(li);
      });
      parent.append(list);
    };
    appendClasses(docDetails, data.tree);
    if (!data.available || !data.instances.length) {
      const message = document.createElement('p');
      message.className = 'document-extractor-tree-counts';
      message.textContent = data.available ? 'この文書IDに一致するインスタンスが見つかりません。' : 'クラス・インスタンスデータを読み込めません。';
      docDetails.append(message);
    }
    docItem.append(docDetails);
    root.append(docItem);
    treePreview.append(root);
  }

  function renderActiveView() {
    const hasSelection = Boolean(selectedDocument);
    jsonPreview.hidden = !hasSelection || !['json', 'tsv'].includes(activeView);
    treePreview.hidden = !hasSelection || activeView !== 'tree';
    viewButtons.forEach((button) => button.setAttribute('aria-pressed', String(button.dataset.view === activeView)));
    dialog.querySelector('.document-extractor-preview-title').textContent = activeView === 'json' ? 'JSONプレビュー' : activeView === 'tsv' ? 'TSVプレビュー' : '文書ツリー';
    jsonPreview.textContent = activeView === 'tsv' ? selectedTsv : selectedJson;
  }

  function filteredDocuments() {
    const selected = Object.fromEntries(filterControls.map((control) => [control.dataset.filter, control.value]));
    return documents.filter((record) => (!selected.prefecture || record.prefecture === selected.prefecture)
      && (!selected.type || record['資料種別'] === selected.type));
  }

  function populateFilters() {
    const fields = { prefecture: 'prefecture', type: '資料種別' };
    filterControls.forEach((control) => {
      const values = [...new Set(documents.map((record) => record[fields[control.dataset.filter]]).filter(Boolean))]
        .sort((a, b) => a.localeCompare(b, 'ja-JP'));
      values.forEach((value) => {
        const option = document.createElement('option');
        option.value = value;
        option.textContent = value;
        control.append(option);
      });
    });
  }

  function renderDistribution(matches) {
    const counts = new Map();
    matches.forEach((record) => {
      const type = record['資料種別']?.trim();
      if (!type) return;
      counts.set(type, (counts.get(type) || 0) + 1);
    });
    const maximum = Math.max(1, ...counts.values());
    distributionRows.replaceChildren(...[...counts.entries()].sort(([a], [b]) => a.localeCompare(b, 'ja-JP'))
      .map(([label, value]) => {
        const row = document.createElement('div');
        row.className = 'document-extractor-distribution-row';
        const name = document.createElement('span');
        name.className = 'document-extractor-distribution-label';
        name.textContent = label;
        const track = document.createElement('span');
        track.className = 'document-extractor-distribution-track';
        const bar = document.createElement('span');
        bar.className = 'document-extractor-distribution-bar';
        bar.style.width = `${Math.round((value / maximum) * 100)}%`;
        track.append(bar);
        const number = document.createElement('span');
        number.className = 'document-extractor-distribution-value';
        number.textContent = `${value.toLocaleString('ja-JP')}件`;
        row.append(name, track, number);
        return row;
      }));
  }

  function resetPreview() {
    selectedDocument = null;
    selectedJson = '';
    selectedTsv = '';
    selectedTree = null;
    empty.hidden = false;
    empty.textContent = documents.length ? '左の一覧から文書を選択してください。' : '抽出できる文書がありません。';
    jsonPreview.hidden = true;
    jsonPreview.textContent = '';
    statusPanel.hidden = true;
    downloadButtons.forEach((button) => { button.disabled = true; });
    renderActiveView();
  }

  function renderResults() {
    const matches = filteredDocuments();
    renderDistribution(matches);
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
      const detail = document.createElement('span');
      detail.textContent = `${record.prefecture} ・ ${record['資料種別']}`;
      button.append(title, detail);
      if (graphData) {
        const state = classesForDocument(record);
        const counts = document.createElement('span');
        counts.className = 'document-extractor-result-counts';
        counts.textContent = `上位 ${state.counts.upper} ・ 中間 ${state.counts.middle} ・ 対象 ${state.counts.target} ・ インスタンス ${state.counts.instance}`;
        button.append(counts);
      }
      button.addEventListener('click', () => {
        selectedDocument = record;
        selectedTree = classesForDocument(record);
        selectedJson = serializeGraphRecord(record, selectedTree);
        selectedTsv = serializeGraphTsv(selectedTree);
        empty.hidden = true;
        statusPanel.hidden = false;
        statusPanel.querySelector('[data-status="type"]').textContent = record['資料種別'];
        statusPanel.querySelector('[data-status="reason"]').textContent = `判定根拠: ${record['判定根拠']}`;
        jsonPreview.hidden = false;
        jsonPreview.textContent = activeView === 'tsv' ? selectedTsv : selectedJson;
        renderDocumentTree(selectedTree);
        downloadButtons.forEach((button) => { button.disabled = false; });
        renderActiveView();
        renderResults();
      });
      results.append(button);
    });
    pageLabel.textContent = `${page + 1} / ${pageCount}ページ`;
    previousPage.disabled = page <= 0;
    nextPage.disabled = page >= pageCount - 1;
    count.textContent = loaded
      ? `${matches.length.toLocaleString('ja-JP')}件 / 全${documents.length.toLocaleString('ja-JP')}件${matches.length > PAGE_SIZE ? `（1ページ${PAGE_SIZE}件）` : ''}`
      : count.textContent;
    if (!matches.length && loaded) {
      const note = document.createElement('p');
      note.className = 'document-extractor-empty';
      note.textContent = '検索条件に一致する文書はありません。';
      results.append(note);
    }
  }

  async function loadDocuments() {
    if (loaded) return;
    count.textContent = '文書一覧を読み込んでいます…';
    try {
      const [response, ...graphResponses] = await Promise.all([
        fetch(SOURCE_URL, { cache: 'no-cache' }),
        ...Object.values(GRAPH_DATA_URLS).map((url) => fetch(url, { cache: 'no-cache' }).catch(() => null))
      ]);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      if (graphResponses.every((item) => item?.ok)) {
        try {
          const [instanceData, assignmentData, hierarchyData, targetData] = await Promise.all(graphResponses.map((item) => item.json()));
          graphData = { instances: instanceData.instances || [], assignments: assignmentData.relations || [], hierarchy: hierarchyData, targets: targetData.classes || [] };
        } catch { graphData = null; }
      } else graphData = null;
      documents = parseTsv(await response.text()).filter((record) => record.documentIRI && record.input_file);
      loaded = true;
      count.textContent = '';
      populateFilters();
      resetPreview();
      renderResults();
    } catch (error) {
      count.textContent = `文書一覧を読み込めませんでした: ${error.message}`;
      documents = [];
      loaded = true;
      resetPreview();
    }
  }

  openButton.addEventListener('click', () => {
    dialog.showModal();
    void loadDocuments();
    filterControls[0].focus();
  });
  dialog.querySelector('.document-extractor-close').addEventListener('click', () => dialog.close());
  dialog.addEventListener('click', (event) => { if (event.target === dialog) dialog.close(); });
  filterControls.forEach((control) => control.addEventListener('change', () => { page = 0; resetPreview(); renderResults(); }));
  previousPage.addEventListener('click', () => { page -= 1; resetPreview(); renderResults(); });
  nextPage.addEventListener('click', () => { page += 1; resetPreview(); renderResults(); });
  viewButtons.forEach((button) => button.addEventListener('click', () => {
    activeView = button.dataset.view;
    renderActiveView();
  }));
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
