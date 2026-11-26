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
 * Builds the planning request from the user's intent and aggregate class counts.
 * Raw class IDs, full hierarchy, versions and retrieved records are not accepted.
 * A compact app-resolved scope root and descendant counts may be included.
 */
export function buildPlanInput(request, counts, { instanceCount, conversationContext = '', scopeContext = null } = {}) {
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
  if (scopeContext !== null && scopeContext !== undefined) {
    if (!scopeContext || typeof scopeContext !== 'object' || Array.isArray(scopeContext)) throw new TypeError('scopeContextの形式が不正です。');
    const root = scopeContext.root;
    if (!root || typeof root.label !== 'string' || !root.label.trim() || !['top', 'middle'].includes(root.type)) {
      throw new TypeError('scopeContext.rootには階層クラス名と種別が必要です。');
    }
    if (!['request', 'selection', 'checkpoint'].includes(scopeContext.source)) throw new TypeError('scopeContext.sourceが不正です。');
    input.scopeContext = Object.freeze({
      resolution: 'unique',
      source: scopeContext.source,
      root: Object.freeze({ label: root.label.trim(), type: root.type }),
      descendantCounts: normalizeCountGroup(scopeContext.descendantCounts, 'scopeContext.descendantCounts')
    });
  }
  const safeContext = typeof conversationContext === 'string' ? conversationContext.trim().slice(-5000) : '';
  return Object.freeze({
    request: input.request,
    classCounts: Object.freeze({
      available: input.classCounts.available,
      selected: input.classCounts.selected
    }),
    ...(input.instanceCounts ? { instanceCounts: Object.freeze({ ...input.instanceCounts }) } : {}),
    ...(input.scopeContext ? { scopeContext: input.scopeContext } : {}),
    ...(safeContext ? { conversationContext: safeContext } : {})
  });
}
