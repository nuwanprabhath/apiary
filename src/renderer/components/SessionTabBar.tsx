import { useEffect, useRef, useState } from 'react'
import { CloseIcon, SplitIcon } from './icons'
import { ContextMenu } from './ContextMenu'

/** The drag payload type for a session tab, shared by every strip in the window. */
const TAB_MIME = 'application/x-apiary-tab'

export interface SessionTabView {
  key: string
  label: string
  /** A session started from "+" that hasn't produced its JSONL yet, shown the way the sidebar
   *  shows it so the two agree while it resolves. */
  isPending: boolean
}

/**
 * Whether a point in screen coordinates is outside this window's frame.
 *
 * `outerWidth`/`outerHeight` include the frame, which is what `screenX`/`screenY` are measured
 * against — using the viewport's own width here would call the title bar "outside".
 */
function outsideThisWindow(x: number, y: number): boolean {
  return x < window.screenX
    || y < window.screenY
    || x > window.screenX + window.outerWidth
    || y > window.screenY + window.outerHeight
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
  onDropTab: (key: string, toIndex: number) => void
  /** Keys currently in the sidebar's Pinned section, so the menu offers the right verb. */
  pinnedKeys: Set<string>
  onTogglePin: (key: string) => void
  /** Forks the session behind a tab into a new one, opened beside it. */
  onFork: (key: string) => void
  /**
   * A tab dropped here that belongs to another window. Separate from `onDropTab` because the tab
   * is in no column of this window to be moved out of — it has to be adopted, and the window it
   * came from has to be told to let go.
   */
  onAdoptTab: (key: string, toIndex: number) => void
  /** Tears a tab off into a window of its own, at a point in screen coordinates. */
  onDetach: (key: string, at: { x: number; y: number }) => void
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
    tabs, activeKey, onActivate, onClose, onSplitActive, onDropTab, pinnedKeys,
    onTogglePin, onFork, onAdoptTab, onDetach,
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

  /**
   * The key of a tab being dragged from *another window*, once this strip has asked for it.
   *
   * Two Electron windows are two OS windows, and HTML5 drag data does not cross that boundary: a
   * drop arriving from the other window has an empty `dataTransfer` and no `TAB_MIME` in its
   * `types`, so without this the strip would refuse the drag before a drop could ever fire. The
   * main process holds the key for the length of the drag; this asks once, on first entry, and
   * remembers the answer until the drag is over.
   */
  const [foreignKey, setForeignKey] = useState<string | null>(null)
  const asking = useRef(false)

  /** Whether this drag is a session tab at all — from this window or from another one. */
  const isTabDrag = (e: React.DragEvent): boolean =>
    e.dataTransfer.types.includes(TAB_MIME) || foreignKey !== null

  /** Asks the main process what is being dragged, the first time a foreign drag comes over. */
  const noteForeignDrag = (e: React.DragEvent): void => {
    if (e.dataTransfer.types.includes(TAB_MIME) || foreignKey !== null || asking.current) return
    // Files and text get dragged over a window too; a null answer simply leaves this strip
    // refusing the drag, which is what it did before.
    asking.current = true
    void window.apiary.tabDragCurrent()
      .then(setForeignKey)
      .catch(() => { /* nothing to say: the drag is simply not one of ours */ })
      .finally(() => { asking.current = false })
  }

  /** The tab a drop is carrying, from this window's payload or from the main process. */
  const droppedKey = (e: React.DragEvent): { key: string; foreign: boolean } | null => {
    const own = e.dataTransfer.getData(TAB_MIME)
    if (own !== '') return { key: own, foreign: false }
    return foreignKey === null ? null : { key: foreignKey, foreign: true }
  }

  const endDrag = (): void => {
    setDragKey(null)
    setDropAt(null)
    setForeignKey(null)
  }

  return (
    <div className="session-tab-bar" data-testid="session-tab-bar" role="tablist">
      <div
        className="session-tab-strip"
        // The strip's own empty space is a target too, so a tab can be dropped onto a column that
        // has none of its own yet — and dropping past the end means "last", rather than nothing.
        onDragOver={(e) => {
          noteForeignDrag(e)
          if (!isTabDrag(e)) return
          e.preventDefault()
          e.dataTransfer.dropEffect = 'move'
        }}
        onDrop={(e) => {
          const dropped = droppedKey(e)
          if (dropped === null) return
          e.preventDefault()
          if (dropped.foreign) onAdoptTab(dropped.key, tabs.length)
          else onDropTab(dropped.key, tabs.length)
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
            // Parked in the main process for the length of the drag, so a strip in *another*
            // window can find out what is coming — see `foreignKey` above.
            window.apiary.tabDragStart(tab.key)
          }}
          onDragOver={(e) => {
            // Keyed off the payload type rather than off `dragKey`, which is set only in the strip
            // the drag started in: a tab dragged from another column would otherwise find no
            // target here at all, because without `preventDefault` no drop ever fires.
            noteForeignDrag(e)
            if (!isTabDrag(e)) return
            e.preventDefault()
            e.dataTransfer.dropEffect = 'move'
            setDropAt(insertionFor(e, index))
          }}
          onDrop={(e) => {
            const dropped = droppedKey(e)
            if (dropped === null) return
            e.preventDefault()
            // The strip behind this tab is a drop target of its own (for the empty space past the
            // last tab); without this the drop would count twice and the second, coarser one would
            // win, sending every tab to the end.
            e.stopPropagation()
            if (dropped.foreign) onAdoptTab(dropped.key, insertionFor(e, index))
            else onDropTab(dropped.key, insertionFor(e, index))
            endDrag()
          }}
          onDragEnd={(e) => {
            // A drag that ended with nothing having accepted it, *outside this window*, is the
            // gesture for tearing the tab off into one of its own. `dropEffect` is the only signal
            // that nothing took it — there is no "dropped on the desktop" event, only the absence
            // of a drop — but on its own it is not enough: releasing a tab over the transcript or
            // the sidebar reports 'none' too, and tearing a window off for that would be a
            // surprise. So the pointer has to have left the window as well.
            const torn = e.dataTransfer.dropEffect === 'none'
              && !tab.isPending
              && outsideThisWindow(e.screenX, e.screenY)
            if (torn) onDetach(tab.key, { x: e.screenX, y: e.screenY })
            else window.apiary.tabDragEnd()
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
      {activeKey !== null && (
        <button
          className="session-tab-split"
          data-testid="session-tab-split"
          title="Split this session into a new column"
          aria-label="Split this session into a new column"
          onClick={onSplitActive}
        >
          <SplitIcon />
        </button>
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
            run: () => onFork(menu.key),
          },
          {
            id: 'detach',
            label: 'Move into New Window',
            // Same reason as forking: the new window opens a *session*, and a tab that has not
            // written its JSONL yet has no session id to open — detaching one would leave an
            // empty window and take the tab out of this one on the way.
            disabled: tabs.find((t) => t.key === menu.key)?.isPending ?? false,
            run: () => onDetach(menu.key, { x: menu.x, y: menu.y }),
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
