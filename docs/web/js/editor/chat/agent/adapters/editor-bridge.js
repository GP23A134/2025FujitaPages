const CLASS_TYPES = Object.freeze(['top', 'middle', 'class']);
const COUNT_NAMES = Object.freeze({ top: 'top', middle: 'middle', class: 'target' });

function emptyCounts() {
  return { top: 0, middle: 0, target: 0 };
}

/** A narrow, read-only boundary to the existing editor globals. */
export function createEditorBridge(editor = window.classEditorAI, appData = window.appData) {
  if (!editor || typeof editor.getState !== 'function' || typeof editor.selectedIds === 'undefined') {
    throw new Error('既存エディターの読み取りAPIを利用できません。');
  }

  function getCounts() {
    const state = editor.getState();
    const available = emptyCounts();
    const selected = emptyCounts();
    const selectedIds = new Set(editor.selectedIds || []);

    for (const item of state.classes || []) {
      if (!CLASS_TYPES.includes(item.type)) continue;
      const name = COUNT_NAMES[item.type];
      available[name] += 1;
      if (selectedIds.has(item.id)) selected[name] += 1;
    }

    return Object.freeze({
      available: Object.freeze(available),
      selected: Object.freeze(selected),
      selectedTotal: Object.values(selected).reduce((sum, count) => sum + count, 0)
    });
  }

  function getInstanceCount(classIds) {
    const state = editor.getState();
    const selected = new Set(classIds || []);
    const childrenByParent = new Map();
    for (const { child, parent } of state.relations || []) {
      if (!childrenByParent.has(parent)) childrenByParent.set(parent, []);
      childrenByParent.get(parent).push(child);
    }
    const targetIds = new Set();
    const pending = [...selected];
    const visited = new Set();
    while (pending.length) {
      const id = pending.pop();
      if (visited.has(id)) continue;
      visited.add(id);
      const item = state.classes.find((candidate) => candidate.id === id);
      if (item?.type === 'class') targetIds.add(id);
      else pending.push(...(childrenByParent.get(id) || []));
    }
    return new Set((appData?.instanceClassData?.relations || [])
      .filter((relation) => targetIds.has(relation.class))
      .map((relation) => relation.instance)).size;
  }

  return Object.freeze({
    getCounts,
    getInstanceCount,
    getDataVersion() {
      return typeof appData?.classDataVersion === 'string' ? appData.classDataVersion : null;
    }
  });
}
