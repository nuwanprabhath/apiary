/**
 * The constructors a contract entry is declared with (`shared/ipc/contract.ts`), kept apart from
 * the channel list so the strictness they enforce can be tested on its own
 * (`tests/unit/ipcTypes.test.ts`). Pure, like the contract: nothing here may import `electron`
 * or `node:*`.
 */
import type { Guard } from './guards'

export interface Invoke<A extends unknown[], R> { kind: 'invoke'; channel: string; args: Guard<A>; loose?: true; _r?: R }
export interface Send<A extends unknown[]> { kind: 'send'; channel: string; args: Guard<A>; loose?: true }
/** An event main pushes to the renderer. `P` is the payload; `broadcast`, the per-window send
 *  helpers (`main/windows`) and the preload's `on*` subscriptions are all typed from it. */
export interface EventSpec<P extends unknown[]> { kind: 'event'; channel: string; _p?: P }
export interface Sync<R> { kind: 'sync'; channel: string; _r?: R }

// `args` is a `Guard<A>` for the declared argument tuple `A`: a guard that proves less than `A`
// (an `obj` standing in for a typed patch) is a compile error, so a handler never receives a
// value typed more narrowly than anything checked. The few channels whose real validator lives
// elsewhere — and so whose guard here proves only "an array of the right length" — are declared
// with `invokeLoose`/`sendLoose` instead, each with a comment naming that validator. They are
// greppable, and `tests/unit/architecture/looseGuards.test.ts` pins the set.
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
