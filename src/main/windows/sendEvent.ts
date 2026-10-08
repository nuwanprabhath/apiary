import type { EventSpec } from '@shared/ipc/contract'

/** Anything an event can be sent to: a `WebContents`, or a test's fake of one. */
export interface EventTarget {
  send(channel: string, ...args: unknown[]): void
}

/** Sends `event` to one window's contents, with the payload type-checked like `broadcast` (`windows/broadcast.ts`). The
 *  caller has already picked the window (the front one, a tab's new owner, the sender); none is a no-op. */
export function sendEvent<P extends unknown[]>(target: EventTarget | null | undefined, event: EventSpec<P>, ...payload: P): void {
  target?.send(event.channel, ...payload)
}
