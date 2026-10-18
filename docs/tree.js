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

  function createTreeLevel(node, options = {}) {
    const type = node.type || classType(node.id);
    const details = document.createElement('details');
    details.className = type === 'top' ? 'tree-top-class' : 'tree-middle-class';
    const summary = document.createElement('summary');
    const content = document.createElement('div');
    content.className = 'tree-level-content';
    const id = document.createElement('span');
    id.className = 'tree-level-id';
    id.textContent = options.displayId ? options.displayId(node.id) : String(node.id).split('/').pop();
    const label = document.createElement('span');
    label.className = 'tree-level-label';
    label.textContent = node.label || '';
    const badge = document.createElement('span');
    badge.className = 'count-badge edit-count';
    badge.textContent = options.count ?? 0;
    content.append(id, label, badge);
    summary.append(content);
    details.append(summary);
    return { details, summary, content, id, label, badge };
  }

  function appendTreeLevelRows(list, children, targets, renderChild, renderTarget) {
    if (children.length) {
      const row = document.createElement('li');
      row.className = 'tree-child-middle-row';
      const childList = document.createElement('ul');
      childList.className = 'tree-child-middle-list';
      children.forEach((child) => childList.append(renderChild(child)));
      row.append(childList);
      list.append(row);
    }
    if (targets.length) {
      const row = document.createElement('li');
      row.className = 'tree-target-row';
      const targetList = document.createElement('ul');
      targetList.className = 'tree-target-list';
      targets.forEach((target) => targetList.append(renderTarget(target)));
      row.append(targetList);
      list.append(row);
    }
  }

  function updateTreeTargetRowStarts(root) {
    root.querySelectorAll('.tree-target-list').forEach((list) => {
      let previousRowTop = Number.NEGATIVE_INFINITY;
      const items = [...list.children].filter((item) =>
        item.firstElementChild?.classList.contains('tree-leaf-class')
      );
      const positions = items.map((item) => item.getBoundingClientRect().top);
      positions.forEach((rowTop, index) => {
        const isRowStart = Math.abs(rowTop - previousRowTop) > 1;
        items[index].classList.toggle('is-row-start', isRowStart);
        if (isRowStart) previousRowTop = rowTop;
      });
    });
  }

  function renderHierarchyTree(container, roots, options = {}) {
    const countTargets = (node) => node.targets.length + node.children.reduce((sum, child) => sum + countTargets(child), 0);
    const countFor = options.countFor || countTargets;
    const makeDefaultTarget = (item) => {
      const li = document.createElement('li');
      const card = document.createElement('div');
      card.className = 'tree-leaf-class';
      const id = document.createElement('span');
      id.className = 'tree-leaf-id';
      id.textContent = options.displayId ? options.displayId(item.id) : String(item.id).split('/').pop();
      const label = document.createElement('span');
      label.className = 'tree-leaf-label';
      label.textContent = item.label || '';
      card.append(id, label);
      li.append(card);
      return li;
    };
    const makeTarget = options.renderTarget || makeDefaultTarget;
    const renderNode = (node, depth = 0) => {
      const { details, summary, content } = createTreeLevel(node, {
        displayId: options.displayId,
        count: countFor(node)
      });
      if (options.configureDetails) options.configureDetails(details, node, depth);
      details.open = options.isOpen
        ? options.isOpen(node, depth)
        : node.type === 'top' && node.label !== '未分類';
      if (options.decorateSummary) options.decorateSummary(summary, content, node, depth);

      let childrenRendered = false;
      const renderChildren = () => {
        if (childrenRendered) return;
        childrenRendered = true;
        const list = document.createElement('ul');
        list.className = 'tree-level-rows';
        if (options.beforeChildren) options.beforeChildren(node, list, depth);
        appendTreeLevelRows(
          list,
          node.children,
          node.targets,
          (child) => { const row = document.createElement('li'); row.append(renderNode(child, depth + 1)); return row; },
          (target) => makeTarget(target, node, depth)
        );
        if (options.afterChildren) options.afterChildren(node, list, depth);
        details.append(list);
      };
      details.addEventListener('toggle', () => { if (details.open) renderChildren(); });
      if (details.open) renderChildren();
      return details;
    };

    const orderedRoots = [...roots].sort((a, b) => {
      if (options.sortRoots) return options.sortRoots(a, b, countFor);
      const aUnclassified = a.type === 'top' && a.label === '未分類';
      const bUnclassified = b.type === 'top' && b.label === '未分類';
      if (aUnclassified !== bUnclassified) return aUnclassified ? -1 : 1;
      return countFor(b) - countFor(a) || a.label.localeCompare(b.label, 'ja');
    });
    const elements = orderedRoots.map((node) => renderNode(node));
    const extra = options.renderRootExtra?.();
    if (extra) elements.push(extra);
    container.replaceChildren(...elements);
    options.afterRender?.(container);
  }

  function findTargetMatches(data, searchType, query, matchMode) {
    const normalizedQuery = String(query || '').trim().toLocaleLowerCase();
    const terms = (Array.isArray(query) ? query : [normalizedQuery])
      .map((term) => String(term || '').trim().toLocaleLowerCase()).filter(Boolean);
    const matchesQuery = (text) => {
      if (!terms.length) return true;
      const normalizedText = String(text || '').toLocaleLowerCase();
      if (matchMode === 'OR') return terms.some((term) => normalizedText.includes(term));
      if (matchMode === 'AND') return terms.every((term) => normalizedText.includes(term));
      return normalizedText.includes(normalizedQuery);
    };
    const classes = data.classData?.classes || [];
    if (searchType === 'instance') {
      const instances = data.instanceData?.instances || [];
      const relations = data.instanceClassData?.relations || [];
      const matchedInstances = instances.filter((instance) =>
        matchesQuery(`${instance.label || ''} ${instance.id || ''}`));
      const matchedInstanceIds = new Set(matchedInstances.map((instance) => instance.id));
      const matchedClassIds = new Set(relations
        .filter((relation) => matchedInstanceIds.has(relation.instance))
        .map((relation) => relation.class));
      return {
        targets: classes.filter((item) => classType(item.id) === 'class' && matchedClassIds.has(item.id)),
        matchedInstanceCount: matchedInstances.length
      };
    }
    return {
      targets: classes.filter((item) => classType(item.id) === 'class' &&
        matchesQuery(`${item.label || ''} ${item.id}`)),
      matchedInstanceCount: 0
    };
  }

  global.buildTreeModel = buildTreeModel;
  global.createTreeLevel = createTreeLevel;
  global.appendTreeLevelRows = appendTreeLevelRows;
  global.updateTreeTargetRowStarts = updateTreeTargetRowStarts;
  global.renderHierarchyTree = renderHierarchyTree;
  global.findTargetMatches = findTargetMatches;
})(window);
