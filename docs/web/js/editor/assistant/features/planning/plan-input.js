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
 * Builds the only data shape allowed in the initial planning request.
 * IDs, labels, hierarchy, data versions and retrieved records are not accepted.
 */
export function buildPlanInput(request, counts, { instanceCount } = {}) {
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
  return Object.freeze({
    request: input.request,
    classCounts: Object.freeze({
      available: input.classCounts.available,
      selected: input.classCounts.selected
    }),
    ...(input.instanceCounts ? { instanceCounts: Object.freeze({ ...input.instanceCounts }) } : {})
  });
}
