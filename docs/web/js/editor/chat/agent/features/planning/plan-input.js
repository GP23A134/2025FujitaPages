const CLASS_LEVELS = Object.freeze(['top', 'middle', 'target']);

function normalizeCountGroup(group, name) {
  if (!group || typeof group !== 'object' || Array.isArray(group)) {
    throw new TypeError(`${name}の件数が必要です。`);
  }
  const normalized = {};
  for (const level of CLASS_LEVELS) {
    const count = group[level];
    if (!Number.isSafeInteger(count) || count < 0) throw new RangeError(`${name}.${level}は0以上の整数が必要です。`);
    normalized[level] = count;
  }
  return Object.freeze(normalized);
}

/**
 * Builds an intent-only planning request, optionally followed by a scoped design
 * refinement. Stable class IDs are never included; scoped class facts are sent
 * only after the first plan selects structural design.
 */
export function buildPlanInput(request, counts, { instanceCount, conversationContext = '', scopedHierarchy = null, initialPlan = null } = {}) {
  if (typeof request !== 'string' || !request.trim()) throw new TypeError('依頼文が必要です。');
  if (!counts || typeof counts !== 'object' || Array.isArray(counts)) throw new TypeError('クラス件数が必要です。');

  const input = {
    request: request.trim(),
    classCounts: {
      available: normalizeCountGroup(counts.available, 'available'),
      selected: normalizeCountGroup(counts.selected, 'selected')
    }
  };
  if (instanceCount !== undefined && instanceCount !== null) {
    if (!Number.isSafeInteger(instanceCount) || instanceCount < 0) throw new RangeError('instanceCountは0以上の整数が必要です。');
    input.instanceCounts = { total: instanceCount };
  }
  const safeContext = typeof conversationContext === 'string' ? conversationContext.trim().slice(-5000) : '';
  const scopedData = scopedHierarchy && typeof scopedHierarchy === 'object' && !Array.isArray(scopedHierarchy)
    ? Object.freeze({
      mode: 'complete_scope',
      rootPaths: Object.freeze((Array.isArray(scopedHierarchy.rootPaths) ? scopedHierarchy.rootPaths : [])
        .map((path) => Object.freeze((Array.isArray(path) ? path : []).filter((label) => typeof label === 'string').slice(0, 20))),
      classes: Object.freeze((Array.isArray(scopedHierarchy.classes) ? scopedHierarchy.classes : []).map((item) => Object.freeze({
        key: String(item.key || ''), label: String(item.label || ''), type: String(item.type || ''),
        parentKey: item.parentKey == null ? null : String(item.parentKey),
        parentLabel: item.parentLabel == null ? null : String(item.parentLabel)
      }))),
      completeCoverageRequired: true
    }) : null;
  const safeInitialPlan = initialPlan && typeof initialPlan === 'object' && !Array.isArray(initialPlan)
    ? Object.freeze({
      taskType: initialPlan.taskType,
      structureMode: initialPlan.structureMode,
      summary: initialPlan.summary,
      executionBrief: initialPlan.executionBrief,
      steps: initialPlan.steps,
      changeOperations: initialPlan.changeOperations
    }) : null;
  return Object.freeze({
    request: input.request,
    classCounts: Object.freeze({
      available: input.classCounts.available,
      selected: input.classCounts.selected
    }),
    ...(input.instanceCounts ? { instanceCounts: Object.freeze({ ...input.instanceCounts }) } : {}),
    ...(safeContext ? { conversationContext: safeContext } : {}),
    ...(scopedData ? { scopedHierarchy: scopedData } : {}),
    ...(safeInitialPlan ? { initialPlan: safeInitialPlan } : {})
  });
}
