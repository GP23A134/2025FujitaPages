export function createToolRegistry() {
  const tools = new Map();
  return Object.freeze({
    register({ name, description, parameters, permission, execute }) {
      if (!/^[a-z][a-z0-9_]{1,63}$/.test(name || '')) throw new TypeError('ツール名の形式が正しくありません。');
      if (tools.has(name)) throw new Error(`ツール名が重複しています: ${name}`);
      if (!description || !parameters || typeof execute !== 'function') throw new TypeError(`ツール定義が不完全です: ${name}`);
      tools.set(name, Object.freeze({ name, description, parameters, permission, execute }));
      return this;
    },
    has(name) { return tools.has(name); },
    get(name) { return tools.get(name) || null; },
    definitions(allowedNames = null) {
      const allowed = allowedNames ? new Set(allowedNames) : null;
      return [...tools.values()].filter(({ name }) => !allowed || allowed.has(name)).map(({ name, description, parameters }) => ({
        type: 'function', name, description, parameters, strict: true
      }));
    },
    names() { return [...tools.keys()]; }
  });
}
