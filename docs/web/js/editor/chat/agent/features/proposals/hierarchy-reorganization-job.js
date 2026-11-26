import { createJobCheckpoint, normalizeJobCheckpoint, runJobLoop } from '../../application/job-loop.js';
import { createTaskState, normalizeTaskState, recordTaskAction, recordTaskCriterion, stopTask, completeTask, resumeTask, authorizeTaskAction } from '../../application/task-state.js?v=20261125-design-destination-action-v1';
import { sameIdSet } from '../../application/id-set.js?v=20261125-id-set-v1';

const PAGE_BATCH_SIZE = 100;
const MAX_PLACEMENT_RETRIES = 2;
const FAST_PATH_MAX_TARGETS = 100;
const FAST_PATH_MAX_HIERARCHY = 150;
const FAST_PATH_MAX_INPUT_CHARS = 24000;
const DESTINATION_PICKS_PER_BATCH = 5;
const identity = (item) => ({ kind: 'existing_class', classId: item.id, tempId: null });
const temporary = (tempId) => ({ kind: 'temporary_class', classId: null, tempId });
const responseText = (response) => (response?.output || []).flatMap((item) => item.content || [])
  .find((item) => item.type === 'output_text')?.text || '';
const responseFailure = (response) => {
  const refusal = (response?.output || []).flatMap((item) => item.content || [])
    .find((item) => item.type === 'refusal')?.refusal;
  const reason = response?.incomplete_details?.reason || response?.status || '応答本文なし';
  return refusal ? `モデルが応答を拒否しました（${reason}）。` : `モデル応答にJSON本文がありません（${reason}）。`;
};
const unique = (items) => [...new Set(items)];

function pagePhase({ id, ids, reader, read, budgetGuard, onProgress, tool, note }) {
  const limit = Math.max(1, Number(reader.pageLimit) || 100);
  const count = Math.max(1, Math.ceil((ids?.length || 0) / limit));
  return {
    id,
    units: Array.from({ length: count }, (_, index) => ({
      id: `page-${index + 1}`,
      cursor: reader.createPageCursor?.(id === 'target-snapshot' ? 'selected_class_details' : 'hierarchy_index', index * limit) || null
    })),
    async execute(unit) {
      budgetGuard.countRetrieval();
      onProgress({ stage: 'retrieving', tool, note });
      return read(unit.cursor).items || [];
    },
    validate(unit, result) {
      return Array.isArray(result) && result.every((item) => typeof item?.id === 'string')
        ? true : `取得ページ${unit.id}の形式が不正です。`;
    },
    validatePhase(results) {
      const idsOnPages = results.flatMap((unit) => unit.result || []).map((item) => item.id);
      return idsOnPages.length === new Set(idsOnPages).size ? true : '取得ページ間に重複があります。';
    }
  };
}

export function createHierarchyReorganizationJob({
  reader, client, budgetGuard, model, apiKey, request, plan, maxOutputTokens, signal,
  onProgress = () => {}, onUsage = () => {}, onCheckpoint = async () => {},
  jobCheckpoint = null, dataVersion = '', jobRequest = '', jobScopeIds = null,
  jobSelectedIds = null, jobTargetIds = null, jobHierarchyIds = null, rootAnchorIds = null, requireRootAnchor = false, continuationInput = ''
}) {
  if (!reader?.readHierarchyIndex || !reader?.readSelectedClassDetails || !client?.request || !budgetGuard) {
    throw new TypeError('階層再編ジョブに必要な依存関係が不足しています。');
  }
  const selectedIds = unique(Array.isArray(jobSelectedIds) ? jobSelectedIds : jobScopeIds || []);
  const editableIds = unique(Array.isArray(jobScopeIds) ? jobScopeIds : []);
  const targetIds = unique(Array.isArray(jobTargetIds) ? jobTargetIds : editableIds);
  const hierarchyIds = unique(Array.isArray(jobHierarchyIds) ? jobHierarchyIds : []);
  const requestedRootAnchorIds = unique(Array.isArray(rootAnchorIds) ? rootAnchorIds : []);
  let activeJob = normalizeJobCheckpoint(jobCheckpoint);

  async function callAI(input, name, schema, outputLimit = maxOutputTokens) {
    if (signal?.aborted) throw signal.reason || Object.assign(new Error('処理が中断されました。'), { name: 'AbortError' });
    const responseSlot = budgetGuard.reserveResponseSlot
      ? await budgetGuard.reserveResponseSlot()
      : (await budgetGuard.assertResponseAllowed(), null);
    const options = { model, input, max_output_tokens: outputLimit, textFormat: { type: 'json_schema', name, strict: true, schema } };
    let reservation;
    try { reservation = await (budgetGuard.reserveInputWithApproval || budgetGuard.reserveInput).call(budgetGuard, options); }
    catch (error) { if (responseSlot) budgetGuard.releaseResponse?.(responseSlot); throw error; }
    let response;
    try {
      response = await client.request({ apiKey, model, input, maxOutputTokens: outputLimit, textFormat: options.textFormat, signal });
    } catch (error) {
      if (responseSlot) budgetGuard.releaseResponse?.(responseSlot);
      budgetGuard.reconcileInput(reservation, null);
      throw error;
    }
    budgetGuard.countResponse(responseSlot);
    const usage = await (budgetGuard.reconcileInputWithApproval || budgetGuard.reconcileInput).call(budgetGuard, reservation, response.usage?.input_tokens);
    onUsage({ model, usage: response.usage || null });
    if (usage.overBudget) throw Object.assign(new Error('再編ジョブが累積入力トークン上限に達しました。'), { code: 'INPUT_TOKEN_BUDGET_ACTUAL', status: 'budget_exhausted' });
    return response;
  }

  function parseAI(response, code, message) {
    try { return JSON.parse(responseText(response)); }
    catch { throw Object.assign(new Error(message), { code }); }
  }

  const readResults = (phaseId) => activeJob?.phases.find((phase) => phase.id === phaseId)?.units.flatMap((unit) => unit.result || []) || [];

  async function run() {
    const saved = activeJob;
    const sameJob = saved?.kind === 'hierarchy_reorganization' && saved.request === (jobRequest || request);
    if (sameJob && saved.dataVersion !== dataVersion) return { status: 'stale_job', message: '保存済み再編ジョブのデータ版が異なるため続行できません。' };
    const sortedScope = [...editableIds].sort((a, b) => a.localeCompare(b));
    if (sameJob && JSON.stringify(saved.scopeIds) !== JSON.stringify(sortedScope)) return { status: 'stale_job', message: '保存済み再編ジョブの変更範囲が現在と異なるため続行できません。' };
    if (sameJob && !sameIdSet(saved.metadata.selectedIds || [], selectedIds)) return { status: 'stale_job', message: '保存済み再編ジョブの選択対象が現在と異なるため続行できません。' };
    if (sameJob && !sameIdSet(saved.metadata.targetIds || [], targetIds)) return { status: 'stale_job', message: '保存済み再編ジョブの末端対象が現在と異なるため続行できません。' };
    if (sameJob && Array.isArray(saved.metadata.rootAnchorIds)
      && !sameIdSet(saved.metadata.rootAnchorIds, requestedRootAnchorIds)) return { status: 'stale_job', message: '保存済み再編ジョブの選択ルートが現在と異なるため続行できません。' };
    if (sameJob) {
      const priorHierarchyIds = saved.metadata.hierarchyIds || [];
      if (!priorHierarchyIds.every((id) => hierarchyIds.includes(id))) return { status: 'stale_job', message: '保存済み再編ジョブの参照範囲が現在と異なるため続行できません。' };
      if (priorHierarchyIds.length !== hierarchyIds.length || saved.metadata.designVersion !== 11) {
        activeJob = normalizeJobCheckpoint({
          ...saved,
          status: 'running',
          metadata: { ...saved.metadata, hierarchyIds, rootAnchorIds: requestedRootAnchorIds, designVersion: 11 },
          phases: saved.phases.filter((phase) => phase.id === 'target-snapshot'),
          updatedAt: Date.now(), completedAt: null
        });
      }
      if (continuationInput && activeJob.metadata.awaitingUserInput === 'placement') {
        activeJob = normalizeJobCheckpoint({
          ...activeJob,
          status: 'running',
          metadata: {
            ...activeJob.metadata,
            awaitingUserInput: null,
            userGuidance: [...(activeJob.metadata.userGuidance || []), continuationInput].slice(-10)
          },
          phases: activeJob.phases.map((phase) => phase.id !== 'class-placement' ? phase : {
            ...phase, status: 'pending', units: phase.units.map((unit) => ({ ...unit, status: 'pending', result: null }))
          }),
          updatedAt: Date.now(), completedAt: null
        });
        await onCheckpoint(activeJob);
      } else if (continuationInput) {
        activeJob.metadata.userGuidance = [...(activeJob.metadata.userGuidance || []), continuationInput].slice(-10);
      }
    }
    if (!sameJob) activeJob = createJobCheckpoint({
      id: globalThis.crypto?.randomUUID?.() || `reorg-${Date.now()}`,
      kind: 'hierarchy_reorganization', request: jobRequest || request, dataVersion,
      scopeIds: sortedScope,
      metadata: {
        selectedIds, targetIds, hierarchyIds, rootAnchorIds: requestedRootAnchorIds, executionMode: 'reorganization', designVersion: 11, userGuidance: [],
        taskState: createTaskState({
          id: globalThis.crypto?.randomUUID?.() || `task-${Date.now()}`,
          objective: plan.executionBrief?.objective || request,
          completionCriteria: ['対象全件の配置または保留理由を確定する', '提案操作と階層整合性を検証する'],
          scopeIds: sortedScope, dataVersion, structureMode: 'design'
        })
      }
    });
    if (sameJob && !normalizeTaskState(activeJob.metadata.taskState)) {
      activeJob.metadata.taskState = createTaskState({
        id: activeJob.id, objective: plan.executionBrief?.objective || request,
        completionCriteria: ['対象全件の配置または保留理由を確定する', '提案操作と階層整合性を検証する'],
        scopeIds: sortedScope, dataVersion, structureMode: 'design'
      });
    }
    if (sameJob && continuationInput && activeJob.metadata.taskState) {
      const resumedTask = resumeTask(activeJob.metadata.taskState, { dataVersion, scopeIds: sortedScope });
      if (!resumedTask) return { status: 'stale_job', message: '保存済みタスク状態の対象範囲が現在と異なるため再開できません。' };
      activeJob.metadata.taskState = resumedTask;
      activeJob.metadata.awaitingUserInput = null;
      await onCheckpoint(activeJob);
    }
    const persist = async (checkpoint) => { activeJob = checkpoint; await onCheckpoint(checkpoint); };
    const targetPhase = pagePhase({ id: 'target-snapshot', ids: selectedIds, reader, read: (cursor) => reader.readSelectedClassDetails({ cursor }), budgetGuard, onProgress, tool: 'read_selected_class_details', note: '再編対象を全ページ取得しています' });
    const hierarchyPhase = pagePhase({ id: 'hierarchy-snapshot', ids: hierarchyIds, reader, read: (cursor) => reader.readHierarchyIndex({ cursor }), budgetGuard, onProgress, tool: 'read_hierarchy_index', note: '利用可能な階層候補を全ページ取得しています' });

    const pauseMessage = (result) => ({
      status: result.status,
      checkpoint: result.checkpoint,
      scopeRequest: result.scopeRequest,
      text: JSON.stringify({
        message: result.status === 'needs_scope_approval'
          ? '再編対象または階層の参照許可が必要です。許可後、保存済み工程から再開します。'
          : `再編ジョブを一時停止しました。${result.error?.message || '次のメッセージで同じ会話を続けると未完了工程から再開します。'}`,
        proposals: [], alternativeGroups: []
      }), messages: [], budgetLimited: result.status === 'paused', counters: budgetGuard.getCounters()
    });

    let snapshot;
    const hasDownstreamPhases = activeJob?.phases.some((phase) => !['target-snapshot', 'hierarchy-snapshot'].includes(phase.id));
    const snapshotsAlreadyComplete = ['target-snapshot', 'hierarchy-snapshot'].every((id) => {
      const phase = activeJob?.phases.find((item) => item.id === id);
      return phase?.status === 'completed' && phase.units.every((unit) => unit.status === 'completed');
    });
    if (hasDownstreamPhases && snapshotsAlreadyComplete) snapshot = { status: 'completed', checkpoint: activeJob };
    else {
      try {
        onProgress({ stage: 'retrieving', milestone: true, note: '選択対象と参照可能な階層データを読み込んでいます' });
        snapshot = await runJobLoop({ checkpoint: activeJob, dataVersion, signal, phases: [targetPhase, hierarchyPhase], onCheckpoint: persist, onProgress });
      } catch (error) {
        if (error.scopeRequest) return { status: 'needs_scope_approval', scopeRequest: error.scopeRequest, checkpoint: activeJob };
        throw error;
      }
    }
    activeJob = snapshot.checkpoint;
    if (snapshot.status !== 'completed') return pauseMessage(snapshot);
    const targets = readResults('target-snapshot').filter((item) => item.type === 'class');
    const hierarchy = readResults('hierarchy-snapshot');
    const actualTargetIds = targets.map((item) => item.id).sort((a, b) => a.localeCompare(b));
    if (!snapshotsAlreadyComplete) {
      onProgress({ stage: 'retrieving', milestone: true, note: `対象${targets.length.toLocaleString('ja-JP')}件と階層候補${hierarchy.length.toLocaleString('ja-JP')}件を読み込みました` });
    }
    if (JSON.stringify(actualTargetIds) !== JSON.stringify([...targetIds].sort((a, b) => a.localeCompare(b)))) return {
      status: 'stale_job', message: '取得した末端対象が変更許可範囲と一致しないため、再編を停止しました。'
    };
    const hierarchyById = new Map(hierarchy.map((item) => [item.id, item]));
    const destinationRecords = hierarchy.map((item, index) => ({
      key: `d${index + 1}`, id: item.id, label: item.label, type: item.type,
      parentId: item.parentId, parentLabel: item.parentLabel, editable: editableIds.includes(item.id)
    }));
    const destinationByKey = new Map(destinationRecords.map((item) => [item.key, item]));
    const selectedScope = new Set(selectedIds);
    const rootAnchor = requestedRootAnchorIds.length === 1
      ? destinationRecords.find((item) => item.id === requestedRootAnchorIds[0] && ['top', 'middle'].includes(item.type) && selectedScope.has(item.id)) || null
      : null;
    if (requireRootAnchor && !rootAnchor) throw Object.assign(new Error('指定された再編起点を対象範囲内の上位または中間クラスとして確認できません。全体再編へ切り替えず停止しました。'), { code: 'REORG_ROOT_ANCHOR_INVALID' });
    const anchorCategoryKey = rootAnchor ? '__selected_scope_anchor__' : null;
    const designDestinationRecords = rootAnchor
      ? destinationRecords.filter((item) => ['top', 'middle'].includes(item.type) && selectedScope.has(item.id))
      : destinationRecords;
    const estimatedInputChars = request.length
      + targets.reduce((sum, item) => sum + String(item.label || '').length + String(item.parentLabel || '').length + 8, 0)
      + designDestinationRecords.reduce((sum, item) => sum + item.label.length + String(item.parentLabel || '').length + 16, 0);
    const fastPath = targets.length <= FAST_PATH_MAX_TARGETS
      && designDestinationRecords.length <= FAST_PATH_MAX_HIERARCHY
      && estimatedInputChars <= FAST_PATH_MAX_INPUT_CHARS;
    const dispositionItems = fastPath || rootAnchor ? [] : destinationRecords.filter((item) => item.editable && item.label !== '未分類');
    const dispositionBatches = Array.from({ length: Math.ceil(dispositionItems.length / PAGE_BATCH_SIZE) }, (_, index) => ({
      id: `disposition-${index + 1}`,
      items: dispositionItems.slice(index * PAGE_BATCH_SIZE, (index + 1) * PAGE_BATCH_SIZE)
    }));
    const dispositionSchema = (items) => ({
      type: 'object', additionalProperties: false,
      properties: { decisions: { type: 'array', minItems: items.length, maxItems: items.length, items: {
        type: 'object', additionalProperties: false,
        properties: {
          key: { type: 'string', enum: items.map((item) => item.key) },
          disposition: { type: 'string', enum: ['keep', 'delete'] },
          reason: { type: 'string', maxLength: 300 }
        }, required: ['key', 'disposition', 'reason']
      } } }, required: ['decisions']
    });
    const dispositionPhase = {
      id: 'existing-class-disposition', units: dispositionBatches,
      async execute(unit) {
        onProgress({ stage: 'analyzing', note: `既存分類を${unit.items.length}件ずつ維持・削除判定しています` });
        return parseAI(await callAI([
          { role: 'system', content: [
            '対象範囲内の既存上位・中間クラスを一件ずつ確認し、維持か削除かを判定してください。',
            '再編後も役割を持つ分類はkeepにします。重複、不要、または再編後の構造で役割を持たないことが明確な場合に限ってdeleteにします。名称が似ている、件数が少ない、配下がないという理由だけでは削除しません。',
            '削除を選んだ分類の子は後段で再編先へ移し、移動後に削除します。候補keyを漏れなく一度ずつ返し、内部思考は出力しないでください。'
          ].join('\n') },
          { role: 'user', content: JSON.stringify({
            request, objective: plan.executionBrief,
            candidates: unit.items.map(({ key, label, type, parentLabel }) => ({ key, label, type, parent: parentLabel || null }))
          }) }
        ], 'reorganization_existing_disposition', dispositionSchema(unit.items)), 'INVALID_REORG_DISPOSITION', '既存分類の判定を読み取れませんでした。');
      },
      validate(unit, result) {
        const decisions = result?.decisions;
        const expected = unit.items.map((item) => item.key);
        return Array.isArray(decisions) && decisions.length === expected.length
          && new Set(decisions.map((item) => item.key)).size === expected.length
          && expected.every((key) => decisions.some((item) => item.key === key))
          && decisions.every((item) => ['keep', 'delete'].includes(item.disposition) && typeof item.reason === 'string')
          ? true : `既存分類の判定${unit.id}に漏れまたは重複があります。`;
      },
      validatePhase(results) {
        const actual = results.flatMap((unit) => unit.result?.decisions || []).map((item) => item.key);
        const expected = dispositionItems.map((item) => item.key);
        return actual.length === expected.length && new Set(actual).size === expected.length
          && expected.every((key) => actual.includes(key)) ? true : '既存分類の維持・削除判定が全件揃っていません。';
      }
    };
    const dispositionState = (checkpoint) => {
      if (rootAnchor) return { phase: null, deleteKeys: [], availableRecords: designDestinationRecords, dispositionByKey: new Map() };
      const phase = checkpoint?.phases.find((item) => item.id === 'existing-class-disposition');
      const decisions = phase?.units.flatMap((unit) => unit.result?.decisions || []) || [];
      const dispositionByKey = new Map(decisions.map((item) => [item.key, item.disposition]));
      return {
        phase,
        deleteKeys: decisions.filter((item) => item.disposition === 'delete').map((item) => item.key),
        availableRecords: fastPath
          ? designDestinationRecords
          : destinationRecords.filter((item) => !item.editable || item.label === '未分類' || dispositionByKey.get(item.key) === 'keep'),
        dispositionByKey
      };
    };
    const structureSchemaFor = (availableRecords, includeDeleteKeys = false) => ({
      type: 'object', additionalProperties: false,
      properties: {
        categories: { type: 'array', minItems: targets.length ? 1 : 0, maxItems: rootAnchor ? 199 : 200, items: {
          type: 'object', additionalProperties: false,
          properties: {
            key: { type: 'string', maxLength: 40 }, label: { type: 'string', maxLength: 120 },
            type: { type: 'string', enum: rootAnchor ? ['middle'] : ['top', 'middle'] },
            existingKey: availableRecords.length
              ? { anyOf: [{ type: 'string', enum: availableRecords.map((item) => item.key) }, { type: 'null' }] }
              : { type: 'null' },
            parentKey: { anyOf: [{ type: 'string', maxLength: 40 }, { type: 'null' }] },
            reason: { type: 'string', maxLength: 500 }
          }, required: ['key', 'label', 'type', 'existingKey', 'parentKey', 'reason']
        } },
        ...(includeDeleteKeys ? { deleteKeys: { type: 'array', items: { type: 'string', enum: dispositionItems.map((item) => item.key) } } } : {}),
        designReason: { type: 'string', maxLength: 1000 }
      }, required: [...(includeDeleteKeys ? ['deleteKeys'] : []), 'categories', 'designReason']
    });
    const evidenceBatches = fastPath ? [] : Array.from({ length: Math.ceil(targets.length / PAGE_BATCH_SIZE) }, (_, index) => ({
      id: `evidence-${index + 1}`,
      items: targets.slice(index * PAGE_BATCH_SIZE, (index + 1) * PAGE_BATCH_SIZE)
    }));
    const evidenceSchema = {
      type: 'object', additionalProperties: false,
      properties: {
        summary: { type: 'string', maxLength: 400 },
        themes: { type: 'array', maxItems: 8, items: { type: 'string', maxLength: 80 } }
      }, required: ['summary', 'themes']
    };
    const structureEvidencePhase = {
      id: 'structure-evidence', units: evidenceBatches,
      async execute(unit) {
        onProgress({ stage: 'analyzing', note: `${unit.items.length}件ずつ対象の傾向を要約しています` });
        return parseAI(await callAI([
          { role: 'system', content: [
            '対象クラスの意味と現在の親を読み、後段の分類構造設計に必要な短い証拠要約を作ってください。',
            '主要なテーマを最大8件、全体要約を400文字以内で返します。対象名を大量に再掲せず、異なる概念を無理にまとめず、件数や内容を推測しないでください。'
          ].join('\n') },
          { role: 'user', content: JSON.stringify({
            batch: unit.id,
            items: unit.items.map((item) => ({ label: item.label, currentParent: item.parentLabel || null }))
          }) }
        ], 'reorganization_evidence', evidenceSchema), 'INVALID_REORG_EVIDENCE', '再編対象の要約を読み取れませんでした。');
      },
      validate(unit, result) {
        return typeof result?.summary === 'string' && result.summary.length <= 400
          && Array.isArray(result.themes) && result.themes.length <= 8
          && result.themes.every((theme) => typeof theme === 'string' && theme.length <= 80)
          ? true : `対象傾向の要約${unit.id}が不正です。`;
      }
    };
    const taxonomySkeletonPhase = {
      id: 'taxonomy-skeleton', units: fastPath || rootAnchor ? [] : [{ id: 'global-taxonomy' }],
      async execute(unit) {
        onProgress({ stage: 'analyzing', note: '対象全体の分割要約から再編後の分類骨組みを設計しています' });
        const evidence = readResults('structure-evidence');
        const input = [
          { role: 'system', content: [
            '対象クラス全体を分類するための再編後の上位・中間クラスの骨組みを設計してください。',
            'この段階では既存の移動先を考慮せず、対象の要約から必要な分類軸と親子関係を決めます。中間クラスには上位クラスのkeyを指定してください。',
            '異なる概念を接続語や中点で無理にまとめず、必要な分類だけを作ります。対象件数が0件ならcategoriesは空で構いません。'
          ].join('\n') },
          { role: 'user', content: JSON.stringify({
            request, objective: plan.executionBrief, targetCount: targets.length,
            targetBatchSummaries: evidence.map((item, index) => ({ batch: evidenceBatches[index].id, summary: item.summary, themes: item.themes }))
          }) }
        ];
        return parseAI(await callAI(input, 'reorganization_taxonomy_skeleton', {
          type: 'object', additionalProperties: false,
          properties: { categories: { type: 'array', minItems: targets.length ? 1 : 0, maxItems: 200, items: {
            type: 'object', additionalProperties: false,
            properties: {
              key: { type: 'string', maxLength: 40 }, label: { type: 'string', maxLength: 120 },
              type: { type: 'string', enum: ['top', 'middle'] },
              parentKey: { anyOf: [{ type: 'string', maxLength: 40 }, { type: 'null' }] },
              reason: { type: 'string', maxLength: 400 }
            }, required: ['key', 'label', 'type', 'parentKey', 'reason']
          } } }, required: ['categories']
        }), 'INVALID_REORG_SKELETON', '再編後の分類骨組みを読み取れませんでした。');
      },
      validate(unit, result) {
        const categories = result?.categories;
        if (!Array.isArray(categories) || (targets.length > 0 && !categories.length)) return '再編後の分類骨組みがありません。';
        const keys = categories.map((item) => item.key);
        if (keys.some((key) => typeof key !== 'string' || !key) || new Set(keys).size !== keys.length) return '分類骨組みのkeyが空または重複しています。';
        for (const item of categories) {
          if (!item.label?.trim() || !['top', 'middle'].includes(item.type)) return '分類骨組みの名称または型が不正です。';
          if (item.type === 'top' && item.parentKey !== null) return '上位クラスの骨組みに親が指定されています。';
          if (item.type === 'middle' && (!keys.includes(item.parentKey) || categories.find((parent) => parent.key === item.parentKey)?.type !== 'top')) return '中間クラスの骨組みの親が不正です。';
        }
        return true;
      }
    };
    const destinationBatches = fastPath ? [] : Array.from({ length: Math.ceil(designDestinationRecords.length / PAGE_BATCH_SIZE) }, (_, index) => ({
      id: `destination-${index + 1}`,
      items: designDestinationRecords.slice(index * PAGE_BATCH_SIZE, (index + 1) * PAGE_BATCH_SIZE)
    }));
    const mandatoryDestinationKeys = (checkpoint) => {
      const disposition = dispositionState(checkpoint);
      const deleted = new Set(disposition.deleteKeys);
      const eligible = new Set(disposition.availableRecords.map((item) => item.key));
      const mandatory = new Set();
      const recordById = new Map(destinationRecords.map((item) => [item.id, item]));
      for (const target of targets) {
        const parent = recordById.get(target.parentId);
        if (parent && eligible.has(parent.key)) mandatory.add(parent.key);
      }
      for (const top of destinationRecords.filter((item) => item.type === 'top' && deleted.has(item.key))) {
        for (const middle of destinationRecords.filter((item) => item.type === 'middle' && item.parentId === top.id)) {
          if (!deleted.has(middle.key) && eligible.has(middle.key)) mandatory.add(middle.key);
        }
      }
      return mandatory;
    };
    const destinationPhase = {
      id: 'destination-shortlist', units: rootAnchor ? [] : destinationBatches,
      async execute(unit, { checkpoint }) {
        const disposition = dispositionState(checkpoint);
        const eligible = unit.items.filter((item) => disposition.availableRecords.some((candidate) => candidate.key === item.key));
        const eligibleKeys = new Set(eligible.map((item) => item.key));
        const mandatory = [...mandatoryDestinationKeys(checkpoint)].filter((key) => eligibleKeys.has(key));
        if (!eligible.length) return { candidateKeys: [], reason: 'この範囲に利用可能な既存分類はありません。' };
        const evidence = checkpoint.phases.find((phase) => phase.id === 'structure-evidence')?.units || [];
        const skeleton = checkpoint.phases.find((phase) => phase.id === 'taxonomy-skeleton')?.units?.[0]?.result;
        if (!skeleton) throw Object.assign(new Error('分類骨組みが保存されていません。'), { code: 'REORG_SKELETON_INCOMPLETE' });
        const themes = [...new Set(evidence.flatMap((item) => item.result?.themes || []))].slice(0, 50);
        onProgress({ stage: 'analyzing', note: `既存移動先を${eligible.length}件ずつ関連度確認しています` });
        const result = parseAI(await callAI([
          { role: 'system', content: [
            '再編後の骨組みと対象全体の要約に照らし、この候補群から移動先として有用な既存分類を最大5件選んでください。',
            '現在の親として使われている分類や、親子構造上必要な分類だけを無理に選ばず、候補の意味が合うものを選びます。削除判定済み分類は候補に含まれていません。'
          ].join('\n') },
          { role: 'user', content: JSON.stringify({
            request, objective: plan.executionBrief, taxonomySkeleton: skeleton.categories, targetThemes: themes,
            candidates: eligible.map(({ key, label, type, parentLabel }) => ({ key, label, type, parent: parentLabel || null }))
          }) }
        ], 'reorganization_destination_candidates', {
          type: 'object', additionalProperties: false,
          properties: {
            candidateKeys: { type: 'array', maxItems: Math.min(DESTINATION_PICKS_PER_BATCH, eligible.length), items: { type: 'string', enum: [...eligibleKeys] } },
            reason: { type: 'string', maxLength: 400 }
          }, required: ['candidateKeys', 'reason']
        }), 'INVALID_REORG_DESTINATIONS', '既存移動先候補を読み取れませんでした。');
        return { ...result, candidateKeys: [...new Set([...result.candidateKeys, ...mandatory])] };
      },
      validate(unit, result, { checkpoint }) {
        const disposition = dispositionState(checkpoint);
        const eligibleKeys = new Set(unit.items.filter((item) => disposition.availableRecords.some((candidate) => candidate.key === item.key)).map((item) => item.key));
        const mandatory = [...mandatoryDestinationKeys(checkpoint)].filter((key) => eligibleKeys.has(key));
        return Array.isArray(result?.candidateKeys) && new Set(result.candidateKeys).size === result.candidateKeys.length
          && result.candidateKeys.every((key) => eligibleKeys.has(key))
          && mandatory.every((key) => result.candidateKeys.includes(key))
          ? true : `既存移動先候補${unit.id}が不正です。`;
      },
      validatePhase(results) {
        const keys = results.flatMap((unit) => unit.result?.candidateKeys || []);
        return new Set(keys).size === keys.length ? true : '既存移動先候補に重複があります。';
      }
    };
    const structureAvailableRecords = (checkpoint) => {
      if (rootAnchor || fastPath) return designDestinationRecords;
      const disposition = dispositionState(checkpoint);
      const shortlisted = new Set(checkpoint.phases.find((phase) => phase.id === 'destination-shortlist')?.units
        .flatMap((unit) => unit.result?.candidateKeys || []) || []);
      const deleted = new Set(disposition.deleteKeys);
      const recordById = new Map(destinationRecords.map((item) => [item.id, item]));
      for (const key of [...shortlisted]) {
        const item = destinationByKey.get(key);
        if (item?.type !== 'middle' || !item.parentId) continue;
        const parent = recordById.get(item.parentId);
        if (parent && !deleted.has(parent.key) && disposition.availableRecords.some((candidate) => candidate.key === parent.key)) shortlisted.add(parent.key);
      }
      return destinationRecords.filter((item) => shortlisted.has(item.key));
    };
    const structurePhase = {
      id: 'structure-design', units: [{ id: 'whole-structure' }],
      async execute(unit, { checkpoint }) {
        onProgress({ stage: 'analyzing', note: rootAnchor
          ? `「${rootAnchor.label}」を起点に、配下の階層だけを再編しています`
          : '分割した対象の要約から再編後の上位・中間クラスを設計しています' });
        const disposition = dispositionState(checkpoint);
        if (!rootAnchor && (!disposition.phase || disposition.phase.status !== 'completed'
          || disposition.phase.units.some((item) => item.status !== 'completed'))) {
          throw Object.assign(new Error('既存分類の維持・削除判定が揃っていません。'), { code: 'REORG_DISPOSITION_INCOMPLETE' });
        }
        const structureSchema = structureSchemaFor(
          fastPath ? designDestinationRecords : structureAvailableRecords(checkpoint),
          fastPath && !rootAnchor
        );
        const evidence = checkpoint.phases.find((phase) => phase.id === 'structure-evidence')?.units || [];
        if (evidence.length !== evidenceBatches.length || evidence.some((item) => item.status !== 'completed')) {
          throw Object.assign(new Error('再編対象の分割要約が揃っていません。'), { code: 'REORG_EVIDENCE_INCOMPLETE' });
        }
        const skeleton = checkpoint.phases.find((phase) => phase.id === 'taxonomy-skeleton')?.units?.[0]?.result;
        const availableRecords = rootAnchor ? designDestinationRecords : fastPath ? designDestinationRecords : structureAvailableRecords(checkpoint);
        const availableTopByKey = new Map(availableRecords.filter((item) => item.type === 'top').map((item) => [item.key, item]));
        const skeletonTopByKey = new Map((skeleton?.categories || []).filter((item) => item.type === 'top').map((item) => [item.key, item]));
        const input = [
          { role: 'system', content: [
            rootAnchor
              ? `選択ルート「${rootAnchor.label}」（${rootAnchor.type}）を階層の起点として保持し、削除・改名・移動しません。新設分類はすべて中間クラスとし、このルートまたは配下の中間クラスを親にします。上位クラスは新設せず、ルート外への移動もしません。categoriesに選択ルートを含めず、parentKeyでは予約key「${anchorCategoryKey}」をそのルートとして使ってください。既存候補はkeyで再利用し、editable=falseの既存分類は参照専用で名称・親を変更しません。editable=trueの既存中間クラスに限り、明確な改善になる場合はlabel変更や親変更を提案できます。`
              : '対象全体を分類できる再編後の上位・中間クラス構造を設計してください。既存構造の維持だけで済ませず、依頼と全対象から必要な分類軸と階層を判断します。',
            rootAnchor
              ? '既存クラスは削除しません。各対象の現在の分類を維持するか、ルート配下の既存または新設中間クラスへ配置します。'
              : '既存候補はkeyで再利用できます。必要な場合だけ新しいtopまたはmiddleを作ります。middleのparentKeyは、この応答のcategories配列にあるtype=topのkeyと完全一致させてください。taxonomySkeletonのkeyを使う場合も、そのtopカテゴリ自体をcategoriesに含めてください。editable=falseの既存分類は参照専用で、名称や親を変更しません。editable=trueの既存分類に限り、明確な改善になる場合はlabelへ新名称を指定できます。',
            rootAnchor ? '' : fastPath
              ? '既存分類はすべて一括確認し、不要と明確に判断した編集可能分類だけをdeleteKeysに含めます。categoriesには新設する分類、配置先として使う既存分類、改名・移動する既存分類だけを記します。'
              : 'categoriesには新設する分類、配置先として使う既存分類、改名・移動する既存分類だけを記します。categoriesに含めない維持分類は現在の名称と親を保ちます。削除対象は別工程で判定済みです。',
            '全対象の移動先を後工程で決められるよう、対象範囲を過不足なく受け止める構造にします。名前が似ているだけで分類を統合せず、異なる概念を接続語や中点で無理にまとめません。',
            'この工程では操作列を作りません。存在しないIDやkeyは作らず、内部思考は出力しないでください。'
          ].join('\n') },
          { role: 'user', content: JSON.stringify({
            request, objective: plan.executionBrief, scope: { targetCount: targets.length },
            ...(!fastPath && !rootAnchor ? { taxonomySkeleton: skeleton?.categories || [] } : {}),
            ...(rootAnchor ? { fixedParent: { key: anchorCategoryKey, label: rootAnchor.label, type: rootAnchor.type } } : {}),
            ...(fastPath ? { targetItems: targets.map((item) => ({ label: item.label, currentParent: item.parentLabel || null })) } : {}),
            targetBatchSummaries: evidence.map((item, index) => ({ batch: evidenceBatches[index].id, summary: item.result.summary, themes: item.result.themes })),
            existingHierarchy: availableRecords.map(({ key, label, type, parentLabel, editable }) => ({ key, label, type, parent: parentLabel, editable }))
          }) }
        ];
        let repairInput = input;
        let result;
        for (let attempt = 0; attempt <= 2; attempt += 1) {
          result = parseAI(await callAI(repairInput, 'reorganization_structure', structureSchema), 'INVALID_REORG_STRUCTURE', '再編構造の応答を読み取れませんでした。');
          const categories = Array.isArray(result?.categories) ? result.categories.map((item) => ({ ...item })) : [];
          if (rootAnchor) {
            const redundantAnchorKeys = new Set(categories.filter((item) => item.existingKey === rootAnchor.key).map((item) => item.key));
            const filteredCategories = categories.filter((item) => item.existingKey !== rootAnchor.key);
            for (const category of filteredCategories) {
              if (redundantAnchorKeys.has(category.parentKey)) category.parentKey = anchorCategoryKey;
            }
            categories.length = 0;
            categories.push(...filteredCategories);
            for (const category of categories) {
              if (category.type !== 'middle') continue;
              if (category.parentKey === rootAnchor.key || category.parentKey === rootAnchor.id) category.parentKey = anchorCategoryKey;
              const existingParent = designDestinationRecords.find((item) => item.key === category.parentKey);
              if (existingParent) {
                const plannedParent = categories.find((item) => item.existingKey === existingParent.key);
                if (plannedParent) category.parentKey = plannedParent.key;
                else if (existingParent.id === rootAnchor.id) category.parentKey = anchorCategoryKey;
              }
            }
            categories.unshift({ key: anchorCategoryKey, label: rootAnchor.label, type: rootAnchor.type, existingKey: rootAnchor.key, parentKey: null, reason: '選択された再編起点' });
            const categoryKeyByExisting = new Map(categories.filter((item) => item.existingKey).map((item) => [item.existingKey, item.key]));
            const remaining = designDestinationRecords.filter((item) => item.id !== rootAnchor.id && !categoryKeyByExisting.has(item.key));
            for (let pass = 0; remaining.length && pass <= designDestinationRecords.length; pass += 1) {
              let added = false;
              for (let index = remaining.length - 1; index >= 0; index -= 1) {
                const record = remaining[index];
                const parentRecord = record.parentId ? destinationRecords.find((item) => item.id === record.parentId) : null;
                const parentKey = parentRecord?.id === rootAnchor.id ? anchorCategoryKey : categoryKeyByExisting.get(parentRecord?.key);
                if (!parentKey) continue;
                const internalKey = `__retained_${record.key}`;
                categories.push({ key: internalKey, label: record.label, type: record.type, existingKey: record.key, parentKey, reason: '既存階層を維持' });
                categoryKeyByExisting.set(record.key, internalKey);
                remaining.splice(index, 1);
                added = true;
              }
              if (!added) break;
            }
            const categoryKeyByRecordId = new Map(designDestinationRecords.map((item) => [item.id, categoryKeyByExisting.get(item.key)]));
            for (const category of categories) {
              if (category.key === anchorCategoryKey || categories.some((item) => item.key === category.parentKey)) continue;
              const parentRecord = designDestinationRecords.find((item) => item.key === category.parentKey || item.id === category.parentKey);
              if (parentRecord) category.parentKey = parentRecord.id === rootAnchor.id
                ? anchorCategoryKey : categoryKeyByRecordId.get(parentRecord.id) || category.parentKey;
            }
            result = { ...result, categories };
            break;
          }
          const categoryByKey = new Map(categories.map((category) => [category.key, category]));
          for (const category of categories) {
            if (category.type !== 'middle' || categoryByKey.has(category.parentKey)) continue;
            // The model sometimes uses an existing-hierarchy key or a taxonomy-skeleton
            // key where the final design requires a key from its own categories array.
            const includedExistingTop = categories.find((item) => item.type === 'top' && item.existingKey === category.parentKey);
            if (includedExistingTop) {
              category.parentKey = includedExistingTop.key;
              continue;
            }
            const existingTop = availableTopByKey.get(category.parentKey);
            const skeletonTop = skeletonTopByKey.get(category.parentKey);
            const parent = existingTop
              ? { key: existingTop.key, label: existingTop.label, type: 'top', existingKey: existingTop.key, parentKey: null, reason: '既存上位クラスを親として再利用' }
              : skeletonTop
                ? { key: skeletonTop.key, label: skeletonTop.label, type: 'top', existingKey: null, parentKey: null, reason: skeletonTop.reason || '分類骨組みの上位クラス' }
                : null;
            if (parent && categories.length < 200 && !categoryByKey.has(parent.key)) {
              categories.push(parent);
              categoryByKey.set(parent.key, parent);
            }
          }
          result = { ...result, categories };
          const categoryTypes = new Map(categories.map((category) => [category.key, category.type]));
          const invalidParent = categories.find((category) => category.type === 'middle'
            && categoryTypes.get(category.parentKey) !== 'top');
          if (!invalidParent || attempt === 2) break;
          onProgress({ stage: 'analyzing', note: '中間クラスの親参照を検証し、設計を修正しています' });
          repairInput = [
            ...input,
            { role: 'assistant', content: JSON.stringify(result) },
            { role: 'user', content: JSON.stringify({
              validationError: `中間クラス「${invalidParent.label || invalidParent.key}」のparentKey「${invalidParent.parentKey ?? 'null'}」が、同じcategories配列内のtype=topのkeyを指していません。`,
              instruction: 'categoriesを修正してください。すべてのmiddleのparentKeyを、同じ応答のcategories内に存在するtype=topのkeyと完全一致させてください。該当するtopがなければtopカテゴリを追加し、そのkeyを指定してください。その他の有効な分類は維持してください。'
            }) }
          ];
        }
        return result;
      },
      validate(unit, result, { checkpoint }) {
        const disposition = dispositionState(checkpoint);
        if (!Array.isArray(result?.categories) || (targets.length > 0 && !result.categories.length)) return '再編構造に分類先がありません。';
        const keys = result.categories.map((item) => item.key);
        if (keys.some((key) => typeof key !== 'string' || !key) || new Set(keys).size !== keys.length) return '再編構造のkeyが空または重複しています。';
        const existingKeys = result.categories.map((item) => item.existingKey).filter(Boolean);
        if (new Set(existingKeys).size !== existingKeys.length) return '同じ既存分類が再編構造に重複しています。';
        const availableRecords = rootAnchor ? designDestinationRecords : fastPath ? destinationRecords : structureAvailableRecords(checkpoint);
        const availableKeys = new Set(availableRecords.map((item) => item.key));
        if (existingKeys.some((key) => !availableKeys.has(key))) return '維持判定されていない既存分類が構造案に含まれています。';
        if (rootAnchor) {
          const anchor = result.categories.find((item) => item.key === anchorCategoryKey);
          if (!anchor || anchor.existingKey !== rootAnchor.key || anchor.type !== rootAnchor.type) return '選択された再編起点が設計にありません。';
          const byKey = new Map(result.categories.map((item) => [item.key, item]));
          if (result.categories.some((item) => (item.key !== anchorCategoryKey && item.type !== 'middle') || !item.label?.trim())) return '再編起点配下に不正な階層または名称のない分類があります。';
          for (const item of result.categories) {
            if (item.key === anchorCategoryKey) continue;
            const plannedParent = byKey.get(item.parentKey);
            if (item.parentKey === item.key || !plannedParent || !['top', 'middle'].includes(plannedParent.type)
              || (plannedParent.type === 'top' && plannedParent.key !== anchorCategoryKey)) return '中間クラスの親が設計内にありません。';
            const existing = item.existingKey ? destinationByKey.get(item.existingKey) : null;
            if (existing && (existing.type !== 'middle' || (!existing.editable && existing.id !== rootAnchor.id))) return '選択範囲外の中間クラスを変更する設計です。';
            if (existing && item.label.trim() !== existing.label && !existing.editable) return '変更範囲外の既存中間クラスを改名する設計です。';
            if (existing && !existing.editable) {
              const parent = byKey.get(item.parentKey);
              const parentId = parent?.existingKey ? destinationByKey.get(parent.existingKey)?.id : null;
              if (existing.parentId !== parentId) return '変更範囲外の既存中間クラスを移動する設計です。';
            }
            let cursor = item; const seen = new Set();
            while (cursor && cursor.key !== anchorCategoryKey) {
              if (seen.has(cursor.key)) return '選択ルート配下の親子関係が循環しています。';
              seen.add(cursor.key); cursor = byKey.get(cursor.parentKey);
            }
            if (!cursor) return '分類が指定された再編起点の配下にありません。';
          }
          if (anchor.label !== rootAnchor.label || anchor.parentKey !== null) return '選択された再編起点を変更する設計です。';
          return true;
        }
        if (fastPath) {
          const deletes = result.deleteKeys;
          const editableKeys = dispositionItems.map((item) => item.key);
          if (!Array.isArray(deletes) || new Set(deletes).size !== deletes.length || deletes.some((key) => !editableKeys.includes(key))) return '一括設計の削除対象が不正です。';
          if (existingKeys.some((key) => deletes.includes(key))) return '削除対象が再編構造に含まれています。';
        }
        for (const item of result.categories) {
          if (!['top', 'middle'].includes(item.type) || !item.label?.trim()) return '再編分類の型または名称が不正です。';
          const existing = item.existingKey ? destinationByKey.get(item.existingKey) : null;
          if (item.existingKey && (!existing || existing.type !== item.type)) return '既存分類の参照先または型が不正です。';
          if (existing && item.label.trim() !== existing.label && !existing.editable) return '変更範囲外の既存分類を改名する設計です。';
          if (item.type === 'top' && item.parentKey !== null) return '上位クラスに親が指定されています。';
          if (item.type === 'middle' && !keys.includes(item.parentKey)) return '中間クラスの親が設計内にありません。';
          if (item.type === 'middle' && result.categories.find((parent) => parent.key === item.parentKey)?.type !== 'top') return '中間クラスの親は上位クラスである必要があります。';
          if (existing?.type === 'middle') {
            const plannedParent = result.categories.find((parent) => parent.key === item.parentKey);
            const plannedParentId = plannedParent?.existingKey ? destinationByKey.get(plannedParent.existingKey)?.id : null;
            if ((!plannedParentId || existing.parentId !== plannedParentId) && !existing.editable) return '変更範囲外の既存中間クラスを移動する設計です。';
          }
        }
        const deletedIds = new Set((fastPath ? result.deleteKeys : disposition.deleteKeys).map((key) => destinationByKey.get(key)?.id).filter(Boolean));
        for (const item of result.categories.filter((category) => category.type === 'middle' && category.existingKey)) {
          const existing = destinationByKey.get(item.existingKey);
          const plannedParent = result.categories.find((category) => category.key === item.parentKey);
          const plannedParentId = plannedParent?.existingKey ? destinationByKey.get(plannedParent.existingKey)?.id : null;
          if (existing?.parentId && deletedIds.has(existing.parentId)
            && (!plannedParent || (plannedParentId && deletedIds.has(plannedParentId)))) {
            return '削除予定の上位クラス配下に残る中間クラスがあります。';
          }
        }
        const retainedMiddleIds = new Set(result.categories.filter((item) => item.type === 'middle' && item.existingKey)
          .map((item) => destinationByKey.get(item.existingKey)?.id).filter(Boolean));
        for (const deletedTopId of deletedIds) {
          const deletedTop = destinationRecords.find((item) => item.id === deletedTopId);
          if (deletedTop?.type !== 'top') continue;
          const directMiddles = destinationRecords.filter((item) => item.type === 'middle' && item.parentId === deletedTopId);
          for (const middle of directMiddles) {
            if (!deletedIds.has(middle.id) && !retainedMiddleIds.has(middle.id)) return '削除予定の上位クラス配下に維持・削除が未確定の中間クラスがあります。';
            if (retainedMiddleIds.has(middle.id)) {
              const planned = result.categories.find((item) => item.existingKey === middle.key);
              const parent = result.categories.find((item) => item.key === planned?.parentKey);
              const plannedParentId = parent?.existingKey ? destinationByKey.get(parent.existingKey)?.id : null;
              if (plannedParentId === deletedTopId) return '削除予定の上位クラス配下に残る中間クラスがあります。';
            }
          }
        }
        return true;
      }
    };

    const assignmentSchema = (items, categories) => ({
      type: 'object', additionalProperties: false,
      properties: { assignments: { type: 'array', minItems: items.length, maxItems: items.length, items: {
        type: 'object', additionalProperties: false,
        properties: {
          itemNumber: { type: 'integer', minimum: 1, maximum: items.length },
          disposition: { type: 'string', enum: ['keep', 'move', 'hold'] },
          destinationKey: { anyOf: [{ type: 'string', enum: categories.map((item) => item.key) }, { type: 'null' }] },
          reason: { type: 'string', maxLength: 400 }
        }, required: ['itemNumber', 'disposition', 'destinationKey', 'reason']
      } } }, required: ['assignments']
    });
    const assignmentBatches = Array.from({ length: Math.ceil(targets.length / PAGE_BATCH_SIZE) }, (_, index) => ({
      id: `batch-${index + 1}`, items: targets.slice(index * PAGE_BATCH_SIZE, (index + 1) * PAGE_BATCH_SIZE)
    }));
    const assignmentPhase = {
      id: 'class-placement', units: assignmentBatches,
      async execute(unit, { checkpoint }) {
        const design = checkpoint.phases.find((phase) => phase.id === 'structure-design')?.units[0]?.result;
        if (!design) throw new Error('再編構造が保存されていません。');
        onProgress({ stage: 'analyzing', note: `${unit.items.length}件の対象について新しい構造への配置を判断しています` });
        const requestAssignments = async (items, batchLabel, attempt = 0, priorError = null) => {
          const input = [
            { role: 'system', content: [
              '提示された再編後の構造に、各対象クラスを一件ずつ割り当ててください。移動案を求められていれば、情報が足りる対象は最も妥当な分類先へ配置します。',
              '現在の親が適切ならkeepとして現在の親に対応する分類keyを返します。分類先が確定できない場合だけholdにし、具体的な不足理由を記します。',
              '番号はこのバッチ内のitemNumberだけを使い、各番号を重複・漏れなく一度ずつ返します。存在しない分類keyを作らないでください。',
              priorError ? `前回の応答は読み取りまたは件数検証に失敗しました: ${priorError} 今回は指定件数分の完全なJSONだけを返してください。` : ''
            ].filter(Boolean).join('\n') },
            { role: 'user', content: JSON.stringify({
              request, objective: plan.executionBrief, batch: batchLabel,
              categories: design.categories.map(({ key, label, type, parentKey, reason }) => ({ key, label, type, parentKey, reason })),
              items: items.map((item, index) => ({ itemNumber: index + 1, label: item.label, currentParent: item.parentLabel || null }))
            }) }
          ];
          const outputLimit = Math.min(32000, Math.max(maxOutputTokens, 1024 + items.length * 64));
          let error;
          try {
            const response = await callAI(input, 'reorganization_placement', assignmentSchema(items, design.categories), outputLimit);
            const text = responseText(response);
            if (!text.trim()) throw Object.assign(new Error(responseFailure(response)), { code: 'INVALID_REORG_PLACEMENT' });
            let value;
            try { value = JSON.parse(text); }
            catch { throw Object.assign(new Error('配置回答が有効なJSONではありません。'), { code: 'INVALID_REORG_PLACEMENT' }); }
            const rows = value?.assignments;
            const numbers = Array.isArray(rows) ? rows.map((row) => row?.itemNumber) : [];
            if (!Array.isArray(rows) || rows.length !== items.length
              || new Set(numbers).size !== items.length
              || items.some((__, index) => !numbers.includes(index + 1))) {
              throw Object.assign(new Error('割当件数またはitemNumberに漏れ・重複があります。'), { code: 'INVALID_REORG_PLACEMENT' });
            }
            return rows;
          } catch (caught) {
            error = caught;
          }
          if (error?.code !== 'INVALID_REORG_PLACEMENT') throw error;
          if (attempt < MAX_PLACEMENT_RETRIES) {
            onProgress({ stage: 'analyzing', note: `配置回答を読み取れなかったため、${items.length}件を再試行しています（${attempt + 1}/${MAX_PLACEMENT_RETRIES}）` });
            return requestAssignments(items, batchLabel, attempt + 1, error.message);
          }
          if (items.length < 2) throw error;
          const midpoint = Math.ceil(items.length / 2);
          onProgress({ stage: 'analyzing', note: `配置回答が不完全なため、${items.length}件を分割して再処理します` });
          const left = await requestAssignments(items.slice(0, midpoint), `${batchLabel}.1`);
          const right = await requestAssignments(items.slice(midpoint), `${batchLabel}.2`);
          return [...left, ...right.map((row) => ({ ...row, itemNumber: row.itemNumber + midpoint }))];
        };
        const assignments = await requestAssignments(unit.items, unit.id);
        return {
          assignments: assignments.map((row) => ({ ...row, targetId: unit.items[row.itemNumber - 1]?.id || null }))
        };
      },
      validate(unit, result, { checkpoint }) {
        const design = checkpoint.phases.find((phase) => phase.id === 'structure-design')?.units[0]?.result;
        const rows = result?.assignments;
        if (!Array.isArray(rows) || rows.length !== unit.items.length) return 'バッチの割当件数が対象件数と一致しません。';
        const numbers = rows.map((row) => row.itemNumber);
        if (new Set(numbers).size !== unit.items.length || unit.items.some((__, index) => !numbers.includes(index + 1))) return 'バッチ内の割当に重複または漏れがあります。';
        const categoryKeys = new Set(design?.categories.map((item) => item.key) || []);
        const validRows = rows.every((row) => ['keep', 'move', 'hold'].includes(row.disposition)
          && (row.disposition === 'hold' ? row.destinationKey === null : categoryKeys.has(row.destinationKey))
          && typeof row.reason === 'string') ? true : 'クラス割当の分類先または理由が不正です。';
        if (validRows !== true) return validRows;
        for (const row of rows) {
          if (row.disposition !== 'keep') continue;
          const target = unit.items[row.itemNumber - 1];
          const category = design.categories.find((item) => item.key === row.destinationKey);
          const parent = category?.existingKey ? destinationByKey.get(category.existingKey) : null;
          if (!parent || parent.id !== target.parentId) return '現状維持の判定先が現在の親と一致しません。';
        }
        return true;
      },
      validatePhase(results) {
        const all = results.flatMap((unit) => unit.result?.assignments || []);
        const expectedIds = new Set(targets.map((item) => item.id));
        return all.length === expectedIds.size && new Set(all.map((item) => item.targetId)).size === expectedIds.size
          && all.every((item) => expectedIds.has(item.targetId))
          ? true : '全対象の配置判定が揃っていません。';
      }
    };

    const phases = [targetPhase, hierarchyPhase, dispositionPhase, structureEvidencePhase, taxonomySkeletonPhase, destinationPhase, structurePhase, assignmentPhase];
    const actionPhases = phases.slice(2);
    const actionById = new Map(actionPhases.map((phase) => [phase.id, phase]));
    const actionRequirements = {
      'existing-class-disposition': [],
      'structure-evidence': [],
      'taxonomy-skeleton': ['structure-evidence'],
      'destination-shortlist': ['existing-class-disposition', 'structure-evidence', 'taxonomy-skeleton'],
      'structure-design': ['existing-class-disposition', 'structure-evidence', 'taxonomy-skeleton', 'destination-shortlist'],
      'class-placement': ['structure-design']
    };
    const actionDescriptions = {
      'existing-class-disposition': 'まず既存の上位・中間クラスを確認し、再編後も維持するものと削除候補を整理します。',
      'structure-evidence': '次に対象全体を見渡し、再編後の分類を考えるための根拠をまとめます。',
      'taxonomy-skeleton': 'その内容をもとに、再編後に必要な分類の骨組みを考えます。',
      'destination-shortlist': '続いて、既存階層から再利用できる移動先があるかを調べます。',
      'structure-design': '分類候補と既存クラスを照らし合わせ、再編後の親子構造を確定します。',
      'class-placement': `最後に、対象${targets.length.toLocaleString('ja-JP')}件を一件ずつ構造案に照らし、維持・移動・保留を判断します。`
    };
    const summarizeActionResult = (phase) => {
      const results = phase.units.filter((unit) => unit.status === 'completed').map((unit) => unit.result);
      if (phase.id === 'existing-class-disposition') {
        const decisions = results.flatMap((result) => result?.decisions || []);
        return { kept: decisions.filter((item) => item.disposition === 'keep').length, deleted: decisions.filter((item) => item.disposition === 'delete').length };
      }
      if (phase.id === 'structure-evidence') return results.map((result) => ({ summary: result?.summary, themes: result?.themes }));
      if (phase.id === 'taxonomy-skeleton') return results[0]?.categories?.map(({ key, label, type, parentKey }) => ({ key, label, type, parentKey })) || [];
      if (phase.id === 'destination-shortlist') return { candidateCount: results.flatMap((result) => result?.candidateKeys || []).length };
      if (phase.id === 'structure-design') return { designReason: results[0]?.designReason, categories: results[0]?.categories?.map(({ key, label, type, existingKey, parentKey }) => ({ key, label, type, existingKey, parentKey })) || [] };
      if (phase.id === 'class-placement') {
        const assignments = results.flatMap((result) => result?.assignments || []);
        return { keep: assignments.filter((item) => item.disposition === 'keep').length, move: assignments.filter((item) => item.disposition === 'move').length, hold: assignments.filter((item) => item.disposition === 'hold').length };
      }
      return null;
    };
    const actionCompletionMessage = (phaseId) => {
      const phase = activeJob.phases.find((item) => item.id === phaseId);
      const summary = phase ? summarizeActionResult(phase) : null;
      if (phaseId === 'existing-class-disposition') return `既存の上位・中間クラスを確認しました。再編後も維持すると判断したものは${summary?.kept || 0}件、削除候補は${summary?.deleted || 0}件です。再編後の構造全体は、対象内容を確認してから設計します。`;
      if (phaseId === 'structure-evidence') return `対象全体の要約工程を終えました。今回は要約バッチが${phase?.units.length || 0}件でした。この結果を踏まえて、再編の分類軸を整理します。`;
      if (phaseId === 'taxonomy-skeleton') return summary?.length
        ? `対象全体から再編後の分類骨組みを作成しました。分類候補は${summary.length}件です。次に、既存階層に再利用できる移動先があるか確認します。`
        : '対象全体から独立した分類候補は作成されませんでした。続いて、既存階層に再利用できる移動先があるか確認します。';
      if (phaseId === 'destination-shortlist') return `既存階層の確認を終えました。移動先候補は${summary?.candidateCount || 0}件です。この結果を分類骨組みと合わせて、再編後の構造を決めます。`;
      if (phaseId === 'structure-design') {
        const categories = phase?.units.flatMap((unit) => unit.result?.categories || []) || [];
        const topCount = categories.filter((item) => item.type === 'top').length;
        const middleCount = categories.filter((item) => item.type === 'middle').length;
        return `再編後の構造案を作成しました。案には上位クラス${topCount}件、中間クラス${middleCount}件を含みます。この数には既存クラスの再利用も含まれるため、実際に追加・改名する件数とは異なります。続いて各対象の配置を判断します。`;
      }
      if (phaseId === 'class-placement') return `対象${targets.length.toLocaleString('ja-JP')}件の配置先を確認しました。判断結果は維持${summary?.keep || 0}件、移動先を指定${summary?.move || 0}件、保留${summary?.hold || 0}件です。ここでの「移動」は配置先の判断数です。現在の親子関係と照合した実際の移動操作数は、最終案で分けてお伝えします。`;
      return `${actionDescriptions[phaseId] || '作業'}が完了しました`;
    };
    const runAdaptiveActions = async () => {
      const maxActions = actionPhases.length + 1;
      for (let iteration = 0; iteration < maxActions; iteration += 1) {
        const savedById = new Map(activeJob.phases.map((phase) => [phase.id, phase]));
        const completed = new Set([...savedById.values()].filter((phase) => phase.status === 'completed').map((phase) => phase.id));
        const incompleteStarted = actionPhases.find((phase) => {
          const savedPhase = savedById.get(phase.id);
          return savedPhase && savedPhase.status !== 'completed'
            && (['running', 'paused', 'failed'].includes(savedPhase.status)
              || savedPhase.units.some((unit) => unit.status === 'completed' || unit.status === 'paused'));
        });
        const ready = actionPhases.filter((phase) => !completed.has(phase.id)
          && phase.units.length > 0
          && actionRequirements[phase.id].every((requiredId) => completed.has(requiredId)));
        const noOpReady = actionPhases.filter((phase) => !completed.has(phase.id)
          && phase.units.length === 0
          && actionRequirements[phase.id].every((requiredId) => completed.has(requiredId)));
        const selectedPhase = incompleteStarted || noOpReady[0] || (ready.length === 1 ? ready[0] : null);
        let nextPhase = selectedPhase;
        if (!nextPhase && ready.length > 1) {
          const savedSummary = actionPhases.filter((phase) => completed.has(phase.id)).map((phase) => ({
            action: phase.id, result: summarizeActionResult(savedById.get(phase.id))
          }));
          const decision = parseAI(await callAI([
            { role: 'system', content: [
              '再編作業のチェックポイントと完了済みの結果を確認し、今実行する作業を一つ選んでください。',
              '提示された候補以外は選べません。すでに完了した作業は選ばず、判断に役立つ情報を先に得られる作業を選んでください。内部思考は出力せず、選択したactionだけを返してください。'
            ].join('\n') },
            { role: 'user', content: JSON.stringify({
              request, objective: plan.executionBrief,
              targetCount: targets.length,
              targetOverview: targets.slice(0, 30).map((item) => ({ label: item.label, currentParent: item.parentLabel || null })),
              existingStructureOverview: {
                topCount: destinationRecords.filter((item) => item.type === 'top').length,
                middleCount: destinationRecords.filter((item) => item.type === 'middle').length,
                examples: destinationRecords.slice(0, 50).map((item) => ({ label: item.label, type: item.type, parent: item.parentLabel || null }))
              },
              completedActions: savedSummary,
              availableActions: ready.map((phase) => ({ id: phase.id, description: actionDescriptions[phase.id] }))
            }) }
          ], 'reorganization_next_action', {
            type: 'object', additionalProperties: false,
            properties: { action: { type: 'string', enum: ready.map((phase) => phase.id) } },
            required: ['action']
          }), 'INVALID_REORG_NEXT_ACTION', '次に行う再編作業を選べませんでした。');
          nextPhase = actionById.get(decision.action);
        }
        if (!nextPhase) {
          const allCompleted = actionPhases.every((phase) => completed.has(phase.id));
          if (allCompleted) return { status: 'completed', checkpoint: activeJob };
          throw Object.assign(new Error('再編ジョブに実行可能な次の作業がありません。'), { code: 'REORG_NO_AVAILABLE_ACTION' });
        }
        const taskAction = nextPhase.id === 'class-placement' ? 'place_items' : nextPhase.id === 'structure-design'
          ? 'design_structure' : nextPhase.id === 'destination-shortlist' ? 'inspect_existing_destinations' : 'inspect_scope';
        const authorization = authorizeTaskAction(activeJob.metadata.taskState, {
          action: taskAction,
          input: taskAction === 'place_items' ? { targetIds: targets.map((item) => item.id), phaseId: nextPhase.id } : { phaseId: nextPhase.id }
        }, { scopeIds: sortedScope, dataVersion, maxIterations: actionPhases.length + 1 });
        if (!authorization.allowed) {
          throw Object.assign(new Error(`再編工程を許可できません: ${authorization.reason}`), {
            code: 'TASK_ACTION_DENIED', reason: authorization.reason
          });
        }
        const orderedPhases = [
          ...activeJob.phases.map((phase) => actionById.get(phase.id) || (phase.id === 'target-snapshot' ? targetPhase : phase.id === 'hierarchy-snapshot' ? hierarchyPhase : null)).filter(Boolean),
          nextPhase
        ];
        onProgress({ stage: 'analyzing', milestone: true, note: actionDescriptions[nextPhase.id] });
        const result = await runJobLoop({ checkpoint: activeJob, dataVersion, signal, phases: orderedPhases, onCheckpoint: persist, onProgress });
        activeJob = result.checkpoint;
        const taskState = recordTaskAction(activeJob.metadata.taskState, {
          action: taskAction, input: { phaseId: nextPhase.id }, outcome: result.status,
          evidence: { completedPhase: result.status === 'completed' }
        });
        if (taskState) {
          activeJob.metadata.taskState = taskState;
          await persist(activeJob);
        }
        if (result.status === 'completed') {
          onProgress({ stage: 'analyzing', milestone: true, note: actionCompletionMessage(nextPhase.id) });
        }
        if (result.status !== 'completed') {
          const currentTask = normalizeTaskState(activeJob.metadata.taskState);
          if (currentTask) {
            activeJob.metadata.taskState = stopTask(currentTask, {
              reason: result.status === 'paused' ? 'budget_or_checkpoint_limit' : result.status,
              awaitingUserInput: result.status === 'needs_user_input' ? { reason: 'placement_guidance' }
                : result.status === 'needs_scope_approval' ? { reason: 'scope_approval' } : null
            });
            await persist(activeJob);
          }
          return result;
        }
      }
      throw Object.assign(new Error('再編ジョブが作業反復の上限に達しました。'), { code: 'REORG_ACTION_LIMIT', status: 'budget_exhausted' });
    };
    let completed;
    try { completed = await runAdaptiveActions(); }
    catch (error) {
      if (error.scopeRequest) return { status: 'needs_scope_approval', scopeRequest: error.scopeRequest, checkpoint: activeJob };
      throw error;
    }
    activeJob = completed.checkpoint;
    if (completed.status !== 'completed') return pauseMessage(completed);

    const design = readResults('structure-design')[0];
    const categories = design.categories;
    const deleteKeys = fastPath ? (design.deleteKeys || []) : dispositionState(activeJob).deleteKeys;
    const deleteReasons = dispositionState(activeJob).phase?.units.flatMap((unit) => unit.result?.decisions || [])
      .filter((item) => item.disposition === 'delete').map((item) => item.reason) || [];
    const categoryByKey = new Map(categories.map((item) => [item.key, item]));
    const assignmentsByTarget = new Map();
    for (const batch of assignmentBatches) {
      const result = activeJob.phases.find((phase) => phase.id === 'class-placement')?.units.find((unit) => unit.id === batch.id)?.result;
      for (const row of result?.assignments || []) {
        const target = batch.items[row.itemNumber - 1];
        if (target) assignmentsByTarget.set(target.id, { ...row, target });
      }
    }
    if (assignmentsByTarget.size !== targets.length) return { status: 'incomplete_job', checkpoint: activeJob };

    const operationList = [];
    const categoryRef = new Map();
    if (rootAnchor) categoryRef.set(anchorCategoryKey, identity(hierarchyById.get(rootAnchor.id)));
    const topCategories = categories.filter((item) => item.type === 'top');
    for (const item of topCategories) {
      if (item.existingKey) {
        const existing = destinationByKey.get(item.existingKey);
        categoryRef.set(item.key, identity(hierarchyById.get(existing.id)));
        if (item.label.trim() !== existing.label) operationList.push({ type: 'rename_top_class', target: identity(hierarchyById.get(existing.id)), newParent: null, tempId: null, label: item.label.trim() });
      } else {
        const tempId = `reorg_${item.key}`;
        categoryRef.set(item.key, temporary(tempId));
        operationList.push({ type: 'add_top_class', target: null, newParent: null, tempId, label: item.label.trim() });
      }
    }
    const pendingMiddleCategories = categories.filter((item) => item.type === 'middle' && item.key !== anchorCategoryKey);
    while (pendingMiddleCategories.length) {
      const readyIndex = pendingMiddleCategories.findIndex((item) => categoryRef.has(item.parentKey));
      if (readyIndex < 0) return { status: 'invalid_job', message: '再編構造の中間クラス親参照を解決できません。' };
      const [item] = pendingMiddleCategories.splice(readyIndex, 1);
      const parentRef = categoryRef.get(item.parentKey);
      if (item.existingKey) {
        const existing = destinationByKey.get(item.existingKey);
        const record = hierarchyById.get(existing.id);
        categoryRef.set(item.key, identity(record));
        if (item.label.trim() !== existing.label) operationList.push({ type: 'rename_middle_class', target: identity(record), newParent: null, tempId: null, label: item.label.trim() });
        const currentParent = existing.parentId;
        const desiredParent = parentRef.kind === 'existing_class' ? parentRef.classId : null;
        if (desiredParent && currentParent !== desiredParent) operationList.push({ type: 'move_middle_class', target: identity(record), newParent: parentRef, tempId: null, label: null });
        else if (parentRef.kind === 'temporary_class') operationList.push({ type: 'move_middle_class', target: identity(record), newParent: parentRef, tempId: null, label: null });
      } else {
        const tempId = `reorg_${item.key}`;
        categoryRef.set(item.key, temporary(tempId));
        operationList.push({ type: 'add_middle_class', target: null, newParent: parentRef, tempId, label: item.label.trim() });
      }
    }

    const targetById = new Map(targets.map((item) => [item.id, item]));
    const movedByCategory = new Map();
    const reasonByCategory = new Map();
    const held = [];
    for (const [targetId, row] of assignmentsByTarget) {
      const target = targetById.get(targetId);
      if (row.disposition === 'hold') { held.push({ item: target, reason: row.reason }); continue; }
      const category = categoryByKey.get(row.destinationKey);
      if (!category) return { status: 'invalid_job', message: '割当先の再編分類が見つかりません。' };
      const newParent = categoryRef.get(category.key);
      if (!newParent) return { status: 'invalid_job', message: '割当先のクラス参照が見つかりません。' };
      const currentParent = target.parentId || null;
      const parentId = newParent.kind === 'existing_class' ? newParent.classId : null;
      const isKeep = row.disposition === 'keep' && currentParent === parentId;
      if (!isKeep && !(newParent.kind === 'existing_class' && currentParent === newParent.classId)) {
        const operation = { type: 'move_target_class', target: identity(target), newParent, tempId: null, label: null };
        operationList.push(operation);
        if (!movedByCategory.has(category.key)) movedByCategory.set(category.key, []);
        movedByCategory.get(category.key).push(target.label);
        if (!reasonByCategory.has(category.key)) reasonByCategory.set(category.key, []);
        reasonByCategory.get(category.key).push(row.reason);
      }
    }
    const deletedIds = new Set(deleteKeys.map((key) => destinationByKey.get(key)?.id).filter(Boolean));
    const unresolvedUnderDeletion = targets.filter((target) => {
      let parentId = target.parentId || null;
      while (parentId) {
        if (deletedIds.has(parentId)) return assignmentsByTarget.get(target.id)?.disposition === 'hold';
        parentId = hierarchyById.get(parentId)?.parentId || null;
      }
      return false;
    });
    if (unresolvedUnderDeletion.length) {
      activeJob.status = 'paused'; activeJob.metadata.awaitingUserInput = 'placement'; activeJob.updatedAt = Date.now(); await onCheckpoint(activeJob);
      return {
        status: 'needs_user_input', checkpoint: activeJob,
        message: `削除予定の分類配下に移動先を確定できない対象があります: ${unresolvedUnderDeletion.slice(0, 8).map((item) => item.label).join('、')}${unresolvedUnderDeletion.length > 8 ? 'ほか' : ''}。移動先の条件を指定してください。`
      };
    }
    const deletedCategories = deleteKeys.map((key) => destinationByKey.get(key)).filter(Boolean);
    const deletedMiddle = deletedCategories.filter((item) => item.type === 'middle');
    const deletedTop = deletedCategories.filter((item) => item.type === 'top');
    for (const item of deletedMiddle) operationList.push({ type: 'delete_middle_class', target: identity(hierarchyById.get(item.id)), newParent: null, tempId: null, label: null });
    for (const item of deletedTop) operationList.push({ type: 'delete_top_class', target: identity(hierarchyById.get(item.id)), newParent: null, tempId: null, label: null });
    if (!operationList.length) {
      activeJob.status = 'completed'; activeJob.completedAt = Date.now(); await onCheckpoint(activeJob);
      return {
        text: JSON.stringify({ message: `${targets.length}件を確認しました。現在の階層で維持できると判断し、変更案はありません。${held.length ? ` ${held.length}件は分類先を確定できず保留しています。` : ''}`, proposals: [], alternativeGroups: [] }),
        messages: [], checkpoint: activeJob, counters: budgetGuard.getCounters()
      };
    }
    const assignmentCounts = {
      keep: [...assignmentsByTarget.values()].filter((item) => item.disposition === 'keep').length,
      move: [...assignmentsByTarget.values()].filter((item) => item.disposition === 'move').length,
      hold: held.length
    };
    const movedCount = operationList.filter((operation) => operation.type === 'move_target_class').length;
    const structureChangeCount = operationList.length - movedCount;
    const deletedCount = operationList.filter((operation) => operation.type.startsWith('delete_')).length;
    const placementSummary = [...movedByCategory].map(([key, items]) => `${categoryByKey.get(key)?.label || '分類先不明'}へ${items.length}件`).join('、');
    const deletedLabels = deletedCategories.map((item) => item.label);
    const assignmentAndOperationNote = assignmentCounts.move === movedCount
      ? `配置判断で移動先を指定した${assignmentCounts.move}件について、実際の移動操作も${movedCount}件です。`
      : `配置判断では${assignmentCounts.move}件に移動先を指定しました。現在の親子関係との照合後、実際に必要な末端クラスの移動操作は${movedCount}件です。配置先の判断数と操作数は異なる場合があります。`;
    const message = `対象${targets.length.toLocaleString('ja-JP')}件すべての配置先を確認し、再編案を作成しました。判断結果は、維持${assignmentCounts.keep}件、移動先を指定${assignmentCounts.move}件、保留${assignmentCounts.hold}件です。${assignmentAndOperationNote}${placementSummary ? `実際の移動先別の内訳は${placementSummary}です。` : '実際に必要な末端クラスの移動操作はありません。'}${deletedCount ? `不要な上位・中間クラス${deletedCount}件（${deletedLabels.join('、')}）は、配下を移動してから削除する案です。` : ''}末端クラスの移動以外に、上位・中間クラスへ加える構造変更操作は${structureChangeCount}件です。${held.length ? `${held.length}件は配置を決めず保留しています（${held.slice(0, 6).map(({ item }) => item.label).join('、')}${held.length > 6 ? 'ほか' : ''}）。` : ''}これは変更案で、編集データにはまだ適用していません。`;
    const response = {
      message,
      proposals: [{
        id: 'hierarchy_reorganization_1', title: '階層を再編して不要な分類を整理',
        summary: `${targets.length}件の対象を設計した階層へ配置し、必要な分類構造を追加・変更${deletedCount ? 'し、不要な分類を配下の移動後に削除' : ''}する案です。`,
        reason: [...new Set([design.designReason, ...deleteReasons, ...[...reasonByCategory.values()].flat()])].filter(Boolean).slice(0, 6).join('。') || '対象全体と現在の親子関係をもとに再編後の階層を設計しました。',
        uncertainties: held.length ? held.slice(0, 8).map(({ item, reason }) => `${item.label}: ${reason}`) : [],
        questions: [], operations: operationList
      }], alternativeGroups: []
    };
    activeJob.status = 'completed';
    const completedTask = normalizeTaskState(activeJob.metadata.taskState);
    if (completedTask) {
      const verifiedTask = normalizeTaskState({
        ...completedTask,
        confirmedFacts: [...completedTask.confirmedFacts, {
          kind: 'target_coverage', expectedCount: targets.length, processedCount: assignmentsByTarget.size,
          uniqueIds: assignmentsByTarget.size === new Set([...assignmentsByTarget.keys()]).size,
          verifiedAt: Date.now()
        }]
      });
      let checkedTask = verifiedTask;
      if (assignmentsByTarget.size === targets.length
        && assignmentsByTarget.size === new Set(assignmentsByTarget.keys()).size
        && operationList.every((operation) => operation && typeof operation.type === 'string')) {
        for (const criterion of checkedTask.completionCriteria) {
          checkedTask = recordTaskCriterion(checkedTask, criterion, {
            kind: 'reorganization_validation', targetCount: targets.length,
            processedCount: assignmentsByTarget.size, operationCount: operationList.length,
            heldCount: held.length, verifiedAt: Date.now()
          }) || checkedTask;
        }
      }
      activeJob.metadata.taskState = held.length
        ? stopTask(checkedTask, { reason: 'items_held_for_review', unfinishedItems: held.map((item) => item.item.label) })
        : completeTask(checkedTask);
    }
    activeJob.metadata.result = { movedCount, deletedIds: deletedCategories.map((item) => item.id), heldIds: held.map((item) => item.id), operationCount: operationList.length };
    activeJob.updatedAt = Date.now();
    activeJob.completedAt = activeJob.updatedAt;
    await onCheckpoint(activeJob);
    return { text: JSON.stringify(response), messages: [], checkpoint: activeJob, counters: budgetGuard.getCounters(), incomplete: Boolean(held.length) };
  }

  return Object.freeze({ run });
}
