import { createToolRegistry } from '../../agent-runtime/tool-registry.js';

const hierarchyTypes = new Set(['top', 'middle']);

export function createEditorDataReader({
  editor, appData = globalThis.window?.appData || {}, getReferenceScope, getSelectedIds = () => [], getDataVersion,
  pageLimit = 100, idLimit = pageLimit, instanceInformationEnabled = false,
  instancePerClassLimit = 10, instancePerTaskLimit = 500, includeInstanceIds = false,
  plannedInstanceContext = 'none'
}) {
  if (!editor?.getState || typeof getReferenceScope !== 'function') throw new TypeError('読み取りデータ境界が不足しています。');
  if (!Number.isSafeInteger(pageLimit) || pageLimit < 1 || !Number.isSafeInteger(idLimit) || idLimit < 1) {
    throw new RangeError('取得上限は1以上の整数が必要です。');
  }

  let instanceAllocation = null;

  function snapshot() {
    const state = editor.getState();
    const classesById = new Map(state.classes.map((item) => [item.id, item]));
    const parentByChild = new Map(state.relations.map(({ child, parent }) => [child, parent]));
    const childrenByParent = new Map();
    for (const { child, parent } of state.relations) {
      if (!childrenByParent.has(parent)) childrenByParent.set(parent, []);
      childrenByParent.get(parent).push(child);
    }
    return { state, classesById, parentByChild, childrenByParent, allowed: new Set(getReferenceScope() || []), version: getDataVersion?.() || null };
  }

  function detailFor(id, data, includeParentContext = true) {
    const item = data.classesById.get(id);
    if (!item) return null;
    const parentId = includeParentContext ? data.parentByChild.get(id) || null : null;
    const parent = parentId ? data.classesById.get(parentId) : null;
    const record = {
      id: item.id,
      label: item.label,
      type: item.type,
      parentId,
      parentLabel: parent?.label || null
    };
    if (hierarchyTypes.has(item.type)) record.descendantTargetClassCount = data.state.counts?.[id] || 0;
    return record;
  }

  function scopeError(ids, purpose, data) {
    const uniqueIds = [...new Set(ids)].filter((id) => data.classesById.has(id) && !data.allowed.has(id));
    if (!uniqueIds.length) return;
    const candidates = uniqueIds.map((id) => detailFor(id, data));
    const error = new Error('この取得には選択範囲外のクラスへの参照許可が必要です。');
    error.code = 'SCOPE_EXPANSION_REQUIRED';
    error.scopeRequest = { scopeType: 'reference', purpose, candidates };
    throw error;
  }

  function includeParents(ids, purpose, data) {
    scopeError(ids.map((id) => data.parentByChild.get(id)).filter(Boolean), `${purpose}に親クラス情報が必要`, data);
  }

  function paginate(name, records, cursor, data, limit = pageLimit) {
    let offset = 0;
    if (cursor !== null && cursor !== undefined) {
      let saved;
      try { saved = JSON.parse(decodeURIComponent(cursor)); } catch { saved = null; }
      if (!saved || saved.name !== name || !Number.isSafeInteger(saved.offset) || saved.offset < 0) {
        throw Object.assign(new Error('続きカーソルが無効です。'), { code: 'INVALID_CURSOR' });
      }
      if (saved.version !== data.version) throw Object.assign(new Error('データ更新により続きカーソルが古くなりました。'), { code: 'STALE_DATA' });
      offset = saved.offset;
    }
    const items = records.slice(offset, offset + limit);
    const nextOffset = offset + items.length;
    let nextCursor = null;
    if (nextOffset < records.length) {
      nextCursor = encodeURIComponent(JSON.stringify({ name, offset: nextOffset, version: data.version }));
    }
    return { items, nextCursor };
  }

  function createPageCursor(name, offset) {
    if (!['hierarchy_index', 'selected_class_details'].includes(name)
      || !Number.isSafeInteger(offset) || offset < 0) {
      throw new TypeError('ページカーソルの指定が不正です。');
    }
    return offset === 0 ? null : encodeURIComponent(JSON.stringify({ name, offset, version: getDataVersion?.() || null }));
  }

  function readHierarchyIndex({ cursor = null } = {}) {
    const data = snapshot();
    const records = data.state.classes.filter((item) => hierarchyTypes.has(item.type))
      .sort((left, right) => String(left.id).localeCompare(String(right.id)))
      .map((item) => item.id);
    scopeError(records, '階層索引の取得', data);
    includeParents(records, '階層索引', data);
    return paginate('hierarchy_index', records.map((id) => detailFor(id, data)), cursor, data);
  }

  function readChildren({ parentId, cursor = null } = {}) {
    const data = snapshot();
    if (typeof parentId !== 'string' || !data.classesById.has(parentId)) {
      throw Object.assign(new Error('親クラスIDが見つかりません。'), { code: 'NOT_FOUND' });
    }
    scopeError([parentId], '直下クラスの取得', data);
    const childIds = data.childrenByParent.get(parentId) || [];
    scopeError(childIds, '直下クラスの取得', data);
    includeParents(childIds, '直下クラス一覧', data);
    const records = childIds.map((id) => detailFor(id, data)).sort((left, right) => String(left.id).localeCompare(String(right.id)));
    return paginate(`children:${parentId}`, records, cursor, data);
  }

  function readClassDetails({ classIds, includeParentContext = true } = {}) {
    const data = snapshot();
    if (!Array.isArray(classIds) || classIds.length > idLimit) throw Object.assign(new Error(`詳細取得は一度に${idLimit}件までです。`), { code: 'ID_LIMIT' });
    const uniqueIds = [...new Set(classIds)];
    scopeError(uniqueIds, 'クラス詳細の取得', data);
    const foundIds = uniqueIds.filter((id) => data.classesById.has(id));
    if (includeParentContext) includeParents(foundIds, 'クラス詳細', data);
    return {
      items: foundIds.map((id) => detailFor(id, data, includeParentContext)),
      notFoundIds: uniqueIds.filter((id) => !data.classesById.has(id))
    };
  }

  function readSelectedClassDetails({ cursor = null, includeParentContext = true } = {}) {
    const data = snapshot();
    const selectedIds = [...new Set(getSelectedIds() || [])];
    scopeError(selectedIds, '選択クラス詳細の取得', data);
    const foundIds = selectedIds.filter((id) => data.classesById.has(id));
    if (includeParentContext) includeParents(foundIds, '選択クラス詳細', data);
    const records = foundIds.sort((left, right) => String(left).localeCompare(String(right)))
      .map((id) => detailFor(id, data, includeParentContext));
    return {
      ...paginate('selected_class_details', records, cursor, data),
      totalCount: records.length,
      notFoundIds: cursor ? [] : selectedIds.filter((id) => !data.classesById.has(id))
    };
  }

  const stableHash = (value) => {
    let hash = 2166136261;
    for (const character of String(value)) {
      hash ^= character.codePointAt(0);
      hash = Math.imul(hash, 16777619);
    }
    return (hash >>> 0).toString(16).padStart(8, '0');
  };

  function prepareInstanceAllocation(data) {
    const memberships = appData?.instanceClassData?.relations || [];
    const instancesByClass = new Map();
    for (const relation of memberships) {
      if (!data.allowed.has(relation.class)) continue;
      if (!instancesByClass.has(relation.class)) instancesByClass.set(relation.class, new Set());
      instancesByClass.get(relation.class).add(relation.instance);
    }
    const targetClasses = [...instancesByClass.keys()].filter((id) => data.classesById.get(id)?.type === 'class');
    const priority = (id) => stableHash(`${data.version || ''}\u0000${id}`);
    targetClasses.sort((left, right) => priority(left).localeCompare(priority(right)) || String(left).localeCompare(String(right)));
    const totalInstances = targetClasses.reduce((sum, id) => sum + instancesByClass.get(id).size, 0);
    const capacityByClass = new Map(targetClasses.map((id) => [id, Math.min(instancesByClass.get(id).size, instancePerClassLimit)]));
    const allocations = new Map(targetClasses.map((id) => [id, 0]));
    let remaining = instancePerTaskLimit;
    while (remaining > 0) {
      let progress = false;
      for (const id of targetClasses) {
        if (!remaining) break;
        if (allocations.get(id) >= capacityByClass.get(id)) continue;
        allocations.set(id, allocations.get(id) + 1);
        remaining -= 1;
        progress = true;
      }
      if (!progress) break;
    }
    instanceAllocation = { version: data.version, allowed: [...data.allowed].sort().join('\u0000'), instancesByClass, allocations, targetClasses, totalInstances };
  }

  function readInstanceContext({ classIds, context = 'instance_content' } = {}) {
    if (!instanceInformationEnabled) throw Object.assign(new Error('インスタンス情報の取得が開発者設定で無効です。'), { code: 'INSTANCE_CONTEXT_DISABLED' });
    if (!Array.isArray(classIds) || classIds.length > idLimit) throw Object.assign(new Error(`一度に指定できるクラスIDは${idLimit}件までです。`), { code: 'ID_LIMIT' });
    if (!['membership_summary', 'instance_content'].includes(context)) throw Object.assign(new Error('インスタンス情報の取得段階が不正です。'), { code: 'INVALID_INSTANCE_CONTEXT' });
    if (context !== plannedInstanceContext) throw Object.assign(new Error('計画で許可されていないインスタンス情報の取得段階です。'), { code: 'INSTANCE_CONTEXT_NOT_PLANNED' });
    const data = snapshot();
    const ids = [...new Set(classIds)];
    scopeError(ids, 'インスタンス情報の取得', data);
    const notFoundIds = ids.filter((id) => !data.classesById.has(id));
    const requested = new Set();
    const pending = [...ids];
    const visited = new Set();
    while (pending.length) {
      const id = pending.pop();
      if (visited.has(id)) continue;
      visited.add(id);
      if (data.classesById.get(id)?.type === 'class') requested.add(id);
      else pending.push(...(data.childrenByParent.get(id) || []).filter((childId) => data.allowed.has(childId)));
    }
    const requestedTargets = [...requested].sort();
    const instanceRecords = appData?.instanceData?.instances || [];
    const membershipRecords = appData?.instanceClassData?.relations || [];
    const instanceDataVersion = appData?.instanceDataVersion || stableHash(JSON.stringify({ instanceRecords, membershipRecords }));
    const version = `${data.version || ''}/${instanceDataVersion}`;
    const cacheScope = [...data.allowed].sort().join('\u0000');
    if (!instanceAllocation || instanceAllocation.version !== version || instanceAllocation.allowed !== cacheScope) {
      const allocationData = { ...data, version };
      prepareInstanceAllocation(allocationData);
    }
    const instances = new Map(instanceRecords.map((item) => [item.id, item]));
    let returned = 0;
    const items = requestedTargets.map((classId) => {
      const instanceIds = [...(instanceAllocation.instancesByClass.get(classId) || [])];
      const quota = instanceAllocation.allocations.get(classId) || 0;
      const ordered = instanceIds.sort((left, right) => stableHash(`${data.version || ''}\u0000${classId}\u0000${left}`)
        .localeCompare(stableHash(`${data.version || ''}\u0000${classId}\u0000${right}`)) || String(left).localeCompare(String(right)));
      const selectedIds = ordered.slice(0, quota);
      const records = context === 'instance_content' ? selectedIds.map((id) => {
        const record = instances.get(id);
        return record ? { ...(includeInstanceIds ? { id } : {}), label: record.label || '' } : null;
      }).filter(Boolean) : [];
      returned += records.length;
      const totalCount = instanceIds.length;
      return {
        classId,
        totalCount,
        returnedCount: context === 'membership_summary' ? totalCount : records.length,
      selectionMethod: context === 'membership_summary' ? 'count_only'
          : records.length === totalCount ? 'all' : records.length ? 'deterministic_random_sample' : 'not_sampled',
        isPartial: context === 'instance_content' && records.length < totalCount,
        ...(context === 'instance_content' ? { instances: records } : {})
      };
    });
    const requestedTotal = items.reduce((sum, item) => sum + item.totalCount, 0);
    return {
      items,
      notFoundIds,
      sampling: {
        totalInstancesInAllowedScope: instanceAllocation.totalInstances,
        returnedInstances: returned,
        totalLimit: instancePerTaskLimit,
        appliesToContent: context === 'instance_content',
        overallLimitReached: context === 'instance_content' && instanceAllocation.totalInstances > instancePerTaskLimit,
        unrepresentedClassCount: context === 'instance_content'
          ? instanceAllocation.targetClasses.filter((id) => instanceAllocation.allocations.get(id) === 0).length : 0,
        requestedTotal
      }
    };
  }

  const registry = createToolRegistry();
  registry
    .register({
      name: 'read_hierarchy_index', permission: 'reference', description: '許可された上位・中間クラスの階層索引をページ単位で取得します。',
      parameters: { type: 'object', additionalProperties: false, properties: { cursor: { type: ['string', 'null'] } }, required: ['cursor'] },
      execute: readHierarchyIndex
    })
    .register({
      name: 'read_direct_children', permission: 'reference', description: '許可された親クラスの直下クラスを取得します。',
      parameters: { type: 'object', additionalProperties: false, properties: { parentId: { type: 'string' }, cursor: { type: ['string', 'null'] } }, required: ['parentId', 'cursor'] },
      execute: readChildren
    })
    .register({
      name: 'read_class_details', permission: 'reference', description: '既知のクラスIDをまとめて詳細取得します。追加参照が許可されていない場合はincludeParentContext=falseで親情報を省略できます。',
      parameters: { type: 'object', additionalProperties: false, properties: {
        classIds: { type: 'array', items: { type: 'string' }, maxItems: idLimit },
        includeParentContext: { type: 'boolean' }
      }, required: ['classIds', 'includeParentContext'] },
      execute: readClassDetails
    })
    .register({
      name: 'read_selected_class_details', permission: 'reference', description: '利用者が選択したクラスの詳細を設定上限まで取得します。追加参照が許可されていない場合はincludeParentContext=falseで親情報を省略できます。続きは返されたカーソルを使います。',
      parameters: { type: 'object', additionalProperties: false, properties: {
        cursor: { type: ['string', 'null'] }, includeParentContext: { type: 'boolean' }
      }, required: ['cursor', 'includeParentContext'] },
      execute: readSelectedClassDetails
    });

  if (instanceInformationEnabled) registry.register({
    name: 'read_instance_context', permission: 'reference', description: '許可された対象クラスに属するインスタンスの件数またはラベルを読み取ります。',
    parameters: {
      type: 'object', additionalProperties: false,
      properties: {
        classIds: { type: 'array', items: { type: 'string' }, maxItems: idLimit },
        context: { type: 'string', enum: ['membership_summary', 'instance_content'] }
      },
      required: ['classIds', 'context']
    },
    execute: readInstanceContext
  });

  return Object.freeze({ registry, readHierarchyIndex, readChildren, readClassDetails, readSelectedClassDetails, readInstanceContext,
    pageLimit, createPageCursor, getScopeCandidates: (ids, permissions = {}) => {
    const data = snapshot();
    return [...new Set(ids)].map((id) => detailFor(id, data)).filter(Boolean).map((item) => ({
      ...item,
      needsReference: permissions.needsReference ?? true,
      needsChange: permissions.needsChange ?? false
    }));
  } });
}
