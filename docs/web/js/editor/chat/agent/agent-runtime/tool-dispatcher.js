export function createToolDispatcher({ registry, permissionGuard, budgetGuard, getScopeCandidates }) {
  let pendingScopeRequest = null;
  return Object.freeze({
    async dispatch(name, rawArguments) {
      budgetGuard.countRetrieval();
      const tool = registry.get(name);
      if (!tool) return { ok: false, error: { code: 'UNKNOWN_TOOL', message: '登録されていない取得機能です。' } };
      let args;
      try { args = JSON.parse(rawArguments || '{}'); }
      catch { return { ok: false, error: { code: 'INVALID_TOOL_ARGUMENTS', message: '取得要求のJSONが不正です。' } }; }
      try {
        permissionGuard.assertToolAllowed(tool, args);
        const data = await tool.execute(args);
        return { ok: true, data };
      } catch (error) {
        if (error.code === 'SCOPE_EXPANSION_REQUIRED') pendingScopeRequest = error.scopeRequest || null;
        else if (error.code === 'SCOPE_DENIED' && error.classId) {
          pendingScopeRequest = {
            scopeType: 'reference',
            purpose: 'AIが必要としたクラス詳細の参照',
            candidates: getScopeCandidates?.([error.classId]) || []
          };
        }
        return { ok: false, error: { code: error.code || 'TOOL_FAILED', message: error.message } };
      }
    },
    takeScopeRequest() {
      const request = pendingScopeRequest;
      pendingScopeRequest = null;
      return request;
    }
  });
}
