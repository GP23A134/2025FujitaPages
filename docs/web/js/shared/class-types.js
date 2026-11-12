// クラス種別を読み込み時に確定し、画面間で同じ判定を使います。
(() => {
  const VALID_TYPES = new Set(['top', 'middle', 'class']);
  const inferTypeFromId = (id) => {
    const segment = String(id || '').split('/').pop().replace(/^new-/, '');
    if (/^t[_-]/.test(segment)) return 'top';
    if (/^m[_-]/.test(segment)) return 'middle';
    return 'class';
  };
  window.getClassType = (value) => {
    if (value && typeof value === 'object' && VALID_TYPES.has(value.type)) return value.type;
    return inferTypeFromId(value && typeof value === 'object' ? value.id : value);
  };
  const normalizeRecords = (records, expectedType = null) => (records || []).map((item) => {
    const type = expectedType || window.getClassType(item);
    return item.type === type ? item : { ...item, type };
  });
  window.normalizeAppClassTypes = (data) => {
    if (!data) return data;
    if (data.classData) data.classData.classes = normalizeRecords(data.classData.classes);
    if (data.targetClassData) data.targetClassData.classes = normalizeRecords(data.targetClassData.classes, 'class');
    return data;
  };
})();
