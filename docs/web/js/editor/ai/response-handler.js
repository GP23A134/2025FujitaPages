// AI応答を内部形式で検証し、操作の安全性確認や追加データ要求の解決を行います。
// モデルの出力は検証が完了するまで編集データへ適用しません。
export const createResponseHandler = ({ editor, AI_OUTPUT_LIMITS, deduplicateQuestions }) => {
  const validatePayload = (result, expectedHash) => {
    if (!result || typeof result !== 'object' || Array.isArray(result)) {
      throw new Error('AIの応答がJSONオブジェクトではありません。提案は適用できません。');
    }
    if (!Array.isArray(result.proposals) || !Array.isArray(result.questions) || !Array.isArray(result.dataRequests)) {
      throw new Error('AIの応答に提案または確認事項の一覧がありません。もう一度依頼してください。');
    }
    result.questions = deduplicateQuestions(result.questions);
    result.dataRequests = result.dataRequests.filter((request) => request && typeof request.reason === 'string'
      && ((typeof request.classId === 'string' && request.classId.trim())
        || (typeof request.className === 'string' && request.className.trim())
        || (request.classQuery && typeof request.classQuery === 'object')))
      .map((request) => {
        const query = request.classQuery && typeof request.classQuery === 'object' ? request.classQuery : null;
        return {
          classId: typeof request.classId === 'string' ? request.classId.trim() : '',
          className: typeof request.className === 'string' ? request.className.trim() : '',
          classQuery: query ? {
            classType: ['top', 'middle'].includes(query.classType) ? query.classType : '',
            nameKeywords: Array.isArray(query.nameKeywords)
              ? query.nameKeywords.filter((keyword) => typeof keyword === 'string' && keyword.trim()).slice(0, 5).map((keyword) => keyword.trim()) : [],
            relationToSelection: ['any', 'parent', 'child', 'descendant', 'sibling', 'same_top_ancestor'].includes(query.relationToSelection)
              ? query.relationToSelection : 'any',
            limit: Math.max(1, Math.min(20, Number.isInteger(query.limit) ? query.limit : 5))
          } : null,
          reason: request.reason.trim()
        };
      });
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
    result.proposals.forEach((proposal) => {
      const parentByChild = new Map(currentParentByChild);
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
          if (operation.classType === 'middle' && operation.parentId) parentByChild.set(operation.temporaryId, operation.parentId);
          return true;
        }
        if (operation.type === 'moveClass') {
          const currentParent = parentByChild.get(operation.classId);
          if (currentParent === operation.destinationId || createsCycle(operation.classId, operation.destinationId)) {
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
          if (!children.length || operation.from === operation.to || createsCycle(operation.from, operation.to)
            || children.every((child) => parentByChild.get(child) === operation.to)) {
            removedMoveCount += 1;
            return false;
          }
          children.forEach((child) => parentByChild.set(child, operation.to));
        }
        return true;
      });
      if (removedMoveCount && proposal.uncertainties.length < AI_OUTPUT_LIMITS.uncertaintiesPerProposal) {
        proposal.uncertainties.push('親子関係が変わらない移動、または循環を作る移動先は除外しました。');
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
    const available = new Set(availableIds);
    result.proposals.forEach((proposal) => {
      const aliases = new Map();
      const unavailableDuplicateIds = new Set();
      const additionsByTypeAndLabel = new Map();
      proposal.operations.forEach((operation) => {
        if (operation.type !== 'addClass' || !operation.temporaryId || !['top', 'middle'].includes(operation.classType)) return;
        const label = String(operation.label || '').trim();
        const key = `${operation.classType}\u0000${label}`;
        const existing = state.classes.find((item) => item.type === operation.classType
          && String(item.label || '').trim() === label);
        if (existing && available.has(existing.id)) aliases.set(operation.temporaryId, existing.id);
        else if (existing) unavailableDuplicateIds.add(operation.temporaryId);
        else if (additionsByTypeAndLabel.has(key)) aliases.set(operation.temporaryId, additionsByTypeAndLabel.get(key));
        else additionsByTypeAndLabel.set(key, operation.temporaryId);
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
        if (proposal.uncertainties.length < AI_OUTPUT_LIMITS.uncertaintiesPerProposal) {
          proposal.uncertainties.push('同じ種類・名称のクラスが既にあるため、新設せず既存クラスを再利用します。');
        }
      }
      if (unavailableDuplicateIds.size) {
        let addedBlockedId = true;
        while (addedBlockedId) {
          addedBlockedId = false;
          proposal.operations.forEach((operation) => {
            if (operation.type === 'addClass' && operation.temporaryId && unavailableDuplicateIds.has(operation.parentId)
              && !unavailableDuplicateIds.has(operation.temporaryId)) {
              unavailableDuplicateIds.add(operation.temporaryId);
              addedBlockedId = true;
            }
          });
        }
        const referencesUnavailableDuplicate = (operation) => ['temporaryId', 'parentId', 'classId', 'destinationId', 'from', 'to']
          .some((key) => unavailableDuplicateIds.has(operation[key]));
        proposal.operations = proposal.operations.filter((operation) => !referencesUnavailableDuplicate(operation));
        if (proposal.uncertainties.length < AI_OUTPUT_LIMITS.uncertaintiesPerProposal) {
          proposal.uncertainties.push('同名クラスは存在しますが選択範囲外のため、そのクラスに依存する操作を除外しました。');
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
    if (scope.editableIds.length) return;
    const removedCount = result.proposals.reduce((count, proposal) => count + proposal.operations.length, 0);
    if (!removedCount) return;
    result.proposals.forEach((proposal) => { proposal.operations = []; });
    result.proposals = result.proposals.filter((proposal) => proposal.questions.length);
    result.message = [result.message, '変更できるクラスが選択されていないため、変更操作は除外しました。変更案が必要な場合は対象クラスを選択してください。']
      .filter(Boolean).join('\n\n');
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
