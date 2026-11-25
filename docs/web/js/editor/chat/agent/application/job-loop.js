const MAX_PHASES = 24;
const MAX_UNITS_PER_PHASE = 20000;
const MAX_RESULT_CHARACTERS = 1500000;
const MAX_CHECKPOINT_CHARACTERS = 2500000;

const safeText = (value, limit = 500) => typeof value === 'string' ? value.trim().slice(0, limit) : '';
const uniqueStrings = (values, limit) => Array.isArray(values)
  ? [...new Set(values.filter((value) => typeof value === 'string' && value.length <= 256))].slice(0, limit)
  : [];

function cloneResult(value) {
  const serialized = JSON.stringify(value);
  if (typeof serialized !== 'string' || serialized.length > MAX_RESULT_CHARACTERS) {
    throw Object.assign(new Error('作業結果がチェックポイントの保存上限を超えました。'), { code: 'JOB_CHECKPOINT_TOO_LARGE' });
  }
  return JSON.parse(serialized);
}

export function normalizeJobCheckpoint(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || value.version !== 1) return null;
  const phases = Array.isArray(value.phases) ? value.phases.slice(0, MAX_PHASES).map((phase) => {
    const units = Array.isArray(phase?.units) ? phase.units.slice(0, MAX_UNITS_PER_PHASE).map((unit) => {
      let result = null;
      if (unit?.status === 'completed') {
        try { result = cloneResult(unit.result); } catch { result = null; }
      }
      return {
        id: safeText(unit?.id, 256),
        status: unit?.status === 'completed' && result !== null ? 'completed'
          : ['running', 'paused', 'failed'].includes(unit?.status) ? unit.status : 'pending',
        result
      };
    }).filter((unit) => unit.id) : [];
    const completedCount = units.filter((unit) => unit.status === 'completed').length;
    const phaseStatus = ['completed', 'running', 'paused', 'failed'].includes(phase?.status) ? phase.status : 'pending';
    return {
      id: safeText(phase?.id, 128),
      status: phaseStatus === 'completed' && completedCount !== units.length ? 'pending' : phaseStatus,
      units
    };
  }).filter((phase) => phase.id) : [];
  let metadata = {};
  try { metadata = value.metadata && typeof value.metadata === 'object' ? cloneResult(value.metadata) : {}; }
  catch { metadata = {}; }
  const checkpoint = {
    version: 1,
    id: safeText(value.id, 128),
    kind: safeText(value.kind, 80),
    status: ['running', 'paused', 'interrupted', 'failed', 'completed', 'stale'].includes(value.status) ? value.status : 'running',
    request: safeText(value.request, 2000),
    dataVersion: safeText(value.dataVersion, 128),
    scopeIds: uniqueStrings(value.scopeIds, MAX_UNITS_PER_PHASE),
    metadata,
    phases,
    startedAt: Number.isFinite(value.startedAt) ? value.startedAt : Date.now(),
    updatedAt: Number.isFinite(value.updatedAt) ? value.updatedAt : Date.now(),
    completedAt: Number.isFinite(value.completedAt) ? value.completedAt : null
  };
  try { if (JSON.stringify(checkpoint).length > MAX_CHECKPOINT_CHARACTERS) return null; }
  catch { return null; }
  return checkpoint;
}

export function createJobCheckpoint({ id, kind, request, dataVersion = '', scopeIds = [], metadata = {}, phases = [] }) {
  return normalizeJobCheckpoint({
    version: 1, id, kind, request, dataVersion, scopeIds, metadata, phases,
    status: 'running', startedAt: Date.now(), updatedAt: Date.now()
  });
}

function pauseError(error) {
  return error?.status === 'budget_exhausted' || error?.status === 'budget_soft_stop'
    || ['INPUT_TOKEN_BUDGET', 'INPUT_TOKEN_BUDGET_ACTUAL', 'INPUT_TOKEN_FINALIZATION_REQUIRED', 'RESPONSE_LIMIT', 'RETRIEVAL_LIMIT'].includes(error?.code);
}

export async function runJobLoop({ checkpoint, dataVersion = '', phases, signal, checkpointEvery = 1, onCheckpoint = async () => {}, onProgress = () => {} }) {
  if (!Array.isArray(phases) || phases.length > MAX_PHASES) throw new TypeError('ジョブ工程の形式または件数が不正です。');
  const normalizedCheckpoint = normalizeJobCheckpoint(checkpoint);
  if (checkpoint && !normalizedCheckpoint) {
    throw Object.assign(new Error('保存済みチェックポイントが破損しているか、保存上限を超えています。'), { code: 'JOB_CHECKPOINT_INVALID' });
  }
  let job = normalizedCheckpoint || createJobCheckpoint({
    id: globalThis.crypto?.randomUUID?.() || `job-${Date.now()}`,
    kind: 'generic', request: '', dataVersion
  });
  if (job.dataVersion && dataVersion && job.dataVersion !== dataVersion) {
    job = normalizeJobCheckpoint({ ...job, status: 'stale', updatedAt: Date.now() });
    await onCheckpoint(job);
    return { status: 'stale', checkpoint: job };
  }
  const phaseIds = phases.map((phase) => phase?.id);
  if (phaseIds.some((id) => typeof id !== 'string' || !id) || new Set(phaseIds).size !== phaseIds.length) {
    throw new TypeError('ジョブ工程IDは重複のない文字列が必要です。');
  }
  const savedPhaseIds = job.phases.map((phase) => phase.id);
  if (savedPhaseIds.length > phaseIds.length
    || savedPhaseIds.some((id, index) => id !== phaseIds[index])) {
    throw Object.assign(new Error('保存済みジョブと今回の工程計画が一致しません。'), { code: 'JOB_PLAN_MISMATCH' });
  }
  const savedByPhase = new Map(job.phases.map((phase) => [phase.id, phase]));
  for (const phase of phases) {
    if (!Array.isArray(phase.units) || phase.units.length > MAX_UNITS_PER_PHASE
      || typeof phase.execute !== 'function' || typeof phase.validate !== 'function') {
      throw new TypeError(`ジョブ工程「${phase.id}」には単位・実行・検証関数が必要です。`);
    }
    const unitIds = phase.units.map((unit) => unit?.id);
    if (unitIds.some((id) => typeof id !== 'string' || !id) || new Set(unitIds).size !== unitIds.length) {
      throw new TypeError(`ジョブ工程「${phase.id}」の単位IDが不正です。`);
    }
    const saved = savedByPhase.get(phase.id);
    if (saved && (saved.units.length !== unitIds.length || saved.units.some((unit, index) => unit.id !== unitIds[index]))) {
      throw Object.assign(new Error(`保存済みジョブ工程「${phase.id}」の作業単位が今回と一致しません。`), { code: 'JOB_UNITS_MISMATCH' });
    }
    if (!saved) savedByPhase.set(phase.id, { id: phase.id, status: 'pending', units: unitIds.map((id) => ({ id, status: 'pending', result: null })) });
  }
  job = normalizeJobCheckpoint({ ...job, dataVersion: dataVersion || job.dataVersion, phases: phases.map((phase) => savedByPhase.get(phase.id)), status: 'running' });
  await onCheckpoint(job);
  let completedSinceCheckpoint = 0;
  const checkpointInterval = Number.isSafeInteger(checkpointEvery) && checkpointEvery > 0 ? checkpointEvery : 1;

  for (const phase of phases) {
    const saved = job.phases.find((item) => item.id === phase.id);
    if (saved.status === 'completed') continue;
    saved.status = 'running';
    for (let index = 0; index < phase.units.length; index += 1) {
      const unit = phase.units[index];
      const savedUnit = saved.units[index];
      if (savedUnit.status === 'completed') continue;
      if (signal?.aborted) {
        job.status = 'interrupted';
        savedUnit.status = 'paused';
        job.updatedAt = Date.now();
        await onCheckpoint(job);
        return { status: 'interrupted', checkpoint: job };
      }
      savedUnit.status = 'running';
      job.updatedAt = Date.now();
      onProgress({ phaseId: phase.id, unitId: unit.id, unitIndex: index + 1, unitCount: phase.units.length });
      try {
        const result = await phase.execute(unit, { checkpoint: job, phase, signal });
        const validation = await phase.validate(unit, result, { checkpoint: job, phase });
        if (validation !== true) {
          const reason = typeof validation === 'string' ? validation : '作業結果の検証に失敗しました。';
          throw Object.assign(new Error(reason), { code: 'JOB_UNIT_VALIDATION_FAILED' });
        }
        const normalizedResult = cloneResult(result);
        const candidate = {
          ...job,
          phases: job.phases.map((savedPhase) => savedPhase.id !== phase.id ? savedPhase : {
            ...savedPhase,
            units: savedPhase.units.map((candidateUnit, candidateIndex) => candidateIndex !== index ? candidateUnit : {
              ...candidateUnit, status: 'completed', result: normalizedResult
            })
          })
        };
        if (JSON.stringify(candidate).length > MAX_CHECKPOINT_CHARACTERS) {
          throw Object.assign(new Error('再開用チェックポイントの保存上限に達しました。結果を失わないため、ここで一時停止します。'), {
            code: 'JOB_CHECKPOINT_TOO_LARGE', status: 'budget_exhausted'
          });
        }
        savedUnit.result = normalizedResult;
        savedUnit.status = 'completed';
        completedSinceCheckpoint += 1;
        job.updatedAt = Date.now();
        if (completedSinceCheckpoint >= checkpointInterval || index === phase.units.length - 1) {
          await onCheckpoint(job);
          completedSinceCheckpoint = 0;
        }
      } catch (error) {
        if (signal?.aborted || error?.name === 'AbortError') {
          savedUnit.status = 'paused';
          saved.status = 'paused';
          job.status = 'interrupted';
          job.updatedAt = Date.now();
          await onCheckpoint(job);
          return { status: 'interrupted', checkpoint: job, error };
        }
        if (pauseError(error)) {
          savedUnit.status = 'paused';
          saved.status = 'paused';
          job.status = 'paused';
          job.updatedAt = Date.now();
          await onCheckpoint(job);
          return { status: 'paused', checkpoint: job, error };
        }
        if (error?.scopeRequest) {
          savedUnit.status = 'pending';
          saved.status = 'paused';
          job.status = 'paused';
          job.updatedAt = Date.now();
          await onCheckpoint(job);
          return { status: 'needs_scope_approval', checkpoint: job, scopeRequest: error.scopeRequest };
        }
        if (error?.status === 'needs_user_input') {
          savedUnit.status = 'pending';
          saved.status = 'paused';
          job.status = 'paused';
          job.updatedAt = Date.now();
          await onCheckpoint(job);
          return { status: 'needs_user_input', checkpoint: job, error };
        }
        savedUnit.status = 'failed';
        saved.status = 'failed';
        job.status = 'failed';
        job.updatedAt = Date.now();
        await onCheckpoint(job);
        throw error;
      }
    }
    const phaseResults = saved.units.map((unit) => ({ id: unit.id, result: unit.result }));
    const phaseValidation = await phase.validatePhase?.(phaseResults, { checkpoint: job, phase });
    if (phaseValidation !== undefined && phaseValidation !== true) {
      saved.status = 'failed';
      job.status = 'failed';
      job.updatedAt = Date.now();
      await onCheckpoint(job);
      throw Object.assign(new Error(typeof phaseValidation === 'string' ? phaseValidation : '工程全体の検証に失敗しました。'), {
        code: 'JOB_PHASE_VALIDATION_FAILED'
      });
    }
    saved.status = 'completed';
    job.updatedAt = Date.now();
    await onCheckpoint(job);
  }
  job.status = 'completed';
  job.completedAt = Date.now();
  job.updatedAt = job.completedAt;
  await onCheckpoint(job);
  return { status: 'completed', checkpoint: job };
}
