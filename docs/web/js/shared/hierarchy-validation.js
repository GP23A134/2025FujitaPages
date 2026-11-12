// 閲覧・編集・アップロードで共通する階層の構造検証です。
(() => {
  const validateHierarchyGraph = (classes, relations, { requireParents = true } = {}) => {
    const issues = [];
    const records = Array.isArray(classes) ? classes : [];
    const edges = Array.isArray(relations) ? relations : [];
    const addIssue = (code, ids, detail, message) => {
      const classIds = [...new Set(ids.filter(Boolean))].sort();
      issues.push({ code, severity: 'error', classIds, key: `${code}:${JSON.stringify(classIds)}:${detail || ''}`, message });
    };
    if (!Array.isArray(classes)) addIssue('invalid-classes', [], '', 'クラス一覧は配列で指定してください。');
    if (!Array.isArray(relations)) addIssue('invalid-relations', [], '', 'クラス階層の関係は配列で指定してください。');

    const byId = new Map();
    const idsByClass = new Map();
    records.forEach((item, index) => {
      const id = typeof item?.id === 'string' ? item.id : '';
      if (!id.trim()) {
        addIssue('empty-id', [], String(index), 'IDが空のクラスがあります。');
        return;
      }
      const duplicates = idsByClass.get(id) || [];
      duplicates.push(item);
      idsByClass.set(id, duplicates);
      if (!byId.has(id)) byId.set(id, item);
      if (!['top', 'middle', 'class'].includes(item.type)) {
        addIssue('invalid-class-type', [id], String(item.type || ''), `「${id}」のクラス種別が不正です。`);
      }
    });
    idsByClass.forEach((items, id) => {
      if (items.length > 1) addIssue('duplicate-id', [id], String(items.length), `ID「${id}」のクラスが複数あります。`);
    });

    const relationKeys = new Set();
    const parentsByChild = new Map();
    edges.forEach((relation, index) => {
      if (!relation || typeof relation.child !== 'string' || typeof relation.parent !== 'string') {
        addIssue('invalid-relation', [], String(index), `クラス階層の${index + 1}件目を読み取れません。`);
        return;
      }
      const { child, parent } = relation;
      const pair = `${child}\u0000${parent}`;
      if (relationKeys.has(pair)) addIssue('duplicate-relation', [child, parent], '', `「${child}」から「${parent}」への親子関係が重複しています。`);
      relationKeys.add(pair);
      const childClass = byId.get(child);
      const parentClass = byId.get(parent);
      if (!childClass || !parentClass) {
        addIssue('missing-reference', [child, parent], pair, `親子関係「${child} → ${parent}」に存在しないクラスIDがあります。`);
        return;
      }
      const parents = parentsByChild.get(child) || [];
      parents.push(parent);
      parentsByChild.set(child, parents);
      if (child === parent || !['middle', 'class'].includes(childClass.type) || !['top', 'middle'].includes(parentClass.type)) {
        addIssue('invalid-type-edge', [child, parent], `${childClass.type}\u0000${parentClass.type}`, `「${childClass.label || child}」から「${parentClass.label || parent}」への階層種別が不正です。`);
      }
      if (parentClass.type === 'top' && parentClass.label === '未分類' && childClass.type === 'middle') {
        addIssue('unclassified-middle', [child, parent], '', '中間クラスを「未分類」の下に置くことはできません。');
      }
    });

    parentsByChild.forEach((parents, child) => {
      const uniqueParents = [...new Set(parents)];
      if (uniqueParents.length > 1) addIssue('multiple-parents', [child, ...uniqueParents], uniqueParents.join('\u0000'), `「${child}」が複数の親クラスを持っています。`);
    });
    if (requireParents) {
      records.forEach((item) => {
        if (item?.id && ['middle', 'class'].includes(item.type) && !parentsByChild.has(item.id)) {
          addIssue('missing-parent', [item.id], item.type, `「${item.label || item.id}」に親クラスがありません。`);
        }
      });
    }

    const visitState = new Map();
    const reportedCycles = new Set();
    parentsByChild.forEach((_, startId) => {
      if (visitState.get(startId) === 2) return;
      const path = [];
      const pathIndex = new Map();
      const stack = [{ id: startId, parentIndex: 0 }];
      visitState.set(startId, 1);
      pathIndex.set(startId, 0);
      path.push(startId);
      while (stack.length) {
        const frame = stack[stack.length - 1];
        const parents = parentsByChild.get(frame.id) || [];
        if (frame.parentIndex >= parents.length) {
          stack.pop();
          pathIndex.delete(frame.id);
          path.pop();
          visitState.set(frame.id, 2);
          continue;
        }
        const parent = parents[frame.parentIndex++];
        if (visitState.get(parent) === 1) {
          const cycleIds = path.slice(pathIndex.get(parent)).sort();
          const cycleKey = cycleIds.join('\u0000');
          if (!reportedCycles.has(cycleKey)) {
            reportedCycles.add(cycleKey);
            addIssue('cycle', cycleIds, cycleKey, `親子関係が循環しています（${cycleIds.join('、')}）。`);
          }
        } else if (visitState.get(parent) !== 2) {
          visitState.set(parent, 1);
          pathIndex.set(parent, path.length);
          path.push(parent);
          stack.push({ id: parent, parentIndex: 0 });
        }
      }
    });
    return issues;
  };

  window.validateHierarchyGraph = validateHierarchyGraph;
})();
