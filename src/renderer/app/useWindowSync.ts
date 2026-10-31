import type { TabTransfer } from '@shared/types'
import { useChatTakeover } from '../features/workspace/useChatTakeover'
import { useLayoutReporting } from '../features/workspace/useLayoutReporting'
import { useOpenSessionRows } from '../features/workspace/useOpenSessionRows'
import { useTabTransfer } from '../features/workspace/useTabTransfer'
import { useOpenSessionRequests } from '../features/workspace/useOpenSessionRequests'

/**
 * What keeps this window and main in step after the launch restore: the layout report main
 * persists, the open-session rows, tab transfers between windows and chat take-over. In this
 * order, as App always called them.
 */
export function useWindowSync(detached: string | null): { transferFor: (key: string) => TabTransfer } {
  useLayoutReporting(detached)
  useOpenSessionRows()
  const transfer = useTabTransfer()
  useChatTakeover()
  useOpenSessionRequests()
  return transfer
}
