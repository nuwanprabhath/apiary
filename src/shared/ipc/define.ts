/**
 * The constructors a contract entry is declared with (`shared/ipc/contract.ts`), kept apart from
 * the channel list so the strictness they enforce can be tested on its own
 * (`tests/unit/ipcTypes.test.ts`). Pure, like the contract: nothing here may import `electron`
 * or `node:*`.
 */
import type { Guard } from './guards'

export interface Invoke<A extends unknown[], R> { kind: 'invoke'; channel: string; args: Guard<A>; loose?: true; _r?: R }
export interface Send<A extends unknown[]> { kind: 'send'; channel: string; args: Guard<A>; loose?: true }
/** An event main pushes to the renderer; `P` is the payload. */
export interface EventSpec<P extends unknown[]> { kind: 'event'; channel: string; _p?: P }
export interface Sync<R> { kind: 'sync'; channel: string; _r?: R }
/** A preload-only API: `window.apiary` answers it synchronously, and it never crosses IPC. `args` is the
 *  guard the preload applies before the implementation in `src/preload/local.ts` runs; `R` is the result. */
export interface Local<A extends unknown[], R> { kind: 'local'; args: Guard<A>; _r?: R }

// `args` is a `Guard<A>`: a guard that proves less than `A` is a compile error. Channels whose
// real validator lives elsewhere are declared with `invokeLoose`/`sendLoose` and a comment naming
// it; `tests/unit/architecture/looseGuards.test.ts` pins the set.
export const invoke = <A extends unknown[], R>(channel: string, args: Guard<A>): Invoke<A, R> =>
  ({ kind: 'invoke', channel, args })
export const send = <A extends unknown[]>(channel: string, args: Guard<A>): Send<A> =>
  ({ kind: 'send', channel, args })
export const invokeLoose = <A extends unknown[], R>(channel: string, args: Guard<unknown[]>): Invoke<A, R> =>
  ({ kind: 'invoke', channel, args: args as Guard<A>, loose: true })
export const sendLoose = <A extends unknown[]>(channel: string, args: Guard<unknown[]>): Send<A> =>
  ({ kind: 'send', channel, args: args as Guard<A>, loose: true })
export const event = <P extends unknown[] = []>(channel: string): EventSpec<P> => ({ kind: 'event', channel })
export const sync = <R>(channel: string): Sync<R> => ({ kind: 'sync', channel })
export const local = <A extends unknown[], R>(args: Guard<A>): Local<A, R> => ({ kind: 'local', args })
