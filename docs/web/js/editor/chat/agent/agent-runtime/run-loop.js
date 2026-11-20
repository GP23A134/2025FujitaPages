export function createAgentRunLoop({ client, registry, dispatcher, budgetGuard, model, apiKey, systemInstruction, maxOutputTokens, textFormat, onUsage = () => {}, onScopeRequest = null }) {
  if (!client?.request || !registry || !dispatcher || !budgetGuard) throw new TypeError('Agent runtimeの依存関係が不足しています。');

  async function run({ messages, signal, onProgress, allowedTools = registry.names() }) {
    const reserveResponseSlot = async () => budgetGuard.reserveResponseSlot
      ? budgetGuard.reserveResponseSlot()
      : (await budgetGuard.assertResponseAllowed(), null);
    const releaseResponse = (reservation) => reservation && budgetGuard.releaseResponse?.(reservation);
    const assertNotAborted = () => {
      if (signal?.aborted) throw signal.reason || Object.assign(new Error('処理が中断されました。'), { name: 'AbortError' });
    };
    const baseInput = messages[0]?.role === 'system' ? [...messages] : [{ role: 'system', content: systemInstruction }, ...messages];
    const retrievedData = [];
    const composeInput = () => retrievedData.length
      ? [...baseInput, { role: 'user', content: `取得済みデータ（JSON）:\n${JSON.stringify(retrievedData)}` }]
      : [...baseInput];
    let input = composeInput();
    const finalizationText = '処理上限が近づいたため、これ以上データを取得せずに終了してください。取得済みデータだけを使い、未確認範囲は推測しないでください。全対象を確認できていない場合は変更案を作らず、messageに確認済み範囲・未確認範囲・上限のため一部確認になったことを簡潔に記してください。';

    async function finishWithAvailableData(finalInput = input) {
      const userFinalInput = [...finalInput, { role: 'user', content: finalizationText }];
      const finalRequest = { model, input: userFinalInput, tools: [], max_output_tokens: maxOutputTokens, textFormat };
      let responseSlot = null;
      let reservation = null;
      try {
        assertNotAborted();
        responseSlot = await reserveResponseSlot();
        reservation = budgetGuard.reserveInput(finalRequest);
        let response;
        try {
          response = await client.request({ apiKey, model, input: userFinalInput, maxOutputTokens, textFormat, signal });
        } catch (error) {
          releaseResponse(responseSlot);
          budgetGuard.reconcileInput(reservation, null);
          throw error;
        }
        budgetGuard.countResponse(responseSlot);
        const usageResult = budgetGuard.reconcileInput(reservation, response.usage?.input_tokens);
        onUsage({ model, usage: response.usage || null });
        if (usageResult.overBudget) {
          return { text: JSON.stringify({ message: '入力トークン上限に達しました。追加取得を止め、取得済み情報での最終回答も完了できませんでした。', proposals: [], alternativeGroups: [] }), messages: userFinalInput, usage: response.usage || null, budgetLimited: true, counters: budgetGuard.getCounters() };
        }
        const finalText = (response.output || []).flatMap((item) => item.content || [])
          .find((item) => item.type === 'output_text')?.text || '';
        return {
          text: finalText || JSON.stringify({ message: '入力トークン上限に達したため、追加取得を止めました。取得済み情報だけでは最終回答を作成できませんでした。', proposals: [], alternativeGroups: [] }),
          messages: [...userFinalInput, ...(response.output || [])],
          usage: response.usage || null,
          budgetLimited: true,
          counters: budgetGuard.getCounters()
        };
      } catch (error) {
        if (responseSlot && !reservation) releaseResponse(responseSlot);
        if (!['INPUT_TOKEN_BUDGET', 'RESPONSE_LIMIT'].includes(error?.code)) throw error;
        return {
          text: JSON.stringify({ message: '処理上限に達したため追加取得を止めました。取得済み範囲の最終回答も上限内に送信できませんでした。', proposals: [], alternativeGroups: [] }),
          messages: userFinalInput,
          usage: null,
          budgetLimited: true,
          counters: budgetGuard.getCounters()
        };
      }
    }

    while (true) {
      assertNotAborted();
      onProgress?.({
        stage: 'analyzing',
        note: retrievedData.length
          ? '取得した情報をもとに、次に必要な確認内容を判断しています'
          : '計画に沿って、最初に取得する情報を判断しています'
      });
      const definitions = registry.definitions(allowedTools);
      const request = { model, input, tools: definitions, max_output_tokens: maxOutputTokens, textFormat };
      const finalizationInput = [...input, { role: 'user', content: finalizationText }];
      const finalizationRequest = { model, input: finalizationInput, tools: [], max_output_tokens: maxOutputTokens, textFormat };
      let reservation;
      let responseSlot;
      try {
        responseSlot = await reserveResponseSlot();
        reservation = budgetGuard.reserveInput(request, { reserveForInput: finalizationRequest });
      } catch (error) {
        if (responseSlot) releaseResponse(responseSlot);
        if (error?.code === 'INPUT_TOKEN_FINALIZATION_REQUIRED') return finishWithAvailableData();
        throw error;
      }
      let response;
      try {
        response = await client.request({ apiKey, model, input, tools: definitions, maxOutputTokens, textFormat, signal });
      } catch (error) {
        releaseResponse(responseSlot);
        budgetGuard.reconcileInput(reservation, null);
        throw error;
      }
      budgetGuard.countResponse(responseSlot);
      const usageResult = budgetGuard.reconcileInput(reservation, response.usage?.input_tokens);
      onUsage({ model, usage: response.usage || null });
      if (usageResult.overBudget) {
        const error = new Error('API実績が累積入力トークン上限を超えたため、処理を一時停止しました。');
        error.code = 'INPUT_TOKEN_BUDGET_ACTUAL';
        error.status = 'budget_exhausted';
        throw error;
      }
      const calls = (response.output || []).filter((item) => item.type === 'function_call');
      if (!calls.length) {
        const finalText = (response.output || []).flatMap((item) => item.content || [])
          .find((item) => item.type === 'output_text')?.text || '';
        return { text: finalText, messages: [...input, ...(response.output || [])], usage: response.usage || null, counters: budgetGuard.getCounters() };
      }

      const newResults = [];
      for (const call of calls) {
        assertNotAborted();
        onProgress?.({ stage: 'retrieving', tool: call.name });
        let result = await dispatcher.dispatch(call.name, call.arguments);
        let scopeRequest = dispatcher.takeScopeRequest?.();
        while (scopeRequest && onScopeRequest) {
          const decision = await onScopeRequest(scopeRequest);
          if (decision === 'cancel') return { status: 'cancelled', counters: budgetGuard.getCounters() };
          if (decision !== 'allow') {
            result = {
              ok: false,
              error: {
                code: 'SCOPE_NOT_GRANTED',
                message: '利用者は追加参照を許可しませんでした。許可済みの情報だけを使い、範囲外の情報や関係を推測せず、可能な範囲で回答してください。'
              }
            };
            scopeRequest = null;
            break;
          }
          result = await dispatcher.dispatch(call.name, call.arguments);
          scopeRequest = dispatcher.takeScopeRequest?.();
        }
        if (scopeRequest) return { status: 'needs_scope_approval', scopeRequest, counters: budgetGuard.getCounters() };
        const data = result?.data;
        const itemCount = Array.isArray(data?.items) ? data.items.length : null;
        const totalCount = Number.isSafeInteger(data?.totalCount) ? data.totalCount : null;
        const nextPage = Boolean(data?.nextCursor);
        const descriptions = {
          read_hierarchy_index: '階層索引',
          read_selected_class_details: '選択クラスの詳細',
          read_class_details: '指定クラスの詳細',
          read_direct_children: '指定クラスの直下'
        };
        const description = descriptions[call.name] || (call.name === 'read_instance_context' ? 'インスタンス情報' : '取得データ');
        const countNote = itemCount === null ? '' : totalCount === null
          ? `${itemCount}件取得${nextPage ? '。続きがあります' : ''}`
          : `${itemCount}件取得（全${totalCount}件）${nextPage ? '。続きがあります' : ''}`;
        const instanceNote = call.name === 'read_instance_context' && Array.isArray(data?.items)
          ? `対象クラス${data.items.length}件、インスタンス${data.items.reduce((sum, item) => sum + (item.returnedCount || 0), 0)}件を確認`
          : '';
        onProgress?.({ stage: 'analyzing', milestone: true, note: `${description}を確認しました。${instanceNote || countNote}` });
        newResults.push({ tool: call.name, arguments: call.arguments, result });
      }
      const candidateInput = [...baseInput, {
        role: 'user',
        content: `取得済みデータ（JSON）:\n${JSON.stringify([...retrievedData, ...newResults])}`
      }];
      const candidateFinalInput = [...candidateInput, { role: 'user', content: finalizationText }];
      const candidateFinalRequest = { model, input: candidateFinalInput, tools: [], max_output_tokens: maxOutputTokens, textFormat };
      let finalizationFits = true;
      try {
        const probe = budgetGuard.reserveInput(candidateFinalRequest);
        budgetGuard.releaseInput(probe);
      } catch (error) {
        if (error?.code !== 'INPUT_TOKEN_BUDGET') throw error;
        finalizationFits = false;
      }
      if (!finalizationFits) {
        const reducedInput = composeInput();
        return finishWithAvailableData(reducedInput);
      }
      retrievedData.push(...newResults);
      input = composeInput();
    }
  }

  return Object.freeze({ run });
}
