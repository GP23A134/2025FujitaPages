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
        if (!operation || !['addClass', 'renameClass', 'moveClass', 'moveChildren', 'deleteClass'].includes(operation.type)) throw new Error('許可されていない操作を含む提案です。適用できません。');
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
  const removeOperationsWithoutEditableScope = (result, scope) => {
    const currentRelations = editor.getState()?.relations || scope.relations || [];
    const editableIds = new Set(scope.editableIds || []);
    result.proposals.forEach((proposal) => {
      const editable = new Set(editableIds);
      const parentByChild = new Map(currentRelations.map(({ child, parent }) => [child, parent]));
      let removedCount = 0;
      proposal.operations = proposal.operations.filter((operation) => {
        if (operation.type === 'addClass') {
          if (operation.temporaryId) editable.add(operation.temporaryId);
          if (operation.classType === 'middle' && operation.temporaryId && operation.parentId) {
            parentByChild.set(operation.temporaryId, operation.parentId);
          }
          return true;
        }
        if (!['renameClass', 'moveClass', 'moveChildren', 'deleteClass'].includes(operation.type)) return true;
        const sourceId = operation.classId || operation.from;
        if (!editable.has(sourceId)) {
          removedCount += 1;
          return false;
        }
        if (operation.type === 'moveClass') {
          parentByChild.set(operation.classId, operation.destinationId);
        } else if (operation.type === 'moveChildren') {
          const children = [...parentByChild]
            .filter(([, parent]) => parent === operation.from)
            .map(([child]) => child);
          if (children.some((child) => !editable.has(child))) {
            removedCount += 1;
            return false;
          }
          children.forEach((child) => parentByChild.set(child, operation.to));
        } else if (operation.type === 'deleteClass') {
          parentByChild.delete(operation.classId);
        }
        return true;
      });
      if (removedCount && proposal.uncertainties.length < AI_OUTPUT_LIMITS.uncertaintiesPerProposal) {
        const warning = '選択範囲外のクラスを変更する操作は除外しました。';
        if (!proposal.uncertainties.includes(warning)) proposal.uncertainties.push(warning);
      }
    });
    const removedProposals = result.proposals.filter((proposal) => !proposal.operations.length && !proposal.questions.length);
    result.proposals = result.proposals.filter((proposal) => proposal.operations.length || proposal.questions.length);
    if (removedProposals.length) {
      result.message = [result.message, '選択範囲外のクラスを変更する提案は適用できないため、該当する操作を除外しました。']
        .filter(Boolean).join('\n\n');
    }
    if (!editableIds.size && !result.proposals.some((proposal) => proposal.operations.length)) {
      result.message = [result.message, '変更できるクラスが選択されていません。変更案が必要な場合は対象クラスを選択してください。']
        .filter(Boolean).join('\n\n');
    }
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
  const validateSplitTaskOperations = (result, task) => {
    const editable = new Set(task.scope.editableIds);
    const classesById = new Map(task.scope.classes.map((item) => [item.id, item]));
    let discardedOperationCount = 0;
    result.proposals.forEach((proposal) => {
      const originalOperationCount = proposal.operations.length;
      const temporaryIds = new Set(proposal.operations
        .filter((operation) => operation.type === 'addClass' && operation.temporaryId)
        .map((operation) => operation.temporaryId));
      const temporaryTypeById = new Map(proposal.operations
        .filter((operation) => operation.type === 'addClass' && operation.temporaryId)
        .map((operation) => [operation.temporaryId, operation.classType]));
      const isDestination = (id) => {
        const item = classesById.get(id);
        return Boolean((item && ['top', 'middle'].includes(item.type)) || temporaryIds.has(id));
      };
      const allowed = proposal.operations.filter((operation) => {
        if (task.kind === 'full_hierarchy_targets') {
          if (task.scope.allowHierarchyEdits) {
            if (operation.type === 'addClass') {
              if (!['top', 'middle'].includes(operation.classType) || !operation.temporaryId) return false;
              if (operation.classType === 'top') return !operation.parentId;
              const parentType = classesById.get(operation.parentId)?.type || temporaryTypeById.get(operation.parentId);
              return ['top', 'middle'].includes(parentType);
            }
            if (operation.type === 'renameClass') {
              const source = classesById.get(operation.classId);
              return editable.has(operation.classId) && ['top', 'middle'].includes(source?.type)
                && typeof operation.label === 'string' && operation.label.trim().length > 0;
            }
            if (operation.type === 'moveClass') {
              const sourceType = classesById.get(operation.classId)?.type;
              const destinationType = classesById.get(operation.destinationId)?.type
                || temporaryTypeById.get(operation.destinationId);
              if (!editable.has(operation.classId) || !['top', 'middle', 'class'].includes(sourceType)
                || !['top', 'middle'].includes(destinationType)) return false;
              return sourceType !== 'top' || destinationType === 'middle';
            }
            return false;
          }
          if (operation.type === 'addClass') {
            if (operation.classType !== 'middle' || !operation.temporaryId) return false;
            const parentType = classesById.get(operation.parentId)?.type || temporaryTypeById.get(operation.parentId);
            return ['top', 'middle'].includes(parentType);
          }
          const destinationType = classesById.get(operation.destinationId)?.type || temporaryTypeById.get(operation.destinationId);
          return operation.type === 'moveClass'
            && editable.has(operation.classId)
            && classesById.get(operation.classId)?.type === 'class'
            && ['top', 'middle'].includes(destinationType);
        }
        if (task.kind === 'targets') {
          if (operation.type === 'addClass') {
            if (operation.classType !== 'middle' || !operation.temporaryId) return false;
            const parentType = classesById.get(operation.parentId)?.type || temporaryTypeById.get(operation.parentId);
            return ['top', 'middle'].includes(parentType);
          }
          const destinationType = classesById.get(operation.destinationId)?.type || temporaryTypeById.get(operation.destinationId);
          return operation.type === 'moveClass'
            && editable.has(operation.classId)
            && classesById.get(operation.classId)?.type === 'class'
            && ['top', 'middle'].includes(destinationType);
        }
        const sourceId = operation.classId || operation.from;
        if (['renameClass', 'moveClass', 'moveChildren', 'deleteClass'].includes(operation.type)
          && !editable.has(sourceId)) return false;
        if (operation.type === 'moveClass') {
          if (!isDestination(operation.destinationId)) return false;
          const sourceType = classesById.get(operation.classId)?.type
            || temporaryTypeById.get(operation.classId);
          const destinationType = classesById.get(operation.destinationId)?.type
            || temporaryTypeById.get(operation.destinationId);
          if (sourceType === 'top' && destinationType !== 'middle') return false;
        }
        if (operation.type === 'moveChildren' && !isDestination(operation.to)) return false;
        if (operation.type === 'addClass') {
          if (!['top', 'middle'].includes(operation.classType)) return false;
          if (operation.classType === 'top' && operation.parentId) return false;
          if (operation.classType === 'middle' && !isDestination(operation.parentId)) return false;
        }
        return ['addClass', 'renameClass', 'moveClass', 'moveChildren', 'deleteClass'].includes(operation.type);
      });
      discardedOperationCount += proposal.operations.length - allowed.length;
      proposal.operations = allowed;
      if (!proposal.operations.length && !proposal.questions.length) {
        proposal.questions.push('この分割範囲では適用可能な変更操作がありませんでした。');
      } else if (allowed.length < originalOperationCount) {
        proposal.uncertainties.push('分割範囲外の操作は安全確認のため除外しました。表示中の変更内容を確認してください。');
        proposal.summary = `分割範囲外の操作を除外した案です。${proposal.summary || proposal.title}`;
      }
    });
    return discardedOperationCount;
  };
    return {
      validatePayload,
      suppressNoopMoveOperations,
      normalizeDuplicateClassOperations,
      removeOperationsWithoutEditableScope,
      resolveDataRequests,
      validateSplitTaskOperations
    };
};
