function normalizeUsage(model, usage) {
  if (!usage || !Number.isFinite(usage.input_tokens) || !Number.isFinite(usage.output_tokens)) {
    return { model, unknown: true, inputTokens: 0, outputTokens: 0, cachedTokens: 0, cacheWriteTokens: 0 };
  }
  const inputTokens = Math.max(0, Math.floor(usage.input_tokens));
  const details = usage.input_tokens_details || {};
  const cachedTokens = Math.min(inputTokens, Math.max(0, Math.floor(Number(details.cached_tokens) || 0)));
  const cacheWriteTokens = Math.min(inputTokens - cachedTokens, Math.max(0, Math.floor(Number(details.cache_write_tokens) || 0)));
  return { model, unknown: false, inputTokens, outputTokens: Math.max(0, Math.floor(usage.output_tokens)), cachedTokens, cacheWriteTokens };
}

export function estimateUsageCost(entries, config) {
  let costUsd = 0;
  for (const entry of entries) {
    if (entry.unknown) return { known: false, costUsd: null };
    const rates = config?.models?.find((item) => item.id === entry.model);
    if (rates?.pricingVerified !== true
      || !Number.isFinite(rates.inputUsdPerMillion)
      || !Number.isFinite(rates.outputUsdPerMillion)
      || !Number.isFinite(rates.cachedInputUsdPerMillion)
      || !Number.isFinite(rates.cacheWriteUsdPerMillion)) return { known: false, costUsd: null };
    costUsd += ((entry.inputTokens - entry.cachedTokens - entry.cacheWriteTokens) * rates.inputUsdPerMillion
      + entry.cachedTokens * rates.cachedInputUsdPerMillion
      + entry.cacheWriteTokens * rates.cacheWriteUsdPerMillion
      + entry.outputTokens * rates.outputUsdPerMillion) / 1_000_000;
  }
  return { known: true, costUsd };
}

export function createUsageAccounting() {
  let taskEntries = [];
  const sessionEntries = [];
  return Object.freeze({
    record(model, usage) {
      const entry = normalizeUsage(model, usage);
      taskEntries.push(entry);
      sessionEntries.push(entry);
    },
    resetTask() { taskEntries = []; },
    summary(config) {
      const summarize = (entries) => ({
        requests: entries.length,
        inputTokens: entries.reduce((total, item) => total + item.inputTokens, 0),
        outputTokens: entries.reduce((total, item) => total + item.outputTokens, 0),
        ...estimateUsageCost(entries, config)
      });
      return { task: summarize(taskEntries), session: summarize(sessionEntries) };
    }
  });
}
