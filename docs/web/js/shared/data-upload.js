(() => {
  const input = document.getElementById('data-import-file');
  const dialog = document.getElementById('data-import-dialog');
  const openButton = document.getElementById('open-data-import');
  const resetButton = document.getElementById('reset-to-default');
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
  const normalizeClassRecords = (items, label) => {
    records(items, label);
    return items.map((item) => {
      const segment = item.id.split('/').pop();
      const inferredType = /^(?:new-)?t[_-]/.test(segment)
        ? 'top'
        : /^(?:new-)?m[_-]/.test(segment) ? 'middle' : 'class';
      const type = item.type || inferredType;
      if (!['top', 'middle', 'class'].includes(type)) throw new Error(`${label}のtypeが不正です: ${item.id}`);
      return { ...item, type };
    });
  };
  const validateClassRelations = (relations, classIds) => {
    if (!Array.isArray(relations)) throw new Error('クラス階層の関係は配列で指定してください。');
    const classChildren = new Set();
    relations.forEach((relation, index) => {
      if (!relation || typeof relation.child !== 'string' || typeof relation.parent !== 'string') throw new Error(`クラス階層の${index + 1}件目を読み取れません。`);
      if (!classIds.has(relation.child) || !classIds.has(relation.parent)) throw new Error(`クラス階層の参照先がありません: ${relation.child} → ${relation.parent}`);
      if (relation.child === relation.parent || classChildren.has(relation.child)) throw new Error(`クラス階層の親子関係が不正または重複しています: ${relation.child}`);
      classChildren.add(relation.child);
    });
    return relations;
  };
  const validateInstanceRelations = (relations, classIds, instanceIds) => {
    if (!Array.isArray(relations)) throw new Error('インスタンスとクラスの関係は配列で指定してください。');
    const relationIds = new Set();
    relations.forEach((relation, index) => {
      if (!relation || typeof relation.instance !== 'string' || typeof relation.class !== 'string') throw new Error(`インスタンス所属関係の${index + 1}件目を読み取れません。`);
      if (!instanceIds.has(relation.instance)) throw new Error(`関係先のインスタンスがありません: ${relation.instance}`);
      if (!classIds.has(relation.class)) throw new Error(`関係先のクラスがありません: ${relation.class}`);
      const key = `${relation.instance}\u0000${relation.class}`;
      if (relationIds.has(key)) throw new Error(`関係が重複しています: ${relation.instance} → ${relation.class}`);
      relationIds.add(key);
    });
    return relations;
  };
  const parseInstanceData = (data) => {
    if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('JSONの最上位はオブジェクトにしてください。');
    const classes = normalizeClassRecords(data.classes, 'classes');
    const classIds = new Set(classes.map((item) => item.id));
    const instanceIds = records(data.instances, 'instances');
    const classRelations = validateClassRelations(data.classRelations || [], classIds);
    const instanceClassRelations = validateInstanceRelations(data.instanceClassRelations || data.relations, classIds, instanceIds);
    return { classes, instances: data.instances, classRelations, instanceClassRelations };
  };
  const parseHierarchyData = (data) => {
    if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('クラス階層JSONの最上位はオブジェクトにしてください。');
    const classes = normalizeClassRecords(data.classes, 'クラス階層のclasses');
    const classRelations = data.classRelations || data.relations;
    if (!Array.isArray(classRelations)) throw new Error('クラス階層データにrelations配列がありません。');
    classRelations.forEach((relation, index) => {
      if (!relation || typeof relation.child !== 'string' || typeof relation.parent !== 'string') throw new Error(`クラス階層の${index + 1}件目を読み取れません。`);
    });
    return { classes, classRelations };
  };
  const mergeData = (instanceData, hierarchyData) => {
    const classById = new Map(instanceData.classes.map((item) => [item.id, { ...item }]));
    (hierarchyData?.classes || []).forEach((item) => {
      const existing = classById.get(item.id);
      classById.set(item.id, existing
        ? { ...existing, ...item, label: item.label || existing.label, type: item.type || existing.type }
        : { ...item });
    });
    const classes = [...classById.values()];
    const classIds = new Set(classById.keys());
    const relationByChild = new Map();
    [...instanceData.classRelations, ...(hierarchyData?.classRelations || [])].forEach((relation) => {
      if (!classIds.has(relation.child) || !classIds.has(relation.parent)) throw new Error(`階層データのクラスIDを照合できません: ${relation.child} → ${relation.parent}`);
      const parent = relationByChild.get(relation.child);
      if (parent && parent !== relation.parent) throw new Error(`同じクラスに異なる親が指定されています: ${relation.child}`);
      relationByChild.set(relation.child, relation.parent);
    });
    const classRelations = [...relationByChild].map(([child, parent]) => ({ child, parent }));
    validateClassRelations(classRelations, classIds);
    const instanceIds = new Set(instanceData.instances.map((item) => item.id));
    const instanceClassRelations = validateInstanceRelations(instanceData.instanceClassRelations, classIds, instanceIds);
    return { classes, instances: instanceData.instances, classRelations, instanceClassRelations };
  };
  const currentClassList = () => [...(window.appData?.classData?.classes || []), ...(window.appData?.targetClassData?.classes || [])];
  const readFiles = async (files) => {
    const selectedFiles = [...(files || [])];
    if (!selectedFiles.length) {
      selected = null;
      confirmButton.disabled = true;
      summary.hidden = true;
      setStatus('クラス・インスタンスデータを選択してください。');
      return;
    }
    selected = null;
    confirmButton.disabled = true;
    summary.hidden = true;
    selectedFileName.textContent = selectedFiles.map((file) => file.name).join(' + ');
    if (selectedFiles.length > 2) {
      setStatus('一度に選択できるファイルは2つまでです。', true);
      return;
    }
    try {
      const parsedFiles = await Promise.all(selectedFiles.map(async (file) => ({
        file,
        content: JSON.parse(await file.text())
      })));
      let instanceFile;
      let hierarchyFile;
      let hierarchyOnly = false;
      if (parsedFiles.length === 1) {
        if (Array.isArray(parsedFiles[0].content?.instances)) instanceFile = parsedFiles[0];
        else if (Array.isArray(parsedFiles[0].content?.classes)) {
          hierarchyFile = parsedFiles[0];
          hierarchyOnly = true;
        } else throw new Error('クラス・インスタンスデータまたはクラス階層データを選んでください。');
      } else {
        const instanceFiles = parsedFiles.filter(({ content }) => Array.isArray(content?.instances));
        const hierarchyFiles = parsedFiles.filter(({ content }) => !Array.isArray(content?.instances) && Array.isArray(content?.classes));
        if (instanceFiles.length !== 1 || hierarchyFiles.length !== 1) {
          throw new Error('クラス・インスタンスデータ1つとクラス階層データ1つを選んでください。');
        }
        [instanceFile] = instanceFiles;
        [hierarchyFile] = hierarchyFiles;
      }
      const hierarchyData = hierarchyFile ? parseHierarchyData(hierarchyFile.content) : null;
      const instanceData = hierarchyOnly
        ? { classes: [], instances: [], classRelations: [], instanceClassRelations: [] }
        : parseInstanceData(instanceFile.content);
      const data = mergeData(instanceData, hierarchyData);
      const fileNames = selectedFiles.map((file) => file.name);
      selected = { fileNames, data, hierarchyOnly };
      if (hierarchyOnly) {
        dialog.querySelector('input[name="data-import-mode"][value="append"]').checked = true;
        confirmButton.textContent = '現在の作業へ追加';
      }
      const assigned = new Set(data.instanceClassRelations.map((relation) => relation.instance));
      const unlabeledClasses = data.classes.filter((item) => !String(item.label || '').trim()).length;
      const unlabeledInstances = data.instances.filter((item) => !String(item.label || '').trim()).length;
      summary.replaceChildren();
      const summaryFileName = document.createElement('h3'); summaryFileName.textContent = fileNames.join(' + ');
      const totals = document.createElement('p'); totals.textContent = `クラス ${data.classes.length}件 / インスタンス ${data.instances.length}件 / クラス階層 ${data.classRelations.length}件 / 所属関係 ${data.instanceClassRelations.length}件`;
      const notes = document.createElement('p'); notes.textContent = `ラベルなし: クラス ${unlabeledClasses}件、インスタンス ${unlabeledInstances}件 / クラス未割り当て: ${data.instances.length - assigned.size}件`;
      summary.append(summaryFileName, totals, notes);
      summary.hidden = false;
      confirmButton.disabled = false;
      setStatus(hierarchyOnly
        ? '階層データを読み込みました。既存の作業へ追加してください。'
        : hierarchyFile ? '2つのファイルをクラスIDで統合しました。内容を確認してください。' : '内容を確認し、読み込み方法を選んでください。');
    } catch (error) {
      setStatus(error instanceof SyntaxError ? 'JSONを読み取れません。ファイル形式を確認してください。' : error.message, true);
    }
  };
  const makeWorkspace = (mode) => {
    const incoming = selected.data;
    const current = window.appData || {};
    if (selected.hierarchyOnly && mode !== 'append') throw new Error('クラス階層データだけを読み込む場合は「現在の作業に追加」を選んでください。');
    let classes, hierarchy, instances, memberships;
    const ensureUnclassifiedRoot = (classList) => {
      let root = classList.find((item) => item.type === 'top' && item.label === '未分類');
      if (root) return root;
      const usedIds = new Set(classList.map((item) => item.id));
      let id = 'https://kozaki-lab.jp/REFV-KG/class/t_0';
      let suffix = 0;
      while (usedIds.has(id)) id = `https://kozaki-lab.jp/REFV-KG/class/new-t_import_${++suffix}`;
      root = { id, label: '未分類', type: 'top' };
      classList.push(root);
      return root;
    };
    const addOrphanClasses = (classList, relations, importedClasses) => {
      const parentedIds = new Set(relations.map((relation) => relation.child));
      const orphanClasses = importedClasses.filter((item) => item.type !== 'top' && !parentedIds.has(item.id));
      if (!orphanClasses.length) return;
      const root = ensureUnclassifiedRoot(classList);
      orphanClasses.forEach((item) => relations.push({ child: item.id, parent: root.id, relation: 'subClassOf' }));
    };
    if (mode === 'replace') {
      classes = incoming.classes.map((item) => ({ ...item }));
      hierarchy = incoming.classRelations.map((item) => ({ ...item, relation: 'subClassOf' }));
      addOrphanClasses(classes, hierarchy, incoming.classes);
      instances = incoming.instances.map((item) => ({ ...item }));
      memberships = incoming.instanceClassRelations.map((item) => ({ ...item }));
    } else {
      const existingClasses = currentClassList();
      const classById = new Map(existingClasses.map((item) => [item.id, { ...item }]));
      incoming.classes.forEach((item) => {
        const existing = classById.get(item.id);
        if (!existing) { classById.set(item.id, { ...item }); return; }
        if (existing.label && item.label && existing.label !== item.label) throw new Error(`同じクラスIDのラベルが一致しません: ${item.id}`);
        if (existing.type !== item.type && existing.type !== 'class' && item.type !== 'class') throw new Error(`同じクラスIDに異なる種類が指定されています: ${item.id}`);
        existing.label ||= item.label;
        if (existing.type === 'class' && item.type !== 'class') existing.type = item.type;
      });
      classes = [...classById.values()];
      const importedClasses = incoming.classes.map((item) => classById.get(item.id));
      const relationByChild = new Map();
      (current.classData?.relations || []).forEach((item) => relationByChild.set(item.child, { ...item }));
      const unclassifiedId = classes.find((item) => item.type === 'top' && item.label === '未分類')?.id;
      incoming.classRelations.forEach((item) => {
        const existing = relationByChild.get(item.child);
        if (existing && existing.parent !== item.parent) {
          const replacesFallback = existing.parent === unclassifiedId && item.parent !== unclassifiedId;
          if (!replacesFallback) throw new Error(`同じクラスに異なる親が指定されています: ${item.child}`);
        }
        relationByChild.set(item.child, { ...item, relation: 'subClassOf' });
      });
      hierarchy = [...relationByChild.values()];
      addOrphanClasses(classes, hierarchy, importedClasses);
      const instanceById = new Map((current.instanceData?.instances || []).map((item) => [item.id, { ...item }]));
      incoming.instances.forEach((item) => {
        const existing = instanceById.get(item.id);
        if (existing && existing.label && item.label && existing.label !== item.label) throw new Error(`同じインスタンスIDのラベルが一致しません: ${item.id}`);
        if (existing) existing.label ||= item.label;
        else instanceById.set(item.id, { ...item });
      });
      instances = [...instanceById.values()];
      const membershipIds = new Set();
      memberships = [...(current.instanceClassData?.relations || []), ...incoming.instanceClassRelations]
        .filter((item) => {
          const key = `${item.instance}\u0000${item.class}`;
          if (membershipIds.has(key)) return false;
          membershipIds.add(key);
          return true;
        }).map((item) => ({ ...item }));
    }
    return { classData: { classes, relations: hierarchy }, targetClassData: { classes: [] }, instanceData: { instances }, instanceClassData: { relations: memberships }, workspaceMeta: { kind: 'uploaded', fileName: selected.fileNames.join(' + ') } };
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
  resetButton?.addEventListener('click', async () => {
    resetButton.disabled = true;
    try {
      const defaultData = await window.dataWorkspace.restoreDefault();
      if (!defaultData) throw new Error('初期状態のデータを読み込めません。');
      await window.dataWorkspace.save(defaultData, window.appData || null, window.classEditorAI?.selectionSnapshot || null);
      window.location.reload();
    } catch (error) {
      resetButton.disabled = false;
      window.alert(error.message);
    }
  });
  document.getElementById('data-import-close')?.addEventListener('click', () => dialog.close());
  document.getElementById('data-import-cancel')?.addEventListener('click', () => dialog.close());
  dialog.addEventListener('click', (event) => { if (event.target === dialog) dialog.close(); });
  const bindFilePicker = (picker, zone) => {
    picker.addEventListener('change', () => readFiles(picker.files));
    zone.addEventListener('keydown', (event) => {
      if (event.key !== 'Enter' && event.key !== ' ') return;
      event.preventDefault();
      picker.click();
    });
    zone.addEventListener('dragover', (event) => { event.preventDefault(); zone.classList.add('is-dragging'); });
    zone.addEventListener('dragleave', () => zone.classList.remove('is-dragging'));
    zone.addEventListener('drop', (event) => {
      event.preventDefault();
      zone.classList.remove('is-dragging');
      readFiles(event.dataTransfer?.files);
    });
  };
  bindFilePicker(input, drop);
  dialog.querySelectorAll('input[name="data-import-mode"]').forEach((radio) => radio.addEventListener('change', () => {
    confirmButton.textContent = readMode() === 'append' ? '現在の作業へ追加' : 'このデータで開始';
  }));
  confirmButton.addEventListener('click', async () => {
    if (!selected) return;
    try {
      await window.dataWorkspace.save(makeWorkspace(readMode()), window.appData || null, window.classEditorAI?.selectionSnapshot || null);
      window.__editorImportReload = true;
      window.location.reload();
    } catch (error) { setStatus(error.message, true); }
  });
})();
