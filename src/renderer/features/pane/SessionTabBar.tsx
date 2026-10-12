import { type JSX, useState, type ReactNode } from 'react'
import { LayoutIcon, SplitIcon } from '../../ui/icons'
import { TabContextMenu } from './TabContextMenu'
import { useTabStripKeys } from './useTabStripKeys'
import { LayoutMenuButton, useLayoutActions, useLayoutState } from '../layout'
import type { TabTransfer } from '@shared/types'
import { SessionTab } from './SessionTab'
import type { SessionTabView } from './paneTypes'
import { PANE_MIME, TAB_MIME, indexInRest, insertionIndex, readTransfer } from './tabDrag'


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
  /** The Chat | Terminal toggle for the active session, right of the strip. */
  viewToggle?: ReactNode
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
    onTogglePin, onFork, onTabDropped, onDetach, layoutButton, viewToggle,
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
  const { place, requestPicker, startPaneMove, endPaneMove } = useLayoutActions()
  const { paneCount } = useLayoutState()

  /** Where a drop on this tab would insert, given which half of it the pointer is over. */
  const insertionFor = (e: { currentTarget: HTMLElement; clientX: number }, index: number): number =>
    insertionIndex(e, tabs, dragKey, index)
  const [menu, setMenu] = useState<{ key: string; x: number; y: number } | null>(null)

  const endDrag = (): void => { setDragKey(null); setDropAt(null) }
  const { activeRef, registerButton, onTabListKeyDown } = useTabStripKeys(tabs, activeKey, onActivate, onClose)


  return (
    <div className="session-tab-bar" data-testid="session-tab-bar">
      <div
        className="session-tab-strip"
        data-testid="session-tab-strip"
        role="tablist"
        aria-orientation="horizontal"
        onKeyDown={onTabListKeyDown}
        // The strip's empty space moves the whole pane onto another, as VS Code's does for an
        // editor group. The tabs are draggable themselves and win inside their own bounds, but
        // their dragstart bubbles here, hence the target checks.
        draggable={paneCount > 1}
        onDragStart={(e) => {
          if (e.target !== e.currentTarget) return
          e.dataTransfer.effectAllowed = 'move'
          e.dataTransfer.setData(PANE_MIME, columnId)
          startPaneMove(columnId)
        }}
        onDragEnd={(e) => { if (e.target === e.currentTarget) endPaneMove() }}
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
        <SessionTab
          key={tab.key}
          tab={tab}
          columnId={columnId}
          isActive={tab.key === activeKey}
          isDragging={tab.key === dragKey}
          dropBefore={dragKey !== null && dropAt === indexInRest(tabs, dragKey, index)}
          dropAfter={
            dragKey !== null
            && index === tabs.length - 1
            && dropAt === indexInRest(tabs, dragKey, index) + 1
          }
          insertionFor={(e) => insertionFor(e, index)}
          activeRef={activeRef}
          registerButton={registerButton}
          transferFor={transferFor}
          onDragStartTab={setDragKey}
          onDragOverAt={setDropAt}
          onDropTab={onDropTab}
          onEndDrag={endDrag}
          onActivate={onActivate}
          onClose={onClose}
          onTabDropped={onTabDropped}
          onOpenMenu={(key, at) => setMenu({ key, ...at })}
          arrangeButton={(
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
          )}
        />
      ))}
      </div>

      {viewToggle}

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

      <TabContextMenu
        menu={menu}
        onArrange={(key, at) => { requestPicker({ kind: 'tab', key, paneId: columnId }, at) }}
        isPending={(key) => tabs.find((t) => t.key === key)?.isPending ?? false}
        pinnedKeys={pinnedKeys}
        onClose={onClose}
        onTogglePin={onTogglePin}
        onFork={onFork}
        onDetach={onDetach}
        onDismiss={() => setMenu(null)}
      />
    </div>
  )
}
