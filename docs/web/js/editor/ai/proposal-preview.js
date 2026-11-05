// 提案のプレビュー、操作の選択、対象クラスへの移動・適用を担当します。
// 呼び出し元が検証した提案を表示し、適用操作は利用者の明示操作後にだけ実行します。
export const createProposalPreview = ({
  editor,
  previewDialog,
  closePreview,
  getCurrentConversation,
  getClassLabelsById,
  getClassTypesById,
  getTemporaryLabelsById,
  operationLabel,
  labelFor,
  renderPreviewTypeLegend,
  reportPreviewError,
  stateFingerprint,
  currentDataHash,
  verifyLoadedDataVersion,
  renderConversation,
  setStatus
}) => {
  let previewPlan = null;
  let previewPageIndex = 0;
  let previewGroups = [];
  const operationCategory = (operation) => {
    if (operation?.type === 'addClass') return { label: '追加', className: 'is-add' };
    if (operation?.type === 'renameClass') return { label: '改名', className: 'is-rename' };
    if (operation?.type === 'moveClass' || operation?.type === 'moveChildren') return { label: '移動', className: 'is-move' };
    if (operation?.type === 'deleteClass') return { label: '削除', className: 'is-delete' };
    return { label: 'その他', className: 'is-other' };
  };
  const countHierarchyTargets = (state) => {
    const classesById = new Map(state.classes.map((item) => [item.id, item]));
    const children = new Map();
    state.relations.forEach(({ child, parent }) => {
      if (!children.has(parent)) children.set(parent, []);
      children.get(parent).push(child);
    });
    const totals = new Map(); const direct = new Map(); const visiting = new Set();
    const countFor = (id) => {
      if (totals.has(id)) return totals.get(id);
      if (visiting.has(id)) return 0;
      visiting.add(id);
      let total = 0; let directCount = 0;
      (children.get(id) || []).forEach((childId) => {
        if (classesById.get(childId)?.type === 'class') { total += 1; directCount += 1; }
        else if (classesById.get(childId)) total += countFor(childId);
      });
      visiting.delete(id);
      totals.set(id, total); direct.set(id, directCount);
      return total;
    };
    state.classes.filter((item) => item.type === 'top' || item.type === 'middle').forEach((item) => countFor(item.id));
    return { totals, direct };
  };
  const keepPreviewTreeExpanded = (host) => {
    if (host.dataset.previewTreeStatic === 'true') return;
    host.dataset.previewTreeStatic = 'true';
    const isControl = (target) => target.closest('input, button, a, select, textarea, [role="checkbox"]');
    host.addEventListener('click', (event) => {
      const summary = event.target.closest('summary');
      if (!summary || isControl(event.target)) return;
      event.preventDefault();
    }, true);
    host.addEventListener('keydown', (event) => {
      if (event.key !== 'Enter' && event.key !== ' ') return;
      const summary = event.target.closest('summary');
      if (!summary || isControl(event.target)) return;
      event.preventDefault();
    }, true);
  };
  const getPreviewVerticalRanks = (state, visibleIds) => {
    const classesById = new Map(state.classes.filter((item) => visibleIds.has(item.id)).map((item) => [item.id, item]));
    const children = new Map();
    const parentIds = new Set();
    state.relations.forEach(({ child, parent }) => {
      if (!classesById.has(child) || !classesById.has(parent)) return;
      if (!children.has(parent)) children.set(parent, []);
      children.get(parent).push(child);
      parentIds.add(child);
    });
    const targetIdsFor = (id) => (children.get(id) || []).filter((childId) => classesById.get(childId)?.type === 'class');
    const hierarchyChildrenFor = (id) => (children.get(id) || []).filter((childId) => classesById.get(childId)
      && classesById.get(childId).type !== 'class');
    const countCache = new Map();
    const countFor = (id, path = new Set()) => {
      if (countCache.has(id)) return countCache.get(id);
      if (path.has(id)) return 0;
      const nextPath = new Set(path).add(id);
      const count = targetIdsFor(id).length + hierarchyChildrenFor(id)
        .reduce((sum, childId) => sum + countFor(childId, nextPath), 0);
      countCache.set(id, count);
      return count;
    };
    const compareHierarchy = (leftId, rightId) => countFor(rightId) - countFor(leftId)
      || String(classesById.get(leftId)?.label || '').localeCompare(String(classesById.get(rightId)?.label || ''), 'ja');
    const compareTargets = (leftId, rightId) => (state.counts?.[rightId] || 0) - (state.counts?.[leftId] || 0)
      || String(classesById.get(leftId)?.label || '').localeCompare(String(classesById.get(rightId)?.label || ''), 'ja');
    const ranks = new Map();
    let rank = 0;
    const visit = (id, path = new Set()) => {
      if (path.has(id) || !classesById.has(id)) return;
      const startRank = rank++;
      const nextPath = new Set(path).add(id);
      hierarchyChildrenFor(id).sort(compareHierarchy).forEach((childId) => visit(childId, nextPath));
      targetIdsFor(id).sort(compareTargets).forEach((targetId) => ranks.set(targetId, rank++));
      ranks.set(id, (startRank + rank - 1) / 2);
    };
    state.classes.filter((item) => item.type === 'top' && !parentIds.has(item.id) && classesById.has(item.id))
      .forEach((item) => visit(item.id));
    return ranks;
  };
  const appendTree = (host, state, affectedIds = new Set(), options = {}) => {
    keepPreviewTreeExpanded(host);
    const classesById = new Map(state.classes.map((item) => [item.id, item]));
    const children = new Map(); const parentIds = new Set();
    state.relations.forEach(({ child, parent }) => {
      if (!children.has(parent)) children.set(parent, []);
      children.get(parent).push(child);
      parentIds.add(child);
    });
    const buildNode = (id, path = new Set()) => {
      const item = classesById.get(id);
      if (!item || path.has(id)) return null;
      const nextPath = new Set(path).add(id);
      const node = { id, label: item.label, type: item.type, previewDeleted: Boolean(item.previewDeleted), children: [], targets: [] };
      (children.get(id) || []).forEach((childId) => {
        const child = classesById.get(childId);
        if (!child) return;
        if (child.type === 'class') node.targets.push(child);
        else {
          const childNode = buildNode(childId, nextPath);
          if (childNode) node.children.push(childNode);
        }
      });
      return node;
    };
    const roots = state.classes.filter((item) => item.type === 'top' && !parentIds.has(item.id))
      .map((item) => item.id);
    const orderedRoots = roots.map((id) => buildNode(id)).filter(Boolean).sort((left, right) => {
      const leftRank = options.counterpartRanks?.get(left.id);
      const rightRank = options.counterpartRanks?.get(right.id);
      if (leftRank !== undefined && rightRank !== undefined && leftRank !== rightRank) return leftRank - rightRank;
      if (leftRank !== undefined || rightRank !== undefined) return leftRank !== undefined ? -1 : 1;
      return 0;
    });
    host.classList.add('tree');
    const targetCountFor = (item) => state.counts?.[item.id] || 0;
    const countFor = (node) => node.targets.length + node.children.reduce((sum, child) => sum + countFor(child), 0);
    const indexesFor = (id) => Array.from(options.operationIndexesByClass?.get(id) || []);
    const compareByCounterpart = (fallback) => (left, right) => {
      const leftRank = options.counterpartRanks?.get(left.id);
      const rightRank = options.counterpartRanks?.get(right.id);
      if (leftRank !== undefined && rightRank !== undefined && leftRank !== rightRank) return leftRank - rightRank;
      if (leftRank !== undefined || rightRank !== undefined) return leftRank !== undefined ? -1 : 1;
      return fallback(left, right);
    };
    const compareChildren = compareByCounterpart((left, right) => countFor(right) - countFor(left)
      || String(left.label || '').localeCompare(String(right.label || ''), 'ja'));
    const compareTargets = compareByCounterpart((left, right) => targetCountFor(right) - targetCountFor(left)
      || String(left.label || '').localeCompare(String(right.label || ''), 'ja'));
    const appendTypeBadges = (host, indexes) => {
      const categories = [...new Map(indexes.map((index) => operationCategory(options.operations?.[index]))
        .filter(Boolean).map((category) => [category.label, category])).values()];
      categories.forEach((category) => {
        host.classList.add(`is-ai-preview-type-${category.className.slice(3)}`);
        const badge = document.createElement('span');
        badge.className = `ai-preview-type-badge ${category.className}`;
        badge.textContent = category.label;
        host.append(badge);
      });
    };
    const makeToggle = (id, label, explicitIndexes = null) => {
      const indexes = explicitIndexes || indexesFor(id);
      if (!options.selectable || !indexes.length) return null;
      const checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.className = 'ai-preview-change-toggle';
      checkbox.checked = [...indexes].every((index) => !options.excludedOperationIndexes.has(index));
      checkbox.setAttribute('aria-label', `${label}の変更を適用する`);
      checkbox.addEventListener('click', (event) => event.stopPropagation());
      checkbox.addEventListener('change', () => options.onToggle?.(indexes, checkbox.checked));
      return checkbox;
    };
    window.renderHierarchyTree(host, orderedRoots, {
      countFor,
      targetCountFor,
      compareChildren,
      compareTargets,
      isOpen: () => true,
      displayId: () => '',
      decorateSummary: (summary, _content, node) => {
        if (options.countLabelFor) {
          const badge = summary.querySelector('.count-badge');
          const updateBadge = () => { badge.textContent = options.countLabelFor(node); };
          updateBadge();
          summary.parentElement?.addEventListener('toggle', updateBadge);
        }
        const indexes = indexesFor(node.id);
        if (indexes.length) {
          summary.classList.add(indexes.some((index) => options.excludedOperationIndexes.has(index))
            ? 'is-ai-preview-excluded' : 'is-ai-preview-changed');
        }
        const addedIndexes = options.addedOperationIndexesByClass?.get(node.id);
        const checkbox = node.type === 'middle'
          ? (addedIndexes?.length ? makeToggle(node.id, node.label, addedIndexes) : null)
          : makeToggle(node.id, node.label);
        if (checkbox) summary.prepend(checkbox);
        appendTypeBadges(summary, indexesFor(node.id));
        if (node.previewDeleted) {
          summary.classList.add('is-ai-preview-deleted');
          const note = document.createElement('span');
          note.className = 'ai-preview-deleted-label';
          const deleteIndex = options.deletionOperationByClass?.get(node.id);
          note.textContent = deleteIndex !== undefined && options.excludedOperationIndexes.has(deleteIndex) ? '削除しない' : '削除予定';
          summary.append(note);
        }
      },
      renderTarget: (item, _parent, depth) => {
        const li = document.createElement('li');
        li.style.setProperty('--tree-level-color', window.treeDepthColor(depth));
        const row = document.createElement('div');
        row.className = 'tree-leaf-class ai-preview-class';
        row.dataset.classId = item.id;
        const indexes = indexesFor(item.id);
        if (affectedIds.has(item.id) && indexes.length) {
          const included = indexes.every((index) => !options.excludedOperationIndexes.has(index));
          if (included) row.classList.add('is-selected', 'is-ai-preview-changed');
          else row.classList.add('is-ai-preview-excluded');
        }
        if (options.selectable && indexes.length) {
          const included = indexes.every((index) => !options.excludedOperationIndexes.has(index));
          row.setAttribute('role', 'checkbox');
          row.setAttribute('aria-checked', String(included));
          row.setAttribute('aria-label', `${item.label}の変更を適用する`);
          row.tabIndex = 0;
          const toggle = () => options.onToggle?.(indexes, !included);
          row.addEventListener('click', toggle);
          row.addEventListener('keydown', (event) => {
            if (event.key !== ' ' && event.key !== 'Enter') return;
            event.preventDefault();
            toggle();
          });
        }
        const id = document.createElement('span');
        id.className = 'tree-leaf-id';
        const idSegment = String(item.id).split('/').pop();
        const idMatch = idSegment.match(/^([cmt])_0*(\d+)$/);
        id.textContent = idMatch ? `${idMatch[1]}_${Number(idMatch[2])}` : idSegment;
        const label = document.createElement('span');
        label.className = 'tree-leaf-label';
        label.textContent = item.label;
        row.append(id, label);
        appendTypeBadges(row, indexes);
        li.append(row);
        return li;
      },
      afterRender: (container) => window.updateTreeTargetRowStarts(container)
    });
  };
  const previewArrowColors = {
    'is-add': '#16a34a',
    'is-rename': '#2563eb',
    'is-move': '#7c3aed',
    'is-delete': '#dc2626'
  };
  const previewNodeRow = (host, id) => {
    if (!id) return null;
    const detail = [...host.querySelectorAll('details[data-class-id]')]
      .find((item) => item.dataset.classId === id);
    if (detail) return detail.querySelector(':scope > summary');
    return [...host.querySelectorAll('.ai-preview-class[data-class-id]')]
      .find((item) => item.dataset.classId === id) || null;
  };
  const previewNodeId = (node) => node?.dataset.classId
    || node?.closest('details[data-class-id]')?.dataset.classId || '';
  const renderPreviewArrows = (arrows = []) => {
    const svg = document.getElementById('ai-preview-direction');
    const columns = document.querySelector('.ai-preview-columns');
    const addOrigin = document.getElementById('ai-preview-add-origin');
    const deleteTarget = document.getElementById('ai-preview-delete-target');
    if (!svg || !columns) return;
    const hasAdditions = arrows.some((arrow) => arrow.kind === 'is-add' && !arrow.from);
    const hasDeletions = arrows.some((arrow) => arrow.kind === 'is-delete' && !arrow.to);
    if (addOrigin) addOrigin.hidden = svg.hidden || !hasAdditions;
    if (deleteTarget) deleteTarget.hidden = svg.hidden || !hasDeletions;
    if (svg.hidden) return;
    const routingArrows = arrows.map((arrow) => ({ arrow }));
    const trackGap = 5;
    const bounds = svg.getBoundingClientRect();
    if (!bounds.width || !bounds.height) return;
    const laneWidth = Math.max(120, routingArrows.length * trackGap + 24);
    const routingHeight = Math.max(100, routingArrows.length * 3 + 32);
    if (columns.dataset.previewLaneWidth !== String(laneWidth)
      || columns.dataset.previewRoutingHeight !== String(routingHeight)) {
      columns.dataset.previewLaneWidth = String(laneWidth);
      columns.dataset.previewRoutingHeight = String(routingHeight);
      columns.style.setProperty('--ai-preview-arrow-lane-width', `${laneWidth}px`);
      columns.style.minHeight = `${routingHeight}px`;
      requestAnimationFrame(() => renderPreviewArrows(arrows));
      return;
    }
    const width = bounds.width;
    const height = bounds.height;
    const namespace = 'http://www.w3.org/2000/svg';
    svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
    svg.replaceChildren();
    const defs = document.createElementNS(namespace, 'defs');
    Object.entries(previewArrowColors).forEach(([kind, color]) => {
      const marker = document.createElementNS(namespace, 'marker');
      marker.id = `ai-preview-arrowhead-${kind}`;
      marker.setAttribute('viewBox', '0 0 10 10');
      marker.setAttribute('refX', '9');
      marker.setAttribute('refY', '5');
      marker.setAttribute('markerWidth', '6');
      marker.setAttribute('markerHeight', '6');
      marker.setAttribute('orient', 'auto');
      const head = document.createElementNS(namespace, 'path');
      head.setAttribute('d', 'M 0 0 L 10 5 L 0 10 z');
      head.setAttribute('fill', color);
      marker.append(head);
      defs.append(marker);
    });
    svg.append(defs);
    const before = document.getElementById('ai-preview-before');
    const after = document.getElementById('ai-preview-after');
    const beforeBounds = before.getBoundingClientRect();
    const afterBounds = after.getBoundingClientRect();
    if (addOrigin) {
      const columnsBounds = columns.getBoundingClientRect();
      addOrigin.style.top = `${beforeBounds.top - columnsBounds.top}px`;
    }
    const addOriginBounds = hasAdditions ? addOrigin?.getBoundingClientRect() : null;
    const deleteTargetBounds = hasDeletions ? deleteTarget?.getBoundingClientRect() : null;
    const gutterLeft = beforeBounds.right - bounds.left;
    const gutterRight = afterBounds.left - bounds.left;
    const routes = routingArrows.map(({ arrow }) => {
      const color = previewArrowColors[arrow.kind];
      if (!color) return null;
      const source = arrow.kind === 'is-add' && !arrow.from
        ? addOriginBounds : previewNodeRow(before, arrow.from)?.getBoundingClientRect();
      const target = arrow.kind === 'is-delete' && !arrow.to
        ? deleteTargetBounds : previewNodeRow(after, arrow.to)?.getBoundingClientRect();
      if (!source && !target) return null;
      return { arrow, color, source, target };
    }).filter(Boolean).sort((left, right) => {
      const leftSourceY = left.source ? left.source.top + left.source.height / 2 : left.target?.top ?? 0;
      const leftTargetY = left.target ? left.target.top + left.target.height / 2 : left.source?.top ?? 0;
      const rightSourceY = right.source ? right.source.top + right.source.height / 2 : right.target?.top ?? 0;
      const rightTargetY = right.target ? right.target.top + right.target.height / 2 : right.source?.top ?? 0;
      return leftSourceY + leftTargetY - rightSourceY - rightTargetY || leftSourceY - rightSourceY;
    });
    const moveLaneGroups = new Map();
    const laneGroups = [];
    routes.forEach((route, index) => {
      if (route.arrow.kind !== 'is-move') {
        laneGroups.push({ routes: [route], firstIndex: index, parentY: null });
        return;
      }
      const parentId = previewPlan?.afterParents?.get(route.arrow.to) ?? null;
      const key = parentId;
      let group = moveLaneGroups.get(key);
      if (!group) {
        const parentRect = parentId
          ? previewNodeRow(after, parentId)?.getBoundingClientRect() : null;
        group = {
          routes: [],
          firstIndex: index,
          parentY: parentRect ? parentRect.top + parentRect.height / 2 : Number.POSITIVE_INFINITY,
        };
        moveLaneGroups.set(key, group);
        laneGroups.push(group);
      }
      group.routes.push(route);
      group.firstIndex = Math.min(group.firstIndex, index);
    });
    laneGroups.sort((left, right) => {
      if (left.parentY !== null && right.parentY !== null) return left.parentY - right.parentY;
      if (left.parentY !== null) return -1;
      if (right.parentY !== null) return 1;
      return left.firstIndex - right.firstIndex;
    });
    let nextLaneIndex = 0;
    laneGroups.forEach((group) => {
      const firstLaneIndex = nextLaneIndex;
      group.routes.forEach((route) => {
        route.laneIndex = nextLaneIndex;
        nextLaneIndex += 1;
      });
      if (group.routes.length > 1 && group.routes[0].arrow.kind === 'is-move') {
        const bendLaneIndex = (firstLaneIndex + nextLaneIndex - 1) / 2;
        group.routes.forEach((route) => { route.bendLaneIndex = bendLaneIndex; });
      }
    });
    const trackBankInset = Math.max(0, (gutterRight - gutterLeft - routes.length * trackGap) / 2);
    const assignPorts = (side) => {
      const groups = new Map();
      routes.forEach((route, index) => {
        const rect = route[side];
        if (!rect) return;
        const center = rect.top + rect.height / 2;
        const key = Math.round(center);
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key).push({ route, index, rect });
      });
      groups.forEach((entries) => {
        const range = Math.min(...entries.map(({ rect }) => Math.max(0, rect.height - 4)));
        const step = entries.length > 1 ? Math.min(4, range / (entries.length - 1)) : 0;
        entries.forEach(({ route, index }, position) => {
          route[side === 'source' ? 'startY' : 'endY'] = route[side].top + route[side].height / 2 - bounds.top
            + (position - (entries.length - 1) / 2) * step;
        });
      });
    };
    assignPorts('source');
    assignPorts('target');
    const appendRoutePath = ({ commands, arrow, color, marker = true }) => {
      const path = document.createElementNS(namespace, 'path');
      path.setAttribute('d', commands.join(' '));
      path.setAttribute('fill', 'none');
      path.setAttribute('stroke', color);
      path.setAttribute('stroke-width', '1.5');
      path.setAttribute('stroke-linejoin', 'round');
      if (marker) path.setAttribute('marker-end', `url(#ai-preview-arrowhead-${arrow.kind})`);
      path.dataset.operationIndex = String(arrow.operationIndex);
      if (arrow.excluded) path.setAttribute('stroke-dasharray', '4 3');
      if (arrow.excluded) path.setAttribute('opacity', '0.45');
      svg.append(path);
    };
    routes.forEach(({ arrow, color, source, target, laneIndex, bendLaneIndex }, index) => {
      const laneX = gutterLeft + trackBankInset + (routes.length - laneIndex - 0.5) * trackGap;
      const bendX = bendLaneIndex === undefined
        ? laneX
        : gutterLeft + trackBankInset + (routes.length - bendLaneIndex - 0.5) * trackGap;
      const channelY = height * (index + 1) / (routes.length + 1);
      const isAddition = arrow.kind === 'is-add' && !arrow.from;
      const startX = source ? (isAddition ? source.left + source.width / 2 : source.right) - bounds.left : laneX;
      const endX = target ? target.left - bounds.left : laneX;
      const startY = isAddition && source
        ? source.bottom - bounds.top
        : routes[index].startY ?? (target ? target.top + target.height / 2 - bounds.top : channelY);
      const endY = routes[index].endY ?? (source ? source.top + source.height / 2 - bounds.top : channelY);
      if (arrow.kind === 'is-move' && source && target) {
        const sourceToBendLength = Math.max(0, bendX - startX);
        const shortenedEndX = Math.max(bendX, endX - sourceToBendLength);
        appendRoutePath({ commands: [`M ${startX} ${startY} H ${bendX} V ${endY} H ${shortenedEndX}`], arrow, color });
        return;
      }
      const commands = [];
      if (isAddition && source && target) {
        commands.push(`M ${startX} ${startY} V ${endY} H ${endX}`);
      } else {
        if (source) commands.push(`M ${startX} ${startY} H ${laneX}`);
        else commands.push(`M ${laneX} ${channelY}`);
        if (target) commands.push(`V ${endY} H ${endX}`);
        else commands.push(`V ${channelY}`);
      }
      appendRoutePath({ commands, arrow, color });
    });
  };
  const clearPreviewHover = () => {
    document.querySelectorAll([
      '#ai-preview-before .is-ai-preview-hover-related',
      '#ai-preview-after .is-ai-preview-hover-related',
      '#ai-preview-before .is-ai-preview-hover-parent',
      '#ai-preview-after .is-ai-preview-hover-parent',
      '#ai-preview-before .is-ai-preview-wire-related',
      '#ai-preview-after .is-ai-preview-wire-related',
      '.ai-preview-change-item.is-ai-preview-change-hovered'
    ].join(', '))
      .forEach((node) => {
        node.classList.remove('is-ai-preview-hover-related', 'is-ai-preview-hover-parent',
          'is-ai-preview-wire-related', 'is-ai-preview-change-hovered');
      });
    document.querySelectorAll('#ai-preview-direction .is-ai-preview-arrow-hovered')
      .forEach((path) => path.classList.remove('is-ai-preview-arrow-hovered'));
    document.getElementById('ai-preview-add-origin')?.classList.remove('is-ai-preview-hover-related');
    document.getElementById('ai-preview-delete-target')?.classList.remove('is-ai-preview-hover-related');
  };
  const highlightParentConnection = (host, classId, parentByChild) => {
    const node = previewNodeRow(host, classId);
    if (!node) return;
    const row = node.closest('li');
    row?.classList.add('is-ai-preview-wire-related');
    const parentId = parentByChild.get(classId);
    if (!parentId) return;
    previewNodeRow(host, parentId)?.closest('details')
      ?.querySelector(':scope > .tree-level-rows')?.classList.add('is-ai-preview-wire-related');
  };
  const highlightMoveParent = (host, childId, parentByChild) => {
    const parentId = parentByChild.get(childId);
    if (parentId) previewNodeRow(host, parentId)?.classList.add('is-ai-preview-hover-parent');
  };
  const highlightMoveArrows = (arrows) => {
    const beforeHost = document.getElementById('ai-preview-before');
    const afterHost = document.getElementById('ai-preview-after');
    arrows.filter((arrow) => arrow.kind === 'is-move').forEach((arrow) => {
      highlightParentConnection(beforeHost, arrow.from, previewPlan.beforeParents);
      highlightParentConnection(afterHost, arrow.to, previewPlan.afterParents);
      highlightMoveParent(beforeHost, arrow.from, previewPlan.beforeParents);
      highlightMoveParent(afterHost, arrow.to, previewPlan.afterParents);
    });
  };
  const highlightMoveOperation = (operationIndex, row = null) => {
    clearPreviewHover();
    const matchingArrows = (previewPlan?.arrows || []).filter((arrow) => arrow.operationIndex === operationIndex
      && arrow.kind === 'is-move');
    if (!matchingArrows.length) return;
    row?.classList.add('is-ai-preview-change-hovered');
    const beforeHost = document.getElementById('ai-preview-before');
    const afterHost = document.getElementById('ai-preview-after');
    const arrowSvg = document.getElementById('ai-preview-direction');
    matchingArrows.forEach((arrow) => {
      previewNodeRow(beforeHost, arrow.from)?.classList.add('is-ai-preview-hover-related');
      previewNodeRow(afterHost, arrow.to)?.classList.add('is-ai-preview-hover-related');
      highlightParentConnection(beforeHost, arrow.from, previewPlan.beforeParents);
      highlightParentConnection(afterHost, arrow.to, previewPlan.afterParents);
      arrowSvg.querySelectorAll(`[data-operation-index="${arrow.operationIndex}"]`)
        .forEach((path) => path.classList.add('is-ai-preview-arrow-hovered'));
    });
    highlightMoveArrows(matchingArrows);
  };
  const highlightPreviewTarget = (target) => {
    clearPreviewHover();
    if (!target) return;
    const targetId = previewNodeId(target);
    const matchingArrows = (previewPlan?.arrows || []).filter((arrow) => arrow.to === targetId);
    if (!matchingArrows.length) return;
    target.classList.add('is-ai-preview-hover-related');
    const sourceHost = document.getElementById('ai-preview-before');
    const arrowSvg = document.getElementById('ai-preview-direction');
    matchingArrows.forEach((arrow) => {
      const source = previewNodeRow(sourceHost, arrow.from);
      source?.classList.add('is-ai-preview-hover-related');
      highlightParentConnection(sourceHost, arrow.from, previewPlan.beforeParents);
      highlightParentConnection(document.getElementById('ai-preview-after'), arrow.to, previewPlan.afterParents);
      if (!arrow.from && arrow.kind === 'is-add') document.getElementById('ai-preview-add-origin')?.classList.add('is-ai-preview-hover-related');
      if (arrow.kind === 'is-delete' && !arrow.to) document.getElementById('ai-preview-delete-target')?.classList.add('is-ai-preview-hover-related');
      arrowSvg.querySelectorAll(`[data-operation-index="${arrow.operationIndex}"]`)
        .forEach((path) => path.classList.add('is-ai-preview-arrow-hovered'));
    });
    highlightMoveArrows(matchingArrows);
  };
  const highlightPreviewSource = (sourceTarget) => {
    clearPreviewHover();
    if (!sourceTarget) return;
    const sourceId = previewNodeId(sourceTarget);
    const matchingArrows = (previewPlan?.arrows || []).filter((arrow) => arrow.from === sourceId);
    if (!matchingArrows.length) return;
    sourceTarget.classList.add('is-ai-preview-hover-related');
    const beforeHost = document.getElementById('ai-preview-before');
    const afterHost = document.getElementById('ai-preview-after');
    const arrowSvg = document.getElementById('ai-preview-direction');
    matchingArrows.forEach((arrow) => {
      previewNodeRow(afterHost, arrow.to)?.classList.add('is-ai-preview-hover-related');
      highlightParentConnection(beforeHost, sourceId, previewPlan.beforeParents);
      highlightParentConnection(afterHost, arrow.to, previewPlan.afterParents);
      if (arrow.kind === 'is-delete' && !arrow.to) document.getElementById('ai-preview-delete-target')?.classList.add('is-ai-preview-hover-related');
      arrowSvg.querySelectorAll(`[data-operation-index="${arrow.operationIndex}"]`)
        .forEach((path) => path.classList.add('is-ai-preview-arrow-hovered'));
    });
    highlightMoveArrows(matchingArrows);
  };
  const highlightPreviewAdditions = () => {
    clearPreviewHover();
    const addOrigin = document.getElementById('ai-preview-add-origin');
    const afterHost = document.getElementById('ai-preview-after');
    const arrowSvg = document.getElementById('ai-preview-direction');
    const additions = (previewPlan?.arrows || []).filter((arrow) => arrow.kind === 'is-add' && !arrow.from);
    if (!addOrigin || !additions.length) return;
    addOrigin.classList.add('is-ai-preview-hover-related');
    additions.forEach((arrow) => {
      previewNodeRow(afterHost, arrow.to)?.classList.add('is-ai-preview-hover-related');
      highlightParentConnection(afterHost, arrow.to, previewPlan.afterParents);
      arrowSvg.querySelectorAll(`[data-operation-index="${arrow.operationIndex}"]`)
        .forEach((path) => path.classList.add('is-ai-preview-arrow-hovered'));
    });
  };
  const highlightPreviewDeletions = () => {
    clearPreviewHover();
    const deleteTarget = document.getElementById('ai-preview-delete-target');
    const beforeHost = document.getElementById('ai-preview-before');
    const arrowSvg = document.getElementById('ai-preview-direction');
    const deletions = (previewPlan?.arrows || []).filter((arrow) => arrow.kind === 'is-delete' && !arrow.to);
    if (!deleteTarget || !deletions.length) return;
    deleteTarget.classList.add('is-ai-preview-hover-related');
    deletions.forEach((arrow) => {
      previewNodeRow(beforeHost, arrow.from)?.classList.add('is-ai-preview-hover-related');
      highlightParentConnection(beforeHost, arrow.from, previewPlan.beforeParents);
      arrowSvg.querySelectorAll(`[data-operation-index="${arrow.operationIndex}"]`)
        .forEach((path) => path.classList.add('is-ai-preview-arrow-hovered'));
    });
  };
  const addOrigin = document.getElementById('ai-preview-add-origin');
  addOrigin?.addEventListener('pointerenter', highlightPreviewAdditions);
  addOrigin?.addEventListener('pointerleave', clearPreviewHover);
  const deleteTarget = document.getElementById('ai-preview-delete-target');
  deleteTarget?.addEventListener('pointerenter', highlightPreviewDeletions);
  deleteTarget?.addEventListener('pointerleave', clearPreviewHover);
  const beforeTree = document.getElementById('ai-preview-before');
  beforeTree.addEventListener('pointerover', (event) => {
    const target = event.target.closest('.ai-preview-class[data-class-id], .tree-top-class > summary, .tree-middle-class > summary');
    if (!target || !beforeTree.contains(target)) return;
    if (event.relatedTarget instanceof Node && target.contains(event.relatedTarget)) return;
    highlightPreviewSource(target);
  });
  beforeTree.addEventListener('pointerout', (event) => {
    const target = event.target.closest('.ai-preview-class[data-class-id], .tree-top-class > summary, .tree-middle-class > summary');
    if (!target || !beforeTree.contains(target)) return;
    if (event.relatedTarget instanceof Node && target.contains(event.relatedTarget)) return;
    clearPreviewHover();
  });
  const afterTree = document.getElementById('ai-preview-after');
  afterTree.addEventListener('pointerover', (event) => {
    const target = event.target.closest('.ai-preview-class[data-class-id], .tree-top-class > summary, .tree-middle-class > summary');
    if (!target || !afterTree.contains(target)) return;
    if (event.relatedTarget instanceof Node && target.contains(event.relatedTarget)) return;
    highlightPreviewTarget(target);
  });
  afterTree.addEventListener('pointerout', (event) => {
    const target = event.target.closest('.ai-preview-class[data-class-id], .tree-top-class > summary, .tree-middle-class > summary');
    if (!target || !afterTree.contains(target)) return;
    if (event.relatedTarget instanceof Node && target.contains(event.relatedTarget)) return;
    clearPreviewHover();
  });
  const bindChangeListHover = (list) => {
    const rowFor = (event) => event.target.closest('.ai-preview-change-item[data-operation-index]');
    list.addEventListener('pointerover', (event) => {
      const row = rowFor(event);
      if (!row || !list.contains(row) || (event.relatedTarget instanceof Node && row.contains(event.relatedTarget))) return;
      const operation = previewPlan?.proposalItem.proposal.operations[Number(row.dataset.operationIndex)];
      if (operation?.type === 'moveClass' || operation?.type === 'moveChildren') {
        highlightMoveOperation(Number(row.dataset.operationIndex), row);
      } else clearPreviewHover();
    });
    list.addEventListener('pointerout', (event) => {
      const row = rowFor(event);
      if (!row || !list.contains(row) || (event.relatedTarget instanceof Node && row.contains(event.relatedTarget))) return;
      clearPreviewHover();
    });
    list.addEventListener('focusin', (event) => {
      const row = rowFor(event);
      if (!row || !list.contains(row)) return;
      const operation = previewPlan?.proposalItem.proposal.operations[Number(row.dataset.operationIndex)];
      if (operation?.type === 'moveClass' || operation?.type === 'moveChildren') {
        highlightMoveOperation(Number(row.dataset.operationIndex), row);
      } else clearPreviewHover();
    });
    list.addEventListener('focusout', (event) => {
      const row = rowFor(event);
      if (!row || !list.contains(row) || (event.relatedTarget instanceof Node && row.contains(event.relatedTarget))) return;
      clearPreviewHover();
    });
  };
  bindChangeListHover(document.getElementById('ai-preview-change-list'));
  bindChangeListHover(document.getElementById('ai-preview-final-change-list'));
  const updatePreviewSelection = (proposalItem, update) => {
    const previous = new Set(proposalItem.excludedOperationIndexes);
    update();
    void showPreview(proposalItem, false, true).catch((error) => {
      proposalItem.excludedOperationIndexes = previous;
      reportPreviewError(error);
      void showPreview(proposalItem, false, true).catch(reportPreviewError);
    });
  };
  const hierarchyPathFor = (state, id) => {
    const classesById = new Map(state.classes.map((item) => [item.id, item]));
    const parentByChild = new Map(state.relations.map(({ child, parent }) => [child, parent]));
    const labelCounts = new Map();
    state.classes.forEach((item) => labelCounts.set(item.label, (labelCounts.get(item.label) || 0) + 1));
    const segments = [];
    const seen = new Set();
    let current = id;
    while (current && classesById.has(current) && !seen.has(current)) {
      seen.add(current);
      const item = classesById.get(current);
      const shortId = current.split('/').pop();
      segments.unshift(labelCounts.get(item.label) > 1 ? `${item.label} [${shortId}]` : item.label);
      current = parentByChild.get(current);
    }
    return segments.join(' › ');
  };
  const renderPreviewChangeList = (proposalItem, indexes, listId, detailFor = () => '') => {
    const list = document.getElementById(listId);
    const rows = indexes.map((index) => {
      const operation = proposalItem.proposal.operations[index];
      const excluded = proposalItem.excludedOperationIndexes.has(index);
      const row = document.createElement('li');
      row.className = `ai-preview-change-item${excluded ? ' is-excluded' : ''}`;
      row.dataset.operationIndex = String(index);
      if (operation.type === 'moveClass' || operation.type === 'moveChildren') {
        row.tabIndex = 0;
        row.setAttribute('aria-label', operationLabel(operation));
      }
      const toggle = document.createElement('input');
      toggle.type = 'checkbox'; toggle.checked = !excluded;
      toggle.disabled = proposalItem.status === 'applied';
      toggle.setAttribute('aria-label', `${operationLabel(operation)}を適用する`);
      toggle.addEventListener('change', () => updatePreviewSelection(proposalItem, () => {
        if (toggle.checked) proposalItem.excludedOperationIndexes.delete(index);
        else proposalItem.excludedOperationIndexes.add(index);
      }));
      const text = document.createElement('span'); text.className = 'ai-preview-change-text'; text.textContent = operationLabel(operation);
      const detailText = detailFor(operation);
      if (detailText) {
        const detail = document.createElement('span');
        detail.className = 'ai-preview-change-detail';
        detail.textContent = detailText;
        text.append(detail);
      }
      const type = document.createElement('span'); type.className = `ai-preview-type-badge ${operationCategory(operation).className}`;
      const category = operationCategory(operation);
      type.textContent = category.label;
      if (['is-add', 'is-delete'].includes(category.className)) {
        type.classList.add('is-circular-action');
        type.textContent = category.className === 'is-add' ? '+' : '−';
        type.setAttribute('aria-label', category.label);
        type.title = category.label;
      }
      const status = document.createElement('span'); status.className = 'ai-preview-change-status'; status.textContent = excluded ? '除外' : '適用';
      row.append(type, toggle, text, status);
      return row;
    });
    list.replaceChildren(...rows);
  };
  const buildPreviewGroups = (proposalItem) => {
    const operations = proposalItem.proposal.operations;
    return [{ key: 'all', kind: 'all', indexes: operations.map((_, index) => index), title: 'すべての変更' }];
    const parentByChild = new Map(state.relations.map(({ child, parent }) => [child, parent]));
    const typeById = new Map(state.classes.map(({ id, type }) => [id, type]));
    const topAncestorFor = (id) => {
      let current = id;
      const seen = new Set();
      while (parentByChild.has(current) && !seen.has(current)) {
        seen.add(current);
        current = parentByChild.get(current);
      }
      return typeById.get(current) === 'top' ? current : id;
    };
    const addGroupByTemporaryId = new Map(operations
      .filter((operation) => operation.type === 'addClass' && operation.temporaryId)
      .map((operation) => [operation.temporaryId, `add:${operation.temporaryId}`]));
    const deletedIds = new Set(operations.filter((operation) => operation.type === 'deleteClass').map((operation) => operation.classId));
    const groupsByKey = new Map();
    operations.forEach((operation, index) => {
      const refs = ['classId', 'destinationId', 'parentId', 'from', 'to'].map((key) => operation[key]).filter(Boolean);
      const linkedAdd = refs.map((id) => addGroupByTemporaryId.get(id)).find(Boolean);
      let key = linkedAdd;
      let kind = linkedAdd ? 'addition' : '';
      if (!key && operation.type === 'addClass') {
        key = addGroupByTemporaryId.get(operation.temporaryId) || `operation:${index}`;
        kind = 'addition';
      } else if (!key && operation.type === 'deleteClass') {
        key = `delete:${operation.classId}`;
        kind = 'deletion';
      } else if (!key && operation.type === 'moveChildren' && deletedIds.has(operation.from)) {
        key = `delete:${operation.from}`;
        kind = 'deletion';
      } else if (!key && operation.type === 'moveClass' && deletedIds.has(parentByChild.get(operation.classId))) {
        key = `delete:${parentByChild.get(operation.classId)}`;
        kind = 'deletion';
      } else if (!key && operation.type === 'moveClass') {
        key = `destination:${operation.destinationId || ''}`;
        kind = 'destination';
      } else if (!key && operation.type === 'moveChildren') {
        key = `children:${operation.from || ''}:${operation.to || ''}`;
        kind = 'children';
      } else if (!key && operation.type === 'renameClass') {
        key = `rename-branch:${topAncestorFor(operation.classId)}`;
        kind = 'rename-branch';
      } else if (!key) {
        key = `class:${operation.classId || index}`;
        kind = 'class';
      }
      if (!groupsByKey.has(key)) groupsByKey.set(key, { key, kind, indexes: [] });
      groupsByKey.get(key).indexes.push(index);
    });
    return [...groupsByKey.values()].sort((left, right) => left.indexes[0] - right.indexes[0]).map((group) => {
      const first = operations[group.indexes[0]];
      let title = operationLabel(first);
      if (group.kind === 'destination' && group.indexes.length > 1) {
        title = `移動先「${getClassLabelsById().get(first.destinationId) || first.destinationId}」への移動`;
      } else if (group.kind === 'addition' && group.indexes.length > 1) {
        const addition = group.indexes.map((index) => operations[index]).find((operation) => operation.type === 'addClass');
        title = `「${addition?.label || '新しいクラス'}」の追加と関連する変更`;
      } else if (group.kind === 'deletion' && group.indexes.length > 1) {
        const deleted = operations.find((operation) => operation.type === 'deleteClass' && group.key === `delete:${operation.classId}`);
        title = `「${getClassLabelsById().get(deleted?.classId) || deleted?.classId || ''}」の削除に伴う変更`;
      } else if (group.kind === 'rename-branch' && group.indexes.length > 1) {
        const topId = group.key.slice('rename-branch:'.length);
        title = `「${getClassLabelsById().get(topId) || topId}」配下の名称変更`;
      } else if (group.indexes.length > 1) {
        title = `${title} ほか${group.indexes.length - 1}件`;
      }
      return { ...group, title };
    });
  };
  const renderPreviewGroupOverview = (proposalItem) => {
    const host = document.getElementById('ai-preview-group-overview');
    if (!host) return;
    host.replaceChildren(...previewGroups.map((group) => {
      const row = document.createElement('li');
      const title = document.createElement('strong');
      title.textContent = group.title;
      const state = document.createElement('span');
      const included = group.indexes.filter((index) => !proposalItem.excludedOperationIndexes.has(index)).length;
      state.textContent = included ? `適用 ${included}/${group.indexes.length}件` : `除外 ${group.indexes.length}件`;
      row.append(title, state);
      return row;
    }));
  };
  const updatePreviewPageChrome = (proposalItem) => {
    const totalPages = 1;
    const overview = document.getElementById('ai-preview-overview-page');
    const changes = document.getElementById('ai-preview-change-page');
    const final = document.getElementById('ai-preview-final-page');
    const previous = document.getElementById('ai-preview-page-previous');
    const next = document.getElementById('ai-preview-page-next');
    const apply = document.getElementById('ai-apply-proposal');
    const groupIndex = 0;
    overview.hidden = false;
    changes.hidden = false;
    final.hidden = true;
    previous.hidden = true;
    next.hidden = true;
    apply.hidden = proposalItem.status === 'applied';
    document.getElementById('ai-preview-page-position').textContent = '';
    if (!changes.hidden) {
      const total = proposalItem.proposal.operations.length;
      const excluded = proposalItem.excludedOperationIndexes || new Set();
      const applicable = proposalItem.proposal.operations.reduce((count, _, index) => count + Number(!excluded.has(index)), 0);
      document.getElementById('ai-preview-group-label').textContent = `変更一覧（適用 ${applicable}/${total}件）`;
    }
    renderPreviewGroupOverview(proposalItem);
  };
  const previewableProposals = () => getCurrentConversation().items.filter((item) => item.type === 'proposal'
    && item.proposal.operations.length
    && !['awaiting-answers', 'superseded', 'invalid'].includes(item.status));
  const hasUnsubmittedQuestions = (responseGroupId) => getCurrentConversation().items.some((item) =>
    item.type === 'questions' && !item.submitted && item.responseGroupId === responseGroupId);
  const updatePreviewNavigation = (proposalItem) => {
    const items = previewableProposals();
    const index = items.indexOf(proposalItem);
    const navigation = document.getElementById('ai-preview-navigation');
    const previous = document.getElementById('ai-preview-previous');
    const next = document.getElementById('ai-preview-next');
    navigation.hidden = items.length < 2;
    previous.disabled = index <= 0;
    next.disabled = index < 0 || index >= items.length - 1;
    document.getElementById('ai-preview-position').textContent = index < 0 ? '' : `${index + 1} / ${items.length}`;
  };
  const updatePreviewProposalHeading = (proposalItem) => {
    const operationsCount = proposalItem.proposal.operations.length;
    const statusLabels = {
      pending: '保留中', previewed: '確認済み', stale: '再確認待ち', applied: '適用済み',
      'awaiting-answers': '回答待ち', superseded: '回答済み', invalid: '無効'
    };
    const status = statusLabels[proposalItem.status] || '保留中';
    const questionCount = proposalItem.proposal.questions?.length || 0;
    const questionStatus = proposalItem.status === 'awaiting-answers' && questionCount
      ? `・確認事項${questionCount}件` : '';
    document.getElementById('ai-preview-proposal-heading').textContent = `変更案（${operationsCount}件・${status}${questionStatus}）`;
  };
  const syncProposalPage = (proposalItem) => {
    const groupItems = getCurrentConversation().items.filter((item) => item.type === 'proposal'
      && (proposalItem.responseGroupId
        ? item.responseGroupId === proposalItem.responseGroupId
        : item === proposalItem));
    const index = groupItems.indexOf(proposalItem);
    if (index >= 0 && groupItems.length) groupItems[0].proposalPageIndex = index;
  };
  const showPreview = async (proposalItem, applyRequested = false, fastUpdate = false) => {
    const previewColumns = document.querySelector('.ai-preview-columns');
    previewColumns?.classList.add('is-loading');
    syncProposalPage(proposalItem);
    if (hasUnsubmittedQuestions(proposalItem.responseGroupId)) {
      if (previewDialog.open) closePreview();
      return false;
    }
    const applyButton = document.getElementById('ai-apply-proposal');
    if (!fastUpdate) {
      applyButton.disabled = true;
      previewPlan = null;
    }
    const operations = proposalItem.proposal.operations;
    const isApplied = proposalItem.status === 'applied' && Boolean(proposalItem.appliedPreviewSnapshot);
    let previewBaseHash = fastUpdate ? previewPlan?.expectedBaseHash : '';
    if (!operations.length) throw new Error('変更操作が残っていません。この提案は適用する内容がありません。');
    proposalItem.excludedOperationIndexes ||= new Set();
    if (!fastUpdate) {
      previewPageIndex = 0;
      previewGroups = buildPreviewGroups(proposalItem);
      updatePreviewNavigation(proposalItem);
      updatePreviewProposalHeading(proposalItem);
      renderPreviewTypeLegend(proposalItem.proposal.operations);
      document.getElementById('ai-preview-summary').textContent = proposalItem.proposal.summary || proposalItem.proposal.title || '変更内容の説明はありません。';
      document.getElementById('ai-preview-reason').textContent = proposalItem.proposal.reason || '理由の記載はありません。';
      document.getElementById('ai-preview-uncertainties').textContent = proposalItem.proposal.uncertainties?.length
        ? proposalItem.proposal.uncertainties.join('、') : '特になし';
      document.getElementById('ai-preview-change-list-details').open = false;
      document.getElementById('ai-preview-change-list').replaceChildren();
      document.getElementById('ai-preview-final-change-list').replaceChildren();
      const impact = document.getElementById('ai-preview-impact');
      impact.classList.add('is-loading');
      impact.textContent = 'プレビューを作成しています…';
      document.getElementById('ai-preview-before').replaceChildren();
      document.getElementById('ai-preview-after').replaceChildren();
      if (!previewDialog.open) previewDialog.showModal();
      await new Promise((resolve) => requestAnimationFrame(resolve));
      const [, currentHash] = await Promise.all([
        verifyLoadedDataVersion(),
        isApplied ? Promise.resolve('') : currentDataHash()
      ]);
      if (!isApplied) previewBaseHash = currentHash;
      if (!isApplied && proposalItem.status !== 'stale' && proposalItem.baseDataHash !== currentHash) {
        throw new Error('提案作成後にデータが変更されています。最新状態で依頼し直してください。');
      }
    }
    const expectedFingerprint = fastUpdate ? previewPlan?.expectedFingerprint : stateFingerprint();
    if (!isApplied && (!expectedFingerprint || stateFingerprint() !== expectedFingerprint)) {
      throw new Error('プレビュー作成後にデータが変更されています。最新データで提案し直してください。');
    }
    const activeOperations = operations.filter((_, index) => !proposalItem.excludedOperationIndexes.has(index));
    const proposedCandidate = isApplied ? proposalItem.appliedPreviewSnapshot.after
      : editor.applyOperations(operations, expectedFingerprint, proposalItem.editableIds, proposalItem.availableIds);
    const candidate = isApplied || activeOperations.length === operations.length ? proposedCandidate
      : editor.applyOperations(activeOperations, expectedFingerprint, proposalItem.editableIds, proposalItem.availableIds);
    const expectedBaseHash = isApplied ? '' : previewBaseHash;
    if (proposalItem.status === 'stale') {
      proposalItem.baseDataHash = expectedBaseHash;
      proposalItem.status = 'previewed';
    } else if (proposalItem.status === 'pending') {
      proposalItem.status = 'previewed';
    }
    updatePreviewProposalHeading(proposalItem);
    if (!isApplied && stateFingerprint() !== expectedFingerprint) throw new Error('プレビュー作成中にデータが変更されました。最新データで提案し直してください。');
    const beforeState = isApplied ? proposalItem.appliedPreviewSnapshot.before : editor.getState();
    const beforeIds = new Set(beforeState.classes.map((item) => item.id));
    const beforeParents = new Map(beforeState.relations.map(({ child, parent }) => [child, parent]));
    const afterParents = new Map(proposedCandidate.relations.map(({ child, parent }) => [child, parent]));
    const proposedIds = new Set(proposedCandidate.classes.map((item) => item.id));
    const operationIds = new Set();
    const affectedIds = new Set();
    const operationIndexesByClass = new Map();
    const deletionOperationByClass = new Map();
    const addOperationClass = (id, index) => {
      if (!id) return;
      if (!operationIndexesByClass.has(id)) operationIndexesByClass.set(id, new Set());
      operationIndexesByClass.get(id).add(index);
      operationIds.add(id);
      affectedIds.add(id);
    };
    const addedClassForReference = (reference) => {
      const addition = operations.find((operation) => operation.type === 'addClass'
        && (operation.temporaryId === reference || `${proposalItem.proposal.id}/${operation.temporaryId}` === reference));
      if (!addition) return null;
      const convertedId = proposedCandidate.idRemaps?.get(reference)
        || proposedCandidate.idRemaps?.get(addition.temporaryId);
      if (convertedId) return proposedCandidate.classes.find((item) => item.id === convertedId) || null;
      return proposedCandidate.classes.find((item) => !beforeIds.has(item.id)
        && item.type === addition.classType && item.label === String(addition.label || '').trim()) || null;
    };
    const addedOperationIndexesByClass = new Map();
    operations.forEach((operation, operationIndex) => {
      if (operation.type !== 'addClass') return;
      const added = addedClassForReference(operation.temporaryId);
      if (!added) return;
      const relatedIndexes = new Set([operationIndex]);
      const references = new Set([operation.temporaryId, `${proposalItem.proposal.id}/${operation.temporaryId}`, added.id]);
      let changed = true;
      while (changed) {
        changed = false;
        operations.forEach((candidateOperation, candidateIndex) => {
          if (relatedIndexes.has(candidateIndex)) return;
          const refs = ['temporaryId', 'parentId', 'classId', 'destinationId', 'from', 'to']
            .map((key) => candidateOperation[key]).filter(Boolean);
          if (!refs.some((reference) => references.has(reference))) return;
          relatedIndexes.add(candidateIndex);
          if (candidateOperation.type === 'addClass' && candidateOperation.temporaryId
            && !references.has(candidateOperation.temporaryId)) {
            references.add(candidateOperation.temporaryId);
            references.add(`${proposalItem.proposal.id}/${candidateOperation.temporaryId}`);
          }
          changed = true;
        });
      }
      addedOperationIndexesByClass.set(added.id, [...relatedIndexes]);
    });
    const resolveProposedId = (reference) => proposedIds.has(reference) || beforeIds.has(reference)
      ? proposedCandidate.idRemaps?.get(reference) || reference
      : addedClassForReference(reference)?.id || proposedCandidate.idRemaps?.get(reference) || reference;
    operations.forEach((operation, index) => {
      if (operation.type === 'addClass') {
        addOperationClass(addedClassForReference(operation.temporaryId)?.id, index);
        return;
      }
      if (operation.type === 'moveChildren') {
        const from = resolveProposedId(operation.from); const to = resolveProposedId(operation.to);
        for (const id of new Set([...beforeParents.keys(), ...afterParents.keys()])) {
          if (beforeParents.get(id) === from && afterParents.get(id) === to) addOperationClass(id, index);
        }
        addOperationClass(from, index);
        return;
      }
      const id = resolveProposedId(operation.classId);
      addOperationClass(id, index);
      if (id !== operation.classId && beforeIds.has(operation.classId)) addOperationClass(operation.classId, index);
      if (operation.type === 'deleteClass') deletionOperationByClass.set(id, index);
    });
    const previewArrows = [];
    operations.forEach((operation, index) => {
      const kind = operationCategory(operation).className;
      const excluded = proposalItem.excludedOperationIndexes.has(index);
      if (operation.type === 'addClass') {
        const added = addedClassForReference(operation.temporaryId);
        if (added) previewArrows.push({ kind, from: '', to: added.id, excluded, operationIndex: index });
      } else if (operation.type === 'deleteClass') {
        previewArrows.push({ kind, from: operation.classId, to: '', excluded, operationIndex: index });
      } else if (operation.type === 'renameClass') {
        const id = resolveProposedId(operation.classId);
        previewArrows.push({ kind, from: operation.classId, to: id, excluded, operationIndex: index });
      } else if (operation.type === 'moveClass') {
        const targetClass = resolveProposedId(operation.classId);
        previewArrows.push({ kind, from: operation.classId, to: targetClass, excluded, operationIndex: index });
      } else if (operation.type === 'moveChildren') {
        const source = resolveProposedId(operation.from);
        for (const id of beforeParents.keys()) {
          if (beforeParents.get(id) === source && afterParents.get(id) === resolveProposedId(operation.to)) {
            const targetClass = resolveProposedId(id);
            previewArrows.push({ kind, from: id, to: targetClass, excluded, operationIndex: index });
          }
        }
      }
    });
    for (const id of new Set([...beforeParents.keys(), ...afterParents.keys()])) {
      if (beforeParents.get(id) !== afterParents.get(id)) {
        operationIds.add(id);
        affectedIds.add(id);
      }
    }
    for (const item of proposedCandidate.classes) {
      const original = beforeState.classes.find((candidateItem) => candidateItem.id === item.id);
      if (!original || original.label !== item.label) {
        operationIds.add(item.id);
        affectedIds.add(item.id);
      }
    }
    const deletedIds = new Set(beforeState.classes.filter((item) => !proposedIds.has(item.id)
      && deletionOperationByClass.has(item.id)).map((item) => item.id));
    deletedIds.forEach((id) => { operationIds.add(id); affectedIds.add(id); });
    const proposedDisplayState = {
      classes: [...candidate.classes],
      relations: [...candidate.relations],
      counts: beforeState.counts
    };
    const displayedIds = new Set(proposedDisplayState.classes.map((item) => item.id));
    const excludedAdditions = proposedCandidate.classes.filter((item) => !beforeIds.has(item.id) && !displayedIds.has(item.id));
    excludedAdditions.forEach((item) => {
      proposedDisplayState.classes.push({ ...item, previewExcluded: true });
      displayedIds.add(item.id);
    });
    const excludedAdditionIds = new Set(excludedAdditions.map((item) => item.id));
    proposedCandidate.relations.forEach((relation) => {
      if (excludedAdditionIds.has(relation.child) && displayedIds.has(relation.parent)
        && !proposedDisplayState.relations.some((existing) => existing.child === relation.child)) {
        proposedDisplayState.relations.push({ ...relation });
      }
    });
    deletedIds.forEach((id) => {
      const removed = beforeState.classes.find((item) => item.id === id);
      if (removed && !displayedIds.has(id)) {
        proposedDisplayState.classes.push({ ...removed, previewDeleted: true });
        displayedIds.add(id);
      }
      const oldRelation = beforeState.relations.find((relation) => relation.child === id);
      if (oldRelation && displayedIds.has(oldRelation.parent)
        && !proposedDisplayState.relations.some((relation) => relation.child === id)) proposedDisplayState.relations.push(oldRelation);
    });
    const displayParents = new Map(proposedDisplayState.relations.map(({ child, parent }) => [child, parent]));
    const displayIds = new Set(proposedDisplayState.classes.map((item) => item.id));
    const addAncestors = (ids, parentByChild, validIds) => {
      for (const id of [...ids]) {
        let parent = parentByChild.get(id);
        while (parent && validIds.has(parent) && !ids.has(parent)) {
          ids.add(parent);
          parent = parentByChild.get(parent);
        }
      }
    };
    const before = document.getElementById('ai-preview-before'); const after = document.getElementById('ai-preview-after');
    const previewState = (state, previewIds = operationIds) => ({
      classes: state.classes.filter((item) => previewIds.has(item.id)),
      relations: state.relations.filter(({ child, parent }) => previewIds.has(child) && previewIds.has(parent)),
      counts: beforeState.counts
    });
    const beforeHierarchyCounts = countHierarchyTargets(beforeState);
    const afterHierarchyCounts = countHierarchyTargets(candidate);
    const hierarchyCountLabel = (counts) => (node) => {
      const total = counts.totals.get(node.id) || 0;
      const direct = counts.direct.get(node.id) || 0;
      return `合計 ${total}件・直下 ${direct}件`;
    };
    const operationDetail = (operation) => {
      if (operation.type === 'moveClass') {
        const beforePath = hierarchyPathFor(beforeState, operation.classId);
        const afterId = resolveProposedId(operation.classId);
        const afterPath = hierarchyPathFor(candidate, afterId);
        return `変更前: ${beforePath}\n変更後: ${afterPath}`;
      }
      if (operation.type === 'moveChildren') {
        const from = resolveProposedId(operation.from);
        const to = resolveProposedId(operation.to);
        return `移動元: ${hierarchyPathFor(beforeState, from)}\n移動先: ${hierarchyPathFor(candidate, to)}`;
      }
      return '';
    };
    updatePreviewPageChrome(proposalItem);
    const currentGroupIndex = 0;
    const currentGroup = previewGroups[currentGroupIndex];
    before.replaceChildren();
    after.replaceChildren();
    if (currentGroup) {
      // 変更対象と各状態で必要な祖先だけを表示し、反対側の親階層は混ぜない。
      const beforeAffectedIds = new Set(operationIds);
      const afterAffectedIds = new Set(operationIds);
      addAncestors(beforeAffectedIds, beforeParents, beforeIds);
      addAncestors(afterAffectedIds, displayParents, displayIds);
      const beforePreviewState = previewState(beforeState, beforeAffectedIds);
      const afterPreviewState = previewState(proposedDisplayState, afterAffectedIds);
      const beforeCounterpartRanks = getPreviewVerticalRanks(afterPreviewState, afterAffectedIds);
      const afterCounterpartRanks = getPreviewVerticalRanks(beforePreviewState, beforeAffectedIds);
      appendTree(before, beforePreviewState, beforeAffectedIds, {
        countLabelFor: hierarchyCountLabel(beforeHierarchyCounts),
        operationIndexesByClass, addedOperationIndexesByClass, operations, deletionOperationByClass,
        counterpartRanks: beforeCounterpartRanks,
        excludedOperationIndexes: proposalItem.excludedOperationIndexes
      });
      appendTree(after, afterPreviewState, afterAffectedIds, {
        selectable: !isApplied,
        countLabelFor: hierarchyCountLabel(afterHierarchyCounts),
        operationIndexesByClass, addedOperationIndexesByClass, operations,
        counterpartRanks: afterCounterpartRanks,
        deletionOperationByClass,
        excludedOperationIndexes: proposalItem.excludedOperationIndexes,
        onToggle: (indexes, include) => {
          updatePreviewSelection(proposalItem, () => {
            indexes.forEach((index) => include
              ? proposalItem.excludedOperationIndexes.delete(index)
              : proposalItem.excludedOperationIndexes.add(index));
          });
        }
      });
      renderPreviewChangeList(proposalItem, currentGroup.indexes, 'ai-preview-change-list', operationDetail);
    } else {
      renderPreviewChangeList(proposalItem, [], 'ai-preview-change-list');
    }
    renderPreviewChangeList(proposalItem, operations.map((_, index) => index), 'ai-preview-final-change-list', operationDetail);
    const impact = document.getElementById('ai-preview-impact');
    impact.classList.remove('is-loading');
    impact.textContent = '';
    document.getElementById('ai-preview-group-include').hidden = isApplied;
    document.getElementById('ai-preview-group-exclude').hidden = isApplied;
    previewPlan = { proposalItem, operations: activeOperations.map((operation) => ({ ...operation })), arrows: previewArrows,
      beforeParents: new Map(beforeParents), afterParents: new Map(displayParents), candidate,
      expectedFingerprint, expectedBaseHash, readOnly: isApplied };
    previewColumns?.classList.remove('is-loading');
    requestAnimationFrame(() => renderPreviewArrows(previewArrows));
    applyButton.disabled = isApplied || activeOperations.length === 0;
    if (applyRequested && activeOperations.length) applyButton.focus();
  };
  const navigatePreview = (direction) => {
    if (!previewPlan) return;
    const items = previewableProposals();
    const index = items.indexOf(previewPlan.proposalItem);
    const next = items[index + direction];
    if (!next) return;
    void transitionPreview(() => showPreview(next)).then(() => renderConversation()).catch(reportPreviewError);
  };
  const transitionPreview = async (renderNext) => {
    const arrowSvg = document.getElementById('ai-preview-direction');
    const arrowToggle = document.getElementById('ai-preview-arrow-toggle');
    const shouldRestoreArrows = arrowToggle.getAttribute('aria-checked') === 'true' && !arrowSvg.hidden;
    if (shouldRestoreArrows) arrowSvg.style.visibility = 'hidden';
    try {
      await renderNext();
      await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    } finally {
      if (shouldRestoreArrows) {
        arrowSvg.style.visibility = '';
        if (arrowToggle.getAttribute('aria-checked') === 'true' && !arrowSvg.hidden) {
          renderPreviewArrows(previewPlan?.arrows || []);
        }
      }
    }
  };
  const navigatePreviewPage = (direction) => {
    if (!previewPlan) return;
    const totalPages = previewGroups.length + 2;
    const nextIndex = Math.max(0, Math.min(totalPages - 1, previewPageIndex + direction));
    if (nextIndex === previewPageIndex) return;
    previewPageIndex = nextIndex;
    void transitionPreview(() => showPreview(previewPlan.proposalItem, false, true)).then(() => {
      previewDialog.scrollTop = 0;
    }).catch(reportPreviewError);
  };
  const applyCurrentProposal = async () => {
    const plan = previewPlan;
    if (!plan || plan.readOnly || plan.proposalItem.status === 'applied') return null;
    if (hasUnsubmittedQuestions(plan.proposalItem.responseGroupId)) {
      closePreview();
      return null;
    }
    const currentProposal = plan.proposalItem;
    const proposals = previewableProposals();
    const currentProposalIndex = proposals.indexOf(currentProposal);
    const nextProposal = currentProposalIndex >= 0 ? proposals[currentProposalIndex + 1] : null;
    await verifyLoadedDataVersion();
    const currentHash = await currentDataHash();
    if (currentHash !== plan.expectedBaseHash) throw new Error('提案の作成後にデータが変更されました。最新データで提案し直してください。');
    const candidate = editor.applyOperations(plan.operations, plan.expectedFingerprint, currentProposal.editableIds, currentProposal.availableIds);
    const beforeSnapshot = editor.getState();
    currentProposal.appliedPreviewSnapshot = {
      before: { classes: beforeSnapshot.classes.map((item) => ({ ...item })), relations: beforeSnapshot.relations.map((item) => ({ ...item })), counts: beforeSnapshot.counts },
      after: { classes: candidate.classes.map((item) => ({ ...item })), relations: candidate.relations.map((item) => ({ ...item })), idRemaps: new Map(candidate.idRemaps || []) }
    };
    editor.commitCandidate(candidate);
    currentProposal.status = 'applied';
    const proposalGroup = getCurrentConversation().items.find((item) => item.type === 'proposal'
      && (currentProposal.responseGroupId
        ? item.responseGroupId === currentProposal.responseGroupId
        : item === currentProposal));
    if (proposalGroup) proposalGroup.proposalsOpen = false;
    getCurrentConversation().items.filter((item) => item.type === 'proposal' && item !== currentProposal && item.status !== 'applied')
      .forEach((item) => { item.status = 'stale'; });
    return { currentProposal, nextProposal };
  };
    return {
      showPreview,
      navigatePreview,
      navigatePreviewPage,
      transitionPreview,
      updatePreviewSelection,
      renderPreviewArrows,
      previewableProposals,
      hasUnsubmittedQuestions,
      applyCurrentProposal,
      clear() { previewPlan = null; previewPageIndex = 0; previewGroups = []; },
      get plan() { return previewPlan; },
      get groups() { return previewGroups; }
    };
};
