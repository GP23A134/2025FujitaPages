export function createAgentRunLoop({ client, registry, dispatcher, budgetGuard, model, apiKey, systemInstruction, maxOutputTokens, textFormat, onUsage = () => {} }) {
  if (!client?.request || !registry || !dispatcher || !budgetGuard) throw new TypeError('Agent runtimeの依存関係が不足しています。');

  async function run({ messages, signal, onProgress, allowedTools = registry.names() }) {
    const assertNotAborted = () => {
      if (signal?.aborted) throw signal.reason || Object.assign(new Error('処理が中断されました。'), { name: 'AbortError' });
    };
    let input = messages[0]?.role === 'system' ? [...messages] : [{ role: 'system', content: systemInstruction }, ...messages];
    while (true) {
      assertNotAborted();
      budgetGuard.assertResponseAllowed();
      const definitions = registry.definitions(allowedTools);
      const request = { model, input, tools: definitions, max_output_tokens: maxOutputTokens, textFormat };
      const reservation = budgetGuard.reserveInput(request);
      let response;
      try {
        response = await client.request({ apiKey, model, input, tools: definitions, maxOutputTokens, textFormat, signal });
      } catch (error) {
        budgetGuard.reconcileInput(reservation, null);
        throw error;
      }
      budgetGuard.countResponse();
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

      input = [...input, ...response.output];
      for (const call of calls) {
        assertNotAborted();
        onProgress?.({ stage: 'retrieving', tool: call.name });
        const result = await dispatcher.dispatch(call.name, call.arguments);
        const scopeRequest = dispatcher.takeScopeRequest?.();
        if (scopeRequest) return { status: 'needs_scope_approval', scopeRequest, counters: budgetGuard.getCounters() };
        input.push({ type: 'function_call_output', call_id: call.call_id, output: JSON.stringify(result) });
      }
    }
  }

  return Object.freeze({ run });
}
