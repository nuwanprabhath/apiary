/**
 * Small value guards and clamps for data that crosses a trust boundary — files Apiary reads back
 * and values the renderer sends. IPC argument guards stay in `shared/ipc/guards.ts`; these are for
 * the values inside them.
 */

/** A plain object whose keys can be read (not `null`, not an array). */
export function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

/** `o[k]` only when `k` is the object's own property — never something on its prototype. */
export function own(o: unknown, k: string): unknown {
  return isRecord(o) && Object.prototype.hasOwnProperty.call(o, k) ? o[k] : undefined
}

export function isFiniteNumber(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v)
}

/** Narrows a string to one of a fixed list (`PET_MODELS`, `THEME_MODELS`, ...). */
export function isOneOf<T extends string>(list: readonly T[], v: unknown): v is T {
  return typeof v === 'string' && (list as readonly string[]).includes(v)
}

export function oneOf<T extends string>(list: readonly T[], v: unknown, fallback: T): T {
  return isOneOf(list, v) ? v : fallback
}

export function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n))
}
