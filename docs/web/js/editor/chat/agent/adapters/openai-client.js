const RESPONSES_URL = 'https://api.openai.com/v1/responses';

export function createOpenAIClient({ fetchImpl = fetch } = {}) {
  async function request({ apiKey, model, input, textFormat, tools, maxOutputTokens, signal }) {
    try {
      if (typeof apiKey !== 'string' || !apiKey.trim()) throw new TypeError('OpenAI APIキーを入力してください。');
      if (typeof model !== 'string' || !model.trim()) throw new TypeError('AIモデルを選択してください。');
      const response = await fetchImpl(RESPONSES_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey.trim()}` },
        body: JSON.stringify({
          model,
          input,
          ...(textFormat ? { text: { format: textFormat } } : {}),
          ...(tools?.length ? { tools } : {}),
          ...(Number.isSafeInteger(maxOutputTokens) ? { max_output_tokens: maxOutputTokens } : {})
        }),
        signal
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) {
        const message = body?.error?.message || `OpenAI APIへの接続に失敗しました（HTTP ${response.status}）。`;
        const error = new Error(message);
        error.status = response.status;
        error.retryable = response.status === 408 || response.status === 429 || response.status >= 500;
        throw error;
      }
      return body;
    } catch (error) {
      if (error && typeof error === 'object' && !error.sourceModule) error.sourceModule = 'adapters/openai-client.js';
      throw error;
    }
  }

  return Object.freeze({ request });
}
