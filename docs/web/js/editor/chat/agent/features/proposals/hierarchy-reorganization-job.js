import { createJobCheckpoint, normalizeJobCheckpoint, runJobLoop } from '../../application/job-loop.js';

const PAGE_BATCH_SIZE = 100;
const identity = (item) => ({ kind: 'existing_class', classId: item.id, tempId: null });
const temporary = (tempId) => ({ kind: 'temporary_class', classId: null, tempId });
const responseText = (response) => (response?.output || []).flatMap((item) => item.content || [])
  .find((item) => item.type === 'output_text')?.text || '';
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
  jobSelectedIds = null, jobTargetIds = null, jobHierarchyIds = null, continuationInput = ''
}) {
  if (!reader?.readHierarchyIndex || !reader?.readSelectedClassDetails || !client?.request || !budgetGuard) {
    throw new TypeError('階層再編ジョブに必要な依存関係が不足しています。');
  }
  const selectedIds = unique(Array.isArray(jobSelectedIds) ? jobSelectedIds : jobScopeIds || []);
  const editableIds = unique(Array.isArray(jobScopeIds) ? jobScopeIds : []);
  const targetIds = unique(Array.isArray(jobTargetIds) ? jobTargetIds : editableIds);
  const hierarchyIds = unique(Array.isArray(jobHierarchyIds) ? jobHierarchyIds : []);
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
    if (sameJob && JSON.stringify(saved.metadata.selectedIds || []) !== JSON.stringify(selectedIds)) return { status: 'stale_job', message: '保存済み再編ジョブの選択対象が現在と異なるため続行できません。' };
    if (sameJob && JSON.stringify(saved.metadata.targetIds || []) !== JSON.stringify(targetIds)) return { status: 'stale_job', message: '保存済み再編ジョブの末端対象が現在と異なるため続行できません。' };
    if (sameJob) {
      const priorHierarchyIds = saved.metadata.hierarchyIds || [];
      if (!priorHierarchyIds.every((id) => hierarchyIds.includes(id))) return { status: 'stale_job', message: '保存済み再編ジョブの参照範囲が現在と異なるため続行できません。' };
      if (priorHierarchyIds.length !== hierarchyIds.length || saved.metadata.designVersion !== 4) {
        activeJob = normalizeJobCheckpoint({
          ...saved,
          status: 'running',
          metadata: { ...saved.metadata, hierarchyIds, designVersion: 4 },
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
      metadata: { selectedIds, targetIds, hierarchyIds, executionMode: 'reorganization', designVersion: 4, userGuidance: [] }
    });
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
    if (JSON.stringify(actualTargetIds) !== JSON.stringify([...targetIds].sort((a, b) => a.localeCompare(b)))) return {
      status: 'stale_job', message: '取得した末端対象が変更許可範囲と一致しないため、再編を停止しました。'
    };
    if (!targets.length) return {
      text: JSON.stringify({ message: '選択範囲に再編対象の末端クラスがありません。', proposals: [], alternativeGroups: [] }),
      messages: [], counters: budgetGuard.getCounters()
    };

    const hierarchyById = new Map(hierarchy.map((item) => [item.id, item]));
    const destinationRecords = hierarchy.map((item, index) => ({
      key: `d${index + 1}`, id: item.id, label: item.label, type: item.type,
      parentId: item.parentId, parentLabel: item.parentLabel, editable: editableIds.includes(item.id)
    }));
    const destinationByKey = new Map(destinationRecords.map((item) => [item.key, item]));
    const editableExistingKeys = destinationRecords.filter((item) => item.editable).map((item) => item.key);
    const structureSchema = {
      type: 'object', additionalProperties: false,
      properties: {
        categories: { type: 'array', minItems: 1, maxItems: 200, items: {
          type: 'object', additionalProperties: false,
          properties: {
            key: { type: 'string', maxLength: 40 }, label: { type: 'string', maxLength: 120 },
            type: { type: 'string', enum: ['top', 'middle'] },
            existingKey: { anyOf: [{ type: 'string', enum: destinationRecords.map((item) => item.key) }, { type: 'null' }] },
            parentKey: { anyOf: [{ type: 'string', maxLength: 40 }, { type: 'null' }] },
            reason: { type: 'string', maxLength: 500 }
          }, required: ['key', 'label', 'type', 'existingKey', 'parentKey', 'reason']
        } },
        deleteKeys: { type: 'array', uniqueItems: true, items: { type: 'string', enum: editableExistingKeys } },
        designReason: { type: 'string', maxLength: 1000 }
      }, required: ['categories', 'deleteKeys', 'designReason']
    };
    const evidenceBatches = Array.from({ length: Math.ceil(targets.length / PAGE_BATCH_SIZE) }, (_, index) => ({
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
    const structurePhase = {
      id: 'structure-design', units: [{ id: 'whole-structure' }],
      async execute(unit, { checkpoint }) {
        onProgress({ stage: 'analyzing', note: '分割した対象の要約から再編後の上位・中間クラスを設計しています' });
        const evidence = checkpoint.phases.find((phase) => phase.id === 'structure-evidence')?.units || [];
        if (evidence.length !== evidenceBatches.length || evidence.some((item) => item.status !== 'completed')) {
          throw Object.assign(new Error('再編対象の分割要約が揃っていません。'), { code: 'REORG_EVIDENCE_INCOMPLETE' });
        }
        const input = [
          { role: 'system', content: [
            '対象全体を分類できる再編後の上位・中間クラス構造を設計してください。既存構造の維持だけで済ませず、依頼と全対象から必要な分類軸と階層を判断します。',
            '既存候補はkeyで再利用できます。必要な場合だけ新しいtopまたはmiddleを作ります。middleにはtopをparentKeyで指定してください。editable=falseの既存分類は参照専用で、名称や親を変更しません。editable=trueの既存分類に限り、明確な改善になる場合はlabelへ新名称を指定できます。',
            'editable=trueの既存top/middleは必ず、categoriesで維持・改名・移動するか、deleteKeysで削除するかを一つずつ明示してください。再編後に不要となる既存分類は削除候補にできます。削除する分類の配下は後工程で新設分類を含む再編先へ移し、移動後に削除します。editable=falseの分類は削除できません。',
            '全対象の移動先を後工程で決められるよう、対象範囲を過不足なく受け止める構造にします。名前が似ているだけで分類を統合せず、異なる概念を接続語や中点で無理にまとめません。',
            'この工程では操作列を作らず、不要な既存分類はdeleteKeysに記録してください。移動・削除操作は後段で全件検査後に生成します。存在しないIDやkeyは作らず、内部思考は出力しないでください。'
          ].join('\n') },
          { role: 'user', content: JSON.stringify({
            request, objective: plan.executionBrief, scope: { targetCount: targets.length },
            targetBatchSummaries: evidence.map((item, index) => ({ batch: evidenceBatches[index].id, summary: item.result.summary, themes: item.result.themes })),
            existingHierarchy: destinationRecords.map(({ key, label, type, parentLabel, editable }) => ({ key, label, type, parent: parentLabel, editable }))
          }) }
        ];
        return parseAI(await callAI(input, 'reorganization_structure', structureSchema), 'INVALID_REORG_STRUCTURE', '再編構造の応答を読み取れませんでした。');
      },
      validate(unit, result) {
        if (!Array.isArray(result?.categories) || !result.categories.length) return '再編構造に分類先がありません。';
        const keys = result.categories.map((item) => item.key);
        if (keys.some((key) => typeof key !== 'string' || !key) || new Set(keys).size !== keys.length) return '再編構造のkeyが空または重複しています。';
        const existingKeys = result.categories.map((item) => item.existingKey).filter(Boolean);
        if (new Set(existingKeys).size !== existingKeys.length) return '同じ既存分類が再編構造に重複しています。';
        if (!Array.isArray(result.deleteKeys) || new Set(result.deleteKeys).size !== result.deleteKeys.length
          || result.deleteKeys.some((key) => !editableExistingKeys.includes(key))) return '削除対象の既存分類keyが不正です。';
        if (result.deleteKeys.some((key) => destinationByKey.get(key)?.label === '未分類')) return '「未分類」は再編ジョブでも削除できません。';
        if (existingKeys.some((key) => result.deleteKeys.includes(key))) return '維持対象と削除対象に同じ既存分類があります。';
        if (editableExistingKeys.some((key) => !existingKeys.includes(key) && !result.deleteKeys.includes(key))) return '変更範囲内の既存分類に維持・削除の判定漏れがあります。';
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
        const deletedIds = new Set(result.deleteKeys.map((key) => destinationByKey.get(key)?.id).filter(Boolean));
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
          const deletedTop = destinationByKey.get(result.deleteKeys.find((key) => destinationByKey.get(key)?.id === deletedTopId));
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
        const input = [
          { role: 'system', content: [
            '提示された再編後の構造に、各対象クラスを一件ずつ割り当ててください。移動案を求められていれば、情報が足りる対象は最も妥当な分類先へ配置します。',
            '現在の親が適切ならkeepとして現在の親に対応する分類keyを返します。分類先が確定できない場合だけholdにし、具体的な不足理由を記します。',
            '番号はこのバッチ内のitemNumberだけを使い、各番号を重複・漏れなく一度ずつ返します。存在しない分類keyを作らないでください。'
          ].join('\n') },
          { role: 'user', content: JSON.stringify({
            request, objective: plan.executionBrief, categories: design.categories.map(({ key, label, type, parentKey, reason }) => ({ key, label, type, parentKey, reason })),
            items: unit.items.map((item, index) => ({ itemNumber: index + 1, label: item.label, currentParent: item.parentLabel || null }))
          }) }
        ];
        const value = parseAI(await callAI(input, 'reorganization_placement', assignmentSchema(unit.items, design.categories)), 'INVALID_REORG_PLACEMENT', 'クラス配置の応答を読み取れませんでした。');
        return {
          ...value,
          assignments: (value.assignments || []).map((row) => ({ ...row, targetId: unit.items[row.itemNumber - 1]?.id || null }))
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

    const phases = [targetPhase, hierarchyPhase, structureEvidencePhase, structurePhase, assignmentPhase];
    let completed;
    try { completed = await runJobLoop({ checkpoint: activeJob, dataVersion, signal, phases, onCheckpoint: persist, onProgress }); }
    catch (error) {
      if (error.scopeRequest) return { status: 'needs_scope_approval', scopeRequest: error.scopeRequest, checkpoint: activeJob };
      throw error;
    }
    activeJob = completed.checkpoint;
    if (completed.status !== 'completed') return pauseMessage(completed);

    const design = readResults('structure-design')[0];
    const categories = design.categories;
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
    const middleCategories = categories.filter((item) => item.type === 'middle');
    for (const item of middleCategories) {
      const parentRef = categoryRef.get(item.parentKey);
      if (!parentRef) return { status: 'invalid_job', message: '再編構造の上位クラス参照が見つかりません。' };
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
    const deletedIds = new Set((design.deleteKeys || []).map((key) => destinationByKey.get(key)?.id).filter(Boolean));
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
    const deletedCategories = (design.deleteKeys || []).map((key) => destinationByKey.get(key)).filter(Boolean);
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
    const movedCount = operationList.filter((operation) => operation.type === 'move_target_class').length;
    const structureChangeCount = operationList.length - movedCount;
    const deletedCount = operationList.filter((operation) => operation.type.startsWith('delete_')).length;
    const placementSummary = [...movedByCategory].map(([key, items]) => `${categoryByKey.get(key)?.label || '分類先不明'}へ${items.length}件`).join('、');
    const deletedLabels = deletedCategories.map((item) => item.label);
    const message = `対象${targets.length}件を全件確認し、再編後の階層案を作成しました。${placementSummary ? `配置変更は${placementSummary}です。` : ''}${deletedCount ? `不要な上位・中間クラス${deletedCount}件（${deletedLabels.join('、')}）を配下の移動後に削除する案を含みます。` : ''}再編後の構造変更${structureChangeCount}件です。${held.length ? `${held.length}件は判断を保留しています（${held.slice(0, 6).map(({ item }) => item.label).join('、')}${held.length > 6 ? 'ほか' : ''}）。` : ''}変更案のみで、編集データには適用していません。`;
    const response = {
      message,
      proposals: [{
        id: 'hierarchy_reorganization_1', title: '階層を再編して不要な分類を整理',
        summary: `${targets.length}件の対象を設計した階層へ配置し、必要な分類構造を追加・変更${deletedCount ? 'し、不要な分類を配下の移動後に削除' : ''}する案です。`,
        reason: [...new Set([design.designReason, ...[...reasonByCategory.values()].flat()])].filter(Boolean).slice(0, 6).join('。') || '対象全体と現在の親子関係をもとに再編後の階層を設計しました。',
        uncertainties: held.length ? held.slice(0, 8).map(({ item, reason }) => `${item.label}: ${reason}`) : [],
        questions: [], operations: operationList
      }], alternativeGroups: []
    };
    activeJob.status = 'completed';
    activeJob.metadata.result = { movedCount, deletedIds: deletedCategories.map((item) => item.id), heldIds: held.map((item) => item.id), operationCount: operationList.length };
    activeJob.updatedAt = Date.now();
    activeJob.completedAt = activeJob.updatedAt;
    await onCheckpoint(activeJob);
    return { text: JSON.stringify(response), messages: [], checkpoint: activeJob, counters: budgetGuard.getCounters(), incomplete: Boolean(held.length) };
  }

  return Object.freeze({ run });
}
