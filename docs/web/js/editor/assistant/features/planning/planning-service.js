import { PLAN_RESPONSE_SCHEMA } from './plan-schema.js';
import { buildPlanSystemPrompt } from '../../prompts/plan-system-prompt.js?v=20261116-inference-allowed-v1';
import { validatePlan } from './plan-contract.js';

function extractJsonText(response) {
  const text = response?.output?.flatMap((item) => item.content || [])
    .find((item) => item.type === 'output_text')?.text;
  if (typeof text !== 'string') throw new Error('AIから計画JSONを受け取れませんでした。');
  return text;
}

export function createPlanningService({ client, getDeveloperSettings }) {
  if (!client || typeof client.request !== 'function') throw new TypeError('AI通信クライアントが必要です。');

  async function createPlan({ apiKey, model, planInput, signal, budgetGuard, hierarchyIndexAvailable = false, onUsage = () => {} }) {
    const settings = getDeveloperSettings?.() || {};
    const input = [
      { role: 'system', content: buildPlanSystemPrompt({
        instanceInformationEnabled: settings.instanceInformationEnabled === true,
        targetClassRenameEnabled: settings.targetClassRenameEnabled === true,
        hierarchyIndexAvailable
      }) },
      { role: 'user', content: JSON.stringify(planInput) }
    ];
    const textFormat = { type: 'json_schema', name: 'class_edit_plan', strict: true, schema: PLAN_RESPONSE_SCHEMA };
    let reservation = null;
    if (budgetGuard) {
      budgetGuard.assertResponseAllowed();
      reservation = budgetGuard.reserveInput({ model, input, textFormat });
    }
    let response;
    try {
      response = await client.request({
      apiKey,
      model,
      signal,
        input,
        textFormat
      });
    } catch (error) {
      if (reservation) budgetGuard.reconcileInput(reservation, null);
      throw error;
    }
    if (reservation) {
      budgetGuard.countResponse();
      const usageResult = budgetGuard.reconcileInput(reservation, response.usage?.input_tokens);
      if (usageResult.overBudget) {
        const error = new Error('API実績が累積入力トークン上限を超えたため、計画を停止しました。');
        error.code = 'INPUT_TOKEN_BUDGET_ACTUAL';
        error.status = 'budget_exhausted';
        throw error;
      }
    }
    onUsage({ model, usage: response.usage || null });

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
    if (!validation.valid) {
      const error = new Error('AIの計画がアプリの規則を満たしていません。');
      error.code = 'INVALID_PLAN';
      error.details = validation.errors;
      error.sourceModule = 'features/planning/plan-contract.js';
      throw error;
    }
    return Object.freeze({
      plan,
      usage: Number.isSafeInteger(response.usage?.input_tokens) ? response.usage.input_tokens : null
    });
  }

  return Object.freeze({ createPlan });
}
