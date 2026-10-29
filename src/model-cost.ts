export interface ModelRates { input: number; output: number }
export function estimateModelCost(usage: { protocol: string; inputTokens: number | null; outputTokens: number | null; cacheReadInputTokens?: number | null; cacheCreationInputTokens?: number | null } | undefined, rates: ModelRates) {
  if (!usage || usage.inputTokens == null || usage.outputTokens == null || ![usage.inputTokens, usage.outputTokens, rates.input, rates.output].every(value => Number.isFinite(value) && value >= 0)) return null;
  const extraInput = usage.protocol === 'anthropic' ? (usage.cacheReadInputTokens || 0) + (usage.cacheCreationInputTokens || 0) : 0;
  const estimate = ((usage.inputTokens + extraInput) * rates.input + usage.outputTokens * rates.output) / 1000000;
  return Number.isFinite(estimate) ? estimate : null;
}
