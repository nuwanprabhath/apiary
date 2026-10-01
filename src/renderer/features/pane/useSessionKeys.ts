import { useCallback } from 'react'
import type { PendingTabInfo } from './paneTypes'
import { asPtyId, type PtyId } from '@shared/domain/ids'
import { useWorkspace } from '../workspace/WorkspaceProvider'

/**
 * The id every pty for a tab hangs off: the session id normally, but the original `new:<uuid>`
 * pty id for a session that was started from "+" — a session started that way is only ever
 * *addressed* by its session id, while the main process still knows it by the pty it was spawned
 * under, so `ptyOverrides` keeps both the claude terminal and `shell:<key>:<n>` ids stable
 * across the moment the session resolves. Pending tabs are keyed by their pty id directly.
 */
export function useSessionKeys(pending: Map<string, PendingTabInfo>): {
  keyFor: (tabKey: string) => PtyId
  /** Whether `keyFor` produced a pty id rather than a stored session id — the two take different
   *  main-process calls, since only a session id can be looked up in the store for its cwd. */
  isPtyKey: (tabKey: string) => boolean
} {
  const { ptyOverrides } = useWorkspace()
  const keyFor = useCallback(
    (tabKey: string): PtyId => asPtyId(pending.has(tabKey) ? tabKey : ptyOverrides.get(tabKey) ?? tabKey),
    [pending, ptyOverrides],
  )
  const isPtyKey = useCallback(
    (tabKey: string): boolean => pending.has(tabKey) || ptyOverrides.has(tabKey),
    [pending, ptyOverrides],
  )
  return { keyFor, isPtyKey }
}
