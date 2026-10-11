import type { JSX, ReactNode } from 'react'
import { CloseIcon } from '../../ui/icons'
import type { TabTransfer } from '@shared/types'
import type { SessionTabView } from './paneTypes'
import { TAB_MIME, TRANSFER_MIME, readTransfer } from './tabDrag'

interface Props {
  tab: SessionTabView
  columnId: string
  isActive: boolean
  isDragging: boolean
  dropBefore: boolean
  dropAfter: boolean
  /** Where a drop on this tab would insert, given which half of it the pointer is over. */
  insertionFor: (e: { currentTarget: HTMLElement; clientX: number }) => number
  activeRef: React.RefObject<HTMLDivElement | null>
  /** Registers (or, on null, forgets) this tab's `role="tab"` button for keyboard focus moves. */
  registerButton: (key: string, el: HTMLButtonElement | null) => void
  transferFor?: (key: string) => TabTransfer
  onDragStartTab: (key: string) => void
  onDragOverAt: (index: number) => void
  onDropTab: (key: string, toIndex: number, transfer: TabTransfer | null) => void
  onEndDrag: () => void
  onActivate: (key: string) => void
  onClose: (key: string) => void
  onTabDropped: (key: string, at: { x: number; y: number }) => void
  onOpenMenu: (key: string, at: { x: number; y: number }) => void
  /** The "Arrange" layout button, built by the strip (which owns the layout actions). */
  arrangeButton: ReactNode
}

/** One tab of the strip: the draggable wrapper, its label button, arrange and close. */
export function SessionTab(p: Props): JSX.Element {
  const { tab, columnId, isActive } = p
  return (
    <div
      ref={isActive ? p.activeRef : null}
      className="session-tab"
      data-testid="session-tab"
      data-own-context-menu
      data-active={isActive}
      data-dragging={p.isDragging}
      data-drop-before={p.dropBefore}
      data-drop-after={p.dropAfter}
      draggable
      onDragStart={(e) => {
        p.onDragStartTab(tab.key)
        e.dataTransfer.effectAllowed = 'move'
        // A typed payload, so a strip can tell a tab being dragged from anywhere in the window
        // apart from a folder, a pinned row or a plain text selection. `text/plain` is kept
        // beside it because Firefox refuses to start a drag with no standard payload at all.
        e.dataTransfer.setData(TAB_MIME, tab.key)
        e.dataTransfer.setData('text/plain', tab.key)
        if (p.transferFor !== undefined) e.dataTransfer.setData(TRANSFER_MIME, JSON.stringify(p.transferFor(tab.key)))
      }}
      onDragOver={(e) => {
        // Keyed off the payload type rather than off `dragKey`, which is set only in the strip
        // the drag started in: a tab dragged from another column would otherwise find no
        // target here at all, because without `preventDefault` no drop ever fires.
        if (!e.dataTransfer.types.includes(TAB_MIME)) return
        e.preventDefault()
        e.dataTransfer.dropEffect = 'move'
        p.onDragOverAt(p.insertionFor(e))
      }}
      onDrop={(e) => {
        const key = e.dataTransfer.getData(TAB_MIME)
        if (key === '') return
        e.preventDefault()
        // The strip behind this tab is a drop target of its own (for the empty space past the
        // last tab); without this the drop would count twice and the second, coarser one would
        // win, sending every tab to the end.
        e.stopPropagation()
        p.onDropTab(key, p.insertionFor(e), readTransfer(e.dataTransfer))
        p.onEndDrag()
      }}
      onDragEnd={(e) => {
        // Nothing in this window took the tab. Where it went is decided in the main process
        // from where the pointer was released — another of our windows, or the desktop — and
        // that is the only way it *can* be decided: an HTML5 drag started here delivers no
        // drop event to another window at all, so there is nothing on the receiving side to
        // ask. Releasing over this same window resolves to "nothing happened".
        if (e.dataTransfer.dropEffect === 'none' && !tab.isPending) {
          p.onTabDropped(tab.key, { x: e.screenX, y: e.screenY })
        }
        p.onEndDrag()
      }}
      onContextMenu={(e) => {
        e.preventDefault()
        p.onOpenMenu(tab.key, { x: e.clientX, y: e.clientY })
      }}
    >
      <button
        ref={(el) => p.registerButton(tab.key, el)}
        className="session-tab-label"
        data-testid="session-tab-label"
        role="tab"
        id={`session-tab-${columnId}-${tab.key}`}
        aria-selected={isActive}
        aria-controls={isActive ? `session-tabpanel-${columnId}` : undefined}
        // Roving tabindex (WAI-ARIA tablist pattern): only the active tab is a Tab stop: the
        // others are reached by arrow key, not by Tab, the same as a browser's own tab strip.
        tabIndex={isActive ? 0 : -1}
        title={tab.label}
        onClick={() => p.onActivate(tab.key)}
      >
        {tab.isPending && <span className="live-dot" aria-label="running" />}
        <span className="session-tab-text">{tab.label}</span>
      </button>
      {p.arrangeButton}
      <button
        className="session-tab-close"
        data-testid="session-tab-close"
        title="Close session"
        aria-label="Close session"
        onClick={() => p.onClose(tab.key)}
      >
        <CloseIcon />
      </button>
    </div>
  )
}
