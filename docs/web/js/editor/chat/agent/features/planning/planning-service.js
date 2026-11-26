import { PLAN_RESPONSE_SCHEMA } from './plan-schema.js?v=20261126-reorg-intensity-confirm-v1';
import { buildPlanSystemPrompt } from '../../prompts/plan-system-prompt.js?v=20261126-targeted-adjustment-mode-v1';
import { validatePlan } from './plan-contract.js?v=20261126-targeted-adjustment-mode-v1';

function extractJsonText(response) {
  const text = response?.output?.flatMap((item) => item.content || [])
    .find((item) => item.type === 'output_text')?.text;
  if (typeof text !== 'string') throw new Error('AIから計画JSONを受け取れませんでした。');
  return text;
}

export function createPlanningService({ client, getDeveloperSettings }) {
  if (!client || typeof client.request !== 'function') throw new TypeError('AI通信クライアントが必要です。');

  async function createPlan({ apiKey, model, planInput, signal, budgetGuard, hierarchyIndexAvailable = false, onUsage = () => {}, client: requestClient = client }) {
    const settings = getDeveloperSettings?.() || {};
    const systemPrompt = buildPlanSystemPrompt({
      instanceInformationEnabled: settings.instanceInformationEnabled === true,
      targetClassRenameEnabled: settings.targetClassRenameEnabled === true,
      hierarchyIndexAvailable,
      scopedHierarchyAvailable: Boolean(planInput?.scopedHierarchy)
    });
    let input = [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: JSON.stringify(planInput) }
    ];
    const textFormat = { type: 'json_schema', name: 'class_edit_plan', strict: true, schema: PLAN_RESPONSE_SCHEMA };
    const requestPlan = async (requestInput) => {
      let reservation = null;
      let responseSlot = null;
      let response;
      try {
        if (budgetGuard) {
          responseSlot = budgetGuard.reserveResponseSlot
            ? await budgetGuard.reserveResponseSlot()
            : (await budgetGuard.assertResponseAllowed(), null);
          reservation = await (budgetGuard.reserveInputWithApproval || budgetGuard.reserveInput).call(
            budgetGuard, { model, input: requestInput, textFormat }
          );
        }
        response = await requestClient.request({ apiKey, model, signal, input: requestInput, textFormat });
      } catch (error) {
        if (reservation) budgetGuard.reconcileInput(reservation, null);
        if (responseSlot) budgetGuard.releaseResponse?.(responseSlot);
        throw error;
      }
      if (reservation) {
        budgetGuard.countResponse(responseSlot);
        const usageResult = await (budgetGuard.reconcileInputWithApproval || budgetGuard.reconcileInput).call(
          budgetGuard, reservation, response.usage?.input_tokens
        );
        if (usageResult.overBudget) {
          const error = new Error('API実績が累積入力トークン上限を超えたため、計画を停止しました。');
          error.code = 'INPUT_TOKEN_BUDGET_ACTUAL';
          error.status = 'budget_exhausted';
          throw error;
        }
      }
      onUsage({ model, usage: response.usage || null });
      return response;
    };

    let totalInputTokens = 0;
    let usageKnown = true;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const response = await requestPlan(input);
      const inputTokens = response.usage?.input_tokens;
      if (Number.isSafeInteger(inputTokens)) totalInputTokens += inputTokens;
      else usageKnown = false;

      let plan;
      try { plan = JSON.parse(extractJsonText(response)); }
      catch (error) {
        if (error instanceof SyntaxError) {
          throw Object.assign(new Error('AIの計画が有効なJSONではありません。'), {
            sourceModule: 'features/planning/planning-service.js'
          });
        }
        throw error;
      }
      const validation = validatePlan(plan, {
        instanceInformationEnabled: settings.instanceInformationEnabled === true,
        targetClassRenameEnabled: settings.targetClassRenameEnabled === true
      });
      if (validation.valid) {
        return Object.freeze({
          plan: Object.freeze(plan),
          usage: usageKnown ? totalInputTokens : null
        });
      }
      if (attempt === 0) {
        input = [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: JSON.stringify(planInput) },
          { role: 'assistant', content: JSON.stringify(plan) },
          { role: 'user', content: `直前の計画はアプリの検証規則に違反しました。利用者の依頼と計画の意図を保ち、次の問題だけを修正して、スキーマに適合する計画を返してください。\n検証エラー: ${validation.errors.join(' / ')}` }
        ];
        continue;
      }
      const error = new Error(`AIの計画がアプリの規則を満たしていません。${validation.errors.join(' ')}`);
      error.code = 'INVALID_PLAN';
      error.details = validation.errors;
      error.sourceModule = 'features/planning/plan-contract.js';
      throw error;
    }
  }

  return Object.freeze({ createPlan });
}
