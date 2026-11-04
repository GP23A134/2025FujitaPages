// データ全体の規模・分布・重複・関係整合性をID単位で集計し、閲覧画面の集計欄を描画する。
const aggregationNumber = (value) => Number(value || 0).toLocaleString('ja-JP');
const aggregationPercent = (part, whole) => whole ? `${(part / whole * 100).toFixed(1)}%` : '—';
const aggregationClassLevel = (id) => /\/t_/.test(id) ? '上位' : /\/m_/.test(id) ? '中間' : /\/c_/.test(id) ? '対象' : '不明';
let aggregationHideZeroIntegrity = true;
let aggregationHideZeroLabelId = true;
const aggregationDetailDialog = document.getElementById('aggregation-detail-dialog');
const aggregationDetailDialogToolbar = document.getElementById('aggregation-detail-dialog-toolbar');
const aggregationDetailDialogContent = document.getElementById('aggregation-detail-dialog-content');
const aggregationDetailOpenAllButton = document.getElementById('aggregation-detail-open-all');
const aggregationDetailCloseAllButton = document.getElementById('aggregation-detail-close-all');
aggregationDetailOpenAllButton?.addEventListener('click', () => {
  aggregationDetailDialogContent.querySelectorAll('.aggregation-duplicate-group').forEach((group) => { group.open = true; });
});
aggregationDetailCloseAllButton?.addEventListener('click', () => {
  aggregationDetailDialogContent.querySelectorAll('.aggregation-duplicate-group').forEach((group) => { group.open = false; });
});
aggregationDetailDialog?.addEventListener('click', (event) => {
  if (event.target !== aggregationDetailDialog) return;
  const rect = aggregationDetailDialog.getBoundingClientRect();
  if (event.clientX < rect.left || event.clientX > rect.right
    || event.clientY < rect.top || event.clientY > rect.bottom) aggregationDetailDialog.close();
});
aggregationDetailDialog?.addEventListener('close', () => {
  const host = document.getElementById(aggregationDetailDialog.dataset.activeListHost || '');
  const returnToHost = [...aggregationDetailDialogToolbar.children]
    .filter((item) => item !== aggregationDetailOpenAllButton && item !== aggregationDetailCloseAllButton);
  if (host) host.append(...returnToHost, ...aggregationDetailDialogContent.children);
  aggregationDetailDialogToolbar.replaceChildren();
  aggregationDetailDialogContent.replaceChildren();
  delete aggregationDetailDialog.dataset.activeListHost;
  document.querySelectorAll('.aggregation-detail-button').forEach((button) => button.setAttribute('aria-expanded', 'false'));
});

function renderAggregationBars(targetId, rows) {
  const target = document.getElementById(targetId);
  const max = Math.max(0, ...rows.map((row) => row.value));
  target.replaceChildren(...rows.map(({ label, value, note = '' }) => {
    const row = document.createElement('div'); row.className = 'aggregation-bar-row'; row.setAttribute('role', 'listitem');
    const name = document.createElement('span'); name.className = 'aggregation-bar-label'; name.textContent = label;
    const track = document.createElement('span'); track.className = 'aggregation-bar-track';
    const bar = document.createElement('span'); bar.className = 'aggregation-bar-fill';
    bar.style.width = `${max ? Math.max(value > 0 ? 1 : 0, value / max * 100) : 0}%`;
    bar.setAttribute('aria-hidden', 'true'); track.append(bar);
    const count = document.createElement('span'); count.className = 'aggregation-bar-value';
    count.textContent = `${aggregationNumber(value)}件${note ? `（${note}）` : ''}`;
    row.append(name, track, count);
    return row;
  }));
}

function aggregationUniqueById(records) {
  return [...new Map(records.filter((item) => item?.id).map((item) => [item.id, item])).values()];
}

function aggregationDuplicateIdStats(records) {
  const counts = new Map();
  records.forEach((item) => { if (item?.id) counts.set(item.id, (counts.get(item.id) || 0) + 1); });
  const duplicateIds = [...counts.entries()].filter(([, count]) => count > 1);
  return {
    ids: duplicateIds.length,
    extraRecords: duplicateIds.reduce((sum, [, count]) => sum + count - 1, 0),
    groups: duplicateIds.map(([id, count]) => ({ id, count })).sort((a, b) => a.id.localeCompare(b.id, 'ja'))
  };
}

function aggregationDuplicateIdStatsAcrossSources(sources) {
  const counts = new Map();
  sources.forEach((records) => {
    const countsInSource = new Map();
    records.forEach((item) => { if (item?.id) countsInSource.set(item.id, (countsInSource.get(item.id) || 0) + 1); });
    countsInSource.forEach((count, id) => {
      const current = counts.get(id) || { records: 0, sources: 0 };
      current.records += count;
      current.sources += 1;
      counts.set(id, current);
    });
  });
  const duplicateIds = [...counts.entries()]
    .filter(([, { records, sources: sourceCount }]) => records > sourceCount);
  return {
    ids: duplicateIds.length,
    extraRecords: duplicateIds.reduce((sum, [, { records, sources: sourceCount }]) => sum + records - sourceCount, 0),
    groups: duplicateIds.map(([id, { records, sources: sourceCount }]) => ({ id, count: records - sourceCount + 1 }))
      .sort((a, b) => a.id.localeCompare(b.id, 'ja'))
  };
}

function aggregationLabelStats(records) {
  const labelsById = new Map();
  records.forEach((item) => {
    if (!item?.id || !String(item.label || '').trim()) return;
    if (!labelsById.has(item.id)) labelsById.set(item.id, new Set());
    labelsById.get(item.id).add(String(item.label).trim());
  });
  const idsByLabel = new Map();
  labelsById.forEach((labels, id) => labels.forEach((label) => {
    if (!idsByLabel.has(label)) idsByLabel.set(label, new Set());
    idsByLabel.get(label).add(id);
  }));
  const duplicateLabels = [...idsByLabel.values()].filter((ids) => ids.size > 1);
  return {
    duplicateLabels: duplicateLabels.length,
    idsWithDuplicateLabel: duplicateLabels.reduce((sum, ids) => sum + ids.size, 0),
    duplicateGroups: [...idsByLabel.entries()]
      .filter(([, ids]) => ids.size > 1)
      .map(([label, ids]) => ({ label, ids: [...ids].sort((a, b) => a.localeCompare(b, 'ja')) }))
      .sort((a, b) => a.label.localeCompare(b.label, 'ja')),
    idsWithMultipleLabels: [...labelsById.values()].filter((labels) => labels.size > 1).length,
    uniqueLabels: idsByLabel.size,
    unlabeledIds: aggregationUniqueById(records).filter((item) => !String(item.label || '').trim()).length
  };
}

function aggregationIdsWithMultipleLabels(records) {
  const labelsById = new Map();
  records.forEach((item) => {
    const label = String(item?.label || '').trim();
    if (!item?.id || !label) return;
    if (!labelsById.has(item.id)) labelsById.set(item.id, new Set());
    labelsById.get(item.id).add(label);
  });
  return [...labelsById.entries()]
    .filter(([, labels]) => labels.size > 1)
    .map(([id, labels]) => ({ id, labels: [...labels].sort((a, b) => a.localeCompare(b, 'ja')) }))
    .sort((a, b) => a.id.localeCompare(b.id, 'ja'));
}

function aggregationDistribution(values) {
  const sorted = [...values].sort((a, b) => a - b);
  if (!sorted.length) return { average: 0, median: 0, max: 0 };
  const middle = Math.floor(sorted.length / 2);
  const median = sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
  const p90 = sorted[Math.max(0, Math.ceil(sorted.length * 0.9) - 1)];
  return { average: sorted.reduce((sum, value) => sum + value, 0) / sorted.length, median, p90, max: sorted[sorted.length - 1] };
}

function aggregationNormalizedLabelGroups(records) {
  const groups = new Map();
  records.forEach(({ id, label }) => {
    const exact = String(label || '').trim();
    if (!id || !exact) return;
    const normalized = exact.normalize('NFKC').replace(/\s+/g, ' ').trim().toLocaleLowerCase('ja');
    if (!groups.has(normalized)) groups.set(normalized, new Map());
    if (!groups.get(normalized).has(id)) groups.get(normalized).set(id, new Set());
    groups.get(normalized).get(id).add(exact);
  });
  return [...groups.entries()].flatMap(([normalized, ids]) => {
    const exactLabels = new Set([...ids.values()].flatMap((labels) => [...labels]));
    if (ids.size < 2 || exactLabels.size < 2) return [];
    return [{ normalized, ids: [...ids.entries()].map(([id, labels]) => ({ id, labels: [...labels] })) }];
  }).sort((a, b) => a.normalized.localeCompare(b.normalized, 'ja'));
}

function aggregationEditDistanceAtMostOne(leftValue, rightValue) {
  const left = [...leftValue];
  const right = [...rightValue];
  if (Math.abs(left.length - right.length) > 1) return false;
  let leftIndex = 0;
  let rightIndex = 0;
  let edits = 0;
  while (leftIndex < left.length && rightIndex < right.length) {
    if (left[leftIndex] === right[rightIndex]) {
      leftIndex += 1;
      rightIndex += 1;
      continue;
    }
    edits += 1;
    if (edits > 1) return false;
    if (left.length === right.length) {
      leftIndex += 1;
      rightIndex += 1;
    } else if (left.length > right.length) leftIndex += 1;
    else rightIndex += 1;
  }
  if (leftIndex < left.length || rightIndex < right.length) edits += 1;
  return edits <= 1;
}

function aggregationNearLabelGroups(records) {
  const labelsByNormalized = new Map();
  records.forEach(({ id, label }) => {
    const exact = String(label || '').trim();
    if (!id || !exact) return;
    const normalized = exact.normalize('NFKC').replace(/\s+/g, ' ').trim().toLocaleLowerCase('ja');
    if (!labelsByNormalized.has(normalized)) labelsByNormalized.set(normalized, new Map());
    if (!labelsByNormalized.get(normalized).has(id)) labelsByNormalized.get(normalized).set(id, new Set());
    labelsByNormalized.get(normalized).get(id).add(exact);
  });
  const keys = [...labelsByNormalized.keys()].filter((key) => [...key].length >= 5);
  const signatures = new Map();
  keys.forEach((key) => {
    const characters = [...key];
    new Set([key, ...characters.map((_, index) => characters.filter((character, i) => i !== index).join(''))]).forEach((signature) => {
      if (!signatures.has(signature)) signatures.set(signature, []);
      signatures.get(signature).push(key);
    });
  });
  const candidatePairs = new Set();
  signatures.forEach((matches) => {
    for (let leftIndex = 0; leftIndex < matches.length; leftIndex += 1) {
      for (let rightIndex = leftIndex + 1; rightIndex < matches.length; rightIndex += 1) {
        const left = matches[leftIndex];
        const right = matches[rightIndex];
        if (left === right || !aggregationEditDistanceAtMostOne(left, right)) continue;
        candidatePairs.add(left < right ? `${left}\u0000${right}` : `${right}\u0000${left}`);
      }
    }
  });
  return [...candidatePairs].flatMap((pair) => {
    const [left, right] = pair.split('\u0000');
    const leftIds = labelsByNormalized.get(left);
    const rightIds = labelsByNormalized.get(right);
    const allIds = new Set([...leftIds.keys(), ...rightIds.keys()]);
    if (allIds.size < 2) return [];
    const leftLabel = [...leftIds.values()][0].values().next().value || left;
    const rightLabel = [...rightIds.values()][0].values().next().value || right;
    const entries = [
      ...[...leftIds.entries()].flatMap(([id, labels]) => [...labels].map((variantLabel) => ({ id, type: 'インスタンス', variantLabel }))),
      ...[...rightIds.entries()].flatMap(([id, labels]) => [...labels].map((variantLabel) => ({ id, type: 'インスタンス', variantLabel })))
    ];
    return [{ title: `${leftLabel} ↔ ${rightLabel}`, entries }];
  }).sort((a, b) => b.entries.length - a.entries.length || a.title.localeCompare(b.title, 'ja'));
}

function aggregationCountBuckets(values, exactLimit = 5) {
  const buckets = Array.from({ length: exactLimit + 1 }, (_, count) => ({ label: String(count), value: 0 }));
  values.forEach((count) => { buckets[Math.min(count, exactLimit)].value += 1; });
  if (buckets.length) buckets[buckets.length - 1].label = `${exactLimit}+`;
  return buckets;
}

function aggregationFindCycles(ids, parents) {
  let nextIndex = 0;
  const indexes = new Map();
  const lowLinks = new Map();
  const stack = [];
  const onStack = new Set();
  const cycles = [];
  const visit = (id) => {
    indexes.set(id, nextIndex);
    lowLinks.set(id, nextIndex);
    nextIndex += 1;
    stack.push(id);
    onStack.add(id);
    (parents.get(id) || []).forEach((parent) => {
      if (!indexes.has(parent)) {
        visit(parent);
        lowLinks.set(id, Math.min(lowLinks.get(id), lowLinks.get(parent)));
      } else if (onStack.has(parent)) {
        lowLinks.set(id, Math.min(lowLinks.get(id), indexes.get(parent)));
      }
    });
    if (lowLinks.get(id) !== indexes.get(id)) return;
    const component = [];
    let current;
    do {
      current = stack.pop();
      onStack.delete(current);
      component.push(current);
    } while (current !== id);
    if (component.length > 1 || (parents.get(id) || new Set()).has(id)) cycles.push(component);
  };
  ids.forEach((id) => { if (!indexes.has(id)) visit(id); });
  return cycles;
}

function renderAggregationDetailLists(targetId, sections, classContextForId) {
  const target = document.getElementById(targetId);
  target.replaceChildren(...sections.filter((section) => section.groups.length).map((section) => {
    const details = document.createElement('div');
    details.id = `aggregation-detail-${section.key}`;
    details.className = 'aggregation-group-details';
    details.dataset.title = section.title;
    details.dataset.entryCount = aggregationNumber(section.groups.reduce((sum, group) => sum + group.entries.length, 0));
    const save = document.createElement('button');
    save.type = 'button';
    save.className = 'aggregation-export-button';
    save.textContent = 'TSV保存';
    save.setAttribute('aria-label', `${section.title}の一覧をTSVで保存`);
    save.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      const rows = [['項目', 'ラベル', '種別', 'ID', '上位クラス', '中間クラス', '補足']];
      section.groups.forEach(({ title, entries }) => entries.forEach(({ id, type = '', note = '', variantLabel = '' }) => {
        const context = type !== 'インスタンス' && type !== '未登録' ? classContextForId(id) : { upperLabels: [], middleLabels: [] };
        rows.push([section.title, title, type, id, context.upperLabels.join(' ／ '), context.middleLabels.join(' ／ '), variantLabel ? `実際の表記: ${variantLabel}` : note]);
      }));
      const tsv = rows.map((row) => row.map((cell) => `"${String(cell).replaceAll('"', '""')}"`).join('\t')).join('\r\n');
      const blob = new Blob([`\ufeff${tsv}\r\n`], { type: 'text/tab-separated-values;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `aggregation-${section.key}.tsv`;
      link.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    });
    const search = document.createElement('input');
    search.type = 'search';
    search.className = 'aggregation-detail-search';
    search.placeholder = 'この一覧を検索（ラベル・ID）';
    search.setAttribute('aria-label', `${section.title}を検索`);
    const groups = document.createElement('div'); groups.className = 'aggregation-group-list';
    const orderedGroups = [...section.groups].sort((a, b) => b.entries.length - a.entries.length
      || a.title.localeCompare(b.title, 'ja'));
    orderedGroups.forEach(({ title, entries }) => {
      const group = document.createElement('details'); group.className = 'aggregation-duplicate-group';
      const summary = document.createElement('summary'); summary.className = 'aggregation-duplicate-summary';
      const heading = document.createElement('span'); heading.className = 'aggregation-duplicate-title'; heading.textContent = title;
      const count = document.createElement('span'); count.className = 'aggregation-duplicate-count';
      count.textContent = `（${aggregationNumber(entries.length)}件）`;
      summary.append(heading, count);
      const list = document.createElement('ul'); list.className = 'aggregation-duplicate-ids';
      let previousVariantLabel = '';
      entries.forEach(({ id, type = '', note = '', variantLabel = '' }) => {
        if (variantLabel && variantLabel !== previousVariantLabel) {
          const variantHeading = document.createElement('li');
          variantHeading.className = 'aggregation-label-variant-heading';
          variantHeading.textContent = variantLabel;
          list.append(variantHeading);
          previousVariantLabel = variantLabel;
        }
        const row = document.createElement('li');
        if (type) {
          const kind = document.createElement('span'); kind.className = 'aggregation-id-kind'; kind.textContent = type;
          kind.dataset.entityType = type;
          row.append(kind);
        }
        const value = document.createElement('code'); value.textContent = id; row.append(value);
        if (note) {
          const annotation = document.createElement('small'); annotation.className = 'aggregation-id-note';
          annotation.textContent = note; row.append(annotation);
        }
        const copy = document.createElement('button');
        copy.type = 'button'; copy.className = 'copy-id-button aggregation-copy-id'; copy.textContent = 'コピー';
        copy.setAttribute('aria-label', `ID ${id} をコピー`);
        copy.addEventListener('click', async () => {
          try {
            if (navigator.clipboard?.writeText) await navigator.clipboard.writeText(id);
            else {
              const input = document.createElement('textarea');
              input.value = id; input.style.position = 'fixed'; input.style.opacity = '0';
              document.body.append(input); input.select();
              const copied = document.execCommand('copy'); input.remove();
              if (!copied) throw new Error('Clipboard copy failed');
            }
            copy.textContent = 'コピー済み';
            window.setTimeout(() => { copy.textContent = 'コピー'; }, 1200);
          } catch {
            copy.textContent = '失敗';
          }
        });
        row.append(copy); list.append(row);
      });
      group.append(summary, list); groups.append(group);
    });
    const noResults = document.createElement('p');
    noResults.className = 'aggregation-detail-no-results';
    noResults.textContent = '一致する項目がありません。';
    noResults.hidden = true;
    search.addEventListener('input', () => {
      const query = search.value.trim().toLocaleLowerCase('ja');
      let visible = 0;
      groups.querySelectorAll('.aggregation-duplicate-group').forEach((group) => {
        const matches = !query || group.textContent.toLocaleLowerCase('ja').includes(query);
        group.hidden = !matches;
        if (matches) visible += 1;
      });
      noResults.hidden = visible > 0;
    });
    details.append(save, search, noResults, groups);
    return details;
  }));
}

function renderAggregation(data) {
  const panel = document.getElementById('aggregation-panel');
  if (!panel) return;
  const rawClasses = [...(data.classData?.classes || []), ...(data.targetClassData?.classes || [])];
  const rawInstances = data.instanceData?.instances || [];
  const missingClassIds = rawClasses.filter((item) => !item?.id).length;
  const missingInstanceIds = rawInstances.filter((item) => !item?.id).length;
  const classes = aggregationUniqueById(rawClasses);
  const instances = aggregationUniqueById(rawInstances);
  const classIds = new Set(classes.map((item) => item.id));
  const instanceIds = new Set(instances.map((item) => item.id));
  const classById = new Map(classes.map((item) => [item.id, item]));
  const rawClassRelations = data.classData?.relations || [];
  const parents = new Map(classes.map(({ id }) => [id, new Set()]));
  const children = new Map(classes.map(({ id }) => [id, new Set()]));
  const classEdges = new Set();
  let danglingClassRelations = 0;
  let selfRelations = 0;
  rawClassRelations.forEach(({ child, parent }) => {
    if (!classIds.has(child) || !classIds.has(parent)) {
      danglingClassRelations += 1;
      return;
    }
    if (child === parent) selfRelations += 1;
    const edge = JSON.stringify([child, parent]);
    if (classEdges.has(edge)) return;
    classEdges.add(edge);
    parents.get(child).add(parent);
    children.get(parent).add(child);
  });
  const classContextForId = (id) => {
    const lineage = new Set([id]);
    const pending = [...(parents.get(id) || [])];
    while (pending.length) {
      const current = pending.pop();
      if (lineage.has(current)) continue;
      lineage.add(current);
      pending.push(...(parents.get(current) || []));
    }
    const labelsFor = (pattern) => [...lineage].filter((classId) => pattern.test(classId))
      .sort((a, b) => (classById.get(a)?.label || a).localeCompare(classById.get(b)?.label || b, 'ja'))
      .map((classId) => classById.get(classId)?.label || classId);
    return { upperLabels: labelsFor(/\/t_/), middleLabels: labelsFor(/\/m_/) };
  };
  const classesWithoutTop = classes.filter(({ id }) => classContextForId(id).upperLabels.length === 0);
  const visitedComponents = new Set();
  let connectedComponentCount = 0;
  classes.forEach(({ id }) => {
    if (visitedComponents.has(id)) return;
    connectedComponentCount += 1;
    const pending = [id];
    visitedComponents.add(id);
    while (pending.length) {
      const current = pending.pop();
      [...(parents.get(current) || []), ...(children.get(current) || [])].forEach((neighbor) => {
        if (visitedComponents.has(neighbor)) return;
        visitedComponents.add(neighbor);
        pending.push(neighbor);
      });
    }
  });
  const isolatedClasses = classes.filter(({ id }) => parents.get(id).size === 0 && children.get(id).size === 0).length;
  const cycleGroups = aggregationFindCycles(classIds, parents);
  const cycleClassIds = new Set(cycleGroups.flat());
  const cycleGroupById = new Map();
  cycleGroups.forEach((group, index) => group.forEach((id) => cycleGroupById.set(id, index)));
  const depthMemo = new Map();
  const classDepth = (id, active = new Set()) => {
    if (depthMemo.has(id)) return depthMemo.get(id);
    if (active.has(id)) return 0;
    const nextActive = new Set(active).add(id);
    let depth = 1;
    (parents.get(id) || []).forEach((parent) => {
      const sameCycle = cycleGroupById.has(id) && cycleGroupById.get(id) === cycleGroupById.get(parent);
      if (!sameCycle) depth = Math.max(depth, classDepth(parent, nextActive) + 1);
    });
    depthMemo.set(id, depth);
    return depth;
  };
  const topClasses = classes.filter(({ id }) => /\/t_/.test(id));
  const middleClasses = classes.filter(({ id }) => /\/m_/.test(id));
  const targetClasses = classes.filter(({ id }) => /\/c_/.test(id));
  const targetDepths = targetClasses.map(({ id }) => classDepth(id));
  const maxTargetDepth = Math.max(0, ...targetDepths);
  const roots = classes.filter(({ id }) => parents.get(id).size === 0).length;
  const leaves = classes.filter(({ id }) => children.get(id).size === 0).length;
  const multipleParents = classes.filter(({ id }) => parents.get(id).size > 1).length;
  const maxChildren = Math.max(0, ...classes.map(({ id }) => children.get(id).size));
  const maxChildrenClass = classes.find(({ id }) => children.get(id).size === maxChildren && maxChildren > 0);
  const topWithMiddle = topClasses.filter(({ id }) => [...children.get(id)].some((child) => /\/m_/.test(child))).length;
  const middleWithTarget = middleClasses.filter(({ id }) => [...children.get(id)].some((child) => /\/c_/.test(child))).length;
  const countTargetDescendants = (id) => {
    const visited = new Set([id]);
    const pending = [...(children.get(id) || [])];
    let count = 0;
    while (pending.length) {
      const child = pending.pop();
      if (visited.has(child)) continue;
      visited.add(child);
      if (/\/c_/.test(child)) count += 1;
      pending.push(...(children.get(child) || []));
    }
    return count;
  };
  const middleTargetCounts = middleClasses.map((middle) => ({ class: middle, count: countTargetDescendants(middle.id) }))
    .sort((a, b) => b.count - a.count || (a.class.label || a.class.id).localeCompare(b.class.label || b.class.id, 'ja'));
  const minMiddleTargetCount = middleTargetCounts.length ? middleTargetCounts[middleTargetCounts.length - 1].count : 0;
  const middleWithFewestTargets = middleTargetCounts.filter(({ count }) => count === minMiddleTargetCount);

  const rawMemberships = data.instanceClassData?.relations || [];
  const classInstances = new Map(classes.map(({ id }) => [id, new Set()]));
  const instanceClasses = new Map(instances.map(({ id }) => [id, new Set()]));
  const membershipEdges = new Set();
  let danglingMemberships = 0;
  rawMemberships.forEach(({ instance, class: classId }) => {
    if (!instanceIds.has(instance) || !classIds.has(classId)) {
      danglingMemberships += 1;
      return;
    }
    const edge = JSON.stringify([instance, classId]);
    if (membershipEdges.has(edge)) return;
    membershipEdges.add(edge);
    classInstances.get(classId).add(instance);
    instanceClasses.get(instance).add(classId);
  });
  const classInstanceCounts = [...classInstances.values()].map((set) => set.size);
  const instancesIncludingDescendants = new Map(classes.map(({ id }) => [id, new Set(classInstances.get(id))]));
  classInstances.forEach((instancesForClass, classId) => {
    const pending = [...(parents.get(classId) || [])];
    const visited = new Set();
    while (pending.length) {
      const ancestor = pending.pop();
      if (visited.has(ancestor)) continue;
      visited.add(ancestor);
      instancesForClass.forEach((instanceId) => instancesIncludingDescendants.get(ancestor).add(instanceId));
      pending.push(...(parents.get(ancestor) || []));
    }
  });
  const subtreeInstanceCounts = [...instancesIncludingDescendants.values()].map((set) => set.size);
  const instanceClassCounts = [...instanceClasses.values()].map((set) => set.size);
  const classInstanceDistribution = aggregationDistribution(classInstanceCounts);
  const subtreeInstanceDistribution = aggregationDistribution(subtreeInstanceCounts);
  const instanceClassDistribution = aggregationDistribution(instanceClassCounts);
  const instancesWithoutClass = instanceClassCounts.filter((count) => count === 0).length;
  const instancesWithoutTop = instances.filter(({ id }) => {
    const assigned = [...(instanceClasses.get(id) || [])];
    return assigned.length > 0 && assigned.every((classId) => classContextForId(classId).upperLabels.length === 0);
  }).length;
  const targetWithInstances = targetClasses.filter(({ id }) => (classInstances.get(id)?.size || 0) > 0).length;
  const instanceLabelsById = new Map(instances.map(({ id, label }) => [id, String(label || '').trim()]));
  const idsByInstanceLabel = new Map();
  instanceLabelsById.forEach((label, id) => {
    if (!label) return;
    if (!idsByInstanceLabel.has(label)) idsByInstanceLabel.set(label, new Set());
    idsByInstanceLabel.get(label).add(id);
  });
  const directLabelsByClass = new Map(classes.map(({ id }) => [id, new Set()]));
  classInstances.forEach((instanceIdsForClass, classId) => instanceIdsForClass.forEach((instanceId) => {
    const label = instanceLabelsById.get(instanceId);
    if (label) directLabelsByClass.get(classId).add(label);
  }));
  const subtreeLabelsByClass = new Map(classes.map(({ id }) => [id, new Set()]));
  instancesIncludingDescendants.forEach((instanceIdsForClass, classId) => instanceIdsForClass.forEach((instanceId) => {
    const label = instanceLabelsById.get(instanceId);
    if (label) subtreeLabelsByClass.get(classId).add(label);
  }));
  const classesByInstanceLabel = new Map([...idsByInstanceLabel.keys()].map((label) => [label, new Set()]));
  idsByInstanceLabel.forEach((instanceIdsForLabel, label) => instanceIdsForLabel.forEach((instanceId) => {
    (instanceClasses.get(instanceId) || []).forEach((classId) => classesByInstanceLabel.get(label).add(classId));
  }));
  const directLabelCounts = [...directLabelsByClass.values()].map((labels) => labels.size);
  const subtreeLabelCounts = [...subtreeLabelsByClass.values()].map((labels) => labels.size);
  const labelClassCounts = [...classesByInstanceLabel.values()].map((classIdsForLabel) => classIdsForLabel.size);
  const directLabelDistribution = aggregationDistribution(directLabelCounts);
  const subtreeLabelDistribution = aggregationDistribution(subtreeLabelCounts);
  const labelClassDistribution = aggregationDistribution(labelClassCounts);
  const labelsWithoutClass = [...classesByInstanceLabel.values()].filter((classIdsForLabel) => classIdsForLabel.size === 0).length;
  const labelsWithoutTop = [...classesByInstanceLabel.values()].filter((classIdsForLabel) => classIdsForLabel.size > 0
    && [...classIdsForLabel].every((classId) => classContextForId(classId).upperLabels.length === 0)).length;
  const labelsInMultipleClasses = labelClassCounts.filter((count) => count > 1).length;
  const targetWithLabels = targetClasses.filter(({ id }) => directLabelsByClass.get(id).size > 0).length;
  const maxDirectLabelCount = Math.max(0, ...directLabelCounts);
  const maxDirectLabelClass = classes.find(({ id }) => directLabelsByClass.get(id).size === maxDirectLabelCount && maxDirectLabelCount > 0);
  const classDuplicates = aggregationDuplicateIdStatsAcrossSources([
    data.classData?.classes || [],
    data.targetClassData?.classes || []
  ]);
  const instanceDuplicates = aggregationDuplicateIdStats(rawInstances);
  const classLabels = aggregationLabelStats(rawClasses);
  const instanceLabels = aggregationLabelStats(rawInstances);
  const classNormalizedLabelGroups = aggregationNormalizedLabelGroups(classes);
  const instanceNormalizedLabelGroups = aggregationNormalizedLabelGroups(instances);
  const nearInstanceLabelGroups = aggregationNearLabelGroups(rawInstances);
  const nearInstanceLabelEntryCount = nearInstanceLabelGroups.reduce((sum, group) => sum + group.entries.length, 0);
  const classMultiLabelIds = aggregationIdsWithMultipleLabels(rawClasses);
  const instanceMultiLabelIds = aggregationIdsWithMultipleLabels(rawInstances);
  const unlabeledClasses = classes.filter((item) => !String(item.label || '').trim());
  const unlabeledInstances = instances.filter((item) => !String(item.label || '').trim());
  const classLabelSet = new Set(classes.map(({ label }) => String(label || '').trim()).filter(Boolean));
  const instanceLabelSet = new Set(instances.map(({ label }) => String(label || '').trim()).filter(Boolean));
  const sharedLabels = [...classLabelSet].filter((label) => instanceLabelSet.has(label)).length;
  const classDuplicateLabelGroupsByLevel = classLabels.duplicateGroups.reduce((counts, group) => {
    const levels = new Set(group.ids.map(aggregationClassLevel));
    const key = levels.size > 1 ? 'crossLevel' : 'sameLevel';
    counts[key] += 1;
    return counts;
  }, { sameLevel: 0, crossLevel: 0 });
  const crossTypeIdCollisions = [...classIds].filter((id) => instanceIds.has(id));
  const classDuplicateGroupsByKind = (kind) => classLabels.duplicateGroups.filter(({ ids }) => {
    const levels = new Set(ids.map(aggregationClassLevel));
    return (levels.size > 1 ? 'crossLevel' : 'sameLevel') === kind;
  });
  const classIdsByLabel = new Map();
  const instanceIdsByLabel = new Map();
  classes.forEach(({ id, label }) => {
    const normalizedLabel = String(label || '').trim();
    if (normalizedLabel && instanceLabelSet.has(normalizedLabel)) {
      if (!classIdsByLabel.has(normalizedLabel)) classIdsByLabel.set(normalizedLabel, []);
      classIdsByLabel.get(normalizedLabel).push(id);
    }
  });
  instances.forEach(({ id, label }) => {
    const normalizedLabel = String(label || '').trim();
    if (normalizedLabel && classLabelSet.has(normalizedLabel)) {
      if (!instanceIdsByLabel.has(normalizedLabel)) instanceIdsByLabel.set(normalizedLabel, []);
      instanceIdsByLabel.get(normalizedLabel).push(id);
    }
  });
  const hierarchyDuplicateRows = rawClassRelations.length - classEdges.size - danglingClassRelations;
  const membershipDuplicateRows = rawMemberships.length - membershipEdges.size - danglingMemberships;
  const duplicateHierarchyGroups = new Map();
  const danglingHierarchyRows = [];
  const selfRelationRows = [];
  rawClassRelations.forEach((relation) => {
    const { child, parent } = relation;
    if (!classIds.has(child) || !classIds.has(parent)) {
      danglingHierarchyRows.push(relation);
      return;
    }
    const key = JSON.stringify([child, parent]);
    duplicateHierarchyGroups.set(key, { child, parent, count: (duplicateHierarchyGroups.get(key)?.count || 0) + 1 });
    if (child === parent) selfRelationRows.push(relation);
  });
  const duplicateMembershipGroups = new Map();
  const danglingMembershipRows = [];
  rawMemberships.forEach((relation) => {
    const { instance, class: classId } = relation;
    if (!instanceIds.has(instance) || !classIds.has(classId)) {
      danglingMembershipRows.push(relation);
      return;
    }
    const key = JSON.stringify([instance, classId]);
    duplicateMembershipGroups.set(key, { instance, classId, count: (duplicateMembershipGroups.get(key)?.count || 0) + 1 });
  });
  const summaryCards = [
    ['クラス数', classes.length, '上位・中間・対象クラスの合計'],
    ['クラスラベル数', classLabels.uniqueLabels, '空欄を除き、同じ表記を1件として集計'],
    ['インスタンスID数', instances.length, '重複を除いたID数'],
    ['インスタンスラベル数', instanceLabels.uniqueLabels, '空欄を除き、同じ表記を1件として集計']
  ];
  const renderCards = (targetId, cards, { compact = false } = {}) => {
    const target = document.getElementById(targetId);
    target.classList.toggle('aggregation-metrics-compact', compact);
    target.replaceChildren(...cards.map(([label, value, note, warning = false, detailKey = '']) => {
      const card = document.createElement('article');
      card.className = `aggregation-card${warning && value > 0 ? ' is-warning' : ''}`;
      if (targetId === 'aggregation-integrity' || targetId === 'aggregation-label-id') {
        card.dataset.metricValue = String(Number(value) || 0);
        card.hidden = (targetId === 'aggregation-integrity' ? aggregationHideZeroIntegrity : aggregationHideZeroLabelId) && Number(value) === 0;
      }
      const title = document.createElement('span'); title.className = 'aggregation-card-label'; title.textContent = label;
      const number = document.createElement('strong'); number.className = 'aggregation-card-value';
      if (typeof value !== 'number') number.classList.add('aggregation-card-value-text');
      number.textContent = typeof value === 'number' ? aggregationNumber(value) : String(value);
      const detail = document.createElement('small'); detail.className = 'aggregation-card-note'; detail.textContent = note;
      card.append(title, number, detail);
      if (detailKey) {
        const openDetails = document.createElement('button');
        openDetails.type = 'button';
        openDetails.className = 'aggregation-detail-button';
        openDetails.textContent = '詳細を見る';
        openDetails.setAttribute('aria-controls', 'aggregation-detail-dialog');
        openDetails.setAttribute('aria-haspopup', 'dialog');
        openDetails.setAttribute('aria-expanded', 'false');
        openDetails.disabled = value === 0;
        openDetails.addEventListener('click', () => {
          const details = document.getElementById(`aggregation-detail-${detailKey}`);
          if (!details || !aggregationDetailDialog || !aggregationDetailDialogContent) return;
          const search = details.querySelector('.aggregation-detail-search');
          const save = details.querySelector('.aggregation-export-button');
          const noResults = details.querySelector('.aggregation-detail-no-results');
          const groups = details.querySelector('.aggregation-group-list');
          const title = details.dataset.title || '詳細';
          document.getElementById('aggregation-detail-dialog-title').textContent = `${title}（${details.dataset.entryCount || '0'}件）`;
          aggregationDetailDialog.dataset.activeListHost = details.id;
          aggregationDetailDialogToolbar.replaceChildren(search, aggregationDetailOpenAllButton, aggregationDetailCloseAllButton, save);
          aggregationDetailDialogContent.replaceChildren(noResults, groups);
          search.value = '';
          search.dispatchEvent(new Event('input'));
          groups.querySelectorAll('.aggregation-duplicate-group').forEach((group) => { group.open = true; });
          aggregationDetailDialog.showModal();
          openDetails.setAttribute('aria-expanded', 'true');
          search.focus({ preventScroll: true });
        });
        card.append(openDetails);
      }
      return card;
    }));
  };
  renderCards('aggregation-summary', summaryCards);
  renderCards('aggregation-structure', [
    ['上位クラス数', topClasses.length, `全クラスの${aggregationPercent(topClasses.length, classes.length)}`],
    ['中間クラス数', middleClasses.length, `全クラスの${aggregationPercent(middleClasses.length, classes.length)}`],
    ['対象クラス数', targetClasses.length, `全クラスの${aggregationPercent(targetClasses.length, classes.length)}。`],
    ['対象クラスの最深階層', maxTargetDepth, cycleClassIds.size ? '親クラスを含む経路上のクラス数。循環関係を除外' : '親クラスから対象クラスまでのクラス数']
  ]);
  renderCards('aggregation-structure-secondary', [
    ['中間クラスを持つ上位クラス', topWithMiddle, `${aggregationPercent(topWithMiddle, topClasses.length)} の上位クラス`],
    ['中間クラスがない上位クラス', topClasses.length - topWithMiddle, '直接の中間クラスがない'],
    ['対象クラスを持つ中間クラス', middleWithTarget, `${aggregationPercent(middleWithTarget, middleClasses.length)} の中間クラス`],
    ['対象クラスがない中間クラス', middleClasses.length - middleWithTarget, '直接の対象クラスがない'],
    ['上位クラスにつながらないクラス', classesWithoutTop.length, '上位クラスまで親をたどれない'],
    ['親子関係から孤立したクラス', isolatedClasses, '親も子も持たない'],
    ['複数の親を持つクラス', multipleParents, '親クラスIDが2つ以上'],
    ['対象クラスが最多の中間クラス', middleTargetCounts[0]?.class.label || middleTargetCounts[0]?.class.id || '該当なし', middleTargetCounts.length ? `配下に${aggregationNumber(middleTargetCounts[0].count)}件の対象クラス` : '中間クラスなし'],
    ['対象クラスが最少の中間クラス', middleWithFewestTargets.length ? middleWithFewestTargets.map(({ class: item }) => item.label || item.id).join('・') : '該当なし', middleWithFewestTargets.length ? `各配下に${aggregationNumber(minMiddleTargetCount)}件（${aggregationNumber(middleWithFewestTargets.length)}クラス）` : '中間クラスなし'],
    ['直接の子クラスが最多のクラス', maxChildrenClass?.label || maxChildrenClass?.id || '該当なし', maxChildrenClass ? `${aggregationNumber(maxChildren)}件の直接の子クラス` : '子クラスなし']
  ]);
  const targetCountsByTopClass = topClasses.map((topClass) => ({
    label: topClass.label || topClass.id,
    value: countTargetDescendants(topClass.id)
  })).sort((a, b) => b.value - a.value || a.label.localeCompare(b.label, 'ja'));
  renderAggregationBars('aggregation-hierarchy-coverage-chart', targetCountsByTopClass);
  const targetCountsByDepth = new Map(Array.from({ length: maxTargetDepth }, (_, index) => [index + 1, 0]));
  targetDepths.forEach((depth) => targetCountsByDepth.set(depth, (targetCountsByDepth.get(depth) || 0) + 1));
  renderAggregationBars('aggregation-depth-chart', [...targetCountsByDepth.entries()]
    .sort(([a], [b]) => a - b).map(([depth, count]) => ({ label: `${depth}階層`, value: count })));
  const labelIdCards = [
    ['同一階層内の重複ラベル', classDuplicateLabelGroupsByLevel.sameLevel, '同じ階層の異なるクラスIDで一致', true, 'duplicate-class-labels-same'],
    ['階層をまたぐ重複ラベル', classDuplicateLabelGroupsByLevel.crossLevel, '上位・中間・対象をまたいで一致', true, 'duplicate-class-labels-cross'],
    ['複数ラベルを持つクラスID', classMultiLabelIds.length, '同一IDに異なるラベルがある', true, 'multiple-class-labels'],
    ['同じラベルを持つインスタンスID群', instanceLabels.duplicateLabels, `${aggregationNumber(instanceLabels.idsWithDuplicateLabel)} IDが該当`, true, 'duplicate-instance-labels'],
    ['複数ラベルを持つインスタンスID', instanceMultiLabelIds.length, '同一IDに異なるラベルがある', true, 'multiple-instance-labels'],
    ['表記揺れの可能性があるクラスラベル', classNormalizedLabelGroups.length, '空白・全半角・大文字小文字を正規化して一致', true, 'normalized-class-labels'],
    ['表記揺れの可能性があるインスタンスラベル', instanceNormalizedLabelGroups.length, '空白・全半角・大文字小文字を正規化して一致', true, 'normalized-instance-labels'],
    ['表記が近いインスタンスラベル（要確認）', nearInstanceLabelEntryCount, `${aggregationNumber(nearInstanceLabelGroups.length)}組の候補。5文字以上で1文字だけ異なる`, true, 'near-instance-labels'],
    ['クラスとインスタンスで共有するラベル', sharedLabels, '完全一致するラベル文字列', false, 'shared-labels'],
    ['クラスIDとインスタンスIDで重複するID', crossTypeIdCollisions.length, '別種類のデータ間でID文字列が一致', true, 'cross-type-id-collisions'],
    ['ラベルなしのクラスID', unlabeledClasses.length, '空欄または未設定', true, 'unlabeled-classes'],
    ['ラベルなしのインスタンスID', unlabeledInstances.length, '空欄または未設定', true, 'unlabeled-instances'],
    ['クラスの重複ID', classDuplicates.ids, `${aggregationNumber(classDuplicates.extraRecords)}件の余分なレコード`, true, 'duplicate-class-ids'],
    ['インスタンスの重複ID', instanceDuplicates.ids, `${aggregationNumber(instanceDuplicates.extraRecords)}件の余分なレコード`, true, 'duplicate-instance-ids']
  ];
  renderCards('aggregation-label-id', labelIdCards.sort((a, b) => Number(b[1]) - Number(a[1])));
  const labelIdCardsRendered = [...document.querySelectorAll('#aggregation-label-id .aggregation-card')];
  const visibleLabelIdIssues = labelIdCardsRendered.some((card) => Number(card.dataset.metricValue) > 0);
  const labelIdToggle = document.getElementById('aggregation-toggle-zero-label-id');
  labelIdToggle.setAttribute('aria-pressed', String(aggregationHideZeroLabelId));
  labelIdToggle.textContent = aggregationHideZeroLabelId ? '0件も表示' : '0件を隠す';
  document.getElementById('aggregation-zero-label-id-note').hidden = !aggregationHideZeroLabelId || visibleLabelIdIssues;
  const idEntries = (items, type, noteFor = () => '') => items.map((item) => ({ id: item.id, type: type === 'クラス' ? aggregationClassLevel(item.id) : type, note: noteFor(item) }));
  const classDuplicateDetails = (kind) => classDuplicateGroupsByKind(kind).map(({ label, ids }) => ({
    title: label,
    entries: ids.map((id) => ({ id, type: aggregationClassLevel(id) }))
  }));
  const labelDetailSections = [
    { key: 'duplicate-class-labels-same', title: '同一階層内の重複ラベル', groups: classDuplicateDetails('sameLevel') },
    { key: 'duplicate-class-labels-cross', title: '階層をまたぐ重複ラベル', groups: classDuplicateDetails('crossLevel') },
    { key: 'multiple-class-labels', title: '複数ラベルを持つクラスID', groups: classMultiLabelIds.map(({ id, labels }) => ({ title: labels.join(' ／ '), entries: [{ id, type: aggregationClassLevel(id) }] })) },
    { key: 'duplicate-instance-labels', title: '同じラベルを持つインスタンスID群', groups: instanceLabels.duplicateGroups.map(({ label, ids }) => ({ title: label, entries: ids.map((id) => ({ id, type: 'インスタンス' })) })) },
    { key: 'multiple-instance-labels', title: '複数ラベルを持つインスタンスID', groups: instanceMultiLabelIds.map(({ id, labels }) => ({ title: labels.join(' ／ '), entries: [{ id, type: 'インスタンス' }] })) },
    { key: 'normalized-class-labels', title: '表記揺れの可能性があるクラスラベル', groups: classNormalizedLabelGroups.map(({ normalized, ids }) => ({ title: normalized, entries: ids.map(({ id, labels }) => ({ id, type: aggregationClassLevel(id), note: `元のラベル: ${labels.join(' ／ ')}` })) })) },
    { key: 'normalized-instance-labels', title: '表記揺れの可能性があるインスタンスラベル', groups: instanceNormalizedLabelGroups.map(({ normalized, ids }) => {
      const idsByExactLabel = new Map();
      ids.forEach(({ id, labels }) => labels.forEach((label) => {
        if (!idsByExactLabel.has(label)) idsByExactLabel.set(label, new Set());
        idsByExactLabel.get(label).add(id);
      }));
      const entries = [...idsByExactLabel.entries()]
        .sort(([a], [b]) => a.localeCompare(b, 'ja'))
        .flatMap(([variantLabel, variantIds]) => [...variantIds].sort((a, b) => a.localeCompare(b, 'ja'))
          .map((id) => ({ id, type: 'インスタンス', variantLabel })));
      return { title: `表記グループ：${normalized}`, entries };
    }) },
    { key: 'near-instance-labels', title: '表記が近いインスタンスラベル（要確認）', groups: nearInstanceLabelGroups },
    { key: 'shared-labels', title: 'クラスとインスタンスで共有するラベル', groups: [...classIdsByLabel.keys()].sort((a, b) => a.localeCompare(b, 'ja')).map((label) => ({
      title: label,
      entries: [
        ...(classIdsByLabel.get(label) || []).map((id) => ({ id, type: aggregationClassLevel(id) })),
        ...(instanceIdsByLabel.get(label) || []).map((id) => ({ id, type: 'インスタンス' }))
      ]
    })) },
    { key: 'cross-type-id-collisions', title: 'クラスIDとインスタンスIDで重複するID', groups: crossTypeIdCollisions.map((id) => ({ title: id, entries: [{ id, type: aggregationClassLevel(id), note: 'クラスID' }, { id, type: 'インスタンス', note: 'インスタンスID' }] })) },
    { key: 'unlabeled-classes', title: 'ラベルなしのクラスID', groups: unlabeledClasses.length ? [{ title: 'ラベルなし', entries: idEntries(unlabeledClasses, 'クラス') }] : [] },
    { key: 'unlabeled-instances', title: 'ラベルなしのインスタンスID', groups: unlabeledInstances.length ? [{ title: 'ラベルなし', entries: idEntries(unlabeledInstances, 'インスタンス') }] : [] },
    { key: 'duplicate-class-ids', title: 'クラスの重複ID', groups: classDuplicates.groups.map(({ id, count }) => ({ title: `${aggregationNumber(count)}レコード`, entries: [{ id, type: aggregationClassLevel(id) }] })) },
    { key: 'duplicate-instance-ids', title: 'インスタンスの重複ID', groups: instanceDuplicates.groups.map(({ id, count }) => ({ title: `${aggregationNumber(count)}レコード`, entries: [{ id, type: 'インスタンス' }] })) }
  ];
  renderAggregationDetailLists('aggregation-label-id-details', labelDetailSections, classContextForId);
  renderCards('aggregation-membership-primary', [
    ['1クラスあたりの直接所属ID数', classInstanceDistribution.average.toFixed(1), `中央値 ${aggregationNumber(classInstanceDistribution.median)} ／ 90%点 ${aggregationNumber(classInstanceDistribution.p90)} ／ 最多 ${aggregationNumber(classInstanceDistribution.max)}`],
    ['1クラスあたりの配下込みID数', subtreeInstanceDistribution.average.toFixed(1), `中央値 ${aggregationNumber(subtreeInstanceDistribution.median)} ／ 90%点 ${aggregationNumber(subtreeInstanceDistribution.p90)} ／ 最多 ${aggregationNumber(subtreeInstanceDistribution.max)}`],
    ['所属IDがある対象クラス', targetWithInstances, `${aggregationPercent(targetWithInstances, targetClasses.length)} の対象クラス`]
  ]);
  renderCards('aggregation-membership-secondary', [
    ['所属IDがないクラス', classInstanceCounts.filter((count) => count === 0).length, '直接所属するインスタンスが0件'],
    ['配下を含めても所属IDがないクラス', subtreeInstanceCounts.filter((count) => count === 0).length, '下位クラスにもインスタンスがない'],
    ['1インスタンスあたりの所属クラス数', instanceClassDistribution.average.toFixed(1), `中央値 ${aggregationNumber(instanceClassDistribution.median)} ／ 90%点 ${aggregationNumber(instanceClassDistribution.p90)} ／ 最多 ${aggregationNumber(instanceClassDistribution.max)}`],
    ['複数クラスに所属するインスタンス', instanceClassCounts.filter((count) => count > 1).length, '所属クラスIDが2つ以上'],
    ['クラス未所属のインスタンス', instancesWithoutClass, '所属クラスIDが0件'],
    ['上位クラスに接続しないインスタンス', instancesWithoutTop, '直接所属クラスから上位クラスにたどれない'],
    ['直接所属ID数が最多のクラス', classInstanceDistribution.max, classes.find(({ id }) => classInstances.get(id).size === classInstanceDistribution.max)?.label || '該当なし']
  ]);
  renderAggregationBars('aggregation-class-instance-chart', aggregationCountBuckets(classInstanceCounts, 4));
  renderAggregationBars('aggregation-subtree-instance-chart', aggregationCountBuckets(subtreeInstanceCounts, 4));
  renderAggregationBars('aggregation-instance-class-chart', aggregationCountBuckets(instanceClassCounts, 4));
  renderCards('aggregation-label-membership-primary', [
    ['1クラスあたりの直接所属ラベル数', directLabelDistribution.average.toFixed(1), `中央値 ${aggregationNumber(directLabelDistribution.median)} ／ 90%点 ${aggregationNumber(directLabelDistribution.p90)} ／ 最多 ${aggregationNumber(directLabelDistribution.max)}`],
    ['1クラスあたりの配下込みラベル数', subtreeLabelDistribution.average.toFixed(1), `中央値 ${aggregationNumber(subtreeLabelDistribution.median)} ／ 90%点 ${aggregationNumber(subtreeLabelDistribution.p90)} ／ 最多 ${aggregationNumber(subtreeLabelDistribution.max)}`],
    ['所属ラベルがある対象クラス', targetWithLabels, `${aggregationPercent(targetWithLabels, targetClasses.length)} の対象クラス`]
  ]);
  renderCards('aggregation-label-membership-secondary', [
    ['直接所属ラベルがないクラス', directLabelCounts.filter((count) => count === 0).length, 'ラベルありインスタンスの所属が0件'],
    ['配下を含めても所属ラベルがないクラス', subtreeLabelCounts.filter((count) => count === 0).length, '下位クラスにもラベルありインスタンスがない'],
    ['1ラベルあたりの所属クラス数', labelClassDistribution.average.toFixed(1), `中央値 ${aggregationNumber(labelClassDistribution.median)} ／ 90%点 ${aggregationNumber(labelClassDistribution.p90)} ／ 最多 ${aggregationNumber(labelClassDistribution.max)}`],
    ['複数クラスに所属するラベル', labelsInMultipleClasses, '同じラベルのインスタンスが複数クラスに所属'],
    ['クラス未所属のラベル', labelsWithoutClass, 'ラベルに該当するIDがクラスに所属していない'],
    ['上位クラスに接続しないラベル', labelsWithoutTop, '所属クラスから上位クラスにたどれない'],
    ['直接所属ラベル数が最多のクラス', directLabelDistribution.max, maxDirectLabelClass?.label || maxDirectLabelClass?.id || '該当なし'],
    ['ラベルなしのインスタンスID', unlabeledInstances.length, 'ラベル件数には含めず、ID件数側で集計']
  ]);
  renderAggregationBars('aggregation-class-label-chart', aggregationCountBuckets(directLabelCounts, 4));
  renderAggregationBars('aggregation-subtree-label-chart', aggregationCountBuckets(subtreeLabelCounts, 4));
  renderAggregationBars('aggregation-label-class-chart', aggregationCountBuckets(labelClassCounts, 4));
  renderCards('aggregation-integrity', [
    ['重複した親子関係', hierarchyDuplicateRows, '同じ子ID・親IDの余分な行', true, 'duplicate-hierarchy-relations'],
    ['存在しないIDを含む親子関係', danglingClassRelations, 'クラス一覧にないIDを参照', true, 'dangling-hierarchy-relations'],
    ['自己参照する親子関係', selfRelations, '子IDと親IDが同一', true, 'self-hierarchy-relations'],
    ['循環に含まれるクラスID', cycleClassIds.size, `${aggregationNumber(cycleGroups.length)}個の循環グループ`, true, 'hierarchy-cycles'],
    ['重複した所属関係', membershipDuplicateRows, '同じインスタンスID・クラスIDの余分な行', true, 'duplicate-membership-relations'],
    ['存在しないIDを含む所属関係', danglingMemberships, 'インスタンスまたはクラス一覧にないID', true, 'dangling-membership-relations'],
    ['IDがないクラスレコード', missingClassIds, 'ID欄が空の元データ行', true],
    ['IDがないインスタンスレコード', missingInstanceIds, 'ID欄が空の元データ行', true]
  ], { compact: true });
  const classNameForId = (id) => classById.get(id)?.label || id || '(IDなし)';
  const instanceNameForId = (id) => instances.find((item) => item.id === id)?.label || id || '(IDなし)';
  const integrityDetails = [
    { key: 'duplicate-hierarchy-relations', title: '重複した親子関係', groups: [...duplicateHierarchyGroups.values()].filter(({ count }) => count > 1).map(({ child, parent, count }) => ({
      title: `${classNameForId(child)} → ${classNameForId(parent)}（${count}行）`,
      entries: [{ id: child, type: aggregationClassLevel(child), note: '子ID' }, { id: parent, type: aggregationClassLevel(parent), note: '親ID' }]
    })) },
    { key: 'dangling-hierarchy-relations', title: '存在しないIDを含む親子関係', groups: danglingHierarchyRows.map(({ child, parent }, index) => ({
      title: `関係 ${index + 1}`,
      entries: [
        ...(child ? [{ id: child, type: classIds.has(child) ? aggregationClassLevel(child) : '未登録', note: '子ID' }] : []),
        ...(parent ? [{ id: parent, type: classIds.has(parent) ? aggregationClassLevel(parent) : '未登録', note: '親ID' }] : [])
      ]
    })) },
    { key: 'self-hierarchy-relations', title: '自己参照する親子関係', groups: selfRelationRows.map(({ child }, index) => ({
      title: `自己参照 ${index + 1}`,
      entries: [{ id: child, type: aggregationClassLevel(child), note: '子IDと親IDが同一' }]
    })) },
    { key: 'hierarchy-cycles', title: '循環に含まれるクラスID', groups: cycleGroups.map((cycle, index) => ({
      title: `循環 ${index + 1}`,
      entries: cycle.map((id) => ({ id, type: aggregationClassLevel(id) }))
    })) },
    { key: 'duplicate-membership-relations', title: '重複した所属関係', groups: [...duplicateMembershipGroups.values()].filter(({ count }) => count > 1).map(({ instance, classId, count }) => ({
      title: `${instanceNameForId(instance)} → ${classNameForId(classId)}（${count}行）`,
      entries: [{ id: instance, type: 'インスタンス' }, { id: classId, type: aggregationClassLevel(classId) }]
    })) },
    { key: 'dangling-membership-relations', title: '存在しないIDを含む所属関係', groups: danglingMembershipRows.map(({ instance, class: classId }, index) => ({
      title: `所属関係 ${index + 1}`,
      entries: [
        ...(instance ? [{ id: instance, type: instanceIds.has(instance) ? 'インスタンス' : '未登録', note: 'インスタンスID' }] : []),
        ...(classId ? [{ id: classId, type: classIds.has(classId) ? aggregationClassLevel(classId) : '未登録', note: 'クラスID' }] : [])
      ]
    })) }
  ];
  renderAggregationDetailLists('aggregation-integrity-details', integrityDetails, classContextForId);
  const integrityCards = [...document.querySelectorAll('#aggregation-integrity .aggregation-card')];
  const visibleIssues = integrityCards.some((card) => Number(card.dataset.metricValue) > 0);
  const integrityToggle = document.getElementById('aggregation-toggle-zero-issues');
  integrityToggle.setAttribute('aria-pressed', String(aggregationHideZeroIntegrity));
  integrityToggle.textContent = aggregationHideZeroIntegrity ? '0件も表示' : '0件を隠す';
  document.getElementById('aggregation-zero-issues-note').hidden = !aggregationHideZeroIntegrity || visibleIssues;
}

document.getElementById('aggregation-toggle-zero-issues')?.addEventListener('click', (event) => {
  aggregationHideZeroIntegrity = !aggregationHideZeroIntegrity;
  const button = event.currentTarget;
  button.setAttribute('aria-pressed', String(aggregationHideZeroIntegrity));
  button.textContent = aggregationHideZeroIntegrity ? '0件も表示' : '0件を隠す';
  const cards = [...document.querySelectorAll('#aggregation-integrity .aggregation-card')];
  cards.forEach((card) => { card.hidden = aggregationHideZeroIntegrity && Number(card.dataset.metricValue) === 0; });
  const visibleIssueCount = cards.filter((card) => Number(card.dataset.metricValue) > 0).length;
  document.getElementById('aggregation-zero-issues-note').hidden = !aggregationHideZeroIntegrity || visibleIssueCount > 0;
});

document.getElementById('aggregation-toggle-zero-label-id')?.addEventListener('click', (event) => {
  aggregationHideZeroLabelId = !aggregationHideZeroLabelId;
  const button = event.currentTarget;
  button.setAttribute('aria-pressed', String(aggregationHideZeroLabelId));
  button.textContent = aggregationHideZeroLabelId ? '0件も表示' : '0件を隠す';
  const cards = [...document.querySelectorAll('#aggregation-label-id .aggregation-card')];
  cards.forEach((card) => { card.hidden = aggregationHideZeroLabelId && Number(card.dataset.metricValue) === 0; });
  const visibleIssueCount = cards.filter((card) => Number(card.dataset.metricValue) > 0).length;
  document.getElementById('aggregation-zero-label-id-note').hidden = !aggregationHideZeroLabelId || visibleIssueCount > 0;
});
