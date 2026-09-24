import { useEffect, useRef, useState, type ReactNode } from 'react'
import { CloseIcon, SplitIcon, LayoutIcon } from './icons'
import { ContextMenu } from './ContextMenu'
import { LayoutMenuButton } from './LayoutMenuButton'
import { useLayoutActions } from '../state/layoutContext'
import { isTabTransfer, type TabTransfer } from '@shared/types'

/** The drag payload type for a session tab, shared by every strip in the window. */
const TAB_MIME = 'application/x-apiary-tab'
/** The whole tab — its pty and shells — for a strip in *another* window that receives the drop.
 *  See `onDropTab`'s `transfer`. */
const TRANSFER_MIME = 'application/x-apiary-tab-transfer'

function readTransfer(dt: DataTransfer): TabTransfer | null {
  try {
    const parsed: unknown = JSON.parse(dt.getData(TRANSFER_MIME))
    return isTabTransfer(parsed) ? parsed : null
  } catch {
    return null
  }
}

export interface SessionTabView {
  key: string
  label: string
  /** A session started from "+" that hasn't produced its JSONL yet, shown the way the sidebar
   *  shows it so the two agree while it resolves. */
  isPending: boolean
}

/**
 * Where the tab at `index` sits once `dragKey` is lifted out of the list — the coordinate the drop
 * indicator and `moveTab` both work in.
 */
function indexInRest(tabs: SessionTabView[], dragKey: string, index: number): number {
  const from = tabs.findIndex((t) => t.key === dragKey)
  return from !== -1 && from < index ? index - 1 : index
}

interface Props {
  /** The pane this strip belongs to — carried on a place/arrange target so a key open in more
   *  than one pane at once (a split) is placed from the pane the user actually picked, not
   *  whichever pane happens to be found first. */
  columnId: string
  tabs: SessionTabView[]
  activeKey: string | null
  onActivate: (key: string) => void
  onClose: (key: string) => void
  /** Splits the active tab into a column of its own, the way VS Code's editor-title split does. */
  onSplitActive: () => void
  /**
   * Puts `key` at `toIndex` in this column's strip, after a drag. The tab may have come from this
   * strip (a reorder) or from another column's (a move); the strip does not distinguish between
   * them, because to the person dragging it they are the same gesture.
   */
  /**
   * A tab was dropped on this strip. `transfer` is the whole tab as its own window described it,
   * present when the drag carried one — which is what lets a strip take a tab from another window
   * on a platform that delivers the drop here (see `tabAdoptHere`).
   */
  onDropTab: (key: string, toIndex: number, transfer: TabTransfer | null) => void
  /** Describes a tab for the drag payload, so another window can take it whole. */
  transferFor?: (key: string) => TabTransfer
  /** Keys currently in the sidebar's Pinned section, so the menu offers the right verb. */
  pinnedKeys: Set<string>
  onTogglePin: (key: string) => void
  /** Forks the session behind a tab into a new one, opened beside it. */
  onFork: (key: string) => void
  /**
   * A drag that ended with nothing in this window taking it, at a point in screen coordinates.
   * What that meant — another window, or a window of its own — is the main process's to decide.
   */
  onTabDropped: (key: string, at: { x: number; y: number }) => void
  /** Tears a tab off into a window of its own, at a point in screen coordinates. */
  onDetach: (key: string, at: { x: number; y: number }) => void
  /** The window's layout button, shown beside the split button on the top-right pane only. */
  layoutButton?: ReactNode
}

/**
 * One column's strip of open sessions. Which sessions are open and which is active is the column
 * model's business (see state/columns.ts); the strip owns only the gestures on top of it — dragging
 * a tab to a new position, and the right-click menu.
 *
 * The close button is a sibling of the tab button rather than nested inside it: a <button> cannot
 * contain another interactive element, the same constraint the sidebar rows work around.
 */
export function SessionTabBar(
  {
    columnId, tabs, activeKey, onActivate, onClose, onSplitActive, onDropTab, transferFor, pinnedKeys,
    onTogglePin, onFork, onTabDropped, onDetach, layoutButton,
  }: Props,
): JSX.Element {
  /**
   * The tab being dragged, and where it would land: an index into the strip *without* the dragged
   * tab, so 0 means "first". Tracking the insertion point rather than the tab being hovered is what
   * makes the ends reachable — dropping on the left half of the first tab means before it, which is
   * otherwise a position no drop target corresponds to.
   */
  const [dragKey, setDragKey] = useState<string | null>(null)
  const [dropAt, setDropAt] = useState<number | null>(null)
  const { place, requestPicker } = useLayoutActions()

  /** Where a drop on this tab would insert, given which half of it the pointer is over. */
  const insertionFor = (e: { currentTarget: HTMLElement; clientX: number }, index: number): number => {
    const rect = e.currentTarget.getBoundingClientRect()
    const after = e.clientX > rect.left + rect.width / 2
    const from = tabs.findIndex((t) => t.key === dragKey)
    // Index within the list the dragged tab has been lifted out of.
    const base = from !== -1 && from < index ? index - 1 : index
    return after ? base + 1 : base
  }
  const [menu, setMenu] = useState<{ key: string; x: number; y: number } | null>(null)

  /**
   * Keeps the active tab in view.
   *
   * With enough tabs open the strip scrolls, and the tab you just switched to can be the one off
   * the end of it — visible as a sliver with its close button beyond the edge. Scrolling it into
   * view means the tab being worked in is always whole, whatever is open beside it.
   */
  const activeRef = useRef<HTMLDivElement | null>(null)
  useEffect(() => {
    activeRef.current?.scrollIntoView({ block: 'nearest', inline: 'nearest' })
  }, [activeKey, tabs.length])

  const endDrag = (): void => { setDragKey(null); setDropAt(null) }

  return (
    <div className="session-tab-bar" data-testid="session-tab-bar" role="tablist">
      <div
        className="session-tab-strip"
        // The strip's own empty space is a target too, so a tab can be dropped onto a column that
        // has none of its own yet — and dropping past the end means "last", rather than nothing.
        onDragOver={(e) => {
          if (!e.dataTransfer.types.includes(TAB_MIME)) return
          e.preventDefault()
          e.dataTransfer.dropEffect = 'move'
        }}
        onDrop={(e) => {
          const key = e.dataTransfer.getData(TAB_MIME)
          if (key === '') return
          e.preventDefault()
          onDropTab(key, tabs.length, readTransfer(e.dataTransfer))
          endDrag()
        }}
      >
      {tabs.map((tab, index) => (
        <div
          key={tab.key}
          ref={tab.key === activeKey ? activeRef : null}
          className="session-tab"
          data-testid="session-tab"
          data-active={tab.key === activeKey}
          data-dragging={tab.key === dragKey}
          data-drop-before={dragKey !== null && dropAt === indexInRest(tabs, dragKey, index)}
          data-drop-after={
            dragKey !== null
            && index === tabs.length - 1
            && dropAt === indexInRest(tabs, dragKey, index) + 1
          }
          draggable
          onDragStart={(e) => {
            setDragKey(tab.key)
            e.dataTransfer.effectAllowed = 'move'
            // A typed payload, so a strip can tell a tab being dragged from anywhere in the window
            // apart from a folder, a pinned row or a plain text selection. `text/plain` is kept
            // beside it because Firefox refuses to start a drag with no standard payload at all.
            e.dataTransfer.setData(TAB_MIME, tab.key)
            e.dataTransfer.setData('text/plain', tab.key)
            if (transferFor !== undefined) e.dataTransfer.setData(TRANSFER_MIME, JSON.stringify(transferFor(tab.key)))
          }}
          onDragOver={(e) => {
            // Keyed off the payload type rather than off `dragKey`, which is set only in the strip
            // the drag started in: a tab dragged from another column would otherwise find no
            // target here at all, because without `preventDefault` no drop ever fires.
            if (!e.dataTransfer.types.includes(TAB_MIME)) return
            e.preventDefault()
            e.dataTransfer.dropEffect = 'move'
            setDropAt(insertionFor(e, index))
          }}
          onDrop={(e) => {
            const key = e.dataTransfer.getData(TAB_MIME)
            if (key === '') return
            e.preventDefault()
            // The strip behind this tab is a drop target of its own (for the empty space past the
            // last tab); without this the drop would count twice and the second, coarser one would
            // win, sending every tab to the end.
            e.stopPropagation()
            onDropTab(key, insertionFor(e, index), readTransfer(e.dataTransfer))
            endDrag()
          }}
          onDragEnd={(e) => {
            // Nothing in this window took the tab. Where it went is decided in the main process
            // from where the pointer was released — another of our windows, or the desktop — and
            // that is the only way it *can* be decided: an HTML5 drag started here delivers no
            // drop event to another window at all, so there is nothing on the receiving side to
            // ask. Releasing over this same window resolves to "nothing happened".
            if (e.dataTransfer.dropEffect === 'none' && !tab.isPending) {
              onTabDropped(tab.key, { x: e.screenX, y: e.screenY })
            }
            endDrag()
          }}
          onContextMenu={(e) => {
            e.preventDefault()
            setMenu({ key: tab.key, x: e.clientX, y: e.clientY })
          }}
        >
          <button
            className="session-tab-label"
            data-testid="session-tab-label"
            role="tab"
            aria-selected={tab.key === activeKey}
            title={tab.label}
            onClick={() => onActivate(tab.key)}
          >
            {tab.isPending && <span className="live-dot" aria-label="running" />}
            <span className="session-tab-text">{tab.label}</span>
          </button>
          <LayoutMenuButton
            className="session-tab-layout"
            testId="session-tab-layout"
            title="Arrange"
            ariaLabel={`Arrange ${tab.label}`}
            heading={`Move “${tab.label}” here`}
            onPick={(preset, zone) => { place({ kind: 'tab', key: tab.key, paneId: columnId }, preset, zone) }}
          >
            <LayoutIcon />
          </LayoutMenuButton>
          <button
            className="session-tab-close"
            data-testid="session-tab-close"
            title="Close session"
            aria-label="Close session"
            onClick={() => onClose(tab.key)}
          >
            <CloseIcon />
          </button>
        </div>
      ))}
      </div>

      {/* Pinned to the right of the strip, where VS Code keeps its own split action — reaching a
       *  session that is already open in this column shouldn't mean going back to the sidebar to
       *  find its row again just to use the split button there. */}
      {layoutButton}

      {activeKey !== null && (
        <LayoutMenuButton
          className="session-tab-split"
          testId="session-tab-split"
          title="Split this session into a new pane — rest here for layouts"
          ariaLabel="Split this session into a new pane"
          heading="Move the session in front here"
          onClick={onSplitActive}
          onPick={(preset, zone) => {
            if (activeKey !== null) place({ kind: 'tab', key: activeKey, paneId: columnId }, preset, zone)
          }}
        >
          <SplitIcon />
        </LayoutMenuButton>
      )}

      <ContextMenu
        testId="tab-menu"
        position={menu === null ? null : { x: menu.x, y: menu.y }}
        onClose={() => setMenu(null)}
        items={menu === null ? [] : [
          {
            id: 'fork',
            label: 'Fork session',
            // A session that has not written its JSONL yet has no id to fork from — Claude mints
            // that when it first saves, and `--resume` needs one.
            disabled: tabs.find((t) => t.key === menu.key)?.isPending ?? false,
            disabledReason: 'Available once the session has started — send it a message first',
            run: () => onFork(menu.key),
          },
          {
            id: 'detach',
            label: 'Move into New Window',
            // Same reason as forking: the new window opens a *session*, and a tab that has not
            // written its JSONL yet has no session id to open — detaching one would leave an
            // empty window and take the tab out of this one on the way.
            disabled: tabs.find((t) => t.key === menu.key)?.isPending ?? false,
            disabledReason: 'Available once the session has started — send it a message first',
            run: () => onDetach(menu.key, { x: menu.x, y: menu.y }),
          },
          {
            id: 'arrange',
            label: 'Arrange…',
            run: () => { requestPicker({ kind: 'tab', key: menu.key, paneId: columnId }, { x: menu.x, y: menu.y }) },
          },
          {
            id: 'pin',
            separator: true,
            label: pinnedKeys.has(menu.key) ? 'Unpin from sidebar' : 'Pin to sidebar',
            run: () => onTogglePin(menu.key),
          },
          { id: 'close', label: 'Close', separator: true, run: () => onClose(menu.key) },
        ]}
      />
    </div>
  )
}
