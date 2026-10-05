/**
 * Approximate list prices in USD per million tokens, used only for cost
 * estimates in the usage view. Unknown models are counted as 0 (e.g. local
 * models). Admins can override prices in AI settings.
 */
export const DEFAULT_PRICES: Record<string, { input: number; output: number }> = {
  'claude-fable-5-1': { input: 10, output: 50 },
  'claude-opus-5-5': { input: 4, output: 20 },
  'claude-opus-5': { input: 5, output: 25 },
  'claude-sonnet-5-5': { input: 2, output: 10 },
  'claude-sonnet-5': { input: 2, output: 10 },
  'claude-haiku-4-5': { input: 1, output: 5 },
  'gpt-5': { input: 1.25, output: 10 },
  'gpt-5-mini': { input: 0.25, output: 2 },
  'text-embedding-3-small': { input: 0.02, output: 0 },
  'text-embedding-3-large': { input: 0.13, output: 0 },
};

export function estimateCostUsd(
  model: string,
  inputTokens: number,
  outputTokens: number,
  overrides: Record<string, { input: number; output: number }> = {},
): number {
  const p = overrides[model] ?? DEFAULT_PRICES[model];
  if (!p) return 0;
  return (inputTokens * p.input + outputTokens * p.output) / 1_000_000;
}

/** Rough token estimate (≈4 characters per token for Finnish/Swedish prose). */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}
