/* 閲覧用・編集用で共有する階層モデルと対象クラス検索。 */
(function (global) {
  function classType(id) {
    const shortId = String(id).split('/').pop().replace(/^new-/, '');
    return shortId.startsWith('t_') ? 'top' : shortId.startsWith('m_') ? 'middle' : 'class';
  }

  function buildTreeModel(classData, targetIds = null) {
    const classes = classData.classes || [];
    const byId = new Map(classes.map((item) => [item.id, item]));
    const children = new Map();
    const childIds = new Set();
    (classData.relations || []).forEach((relation) => {
      if (!children.has(relation.parent)) children.set(relation.parent, []);
      children.get(relation.parent).push(relation.child);
      childIds.add(relation.child);
    });
    const makeNode = (item, seen = new Set()) => {
      if (!item || seen.has(item.id)) return null;
      const nextSeen = new Set(seen).add(item.id);
      const node = { id: item.id, label: item.label, type: classType(item.id), children: [], targets: [] };
      (children.get(item.id) || []).forEach((childId) => {
        const child = byId.get(childId);
        if (!child) return;
        if (classType(child.id) === 'class') {
          if (!targetIds || targetIds.has(child.id)) node.targets.push(child);
        }
        else {
          const childNode = makeNode(child, nextSeen);
          if (childNode) node.children.push(childNode);
        }
      });
      if (targetIds && node.targets.length === 0 && node.children.length === 0) return null;
      return node;
    };
    const roots = classes.filter((item) => !childIds.has(item.id));
    return roots.map((item) => makeNode(item)).filter(Boolean);
  }

  function findTargetMatches(data, searchType, query) {
    const normalizedQuery = String(query || '').trim().toLocaleLowerCase();
    const classes = data.classData?.classes || [];
    if (searchType === 'instance') {
      const matchedInstances = (data.instanceClassData?.instances || []).filter((instance) =>
        !normalizedQuery || `${instance.label || ''} ${instance.id || ''}`.toLocaleLowerCase().includes(normalizedQuery));
      const matchedClassIds = new Set(matchedInstances.flatMap((instance) =>
        (instance.classes || []).map((classInfo) => classInfo.id)
      ));
      return {
        targets: classes.filter((item) => classType(item.id) === 'class' && matchedClassIds.has(item.id)),
        matchedInstanceCount: matchedInstances.length
      };
    }
    return {
      targets: classes.filter((item) => classType(item.id) === 'class' &&
        (!normalizedQuery || `${item.label || ''} ${item.id}`.toLocaleLowerCase().includes(normalizedQuery))),
      matchedInstanceCount: 0
    };
  }

  global.buildTreeModel = buildTreeModel;
  global.findTargetMatches = findTargetMatches;
})(window);
