// 回答モードと分割タスクから、許可する操作を一元的に決めます。
const ALL_OPERATIONS = ['addClass', 'renameClass', 'moveClass', 'moveChildren', 'promoteClass', 'deleteClass'];

export const createOperationPolicy = ({ allowProposals = true, taskKind = 'selected_scope', scope = {}, proposalFreedom = 5 }) => {
  let allowedTypes = allowProposals ? [...ALL_OPERATIONS] : [];
  let addClassTypes = ['top', 'middle'];
  let moveSourceTypes = ['top', 'middle', 'class'];
  let allowDelete = allowedTypes.includes('deleteClass');

  if (taskKind === 'upper_class_unit' || taskKind === 'upper_class_targets') {
    allowedTypes = allowedTypes.filter((type) => ['addClass', 'moveClass', ...(taskKind === 'upper_class_unit' && scope.allowHierarchyEdits ? ['renameClass', 'moveChildren', 'promoteClass', 'deleteClass'] : [])].includes(type));
    addClassTypes = ['middle'];
    moveSourceTypes = taskKind === 'upper_class_unit' && scope.allowHierarchyEdits
      ? ['top', 'middle', 'class'] : ['class'];
    allowDelete = taskKind === 'upper_class_unit' && Boolean(scope.allowHierarchyEdits) && allowDelete;
  } else if (taskKind === 'hierarchy') {
    moveSourceTypes = ['top', 'middle'];
    allowedTypes = allowedTypes.filter((type) => type !== 'deleteClass' || allowDelete);
  } else if (taskKind === 'cross_scope') {
    if (!scope.allowHierarchyEdits) {
      // Cross-scope synthesis explicitly must not change hierarchy nodes when
      // hierarchy editing is outside the selected scope.
      allowedTypes = allowedTypes.filter((type) => type === 'moveClass');
      addClassTypes = [];
      moveSourceTypes = ['class'];
      allowDelete = false;
    }
  } else {
    allowedTypes = allowedTypes.filter((type) => type !== 'deleteClass' || allowDelete);
  }

  return {
    taskKind,
    allowProposals,
    allowedTypes,
    addClassTypes,
    moveSourceTypes,
    allowDelete,
    requireAllDescendantsEditableForDelete: proposalFreedom !== 1,
    reparentDescendantsOnDelete: proposalFreedom === 1
  };
};

export const describeOperationPolicy = (policy) => {
  if (!policy?.allowProposals || !policy.allowedTypes.length) return '変更案は作成せず、評価と説明だけを返してください。';
  const instructions = [];
  if (policy.allowedTypes.includes('addClass')) {
    const types = policy.addClassTypes.map((type) => type === 'top' ? '上位クラス' : '中間クラス');
    instructions.push(`${types.join('・')}を追加できます`);
  }
  if (policy.allowedTypes.includes('renameClass')) instructions.push('既存クラスを改名できます');
  if (policy.allowedTypes.includes('moveClass')) {
    const sources = policy.moveSourceTypes.map((type) => type === 'top' ? '上位クラス' : type === 'middle' ? '中間クラス' : '対象クラス');
    instructions.push(`${sources.join('・')}を移動できます`);
  }
  if (policy.allowedTypes.includes('moveChildren')) instructions.push('中間クラスの子をまとめて移動できます');
  if (policy.allowedTypes.includes('promoteClass')) instructions.push('中間クラスを上位クラスへ移せます');
  if (policy.allowedTypes.includes('deleteClass')) instructions.push('クラスを削除できます');
  return `この範囲で許可する操作: ${instructions.join('。')}。`;
};

export const operationAllowedByPolicy = (operation, policy, classesById, editableIds) => {
  if (!operation) return false;
  if (operation.type === 'moveClass' && !policy?.allowedTypes?.includes('moveClass')) {
    const source = classesById.get(operation.classId);
    const destination = classesById.get(operation.destinationId);
    const dependentMove = policy?.allowedTypes?.includes('addClass')
      && policy.addClassTypes.includes('middle')
      && source?.type === 'class'
      && editableIds.has(operation.classId)
      && destination?.type === 'middle'
      && String(operation.destinationId || '').startsWith('tmp_');
    if (dependentMove) return true;
  }
  if (!policy?.allowedTypes?.includes(operation.type)) return false;
  if (operation.type === 'addClass') return policy.addClassTypes.includes(operation.classType);
  if (operation.type === 'deleteClass') {
    const sourceType = classesById.get(operation.classId)?.type;
    return policy.allowDelete && editableIds.has(operation.classId)
      && ['top', 'middle'].includes(sourceType) && policy.moveSourceTypes.includes(sourceType);
  }
  if (operation.type === 'renameClass') {
    const sourceType = classesById.get(operation.classId)?.type;
    return editableIds.has(operation.classId)
      && ['top', 'middle'].includes(sourceType) && policy.moveSourceTypes.includes(sourceType);
  }
  if (operation.type === 'promoteClass') return editableIds.has(operation.classId)
    && classesById.get(operation.classId)?.type === 'middle' && policy.moveSourceTypes.includes('middle');
  if (operation.type === 'moveClass') {
    const source = classesById.get(operation.classId);
    return editableIds.has(operation.classId) && policy.moveSourceTypes.includes(source?.type);
  }
  if (operation.type === 'moveChildren') return editableIds.has(operation.from)
    && classesById.get(operation.from)?.type === 'middle'
    && policy.moveSourceTypes.includes('middle');
  return true;
};

const normalizeOperationSequence = (operations = []) => {
  const aliases = new Map(operations.filter((operation) => operation.type === 'addClass' && operation.temporaryId)
    .map((operation, index) => [operation.temporaryId, `temporary_${index + 1}`]));
  const normalizeId = (id) => aliases.get(id) || id || null;
  return operations.map((operation) => {
    return {
      type: operation.type || null,
      classType: operation.classType || null,
      temporaryId: operation.temporaryId ? normalizeId(operation.temporaryId) : null,
      label: operation.label || null,
      parentId: normalizeId(operation.parentId),
      classId: normalizeId(operation.classId),
      destinationId: normalizeId(operation.destinationId),
      from: normalizeId(operation.from),
      to: normalizeId(operation.to)
    };
  });
};

const affectedClassIds = (operation, classesById, childrenByParent) => {
  if (operation.type === 'moveChildren') {
    return new Set(childrenByParent.get(operation.from) || []);
  }
  const sourceId = operation.classId || '';
  if (sourceId && classesById.has(sourceId)) return new Set([sourceId]);
  if (operation.type === 'addClass') return new Set([`new:${operation.classType || ''}:${operation.parentId || ''}:${operation.label || ''}`]);
  return new Set();
};

const mergeProposalRationale = (target, source) => {
  const additionalReason = String(source.reason || source.summary || '').trim();
  const reasonLabel = source.sourceType === 'cross_scope' ? '横断確認' : '別範囲確認';
  if (additionalReason && !String(target.reason || '').includes(additionalReason)) {
    target.reason = [target.reason, `${reasonLabel}: ${additionalReason}`].filter(Boolean).join('\n\n');
  }
  target.uncertainties = [...new Set([...(target.uncertainties || []), ...(source.uncertainties || [])])];
  target.questions = [...new Set([...(target.questions || []), ...(source.questions || [])])];
  if (source.alternativeGroupId) target.alternativeGroupId = source.alternativeGroupId;
  if (target.sourceType !== source.sourceType
    && [target.sourceType, source.sourceType].includes('cross_scope')) target.sourceType = 'combined';
};

export const composeProposalOperations = (proposal, selectedChoices = {}, previewChoice = null) => {
  const operations = [...(proposal?.operations || [])];
  (proposal?.conflictGroups || []).forEach((group) => {
    const preview = previewChoice?.groupId === group.id ? previewChoice.choiceIndex : undefined;
    const selected = selectedChoices[group.id];
    const choiceIndex = Number.isInteger(preview) ? preview : Number.isInteger(selected) ? selected : 0;
    const choice = group.choices?.[choiceIndex];
    if (choice) operations.push(...choice.operations);
  });
  return operations;
};

export const conflictChoicesComplete = (proposal, selectedChoices = {}) => (proposal?.conflictGroups || []).every((group) =>
  Number.isInteger(selectedChoices[group.id]) && selectedChoices[group.id] >= 0
    && selectedChoices[group.id] < (group.choices || []).length);

export const buildQuestionQueue = ({ questions = [], proposals = [], maximum = 0, deduplicate = (items) => items }) => {
  const limit = Math.max(0, Math.floor(Number(maximum) || 0));
  const queuedQuestions = deduplicate(questions).slice(0, limit)
    .map((text) => ({ text, proposalTitle: '', proposalId: '' }));
  const queuedProposals = [];
  const omittedProposals = [];
  proposals.forEach((proposal) => {
    const proposalQuestions = deduplicate(proposal.questions || []);
    if (proposalQuestions.length > limit - queuedQuestions.length) {
      omittedProposals.push(proposal);
      return;
    }
    proposal.questions = proposalQuestions;
    proposalQuestions.forEach((text) => queuedQuestions.push({
      text,
      proposalTitle: proposal.title,
      proposalId: proposal.id
    }));
    queuedProposals.push(proposal);
  });
  return { queuedQuestions, queuedProposals, omittedProposals };
};

export const reconcileSplitProposals = (chunkProposals, crossScopeProposals, classes, relations) => {
  const result = [];
  const canonical = new Map();
  const addOrMerge = (proposal, sourceType) => {
    proposal.sourceType = sourceType;
    const key = JSON.stringify(normalizeOperationSequence(proposal.operations));
    const duplicate = canonical.get(key);
    if (duplicate) {
      mergeProposalRationale(duplicate, proposal);
      return;
    }
    canonical.set(key, proposal);
    result.push(proposal);
  };
  chunkProposals.forEach((proposal) => {
    const sourceType = proposal.sourceType || 'chunk';
    if (proposal.operations?.length) addOrMerge(proposal, sourceType);
    else { proposal.sourceType = sourceType; result.push(proposal); }
  });
  crossScopeProposals.filter((proposal) => proposal.operations?.length).forEach((proposal, index) => {
    if (!proposal.id) proposal.id = `cross_scope_proposal_${index + 1}`;
    addOrMerge(proposal, proposal.sourceType || 'cross_scope');
  });

  const classesById = new Map(classes.map((item) => [item.id, item]));
  const childrenByParent = new Map();
  relations.forEach(({ child, parent }) => {
    if (!childrenByParent.has(parent)) childrenByParent.set(parent, []);
    childrenByParent.get(parent).push(child);
  });
  const bundles = [];
  result.forEach((proposal, proposalIndex) => {
    const originalOperations = proposal.operations || [];
    const temporaryIdAliases = new Map(originalOperations
      .filter((operation) => operation.type === 'addClass' && operation.temporaryId)
      .map((operation) => [operation.temporaryId, `temporary:${proposal.id || proposalIndex}:${operation.temporaryId}`]));
    const operations = originalOperations.map((operation) => {
      const normalized = { ...operation };
      ['temporaryId', 'parentId', 'classId', 'destinationId', 'from', 'to'].forEach((key) => {
        if (temporaryIdAliases.has(normalized[key])) normalized[key] = temporaryIdAliases.get(normalized[key]);
      });
      return normalized;
    });
    const affected = operations.map((operation) => affectedClassIds(operation, classesById, childrenByParent));
    const parents = operations.map((operation, index) => index);
    const find = (index) => parents[index] === index ? index : (parents[index] = find(parents[index]));
    const union = (left, right) => { parents[find(right)] = find(left); };
    const temporaryIds = operations.filter((operation) => operation.type === 'addClass' && operation.temporaryId)
      .map((operation) => operation.temporaryId);
    operations.forEach((operation, index) => {
      const refs = ['temporaryId', 'classId', 'destinationId', 'parentId', 'from', 'to'].map((key) => operation[key]).filter(Boolean);
      operations.forEach((other, otherIndex) => {
        if (otherIndex <= index) return;
        const otherRefs = ['temporaryId', 'classId', 'destinationId', 'parentId', 'from', 'to'].map((key) => other[key]).filter(Boolean);
        const sharesTemporaryDependency = refs.some((id) => temporaryIds.includes(id) && otherRefs.includes(id));
        if (sharesTemporaryDependency) union(index, otherIndex);
      });
    });
    const byRoot = new Map();
    operations.forEach((operation, operationIndex) => {
      const root = find(operationIndex);
      if (!byRoot.has(root)) byRoot.set(root, { proposalIndex, proposal, operations: [], operationIndexes: [], affectedIds: new Set() });
      const bundle = byRoot.get(root);
      bundle.operations.push(operation);
      bundle.operationIndexes.push(operationIndex);
      affected[operationIndex].forEach((id) => bundle.affectedIds.add(id));
    });
    byRoot.forEach((bundle) => bundles.push(bundle));
  });

  const operationOutcomes = (operation) => {
    if (operation.type === 'deleteClass') return [['exists', false]];
    if (operation.type === 'renameClass') return [['label', String(operation.label || '').trim()]];
    if (operation.type === 'moveClass') return [['parent', operation.destinationId || '']];
    if (operation.type === 'moveChildren') return [['parent', operation.to || '']];
    if (operation.type === 'promoteClass') return [['type', 'top'], ['parent', '']];
    return [];
  };
  const operationsConflict = (left, right, sharedClassIds) => {
    const deletedClassId = left.type === 'deleteClass' ? left.classId
      : right.type === 'deleteClass' ? right.classId : null;
    const otherOperation = left.type === 'deleteClass' ? right : left;
    if (deletedClassId && ['parentId', 'destinationId', 'from', 'to'].some((key) => otherOperation[key] === deletedClassId)) return true;

    return sharedClassIds.some((id) => {
      const leftAffectsClass = left.type === 'moveChildren'
        ? (childrenByParent.get(left.from) || []).includes(id)
        : left.classId === id;
      const rightAffectsClass = right.type === 'moveChildren'
        ? (childrenByParent.get(right.from) || []).includes(id)
        : right.classId === id;
      if (!leftAffectsClass || !rightAffectsClass) return false;
      if (left.type === 'deleteClass' || right.type === 'deleteClass') return left.type !== right.type;
      const rightOutcomes = new Map(operationOutcomes(right));
      return operationOutcomes(left).some(([key, value]) => rightOutcomes.has(key) && rightOutcomes.get(key) !== value);
    });
  };

  const parents = bundles.map((_, index) => index);
  const find = (index) => parents[index] === index ? index : (parents[index] = find(parents[index]));
  const union = (left, right) => { parents[find(right)] = find(left); };
  for (let left = 0; left < bundles.length; left += 1) {
    for (let right = left + 1; right < bundles.length; right += 1) {
      const a = bundles[left]; const b = bundles[right];
      if (a.proposalIndex === b.proposalIndex) continue;
      const sharedClassIds = [...a.affectedIds].filter((id) => b.affectedIds.has(id));
      const competingOperations = a.operations.some((operation) => b.operations.some((other) =>
        operationsConflict(operation, other, sharedClassIds)));
      if (competingOperations) union(left, right);
    }
  }
  const conflictComponents = new Map();
  bundles.forEach((bundle, index) => {
    const root = find(index);
    if (!conflictComponents.has(root)) conflictComponents.set(root, []);
    conflictComponents.get(root).push(bundle);
  });
  const conflicts = [...conflictComponents.values()].filter((component) =>
    new Set(component.map((bundle) => bundle.proposalIndex)).size > 1
      && !component.some((bundle) => bundle.proposal.questions?.length));
  if (!conflicts.length) return result;

  let combinedTemporarySequence = 0;
  const canonicalizeTemporaryOperations = (operations) => {
    const aliases = new Map();
    const additionKeys = new Map();
    operations.forEach((operation) => {
      if (operation.type !== 'addClass' || !operation.temporaryId) return;
      const parentId = aliases.get(operation.parentId) || operation.parentId || '';
      const key = `${operation.classType || ''}\u0000${String(operation.label || '').trim()}\u0000${parentId}`;
      if (additionKeys.has(key)) aliases.set(operation.temporaryId, additionKeys.get(key));
      else {
        const canonicalId = `combined_tmp_${++combinedTemporarySequence}`;
        additionKeys.set(key, canonicalId);
        aliases.set(operation.temporaryId, canonicalId);
      }
    });
    return operations.map((operation) => {
      const normalized = { ...operation };
      ['temporaryId', 'parentId', 'classId', 'destinationId', 'from', 'to'].forEach((key) => {
        if (aliases.has(normalized[key])) normalized[key] = aliases.get(normalized[key]);
      });
      return normalized;
    });
  };
  const conflictGroups = [];
  const conflictingBundles = new Set();
  const combinedBundles = new Set();
  conflicts.forEach((component) => {
    component.forEach((bundle) => combinedBundles.add(bundle));
    const byProposal = new Map();
    component.forEach((bundle) => {
      if (!byProposal.has(bundle.proposalIndex)) byProposal.set(bundle.proposalIndex, { proposal: bundle.proposal, operations: [] });
      byProposal.get(bundle.proposalIndex).operations.push(...bundle.operations);
    });
    const uniqueChoices = new Map();
    [...byProposal.values()].forEach(({ proposal, operations }) => {
      const key = JSON.stringify(normalizeOperationSequence(operations));
      const existing = uniqueChoices.get(key);
      if (existing) {
        const rationale = proposal.reason || proposal.summary || proposal.title || '';
        if (rationale && !existing.reason.includes(rationale)) existing.reason = [existing.reason, rationale].filter(Boolean).join('\n\n');
        return;
      }
      uniqueChoices.set(key, {
        label: proposal.title || proposal.summary || '変更案',
        summary: proposal.summary || proposal.title || '',
        reason: proposal.reason || '',
        operations: canonicalizeTemporaryOperations(operations)
      });
    });
    const choices = [...uniqueChoices.values()];
    if (choices.length > 1) {
      conflictGroups.push({ id: `conflict_${conflictGroups.length + 1}`, label: `競合箇所${conflictGroups.length + 1}`, choices });
      component.forEach((bundle) => conflictingBundles.add(bundle));
    }
  });
  if (!combinedBundles.size) return result;
  const involvedIndexes = new Set([...combinedBundles].map((bundle) => bundle.proposalIndex));
  const removedIndexesByProposal = new Map();
  conflictingBundles.forEach((bundle) => {
    if (!removedIndexesByProposal.has(bundle.proposalIndex)) removedIndexesByProposal.set(bundle.proposalIndex, new Set());
    bundle.operationIndexes.forEach((index) => removedIndexesByProposal.get(bundle.proposalIndex).add(index));
  });
  const sourceProposals = [...involvedIndexes].map((index) => result[index]);
  const sourceProposalIds = sourceProposals.map((proposal) => proposal.id).filter(Boolean);
  const conflictsProposal = {
    id: `conflict_candidates_${sourceProposalIds.join('_') || '1'}`,
    title: '競合する変更候補',
    summary: '同じクラスに対する競合候補を選択できます。',
    reason: sourceProposals.map((proposal) => proposal.reason || proposal.summary || proposal.title).filter(Boolean).join('\n\n'),
    uncertainties: [...new Set(sourceProposals.flatMap((proposal) => proposal.uncertainties || []))],
    questions: [],
    operations: [],
    conflictGroups,
    sourceProposalIds,
    sourceType: 'combined'
  };
  const residualProposalsByIndex = new Map([...involvedIndexes].map((index) => {
    const source = result[index];
    const removedIndexes = removedIndexesByProposal.get(index) || new Set();
    const operations = (source.operations || []).filter((_, operationIndex) => !removedIndexes.has(operationIndex));
    return [index, operations.length ? { ...source, operations } : null];
  }));
  const commonOperationKeys = new Set();
  conflictsProposal.operations = [...residualProposalsByIndex.values()]
    .filter(Boolean)
    .flatMap((proposal) => canonicalizeTemporaryOperations(proposal.operations))
    .filter((operation) => {
      const key = JSON.stringify(operation);
      if (commonOperationKeys.has(key)) return false;
      commonOperationKeys.add(key);
      return true;
    });

  const insertionIndex = Math.min(...involvedIndexes);
  const reconciled = [];
  result.forEach((proposal, index) => {
    if (index === insertionIndex) reconciled.push(conflictsProposal);
    if (!involvedIndexes.has(index)) reconciled.push(proposal);
  });
  return reconciled;
};

// AI応答を内部形式で検証し、操作の安全性を確認します。
// モデルの出力は検証が完了するまで編集データへ適用しません。
export const createResponseHandler = ({ editor, AI_OUTPUT_LIMITS, deduplicateQuestions }) => {
  const validatePayload = (result, expectedHash) => {
    if (!result || typeof result !== 'object' || Array.isArray(result)) {
      throw new Error('AIの応答がJSONオブジェクトではありません。提案は適用できません。');
    }
    if (!Array.isArray(result.proposals) || !Array.isArray(result.questions)) {
      throw new Error('AIの応答に提案または確認事項の一覧がありません。もう一度依頼してください。');
    }
    result.questions = deduplicateQuestions(result.questions);
    // Old cached split responses may still contain this property. Ignore it.
    result.dataRequests = [];
    // The browser owns the data fingerprint; asking the model to echo it can
    // produce harmless character errors that incorrectly invalidate a proposal.
    result.baseDataHash = expectedHash;
    const proposalIds = new Set();
    result.proposals.forEach((proposal) => {
      if (!proposal || typeof proposal.title !== 'string' || !Array.isArray(proposal.operations)
        || !Array.isArray(proposal.questions) || !Array.isArray(proposal.uncertainties)
        || !proposal.id || proposalIds.has(proposal.id)) throw new Error('AIの提案形式が不正です。提案は適用できません。');
      proposalIds.add(proposal.id);
      proposal.operations.forEach((operation) => {
        if (!operation || !ALL_OPERATIONS.includes(operation.type)) throw new Error('許可されていない操作を含む提案です。適用できません。');
      });
    });
    result.proposals.forEach((proposal) => {
      const temporaryIds = new Map(proposal.operations.filter((operation) => operation.type === 'addClass' && operation.temporaryId)
        .map((operation) => [operation.temporaryId, `${proposal.id}/${operation.temporaryId}`]));
      proposal.operations.forEach((operation) => {
        ['temporaryId', 'parentId', 'classId', 'destinationId', 'from', 'to'].forEach((key) => {
          if (temporaryIds.has(operation[key])) operation[key] = temporaryIds.get(operation[key]);
        });
      });
    });
  };
  const suppressNoopMoveOperations = (result, scope) => {
    const originalProposalCount = result.proposals.length;
    const initiallyHadMoves = result.proposals.some((proposal) => proposal.operations.some((operation) => ['moveClass', 'moveChildren'].includes(operation.type)));
    // 選択範囲に親クラスが含まれない場合も、実データを使って現在の親を判定する。
    const currentRelations = editor.getState()?.relations || scope.relations || [];
    const currentParentByChild = new Map(currentRelations.map(({ child, parent }) => [child, parent]));
    const currentLabels = new Map((editor.getState()?.classes || scope.classes || []).map(({ id, label }) => [id, label]));
    result.proposals.forEach((proposal) => {
      const parentByChild = new Map(currentParentByChild);
      const labelsById = new Map(currentLabels);
      const visiblePath = (id) => {
        const parts = [];
        const seen = new Set();
        let currentId = id;
        while (currentId && !seen.has(currentId)) {
          seen.add(currentId);
          parts.unshift(labelsById.get(currentId) || currentId);
          currentId = parentByChild.get(currentId);
        }
        return parts.join(' › ');
      };
      const createsCycle = (sourceId, destinationId) => {
        let currentId = destinationId;
        const seen = new Set();
        while (currentId && !seen.has(currentId)) {
          if (currentId === sourceId) return true;
          seen.add(currentId);
          currentId = parentByChild.get(currentId);
        }
        return false;
      };
      let removedMoveCount = 0;
      proposal.operations = proposal.operations.filter((operation) => {
        if (operation.type === 'addClass') {
          labelsById.set(operation.temporaryId, String(operation.label || '').trim());
          if (operation.classType === 'middle' && operation.parentId) parentByChild.set(operation.temporaryId, operation.parentId);
          return true;
        }
        if (operation.type === 'moveClass') {
          const currentParent = parentByChild.get(operation.classId);
          const sameVisibleParentPath = currentParent && visiblePath(currentParent) === visiblePath(operation.destinationId);
          if (currentParent === operation.destinationId || sameVisibleParentPath || createsCycle(operation.classId, operation.destinationId)) {
            removedMoveCount += 1;
            return false;
          }
          parentByChild.set(operation.classId, operation.destinationId);
          return true;
        }
        if (operation.type === 'moveChildren') {
          const children = [...parentByChild]
            .filter(([, parent]) => parent === operation.from)
            .map(([child]) => child);
          const sameVisibleParentPath = visiblePath(operation.from) === visiblePath(operation.to);
          if (!children.length || operation.from === operation.to || sameVisibleParentPath || createsCycle(operation.from, operation.to)
            || children.every((child) => parentByChild.get(child) === operation.to)) {
            removedMoveCount += 1;
            return false;
          }
          children.forEach((child) => parentByChild.set(child, operation.to));
        }
        return true;
      });
      const noopWarning = '親のIDまたは表示上の経路が変わらない移動、または循環を作る移動先は除外しました。';
      if (removedMoveCount && proposal.uncertainties.length < AI_OUTPUT_LIMITS.uncertaintiesPerProposal
        && !proposal.uncertainties.includes(noopWarning)) {
        proposal.uncertainties.push(noopWarning);
      }
    });
    result.proposals = result.proposals.filter((proposal) => proposal.operations.length || proposal.questions.length);
    if (initiallyHadMoves && result.proposals.length < originalProposalCount
      && !result.proposals.some((proposal) => proposal.operations.length)) {
      result.message = [result.message, '親子関係が変わらない移動案は表示しませんでした。'].filter(Boolean).join('\n\n');
    }
  };
  const normalizeDuplicateClassOperations = (result, availableIds = []) => {
    const state = editor.getState();
    const classById = new Map(state.classes.map((item) => [item.id, item]));
    const parentByChild = new Map(state.relations.map(({ child, parent }) => [child, parent]));
    const available = new Set(availableIds);
  result.questions ||= [];
  const clarificationQuestions = new Set();
  const addClarification = (text) => {
    if (text) clarificationQuestions.add(text);
  };
    result.proposals.forEach((proposal) => {
      const aliases = new Map();
      const unavailableDuplicateIds = new Set();
      const ambiguousDuplicateIds = new Set();
      const additionsByTypeAndLabel = new Map();
      proposal.operations.forEach((operation) => {
        if (operation.type !== 'addClass' || !operation.temporaryId || !['top', 'middle'].includes(operation.classType)) return;
        const label = String(operation.label || '').trim();
        const key = `${operation.classType}\u0000${label}`;
        const matches = state.classes.filter((item) => item.type === operation.classType
          && String(item.label || '').trim() === label);
        const availableMatches = matches.filter((item) => available.has(item.id));
        let existing = null;
        if (availableMatches.length === 1) existing = availableMatches[0];
        else if (availableMatches.length > 1 && operation.parentId) {
          const parentMatches = availableMatches.filter((item) => parentByChild.get(item.id) === operation.parentId);
          if (parentMatches.length === 1) existing = parentMatches[0];
          else ambiguousDuplicateIds.add(operation.temporaryId);
        } else if (!matches.length && additionsByTypeAndLabel.has(key)) {
          aliases.set(operation.temporaryId, additionsByTypeAndLabel.get(key));
        } else if (!matches.length) additionsByTypeAndLabel.set(key, operation.temporaryId);
        else if (availableMatches.length === 0) unavailableDuplicateIds.add(operation.temporaryId);
        if (existing) aliases.set(operation.temporaryId, existing.id);
      });
      const resolveAlias = (id) => {
        const seen = new Set();
        let resolved = id;
        while (aliases.has(resolved) && !seen.has(resolved)) {
          seen.add(resolved);
          resolved = aliases.get(resolved);
        }
        return resolved;
      };
      if (aliases.size) {
        proposal.operations = proposal.operations
          .filter((operation) => !(operation.type === 'addClass' && aliases.has(operation.temporaryId)))
          .map((operation) => {
            const normalized = { ...operation };
            ['parentId', 'classId', 'destinationId', 'from', 'to'].forEach((key) => {
              if (normalized[key]) normalized[key] = resolveAlias(normalized[key]);
            });
            return normalized;
          });
        if (proposal.uncertainties.length < AI_OUTPUT_LIMITS.uncertaintiesPerProposal
          && !proposal.uncertainties.includes('同じ種類・名称のクラスが既にあるため、新設せず既存クラスを再利用します。')) {
          proposal.uncertainties.push('同じ種類・名称のクラスが既にあるため、新設せず既存クラスを再利用します。');
        }
      }
      if (unavailableDuplicateIds.size || ambiguousDuplicateIds.size) {
        let addedBlockedId = true;
        while (addedBlockedId) {
          addedBlockedId = false;
          proposal.operations.forEach((operation) => {
            const blockedIds = new Set([...unavailableDuplicateIds, ...ambiguousDuplicateIds]);
            if (operation.type === 'addClass' && operation.temporaryId && blockedIds.has(operation.parentId)
              && !blockedIds.has(operation.temporaryId)) {
              ambiguousDuplicateIds.add(operation.temporaryId);
              addedBlockedId = true;
            }
          });
        }
        const blockedIds = new Set([...unavailableDuplicateIds, ...ambiguousDuplicateIds]);
        const blockedAdditions = proposal.operations.filter((operation) => operation.type === 'addClass'
          && blockedIds.has(operation.temporaryId));
        const referencesBlockedDuplicate = (operation) => ['temporaryId', 'parentId', 'classId', 'destinationId', 'from', 'to']
          .some((key) => blockedIds.has(operation[key]));
        proposal.operations = proposal.operations.filter((operation) => !referencesBlockedDuplicate(operation));
        const warning = ambiguousDuplicateIds.size
          ? '同じ種類・名称のクラスが複数あり、親階層から再利用先を一意に決められないため、関連操作を除外しました。'
          : '同名クラスは存在しますが選択範囲外のため、そのクラスに依存する操作を除外しました。';
        if (proposal.uncertainties.length < AI_OUTPUT_LIMITS.uncertaintiesPerProposal && !proposal.uncertainties.includes(warning)) {
          proposal.uncertainties.push(warning);
        }
        const labels = [...new Set(blockedAdditions.map((operation) => String(operation.label || '').trim()).filter(Boolean))];
        addClarification(ambiguousDuplicateIds.size
          ? `同名クラス${labels.length ? `「${labels.join('」「')}」` : ''}の再利用先を親階層から一意に決められません。どの親階層のクラスを使うか指定しますか？`
          : `同名クラス${labels.length ? `「${labels.join('」「')}」` : ''}は選択範囲外です。既存クラスを選んで使うか、新しいクラスを作るか指定しますか？`);
      }
      const duplicateRenameIndexes = new Set();
      proposal.operations.forEach((operation, index) => {
        if (operation.type !== 'renameClass') return;
        const item = classById.get(operation.classId);
        const label = String(operation.label || '').trim();
        if (!item || !label) return;
        const duplicate = state.classes.find((candidate) => available.has(candidate.id)
          && candidate.id !== item.id && candidate.type === item.type
          && String(candidate.label || '').trim() === label);
        const duplicateAddition = proposal.operations.some((candidate) => candidate.type === 'addClass'
          && candidate.classType === item.type && String(candidate.label || '').trim() === label);
        if (duplicate || duplicateAddition) duplicateRenameIndexes.add(index);
      });
      if (duplicateRenameIndexes.size) {
        const duplicateNames = [...new Set([...duplicateRenameIndexes].map((index) => String(proposal.operations[index]?.label || '').trim()).filter(Boolean))];
        proposal.operations = proposal.operations.filter((_, index) => !duplicateRenameIndexes.has(index));
        if (proposal.uncertainties.length < AI_OUTPUT_LIMITS.uncertaintiesPerProposal) {
          proposal.uncertainties.push('改名先と同じ種類・名称のクラスが既にあるため、その改名操作を除外しました。');
        }
        addClarification(`改名先と同名のクラス${duplicateNames.length ? `「${duplicateNames.join('」「')}」` : ''}があります。既存クラスを使うか、別の名前にするか指定しますか？`);
      }
      const seenOperations = new Set();
      proposal.operations = proposal.operations.filter((operation) => {
        const key = JSON.stringify(normalizeOperationSequence([operation])[0]);
        if (seenOperations.has(key)) return false;
        seenOperations.add(key);
        return true;
      });
    });
    if (clarificationQuestions.size) {
      const questions = [...clarificationQuestions];
      result.questions.push(questions.length === 1 ? questions[0]
        : `既存クラスの再利用先など、確認が必要な点があります。${questions.slice(0, 3).join(' ')}${questions.length > 3 ? ` ほか${questions.length - 3}件も確認できます。` : ''}`);
    }
  };
  const enforceOperationPolicy = (result, scope, policy) => {
    if (!policy?.allowProposals) {
      result.proposals = [];
      result.questions = [];
      result.excludedOperations = [];
      return 0;
    }
    const currentRelations = editor.getState()?.relations || scope.relations || [];
    const editableIds = new Set(scope.editableIds || []);
    const classesById = new Map([...(editor.getState()?.classes || []), ...(scope.classes || [])].map((item) => [item.id, item]));
    const childrenByParent = new Map();
    currentRelations.forEach(({ child, parent }) => {
      if (!childrenByParent.has(parent)) childrenByParent.set(parent, []);
      childrenByParent.get(parent).push(child);
    });
    const hasUneditableDescendant = (id) => {
      const queue = [...(childrenByParent.get(id) || [])];
      const seen = new Set();
      while (queue.length) {
        const childId = queue.pop();
        if (seen.has(childId)) continue;
        seen.add(childId);
        if (!editableIds.has(childId)) return true;
        queue.push(...(childrenByParent.get(childId) || []));
      }
      return false;
    };
    let totalRemovedCount = 0;
    const excludedOperations = [];
    const clarificationDetails = [];
    const current = editor.getState();
    const fingerprint = JSON.stringify({ classes: current.classes, relations: current.relations });
    result.proposals.forEach((proposal) => {
      const proposalClassesById = new Map(classesById);
      const proposalEditableIds = new Set(editableIds);
      proposal.operations.forEach((operation) => {
        if (operation.type === 'addClass' && operation.temporaryId && operation.classType) {
          proposalClassesById.set(operation.temporaryId, { id: operation.temporaryId, type: operation.classType, label: operation.label });
          proposalEditableIds.add(operation.temporaryId);
        }
      });
      let removedCount = 0;
      const proposalExclusions = [];
      proposal.operations = proposal.operations.filter((operation) => {
        const allowedByPolicy = operationAllowedByPolicy(operation, policy, proposalClassesById, proposalEditableIds);
        const hasUnselectedDescendant = operation.type === 'deleteClass' && policy.requireAllDescendantsEditableForDelete
          && hasUneditableDescendant(operation.classId);
        const allowed = allowedByPolicy && !hasUnselectedDescendant;
        if (!allowed) {
          removedCount += 1;
          const reason = hasUnselectedDescendant
            ? '削除対象の配下に未選択のクラスがあります。配下を含めて選択してください。'
            : `${operation.type || '不明'}は今回の依頼または編集範囲で許可されていません。`;
          const excluded = { proposal: proposal.title || proposal.summary || proposal.id,
            type: operation.type || '不明', classId: operation.classId || operation.from || '', reason };
          excludedOperations.push(excluded);
          proposalExclusions.push(excluded);
        } else if (operation.type === 'deleteClass' && policy.reparentDescendantsOnDelete
          && (childrenByParent.get(operation.classId) || []).length) {
          const reparentNotice = '配下クラスは削除せず、削除対象の階層に応じて移動・上位化します。適用前にプレビューで移動結果を確認してください。';
          if (!proposal.uncertainties.includes(reparentNotice)) proposal.uncertainties.push(reparentNotice);
        }
        return allowed;
      });
      totalRemovedCount += removedCount;
      if (removedCount) {
        const examples = proposalExclusions.slice(0, 3)
          .map((item) => `${item.classId || item.type}（${item.reason}）`).join(' ');
        const remainingCount = Math.max(0, proposalExclusions.length - 3);
        const warning = `一部の操作を保留しました: ${examples}${remainingCount ? ` ほか${remainingCount}件` : ''}。対象範囲や変更方針を調整しますか？`;
        clarificationDetails.push(warning);
        proposal.uncertainties.push(warning);
      }
      if (proposal.operations.length) {
        try {
          editor.applyOperations(proposal.operations, fingerprint, scope.editableIds || [],
            (scope.classes || []).map((item) => item.id), policy);
        } catch (error) {
          proposal.operations = [];
          proposal.questions.push(`残りの操作だけでは提案が成立しないため、この提案全体を止めました。${error.message}`);
        }
      }
    });
    if (clarificationDetails.length) {
      const uniqueDetails = [...new Set(clarificationDetails)];
      result.questions ||= [];
      result.questions.push(uniqueDetails.length === 1 ? uniqueDetails[0]
        : `一部の操作を保留しました。${uniqueDetails.slice(0, 3).join(' ')}${uniqueDetails.length > 3 ? ` ほか${uniqueDetails.length - 3}件も確認できます。` : ''}`);
    }
    const removedProposals = result.proposals.filter((proposal) => !proposal.operations.length && !proposal.questions.length);
    result.proposals = result.proposals.filter((proposal) => proposal.operations.length || proposal.questions.length);
    if (removedProposals.length) {
      result.message = [result.message, '安全性を確認できない操作は保留し、確認事項としてお尋ねしています。']
        .filter(Boolean).join('\n\n');
    }
    if (!editableIds.size && !result.proposals.some((proposal) => proposal.operations.length)) {
      result.message = [result.message, '変更できるクラスが選択されていません。変更案が必要な場合は対象クラスを選択してください。']
        .filter(Boolean).join('\n\n');
    }
    result.excludedOperations = excludedOperations;
    return totalRemovedCount;
  };
  const resolveDataRequests = (requests, scope) => {
    const state = editor.getState();
    const byId = new Map(state.classes.map((item) => [item.id, item]));
    const selected = new Set(scope.editableIds);
    const alreadyShared = new Set(scope.sharedContextIds || []);
    const alreadySent = new Set(scope.classes.map((item) => item.id));
    const resolved = new Map();
    const unresolved = [];
    const unavailableTargets = [];
    const candidateGroups = [];
    const parentByChild = new Map(state.relations.map(({ child, parent }) => [child, parent]));
    const topAncestorFor = (id) => {
      let currentId = id;
      const seen = new Set();
      while (parentByChild.has(currentId) && !seen.has(currentId)) {
        seen.add(currentId);
        currentId = parentByChild.get(currentId);
      }
      return currentId;
    };
    const pathFor = (id) => {
      const path = [];
      const seen = new Set();
      let currentId = id;
      while (currentId && byId.has(currentId) && !seen.has(currentId)) {
        seen.add(currentId);
        path.push(byId.get(currentId).label || currentId);
        currentId = parentByChild.get(currentId);
      }
      return path.reverse().join(' › ');
    };
    const selectedRoots = (scope.selectionRoots || scope.selectedIds || []).filter((id) => byId.has(id));
    const matchesRelation = (candidateId, relation) => {
      if (relation === 'any') return true;
      if (!selectedRoots.length) return false;
      if (relation === 'parent') return selectedRoots.some((id) => parentByChild.get(id) === candidateId);
      if (relation === 'child') return selectedRoots.includes(parentByChild.get(candidateId));
      if (relation === 'descendant') {
        return selectedRoots.some((rootId) => {
          let parentId = parentByChild.get(candidateId);
          const seen = new Set();
          while (parentId && !seen.has(parentId)) {
            if (parentId === rootId) return true;
            seen.add(parentId);
            parentId = parentByChild.get(parentId);
          }
          return false;
        });
      }
      if (relation === 'sibling') {
        const candidateParent = parentByChild.get(candidateId);
        return Boolean(candidateParent) && selectedRoots.some((id) => id !== candidateId && parentByChild.get(id) === candidateParent);
      }
      if (relation === 'same_top_ancestor') {
        const candidateTop = topAncestorFor(candidateId);
        return selectedRoots.some((id) => topAncestorFor(id) === candidateTop);
      }
      return false;
    };
    requests.forEach((request) => {
      if (request.classQuery) {
        const query = request.classQuery;
        const keywords = query.nameKeywords.map((value) => value.toLocaleLowerCase('ja-JP'));
        const findMatches = ({ useKeywords, useRelation }) => state.classes.filter((candidate) => candidate.type !== 'class'
          && !alreadySent.has(candidate.id)
          && !resolved.has(candidate.id)
          && (!query.classType || candidate.type === query.classType)
          && (!useKeywords || keywords.every((keyword) => String(candidate.label || '').toLocaleLowerCase('ja-JP').includes(keyword)))
          && (!useRelation || matchesRelation(candidate.id, query.relationToSelection)))
          .sort((left, right) => String(left.label || '').localeCompare(String(right.label || ''), 'ja'));
        let matchMode = 'strict';
        let matches = findMatches({ useKeywords: true, useRelation: true });
        if (!matches.length && keywords.length) {
          matches = findMatches({ useKeywords: false, useRelation: true });
          if (matches.length) matchMode = 'without-keywords';
        }
        if (!matches.length && query.relationToSelection !== 'any') {
          matches = findMatches({ useKeywords: false, useRelation: false });
          if (matches.length) matchMode = 'without-keywords-or-relation';
        }
        candidateGroups.push({
          query,
          reason: request.reason,
          matchMode,
          candidates: matches.slice(0, query.limit).map((item) => ({ item, path: pathFor(item.id) })),
          truncated: matches.length > query.limit,
          selectedIds: []
        });
        return;
      }
      let candidate = null;
      if (request.classId) {
        candidate = byId.get(request.classId);
        if (!candidate || (request.className && candidate.label !== request.className)) {
          unresolved.push(request.className || request.classId);
          return;
        }
      } else if (request.className) {
        const matches = state.classes.filter((item) => item.label === request.className);
        if (matches.length === 1) candidate = matches[0];
        else {
          unresolved.push(request.className);
          return;
        }
      }
      if (!candidate) {
        unresolved.push(request.classId || request.className || '指定されたクラス');
        return;
      }
      if (candidate.type === 'class') {
        unavailableTargets.push(candidate.label || candidate.id);
        return;
      }
      if (alreadySent.has(candidate.id) || selected.has(candidate.id) || alreadyShared.has(candidate.id)) return;
      const previous = resolved.get(candidate.id);
      resolved.set(candidate.id, {
        item: candidate,
        reason: [previous?.reason, request.reason].filter(Boolean).join(' / ')
      });
    });
    return { requests: [...resolved.values()], candidateGroups, unresolved: [...new Set(unresolved)], unavailableTargets: [...new Set(unavailableTargets)] };
  };
    return {
      validatePayload,
      suppressNoopMoveOperations,
      normalizeDuplicateClassOperations,
      enforceOperationPolicy,
      resolveDataRequests
    };
};
