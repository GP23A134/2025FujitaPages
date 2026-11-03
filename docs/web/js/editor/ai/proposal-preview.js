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
      .map((item) => buildNode(item.id)).filter(Boolean);
    host.classList.add('tree');
    const targetCountFor = (item) => state.counts?.[item.id] || 0;
    const countFor = (node) => node.targets.length + node.children.reduce((sum, child) => sum + countFor(child), 0);
    const indexesFor = (id) => Array.from(options.operationIndexesByClass?.get(id) || []);
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
    const makeToggle = (id, label) => {
      const indexes = indexesFor(id);
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
    window.renderHierarchyTree(host, roots, {
      countFor,
      targetCountFor,
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
        const checkbox = node.type === 'middle' ? null : makeToggle(node.id, node.label);
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
  const renderPreviewArrows = (arrows = []) => {
    const svg = document.getElementById('ai-preview-direction');
    const columns = document.querySelector('.ai-preview-columns');
    if (!svg || !columns || svg.hidden) return;
    const bounds = svg.getBoundingClientRect();
    if (!bounds.width || !bounds.height) return;
    const laneWidth = Math.max(96, arrows.length * 4 + 32);
    const routingHeight = Math.max(100, arrows.length * 3 + 32);
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
    const gutterLeft = beforeBounds.right - bounds.left;
    const gutterRight = afterBounds.left - bounds.left;
    const routes = arrows.map((arrow) => {
      const color = previewArrowColors[arrow.kind];
      if (!color) return null;
      const source = previewNodeRow(before, arrow.from)?.getBoundingClientRect();
      const target = previewNodeRow(after, arrow.to)?.getBoundingClientRect();
      if (!source && !target) return null;
      return { arrow, color, source, target };
    }).filter(Boolean).sort((left, right) => {
      const leftY = left.source?.top ?? left.target?.top ?? 0;
      const rightY = right.source?.top ?? right.target?.top ?? 0;
      return leftY - rightY;
    });
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
    routes.forEach(({ arrow, color, source, target }, index) => {
      const trackInset = Math.min(6 + index * 2, Math.max(6, (gutterRight - gutterLeft) / 2 - 4));
      const leftTrack = gutterLeft + trackInset;
      const rightTrack = gutterRight - trackInset;
      const channelY = height * (index + 1) / (routes.length + 1);
      const startX = source ? source.right - bounds.left : leftTrack;
      const endX = target ? target.left - bounds.left : rightTrack;
      const startY = routes[index].startY ?? (target ? target.top + target.height / 2 - bounds.top : channelY);
      const endY = routes[index].endY ?? (source ? source.top + source.height / 2 - bounds.top : channelY);
      const path = document.createElementNS(namespace, 'path');
      const commands = [];
      if (source) commands.push(`M ${startX} ${startY} H ${leftTrack} V ${channelY}`);
      else commands.push(`M ${leftTrack} ${channelY}`);
      commands.push(`H ${rightTrack}`);
      if (target) commands.push(`V ${endY} H ${endX}`);
      path.setAttribute('d', commands.join(' '));
      path.setAttribute('fill', 'none');
      path.setAttribute('stroke', color);
      path.setAttribute('stroke-width', '2.5');
      path.setAttribute('stroke-linejoin', 'round');
      path.setAttribute('marker-end', `url(#ai-preview-arrowhead-${arrow.kind})`);
      if (arrow.excluded) path.setAttribute('stroke-dasharray', '4 3');
      if (arrow.excluded) path.setAttribute('opacity', '0.45');
      svg.append(path);
    });
  };
  const updatePreviewSelection = (proposalItem, update) => {
    const previous = new Set(proposalItem.excludedOperationIndexes);
    update();
    void showPreview(proposalItem, false, true).catch((error) => {
      proposalItem.excludedOperationIndexes = previous;
      reportPreviewError(error);
      void showPreview(proposalItem, false, true).catch(reportPreviewError);
    });
  };
  const renderPreviewChangeList = (proposalItem, indexes, listId) => {
    const list = document.getElementById(listId);
    const rows = indexes.map((index) => {
      const operation = proposalItem.proposal.operations[index];
      const excluded = proposalItem.excludedOperationIndexes.has(index);
      const row = document.createElement('li');
      row.className = `ai-preview-change-item${excluded ? ' is-excluded' : ''}`;
      const toggle = document.createElement('input');
      toggle.type = 'checkbox'; toggle.checked = !excluded;
      toggle.disabled = proposalItem.status === 'applied';
      toggle.setAttribute('aria-label', `${operationLabel(operation)}を適用する`);
      toggle.addEventListener('change', () => updatePreviewSelection(proposalItem, () => {
        if (toggle.checked) proposalItem.excludedOperationIndexes.delete(index);
        else proposalItem.excludedOperationIndexes.add(index);
      }));
      const text = document.createElement('span'); text.className = 'ai-preview-change-text'; text.textContent = operationLabel(operation);
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
      await verifyLoadedDataVersion();
      if (!isApplied && proposalItem.status !== 'stale' && proposalItem.baseDataHash !== await currentDataHash()) {
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
    const candidate = isApplied ? proposedCandidate
      : editor.applyOperations(activeOperations, expectedFingerprint, proposalItem.editableIds, proposalItem.availableIds);
    const expectedBaseHash = isApplied ? '' : fastUpdate ? previewPlan.expectedBaseHash : await currentDataHash();
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
        if (added) previewArrows.push({ kind, from: '', to: added.id, excluded });
      } else if (operation.type === 'deleteClass') {
        previewArrows.push({ kind, from: operation.classId, to: '', excluded });
      } else if (operation.type === 'renameClass') {
        const id = resolveProposedId(operation.classId);
        previewArrows.push({ kind, from: operation.classId, to: id, excluded });
      } else if (operation.type === 'moveClass') {
        const targetClass = resolveProposedId(operation.classId);
        previewArrows.push({ kind, from: operation.classId, to: targetClass, excluded });
      } else if (operation.type === 'moveChildren') {
        const source = resolveProposedId(operation.from);
        for (const id of beforeParents.keys()) {
          if (beforeParents.get(id) === source && afterParents.get(id) === resolveProposedId(operation.to)) {
            const targetClass = resolveProposedId(id);
            previewArrows.push({ kind, from: id, to: targetClass, excluded });
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
    addAncestors(operationIds, beforeParents, beforeIds);
    addAncestors(operationIds, displayParents, displayIds);
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
    updatePreviewPageChrome(proposalItem);
    const currentGroupIndex = 0;
    const currentGroup = previewGroups[currentGroupIndex];
    before.replaceChildren();
    after.replaceChildren();
    if (currentGroup) {
      // 変更箇所と、その変更前後の親経路だけを表示対象にする。
      // 全クラスを含めると、提案と無関係な枝までプレビューに出てしまう。
      const groupAffectedIds = new Set(operationIds);
      addAncestors(groupAffectedIds, beforeParents, beforeIds);
      addAncestors(groupAffectedIds, displayParents, displayIds);
      const groupPreviewState = (state) => previewState(state, groupAffectedIds);
      appendTree(before, groupPreviewState(beforeState), groupAffectedIds, {
        countLabelFor: hierarchyCountLabel(beforeHierarchyCounts),
        operationIndexesByClass, operations, deletionOperationByClass,
        excludedOperationIndexes: proposalItem.excludedOperationIndexes
      });
      appendTree(after, groupPreviewState(proposedDisplayState), groupAffectedIds, {
        selectable: !isApplied,
        countLabelFor: hierarchyCountLabel(afterHierarchyCounts),
        operationIndexesByClass, operations,
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
      renderPreviewChangeList(proposalItem, currentGroup.indexes, 'ai-preview-change-list');
    } else {
      renderPreviewChangeList(proposalItem, [], 'ai-preview-change-list');
    }
    renderPreviewChangeList(proposalItem, operations.map((_, index) => index), 'ai-preview-final-change-list');
    const impact = document.getElementById('ai-preview-impact');
    impact.classList.remove('is-loading');
    impact.textContent = '';
    document.getElementById('ai-preview-group-include').hidden = isApplied;
    document.getElementById('ai-preview-group-exclude').hidden = isApplied;
    previewPlan = { proposalItem, operations: activeOperations.map((operation) => ({ ...operation })), arrows: previewArrows, candidate, expectedFingerprint, expectedBaseHash, readOnly: isApplied };
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
