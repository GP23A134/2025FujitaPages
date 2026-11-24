const utf8Bytes = (value) => new TextEncoder().encode(value).length;

export function estimateInputTokens(input) {
  const serialized = typeof input === 'string' ? input : JSON.stringify(input);
  // Deliberately conservative for mixed Japanese/English text; API usage replaces this estimate.
  return Math.ceil(utf8Bytes(serialized) * 0.8) + 256;
}

export function createBudgetGuard({ state, limits, onChange, onResponseLimit, onInputLimit }) {
  const counters = { ...state.counters };
  const activeLimits = { ...limits };
  const reservations = new Map();
  const responseReservations = new Set();
  let nextReservationId = 0;
  let nextResponseReservationId = 0;
  let responseLimitApproval = null;
  let responseLimitDenied = false;
  let inputLimitApproval = null;
  let inputLimitDenied = false;
  const notify = () => onChange?.({ ...counters });
  const fail = (message, code) => Object.assign(new Error(message), {
    code, status: 'budget_exhausted', sourceModule: 'agent-runtime/budget-guard.js'
  });

  async function ensureInputCapacity(required) {
    while (counters.inputTokensActual + counters.inputTokensReserved + required > activeLimits.inputTokenCap) {
      if (inputLimitDenied) throw fail('累積入力トークン上限に達しました。利用者が続行を許可しませんでした。', 'INPUT_TOKEN_BUDGET');
      const used = counters.inputTokensActual + counters.inputTokensReserved;
      const extension = Math.max(50_000, used + required - activeLimits.inputTokenCap);
      if (!inputLimitApproval) {
        inputLimitApproval = Promise.resolve(onInputLimit?.({
          kind: 'input_tokens', used, limit: activeLimits.inputTokenCap, required,
          extension
        })).then((decision) => {
          if (decision === 'continue') {
            activeLimits.inputTokenCap += extension;
            notify();
          } else if (decision !== 'cancel') inputLimitDenied = true;
          return decision;
        }).finally(() => { inputLimitApproval = null; });
      }
      const decision = await inputLimitApproval;
      if (decision === 'cancel') throw Object.assign(new Error('処理を中止しました。'), { name: 'AbortError' });
      if (decision !== 'continue') throw fail('累積入力トークン上限に達しました。利用者が続行を許可しませんでした。', 'INPUT_TOKEN_BUDGET');
    }
  }

  function reserveInput(input, { reserveForInput = null } = {}) {
    const estimate = estimateInputTokens(input);
    const reserve = reserveForInput === null ? 0 : estimateInputTokens(reserveForInput);
    const cap = activeLimits.inputTokenCap;
    if (!Number.isSafeInteger(cap) || cap <= 0) throw new Error('入力トークン上限が開発者設定にありません。');
    if (counters.inputTokensActual + counters.inputTokensReserved + estimate > cap) {
      throw fail('累積入力トークン上限のため、次のAI要求を送信できません。', 'INPUT_TOKEN_BUDGET');
    }
    if (reserve && counters.inputTokensActual + counters.inputTokensReserved + estimate + reserve > cap) {
      throw Object.assign(new Error('最終回答用の入力枠を確保するため、追加のAI要求を止めます。'), {
        code: 'INPUT_TOKEN_FINALIZATION_REQUIRED', status: 'budget_soft_stop',
        sourceModule: 'agent-runtime/budget-guard.js'
      });
    }
    const id = ++nextReservationId;
    reservations.set(id, estimate);
    counters.inputTokensReserved += estimate;
    notify();
    return Object.freeze({ id, estimate });
  }

  async function reserveInputWithApproval(input, options = {}) {
    const estimate = estimateInputTokens(input);
    const reserve = options.reserveForInput === null || options.reserveForInput === undefined
      ? 0 : estimateInputTokens(options.reserveForInput);
    try {
      await ensureInputCapacity(estimate + reserve);
    } catch (error) {
      const used = counters.inputTokensActual + counters.inputTokensReserved;
      if (reserve > 0 && error?.code === 'INPUT_TOKEN_BUDGET'
        && used + estimate <= activeLimits.inputTokenCap) {
        throw Object.assign(new Error('最終回答用の入力枠を確保するため、追加のAI要求を止めます。'), {
          code: 'INPUT_TOKEN_FINALIZATION_REQUIRED', status: 'budget_soft_stop',
          sourceModule: 'agent-runtime/budget-guard.js'
        });
      }
      throw error;
    }
    return reserveInput(input, options);
  }

  function reconcileInput(reservation, actualTokens) {
    if (!reservation || !reservations.has(reservation.id)) throw new Error('入力トークン予約が見つかりません。');
    const reserved = reservations.get(reservation.id);
    reservations.delete(reservation.id);
    counters.inputTokensReserved -= reserved;
    if (!Number.isSafeInteger(actualTokens) || actualTokens < 0) {
      counters.inputTokensReserved += reserved;
      reservations.set(reservation.id, reserved);
      notify();
      return { overBudget: false, actualKnown: false };
    }
    counters.inputTokensActual += actualTokens;
    notify();
    return { overBudget: counters.inputTokensActual + counters.inputTokensReserved > activeLimits.inputTokenCap, actualKnown: true };
  }

  async function reconcileInputWithApproval(reservation, actualTokens) {
    const result = reconcileInput(reservation, actualTokens);
    if (!result.overBudget) return result;
    try {
      await ensureInputCapacity(0);
      return { ...result, overBudget: false };
    } catch (error) {
      if (error?.name === 'AbortError') throw error;
      return result;
    }
  }

  function releaseInput(reservation) {
    if (!reservation || !reservations.has(reservation.id)) throw new Error('入力トークン予約が見つかりません。');
    counters.inputTokensReserved -= reservations.get(reservation.id);
    reservations.delete(reservation.id);
    notify();
  }

  async function reserveResponseSlot() {
    while (counters.responseRounds + responseReservations.size >= activeLimits.maxResponseRounds) {
      if (responseLimitDenied) throw fail('AI応答回数の上限に達しました。利用者が続行を許可しませんでした。', 'RESPONSE_LIMIT');
      if (!responseLimitApproval) {
        responseLimitApproval = Promise.resolve(onResponseLimit?.({
          used: counters.responseRounds,
          limit: activeLimits.maxResponseRounds,
          extension: 20
        })).then((decision) => {
          if (decision === 'continue') {
            activeLimits.maxResponseRounds += 20;
            notify();
          } else if (decision !== 'cancel') responseLimitDenied = true;
          return decision;
        }).finally(() => { responseLimitApproval = null; });
      }
      const extension = await responseLimitApproval;
      if (extension === 'cancel') throw Object.assign(new Error('処理を中止しました。'), { name: 'AbortError' });
      if (extension !== 'continue') throw fail('AI応答回数の上限に達しました。利用者が続行を許可しませんでした。', 'RESPONSE_LIMIT');
    }
    const id = ++nextResponseReservationId;
    responseReservations.add(id);
    return Object.freeze({ id });
  }
  function assertResponseAllowed() {
    if (counters.responseRounds >= activeLimits.maxResponseRounds) throw fail('AI応答回数の上限に達しました。', 'RESPONSE_LIMIT');
  }
  function countResponse(reservation = null) {
    if (reservation?.id && responseReservations.has(reservation.id)) responseReservations.delete(reservation.id);
    counters.responseRounds += 1;
    notify();
  }
  function releaseResponse(reservation) {
    if (reservation?.id) responseReservations.delete(reservation.id);
  }
  function countRetrieval() {
    if (counters.retrievalCalls >= activeLimits.maxRetrievalCalls) throw fail('データ取得回数の上限に達しました。', 'RETRIEVAL_LIMIT');
    counters.retrievalCalls += 1;
    notify();
  }
  function countReplan() {
    if (counters.replans >= activeLimits.maxReplans) throw fail('再計画回数の上限に達しました。', 'REPLAN_LIMIT');
    counters.replans += 1;
    notify();
  }

  return Object.freeze({
    reserveInput,
    reserveInputWithApproval,
    reconcileInput,
    reconcileInputWithApproval,
    releaseInput,
    assertResponseAllowed,
    reserveResponseSlot,
    countResponse,
    releaseResponse,
    countRetrieval,
    countReplan,
    getCounters: () => ({ ...counters }),
    getInputUsage: () => counters.inputTokensActual + counters.inputTokensReserved
  });
}
