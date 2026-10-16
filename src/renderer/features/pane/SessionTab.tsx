import type { JSX, ReactNode } from 'react'
import { accountById, hasSeveralAccounts, useAccounts, useSessionAccount } from '../../state/accountsStore'
import { sessionOfTabKey } from '../../state/sessionBusy'
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
  const accounts = useAccounts()
  const account = accountById(accounts, useSessionAccount(sessionOfTabKey(tab.key)))
  const tooltip = hasSeveralAccounts(accounts) && account !== null ? `${tab.label}\nAccount: ${account.label}` : tab.label
  return (
    <div
      ref={isActive ? p.activeRef : null}
      className="session-tab"
      data-testid="session-tab"
      data-own-context-menu
      data-active={isActive}
      data-activity={tab.activity}
      data-glow={tab.activity === 'running' || tab.activity === 'waiting' ? tab.activity : undefined}
      data-dragging={p.isDragging}
      data-drop-before={p.dropBefore}
      data-drop-after={p.dropAfter}
      draggable
      onDragStart={(e) => {
        p.onDragStartTab(tab.key)
        e.dataTransfer.effectAllowed = 'move'
        // A typed payload tells a tab from a folder, a pinned row or a text selection;
        // `text/plain` is there because Firefox refuses a drag with no standard payload.
        e.dataTransfer.setData(TAB_MIME, tab.key)
        e.dataTransfer.setData('text/plain', tab.key)
        if (p.transferFor !== undefined) e.dataTransfer.setData(TRANSFER_MIME, JSON.stringify(p.transferFor(tab.key)))
      }}
      onDragOver={(e) => {
        // Keyed off the payload type, not `dragKey`, which is set only in the originating strip.
        if (!e.dataTransfer.types.includes(TAB_MIME)) return
        e.preventDefault()
        e.dataTransfer.dropEffect = 'move'
        p.onDragOverAt(p.insertionFor(e))
      }}
      onDrop={(e) => {
        const key = e.dataTransfer.getData(TAB_MIME)
        if (key === '') return
        e.preventDefault()
        // The strip behind is a drop target too; without this the coarser drop would win twice.
        e.stopPropagation()
        p.onDropTab(key, p.insertionFor(e), readTransfer(e.dataTransfer))
        p.onEndDrag()
      }}
      onDragEnd={(e) => {
        // Main decides from the release point: an HTML5 drag delivers no drop event to another window.
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
        // Roving tabindex: only the active tab is a Tab stop.
        tabIndex={isActive ? 0 : -1}
        title={tooltip}
        onClick={() => p.onActivate(tab.key)}
      >
        {tab.activity === 'running' && <span className="session-tab-ring" role="img" aria-label="running" />}
        {tab.activity === 'waiting' && <span className="status-dot" data-status="waiting" role="img" aria-label="waiting for you" />}
        {tab.isPending && tab.activity !== 'running' && <span className="live-dot" aria-label="running" />}
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
