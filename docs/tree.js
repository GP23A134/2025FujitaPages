/* 閲覧用・編集用で共有する階層モデル。未分類は保存せず、表示時に生成する。 */
(function (global) {
  function buildTreeModel(classData) {
    const classes = classData.classes || [];
    const byId = new Map(classes.map((item) => [item.id, item]));
    const children = new Map();
    const childIds = new Set();
    (classData.relations || []).forEach((relation) => {
      if (!children.has(relation.parent)) children.set(relation.parent, []);
      children.get(relation.parent).push(relation.child);
      childIds.add(relation.child);
    });
    const typeOf = (id) => {
      const shortId = String(id).split('/').pop();
      return shortId.startsWith('t_') ? 'top' : shortId.startsWith('m_') ? 'middle' : 'class';
    };
    const makeNode = (item, seen = new Set()) => {
      if (!item || seen.has(item.id)) return null;
      const nextSeen = new Set(seen).add(item.id);
      const node = { id: item.id, label: item.label, type: typeOf(item.id), children: [], targets: [] };
      (children.get(item.id) || []).forEach((childId) => {
        const child = byId.get(childId);
        if (!child) return;
        if (typeOf(child.id) === 'class') node.targets.push(child);
        else {
          const childNode = makeNode(child, nextSeen);
          if (childNode) node.children.push(childNode);
        }
      });
      if (node.type === 'top' && node.targets.length) {
        node.unclassified = { id: `virtual-unclassified:${node.id}`, label: '未分類', type: 'virtual-middle', children: [], targets: node.targets };
        node.targets = [];
      }
      return node;
    };
    return classes.filter((item) => !childIds.has(item.id) && typeOf(item.id) !== 'class')
      .map((item) => makeNode(item)).filter(Boolean);
  }

  global.buildTreeModel = buildTreeModel;
})(window);
