import { usePendingSessions } from '../features/workspace/usePendingSessions'
import { usePtyLifecycle } from '../features/workspace/usePtyLifecycle'
import { useSessionFollowing } from '../features/workspace/useSessionFollowing'

/**
 * Tabs follow the session their terminal is on: pending-session reconciliation and rekeying, the
 * pending sessions themselves, and the ptys' lifecycle. In this order, as App always called them
 * (their effects run in declaration order).
 */
export function useWorkspaceFollowing(): ReturnType<typeof usePendingSessions> {
  useSessionFollowing()
  const pending = usePendingSessions()
  usePtyLifecycle()
  return pending
}
