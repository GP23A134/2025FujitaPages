import { AI_TUNING_LIMITS } from './tuning-limits.js?v=20261111-ai-tuning-limits-v1';
import { createOperationPolicy, describeOperationPolicy } from './proposal-engine.js?v=20261112-review-fixes-v1';

// 現在の選択範囲を依頼JSONへ変換し、大きすぎる範囲を処理単位へ分割します。
// scope固有の指示はJSON内に一時的に載せ、送信層が固定プロンプトの後ろへ移します。
export const createRequestPlanner = ({ editor, MAX_REQUEST_CHARACTERS, getMaxRequestCharacters = () => MAX_REQUEST_CHARACTERS, diffScope, shortenInputIds,
  getMaxUnitsPerBatch = () => AI_TUNING_LIMITS.maxUnitsPerBatch.default,
  getOptimizationSplitThreshold = () => AI_TUNING_LIMITS.optimizationSplitThreshold.default,
  getProposalFreedom = () => 5,
  getAllowProposals = (scope) => Boolean(scope?.allowProposals) }) => {
  const operationInstruction = (taskKind, scope) => describeOperationPolicy(createOperationPolicy({
    allowProposals: Boolean(getAllowProposals(scope)), taskKind, scope, proposalFreedom: getProposalFreedom()
  }));
  // 長い全体分析の計画中も、ブラウザーに描画と入力イベントの処理を返します。
  const yieldToBrowser = () => new Promise((resolve) => window.setTimeout(resolve, 0));
  // 通常依頼では前回スナップショットとの差分を使い、初回・強制更新では全体を送ります。
  const buildUserContent = (userText, activeScope, conversation, options = {}) => {
    const usePrevious = !options.forceSnapshot && conversation.initialSnapshotSent && conversation.responseId;
    const previousScope = usePrevious ? conversation.previousScope : null;
    const scopeInstruction = activeScope.scopeCoverage === 'all_classes'
      ? '全体構造が入力されています。'
      : activeScope.scopeCoverage === 'all_classes_chunk'
        ? '今回入力された対象範囲だけを評価し、未提示範囲まで判断を広げないでください。利用者向け返答では内部処理の「チャンク」「分割」「統合」という語を使わず、対象の上位クラス名や範囲名で説明してください。'
        : '入力範囲外のクラス情報を推測しません。結論に必要な情報が範囲外なら、不足している階層・クラス情報を回答文で説明し、その範囲を選択して再依頼するよう案内してください。追加共有の候補検索は行いません。';
    const instruction = options.instruction || (activeScope.mode === 'hierarchy_scope'
      ? '階層クラスだけの範囲です。上位・中間クラスの追加・改名・移動・削除と、選択済み中間クラスの上位化を提案できますが、対象クラスの操作は禁止です。階層の変換では配下の親子関係を保ってください。'
      : '今回の依頼に合わせて、selectedScope内の情報を評価・説明し、安全に確定できる提案を返してください。');
    const noEditableClassesInstruction = activeScope.editableIds.length
      ? ''
      : '変更可能なクラスがありません。評価・説明だけを返し、変更案は作成しないでください。';
    return shortenInputIds(JSON.stringify({
      request: userText,
      conversationContext: conversation.localContext || undefined,
      scopeCoverage: activeScope.scopeCoverage || 'selected_classes',
      selectedScope: diffScope(previousScope, activeScope),
      instruction: `${instruction} ${scopeInstruction} ${noEditableClassesInstruction}`
    }));
  };
  // 全体参照が上限を超える場合、階層範囲と対象クラス範囲を分割して漏れなく計画します。
  const makeLargeScopePlan = async (userText, scope, conversation, { promptOverhead = 0 } = {}) => {
    const maxRequestCharacters = Number(getMaxRequestCharacters()) || MAX_REQUEST_CHARACTERS;
    const hierarchyParentByChild = new Map(scope.relations.map(({ child, parent }) => [child, parent]));
    const hierarchyRows = scope.classes.filter((item) => ['top', 'middle'].includes(item.type))
      .map((item) => [item.id, item.type, item.label, hierarchyParentByChild.get(item.id) || null]);
    const contextCharacterCount = shortenInputIds(JSON.stringify({ scopeCoverage: 'hierarchy_reference', hierarchy: hierarchyRows })).length;
    const taskCharacterLimit = maxRequestCharacters - contextCharacterCount - promptOverhead;
    if (taskCharacterLimit <= 0) throw new Error('上位・中間クラスの全体情報が送信上限を超えています。');
    const upperClassBatchCount = 10;
    const upperClassBatchIndex = (id) => {
      let hash = 2166136261;
      for (const character of String(id || '')) {
        hash ^= character.codePointAt(0);
        hash = Math.imul(hash, 16777619);
      }
      return (hash >>> 0) % upperClassBatchCount;
    };
    const selectionRoots = scope.selectionRoots || scope.selectedIds;
    const selectedRootClasses = selectionRoots.map((id) => scope.classes.find((item) => item.id === id)).filter(Boolean);
    const isHierarchySelection = selectedRootClasses.length === selectionRoots.length
      && selectedRootClasses.length > 0
      && selectedRootClasses.every((item) => ['top', 'middle'].includes(item.type));
    const editableHierarchyIds = new Set(scope.classes
      .filter((item) => ['top', 'middle'].includes(item.type) && scope.editableIds.includes(item.id))
      .map((item) => item.id));
    if (!isHierarchySelection && !editableHierarchyIds.size) {
      const editableIdSet = new Set(scope.editableIds);
      const classTypeById = new Map(scope.classes.map((item) => [item.id, item.type]));
      const selectedTargets = scope.classes.filter((item) => item.type === 'class' && editableIdSet.has(item.id));
      const hierarchyClasses = scope.classes.filter((item) => ['top', 'middle'].includes(item.type));
      const editableTargetIds = scope.editableIds.filter((id) => classTypeById.get(id) === 'class');
      if (!scope.includeAllClasses || !selectedTargets.length || selectedTargets.length !== editableTargetIds.length || !hierarchyClasses.length) return null;
      const hierarchyById = new Map(hierarchyClasses.map((item) => [item.id, item]));
      const parentByChild = new Map(scope.relations.map(({ child, parent }) => [child, parent]));
      const topAncestorFor = (id) => {
        let currentId = id;
        const seen = new Set();
        while (currentId && !seen.has(currentId)) {
          seen.add(currentId);
          if (hierarchyById.get(currentId)?.type === 'top') return currentId;
          currentId = parentByChild.get(currentId);
        }
        return '';
      };
      const targetOperationPolicy = createOperationPolicy({
        allowProposals: Boolean(getAllowProposals(scope)), taskKind: 'upper_class_unit', scope, proposalFreedom: getProposalFreedom()
      });
      const targetInstruction = `この分割範囲に含まれる上位クラス配下の対象クラスを評価してください。${describeOperationPolicy(targetOperationPolicy)}既存の階層を優先し、許可された追加と対象クラスの移動が必要なら同じ提案にまとめて対象との関連を説明してください。移動元は、この分割単位でrole=e（編集可能）として示された対象クラスだけにしてください。role=cは参照用であり、移動元にできません。別の分割単位に属する対象クラスも移動元に含めず、分割単位をまたぐ移動案は最終統合に委ねてください。同じ対象を同じ移動先へ移す操作は1回だけ提案してください。${targetOperationPolicy.allowedTypes.includes('deleteClass') ? '削除を提案する場合は、配下の既存クラスがすべて今回の編集範囲に含まれ、子を安全な親へ移動できる場合だけにし、子の移動を先、親の削除を後に置いてください。' : ''}無関係な階層変更、入力にないクラスや関係の推測、範囲外の操作は禁止します。`;
      const buildTargetTask = (targets, groupHierarchy, topClassId) => {
        const targetIds = new Set(targets.map((item) => item.id));
        const hierarchyIds = new Set(groupHierarchy.map((item) => item.id));
        const includedIds = new Set([...hierarchyIds, ...targetIds]);
        const taskScope = {
          mode: 'selected_scope',
          scopeCoverage: 'all_classes_chunk',
          selectedIds: scope.selectedIds.filter((id) => includedIds.has(id)),
          selectionRoots: (scope.selectionRoots || scope.selectedIds).filter((id) => includedIds.has(id)),
          sharedContextIds: (scope.sharedContextIds || []).filter((id) => hierarchyIds.has(id)),
          editableIds: [...new Set([
            ...groupHierarchy
              .filter((item) => scope.editableIds.includes(item.id))
              .map((item) => item.id),
            ...targets.map((item) => item.id)
          ])],
          classes: [...groupHierarchy, ...targets],
          relations: scope.relations.filter(({ child, parent }) => includedIds.has(child) && includedIds.has(parent)),
          counts: Object.fromEntries([...includedIds].filter((id) => Object.prototype.hasOwnProperty.call(scope.counts || {}, id)).map((id) => [id, scope.counts[id]])),
          targetContext: {
            descendantTargetClassCounts: Object.fromEntries(Object.entries(scope.targetContext?.descendantTargetClassCounts || {})
              .filter(([id]) => includedIds.has(id)))
          },
          allowHierarchyEdits: Boolean(scope.allowHierarchyEdits),
          allowProposals: Boolean(scope.allowProposals)
        };
        const input = buildUserContent(userText, taskScope, conversation, {
          forceSnapshot: true,
          instruction: targetInstruction
        });
        return { kind: 'upper_class_targets', topClassId, scope: taskScope, input };
      };
      const targetTasks = [];
      const targetsByTopClass = new Map();
      selectedTargets.forEach((target) => {
        const topId = topAncestorFor(target.id);
        if (!targetsByTopClass.has(topId)) targetsByTopClass.set(topId, []);
        targetsByTopClass.get(topId).push(target);
      });
      for (const [topClassId, targets] of targetsByTopClass) {
        const groupHierarchy = topClassId
          ? hierarchyClasses.filter((item) => topAncestorFor(item.id) === topClassId)
          : [];
        let offset = 0;
        while (offset < targets.length) {
          let low = 1; let high = Math.min(targets.length - offset, scope.allowHierarchyEdits ? 20 : targets.length - offset); let bestSize = 0; let bestTask = null;
          while (low <= high) {
            await yieldToBrowser();
            const size = Math.floor((low + high) / 2);
            const candidate = buildTargetTask(targets.slice(offset, offset + size), groupHierarchy, topClassId);
            if (candidate.input.length <= taskCharacterLimit) {
              bestSize = size; bestTask = candidate; low = size + 1;
            } else high = size - 1;
          }
          if (!bestSize || !bestTask) {
            throw new Error('上位クラスの階層情報と対象クラス1件を送信上限内に収められません。対象クラスの選択範囲を小さくするか、全体参照をOFFにしてください。');
          }
          targetTasks.push(bestTask);
          offset += bestSize;
        }
      }
      targetTasks.forEach((task, index) => {
        task.kind = 'upper_class_unit';
        task.unitId = `upper_unit_${index + 1}`;
        task.instruction = targetInstruction;
        task.contextCharacterCount = contextCharacterCount;
      });
      return targetTasks;
    }

    const hierarchyScopeBase = scope.allowHierarchyEdits
      ? {
        ...scope,
        mode: 'hierarchy_scope',
        editableIds: scope.classes
          .filter((item) => ['top', 'middle'].includes(item.type) && scope.editableIds.includes(item.id))
          .map((item) => item.id),
        allowHierarchyEdits: true
      }
      : editor.getHierarchyScopedState(scope.selectedIds);
    if (!hierarchyScopeBase) return null;
    const hierarchyScope = { ...hierarchyScopeBase, allowProposals: Boolean(scope.allowProposals) };
    const hierarchyOperationPolicy = createOperationPolicy({
      allowProposals: Boolean(getAllowProposals(hierarchyScope)), taskKind: 'hierarchy', scope: hierarchyScope, proposalFreedom: getProposalFreedom()
    });
    const hierarchyInstruction = `この分割範囲を評価してください。${describeOperationPolicy(hierarchyOperationPolicy)}操作の変更元はrole=e（編集可能）の上位・中間クラスだけにしてください。role=cは参照用で、変更元にできません。対象クラスの個別IDや全件情報は含まれないため、対象クラスの操作は提案しないでください。targetContextの対象クラス数は読み取り専用の参考情報です。入力にない情報を推測しないでください。${hierarchyOperationPolicy.allowedTypes.includes('moveClass') && hierarchyOperationPolicy.moveSourceTypes.includes('top') ? 'selectionRootsの上位クラスを中間クラスへ移す場合は配下の親子関係を保ってください。' : ''}`;
    const hierarchyClasses = scope.classes.filter((item) => ['top', 'middle'].includes(item.type));
    const hierarchyChunkLimit = taskCharacterLimit;
    const parentByChild = new Map(scope.relations.map(({ child, parent }) => [child, parent]));
    const hierarchyById = new Map(hierarchyClasses.map((item) => [item.id, item]));
    const topAncestorFor = (id) => {
      let currentId = id;
      const seen = new Set();
      while (currentId && !seen.has(currentId)) {
        seen.add(currentId);
        if (hierarchyById.get(currentId)?.type === 'top') return currentId;
        currentId = parentByChild.get(currentId);
      }
      return '';
    };
    const childrenByParent = new Map();
    scope.relations.forEach(({ child, parent }) => {
      if (!hierarchyById.has(child) || !hierarchyById.has(parent)) return;
      if (!childrenByParent.has(parent)) childrenByParent.set(parent, []);
      childrenByParent.get(parent).push(child);
    });
    const hierarchyEditableIds = new Set(hierarchyScope.editableIds);
    const buildHierarchyTask = (taskScope) => {
      const input = buildUserContent(userText, taskScope, conversation, {
        forceSnapshot: true,
        instruction: hierarchyInstruction
      });
      return { kind: 'hierarchy', scope: taskScope, input };
    };
    const makeHierarchyTask = (editableIds) => {
      const includedIds = new Set(editableIds);
      editableIds.forEach((id) => {
        let parentId = parentByChild.get(id);
        const seen = new Set();
        while (parentId && hierarchyById.has(parentId) && !seen.has(parentId)) {
          seen.add(parentId);
          includedIds.add(parentId);
          parentId = parentByChild.get(parentId);
        }
      });
      const classIdsForTask = includedIds;
      const taskScope = {
        mode: 'hierarchy_scope',
        selectedIds: scope.selectedIds.filter((id) => classIdsForTask.has(id)),
        selectionRoots: (scope.selectionRoots || scope.selectedIds).filter((id) => classIdsForTask.has(id)),
        editableIds: [...editableIds],
        classes: hierarchyClasses.filter((item) => classIdsForTask.has(item.id)),
        relations: scope.relations.filter(({ child, parent }) => classIdsForTask.has(child) && classIdsForTask.has(parent)),
        counts: {},
        targetContext: {
          descendantTargetClassCounts: Object.fromEntries(Object.entries(scope.targetContext?.descendantTargetClassCounts || {}).filter(([id]) => classIdsForTask.has(id)))
        },
        allowHierarchyEdits: Boolean(scope.allowHierarchyEdits),
        allowProposals: Boolean(scope.allowProposals)
      };
      return buildHierarchyTask(taskScope);
    };
    const hierarchyTasks = [];
    const remainingHierarchyIds = new Set(hierarchyEditableIds);
    const collectRemainingSubtree = (id, collected = new Set()) => {
      if (!remainingHierarchyIds.has(id) || collected.has(id)) return collected;
      collected.add(id);
      (childrenByParent.get(id) || []).forEach((childId) => collectRemainingSubtree(childId, collected));
      return collected;
    };
    const partitionHierarchySubtree = async (rootId) => {
      await yieldToBrowser();
      const subtreeIds = collectRemainingSubtree(rootId);
      if (!subtreeIds.size) return;
      const candidate = makeHierarchyTask([...subtreeIds]);
      if (candidate.input.length <= hierarchyChunkLimit
        && (!hierarchyScope.allowHierarchyEdits || subtreeIds.size <= 20)) {
        hierarchyTasks.push(candidate);
        subtreeIds.forEach((id) => remainingHierarchyIds.delete(id));
        return;
      }

      // If a whole branch is too large, keep its root in one task and recurse into each child branch.
      if (remainingHierarchyIds.has(rootId)) {
        const rootTask = makeHierarchyTask([rootId]);
        if (rootTask.input.length > hierarchyChunkLimit) {
          throw new Error('上位・中間クラス1件と親階層の情報が大きく、対象クラスを加える余地がありません。さらに小さい範囲を選択してください。');
        }
        hierarchyTasks.push(rootTask);
        remainingHierarchyIds.delete(rootId);
      }
      for (const childId of (childrenByParent.get(rootId) || []).filter((id) => remainingHierarchyIds.has(id))) {
        await partitionHierarchySubtree(childId);
      }
    };
    for (const id of hierarchyScope.selectedIds) {
      if (remainingHierarchyIds.has(id)) await partitionHierarchySubtree(id);
    }
    for (const id of [...remainingHierarchyIds]) await partitionHierarchySubtree(id);

    // Pack small hierarchy branches together so they do not each require a separate API call.
    const packedHierarchyTasks = [];
    const mergeHierarchyScopes = (left, right) => {
      const classesById = new Map([...left.classes, ...right.classes].map((item) => [item.id, item]));
      const relationByKey = new Map([...left.relations, ...right.relations]
        .map((item) => [`${item.child}\u0000${item.parent}`, item]));
      return {
        mode: 'hierarchy_scope',
        selectedIds: [...new Set([...left.selectedIds, ...right.selectedIds])],
        selectionRoots: [...new Set([...(left.selectionRoots || []), ...(right.selectionRoots || [])])],
        editableIds: [...new Set([...left.editableIds, ...right.editableIds])],
        classes: [...classesById.values()],
        relations: [...relationByKey.values()],
        counts: {}
      };
    };
    const hierarchyTasksByBucket = new Map();
    hierarchyTasks.forEach((task) => {
      const rootId = task.scope.editableIds[0] || task.scope.classes[0]?.id || '';
      const bucket = upperClassBatchIndex(topAncestorFor(rootId));
      if (!hierarchyTasksByBucket.has(bucket)) hierarchyTasksByBucket.set(bucket, []);
      hierarchyTasksByBucket.get(bucket).push(task);
    });
    for (const [, bucketTasks] of [...hierarchyTasksByBucket].sort(([left], [right]) => left - right)) {
      let pendingHierarchyScope = null;
      for (const task of bucketTasks) {
        await yieldToBrowser();
        const candidateScope = pendingHierarchyScope ? mergeHierarchyScopes(pendingHierarchyScope, task.scope) : task.scope;
        const candidateTask = buildHierarchyTask(candidateScope);
        if (pendingHierarchyScope && candidateTask.input.length > hierarchyChunkLimit) {
          packedHierarchyTasks.push(buildHierarchyTask(pendingHierarchyScope));
          pendingHierarchyScope = task.scope;
        } else {
          pendingHierarchyScope = candidateScope;
        }
      }
      if (pendingHierarchyScope) packedHierarchyTasks.push(buildHierarchyTask(pendingHierarchyScope));
    }
    hierarchyTasks.splice(0, hierarchyTasks.length, ...packedHierarchyTasks);

    const targetClasses = scope.classes.filter((item) => item.type === 'class' && scope.editableIds.includes(item.id));
    const targetInstruction = 'この分割範囲に含まれる対象クラスだけを評価してください。この範囲で許可する操作は対象クラスの移動だけです。上位・中間クラスの追加・改名・移動・削除や、入力にない対象クラスの操作は提案しないでください。移動先は入力にある上位・中間クラスのIDだけを使ってください。この制約は今回の対象クラス分割範囲だけに適用されます。AIシステム全体が上位・中間クラスを再編できない、または新しい中間クラスを作成できないと説明してはいけません。階層の再編が今回必要だが入力に階層クラスがない場合は、今回の範囲に階層情報がないため別途階層クラスの選択が必要だと説明してください。';
    const targetTasks = [];
    const targetUnits = [];
    const targetOperationPolicy = createOperationPolicy({
      allowProposals: Boolean(getAllowProposals(scope)), taskKind: 'upper_class_targets', scope, proposalFreedom: getProposalFreedom()
    });
    const targetOperationInstruction = `この分割範囲に含まれる対象クラスと対応する上位・中間クラスを評価してください。${describeOperationPolicy(targetOperationPolicy)}移動元は、この分割単位でrole=e（編集可能）として示された対象クラスだけにしてください。role=cの上位・中間クラスは参照用であり、変更元にできません。別の分割単位に属する対象クラスも移動元に含めず、分割単位をまたぐ移動案は最終統合に委ねてください。同じ対象を同じ移動先へ移す操作は1回だけ提案してください。${targetOperationPolicy.allowedTypes.includes('addClass') && targetOperationPolicy.addClassTypes.includes('middle') && targetOperationPolicy.allowedTypes.includes('moveClass') ? '新設した中間クラスへ対象クラスを割り当てる場合は同じ提案にまとめ、親は入力中の上位・中間クラスIDまたは先に追加した中間クラスのtemporaryIdを指定してください。' : ''}入力にない対象クラスや親子関係は推測せず、この分割範囲を超えた全体判断は保留してください。この制約は今回の対象クラス分割範囲だけに適用され、全体として新設が不要と結論するには全チャンクの評価を使ってください。`;
    targetClasses.forEach((target) => {
      let parentId = parentByChild.get(target.id);
      let hierarchyTask = null;
      const seen = new Set();
      while (parentId && !seen.has(parentId)) {
        seen.add(parentId);
        hierarchyTask = hierarchyTasks.find((task) => task.scope.editableIds.includes(parentId)) || hierarchyTask;
        if (hierarchyById.get(parentId)?.type === 'middle' && hierarchyTask) break;
        parentId = parentByChild.get(parentId);
      }
      if (!hierarchyTask) hierarchyTask = hierarchyTasks.find((task) => task.scope.classes.some((item) => item.id === parentByChild.get(target.id)));
      if (!hierarchyTask) throw new Error('対象クラスの親階層を分割範囲に対応付けられませんでした。');
      targetUnits.push({ target, hierarchyTask });
    });

    const makeTargetScope = (units, topClassId) => {
      const targets = units.map((unit) => unit.target);
      const targetIds = new Set(targets.map((item) => item.id));
      const localHierarchy = hierarchyClasses.filter((item) => topAncestorFor(item.id) === topClassId);
      const hierarchyByIdLocal = new Map(localHierarchy.map((item) => [item.id, item]));
      const classes = [...hierarchyByIdLocal.values(), ...targets];
      const includedIds = new Set(classes.map((item) => item.id));
      return {
        mode: 'selected_scope',
        selectedIds: scope.selectedIds.filter((id) => includedIds.has(id)),
        selectionRoots: (scope.selectionRoots || scope.selectedIds).filter((id) => includedIds.has(id)),
        editableIds: [...targetIds],
        classes,
        relations: scope.relations.filter(({ child, parent }) => includedIds.has(child) && includedIds.has(parent)),
        counts: {}
      };
    };
    const buildTargetTask = (units, topClassId) => {
      const taskScope = makeTargetScope(units, topClassId);
      const input = buildUserContent(userText, taskScope, conversation, {
        forceSnapshot: true,
        instruction: targetOperationInstruction
      });
      return { kind: 'upper_class_targets', topClassId, scope: taskScope, input };
    };
    // Fill each target request as much as possible. Binary search finds the largest
    // contiguous batch that remains within the request limit, minimizing call count.
    const targetUnitsByTop = new Map();
    targetUnits.forEach((unit) => {
      const topClassId = topAncestorFor(unit.target.id);
      if (!targetUnitsByTop.has(topClassId)) targetUnitsByTop.set(topClassId, []);
      targetUnitsByTop.get(topClassId).push(unit);
    });
    for (const [topClassId, units] of targetUnitsByTop) {
      let targetOffset = 0;
      while (targetOffset < units.length) {
        const remaining = units.length - targetOffset;
        let low = 1; let high = remaining; let bestSize = 0; let bestTask = null;
        while (low <= high) {
          await yieldToBrowser();
          const size = Math.floor((low + high) / 2);
          const candidate = buildTargetTask(units.slice(targetOffset, targetOffset + size), topClassId);
          if (candidate.input.length <= taskCharacterLimit) {
            bestSize = size; bestTask = candidate; low = size + 1;
          } else high = size - 1;
        }
        if (!bestSize || !bestTask) {
          throw new Error('上位クラスと対象クラス1件だけでも送信上限を超えています。選択範囲を小さくするか、クラス名の長い範囲を分けてください。');
        }
        targetTasks.push(bestTask);
        targetOffset += bestSize;
      }
    }
    const hierarchyCoverage = new Set(hierarchyTasks.flatMap((task) => task.scope.editableIds));
    const targetCoverage = new Set(targetTasks.flatMap((task) => task.scope.editableIds));
    if (hierarchyEditableIds.size !== hierarchyCoverage.size
      || [...hierarchyEditableIds].some((id) => !hierarchyCoverage.has(id))
      || targetClasses.length !== targetCoverage.size
      || targetClasses.some((item) => !targetCoverage.has(item.id))) {
      throw new Error('分割範囲に漏れがあるため、送信を中止しました。選択範囲を小さくして再度依頼してください。');
    }
    const tasks = [...hierarchyTasks, ...targetTasks];
    if (scope.scopeCoverage === 'all_classes') {
      tasks.forEach((task, index) => {
        task.scope.scopeCoverage = 'all_classes_chunk';
        const input = JSON.parse(task.input);
        input.scopeCoverage = 'all_classes_chunk';
        input.coverageChunk = { index: index + 1, total: tasks.length };
        if (input.selectedScope?.kind === 'initial_snapshot') input.selectedScope.data.scopeCoverage = 'all_classes_chunk';
        input.instruction = `${input.instruction} 全体分析を上位クラス単位で分割処理中です。追加クラス情報を要求せず、この分割範囲だけを評価し、全体評価を終えたとは断定しないでください。`;
        task.input = JSON.stringify(input);
      });
    }
    tasks.forEach((task) => { task.contextCharacterCount = contextCharacterCount + promptOverhead; });
    return tasks;
  };
    const packAnalysisUnits = async (units, userText, conversation) => {
      const taskCharacterLimit = (Number(getMaxRequestCharacters()) || MAX_REQUEST_CHARACTERS) - (units[0]?.contextCharacterCount || 0);
      const mergeScopes = (left, right) => {
        const classesById = new Map([...left.classes, ...right.classes].map((item) => [item.id, item]));
        const relationsByKey = new Map([...left.relations, ...right.relations]
          .map((item) => [`${item.child}\u0000${item.parent}`, item]));
        return {
          mode: left.mode,
          scopeCoverage: 'all_classes_chunk',
          selectedIds: [...new Set([...left.selectedIds, ...right.selectedIds])],
          selectionRoots: [...new Set([...(left.selectionRoots || []), ...(right.selectionRoots || [])])],
          editableIds: [...new Set([...left.editableIds, ...right.editableIds])],
          classes: [...classesById.values()],
          relations: [...relationsByKey.values()],
          counts: { ...(left.counts || {}), ...(right.counts || {}) },
          sharedContextIds: [...new Set([...(left.sharedContextIds || []), ...(right.sharedContextIds || [])])],
          targetContext: {
            descendantTargetClassCounts: {
              ...(left.targetContext?.descendantTargetClassCounts || {}),
              ...(right.targetContext?.descendantTargetClassCounts || {})
            }
          },
          allowHierarchyEdits: Boolean(left.allowHierarchyEdits || right.allowHierarchyEdits)
        };
      };
      const makeBatch = (batchUnits) => {
        let scope = batchUnits[0].scope;
        batchUnits.slice(1).forEach((unit) => { scope = mergeScopes(scope, unit.scope); });
        const payload = JSON.parse(buildUserContent(userText, scope, conversation, {
          forceSnapshot: true,
          instruction: batchUnits[0].instruction
        }));
        if (batchUnits.some((unit) => JSON.parse(unit.input || '{}').crossScopeCandidateMode === true)) {
          payload.crossScopeCandidateMode = true;
        }
        payload.analysisGroups = batchUnits.map((unit) => ({
          key: unit.unitId,
          topClassId: unit.topClassId || null,
          editableIds: unit.scope.editableIds
        }));
        payload.instruction = `${payload.instruction} analysisGroupsごとに独立して評価し、応答でも各keyごとのmessage・proposals・questionsを返してください。別グループのクラスを同じ提案に混ぜないでください。`;
        const input = shortenInputIds(JSON.stringify(payload));
        return { kind: 'upper_class_batch', units: batchUnits, scope, input };
      };
      const batches = [];
      let pending = [];
      for (const unit of units) {
        await yieldToBrowser();
        const candidate = makeBatch([...pending, unit]);
        const editableIds = new Set(candidate.scope.editableIds);
        const editableTargetCount = candidate.scope.classes.filter((item) => item.type === 'class' && editableIds.has(item.id)).length;
        const maxUnitsPerBatch = Math.min(AI_TUNING_LIMITS.maxUnitsPerBatch.max, Math.max(AI_TUNING_LIMITS.maxUnitsPerBatch.min, Math.floor(Number(getMaxUnitsPerBatch()) || AI_TUNING_LIMITS.maxUnitsPerBatch.default)));
        const optimizationSplitThreshold = Math.min(AI_TUNING_LIMITS.optimizationSplitThreshold.max, Math.max(AI_TUNING_LIMITS.optimizationSplitThreshold.min, Math.floor(Number(getOptimizationSplitThreshold()) || AI_TUNING_LIMITS.optimizationSplitThreshold.default)));
        const exceedsGroupLimit = candidate.units.length > maxUnitsPerBatch;
        const exceedsOperationLimit = candidate.scope.allowHierarchyEdits && editableTargetCount > optimizationSplitThreshold;
        if (pending.length && (candidate.input.length > taskCharacterLimit || exceedsGroupLimit || exceedsOperationLimit)) {
          batches.push(makeBatch(pending));
          pending = [unit];
        } else if (candidate.input.length <= taskCharacterLimit && !exceedsGroupLimit && !exceedsOperationLimit) {
          pending = [...pending, unit];
        } else {
          throw new Error('上位クラスの分析単位を送信上限内にまとめられません。対象範囲を小さくしてください。');
        }
      }
      if (pending.length) batches.push(makeBatch(pending));
      return batches;
    };
    return { buildUserContent, makeLargeScopePlan, packAnalysisUnits };
};

// 分割回答と範囲根拠を統合し、カテゴリ別の横断比較状態も返します。
// チャンクの検証・提案・会話状態は呼び出し側が管理します。
export const createChunkSynthesizer = ({ MAX_REQUEST_CHARACTERS, getMaxRequestCharacters = () => MAX_REQUEST_CHARACTERS,
  getMaxRounds = () => AI_TUNING_LIMITS.synthesisMaxRounds.default }) => {
  const categoryKeys = ['duplicates', 'imbalance', 'gaps', 'other'];
  const insufficientComparison = (expectedScopes, requiredScopesByCategory, reason) => Object.fromEntries(categoryKeys.map((key) => [key, {
    status: 'insufficient',
    requiredScopes: requiredScopesByCategory[key] || [],
    assessedScopes: [],
    unassessedScopes: requiredScopesByCategory[key] || [],
    findings: [],
    limitation: reason
  }]));
  const buildInput = (request, sourceScopeCoverage, entries, round, expectedScopes, requiredScopesByCategory) => JSON.stringify({
    request,
    expectedScopeIds: expectedScopes,
    comparisonRequirements: requiredScopesByCategory,
    scopeCoverage: 'chunk_synthesis',
    sourceScopeCoverage,
    synthesisRound: round,
    comparisonRules: 'comparisonRequirementsがカテゴリごとの必須範囲です。別カテゴリの未完了チャンクを一律に必須扱いしません。所見ごとにrequiredScopesとassessedScopesを分け、所見を支える範囲だけを列挙します。未完了範囲は推測せず、完了範囲だけの所見を残し、全体結論へ一般化しません。',
    results: entries
  });

  const packInputs = (entries, round, request, sourceScopeCoverage, payloadLimit, expectedScopes, requiredScopesByCategory) => {
    const batches = [];
    let current = [];
    for (const entry of entries) {
      const candidate = [...current, entry];
      if (buildInput(request, sourceScopeCoverage, candidate, round, expectedScopes, requiredScopesByCategory).length <= payloadLimit) current = candidate;
      else {
        if (!current.length) return null;
        batches.push(current);
        current = [entry];
        if (buildInput(request, sourceScopeCoverage, current, round, expectedScopes, requiredScopesByCategory).length > payloadLimit) return null;
      }
    }
    if (current.length) batches.push(current);
    return batches;
  };

  const synthesize = async ({ request, sourceScopeCoverage, initialMessage, assessments, expectedScopeIds = [],
    requiredScopeIdsByCategory = null, warnings = [], prompt, fixedPromptCharacters = 0,
    send, onProgress = () => {}, onError = () => {} }) => {
    const expectedScopes = [...new Set(expectedScopeIds.length
      ? expectedScopeIds : assessments.flatMap((entry) => entry.requiredScopeIds || []))];
    const requiredScopesByCategory = Object.fromEntries(categoryKeys.map((key) => [key, [...new Set(
      Array.isArray(requiredScopeIdsByCategory?.[key]) ? requiredScopeIdsByCategory[key] : expectedScopes
    )]]));
    const payloadLimit = (Number(getMaxRequestCharacters()) || MAX_REQUEST_CHARACTERS) - fixedPromptCharacters;
    const failureResult = (message) => ({
      message,
      synthesisStatus: 'failed',
      comparison: insufficientComparison(expectedScopes, requiredScopesByCategory, '統合に失敗したため、横断比較結果を確定できません。')
    });
    const providedScopes = new Set(assessments.flatMap((entry) => entry.requiredScopeIds || []));
    const knownClasses = new Map();
    const knownClassScopes = new Map();
    const addKnownClass = (id, name, scopes) => {
      if (!id) return;
      knownClasses.set(id, name);
      if (!knownClassScopes.has(id)) knownClassScopes.set(id, new Set());
      scopes.forEach((scopeId) => knownClassScopes.get(id).add(scopeId));
    };
    assessments.forEach((entry) => {
      const entryScopes = entry.requiredScopeIds || [];
      (entry.scopeEvidence?.upperClasses || []).forEach((item) => addKnownClass(item.id, item.name, entryScopes));
      Object.values(entry.comparisonSummary || {}).forEach((category) => {
        (category?.findings || []).forEach((finding) => (finding.classes || [])
          .forEach((item) => addKnownClass(item.id, item.name, entryScopes)));
      });
    });
    const localJudgementIsComplete = (scopeId, key) => {
      const entry = assessments.find((item) => (item.requiredScopeIds || []).includes(scopeId));
      const judgment = entry?.comparisonSummary?.[key];
      return judgment?.status === 'none' && judgment.findings?.length === 0
        || judgment?.status === 'findings' && judgment.findings?.length > 0;
    };
    const validateComparison = (comparison) => Object.fromEntries(categoryKeys.map((key) => {
      const result = comparison?.[key];
      const requiredScopes = requiredScopesByCategory[key];
      const reportedRequiredScopes = Array.isArray(result?.requiredScopes) ? result.requiredScopes : [];
      const reportedAssessedScopes = Array.isArray(result?.assessedScopes) ? result.assessedScopes : [];
      const findings = Array.isArray(result?.findings) ? result.findings : [];
      const actualAssessedScopes = requiredScopes.filter((scopeId) => providedScopes.has(scopeId)
        && localJudgementIsComplete(scopeId, key));
      const unassessedScopes = requiredScopes.filter((scopeId) => !actualAssessedScopes.includes(scopeId));
      const sameRequiredScopes = requiredScopes.length === reportedRequiredScopes.length
        && requiredScopes.every((scopeId) => reportedRequiredScopes.includes(scopeId));
      const scopesAreKnown = [...reportedRequiredScopes, ...reportedAssessedScopes]
        .every((scopeId) => expectedScopes.includes(scopeId));
      const assessedScopesValid = reportedAssessedScopes.every((scopeId) => actualAssessedScopes.includes(scopeId));
      const allRequiredScopesAssessed = requiredScopes.length > 0
        && requiredScopes.every((scopeId) => actualAssessedScopes.includes(scopeId)
          && reportedAssessedScopes.includes(scopeId));
      const validFindings = findings.filter((finding) => {
        const findingRequiredScopes = finding.requiredScopes || [];
        const findingAssessedScopes = finding.assessedScopes || [];
        return findingRequiredScopes.length > 0
          && findingRequiredScopes.every((scopeId) => requiredScopes.includes(scopeId)
            && findingAssessedScopes.includes(scopeId) && actualAssessedScopes.includes(scopeId))
          && findingAssessedScopes.length > 0
          && findingAssessedScopes.every((scopeId) => actualAssessedScopes.includes(scopeId)
            && findingRequiredScopes.includes(scopeId))
          && (finding.classes || []).length > 0
          && finding.classes.every((item) => knownClasses.get(item.id) === item.name
            && findingAssessedScopes.some((scopeId) => knownClassScopes.get(item.id)?.has(scopeId)))
          && String(finding.evidence || '').trim().length > 0;
      });
      const evidenceIsValid = validFindings.length === findings.length;
      const categoryComplete = result?.status === 'comparable' && sameRequiredScopes && scopesAreKnown
        && assessedScopesValid && allRequiredScopesAssessed && evidenceIsValid;
      return [key, {
        status: categoryComplete ? 'comparable' : 'insufficient',
        requiredScopes,
        assessedScopes: actualAssessedScopes,
        unassessedScopes,
        findings: validFindings,
        limitation: categoryComplete
          ? result.limitation
          : (result?.limitation || 'カテゴリに必要な範囲または有効な判定が揃っていません。')
      }];
    }));

    const truncate = (value, limit) => String(value || '').slice(0, limit);
    const compactAssessments = (summaryLimit = 1000, findingLimit = 300, limitationLimit = 160, maxFindings = 4) => assessments.map((entry) => {
      const comparisonSummary = entry.comparisonSummary && Object.fromEntries(categoryKeys.map((key) => {
        const category = entry.comparisonSummary[key] || {};
        const allFindings = category.findings || [];
        const findings = allFindings.slice(0, maxFindings).map((finding) => {
          return { ...finding, text: truncate(finding.text, findingLimit), evidence: truncate(finding.evidence, findingLimit),
            limitations: truncate(finding.limitations, limitationLimit) };
        });
        return [key, { ...category, findingCount: allFindings.length, findings,
          limitation: truncate(category.limitation, limitationLimit) }];
      }));
      return {
        scopeId: entry.scopeId,
        scope: truncate(entry.scope, 160),
        scopeEvidence: { upperClasses: entry.scopeEvidence?.upperClasses || [],
          targetClassCounts: entry.scopeEvidence?.targetClassCounts || {} },
        comparisonSummary,
        summary: truncate(entry.summary || entry.message, summaryLimit)
      };
    });
    let entries = compactAssessments();
    let round = 1;
    const maxRounds = Math.min(AI_TUNING_LIMITS.synthesisMaxRounds.max,
      Math.max(AI_TUNING_LIMITS.synthesisMaxRounds.min, Math.floor(Number(getMaxRounds()) || AI_TUNING_LIMITS.synthesisMaxRounds.default)));
    const initialInput = prompt && entries.length ? buildInput(request, sourceScopeCoverage, entries, round, expectedScopes, requiredScopesByCategory) : '';
    let ready = payloadLimit > 0 && Boolean(initialInput) && initialInput.length <= payloadLimit;
    if (!ready && prompt && entries.length) ready = Boolean(packInputs(entries, round, request, sourceScopeCoverage, payloadLimit, expectedScopes, requiredScopesByCategory));
    // A single chunk can exceed the remaining synthesis budget even after the
    // normal compaction. Shrink its prose and evidence progressively so the
    // other chunks can still be synthesized instead of falling back to a raw
    // concatenation of their messages.
    for (const limits of [[700, 180, 100, 4], [400, 100, 60, 2], [200, 60, 40, 1]]) {
      if (ready || !prompt || !entries.length) break;
      entries = compactAssessments(...limits);
      ready = Boolean(packInputs(entries, round, request, sourceScopeCoverage, payloadLimit, expectedScopes, requiredScopesByCategory));
    }

    if (!ready) {
      onError(new Error('個別範囲の根拠を圧縮しても統合入力上限に収まりませんでした。'));
      return failureResult(initialMessage || '確認できた範囲の結果を表示しています。');
    }

    try {
      while (true) {
        if (round > maxRounds) throw new Error('分割回答の統合が所定回数で完了しませんでした。');
        const batches = packInputs(entries, round, request, sourceScopeCoverage, payloadLimit, expectedScopes, requiredScopesByCategory);
        if (!batches) throw new Error('分割回答の全文を統合入力に収められません。');
        const previousSize = entries.reduce((size, entry) => size + JSON.stringify(entry).length, 0);
        const merged = [];
        let finalComparison = null;
        for (let batchIndex = 0; batchIndex < batches.length; batchIndex += 1) {
          onProgress(batchIndex + 1, batches.length);
          const payload = buildInput(request, sourceScopeCoverage, batches[batchIndex], round, expectedScopes, requiredScopesByCategory);
          const synthesis = await send(payload, prompt);
          const text = String(synthesis.result.message || '').trim();
          if (!text) throw new Error('統合AIから文章が返りませんでした。');
          finalComparison = synthesis.result.comparison;
          merged.push({
            scope: batches.length > 1 ? `統合結果 ${batchIndex + 1}` : '統合結果',
            message: text,
            comparison: finalComparison,
            requiredScopeIds: batches[batchIndex].flatMap((entry) => entry.requiredScopeIds || [])
          });
        }
        if (merged.length === 1) {
          return {
            message: [merged[0].message, ...warnings].filter(Boolean).join('\n'),
            synthesisStatus: 'completed',
            comparison: validateComparison(finalComparison)
          };
        }
        const mergedSize = merged.reduce((size, entry) => size + JSON.stringify(entry).length, 0);
        if (merged.length >= entries.length && mergedSize >= previousSize) {
          throw new Error('分割回答の統合結果が小さくならなかったため、統合を中断しました。');
        }
        entries = merged;
        round += 1;
      }
    } catch (error) {
      onError(error);
      return failureResult(initialMessage || '確認できた範囲の結果を表示しています。');
    }
  };

  return { synthesize };
};

// 完了済み分割結果と全階層を使い、横断操作案だけを生成します。
export const createCrossScopeProposalSynthesizer = ({ MAX_REQUEST_CHARACTERS, getMaxRequestCharacters = () => MAX_REQUEST_CHARACTERS, shortenInputIds, createIdCodec }) => {
  const plan = ({ request, conversationContext = '', scope, fixedPromptCharacters = 0, strategy = 'exhaustive',
    candidateUpperClassLimit = 2, candidateMiddleClassLimit = 5, proposalFreedom = 5 }) => {
    candidateUpperClassLimit = Math.max(1, Math.min(5, Math.floor(Number(candidateUpperClassLimit) || 2)));
    candidateMiddleClassLimit = Math.max(1, Math.min(10, Math.floor(Number(candidateMiddleClassLimit) || 5)));
    const classById = new Map((scope.classes || []).map((item) => [item.id, item]));
    const rawEditableIds = scope.selectedEditableIds || [];
    if (new Set(rawEditableIds).size !== rawEditableIds.length) {
      return { status: 'incomplete', message: '横断確認の対象IDに重複があります。' };
    }
    const editableItems = rawEditableIds.map((id) => classById.get(id)).filter(Boolean);
    const hierarchyItems = (scope.classes || []).filter((item) => ['top', 'middle'].includes(item.type));
    if (editableItems.length !== new Set(scope.selectedEditableIds || []).size) {
      return { status: 'incomplete', message: '横断確認の対象クラス情報が揃っていません。' };
    }
    const roots = new Set(scope.selectedRoots || []);
    const parentByChild = new Map((scope.relations || []).map(({ child, parent }) => [child, parent]));
    const hierarchyById = new Map(hierarchyItems.map((item) => [item.id, item]));
    const moveCandidateInstruction = proposalFreedom <= 4
      ? `自由度${proposalFreedom}では、候補として渡された移動先の中から該当候補を探してください。${proposalFreedom === 1 ? '直接説明しにくい関連も仮説として候補にできます。' : 'クラス名と階層から関連を説明できる候補に限ります。'}該当候補があれば所属のずれを確定できなくても暫定的な移動操作を提案し、根拠と不確実性を示してください。候補が複数なら${proposalFreedom <= 3 ? '候補先ごとの代替案' : '適用可能な候補ごとの案'}を出します。該当候補がない対象だけ操作を作りません。`
      : '自由度5では、依頼に明示された移動だけを提案してください。';
    const topAncestorFor = (id) => {
      let currentId = id;
      const seen = new Set();
      while (currentId && !seen.has(currentId)) {
        seen.add(currentId);
        if (hierarchyById.get(currentId)?.type === 'top') return currentId;
        currentId = parentByChild.get(currentId);
      }
      return '';
    };
    const candidateHierarchyIdsByTarget = new Map();
    if (strategy === 'hierarchical') {
      const topItems = hierarchyItems.filter((item) => item.type === 'top');
      const middleItems = hierarchyItems.filter((item) => item.type === 'middle');
      const bigrams = (value) => {
        const chars = [...String(value || '').normalize('NFKC').toLocaleLowerCase().replace(/[\p{P}\p{Z}\p{S}]/gu, '')];
        if (chars.length < 2) return new Set(chars);
        return new Set(chars.slice(0, -1).map((char, index) => `${char}${chars[index + 1]}`));
      };
      const hierarchyTerms = new Map(hierarchyItems.map((item) => [item.id, bigrams(item.label)]));
      const similarity = (leftTerms, rightTerms) => {
        if (!leftTerms.size || !rightTerms.size) return 0;
        let shared = 0;
        leftTerms.forEach((term) => { if (rightTerms.has(term)) shared += 1; });
        return (2 * shared) / (leftTerms.size + rightTerms.size);
      };
      const middleByTop = new Map();
      middleItems.forEach((item) => {
        const topId = topAncestorFor(item.id);
        if (!middleByTop.has(topId)) middleByTop.set(topId, []);
        middleByTop.get(topId).push(item);
      });
      editableItems.forEach((target) => {
        const targetTerms = bigrams(target.label);
        const currentTopId = topAncestorFor(target.id);
        const branchScores = topItems.map((top) => ({
          top,
          score: Math.max(similarity(targetTerms, hierarchyTerms.get(top.id)),
            ...(middleByTop.get(top.id) || []).map((item) => similarity(targetTerms, hierarchyTerms.get(item.id))))
        }));
        const candidateTopIds = new Set();
        branchScores
          .filter(({ top, score }) => top.id !== currentTopId && score > 0)
          .sort((left, right) => right.score - left.score || String(left.top.id).localeCompare(String(right.top.id)))
          .slice(0, candidateUpperClassLimit)
          .forEach(({ top }) => candidateTopIds.add(top.id));
        const candidates = new Set(candidateTopIds);
        candidateTopIds.forEach((topId) => {
          const branchMiddles = middleByTop.get(topId) || [];
          branchMiddles
            .map((item) => ({ item, score: similarity(targetTerms, hierarchyTerms.get(item.id)) }))
            .filter(({ score }) => score > 0)
            .sort((left, right) => right.score - left.score || String(left.item.id).localeCompare(String(right.item.id)))
            .slice(0, candidateMiddleClassLimit)
            .forEach(({ item }) => candidates.add(item.id));
        });
        candidateHierarchyIdsByTarget.set(target.id, [...candidates]);
      });
    }
    const shortenInput = createIdCodec ? createIdCodec().shortenText : shortenInputIds;
    const batchInput = (batchId, targets, hierarchy, targetCandidates = null) => {
      const included = new Map();
      const add = (item, role) => {
        if (!item) return;
        const previous = included.get(item.id);
        included.set(item.id, { ...item, role: previous?.role === 'e' || role === 'e' ? 'e'
          : previous?.role === 'h' || role === 'h' ? 'h' : 'c' });
      };
      hierarchy.forEach((item) => add(item, 'h'));
      targets.forEach((item) => add(item, 'e'));
      roots.forEach((id) => add(classById.get(id), 'c'));
      targets.forEach((item) => add(classById.get(item.parentId || parentByChild.get(item.id)), 'c'));
      const selectedEditableIds = targets.map((item) => item.id);
      const selectedIds = [...new Set([...selectedEditableIds, ...[...roots].filter((id) => included.has(id))])];
      const classes = [...included.values()].map((item) => [item.id, item.type, item.label,
        item.parentId || parentByChild.get(item.id) || null, item.role, item.parentLabel || null]);
      const includedIds = new Set(included.keys());
      return JSON.stringify({
        request,
        conversationContext: conversationContext || undefined,
        scopeCoverage: 'cross_scope_operation_batch',
        operationStage: 'cross_scope_operation_synthesis',
        crossScopeBatch: {
          id: batchId,
          expectedEditableCount: targets.length,
          expectedHierarchyCount: hierarchy.length,
          ...(targetCandidates ? { targetCandidates: targets.map((item) => ({
            editableId: item.id,
            topIds: (targetCandidates.get(item.id) || []).filter((id) => hierarchyById.get(id)?.type === 'top'),
            middleIds: (targetCandidates.get(item.id) || []).filter((id) => hierarchyById.get(id)?.type === 'middle')
          })) } : {})
        },
        selectedScope: { kind: 'initial_snapshot', data: {
          mode: 'selected_scope', scopeCoverage: 'all_classes', selectedIds,
          selectionRoots: [...roots].filter((id) => includedIds.has(id)),
          editableIds: selectedEditableIds, classes,
          relations: (scope.relations || []).filter(({ child, parent }) => includedIds.has(child) && includedIds.has(parent)),
          counts: Object.fromEntries(Object.entries(scope.targetClassCounts || {}).filter(([id]) => includedIds.has(id))),
          allowHierarchyEdits: Boolean(scope.allowHierarchyEdits), allowProposals: Boolean(scope.allowProposals)
        } },
        instruction: strategy === 'hierarchical'
          ? `階層を使った移動先候補の検索です。同じ上位クラス内は分割評価で確認済みのため、この横断工程では各editableIdについてcrossScopeBatch.targetCandidatesのtopIdsとmiddleIdsだけを移動先候補として比較してください。候補は名称が近い別の上位クラス最大${candidateUpperClassLimit}件と、その配下で名称が近い中間クラス（各最大${candidateMiddleClassLimit}件）です。候補外の階層を網羅的に確認したとは扱いません。role=cは親や選択ルートの文脈です。入力にない移動先や関係は推測しません。${moveCandidateInstruction}変更元はeditableIdsのクラスだけにし、移動先はその対象に指定されたtopIdsまたはmiddleIds内の実在IDに限定します。allowHierarchyEditsがfalseなら対象クラスの移動以外を提案しません。質問は出さず、mに候補検索の限界を含む簡潔な判断、pに操作案、xにバッチIDと確認件数を返してください。`
          : `全体の横断操作検討です。このバッチに含まれるeditableIdsをすべて確認し、selectedScope.data.classesのrole=hで示された全top/middleを候補として比較してください。role=cは親や選択ルートの文脈であり、このバッチの判定対象数には含めません。アプリは全対象と全階層の組み合わせを漏れなくバッチ化しています。入力にない移動先や関係は推測しません。${moveCandidateInstruction}変更元はeditableIdsのクラスだけにし、移動先は入力中の実在IDに限定します。allowHierarchyEditsがfalseなら対象クラスの移動以外を提案しません。削除は配下全体を安全に編集できる場合だけにします。質問は出さず、mに簡潔な判断、pにこのバッチの操作案、xにバッチIDと実際に確認した件数を返してください。`
      });
    };
    const candidateIdsFor = (targets) => [...new Set(targets.flatMap((item) => candidateHierarchyIdsByTarget.get(item.id) || []))];
    const candidateItemsFor = (targets) => candidateIdsFor(targets).map((id) => hierarchyById.get(id)).filter(Boolean);
    const fits = (batchId, targets, hierarchy, targetCandidates = null) => shortenInput(batchInput(batchId, targets, hierarchy, targetCandidates)).length
      + fixedPromptCharacters <= (Number(getMaxRequestCharacters()) || MAX_REQUEST_CHARACTERS);
    const pack = (items, canFit) => {
      const groups = [];
      let current = [];
      for (const item of items) {
        const candidate = [...current, item];
        if (canFit(candidate)) current = candidate;
        else {
          if (!current.length || !canFit([item])) return null;
          groups.push(current);
          current = [item];
        }
      }
      if (current.length) groups.push(current);
      return groups;
    };
    const longestTarget = editableItems.reduce((longest, item) => JSON.stringify(item).length > JSON.stringify(longest || {}).length ? item : longest, null);
    const planningBatchId = 'cross_batch_999999';
    const hierarchyGroups = strategy === 'hierarchical'
      ? [null]
      : hierarchyItems.length
        ? pack(hierarchyItems, (group) => fits(planningBatchId, longestTarget ? [longestTarget] : [], group))
        : [[]];
    if (!hierarchyGroups) return { status: 'incomplete', message: '階層情報の一部を横断確認用の送信範囲に収められませんでした。' };
    const batches = [];
    let expectedPairs = 0;
    const expectedEditableIdSet = new Set(editableItems.map((item) => item.id));
    const coveredHierarchyIds = new Set();
    for (const hierarchyGroup of hierarchyGroups) {
      const hierarchy = hierarchyGroup || [];
      const isCandidateSearch = strategy === 'hierarchical';
      if (hierarchy.some((item) => coveredHierarchyIds.has(item.id))) {
        return { status: 'incomplete', message: '階層範囲が複数の横断確認バッチに重複しています。' };
      }
      hierarchy.forEach((item) => coveredHierarchyIds.add(item.id));
      const hierarchyForTargets = (targets) => isCandidateSearch ? candidateItemsFor(targets) : hierarchy;
      const targetGroups = pack(editableItems, (group) => fits(planningBatchId, group, hierarchyForTargets(group),
        isCandidateSearch ? candidateHierarchyIdsByTarget : null));
      if (!targetGroups) return { status: 'incomplete', message: '選択対象を横断確認用の送信範囲に収められませんでした。' };
      const coveredEditableIds = new Set();
      for (const targets of targetGroups) {
        if (targets.some((item) => coveredEditableIds.has(item.id))) {
          return { status: 'incomplete', message: '選択対象が複数の横断確認バッチに重複しています。' };
        }
        targets.forEach((item) => coveredEditableIds.add(item.id));
        const batchId = `cross_${batches.length + 1}`;
        const batchHierarchy = hierarchyForTargets(targets);
        if (!fits(batchId, targets, batchHierarchy, isCandidateSearch ? candidateHierarchyIdsByTarget : null)) {
          return { status: 'incomplete', message: '横断確認用の送信範囲を上限内に分割できませんでした。' };
        }
        const pairCount = isCandidateSearch
          ? targets.reduce((total, item) => total + (candidateHierarchyIdsByTarget.get(item.id) || []).length, 0)
          : targets.length * batchHierarchy.length;
        expectedPairs += pairCount;
        batches.push({ id: batchId, expectedEditableCount: targets.length, expectedHierarchyCount: batchHierarchy.length,
          expectedPairCount: pairCount,
          editableIds: targets.map((item) => item.id), hierarchyIds: batchHierarchy.map((item) => item.id),
          ...(isCandidateSearch ? { candidateHierarchyIdsByEditable: Object.fromEntries(targets.map((item) => [
            item.id, candidateHierarchyIdsByTarget.get(item.id) || []
          ])) } : {}),
          input: batchInput(batchId, targets, batchHierarchy, isCandidateSearch ? candidateHierarchyIdsByTarget : null) });
      }
      if (coveredEditableIds.size !== expectedEditableIdSet.size
        || [...expectedEditableIdSet].some((id) => !coveredEditableIds.has(id))) {
        return { status: 'incomplete', message: '選択対象の横断確認範囲に不足があります。' };
      }
    }
    const expectedTotalPairs = strategy === 'hierarchical'
      ? editableItems.reduce((total, item) => total + (candidateHierarchyIdsByTarget.get(item.id) || []).length, 0)
      : editableItems.length * hierarchyItems.length;
    const expectedHierarchyCount = strategy === 'hierarchical'
      ? new Set([...candidateHierarchyIdsByTarget.values()].flat()).size
      : hierarchyItems.length;
    const assignedEditableIds = new Set(editableItems.map((item) => item.id));
    if (assignedEditableIds.size !== editableItems.length
      || (strategy !== 'hierarchical' && (coveredHierarchyIds.size !== hierarchyItems.length
        || hierarchyItems.some((item) => !coveredHierarchyIds.has(item.id))))
      || expectedPairs !== expectedTotalPairs || batches.some((batch) => new Set(batch.editableIds).size !== batch.editableIds.length
        || new Set(batch.hierarchyIds).size !== batch.hierarchyIds.length)) {
      return { status: 'incomplete', message: '横断確認バッチの範囲に重複または不足があります。' };
    }
    return { status: 'completed', strategy, candidateUpperClassLimit, candidateMiddleClassLimit, batches,
      expectedEditableCount: editableItems.length, expectedHierarchyCount,
      expectedPairCount: expectedTotalPairs };
  };
  const synthesize = async ({ plan: batchPlan, send, concurrency = 2 }) => {
    if (!batchPlan || batchPlan.status !== 'completed') {
      return { status: 'incomplete', message: batchPlan?.message || '横断確認の分割計画を作成できませんでした。' };
    }
    const expectedBatchIds = new Set(batchPlan.batches.map((batch) => batch.id));
    if (expectedBatchIds.size !== batchPlan.batches.length) {
      return { status: 'incomplete', message: '横断確認バッチIDに重複があります。' };
    }
    const batchResults = new Array(batchPlan.batches.length);
    let nextBatchIndex = 0;
    let failure = null;
    const processNextBatch = async () => {
      while (!failure) {
        const index = nextBatchIndex;
        nextBatchIndex += 1;
        if (index >= batchPlan.batches.length) return;
        const batch = batchPlan.batches[index];
        try {
          const response = await send(batch.input, batch.id, batchPlan.batches.length);
          const result = response.result;
          const coverage = result?.crossScopeCoverage;
          if (!coverage || coverage.batchId !== batch.id
            || coverage.evaluatedEditableCount !== batch.expectedEditableCount
            || coverage.reviewedHierarchyCount !== batch.expectedHierarchyCount
            || coverage.unassessedEditableCount !== 0) {
            failure = { status: 'incomplete', message: '一部の横断確認バッチで対象件数または完了状態を照合できませんでした。' };
            return;
          }
          if (batchPlan.strategy === 'hierarchical') {
            result.proposals.forEach((proposal) => {
              proposal.operations = proposal.operations.filter((operation) => operation.type !== 'moveClass'
                || (batch.candidateHierarchyIdsByEditable[operation.classId] || []).includes(operation.destinationId));
            });
          }
          batchResults[index] = result;
        } catch (error) {
          if (error?.name === 'AbortError') failure = { error };
          else if (/送信入力が上限を超えました/.test(error?.message || '')) {
            failure = { status: 'incomplete', message: '一部の横断確認バッチが実際の送信上限を超えました。' };
          } else failure = { status: 'failed', error };
          return;
        }
      }
    };
    const workerCount = Math.min(4, Math.max(1, Math.floor(Number(concurrency) || 2)), batchPlan.batches.length);
    await Promise.all(Array.from({ length: workerCount }, () => processNextBatch()));
    if (failure?.error?.name === 'AbortError') throw failure.error;
    if (failure) return failure;

    const completedBatchIds = new Set();
    const proposals = [];
    let completedPairCount = 0;
    batchPlan.batches.forEach((batch, index) => {
      if (!batchResults[index] || completedBatchIds.has(batch.id)) return;
      completedBatchIds.add(batch.id);
      completedPairCount += Number.isInteger(batch.expectedPairCount)
        ? batch.expectedPairCount : batch.expectedEditableCount * batch.expectedHierarchyCount;
      batchResults[index].proposals.forEach((proposal, proposalIndex) => proposals.push({ ...proposal,
        id: `${batch.id}_${proposalIndex + 1}_${proposal.id}` }));
    });
    if (completedBatchIds.size !== expectedBatchIds.size || completedPairCount !== batchPlan.expectedPairCount) {
      return { status: 'incomplete', message: '必要な横断確認バッチがすべて完了していません。' };
    }
    return { status: 'completed', result: {
      message: batchPlan.strategy === 'hierarchical'
        ? `対象${batchPlan.expectedEditableCount}件について、階層構造と名称から選んだ移動先候補を確認しました。候補を網羅する比較ではありません。`
        : `選択対象${batchPlan.expectedEditableCount}件と階層${batchPlan.expectedHierarchyCount}件の全組み合わせを横断確認しました。`,
      proposals, questions: [], dataRequests: [],
      crossScopeCoverage: { evaluatedEditableCount: batchPlan.expectedEditableCount,
        reviewedHierarchyCount: batchPlan.expectedHierarchyCount, unassessedEditableCount: 0 }
    } };
  };
  return { plan, synthesize };
};

// 選択範囲と全体参照設定に合わせて、プロンプト例を絞り込みます。
export const filterPromptExamples = (examples, context) => examples.filter((example) => {
  const condition = example?.showWhen;
  if (!condition || condition.always) return true;
  if (condition.unclassified && !context.unclassifiedSelected) return false;
  if (condition.fullGraph && !context.fullGraph) return false;
  if (Number.isFinite(condition.minSelected) && context.selectedCount < condition.minSelected) return false;
  if (condition.selectionTypes?.some((type) => !context.selectedTypes.has(type))) return false;
  if (condition.differentParents && !context.differentParents) return false;
  return true;
});

// 送信と全体範囲の再試行を、画面状態から独立した処理として扱います。
export const createRequestSender = ({ responsesClient, responseHandler, apiKey, model, systemPrompt, proposalPolicy, evaluationMode = false,
  signal, baseDataHash, scopeCoverage, maxOutputTokens, modelMaxOutputTokens = 128000, defaultStage, onStage, onUsage }) => {
  const send = (input, previousResponseId = '', outputTokens = maxOutputTokens,
    stage = defaultStage, grouped = false, summaryOnly = false, promptOverride = '', comparisonSynthesis = false) => {
    const modelLimit = Number.isInteger(Number(modelMaxOutputTokens)) && Number(modelMaxOutputTokens) > 0
      ? Math.min(128000, Number(modelMaxOutputTokens)) : 128000;
    const requestedLimit = Math.floor(Number(outputTokens) || Number(maxOutputTokens) || 1);
    const boundedOutputTokens = Math.min(modelLimit, Math.max(1, requestedLimit));
    return responsesClient.send(input, {
      apiKey, model, systemPrompt, previousResponseId, maxOutputTokens: boundedOutputTokens,
      stage, grouped, summaryOnly, comparisonSynthesis, promptOverride, signal, onStage, onUsage
    });
  };
  const retryCompleteScopeDataRequest = async (response, isChunk = false) => {
    responseHandler.validatePayload(response.result, baseDataHash);
    if (scopeCoverage !== 'all_classes' || !response.result.dataRequests.length) return response;
    if (!response.responseBody.id) throw new Error('修正回答の会話IDを取得できませんでした。');
    const correctionInput = JSON.stringify({
      request: evaluationMode
        ? '前回の回答を修正してください。共有済みの範囲を評価・説明し、変更案や確認質問を出さず、判断できない点は理由とともに説明してください。'
        : isChunk
        ? '前回の回答を修正してください。全上位・中間クラスと選択中クラスの情報を複数のリクエストに分割して処理中です。今回の入力はその一部なので、追加のクラス情報は要求せず、この範囲だけを評価してください。全体評価を終えたとは断定せず、最初の利用者依頼に沿って回答してください。'
        : '前回の回答を修正してください。全上位・中間クラスと選択中クラスのID・種別・名称・親子関係はすでに共有されています。追加のクラス情報は要求せず、最初の利用者依頼に対して、受け取った情報から判断できる範囲で評価・説明・変更案を返してください。実データや件数がないため判断できない点は、その限界を説明してください。',
      scopeCoverage: isChunk ? 'all_classes_chunk' : 'all_classes',
      proposalPolicy,
      responsePolicy: evaluationMode
        ? 'dataRequestsとquestionsは必ず空配列にしてください。追加データや確認を求めず、判断できない点はmessageに説明してください。'
        : 'dataRequestsは必ず空配列にしてください。追加クラス情報をmessageやquestionsで要求してはいけません。ユーザーの意図や希望する変更方針の確認だけはquestionsで尋ねられます。'
    });
    const corrected = await send(correctionInput, response.responseBody.id || '');
    responseHandler.validatePayload(corrected.result, baseDataHash);
    if (corrected.result.dataRequests.length) {
      corrected.result = {
        ...corrected.result,
        message: '全上位・中間クラス情報を使った回答を作成できませんでした。追加データは要求せず、クラス構造から判断できる範囲で改めて依頼してください。',
        proposals: [], questions: [], dataRequests: []
      };
      corrected.repairFailed = true;
    }
    return corrected;
  };
  return { send, retryCompleteScopeDataRequest };
};

