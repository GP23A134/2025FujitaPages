import { createJobCheckpoint, normalizeJobCheckpoint, runJobLoop } from '../../application/job-loop.js';

const DELETE_BATCH_SIZE = 100;
const ref = (id) => ({ kind: 'existing_class', classId: id, tempId: null });
const dedupe = (items) => [...new Set(items)];
const readText = (response) => (response?.output || []).flatMap((item) => item.content || [])
  .find((item) => item.type === 'output_text')?.text || '';

function pagesPhase({ id, ids, reader, read, budgetGuard, onProgress, tool, note }) {
  const size = Math.max(1, Number(reader.pageLimit) || 100);
  const pageCount = Math.max(1, Math.ceil((ids?.length || 0) / size));
  return {
    id,
    units: Array.from({ length: pageCount }, (_, index) => ({
      id: `page-${index + 1}`,
      cursor: reader.createPageCursor?.(id === 'target-snapshot' ? 'selected_class_details' : 'hierarchy_index', index * size) || null
    })),
    async execute(unit) {
      budgetGuard.countRetrieval();
      onProgress({ stage: 'retrieving', tool, note });
      return read(unit.cursor).items || [];
    },
    validate(unit, result) {
      return Array.isArray(result) && result.every((item) => typeof item?.id === 'string') ? true : `取得ページ${unit.id}が不正です。`;
    },
    validatePhase(results) {
      const idsInResults = results.flatMap((unit) => unit.result || []).map((item) => item.id);
      return idsInResults.length === new Set(idsInResults).size ? true : '取得ページの間に重複があります。';
    }
  };
}

export function createHierarchyDeletionJob({
  reader, client, budgetGuard, model, apiKey, request, plan, maxOutputTokens, signal,
  onProgress = () => {}, onUsage = () => {}, onCheckpoint = async () => {},
  jobCheckpoint = null, dataVersion = '', jobRequest = '', jobScopeIds = [],
  jobSelectedIds = [], jobHierarchyIds = [], continuationInput = ''
}) {
  if (!reader?.readHierarchyIndex || !reader?.readSelectedClassDetails || !client?.request || !budgetGuard) {
    throw new TypeError('クラス削除ジョブに必要な依存関係が不足しています。');
  }
  const scopeIds = dedupe(jobScopeIds);
  const selectedIds = dedupe(jobSelectedIds);
  const hierarchyIds = dedupe(jobHierarchyIds);
  const deleteOperations = (plan.changeOperations || []).filter((item) => ['delete_top_class', 'delete_middle_class'].includes(item));
  let activeJob = normalizeJobCheckpoint(jobCheckpoint);

  async function askAI(input, name, schema) {
    if (signal?.aborted) throw signal.reason || Object.assign(new Error('処理が中断されました。'), { name: 'AbortError' });
    const responseSlot = budgetGuard.reserveResponseSlot
      ? await budgetGuard.reserveResponseSlot()
      : (await budgetGuard.assertResponseAllowed(), null);
    const options = { model, input, max_output_tokens: maxOutputTokens, textFormat: { type: 'json_schema', name, strict: true, schema } };
    let reservation;
    try { reservation = await (budgetGuard.reserveInputWithApproval || budgetGuard.reserveInput).call(budgetGuard, options); }
    catch (error) { if (responseSlot) budgetGuard.releaseResponse?.(responseSlot); throw error; }
    let response;
    try { response = await client.request({ apiKey, model, input, maxOutputTokens, textFormat: options.textFormat, signal }); }
    catch (error) {
      if (responseSlot) budgetGuard.releaseResponse?.(responseSlot);
      budgetGuard.reconcileInput(reservation, null);
      throw error;
    }
    budgetGuard.countResponse(responseSlot);
    const usage = await (budgetGuard.reconcileInputWithApproval || budgetGuard.reconcileInput).call(budgetGuard, reservation, response.usage?.input_tokens);
    onUsage({ model, usage: response.usage || null });
    if (usage.overBudget) throw Object.assign(new Error('削除ジョブが累積入力トークン上限に達しました。'), { code: 'INPUT_TOKEN_BUDGET_ACTUAL', status: 'budget_exhausted' });
    let result;
    try { result = JSON.parse(readText(response)); }
    catch { throw Object.assign(new Error('削除ジョブのAI応答を読み取れませんでした。'), { code: 'INVALID_DELETE_JOB_RESPONSE' }); }
    return result;
  }

  const phaseRows = (phaseId) => activeJob?.phases.find((phase) => phase.id === phaseId)?.units.flatMap((unit) => unit.result || []) || [];
  const persist = async (checkpoint) => { activeJob = checkpoint; await onCheckpoint(checkpoint); };

  async function run() {
    const saved = activeJob;
    const sameJob = saved?.kind === 'hierarchy_deletion' && saved.request === (jobRequest || request);
    const sortedScope = [...scopeIds].sort((a, b) => a.localeCompare(b));
    if (sameJob && saved.dataVersion !== dataVersion) return { status: 'stale_job', message: '保存済み削除ジョブのデータ版が異なるため続行できません。' };
    if (sameJob && JSON.stringify(saved.scopeIds) !== JSON.stringify(sortedScope)) return { status: 'stale_job', message: '保存済み削除ジョブの変更範囲が現在と異なるため続行できません。' };
    if (sameJob && JSON.stringify(saved.metadata.selectedIds || []) !== JSON.stringify(selectedIds)) return { status: 'stale_job', message: '保存済み削除ジョブの対象範囲が現在と異なるため続行できません。' };
    if (sameJob) {
      const prior = saved.metadata.hierarchyIds || [];
      if (!prior.every((id) => hierarchyIds.includes(id))) return { status: 'stale_job', message: '保存済み削除ジョブの参照範囲が現在と異なるため続行できません。' };
      if (prior.length !== hierarchyIds.length || saved.metadata.selectionVersion !== 2) activeJob = normalizeJobCheckpoint({
        ...saved, status: 'running', metadata: { ...saved.metadata, hierarchyIds, selectionVersion: 2 },
        phases: saved.phases.filter((phase) => phase.id === 'target-snapshot'), updatedAt: Date.now(), completedAt: null
      });
      if (continuationInput) activeJob.metadata.userGuidance = [...(activeJob.metadata.userGuidance || []), continuationInput].slice(-10);
    }
    if (!sameJob) activeJob = createJobCheckpoint({
      id: globalThis.crypto?.randomUUID?.() || `delete-${Date.now()}`,
      kind: 'hierarchy_deletion', request: jobRequest || request, dataVersion,
      scopeIds: sortedScope, metadata: { selectedIds, hierarchyIds, executionMode: 'deletion', deleteOperations, userGuidance: [], selectionVersion: 2 }
    });

    const targetPhase = pagesPhase({
      id: 'target-snapshot', ids: selectedIds, reader,
      read: (cursor) => reader.readSelectedClassDetails({ cursor }), budgetGuard, onProgress,
      tool: 'read_selected_class_details', note: '削除対象の配下を含むクラス範囲を取得しています'
    });
    const hierarchyPhase = pagesPhase({
      id: 'hierarchy-snapshot', ids: hierarchyIds, reader,
      read: (cursor) => reader.readHierarchyIndex({ cursor }), budgetGuard, onProgress,
      tool: 'read_hierarchy_index', note: '削除後の移動先候補を取得しています'
    });
    const targetRows = () => phaseRows('target-snapshot');
    const hierarchyRows = () => phaseRows('hierarchy-snapshot');
    const hierarchyById = () => new Map(hierarchyRows().map((item) => [item.id, item]));

    let snapshots;
    const hasDownstreamPhases = activeJob?.phases.some((phase) => phase.id !== 'target-snapshot' && phase.id !== 'hierarchy-snapshot');
    const snapshotsAlreadyComplete = ['target-snapshot', 'hierarchy-snapshot'].every((id) => {
      const phase = activeJob?.phases.find((item) => item.id === id);
      return phase?.status === 'completed' && phase.units.every((unit) => unit.status === 'completed');
    });
    if (hasDownstreamPhases && snapshotsAlreadyComplete) snapshots = { status: 'completed', checkpoint: activeJob };
    else {
      try { snapshots = await runJobLoop({ checkpoint: activeJob, dataVersion, signal, phases: [targetPhase, hierarchyPhase], onCheckpoint: persist, onProgress }); }
      catch (error) {
        if (error.scopeRequest) return { status: 'needs_scope_approval', scopeRequest: error.scopeRequest, checkpoint: activeJob };
        throw error;
      }
    }
    activeJob = snapshots.checkpoint;
    if (snapshots.status === 'needs_scope_approval') return { status: 'needs_scope_approval', scopeRequest: snapshots.scopeRequest, checkpoint: activeJob };
    if (snapshots.status !== 'completed') return {
      status: snapshots.status, checkpoint: activeJob, budgetLimited: snapshots.status === 'paused',
      text: JSON.stringify({ message: `削除ジョブの対象取得を一時停止しました。${snapshots.error?.message || '未完了ページから再開できます。'}`, proposals: [], alternativeGroups: [] }),
      messages: [], counters: budgetGuard.getCounters()
    };

    const candidates = targetRows().filter((item) => ['top', 'middle'].includes(item.type)
      && item.label !== '未分類'
      && deleteOperations.includes(item.type === 'top' ? 'delete_top_class' : 'delete_middle_class'));
    const candidateKeys = candidates.map((__, index) => `x${index + 1}`);
    const candidateByKey = new Map(candidates.map((item, index) => [candidateKeys[index], item]));
    const candidateKeyById = new Map(candidates.map((item, index) => [item.id, candidateKeys[index]]));
    const batchKeysFor = (unit) => unit.items.map((item) => candidateKeyById.get(item.id));
    const selectionBatches = candidates.length
      ? Array.from({ length: Math.ceil(candidates.length / DELETE_BATCH_SIZE) }, (_, index) => ({
        id: `select-${index + 1}`,
        items: candidates.slice(index * DELETE_BATCH_SIZE, (index + 1) * DELETE_BATCH_SIZE)
      }))
      : [{ id: 'select-none', items: [] }];
    const selectionPhase = {
      id: 'deletion-target-selection', units: selectionBatches,
      async execute(unit) {
        if (!unit.items.length) return { targetKeys: [], reason: '削除候補がありません。' };
        const batchKeys = batchKeysFor(unit);
        onProgress({ stage: 'analyzing', note: `削除候補を${unit.items.length}件ずつ確認しています` });
        return await askAI([
          { role: 'system', content: [
            '依頼に基づき、削除対象にする上位・中間クラスのkeyを選んでください。削除対象は「未分類」を除く候補に限ります。',
            '削除を明示または明確に求めているクラスだけを選び、名称が似ている、件数が少ない、配下がないという理由だけで削除しないでください。',
            '選択したクラスの配下は削除しません。後段で配下を移動してから親クラスを削除します。入れ子の削除対象を同時に選ばず、上位の削除対象だけを選んでください。該当がなければ空配列にしてください。'
          ].join('\n') },
          { role: 'user', content: JSON.stringify({
            request, objective: plan.executionBrief,
            candidates: unit.items.map((item) => ({ key: candidateKeyById.get(item.id), label: item.label, type: item.type, parent: item.parentLabel || null }))
          }) }
        ], 'deletion_target_selection', {
          type: 'object', additionalProperties: false,
          properties: {
            targetKeys: { type: 'array', uniqueItems: true, maxItems: unit.items.length, items: { type: 'string', enum: batchKeys } },
            reason: { type: 'string', maxLength: 800 }
          }, required: ['targetKeys', 'reason']
        });
      },
      validate(unit, result) {
        return Array.isArray(result?.targetKeys) && new Set(result.targetKeys).size === result.targetKeys.length
          && result.targetKeys.every((key) => candidateByKey.has(key) && batchKeysFor(unit).includes(key))
          ? true : '削除対象の選択結果が不正です。';
      },
      validatePhase(results) {
        const selectedKeys = results.flatMap((unit) => unit.result?.targetKeys || []);
        return new Set(selectedKeys).size === selectedKeys.length
          ? true : '削除候補の分割判定で重複選択がありました。';
      }
    };

    let selectionLoop;
    const relocationAlreadyPlanned = activeJob?.phases.some((phase) => phase.id === 'descendant-relocation');
    const selectionAlreadyComplete = activeJob?.phases.find((phase) => phase.id === 'deletion-target-selection')?.status === 'completed'
      && activeJob.phases.find((phase) => phase.id === 'deletion-target-selection')?.units.every((unit) => unit.status === 'completed');
    if (relocationAlreadyPlanned && selectionAlreadyComplete) selectionLoop = { status: 'completed', checkpoint: activeJob };
    else {
      try {
        selectionLoop = await runJobLoop({ checkpoint: activeJob, dataVersion, signal, phases: [targetPhase, hierarchyPhase, selectionPhase], onCheckpoint: persist, onProgress });
      } catch (error) {
        if (error.scopeRequest) return { status: 'needs_scope_approval', scopeRequest: error.scopeRequest, checkpoint: activeJob };
        throw error;
      }
    }
    activeJob = selectionLoop.checkpoint;
    if (selectionLoop.status === 'needs_scope_approval') return { status: 'needs_scope_approval', scopeRequest: selectionLoop.scopeRequest, checkpoint: activeJob };
    if (selectionLoop.status === 'paused' || selectionLoop.status === 'interrupted') return {
      status: selectionLoop.status, checkpoint: activeJob, budgetLimited: selectionLoop.status === 'paused',
      text: JSON.stringify({ message: `削除ジョブを一時停止しました。${selectionLoop.error?.message || ''}未完了工程から再開できます。`, proposals: [], alternativeGroups: [] }),
      messages: [], counters: budgetGuard.getCounters()
    };
    const selectionResults = activeJob.phases.find((phase) => phase.id === 'deletion-target-selection')?.units.map((unit) => unit.result) || [];
    const selectedKeys = selectionResults.flatMap((result) => result?.targetKeys || []);
    const selectionReason = [...new Set(selectionResults.map((result) => result?.reason).filter(Boolean))]
      .slice(0, 4).map((reason) => reason.slice(0, 300)).join('。');
    const selectedTargets = selectedKeys.map((key) => candidateByKey.get(key)).filter(Boolean);
    if (!selectedTargets.length) {
      activeJob.status = 'completed'; activeJob.completedAt = Date.now(); await onCheckpoint(activeJob);
      return { text: JSON.stringify({ message: '削除対象として依頼に該当する上位・中間クラスを確認できませんでした。削除案は作成していません。', proposals: [], alternativeGroups: [] }), messages: [], checkpoint: activeJob, counters: budgetGuard.getCounters() };
    }

    const allRecords = new Map([...targetRows(), ...hierarchyRows()].map((item) => [item.id, item]));
    const childrenByParent = new Map();
    for (const item of allRecords.values()) if (item.parentId) {
      if (!childrenByParent.has(item.parentId)) childrenByParent.set(item.parentId, []);
      childrenByParent.get(item.parentId).push(item);
    }
    const selectedIdsSet = new Set(sortedScope);
    const nestedTarget = (candidate) => selectedTargets.some((other) => other.id !== candidate.id && (() => {
      let parentId = candidate.parentId;
      while (parentId) {
        if (parentId === other.id) return true;
        parentId = allRecords.get(parentId)?.parentId || null;
      }
      return false;
    })());
    const deleteTargets = selectedTargets.filter((item) => !nestedTarget(item));
    const excludedSubtrees = new Set();
    for (const item of deleteTargets) {
      const pending = [item.id];
      while (pending.length) {
        const id = pending.pop();
        if (excludedSubtrees.has(id)) continue;
        excludedSubtrees.add(id);
        pending.push(...(childrenByParent.get(id) || []).map((child) => child.id));
      }
    }
    const destinations = hierarchyRows().filter((item) => !excludedSubtrees.has(item.id));
    const destinationRecords = destinations.map((item, index) => ({
      key: `d${index + 1}`, id: item.id, label: item.label, type: item.type, parentId: item.parentId, parentLabel: item.parentLabel
    }));
    const destinationByKey = new Map(destinationRecords.map((item) => [item.key, item]));
    const destinationById = new Map(destinationRecords.map((item) => [item.id, item]));
    const childBatches = [];
    for (const deletionTarget of deleteTargets) {
      const directChildren = (childrenByParent.get(deletionTarget.id) || []).sort((a, b) => a.id.localeCompare(b.id));
      const descendantPending = [...directChildren];
      const descendants = new Set();
      while (descendantPending.length) {
        const child = descendantPending.pop();
        if (descendants.has(child.id)) continue;
        descendants.add(child.id);
        descendantPending.push(...(childrenByParent.get(child.id) || []));
      }
      if ([...descendants].some((id) => !selectedIdsSet.has(id))) {
        activeJob.status = 'paused'; activeJob.updatedAt = Date.now(); await onCheckpoint(activeJob);
        return {
          status: 'needs_user_input', checkpoint: activeJob,
          message: `「${deletionTarget.label}」の配下に変更範囲へ含まれていないクラスがあります。全子孫を変更対象に含めてから削除ジョブを続けてください。`
        };
      }
      for (let offset = 0; offset < directChildren.length; offset += DELETE_BATCH_SIZE) {
        childBatches.push({
          id: `target-${deletionTarget.id}-batch-${Math.floor(offset / DELETE_BATCH_SIZE) + 1}`,
          deletionTarget, items: directChildren.slice(offset, offset + DELETE_BATCH_SIZE)
        });
      }
    }
    const noDestinationChild = childBatches.flatMap((batch) => batch.items).find((item) =>
      !destinations.some((destination) => item.type === 'middle' ? destination.type === 'top' : ['top', 'middle'].includes(destination.type)));
    if (noDestinationChild) {
      activeJob.status = 'paused'; activeJob.updatedAt = Date.now(); await onCheckpoint(activeJob);
      return {
        status: 'needs_user_input', checkpoint: activeJob,
        message: `「${noDestinationChild.label}」を移す既存の移動先が参照範囲にありません。移動先候補の参照範囲を広げるか、先に移動先クラスを用意してください。`
      };
    }

    const relocationPhase = {
      id: 'descendant-relocation', units: childBatches,
      async execute(unit) {
        const compatibleDestinations = destinationRecords.filter((item) => unit.items.some((child) =>
          child.type === 'middle' ? item.type === 'top' : ['top', 'middle'].includes(item.type)));
        const keys = new Set(compatibleDestinations.map((item) => item.key));
        const input = [
          { role: 'system', content: [
            '削除するクラスの直下にある子を、削除後に残す既存クラスへ一件ずつ移してください。middleの移動先はtop、classの移動先はtopまたはmiddleに限ります。',
            '削除対象とその配下は移動先に選ばないでください。削除元自身を残す移動先にもできません。',
            '全対象に移動先keyと理由を返します。妥当な移動先を判断できない対象はdestinationKey=nullとし、理由に不足条件を書いてください。候補を無理に選びません。'
          ].join('\n') },
          { role: 'user', content: JSON.stringify({
            request, deleteTarget: { label: unit.deletionTarget.label, type: unit.deletionTarget.type },
            destinations: compatibleDestinations.map(({ key, label, type, parentLabel }) => ({ key, label, type, parent: parentLabel })),
            items: unit.items.map((item, index) => ({ itemNumber: index + 1, label: item.label, type: item.type, currentParent: item.parentLabel || null }))
          }) }
        ];
        const result = await askAI(input, 'deletion_relocations', {
          type: 'object', additionalProperties: false,
          properties: { moves: { type: 'array', minItems: unit.items.length, maxItems: unit.items.length, items: {
            type: 'object', additionalProperties: false,
            properties: {
              itemNumber: { type: 'integer', minimum: 1, maximum: unit.items.length },
              destinationKey: { anyOf: [{ type: 'string', enum: [...keys] }, { type: 'null' }] },
              reason: { type: 'string', maxLength: 400 }
            }, required: ['itemNumber', 'destinationKey', 'reason']
          } } }, required: ['moves']
        });
        const moves = result.moves || [];
        if (moves.some((move) => move.destinationKey === null)) {
          const unresolved = moves.filter((move) => move.destinationKey === null).map((move) => unit.items[move.itemNumber - 1]?.label).filter(Boolean);
          throw Object.assign(new Error(`移動先を判断できない子クラスがあります: ${unresolved.slice(0, 8).join('、')}${unresolved.length > 8 ? 'ほか' : ''}。移動先の条件を指定してください。`), { status: 'needs_user_input', code: 'DELETE_RELOCATION_UNRESOLVED' });
        }
        return moves.map((move) => ({ ...move, childId: unit.items[move.itemNumber - 1]?.id || null }));
      },
      validate(unit, result) {
        if (!Array.isArray(result) || result.length !== unit.items.length) return '削除対象の配下移動が一件ずつ揃っていません。';
        const ids = result.map((row) => row.childId);
        if (ids.some((id) => !id) || new Set(ids).size !== unit.items.length || unit.items.some((item) => !ids.includes(item.id))) return '削除対象の配下移動に重複または漏れがあります。';
        return result.every((row) => destinationByKey.has(row.destinationKey)) ? true : '配下の移動先が存在しません。';
      },
      validatePhase(results) {
        const expected = childBatches.flatMap((batch) => batch.items.map((item) => item.id));
        const actual = results.flatMap((unit) => unit.result || []).map((row) => row.childId);
        return expected.length === actual.length && new Set(actual).size === expected.length && expected.every((id) => actual.includes(id))
          ? true : '削除対象の全直下クラスに移動案がありません。';
      }
    };
    const phases = [targetPhase, hierarchyPhase, selectionPhase, relocationPhase];
    let relocation;
    try { relocation = await runJobLoop({ checkpoint: activeJob, dataVersion, signal, phases, onCheckpoint: persist, onProgress }); }
    catch (error) {
      if (error.scopeRequest) return { status: 'needs_scope_approval', scopeRequest: error.scopeRequest, checkpoint: activeJob };
      throw error;
    }
    activeJob = relocation.checkpoint;
    if (relocation.status === 'needs_user_input') {
      return { status: 'needs_user_input', checkpoint: activeJob, message: relocation.error?.message || '削除を完了するための移動先を指定してください。' };
    }
    if (relocation.status === 'needs_scope_approval') return { status: 'needs_scope_approval', scopeRequest: relocation.scopeRequest, checkpoint: activeJob };
    if (relocation.status !== 'completed') return {
      status: relocation.status, checkpoint: activeJob, budgetLimited: relocation.status === 'paused',
      text: JSON.stringify({ message: `削除ジョブを一時停止しました。${relocation.error?.message || '未完了工程から再開できます。'}`, proposals: [], alternativeGroups: [] }),
      messages: [], counters: budgetGuard.getCounters()
    };

    const operations = [];
    const moveReasons = [];
    for (const unit of activeJob.phases.find((phase) => phase.id === 'descendant-relocation')?.units || []) {
      const batch = childBatches.find((item) => item.id === unit.id);
      for (const move of unit.result || []) {
        const child = batch.items.find((item) => item.id === move.childId);
        const destination = destinationByKey.get(move.destinationKey);
        if (!child || !destination) return { status: 'stale_job', message: '保存済み削除ジョブの移動先または対象が現在の階層にありません。' };
        operations.push({
          type: child.type === 'middle' ? 'move_middle_class' : 'move_target_class',
          target: ref(child.id), newParent: ref(destination.id), tempId: null, label: null
        });
        moveReasons.push(move.reason);
      }
    }
    for (const target of deleteTargets) operations.push({
      type: target.type === 'top' ? 'delete_top_class' : 'delete_middle_class',
      target: ref(target.id), newParent: null, tempId: null, label: null
    });
    const movedCount = childBatches.reduce((sum, batch) => sum + batch.items.length, 0);
    const message = `削除対象${deleteTargets.length}件について、配下の移動先${movedCount}件を確定し、移動後に削除する順序で案をまとめました。削除後の階層検査を通過しています。変更案のみで、編集データには適用していません。`;
    activeJob.status = 'completed'; activeJob.completedAt = Date.now(); activeJob.updatedAt = activeJob.completedAt;
    activeJob.metadata.result = { deleteIds: deleteTargets.map((item) => item.id), moveCount: movedCount };
    await onCheckpoint(activeJob);
    return {
      text: JSON.stringify({
        message,
        proposals: [{
          id: 'hierarchy_deletion_1', title: '配下を移動して分類を削除',
          summary: `${deleteTargets.length}件の上位・中間クラスの子を移動し、親クラスを削除する案です。`,
          reason: [...new Set([selectionReason, ...moveReasons])].filter(Boolean).slice(0, 6).join('。') || '配下の全クラスに移動先を割り当て、親クラスを削除する順序で構成しました。',
          uncertainties: [], questions: [], operations
        }], alternativeGroups: []
      }),
      messages: [], checkpoint: activeJob, counters: budgetGuard.getCounters()
    };
  }

  return Object.freeze({ run });
}
