// データ全体の規模・分布・重複・関係整合性をID単位で集計し、閲覧画面の集計欄を描画する。
const aggregationNumber = (value) => Number(value || 0).toLocaleString('ja-JP');
const aggregationPercent = (part, whole) => whole ? `${(part / whole * 100).toFixed(1)}%` : '—';
const aggregationClassLevel = (id) => /\/t_/.test(id) ? '上位' : /\/m_/.test(id) ? '中間' : /\/c_/.test(id) ? '対象' : '不明';
let aggregationHideZeroIntegrity = false;

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

function renderAggregationLevelComparison(levels, classInstances, descendantInstances) {
  const body = document.getElementById('aggregation-level-comparison');
  body.replaceChildren(...levels.map(({ label, classes }) => {
    const directCounts = classes.map(({ id }) => classInstances.get(id)?.size || 0);
    const descendantCounts = classes.map(({ id }) => descendantInstances.get(id)?.size || 0);
    const directStats = aggregationDistribution(directCounts);
    const row = document.createElement('tr');
    const name = document.createElement('th'); name.scope = 'row'; name.textContent = label;
    const cells = [
      classes.length,
      directCounts.reduce((sum, count) => sum + count, 0),
      descendantCounts.reduce((sum, count) => sum + count, 0),
      directCounts.filter((count) => count === 0).length,
      aggregationNumber(directStats.median)
    ];
    row.append(name, ...cells.map((value) => {
      const cell = document.createElement('td'); cell.textContent = typeof value === 'number' ? aggregationNumber(value) : value;
      return cell;
    }));
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
    const details = document.createElement('details');
    details.id = `aggregation-detail-${section.key}`;
    details.className = 'aggregation-group-details';
    details.open = false;
    const summary = document.createElement('summary');
    summary.textContent = `${section.title}（${aggregationNumber(section.groups.length)}件）`;
    const save = document.createElement('button');
    save.type = 'button';
    save.className = 'aggregation-export-button';
    save.textContent = 'TSV保存';
    save.setAttribute('aria-label', `${section.title}の一覧をTSVで保存`);
    save.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      const rows = [['項目', 'ラベル', '種別', 'ID', '上位クラス', '中間クラス', '補足']];
      section.groups.forEach(({ title, entries }) => entries.forEach(({ id, type = '', note = '' }) => {
        const context = type !== 'インスタンス' && type !== '未登録' ? classContextForId(id) : { upperLabels: [], middleLabels: [] };
        rows.push([section.title, title, type, id, context.upperLabels.join(' ／ '), context.middleLabels.join(' ／ '), note]);
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
    section.groups.forEach(({ title, entries }) => {
      const group = document.createElement('section'); group.className = 'aggregation-duplicate-group';
      const heading = document.createElement('h3'); heading.textContent = title;
      const count = document.createElement('span'); count.className = 'aggregation-duplicate-count';
      count.textContent = `${aggregationNumber(entries.length)} ID`;
      const list = document.createElement('ul'); list.className = 'aggregation-duplicate-ids';
      entries.forEach(({ id, type = '', note = '' }) => {
        const row = document.createElement('li');
        if (type) {
          const kind = document.createElement('span'); kind.className = 'aggregation-id-kind'; kind.textContent = type;
          kind.dataset.entityType = type;
          row.append(kind);
        }
        const value = document.createElement('code'); value.textContent = id; row.append(value);
        if (type !== 'インスタンス' && type !== '未登録') {
          const context = classContextForId(id);
          const path = document.createElement('small'); path.className = 'aggregation-id-context';
          path.textContent = `上位クラス: ${context.upperLabels.join(' ／ ') || 'なし'}　中間クラス: ${context.middleLabels.join(' ／ ') || 'なし'}`;
          row.append(path);
        }
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
      group.append(heading, count, list); groups.append(group);
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
    details.append(summary, save, search, noResults, groups);
    return details;
  }));
}

function renderAggregation(data) {
  const panel = document.getElementById('aggregation-panel');
  if (!panel) return;
  const rawClasses = data.classData?.classes || [];
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
  const depths = classes.map(({ id }) => classDepth(id));
  const maxDepth = Math.max(0, ...depths);
  const topClasses = classes.filter(({ id }) => /\/t_/.test(id));
  const middleClasses = classes.filter(({ id }) => /\/m_/.test(id));
  const targetClasses = classes.filter(({ id }) => /\/c_/.test(id));
  const roots = classes.filter(({ id }) => parents.get(id).size === 0).length;
  const leaves = classes.filter(({ id }) => children.get(id).size === 0).length;
  const multipleParents = classes.filter(({ id }) => parents.get(id).size > 1).length;
  const maxChildren = Math.max(0, ...classes.map(({ id }) => children.get(id).size));
  const maxChildrenClass = classes.find(({ id }) => children.get(id).size === maxChildren && maxChildren > 0);
  const topWithMiddle = topClasses.filter(({ id }) => [...children.get(id)].some((child) => /\/m_/.test(child))).length;
  const middleWithTarget = middleClasses.filter(({ id }) => [...children.get(id)].some((child) => /\/c_/.test(child))).length;

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
  const classDuplicates = aggregationDuplicateIdStats(rawClasses);
  const instanceDuplicates = aggregationDuplicateIdStats(rawInstances);
  const classLabels = aggregationLabelStats(rawClasses);
  const instanceLabels = aggregationLabelStats(rawInstances);
  const classNormalizedLabelGroups = aggregationNormalizedLabelGroups(classes);
  const instanceNormalizedLabelGroups = aggregationNormalizedLabelGroups(instances);
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
  const levelShare = (count) => `全クラスの ${aggregationPercent(count, classes.length)}`;

  const summaryCards = [
    ['クラスID', classes.length, `元データ ${aggregationNumber(rawClasses.length)}行`],
    ['インスタンスID', instances.length, `元データ ${aggregationNumber(rawInstances.length)}行`],
    ['親子関係', classEdges.size, '重複を除いた関係数'],
    ['所属関係', membershipEdges.size, '重複を除いたインスタンス・クラス組'],
    ['最深階層', maxDepth, cycleClassIds.size ? '最長経路。循環関係を除外' : '最長の親子経路（クラス数）']
  ];
  const renderCards = (targetId, cards, { compact = false } = {}) => {
    const target = document.getElementById(targetId);
    target.classList.toggle('aggregation-metrics-compact', compact);
    target.replaceChildren(...cards.map(([label, value, note, warning = false, detailKey = '']) => {
      const card = document.createElement('article');
      card.className = `aggregation-card${warning && value > 0 ? ' is-warning' : ''}`;
      if (targetId === 'aggregation-integrity') {
        card.dataset.metricValue = String(Number(value) || 0);
        card.hidden = aggregationHideZeroIntegrity && Number(value) === 0;
      }
      const title = document.createElement('span'); title.className = 'aggregation-card-label'; title.textContent = label;
      const number = document.createElement('strong'); number.className = 'aggregation-card-value';
      number.textContent = typeof value === 'number' ? aggregationNumber(value) : String(value);
      const detail = document.createElement('small'); detail.className = 'aggregation-card-note'; detail.textContent = note;
      card.append(title, number, detail);
      if (detailKey) {
        const openDetails = document.createElement('button');
        openDetails.type = 'button';
        openDetails.className = 'aggregation-detail-button';
        openDetails.textContent = '該当一覧を見る';
        openDetails.setAttribute('aria-controls', `aggregation-detail-${detailKey}`);
        openDetails.setAttribute('aria-expanded', 'false');
        openDetails.disabled = value === 0;
        openDetails.addEventListener('click', () => {
          const details = document.getElementById(`aggregation-detail-${detailKey}`);
          if (!details) return;
          details.open = true;
          openDetails.setAttribute('aria-expanded', 'true');
          details.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
          details.querySelector('summary')?.focus({ preventScroll: true });
        });
        card.append(openDetails);
      }
      return card;
    }));
  };
  renderCards('aggregation-summary', summaryCards);
  renderCards('aggregation-structure', [
    ['上位クラス', topClasses.length, levelShare(topClasses.length)],
    ['中間クラス', middleClasses.length, levelShare(middleClasses.length)],
    ['対象クラス', targetClasses.length, levelShare(targetClasses.length)],
    ['親を持たないクラス', roots, '親子関係の起点'],
    ['子を持たないクラス', leaves, '末端にあるクラス'],
    ['複数の親を持つクラス', multipleParents, '親IDが2つ以上'],
    ['最多の直接子クラス数', maxChildren, maxChildrenClass?.label || maxChildrenClass?.id || '該当なし'],
    ['上位クラスに接続しないクラス', classesWithoutTop.length, '上位クラスまで親をたどれない'],
    ['独立した階層群', connectedComponentCount, '親子関係でつながるまとまり'],
    ['親子関係のない孤立クラス', isolatedClasses, '親も子も持たない'],
    ['中間クラスを持つ上位クラス', topWithMiddle, `${aggregationPercent(topWithMiddle, topClasses.length)} の上位クラス`],
    ['対象クラスを持つ中間クラス', middleWithTarget, `${aggregationPercent(middleWithTarget, middleClasses.length)} の中間クラス`]
  ]);
  renderAggregationBars('aggregation-level-chart', [
    { label: '上位クラス', value: topClasses.length, note: aggregationPercent(topClasses.length, classes.length) },
    { label: '中間クラス', value: middleClasses.length, note: aggregationPercent(middleClasses.length, classes.length) },
    { label: '対象クラス', value: targetClasses.length, note: aggregationPercent(targetClasses.length, classes.length) },
  ]);
  const depthsByValue = new Map();
  depths.forEach((depth) => depthsByValue.set(depth, (depthsByValue.get(depth) || 0) + 1));
  renderAggregationBars('aggregation-depth-chart', [...depthsByValue.entries()]
    .sort(([a], [b]) => a - b).map(([depth, value]) => ({ label: `${depth}階層`, value })));
  renderAggregationBars('aggregation-children-chart', aggregationCountBuckets(classes.map(({ id }) => children.get(id).size)));
  renderAggregationLevelComparison([
    { label: '上位', classes: topClasses },
    { label: '中間', classes: middleClasses },
    { label: '対象', classes: targetClasses },
  ], classInstances, instancesIncludingDescendants);
  renderCards('aggregation-label-id', [
    ['同一階層内の重複ラベル', classDuplicateLabelGroupsByLevel.sameLevel, '同じ階層の異なるクラスIDで一致', true, 'duplicate-class-labels-same'],
    ['階層をまたぐ重複ラベル', classDuplicateLabelGroupsByLevel.crossLevel, '上位・中間・対象をまたいで一致', true, 'duplicate-class-labels-cross'],
    ['複数ラベルを持つクラスID', classMultiLabelIds.length, '同一IDに異なるラベルがある', true, 'multiple-class-labels'],
    ['同じラベルを持つインスタンスID群', instanceLabels.duplicateLabels, `${aggregationNumber(instanceLabels.idsWithDuplicateLabel)} IDが該当`, true, 'duplicate-instance-labels'],
    ['複数ラベルを持つインスタンスID', instanceMultiLabelIds.length, '同一IDに異なるラベルがある', true, 'multiple-instance-labels'],
    ['表記揺れの可能性があるクラスラベル', classNormalizedLabelGroups.length, '空白・全半角・大文字小文字を正規化して一致', true, 'normalized-class-labels'],
    ['表記揺れの可能性があるインスタンスラベル', instanceNormalizedLabelGroups.length, '空白・全半角・大文字小文字を正規化して一致', true, 'normalized-instance-labels'],
    ['クラスとインスタンスで共有するラベル', sharedLabels, '完全一致するラベル文字列', false, 'shared-labels'],
    ['クラスIDとインスタンスIDで重複するID', crossTypeIdCollisions.length, '別種類のデータ間でID文字列が一致', true, 'cross-type-id-collisions'],
    ['ラベルなしのクラスID', unlabeledClasses.length, '空欄または未設定', true, 'unlabeled-classes'],
    ['ラベルなしのインスタンスID', unlabeledInstances.length, '空欄または未設定', true, 'unlabeled-instances'],
    ['クラスの重複ID', classDuplicates.ids, `${aggregationNumber(classDuplicates.extraRecords)}件の余分なレコード`, true, 'duplicate-class-ids'],
    ['インスタンスの重複ID', instanceDuplicates.ids, `${aggregationNumber(instanceDuplicates.extraRecords)}件の余分なレコード`, true, 'duplicate-instance-ids']
  ]);
  const idEntries = (items, type, noteFor = () => '') => items.map((item) => ({ id: item.id, type: type === 'クラス' ? aggregationClassLevel(item.id) : type, note: noteFor(item) }));
  const classDuplicateDetails = (kind) => classDuplicateGroupsByKind(kind).map(({ label, ids }) => ({
    title: `${label}（${new Set(ids.map(aggregationClassLevel)).size > 1 ? '階層をまたぐ' : '同一階層内'}）`,
    entries: ids.map((id) => ({ id, type: aggregationClassLevel(id) }))
  }));
  const labelDetailSections = [
    { key: 'duplicate-class-labels-same', title: '同一階層内の重複ラベル', groups: classDuplicateDetails('sameLevel') },
    { key: 'duplicate-class-labels-cross', title: '階層をまたぐ重複ラベル', groups: classDuplicateDetails('crossLevel') },
    { key: 'multiple-class-labels', title: '複数ラベルを持つクラスID', groups: classMultiLabelIds.map(({ id, labels }) => ({ title: labels.join(' ／ '), entries: [{ id, type: aggregationClassLevel(id) }] })) },
    { key: 'duplicate-instance-labels', title: '同じラベルを持つインスタンスID群', groups: instanceLabels.duplicateGroups.map(({ label, ids }) => ({ title: label, entries: ids.map((id) => ({ id, type: 'インスタンス' })) })) },
    { key: 'multiple-instance-labels', title: '複数ラベルを持つインスタンスID', groups: instanceMultiLabelIds.map(({ id, labels }) => ({ title: labels.join(' ／ '), entries: [{ id, type: 'インスタンス' }] })) },
    { key: 'normalized-class-labels', title: '表記揺れの可能性があるクラスラベル', groups: classNormalizedLabelGroups.map(({ normalized, ids }) => ({ title: normalized, entries: ids.map(({ id, labels }) => ({ id, type: aggregationClassLevel(id), note: `元のラベル: ${labels.join(' ／ ')}` })) })) },
    { key: 'normalized-instance-labels', title: '表記揺れの可能性があるインスタンスラベル', groups: instanceNormalizedLabelGroups.map(({ normalized, ids }) => ({ title: normalized, entries: ids.map(({ id, labels }) => ({ id, type: 'インスタンス', note: `元のラベル: ${labels.join(' ／ ')}` })) })) },
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
  renderCards('aggregation-membership', [
    ['1クラスあたりの直接所属ID数', classInstanceDistribution.average.toFixed(1), `中央値 ${aggregationNumber(classInstanceDistribution.median)} ／ 90%点 ${aggregationNumber(classInstanceDistribution.p90)} ／ 最多 ${aggregationNumber(classInstanceDistribution.max)}`],
    ['1クラスあたりの配下込みID数', subtreeInstanceDistribution.average.toFixed(1), `中央値 ${aggregationNumber(subtreeInstanceDistribution.median)} ／ 90%点 ${aggregationNumber(subtreeInstanceDistribution.p90)} ／ 最多 ${aggregationNumber(subtreeInstanceDistribution.max)}`],
    ['所属IDがないクラス', classInstanceCounts.filter((count) => count === 0).length, '直接所属するインスタンスが0件'],
    ['配下を含めても所属IDがないクラス', subtreeInstanceCounts.filter((count) => count === 0).length, '下位クラスにもインスタンスがない'],
    ['所属IDがある対象クラス', targetWithInstances, `${aggregationPercent(targetWithInstances, targetClasses.length)} の対象クラス`],
    ['1インスタンスあたりの所属クラス数', instanceClassDistribution.average.toFixed(1), `中央値 ${aggregationNumber(instanceClassDistribution.median)} ／ 90%点 ${aggregationNumber(instanceClassDistribution.p90)} ／ 最多 ${aggregationNumber(instanceClassDistribution.max)}`],
    ['複数クラスに所属するインスタンス', instanceClassCounts.filter((count) => count > 1).length, '所属クラスIDが2つ以上'],
    ['クラス未所属のインスタンス', instancesWithoutClass, '所属クラスIDが0件'],
    ['上位クラスに接続しないインスタンス', instancesWithoutTop, '直接所属クラスから上位クラスにたどれない'],
    ['直接所属ID数が最多のクラス', classInstanceDistribution.max, classes.find(({ id }) => classInstances.get(id).size === classInstanceDistribution.max)?.label || '該当なし']
  ]);
  renderAggregationBars('aggregation-class-instance-chart', aggregationCountBuckets(classInstanceCounts, 4));
  renderAggregationBars('aggregation-subtree-instance-chart', aggregationCountBuckets(subtreeInstanceCounts, 4));
  renderAggregationBars('aggregation-instance-class-chart', aggregationCountBuckets(instanceClassCounts, 4));
  renderCards('aggregation-label-membership', [
    ['1クラスあたりの直接所属ラベル数', directLabelDistribution.average.toFixed(1), `中央値 ${aggregationNumber(directLabelDistribution.median)} ／ 90%点 ${aggregationNumber(directLabelDistribution.p90)} ／ 最多 ${aggregationNumber(directLabelDistribution.max)}`],
    ['1クラスあたりの配下込みラベル数', subtreeLabelDistribution.average.toFixed(1), `中央値 ${aggregationNumber(subtreeLabelDistribution.median)} ／ 90%点 ${aggregationNumber(subtreeLabelDistribution.p90)} ／ 最多 ${aggregationNumber(subtreeLabelDistribution.max)}`],
    ['直接所属ラベルがないクラス', directLabelCounts.filter((count) => count === 0).length, 'ラベルありインスタンスの所属が0件'],
    ['配下を含めても所属ラベルがないクラス', subtreeLabelCounts.filter((count) => count === 0).length, '下位クラスにもラベルありインスタンスがない'],
    ['所属ラベルがある対象クラス', targetWithLabels, `${aggregationPercent(targetWithLabels, targetClasses.length)} の対象クラス`],
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
