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
/** Anything at all — for payloads validated deeper in, by their own domain guard. */
export const any: Guard<unknown> = (_v): _v is unknown => true
export const obj: Guard<Record<string, unknown>> = (v): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null

export const opt = <T>(g: Guard<T>): Guard<T | undefined> =>
  (v): v is T | undefined => v === undefined || g(v)
export const nullable = <T>(g: Guard<T>): Guard<T | null> =>
  (v): v is T | null => v === null || g(v)
export const arr = <T>(g: Guard<T>): Guard<T[]> =>
  (v): v is T[] => Array.isArray(v) && v.every(g)

/** Builds a guard for a fixed-length (trailing-optional) positional tuple, the shape every IPC
 *  call takes. `<=` rather than `===` on length: trailing optional arguments are simply absent,
 *  not sent as `undefined` — Electron's IPC does not serialise a missing trailing argument. */
export const tuple = <G extends Guard<unknown>[]>(...gs: G) =>
  (v: unknown): v is { [K in keyof G]: G[K] extends Guard<infer T> ? T : never } =>
    Array.isArray(v) && v.length <= gs.length && gs.every((g, i) => g(v[i]))
