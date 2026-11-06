// AIの依頼意図と分割タスクから、許可する操作を一元的に決めます。
const ALL_OPERATIONS = ['addClass', 'renameClass', 'moveClass', 'moveChildren', 'promoteClass', 'deleteClass'];

const asksForNoChanges = (text) => /変更案(?:は|を)?(?:出さない|作らない|不要|いらない)|提案(?:は|を)(?:出さない|作らない|不要|いらない|しない)|(?:要約|説明|評価|比較|確認)だけ|^(?:今回は)?提案しない/.test(text);
const asksForChanges = (text) => /(?:変更案|提案|移動(?:案|して|させて|先を)|追加(?:案|して|する)|新設(?:案|して|する)|作成(?:案|して|する)|作って|設けて|改名(?:案|して|する)|削除(?:案|して|する|を許可|を認め)|統合(?:案|して|する|が明確|を検討|を許可|や改名)|分割(?:案|して|する)|再編(?:案|して|する)|再構成(?:案|して|する)|振り分け(?:案|て|る)|分類(?:案|して|し直して|する)|見直(?:案|して|す)|最適化(?:案|して|する)|整理(?:案|して|する)|改善(?:案|して|する)|整えて|変更(?:案|して|する)|検討して|検討し|(?:必要なら|可能なら|必要に応じて).{0,12}(?:削除|統合))/.test(text);
const explicitlyAllowsDeletion = (text) => !/(?:削除|消去|取り除).{0,8}(?:しない|不要|禁止|出さない)/.test(text)
  && (/(?:削除|消去|取り除)(?:案|を検討|を提案|を出し|を許可|を認め|して|したい|してください|が必要)/.test(text)
    || /統合.{0,12}(?:が明確|を検討|して|案|する|したい|を許可|を認め|が適切|が妥当)/.test(text)
    || /(?:必要なら|可能なら|必要に応じて).{0,12}(?:削除|統合)/.test(text));

const requestedOperationTypes = (text) => {
  if (/(?:最適化|再編|再構成|体系.{0,8}整理|構造.{0,8}整理)/.test(text)) {
    return ALL_OPERATIONS.filter((type) => type !== 'deleteClass' || explicitlyAllowsDeletion(text));
  }
  const types = new Set();
  if (/(?:新設|作成|追加|作って|設けて|分割|新しい.{0,12}(?:クラス|まとまり))/.test(text)) types.add('addClass');
  if (/(?:改名|名称変更|変更後の名称|名前を変|命名)/.test(text)) types.add('renameClass');
  if (/(?:移動|移す|移し|再分類|振り分け|所属.{0,8}(?:変|見直|整理))/.test(text)) types.add('moveClass');
  if (/(?:配下.{0,8}(?:まとめ|一括)|(?:すべて|全て).{0,8}子)/.test(text)) types.add('moveChildren');
  if (/(?:上位化|上位クラス化|昇格|独立した上位)/.test(text)) types.add('promoteClass');
  if (explicitlyAllowsDeletion(text)) {
    types.add('deleteClass');
    types.add('moveClass');
    types.add('moveChildren');
  }
  if (!types.size && asksForChanges(text)) return ALL_OPERATIONS.filter((type) => type !== 'deleteClass');
  return [...types];
};

export const createOperationPolicy = ({ requestText = '', taskKind = 'selected_scope', scope = {} }) => {
  const request = String(requestText);
  let allowedTypes = asksForNoChanges(request) || !(asksForChanges(request) || /上位化|上位クラス化|昇格/.test(request))
    ? [] : requestedOperationTypes(request);
  let addClassTypes = ['top', 'middle'];
  let moveSourceTypes = ['top', 'middle', 'class'];
  let allowDelete = allowedTypes.includes('deleteClass') && explicitlyAllowsDeletion(request);

  if (taskKind === 'upper_class_unit' || taskKind === 'upper_class_targets') {
    allowedTypes = allowedTypes.filter((type) => ['addClass', 'moveClass', ...(taskKind === 'upper_class_unit' && scope.allowHierarchyEdits ? ['renameClass', 'moveChildren', 'promoteClass', 'deleteClass'] : [])].includes(type));
    addClassTypes = ['middle'];
    moveSourceTypes = taskKind === 'upper_class_unit' && scope.allowHierarchyEdits
      ? ['top', 'middle', 'class'] : ['class'];
    allowDelete = taskKind === 'upper_class_unit' && Boolean(scope.allowHierarchyEdits) && allowDelete;
  } else if (taskKind === 'hierarchy') {
    moveSourceTypes = ['top', 'middle'];
    allowedTypes = allowedTypes.filter((type) => type !== 'deleteClass' || allowDelete);
  } else {
    allowedTypes = allowedTypes.filter((type) => type !== 'deleteClass' || allowDelete);
  }

  return {
    taskKind,
    allowedTypes,
    addClassTypes,
    moveSourceTypes,
    allowDelete,
    requireAllDescendantsEditableForDelete: true
  };
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
  if (operation.type === 'deleteClass' && !policy.allowDelete) return false;
  if (operation.type === 'promoteClass') return editableIds.has(operation.classId)
    && classesById.get(operation.classId)?.type === 'middle' && policy.moveSourceTypes.includes('middle');
  if (operation.type === 'moveClass') {
    const source = classesById.get(operation.classId);
    return editableIds.has(operation.classId) && policy.moveSourceTypes.includes(source?.type);
  }
  if (operation.type === 'moveChildren') return editableIds.has(operation.from)
    && classesById.get(operation.from)?.type === 'middle'
    && policy.moveSourceTypes.includes('middle');
  if (['renameClass', 'deleteClass'].includes(operation.type)) {
    return editableIds.has(operation.classId) && policy.moveSourceTypes.includes(classesById.get(operation.classId)?.type);
  }
  return true;
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
        const referencesBlockedDuplicate = (operation) => ['temporaryId', 'parentId', 'classId', 'destinationId', 'from', 'to']
          .some((key) => blockedIds.has(operation[key]));
        proposal.operations = proposal.operations.filter((operation) => !referencesBlockedDuplicate(operation));
        const warning = ambiguousDuplicateIds.size
          ? '同じ種類・名称のクラスが複数あり、親階層から再利用先を一意に決められないため、関連操作を除外しました。'
          : '同名クラスは存在しますが選択範囲外のため、そのクラスに依存する操作を除外しました。';
        if (proposal.uncertainties.length < AI_OUTPUT_LIMITS.uncertaintiesPerProposal && !proposal.uncertainties.includes(warning)) {
          proposal.uncertainties.push(warning);
        }
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
        proposal.operations = proposal.operations.filter((_, index) => !duplicateRenameIndexes.has(index));
        if (proposal.uncertainties.length < AI_OUTPUT_LIMITS.uncertaintiesPerProposal) {
          proposal.uncertainties.push('改名先と同じ種類・名称のクラスが既にあるため、その改名操作を除外しました。');
        }
      }
    });
  };
  const enforceOperationPolicy = (result, scope, policy) => {
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
          excludedOperations.push({ proposal: proposal.title || proposal.summary || proposal.id,
            type: operation.type || '不明', classId: operation.classId || operation.from || '', reason });
        }
        return allowed;
      });
      totalRemovedCount += removedCount;
      if (removedCount) {
        const warning = `一部の操作を除外しました: ${excludedOperations.slice(-removedCount)
          .map((item) => `${item.classId || item.type}（${item.reason}）`).join(' ')}`;
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
    const removedProposals = result.proposals.filter((proposal) => !proposal.operations.length && !proposal.questions.length);
    result.proposals = result.proposals.filter((proposal) => proposal.operations.length || proposal.questions.length);
    if (removedProposals.length) {
      result.message = [result.message, '依頼・分割範囲で許可されない操作を含むため、該当する操作を除外しました。']
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
