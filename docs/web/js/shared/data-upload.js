(() => {
  const input = document.getElementById('data-import-file');
  const dialog = document.getElementById('data-import-dialog');
  const openButton = document.getElementById('open-data-import');
  const confirmButton = document.getElementById('data-import-confirm');
  if (!input || !dialog || !openButton || !confirmButton) return;
  const drop = document.getElementById('data-import-drop');
  const status = document.getElementById('data-import-status');
  const summary = document.getElementById('data-import-summary');
  const selectedFileName = document.getElementById('data-import-file-name');
  let selected = null;
  const setStatus = (text, error = false) => {
    status.textContent = text;
    status.classList.toggle('is-error', error);
  };
  const readMode = () => dialog.querySelector('input[name="data-import-mode"]:checked')?.value || 'replace';
  const records = (items, label) => {
    if (!Array.isArray(items)) throw new Error(`${label}は配列で指定してください。`);
    const ids = new Set();
    items.forEach((item, index) => {
      if (!item || typeof item.id !== 'string' || !item.id.trim()) throw new Error(`${label}の${index + 1}件目にIDがありません。`);
      if (ids.has(item.id)) throw new Error(`${label}にIDの重複があります: ${item.id}`);
      if (item.label != null && typeof item.label !== 'string') throw new Error(`${label}のラベルは文字列で指定してください: ${item.id}`);
      ids.add(item.id);
    });
    return ids;
  };
  const parse = (data) => {
    if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('JSONの最上位はオブジェクトにしてください。');
    const classIds = records(data.classes, 'classes');
    const instanceIds = records(data.instances, 'instances');
    if (!Array.isArray(data.relations)) throw new Error('relationsは配列で指定してください。');
    const relationIds = new Set();
    data.relations.forEach((relation, index) => {
      if (!relation || typeof relation.instance !== 'string' || typeof relation.class !== 'string') throw new Error(`relationsの${index + 1}件目を読み取れません。`);
      if (!instanceIds.has(relation.instance)) throw new Error(`関係先のインスタンスがありません: ${relation.instance}`);
      if (!classIds.has(relation.class)) throw new Error(`関係先のクラスがありません: ${relation.class}`);
      const key = `${relation.instance}\u0000${relation.class}`;
      if (relationIds.has(key)) throw new Error(`関係が重複しています: ${relation.instance} → ${relation.class}`);
      relationIds.add(key);
    });
    return { classes: data.classes, instances: data.instances, relations: data.relations };
  };
  const currentClassList = () => [...(window.appData?.classData?.classes || []), ...(window.appData?.targetClassData?.classes || [])];
  const readFile = async (file) => {
    if (!file) return;
    selected = null;
    confirmButton.disabled = true;
    summary.hidden = true;
    try {
      const data = parse(JSON.parse(await file.text()));
      selected = { fileName: file.name, data };
      selectedFileName.textContent = file.name;
      const assigned = new Set(data.relations.map((relation) => relation.instance));
      const unlabeledClasses = data.classes.filter((item) => !String(item.label || '').trim()).length;
      const unlabeledInstances = data.instances.filter((item) => !String(item.label || '').trim()).length;
      summary.replaceChildren();
      const summaryFileName = document.createElement('h3'); summaryFileName.textContent = file.name;
      const totals = document.createElement('p'); totals.textContent = `クラス ${data.classes.length}件 / インスタンス ${data.instances.length}件 / 所属関係 ${data.relations.length}件`;
      const notes = document.createElement('p'); notes.textContent = `ラベルなし: クラス ${unlabeledClasses}件、インスタンス ${unlabeledInstances}件 / クラス未割り当て: ${data.instances.length - assigned.size}件`;
      summary.append(summaryFileName, totals, notes);
      summary.hidden = false;
      confirmButton.disabled = false;
      setStatus('内容を確認し、読み込み方法を選んでください。');
    } catch (error) {
      setStatus(error instanceof SyntaxError ? 'JSONを読み取れません。ファイル形式を確認してください。' : error.message, true);
    }
  };
  const makeWorkspace = (mode) => {
    const incoming = selected.data;
    const current = window.appData || {};
    let classes, hierarchy, instances, memberships;
    if (mode === 'replace') {
      const root = 'https://kozaki-lab.jp/REFV-KG/class/t_0';
      if (incoming.classes.some((item) => item.id === root)) throw new Error(`予約済みIDと重複しています: ${root}`);
      classes = [{ id: root, label: '未分類', type: 'top' }, ...incoming.classes.map((item) => ({ ...item, type: 'class' }))];
      hierarchy = incoming.classes.map((item) => ({ child: item.id, parent: root, relation: 'subClassOf' }));
      instances = incoming.instances.map((item) => ({ ...item }));
      memberships = incoming.relations.map((item) => ({ ...item }));
    } else {
      const existingClasses = currentClassList();
      const existingClassIds = new Set(existingClasses.map((item) => item.id));
      const existingInstanceIds = new Set((current.instanceData?.instances || []).map((item) => item.id));
      const conflict = incoming.classes.find((item) => existingClassIds.has(item.id)) || incoming.instances.find((item) => existingInstanceIds.has(item.id));
      if (conflict) throw new Error(`現在の作業とIDが重複しています: ${conflict.id}`);
      classes = existingClasses.map((item) => ({ ...item }));
      let root = classes.find((item) => item.label === '未分類' && (item.type === 'top' || /(?:^|\/)t[_-]/.test(item.id)));
      if (!root) {
        let id = 'https://kozaki-lab.jp/REFV-KG/class/t_0', suffix = 0;
        while (classes.some((item) => item.id === id)) id = `https://kozaki-lab.jp/REFV-KG/class/new-t_import_${++suffix}`;
        root = { id, label: '未分類', type: 'top' }; classes.push(root);
      }
      classes.push(...incoming.classes.map((item) => ({ ...item, type: 'class' })));
      hierarchy = [...(current.classData?.relations || []).map((item) => ({ ...item })), ...incoming.classes.map((item) => ({ child: item.id, parent: root.id, relation: 'subClassOf' }))];
      instances = [...(current.instanceData?.instances || []).map((item) => ({ ...item })), ...incoming.instances.map((item) => ({ ...item }))];
      memberships = [...(current.instanceClassData?.relations || []).map((item) => ({ ...item })), ...incoming.relations.map((item) => ({ ...item }))];
    }
    return { classData: { classes, relations: hierarchy }, targetClassData: { classes: [] }, instanceData: { instances }, instanceClassData: { relations: memberships }, workspaceMeta: { kind: 'uploaded', fileName: selected.fileName, importedData: incoming } };
  };
  const resetDialog = () => {
    selected = null;
    input.value = '';
    selectedFileName.textContent = 'ファイルは選択されていません';
    summary.hidden = true;
    dialog.querySelector('input[name="data-import-mode"][value="replace"]').checked = true;
    confirmButton.disabled = true;
    confirmButton.textContent = 'このデータで開始';
    setStatus('ファイルを選択してください。');
  };
  openButton.addEventListener('click', () => { resetDialog(); dialog.showModal(); });
  document.getElementById('data-import-close')?.addEventListener('click', () => dialog.close());
  document.getElementById('data-import-cancel')?.addEventListener('click', () => dialog.close());
  dialog.addEventListener('click', (event) => { if (event.target === dialog) dialog.close(); });
  input.addEventListener('change', () => readFile(input.files?.[0]));
  drop.addEventListener('keydown', (event) => {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    event.preventDefault();
    input.click();
  });
  drop.addEventListener('dragover', (event) => { event.preventDefault(); drop.classList.add('is-dragging'); });
  drop.addEventListener('dragleave', () => drop.classList.remove('is-dragging'));
  drop.addEventListener('drop', (event) => { event.preventDefault(); drop.classList.remove('is-dragging'); readFile(event.dataTransfer?.files?.[0]); });
  dialog.querySelectorAll('input[name="data-import-mode"]').forEach((radio) => radio.addEventListener('change', () => {
    confirmButton.textContent = readMode() === 'append' ? '現在の作業へ追加' : 'このデータで開始';
  }));
  confirmButton.addEventListener('click', () => {
    if (!selected) return;
    try {
      window.dataWorkspace.save(makeWorkspace(readMode()));
      window.__editorImportReload = true;
      window.location.reload();
    } catch (error) { setStatus(error.message, true); }
  });
})();
