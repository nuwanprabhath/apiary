import type { AccountId, SessionId } from '@shared/domain/ids'
import { switchSessionAccount } from './accountsStore'
import { createLocalStore } from './createLocalStore'
import { surface } from './policy'

/**
 * Changing the account of a session that is mid-reply asks first (`AccountSwitchPrompt`): switching
 * restarts its `claude`, which ends the reply. "Switch when it finishes" waits here, in this window
 * only: a reload forgets it, which is fine for a wish that lasts one reply.
 */
interface SwitchState {
  /** Sessions to switch the next time they are idle, and to which account. */
  pending: ReadonlyMap<SessionId, AccountId>
  /** The question on screen: switch `sessionId` to `accountId` now, wait, or not at all. */
  asking: { sessionId: SessionId; accountId: AccountId } | null
}

const switchStore = createLocalStore<SwitchState>({ pending: new Map(), asking: null })

const COULD_NOT = 'Could not switch the account'

const withPending = (state: SwitchState, sessionId: SessionId, accountId: AccountId | null): SwitchState => {
  const pending = new Map(state.pending)
  if (accountId === null) pending.delete(sessionId)
  else pending.set(sessionId, accountId)
  return { ...state, pending }
}

/** The account `sessionId` is waiting to switch to once its reply ends; null when nothing waits. */
export function usePendingSwitch(sessionId: SessionId | null): AccountId | null {
  return switchStore.useStore((s) => (sessionId === null ? null : s.pending.get(sessionId) ?? null))
}

/** Every session with a switch waiting, for the host that watches them go idle. */
export function useWaitingSwitches(): ReadonlyMap<SessionId, AccountId> {
  return switchStore.useStore((s) => s.pending)
}

/** The question to show, or null. */
export function useSwitchQuestion(): SwitchState['asking'] {
  return switchStore.useStore((s) => s.asking)
}

/**
 * The person picked `accountId` for `sessionId`. An idle session switches at once; a busy one
 * asks. A newer pick replaces a waiting one.
 */
export function chooseAccount(sessionId: SessionId, accountId: AccountId, busy: boolean): void {
  if (busy) {
    switchStore.set((s) => ({ ...s, asking: { sessionId, accountId } }))
    return
  }
  switchStore.set((s) => withPending(s, sessionId, null))
  surface(switchSessionAccount(sessionId, accountId), COULD_NOT)
}

/** The answer to the question: switch now (ends the reply), switch after it, or leave things. */
export function answerSwitchQuestion(answer: 'now' | 'later' | 'none'): void {
  const asking = switchStore.get().asking
  if (asking === null) return
  switchStore.set((s) => {
    const cleared = { ...s, asking: null }
    if (answer === 'later') return withPending(cleared, asking.sessionId, asking.accountId)
    return answer === 'now' ? withPending(cleared, asking.sessionId, null) : cleared
  })
  if (answer === 'now') surface(switchSessionAccount(asking.sessionId, asking.accountId), COULD_NOT)
}

/** The session is idle: carry out a waiting switch, once. */
export function settleIdle(sessionId: SessionId): void {
  const accountId = switchStore.get().pending.get(sessionId)
  if (accountId === undefined) return
  switchStore.set((s) => withPending(s, sessionId, null))
  surface(switchSessionAccount(sessionId, accountId), COULD_NOT)
}

/** A message was sent: whoever sends one wants the session as it is, so a waiting switch is dropped. */
export function cancelPendingSwitch(sessionId: SessionId): void {
  if (switchStore.get().pending.has(sessionId)) switchStore.set((s) => withPending(s, sessionId, null))
}
