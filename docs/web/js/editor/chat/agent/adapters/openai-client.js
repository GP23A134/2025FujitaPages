const RESPONSES_URL = 'https://api.openai.com/v1/responses';
const DEFAULT_MAX_RETRIES = 3;
const MAX_RETRY_DELAY_MS = 120000;

function retryAfterMs(response, now = Date.now()) {
  const value = response.headers?.get?.('retry-after');
  if (!value) return null;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) return Math.ceil(seconds * 1000);
  const date = Date.parse(value);
  return Number.isFinite(date) ? Math.max(0, date - now) : null;
}

function isRetryableError(status, type, code) {
  if (status === 408 || status >= 500) return true;
  if (status !== 429) return false;
  const normalizedCode = String(code || '').toLowerCase();
  const normalizedType = String(type || '').toLowerCase();
  if (['insufficient_quota', 'credit_balance_exhausted', 'organization_spend_limit_exceeded',
    'project_spend_limit_exceeded', 'organization_usage_limit_exceeded'].includes(normalizedCode)) return false;
  return normalizedType === 'rate_limit_error'
    || ['rate_limit_exceeded', 'slow_down'].includes(normalizedCode);
}

function wait(ms, signal, sleepImpl) {
  if (signal?.aborted) return Promise.reject(signal.reason || Object.assign(new Error('処理が中断されました。'), { name: 'AbortError' }));
  if (sleepImpl) return sleepImpl(ms, signal);
  return new Promise((resolve, reject) => {
    const timer = setTimeout(done, ms);
    const abort = () => {
      clearTimeout(timer);
      signal.removeEventListener('abort', abort);
      reject(signal.reason || Object.assign(new Error('処理が中断されました。'), { name: 'AbortError' }));
    };
    function done() {
      signal?.removeEventListener('abort', abort);
      resolve();
    }
    signal?.addEventListener('abort', abort, { once: true });
  });
}

export function createOpenAIClient({ fetchImpl = fetch, sleepImpl = null, random = Math.random, maxRetries = DEFAULT_MAX_RETRIES } = {}) {
  async function request({ apiKey, model, input, textFormat, tools, maxOutputTokens, signal, onRetry, beforeRetry }) {
    if (typeof apiKey !== 'string' || !apiKey.trim()) throw new TypeError('OpenAI APIキーを入力してください。');
    if (typeof model !== 'string' || !model.trim()) throw new TypeError('AIモデルを選択してください。');
    let totalWaitMs = 0;
    for (let attempt = 0; ; attempt += 1) {
      try {
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
        if (response.ok) return body;
        const message = body?.error?.message || `OpenAI APIへの接続に失敗しました（HTTP ${response.status}）。`;
        const error = new Error(message);
        error.status = response.status;
        error.type = body?.error?.type || null;
        error.code = body?.error?.code || null;
        error.retryAfterMs = retryAfterMs(response);
        error.retryable = isRetryableError(response.status, error.type, error.code);
        error.sourceModule = 'adapters/openai-client.js';
        if (!error.retryable || attempt >= maxRetries) throw error;
        const backoffMs = Math.round(1000 * (2 ** attempt) + Math.max(0, random()) * 500);
        const delayMs = error.retryAfterMs === null ? backoffMs : error.retryAfterMs + Math.round(Math.max(0, random()) * 250);
        if (delayMs > MAX_RETRY_DELAY_MS || totalWaitMs + delayMs > MAX_RETRY_DELAY_MS) {
          error.deferred = true;
          error.message = `${error.message} 再試行までの待ち時間が上限を超えるため、処理を停止しました。時間をおいて再実行してください。`;
          throw error;
        }
        totalWaitMs += delayMs;
        try { onRetry?.({ error, attempt: attempt + 1, waitMs: delayMs }); } catch { /* Progress callbacks must not interrupt retry handling. */ }
        await wait(delayMs, signal, sleepImpl);
        await beforeRetry?.({ error, attempt: attempt + 1 });
        continue;
      } catch (error) {
        if (error && typeof error === 'object' && !error.sourceModule) error.sourceModule = 'adapters/openai-client.js';
        throw error;
      }
    }
  }

  return Object.freeze({ request });
}
