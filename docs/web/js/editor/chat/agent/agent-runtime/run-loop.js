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
    // App-side provenance; never infer successful retrieval from model text.
    const retrievalEvidence = [];
    const composeInput = () => retrievedData.length
      ? [...baseInput, { role: 'user', content: `取得済みデータ（JSON）:\n${JSON.stringify(retrievedData)}` }]
      : [...baseInput];
    let input = composeInput();
    const finalizationText = '処理上限が近づいたため、これ以上データを取得せずに終了してください。取得済みデータだけを使い、未確認範囲は推測しないでください。全対象を確認できていない場合は変更案を作らず、messageに確認済み範囲・未確認範囲・上限のため一部確認になったことを簡潔に記してください。';
    function collectedDataNote() {
      const batches = retrievedData.map((entry) => {
        const count = Array.isArray(entry.result?.data?.items) ? entry.result.data.items.length : null;
        const label = entry.tool === 'read_selected_class_details' ? '選択クラス詳細'
          : entry.tool === 'read_hierarchy_index' ? '階層索引'
            : entry.tool === 'read_direct_children' ? '直下クラス' : entry.tool;
        return count === null ? null : `${label}${count}件`;
      }).filter(Boolean);
      const items = retrievedData.flatMap((entry) => Array.isArray(entry.result?.data?.items) ? entry.result.data.items : []);
      const examples = [...new Map(items.filter((item) => item?.label).map((item) => [item.id || item.label, item])).values()]
        .slice(0, 12).map((item) => item.parentLabel
          ? `「${item.label}」（親: 「${item.parentLabel}」）` : `「${item.label}」`);
      if (!batches.length && !examples.length) return '停止前に評価結果として確定した内容はありません。';
      return `停止前に取得済みのデータ: ${batches.join('、') || '件数不明'}。`
        + (examples.length ? `一部の取得例: ${examples.join('、')}${items.length > examples.length ? '、ほか' : ''}。` : '')
        + 'このデータは取得済みですが、上限のため未評価の範囲が残る場合があります。';
    }

    async function finishWithAvailableData(finalInput = input) {
      const userFinalInput = [...finalInput, { role: 'user', content: finalizationText }];
      const finalRequest = { model, input: userFinalInput, tools: [], max_output_tokens: maxOutputTokens, textFormat };
      let responseSlot = null;
      let reservation = null;
      try {
        assertNotAborted();
        responseSlot = await reserveResponseSlot();
        reservation = await (budgetGuard.reserveInputWithApproval || budgetGuard.reserveInput).call(budgetGuard, finalRequest);
        let response;
        try {
          response = await client.request({ apiKey, model, input: userFinalInput, maxOutputTokens, textFormat, signal });
        } catch (error) {
          releaseResponse(responseSlot);
          budgetGuard.reconcileInput(reservation, null);
          throw error;
        }
        budgetGuard.countResponse(responseSlot);
        const usageResult = await (budgetGuard.reconcileInputWithApproval || budgetGuard.reconcileInput).call(
          budgetGuard, reservation, response.usage?.input_tokens
        );
        onUsage({ model, usage: response.usage || null });
        const finalText = (response.output || []).flatMap((item) => item.content || [])
          .find((item) => item.type === 'output_text')?.text || '';
        if (usageResult.overBudget) {
          return {
            text: finalText || JSON.stringify({ message: `入力トークン上限に達しました。追加取得を止めました。${collectedDataNote()}`, proposals: [], alternativeGroups: [] }),
            messages: [...userFinalInput, ...(response.output || [])], usage: response.usage || null,
            budgetLimited: true, counters: budgetGuard.getCounters(), retrievalEvidence: [...retrievalEvidence]
          };
        }
        return {
          text: finalText || JSON.stringify({ message: '入力トークン上限に達したため、追加取得を止めました。取得済み情報だけでは最終回答を作成できませんでした。', proposals: [], alternativeGroups: [] }),
          messages: [...userFinalInput, ...(response.output || [])],
          usage: response.usage || null,
          budgetLimited: true,
          retrievalEvidence: [...retrievalEvidence],
          counters: budgetGuard.getCounters()
        };
      } catch (error) {
        if (responseSlot && !reservation) releaseResponse(responseSlot);
        if (!['INPUT_TOKEN_BUDGET', 'RESPONSE_LIMIT'].includes(error?.code)) throw error;
        return {
          text: JSON.stringify({ message: `処理上限に達したため追加取得を止めました。取得済み範囲の最終整理は完了できませんでした。${collectedDataNote()}`, proposals: [], alternativeGroups: [] }),
          messages: userFinalInput,
          usage: null,
          budgetLimited: true,
          retrievalEvidence: [...retrievalEvidence],
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
        reservation = await (budgetGuard.reserveInputWithApproval || budgetGuard.reserveInput).call(
          budgetGuard, request, { reserveForInput: finalizationRequest }
        );
      } catch (error) {
        if (responseSlot) releaseResponse(responseSlot);
        if (error?.code === 'INPUT_TOKEN_FINALIZATION_REQUIRED') return finishWithAvailableData();
        if (error?.code === 'INPUT_TOKEN_BUDGET') return finishWithAvailableData();
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
      const usageResult = await (budgetGuard.reconcileInputWithApproval || budgetGuard.reconcileInput).call(
        budgetGuard, reservation, response.usage?.input_tokens
      );
      onUsage({ model, usage: response.usage || null });
      if (usageResult.overBudget) {
        const calls = (response.output || []).filter((item) => item.type === 'function_call');
        const finalText = (response.output || []).flatMap((item) => item.content || [])
          .find((item) => item.type === 'output_text')?.text || '';
        if (!calls.length && finalText) return {
          text: finalText, messages: [...input, ...(response.output || [])], usage: response.usage || null,
          budgetLimited: true, counters: budgetGuard.getCounters(), retrievalEvidence: [...retrievalEvidence]
        };
        return finishWithAvailableData();
      }
      const calls = (response.output || []).filter((item) => item.type === 'function_call');
      if (!calls.length) {
        const finalText = (response.output || []).flatMap((item) => item.content || [])
          .find((item) => item.type === 'output_text')?.text || '';
        return { text: finalText, messages: [...input, ...(response.output || [])], usage: response.usage || null, counters: budgetGuard.getCounters(), retrievalEvidence: [...retrievalEvidence] };
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
        retrievalEvidence.push({
          tool: call.name,
          arguments: (() => { try { return JSON.parse(call.arguments || '{}'); } catch { return null; } })(),
          ok: result?.ok === true,
          data: result?.ok === true ? result.data : null,
          errorCode: result?.ok === false ? result.error?.code || 'TOOL_FAILED' : null
        });
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
