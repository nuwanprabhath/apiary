import { isTabTransfer, type TabTransfer } from '@shared/types'

/** The drag payload type for a session tab, shared by every strip in the window. */
export const TAB_MIME = 'application/x-apiary-tab'
/** The whole tab — its pty and shells — for a strip in *another* window that receives the drop.
 *  See `onDropTab`'s `transfer`. */
export const TRANSFER_MIME = 'application/x-apiary-tab-transfer'
/** A whole pane, dragged by the empty part of its tab strip onto another pane. */
export const PANE_MIME = 'application/x-apiary-pane'

export function readTransfer(dt: DataTransfer): TabTransfer | null {
  try {
    const parsed: unknown = JSON.parse(dt.getData(TRANSFER_MIME))
    return isTabTransfer(parsed) ? parsed : null
  } catch {
    return null
  }
}

/** Where a drop on the tab at `index` would insert, given which half of it the pointer is over. */
export function insertionIndex(
  e: { currentTarget: HTMLElement; clientX: number },
  tabs: { key: string }[],
  dragKey: string | null,
  index: number,
): number {
  const rect = e.currentTarget.getBoundingClientRect()
  const after = e.clientX > rect.left + rect.width / 2
  const from = tabs.findIndex((t) => t.key === dragKey)
  // Index within the list the dragged tab has been lifted out of.
  const base = from !== -1 && from < index ? index - 1 : index
  return after ? base + 1 : base
}

/**
 * Where the tab at `index` sits once `dragKey` is lifted out of the list — the coordinate the drop
 * indicator and `moveTab` both work in.
 */
export function indexInRest(tabs: { key: string }[], dragKey: string, index: number): number {
  const from = tabs.findIndex((t) => t.key === dragKey)
  return from !== -1 && from < index ? index - 1 : index
}
