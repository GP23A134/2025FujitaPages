export function sameIdSet(left, right) {
  if (!Array.isArray(left) || !Array.isArray(right)
    || left.some((id) => typeof id !== 'string')
    || right.some((id) => typeof id !== 'string')) return false;
  const normalize = (ids) => [...new Set(ids)].sort();
  return JSON.stringify(normalize(left)) === JSON.stringify(normalize(right));
}
