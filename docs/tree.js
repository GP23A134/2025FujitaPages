/* 閲覧用・編集用で共有する階層モデルとクラス検索。 */
(function (global) {
  const treeDepthColors = ['#bae6fd', '#7dd3fc', '#38bdf8', '#0369a1', '#082f49', '#020617'];
  const treeDepthColor = (depth) => treeDepthColors[Math.min(depth, treeDepthColors.length - 1)];
  const treeLabel = (value) => String(value || '').replace(/^"|"@[^@]+$/g, '');

  function classType(id) {
    const shortId = String(id).split('/').pop().replace(/^new-/, '');
    return shortId.startsWith('t_') ? 'top' : shortId.startsWith('m_') ? 'middle' : 'class';
  }

  function buildTreeModel(classData, targetIds = null, preserveHierarchy = false) {
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
      if (targetIds && !preserveHierarchy && node.targets.length === 0 && node.children.length === 0) return null;
      return node;
    };
    const roots = classes.filter((item) => !childIds.has(item.id));
    return roots.map((item) => makeNode(item)).filter(Boolean);
  }

  function treeAncestorIds(classData, targetIds) {
    const parents = new Map();
    (classData.relations || []).forEach(({ child, parent }) => {
      if (!parents.has(child)) parents.set(child, []);
      parents.get(child).push(parent);
    });
    const ancestors = new Set();
    (targetIds || []).forEach((targetId) => {
      const pending = [targetId];
      while (pending.length) {
        const id = pending.pop();
        if (ancestors.has(id)) continue;
        ancestors.add(id);
        pending.push(...(parents.get(id) || []));
      }
    });
    return ancestors;
  }

  function createTreeLevel(node, options = {}) {
    const type = node.type || classType(node.id);
    const details = document.createElement('details');
    details.dataset.classId = node.id;
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
    const totalCount = options.count ?? 0;
    const directCount = options.directCount ?? 0;
    const updateCount = (isOpen) => {
      badge.textContent = isOpen
        ? ` ${totalCount}件（直接 ${directCount}件）`
        : ` ${totalCount}件`;
    };
    updateCount(false);
    details.addEventListener('toggle', () => updateCount(details.open));
    content.append(id, label, badge);
    summary.append(content);
    details.append(summary);
    return { details, summary, content, id, label, badge, updateCount };
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

  // 上位・中間クラス見出しの高さから、入れ子の中間クラスの追従位置を算出する。
  // 閲覧・編集のどちらも同じツリー構造を使うため、この計算も共有する。
  function updateTreeStickyOffsets(panel) {
    if (!panel) return;
    const summaries = [...panel.querySelectorAll('.tree-top-class > summary, .tree-middle-class > summary')];
    const heights = new Map(summaries.map((summary) => [summary, summary.getBoundingClientRect().height]));
    [...panel.querySelectorAll('.tree-middle-class')].forEach((details) => {
      const topClass = details.parentElement?.closest('.tree-top-class');
      let offset = (topClass && heights.get(topClass.querySelector(':scope > summary'))) || 0;
      offset += 6;
      let ancestor = details.parentElement?.closest('.tree-middle-class');
      while (ancestor) {
        offset += (heights.get(ancestor.querySelector(':scope > summary')) || 0) + 6;
        ancestor = ancestor.parentElement?.closest('.tree-middle-class');
      }
      details.style.setProperty('--middle-sticky-top', `${offset}px`);
    });
  }

  function renderHierarchyTree(container, roots, options = {}) {
    const targetCountCache = new WeakMap();
    const countTargets = (node) => {
      if (targetCountCache.has(node)) return targetCountCache.get(node);
      const count = node.targets.length + node.children.reduce((sum, child) => sum + countTargets(child), 0);
      targetCountCache.set(node, count);
      return count;
    };
    const countFor = options.countFor || countTargets;
    const targetCountFor = options.targetCountFor || (() => 0);
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
        count: countFor(node),
        directCount: node.targets.length
      });
      details.style.setProperty('--tree-level-color', treeDepthColor(depth));
      details.style.setProperty('--tree-own-level-color', treeDepthColor(depth));
      if (options.configureDetails) options.configureDetails(details, node, depth);
      details.open = options.isOpen
        ? options.isOpen(node, depth)
        : false;
      if (options.decorateSummary) options.decorateSummary(summary, content, node, depth);

      let childrenRendered = false;
      const renderChildren = () => {
        if (childrenRendered) return;
        childrenRendered = true;
        const list = document.createElement('ul');
        list.className = 'tree-level-rows';
        list.style.setProperty('--tree-level-color', treeDepthColor(depth + 1));
        if (options.beforeChildren) options.beforeChildren(node, list, depth);
        appendTreeLevelRows(
          list,
          [...node.children].sort((a, b) => countFor(b) - countFor(a)
            || String(a.label || '').localeCompare(String(b.label || ''), 'ja')),
          [...node.targets].sort((a, b) => targetCountFor(b) - targetCountFor(a)
            || String(a.label || '').localeCompare(String(b.label || ''), 'ja')),
          (child) => {
            const row = document.createElement('li');
            row.style.setProperty('--tree-level-color', treeDepthColor(depth + 1));
            row.append(renderNode(child, depth + 1));
            return row;
          },
          (target) => {
            const row = makeTarget(target, node, depth + 1);
            row.style.setProperty('--tree-level-color', treeDepthColor(depth + 1));
            return row;
          }
        );
        if (options.afterChildren) options.afterChildren(node, list, depth);
        details.append(list);
      };
      details.addEventListener('toggle', () => {
        if (details.open) renderChildren();
        if (options.onToggle) options.onToggle(details, node, depth);
      });
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

  function findTargetMatches(data, searchType, query, matchMode, searchOptions = {}) {
    const normalizedQuery = String(query || '').trim().toLocaleLowerCase();
    const terms = (Array.isArray(query) ? query : [normalizedQuery])
      .map((term) => String(term || '').trim().toLocaleLowerCase()).filter(Boolean);
    const matchesQuery = (values) => {
      if (!terms.length) return true;
      const normalizedValues = values.map((value) => String(value || '').toLocaleLowerCase());
      const isMatch = (value, term) => searchOptions.matchType === 'exact'
        ? value === term
        : value.includes(term);
      if (matchMode === 'OR') return terms.some((term) => normalizedValues.some((value) => isMatch(value, term)));
      if (matchMode === 'AND') return terms.every((term) => normalizedValues.some((value) => isMatch(value, term)));
      return normalizedValues.some((value) => isMatch(value, normalizedQuery));
    };
    const searchValues = (name, id) => {
      const rawId = String(id || '');
      const idSegment = rawId.split('/').pop();
      const shortIdMatch = idSegment.match(/^([cmt])_0*(\d+)$/);
      const shortId = shortIdMatch ? `${shortIdMatch[1]}_${Number(shortIdMatch[2])}` : idSegment;
      const idValues = [rawId, idSegment, shortId];
      if (searchOptions.searchField === 'name') return [name];
      if (searchOptions.searchField === 'id') return idValues;
      return [name, ...idValues];
    };
    const classes = data.classData?.classes || [];
    if (searchType === 'instance') {
      const instances = data.instanceData?.instances || [];
      const relations = data.instanceClassData?.relations || [];
      const matchedInstances = instances.filter((instance) =>
        matchesQuery(searchValues(instance.label, instance.id)));
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
        matchesQuery(searchValues(item.label, item.id))),
      matchedInstanceCount: 0
    };
  }

  global.buildTreeModel = buildTreeModel;
  global.treeAncestorIds = treeAncestorIds;
  global.createTreeLevel = createTreeLevel;
  global.appendTreeLevelRows = appendTreeLevelRows;
  global.treeDepthColor = treeDepthColor;
  global.treeLabel = treeLabel;
  global.updateTreeTargetRowStarts = updateTreeTargetRowStarts;
  global.updateTreeStickyOffsets = updateTreeStickyOffsets;
  global.renderHierarchyTree = renderHierarchyTree;
  global.findTargetMatches = findTargetMatches;
})(window);
