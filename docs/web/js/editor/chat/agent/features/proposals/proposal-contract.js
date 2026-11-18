const TYPES = new Set([
  'move_target_class', 'move_middle_class', 'move_top_class', 'promote_middle_class',
  'delete_middle_class', 'delete_top_class', 'add_top_class', 'add_middle_class',
  'rename_top_class', 'rename_middle_class', 'rename_target_class'
]);
const record = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const nonempty = (value) => typeof value === 'string' && value.trim().length > 0;
const only = (value, keys) => Object.keys(value).every((key) => keys.includes(key));

function resolveReference(reference, byId, temporaryIds, purpose) {
  if (!record(reference) || !only(reference, ['kind', 'classId', 'tempId'])) throw new Error(`${purpose}のクラス参照形式が不正です。`);
  if (reference.kind === 'existing_class' && nonempty(reference.classId) && reference.tempId === null) {
    if (!byId.has(reference.classId)) throw new Error(`${purpose}のクラスIDが見つかりません。`);
    return reference.classId;
  }
  if (reference.kind === 'temporary_class' && nonempty(reference.tempId) && reference.classId === null && temporaryIds.has(reference.tempId)) {
    return reference.tempId;
  }
  throw new Error(`${purpose}の既存IDまたは仮IDが不正です。`);
}

function toEditorOperation(operation, byId, temporaryIds, targetRenameEnabled) {
  if (!record(operation) || !only(operation, ['type', 'target', 'newParent', 'tempId', 'label']) || !TYPES.has(operation.type)) {
    throw new Error('提案操作の形式または種類が不正です。');
  }
  const targetId = operation.target?.kind === 'existing_class'
    ? resolveReference(operation.target, byId, temporaryIds, '操作対象')
    : operation.target?.kind === 'temporary_class'
      ? resolveReference(operation.target, byId, temporaryIds, '操作対象') : null;
  const target = targetId && byId.get(targetId);
  const targetKind = operation.target?.kind === 'temporary_class' ? temporaryIds.get(targetId) : target?.type;
  const ensureType = (expected) => {
    if (targetKind !== expected) throw new Error(`操作 ${operation.type} の対象クラス種別が一致しません。`);
  };
  const parentId = operation.newParent === null ? null : resolveReference(operation.newParent, byId, temporaryIds, '移動先');

  if (operation.type.startsWith('move_')) {
    ensureType(operation.type === 'move_target_class' ? 'class'
      : operation.type === 'move_middle_class' ? 'middle' : 'top');
    if (!parentId) throw new Error('移動先の親クラスが必要です。');
    if (operation.tempId !== null || operation.label !== null) throw new Error('移動操作に追加専用項目があります。');
    return { type: 'moveClass', classId: targetId, destinationId: parentId };
  }
  if (operation.type === 'promote_middle_class') {
    ensureType('middle');
    if (operation.newParent !== null || operation.tempId !== null || operation.label !== null) throw new Error('上位化操作の指定が不正です。');
    return { type: 'promoteClass', classId: targetId };
  }
  if (operation.type === 'delete_middle_class' || operation.type === 'delete_top_class') {
    ensureType(operation.type === 'delete_middle_class' ? 'middle' : 'top');
    if (operation.newParent !== null || operation.tempId !== null || operation.label !== null) throw new Error('削除操作の指定が不正です。');
    return { type: 'deleteClass', classId: targetId };
  }
  if (operation.type === 'add_top_class' || operation.type === 'add_middle_class') {
    const classType = operation.type === 'add_top_class' ? 'top' : 'middle';
    if (operation.target !== null || !nonempty(operation.tempId) || temporaryIds.has(operation.tempId) || !nonempty(operation.label)) {
      throw new Error('追加クラスのIDまたは名称が不正です.');
    }
    temporaryIds.set(operation.tempId, classType);
    if (classType === 'top' && operation.newParent !== null) throw new Error('上位クラスには親を指定できません。');
    if (classType === 'middle' && !parentId) throw new Error('中間クラスには親が必要です。');
    return { type: 'addClass', classType, temporaryId: operation.tempId, label: operation.label, parentId };
  }
  if (operation.type === 'rename_top_class' || operation.type === 'rename_middle_class') {
    ensureType(operation.type === 'rename_top_class' ? 'top' : 'middle');
    if (operation.newParent !== null || operation.tempId !== null || !nonempty(operation.label)) throw new Error('名称変更の指定が不正です。');
    return { type: 'renameClass', classId: targetId, label: operation.label };
  }
  if (operation.type === 'rename_target_class') {
    if (!targetRenameEnabled) throw new Error('対象クラス名の変更は開発者設定で無効です。');
    ensureType('class');
    if (operation.newParent !== null || operation.tempId !== null || !nonempty(operation.label)) throw new Error('名称変更の指定が不正です。');
    return { type: 'renameClass', classId: targetId, label: operation.label };
  }
  throw new Error('未対応の提案操作です。');
}

export function validateProposalResponse(response, { editor, referenceIds, changeIds, allowedOperations = [...TYPES], targetRenameEnabled = false, dataVersion = null }) {
  const errors = [];
  const scopeRequests = new Map();
  if (!record(response) || !only(response, ['message', 'proposals', 'alternativeGroups'])) throw new Error('変更案の応答形式が不正です。');
  if (!nonempty(response.message) || !Array.isArray(response.proposals) || !Array.isArray(response.alternativeGroups)) throw new Error('変更案の必須項目がありません。');
  const state = editor.getState();
  const byId = new Map(state.classes.map((item) => [item.id, item]));
  const baseFingerprint = JSON.stringify({ classes: state.classes, relations: state.relations });
  const references = new Set([...referenceIds, ...changeIds]);
  const validated = [];
  const ids = new Set();

  for (const raw of response.proposals) {
    try {
      if (!record(raw) || !only(raw, ['id', 'title', 'summary', 'reason', 'uncertainties', 'questions', 'operations'])) throw new Error('提案の項目が不正です。');
      if (!nonempty(raw.id) || ids.has(raw.id)) throw new Error('提案IDが空または重複しています。');
      ids.add(raw.id);
      if (![raw.title, raw.summary, raw.reason].every(nonempty) || !Array.isArray(raw.operations) || !raw.operations.length) throw new Error('提案の説明または操作がありません。');
      if (!Array.isArray(raw.uncertainties) || raw.uncertainties.some((item) => !nonempty(item))
        || !Array.isArray(raw.questions) || raw.questions.some((question) => !record(question)
          || !only(question, ['id', 'text', 'options']) || !nonempty(question.id) || !nonempty(question.text)
          || !Array.isArray(question.options) || question.options.length > 4
          || question.options.some((option, index) => !record(option) || !only(option, ['id', 'label'])
            || !nonempty(option.id) || !nonempty(option.label)
            || question.options.findIndex((item) => item?.id === option.id) !== index))) {
        throw new Error('提案の質問・不確実点が不正です。');
      }
      if (raw.operations.some((operation) => !allowedOperations.includes(operation?.type))) throw new Error('計画で許可されていない操作が含まれています。');
      const temporaryIds = new Map();
      const operations = raw.operations.map((operation) => toEditorOperation(operation, byId, temporaryIds, targetRenameEnabled));
      const proposalScopeRequests = new Map();
      const addScopeRequest = (classId, needsReference, needsChange) => {
        if (!needsReference && !needsChange) return;
        const prior = proposalScopeRequests.get(classId) || { classId, needsReference: false, needsChange: false };
        prior.needsReference ||= needsReference;
        prior.needsChange ||= needsChange;
        proposalScopeRequests.set(classId, prior);
      };
      for (const operation of raw.operations) {
        const sourceRef = operation.target;
        if (sourceRef?.kind === 'existing_class') {
          addScopeRequest(sourceRef.classId, !references.has(sourceRef.classId), !changeIds.includes(sourceRef.classId));
        }
        for (const ref of [sourceRef, operation.newParent]) {
          if (ref?.kind === 'existing_class' && !references.has(ref.classId)) addScopeRequest(ref.classId, true, false);
        }
      }
      if (proposalScopeRequests.size) {
        const requested = [...proposalScopeRequests.values()];
        requested.forEach((item) => {
          const prior = scopeRequests.get(item.classId) || { ...item };
          prior.needsReference ||= item.needsReference;
          prior.needsChange ||= item.needsChange;
          scopeRequests.set(item.classId, prior);
        });
        throw new Error('変更案に、まだ許可されていないクラス範囲が含まれています。');
      }
      const candidate = editor.applyOperations(operations, baseFingerprint, [...changeIds], [...references], {
        allowedTypes: ['addClass', 'renameClass', 'moveClass', 'promoteClass', 'deleteClass'],
        moveSourceTypes: ['top', 'middle', 'class'],
        allowDelete: true,
        requireAllDescendantsEditableForDelete: true,
        reparentDescendantsOnDelete: false,
        allowTargetRename: targetRenameEnabled
      });
      validated.push({
        proposal: raw,
        operations,
        candidate,
        baseFingerprint,
        dataVersion,
        editableIds: [...changeIds],
        availableIds: [...references],
        operationPolicy: {
          allowedTypes: ['addClass', 'renameClass', 'moveClass', 'promoteClass', 'deleteClass'],
          moveSourceTypes: ['top', 'middle', 'class'],
          allowDelete: true,
          requireAllDescendantsEditableForDelete: true,
          reparentDescendantsOnDelete: false,
          allowTargetRename: targetRenameEnabled
        }
      });
    } catch (error) {
      errors.push({ proposalId: raw?.id || null, reason: error.message });
    }
  }

  const groupIds = new Set();
  const groupMembership = new Set();
  const validatedIds = new Set(validated.map(({ proposal }) => proposal.id));
  const alternativeGroups = [];
  for (const group of response.alternativeGroups) {
    if (!record(group) || !only(group, ['id', 'proposalIds']) || !nonempty(group.id) || groupIds.has(group.id)
      || !Array.isArray(group.proposalIds) || group.proposalIds.length < 2 || group.proposalIds.length > 3) {
      errors.push({ proposalId: null, reason: '代替案グループの形式が不正です。' });
      continue;
    }
    groupIds.add(group.id);
    const uniqueIds = new Set(group.proposalIds);
    if (uniqueIds.size !== group.proposalIds.length || group.proposalIds.some((id) => !validatedIds.has(id))) {
      errors.push({ proposalId: null, reason: '代替案グループに重複または存在しない提案IDがあります。' });
      continue;
    }
    group.proposalIds.forEach((id) => {
      if (groupMembership.has(id)) errors.push({ proposalId: id, reason: '提案が複数の代替案グループに含まれています。' });
      groupMembership.add(id);
    });
    alternativeGroups.push({ ...group, proposalIds: [...group.proposalIds] });
  }

  const parentOf = (operation) => operation?.newParent?.kind === 'existing_class'
    ? operation.newParent.classId : operation?.newParent?.tempId || null;
  const targetOf = (operation) => operation?.target?.kind === 'existing_class'
    ? operation.target.classId : operation?.target?.tempId || null;
  const outcomeOf = (operation) => {
    if (operation.type.startsWith('move_')) return ['parent', parentOf(operation)];
    if (operation.type.startsWith('delete_')) return ['exists', false];
    if (operation.type.startsWith('rename_')) return ['label', String(operation.label || '').trim()];
    if (operation.type === 'promote_middle_class') return ['type', 'top'];
    return null;
  };
  const parents = validated.map((_, index) => index);
  const find = (index) => parents[index] === index ? index : (parents[index] = find(parents[index]));
  const union = (left, right) => { parents[find(right)] = find(left); };
  const conflictPairs = [];
  const currentFingerprint = JSON.stringify({ classes: state.classes, relations: state.relations });
  const combinedOperations = (entry, suffix) => {
    const aliases = new Map((entry.operations || []).filter((operation) => operation.type === 'addClass' && operation.temporaryId)
      .map((operation) => [operation.temporaryId, `${suffix}:${operation.temporaryId}`]));
    return entry.operations.map((operation) => {
      const copy = { ...operation };
      ['temporaryId', 'parentId', 'classId', 'destinationId'].forEach((key) => {
        if (aliases.has(copy[key])) copy[key] = aliases.get(copy[key]);
      });
      return copy;
    });
  };
  for (let left = 0; left < validated.length; left += 1) {
    for (let right = left + 1; right < validated.length; right += 1) {
      const a = validated[left].proposal.operations;
      const b = validated[right].proposal.operations;
      let conflict = a.some((first) => b.some((second) => {
        if (!targetOf(first) || targetOf(first) !== targetOf(second)) return false;
        const firstOutcome = outcomeOf(first);
        const secondOutcome = outcomeOf(second);
        return firstOutcome && secondOutcome && firstOutcome[0] === secondOutcome[0] && firstOutcome[1] !== secondOutcome[1];
      }));
      if (!conflict) {
        const aTargets = new Set(a.map(targetOf).filter(Boolean));
        const bTargets = new Set(b.map(targetOf).filter(Boolean));
        const aParents = new Set(a.map(parentOf).filter(Boolean));
        const bParents = new Set(b.map(parentOf).filter(Boolean));
        const mayInteract = [...aTargets].some((id) => bTargets.has(id) || bParents.has(id))
          || [...bTargets].some((id) => aParents.has(id));
        if (!mayInteract) continue;
        try {
          editor.applyOperations([
            ...combinedOperations(validated[left], `p${left}`),
            ...combinedOperations(validated[right], `p${right}`)
          ], currentFingerprint, [...changeIds], [...references], validated[left].operationPolicy);
        } catch { conflict = true; }
      }
      if (conflict) { union(left, right); conflictPairs.push([left, right]); }
    }
  }
  const conflictRoots = new Set(conflictPairs.map(([left]) => find(left)));
  const conflictComponents = new Map();
  validated.forEach((item, index) => {
    const root = find(index);
    if (!conflictRoots.has(root)) return;
    if (!conflictComponents.has(root)) conflictComponents.set(root, []);
    conflictComponents.get(root).push(item.proposal.id);
  });
  const detectedConflicts = [];
  let generatedGroupSequence = 1;
  conflictComponents.forEach((proposalIds) => {
    const overlapping = alternativeGroups.find((group) => group.proposalIds.some((id) => proposalIds.includes(id)));
    if (overlapping) {
      const unionIds = [...new Set([...overlapping.proposalIds, ...proposalIds])];
      overlapping.proposalIds = unionIds;
      detectedConflicts.push(overlapping);
    } else {
      while (groupIds.has(`conflict_${generatedGroupSequence}`)) generatedGroupSequence += 1;
      const id = `conflict_${generatedGroupSequence++}`;
      groupIds.add(id);
      detectedConflicts.push({ id, proposalIds });
    }
  });
  for (const group of detectedConflicts) {
    if (group.proposalIds.length > 3) {
      validated.filter((item) => group.proposalIds.includes(item.proposal.id)).forEach((item) => {
        const index = validated.indexOf(item);
        validated.splice(index, 1);
        errors.push({ proposalId: item.proposal.id, reason: '競合する提案が4件以上あるため、安全に選択肢へまとめられず保留しました。' });
      });
      group.proposalIds = [];
    }
  }
  const usableConflictGroups = detectedConflicts.filter((group) => group.proposalIds.length >= 2);
  for (const group of usableConflictGroups) {
    group.proposalIds.forEach((id) => {
      if (groupMembership.has(id)) return;
      groupMembership.add(id);
    });
    if (!alternativeGroups.some((item) => item.id === group.id)) alternativeGroups.push(group);
  }
  const finalProposalIds = new Set(validated.map((item) => item.proposal.id));
  for (let index = alternativeGroups.length - 1; index >= 0; index -= 1) {
    const group = alternativeGroups[index];
    group.proposalIds = group.proposalIds.filter((id) => finalProposalIds.has(id));
    if (group.proposalIds.length < 2) alternativeGroups.splice(index, 1);
  }

  return { message: response.message, proposals: validated, alternativeGroups, blocked: errors, scopeRequests: [...scopeRequests.values()] };
}
