/** The token counts a price applies to (tokens.ts's `TokenBreakdown`, structurally — importing it
 *  would make these two modules import each other). */
interface TokenBreakdown { input: number; output: number; cacheRead: number; cacheCreate: number }

/**
 * Anthropic API list prices per model, USD per million tokens — the claude-usage-stats extension's
 * table. Cache reads are priced at 0.1× the input rate and cache writes at 1.25× (the 5-minute-TTL
 * rate; which TTL a write used is not recoverable from a transcript). This is an estimate at list
 * price, not an invoice: plan pricing differs, and the dashboard says so.
 */
const PRICING: Record<string, { inputPerM: number; outputPerM: number }> = {
  'claude-fable-5': { inputPerM: 10, outputPerM: 50 },
  'claude-fable-5-1': { inputPerM: 10, outputPerM: 50 },
  'claude-mythos-5': { inputPerM: 10, outputPerM: 50 },
  'claude-opus-5-5': { inputPerM: 5, outputPerM: 25 },
  'claude-opus-4-8': { inputPerM: 5, outputPerM: 25 },
  'claude-opus-4-7': { inputPerM: 5, outputPerM: 25 },
  'claude-opus-4-6': { inputPerM: 5, outputPerM: 25 },
  'claude-opus-4-5': { inputPerM: 5, outputPerM: 25 },
  'claude-opus-4-1': { inputPerM: 5, outputPerM: 25 },
  'claude-opus-4-0': { inputPerM: 5, outputPerM: 25 },
  'claude-sonnet-5-5': { inputPerM: 3, outputPerM: 15 },
  'claude-sonnet-5': { inputPerM: 3, outputPerM: 15 },
  'claude-sonnet-4-6': { inputPerM: 3, outputPerM: 15 },
  'claude-sonnet-4-5': { inputPerM: 3, outputPerM: 15 },
  'claude-sonnet-4-0': { inputPerM: 3, outputPerM: 15 },
  'claude-haiku-4-5': { inputPerM: 1, outputPerM: 5 },
}

const CACHE_READ_MULTIPLIER = 0.1
const CACHE_WRITE_MULTIPLIER = 1.25

/** Looks a model up exactly, then without a trailing date stamp (`claude-haiku-4-5-20251001`). */
function priceOf(model: string): { inputPerM: number; outputPerM: number } | undefined {
  return PRICING[model] ?? PRICING[model.replace(/-\d{8}$/, '')]
}

/** USD for these tokens on this model, or undefined when the model's price is not known. */
export function costForTokens(model: string, t: TokenBreakdown): number | undefined {
  const p = priceOf(model)
  if (p === undefined) return undefined
  return (
    t.input * p.inputPerM
    + t.output * p.outputPerM
    + t.cacheRead * p.inputPerM * CACHE_READ_MULTIPLIER
    + t.cacheCreate * p.inputPerM * CACHE_WRITE_MULTIPLIER
  ) / 1_000_000
}

export function hasPricing(model: string): boolean {
  return priceOf(model) !== undefined
}
