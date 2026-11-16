// 設定の定義は機能側が所有し、このregistryは集約と検証だけを行います。
export function createSettingsRegistry() {
  const definitions = new Map();

  function register(feature, entries) {
    if (typeof feature !== 'string' || !feature.trim()) throw new TypeError('設定の機能名が必要です。');
    if (!Array.isArray(entries)) throw new TypeError('設定定義は配列である必要があります。');
    for (const entry of entries) {
      if (!entry || typeof entry.key !== 'string' || !entry.key.trim()) throw new TypeError('設定キーが必要です。');
      if (definitions.has(entry.key)) throw new Error(`設定キーが重複しています: ${entry.key}`);
      if (!['boolean', 'number', 'string', 'enum'].includes(entry.type)) throw new TypeError(`未対応の設定型です: ${entry.type}`);
      if (!Object.hasOwn(entry, 'defaultValue')) throw new TypeError(`${entry.key}に初期値がありません。`);
      definitions.set(entry.key, Object.freeze({ ...entry, feature }));
    }
  }

  function list() {
    return [...definitions.values()];
  }

  function defaults() {
    return Object.fromEntries([...definitions.values()].map(({ key, defaultValue }) => [key, defaultValue]));
  }

  function validate(values) {
    const errors = [];
    for (const definition of definitions.values()) {
      const value = values?.[definition.key];
      if (value === undefined) continue;
      const typeMatches = definition.type === 'enum'
        ? definition.values?.includes(value)
        : typeof value === definition.type;
      if (!typeMatches) errors.push(`${definition.key}の値または型が正しくありません。`);
      if (definition.type === 'number' && typeMatches) {
        if (definition.min !== undefined && value < definition.min) errors.push(`${definition.key}は${definition.min}以上が必要です。`);
        if (definition.max !== undefined && value > definition.max) errors.push(`${definition.key}は${definition.max}以下が必要です。`);
      }
    }
    return { valid: errors.length === 0, errors };
  }

  return Object.freeze({ register, list, defaults, validate });
}
