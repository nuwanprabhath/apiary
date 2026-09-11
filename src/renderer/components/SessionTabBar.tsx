import { useState } from 'react'
import { CloseIcon, SplitIcon } from './icons'
import { ContextMenu } from './ContextMenu'

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
  tabs: SessionTabView[]
  activeKey: string | null
  onActivate: (key: string) => void
  onClose: (key: string) => void
  /** Splits the active tab into a column of its own, the way VS Code's editor-title split does. */
  onSplitActive: () => void
  /** Moves a tab to `toIndex` within this column's strip, after a drag. */
  onReorder: (key: string, toIndex: number) => void
  /** Keys currently in the sidebar's Pinned section, so the menu offers the right verb. */
  pinnedKeys: Set<string>
  onTogglePin: (key: string) => void
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
  { tabs, activeKey, onActivate, onClose, onSplitActive, onReorder, pinnedKeys, onTogglePin }: Props,
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

  const endDrag = (): void => { setDragKey(null); setDropAt(null) }

  return (
    <div className="session-tab-bar" data-testid="session-tab-bar" role="tablist">
      <div className="session-tab-strip">
      {tabs.map((tab, index) => (
        <div
          key={tab.key}
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
            // Firefox refuses to start a drag without payload; the key is also what we read back.
            e.dataTransfer.setData('text/plain', tab.key)
          }}
          onDragOver={(e) => {
            if (dragKey === null) return
            e.preventDefault() // Without this the drop never fires.
            e.dataTransfer.dropEffect = 'move'
            setDropAt(insertionFor(e, index))
          }}
          onDrop={(e) => {
            e.preventDefault()
            const key = dragKey ?? e.dataTransfer.getData('text/plain')
            if (key !== '') onReorder(key, insertionFor(e, index))
            endDrag()
          }}
          onDragEnd={endDrag}
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
            id: 'pin',
            label: pinnedKeys.has(menu.key) ? 'Unpin from sidebar' : 'Pin to sidebar',
            run: () => onTogglePin(menu.key),
          },
          { id: 'close', label: 'Close', separator: true, run: () => onClose(menu.key) },
        ]}
      />
    </div>
  )
}
