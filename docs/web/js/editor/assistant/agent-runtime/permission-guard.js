export function createPermissionGuard({ getReferenceScope, getChangeScope = () => [] }) {
  const referenceScope = () => new Set(getReferenceScope() || []);
  const changeScope = () => new Set(getChangeScope() || []);

  return Object.freeze({
    assertToolAllowed(tool, args) {
      if (tool.permission !== 'reference') throw Object.assign(new Error('読み取り以外のツールは実行できません。'), { code: 'TOOL_NOT_READ_ONLY' });
      const allowed = referenceScope();
      const requested = Array.isArray(args.classIds) ? args.classIds
        : typeof args.classId === 'string' ? [args.classId]
          : typeof args.parentId === 'string' ? [args.parentId] : [];
      for (const id of requested) {
        if (!allowed.has(id)) throw Object.assign(new Error('許可された参照範囲外のクラスが要求されました。'), { code: 'SCOPE_DENIED', classId: id });
      }
      return true;
    },
    canChange(classId) { return changeScope().has(classId); }
  });
}
