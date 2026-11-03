// 現在の選択範囲を依頼JSONへ変換し、大きすぎる範囲を処理単位へ分割します。
// scope固有の指示はJSON内に一時的に載せ、送信層が固定プロンプトの後ろへ移します。
export const createRequestPlanner = ({ editor, MAX_REQUEST_CHARACTERS, diffScope, shortenInputIds }) => {
  // 通常依頼では前回スナップショットとの差分を使い、初回・強制更新では全体を送ります。
  const buildUserContent = (userText, activeScope, conversation, options = {}) => {
    const usePrevious = !options.forceSnapshot && conversation.initialSnapshotSent && conversation.responseId;
    const previousScope = usePrevious ? conversation.previousScope : null;
    const scopeInstruction = activeScope.scopeCoverage === 'all_classes'
      ? '全体構造が入力されています。追加クラス情報を要求しないでください。'
      : activeScope.scopeCoverage === 'all_classes_chunk'
        ? '全体構造を分割処理中です。今回の範囲だけを評価し、全体評価を終えたと断定せず、追加クラス情報を要求しないでください。'
        : '入力範囲外のクラス情報を推測せず、必要なら追加の上位・中間クラスだけをdataRequestsで求めてください。';
    const instruction = options.instruction || (activeScope.mode === 'hierarchy_scope'
      ? '階層クラスだけの範囲です。上位・中間クラスの追加・改名・移動・削除を提案できますが、対象クラスの操作は禁止です。上位を中間へ移す場合は配下の親子関係を保ってください。'
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
  const makeLargeScopePlan = (userText, scope, conversation) => {
    const selectionRoots = scope.selectionRoots || scope.selectedIds;
    const selectedRootClasses = selectionRoots.map((id) => scope.classes.find((item) => item.id === id)).filter(Boolean);
    const isHierarchySelection = selectedRootClasses.length === selectionRoots.length
      && selectedRootClasses.length > 0
      && selectedRootClasses.every((item) => ['top', 'middle'].includes(item.type));
    if (!isHierarchySelection) {
      const selectedTargets = scope.classes.filter((item) => item.type === 'class' && scope.editableIds.includes(item.id));
      const hierarchyClasses = scope.classes.filter((item) => ['top', 'middle'].includes(item.type));
      if (!scope.includeAllClasses || !selectedTargets.length || selectedTargets.length !== scope.editableIds.length || !hierarchyClasses.length) return null;
      const hierarchyIds = new Set(hierarchyClasses.map((item) => item.id));
      const targetInstruction = 'この分割範囲では選択中の対象クラスを評価し、対象クラスの移動を提案できます。利用者が中間クラスの作成・新設を求めている場合は、入力中の上位・中間クラスを親とするaddClass（classType=middle）を提案し、対象クラスを同じ提案内でその新設クラスへ移動できます。親は入力中の実在する上位・中間クラスIDか、先に追加した中間クラスのtemporaryIdにし、親となる新しいクラスを先に追加してください。既存の上位・中間クラスの改名・移動・削除や、入力にないクラス・関係の推測は禁止します。各チャンク内のクラス名だけで全体に共通する分類を断定せず、チャンクの範囲で根拠を説明してください。';
      const buildTargetTask = (targets) => {
        const targetIds = new Set(targets.map((item) => item.id));
        const includedIds = new Set([...hierarchyIds, ...targetIds]);
        const taskScope = {
          mode: 'selected_scope',
          scopeCoverage: 'all_classes_chunk',
          selectedIds: scope.selectedIds.filter((id) => targetIds.has(id)),
          selectionRoots: targets.map((item) => item.id),
          editableIds: targets.map((item) => item.id),
          classes: [...hierarchyClasses, ...targets],
          relations: scope.relations.filter(({ child, parent }) => includedIds.has(child) && includedIds.has(parent)),
          counts: Object.fromEntries([...includedIds].filter((id) => Object.prototype.hasOwnProperty.call(scope.counts || {}, id)).map((id) => [id, scope.counts[id]]))
        };
        const input = buildUserContent(userText, taskScope, conversation, {
          forceSnapshot: true,
          instruction: targetInstruction
        });
        return { kind: 'full_hierarchy_targets', scope: taskScope, input };
      };
      const targetTasks = [];
      let offset = 0;
      while (offset < selectedTargets.length) {
        let low = 1; let high = selectedTargets.length - offset; let bestSize = 0; let bestTask = null;
        while (low <= high) {
          const size = Math.floor((low + high) / 2);
          const candidate = buildTargetTask(selectedTargets.slice(offset, offset + size));
          if (candidate.input.length <= MAX_REQUEST_CHARACTERS) {
            bestSize = size; bestTask = candidate; low = size + 1;
          } else high = size - 1;
        }
        if (!bestSize || !bestTask) {
          throw new Error('全上位・中間クラスの情報と対象クラス1件を送信上限内に収められません。対象クラスの選択範囲を小さくするか、全体参照をOFFにしてください。');
        }
        targetTasks.push(bestTask);
        offset += bestSize;
      }
      return targetTasks;
    }

    const hierarchyScope = editor.getHierarchyScopedState(scope.selectedIds);
    if (!hierarchyScope) return null;
    const hierarchyInstruction = 'この分割範囲では上位・中間クラスの追加・改名・移動・削除を提案できます。対象クラスの個別IDや全件情報は含まれません。targetContextに対象クラス数がある場合は読み取り専用の参考として使えますが、対象クラスの変更案は作らず、入力にない情報を推測しないでください。この制約は今回の階層分割範囲だけに適用し、AIシステム全体が対象クラスの移動しかできないなどと説明してはいけません。selectionRootsの上位クラスは中間クラスへ移動できます。その場合は上位を中間化し、配下の親子関係を保って移動してください。';
    const hierarchyClasses = scope.classes.filter((item) => ['top', 'middle'].includes(item.type));
    const hierarchyChunkLimit = MAX_REQUEST_CHARACTERS;
    const parentByChild = new Map(scope.relations.map(({ child, parent }) => [child, parent]));
    const hierarchyById = new Map(hierarchyClasses.map((item) => [item.id, item]));
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
      const taskScope = {
        mode: 'hierarchy_scope',
        selectedIds: scope.selectedIds.filter((id) => includedIds.has(id)),
        selectionRoots: (scope.selectionRoots || scope.selectedIds).filter((id) => includedIds.has(id)),
        editableIds: [...editableIds],
        classes: hierarchyClasses.filter((item) => includedIds.has(item.id)),
        relations: scope.relations.filter(({ child, parent }) => includedIds.has(child) && includedIds.has(parent)),
        counts: {},
        targetContext: {
          descendantTargetClassCounts: Object.fromEntries(Object.entries(scope.targetContext?.descendantTargetClassCounts || {}).filter(([id]) => includedIds.has(id)))
        }
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
    const partitionHierarchySubtree = (rootId) => {
      const subtreeIds = collectRemainingSubtree(rootId);
      if (!subtreeIds.size) return;
      const candidate = makeHierarchyTask([...subtreeIds]);
      if (candidate.input.length <= hierarchyChunkLimit) {
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
      (childrenByParent.get(rootId) || []).filter((id) => remainingHierarchyIds.has(id)).forEach(partitionHierarchySubtree);
    };
    hierarchyScope.selectedIds.forEach((id) => {
      if (remainingHierarchyIds.has(id)) partitionHierarchySubtree(id);
    });
    [...remainingHierarchyIds].forEach(partitionHierarchySubtree);

    // Pack small hierarchy branches together so they do not each require a separate API call.
    const packedHierarchyTasks = [];
    let pendingHierarchyScope = null;
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
    hierarchyTasks.forEach((task) => {
      const candidateScope = pendingHierarchyScope ? mergeHierarchyScopes(pendingHierarchyScope, task.scope) : task.scope;
      const candidateTask = buildHierarchyTask(candidateScope);
      if (pendingHierarchyScope && candidateTask.input.length > hierarchyChunkLimit) {
        packedHierarchyTasks.push(buildHierarchyTask(pendingHierarchyScope));
        pendingHierarchyScope = task.scope;
      } else {
        pendingHierarchyScope = candidateScope;
      }
    });
    if (pendingHierarchyScope) packedHierarchyTasks.push(buildHierarchyTask(pendingHierarchyScope));
    hierarchyTasks.splice(0, hierarchyTasks.length, ...packedHierarchyTasks);

    const targetClasses = scope.classes.filter((item) => item.type === 'class' && scope.editableIds.includes(item.id));
    const targetInstruction = 'この分割範囲に含まれる対象クラスだけを評価してください。この範囲で許可する操作は対象クラスの移動だけです。上位・中間クラスの追加・改名・移動・削除や、入力にない対象クラスの操作は提案しないでください。移動先は入力にある上位・中間クラスのIDだけを使ってください。この制約は今回の対象クラス分割範囲だけに適用されます。AIシステム全体が上位・中間クラスを再編できない、または新しい中間クラスを作成できないと説明してはいけません。階層の再編が今回必要だが入力に階層クラスがない場合は、今回の範囲に階層情報がないため別途階層クラスの選択が必要だと説明してください。';
    const targetTasks = [];
    const targetUnits = [];
    const targetOperationInstruction = 'この分割範囲に含まれる対象クラスと対応する上位・中間クラスを評価してください。既存の対象クラスを移動するだけでなく、利用者が求める場合は新しい中間クラスを作成して対象クラスを割り当ててください。新しい中間クラスはaddClass（classType=middle）で追加し、parentIdには入力中の上位・中間クラスID、または先に追加した中間クラスのtemporaryIdを使います。中間クラスを別の新しい中間クラスの下に作る場合は親を先に追加してください。必要な対象クラスは同じ提案内でmoveClassし、destinationIdには入力中の上位・中間クラスIDか同じ提案で追加した中間クラスのtemporaryIdを指定してください。既存の上位・中間クラスの改名・移動・削除は提案しません。入力にない対象クラスや親子関係は推測せず、この分割範囲を超えた全体判断は保留してください。この制約は今回の対象クラス分割範囲だけに適用され、全体として新設が不要と結論するには全チャンクの評価を使ってください。';
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

    const makeTargetScope = (units) => {
      const targets = units.map((unit) => unit.target);
      const targetIds = new Set(targets.map((item) => item.id));
      const hierarchyByIdLocal = new Map(hierarchyClasses.map((item) => [item.id, item]));
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
    const buildTargetTask = (units) => {
      const taskScope = makeTargetScope(units);
      const input = buildUserContent(userText, taskScope, conversation, {
        forceSnapshot: true,
        instruction: targetOperationInstruction
      });
      return { kind: 'targets', scope: taskScope, input };
    };
    // Fill each target request as much as possible. Binary search finds the largest
    // contiguous batch that remains within the request limit, minimizing call count.
    let targetOffset = 0;
    while (targetOffset < targetUnits.length) {
      const remaining = targetUnits.length - targetOffset;
      let low = 1; let high = remaining; let bestSize = 0; let bestTask = null;
      while (low <= high) {
        const size = Math.floor((low + high) / 2);
        const candidate = buildTargetTask(targetUnits.slice(targetOffset, targetOffset + size));
        if (candidate.input.length <= MAX_REQUEST_CHARACTERS) {
          bestSize = size; bestTask = candidate; low = size + 1;
        } else high = size - 1;
      }
      if (!bestSize || !bestTask) {
        throw new Error('対象クラス1件と移動先候補だけでも送信上限を超えています。選択範囲を小さくするか、クラス名の長い範囲を分けてください。');
      }
      targetTasks.push(bestTask);
      targetOffset += bestSize;
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
        input.instruction = `${input.instruction} 全上位・中間クラスと選択中クラスの分割処理中です。追加クラス情報を要求せず、この分割範囲だけを評価し、全体評価を終えたとは断定しないでください。`;
        task.input = JSON.stringify(input);
      });
    }
    return tasks;
  };
    return { buildUserContent, makeLargeScopePlan };
};
