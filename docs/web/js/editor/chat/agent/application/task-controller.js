const CONTROLLER_ROUTES = Object.freeze([
  'chunked_read_only', 'target_move', 'hierarchy_reorganization', 'hierarchy_deletion', 'agent_runtime'
]);

export function createTaskController(routes) {
  if (!Array.isArray(routes) || routes.length !== CONTROLLER_ROUTES.length
    || routes.some((route, index) => route?.id !== CONTROLLER_ROUTES[index]
      || typeof route.matches !== 'function' || typeof route.run !== 'function')) {
    throw new TypeError('タスクコントローラーには全実行経路の順序付き登録が必要です。');
  }
  return Object.freeze({
    select(context) {
      const route = routes.find((candidate) => candidate.matches(context));
      if (!route) throw new Error('実行可能なタスク経路がありません。');
      return Object.freeze({ id: route.id, run: (...args) => route.run(context, ...args) });
    }
  });
}
