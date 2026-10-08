/**
 * Small value guards and clamps for data that crosses a trust boundary — files Apiary reads back
 * (settings, themes, pets, Claude's own JSON) and values the renderer sends. Before this file,
 * each validator kept a private copy (`own` in both theme/ and pets/ validate.ts, `isModel` three
 * times, 53 inline `Math.min(Math.max(...))`), which is what the duplicate-symbol test
 * (tests/unit/architecture/duplicateSymbols.test.ts) now catches. IPC argument guards stay in
 * `shared/ipc/guards.ts`; these are for the values inside them.
 */

/** A plain object whose keys can be read (not `null`, not an array). */
export function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

/** `o[k]` only when `k` is the object's own property — never something on its prototype. */
export function own(o: unknown, k: string): unknown {
  return isRecord(o) && Object.prototype.hasOwnProperty.call(o, k) ? o[k] : undefined
}

/** A number that is not NaN or ±Infinity. */
export function isFiniteNumber(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v)
}

/** Narrows a string to one of a fixed list (`PET_MODELS`, `THEME_MODELS`, ...). */
export function isOneOf<T extends string>(list: readonly T[], v: unknown): v is T {
  return typeof v === 'string' && (list as readonly string[]).includes(v)
}

/** `v` if it is one of `list`, else `fallback`. */
export function oneOf<T extends string>(list: readonly T[], v: unknown, fallback: T): T {
  return isOneOf(list, v) ? v : fallback
}

/** `n` limited to `[min, max]`. */
export function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n))
}
