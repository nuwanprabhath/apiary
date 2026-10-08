/**
 * Tiny, dependency-free runtime guards for IPC arguments (MAIN-11). Each channel in
 * `shared/ipc/contract.ts` carries one of these, so the main-side registrar
 * (`main/ipc/registrar.ts`) can reject a malformed call before a handler ever sees it, instead of
 * every handler trusting its declared TypeScript types against a boundary that crosses processes.
 *
 * Kept permissive on purpose for payloads that already have their own structural validator
 * (`isTabTransfer`, `isWindowLayoutReport`, `mergeSettingsPayload`'s field-by-field checks): this
 * file only proves "the right number of arguments of roughly the right shape arrived", not full
 * domain validation, which stays where it already lived rather than being duplicated here.
 */
export type Guard<T> = (v: unknown) => v is T

export const str: Guard<string> = (v): v is string => typeof v === 'string'
export const bool: Guard<boolean> = (v): v is boolean => typeof v === 'boolean'
export const num: Guard<number> = (v): v is number => typeof v === 'number' && Number.isFinite(v)
/** Declared as `unknown` in the contract: the handler treats it as untrusted and validates it
 *  itself (a theme spec through `validateTheme`). Not loose — the declared type is exactly this. */
export const opaque: Guard<unknown> = (_v): _v is unknown => true
export const record: Guard<Record<string, unknown>> = (v): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null

/**
 * The escape hatches (`any`, `obj`, `anyStr`). They prove less than the type a channel declares (`any` proves nothing,
 * `obj` an object of unknown shape, `anyStr` a string), so a channel that uses one is declared with
 * `invokeLoose`/`sendLoose` in the contract and its real validator is named there. `tuple`,
 * `opt`, `nullable` and `arr` carry the mark outward, which is what lets
 * `tests/unit/architecture/looseGuards.test.ts` check the declaration against the guard.
 */
const loose = new WeakSet<object>()
export const isLooseGuard = (g: Guard<unknown>): boolean => loose.has(g)
export const any: Guard<unknown> = (_v): _v is unknown => true
export const obj: Guard<Record<string, unknown>> = (v): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null
/** A string standing in for a narrower string union (`LogLevel`, `LogScope`): proves only `string`. */
export const anyStr: Guard<string> = (v): v is string => typeof v === 'string'
loose.add(any)
loose.add(obj)
loose.add(anyStr)
const carry = <G extends Guard<unknown>>(out: G, inner: readonly Guard<unknown>[]): G => {
  if (inner.some((g) => loose.has(g))) loose.add(out)
  return out
}

export const opt = <T>(g: Guard<T>): Guard<T | undefined> =>
  carry((v): v is T | undefined => v === undefined || g(v), [g])
export const nullable = <T>(g: Guard<T>): Guard<T | null> =>
  carry((v): v is T | null => v === null || g(v), [g])
export const arr = <T>(g: Guard<T>): Guard<T[]> =>
  carry((v): v is T[] => Array.isArray(v) && v.every(g), [g])

/** Builds a guard for a fixed-length (trailing-optional) positional tuple, the shape every IPC
 *  call takes. `<=` rather than `===` on length: trailing optional arguments are simply absent,
 *  not sent as `undefined` — Electron's IPC does not serialise a missing trailing argument. */
export const tuple = <G extends Guard<unknown>[]>(...gs: G) =>
  carry(
    (v: unknown): v is { [K in keyof G]: G[K] extends Guard<infer T> ? T : never } =>
      Array.isArray(v) && v.length <= gs.length && gs.every((g, i) => g(v[i])),
    gs,
  )
