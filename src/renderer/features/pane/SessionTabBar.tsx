import { type JSX, useEffect, useState, type ReactNode } from 'react'
import { LayoutIcon, SplitIcon } from '../../ui/icons'
import { ChevronIcon } from '../../ui/icons/ChevronIcon'
import type { FoldState } from '../../state/layout'
import { TabContextMenu } from './TabContextMenu'
import { useTabStripKeys } from './useTabStripKeys'
import { LayoutMenuButton, useLayoutActions, useLayoutState } from '../layout'
import type { TabTransfer } from '@shared/types'
import { SessionTab } from './SessionTab'
import type { SessionTabView } from './paneTypes'
import { PANE_MIME, TAB_MIME, indexInRest, insertionIndex, readTransfer } from './tabDrag'


interface Props {
  /** Carried on a place/arrange target so a key open in several panes is placed from the picked one. */
  columnId: string
  tabs: SessionTabView[]
  activeKey: string | null
  onActivate: (key: string) => void
  onClose: (key: string) => void
  /** Splits the active tab into a column of its own. */
  onSplitActive: () => void
  /**
   * A tab was dropped on this strip at `toIndex`; a reorder and a move from another column are the
   * same call. `transfer` is the whole tab as its own window described it, present when the drag
   * carried one, so a strip can take a tab from another window (see `tabAdoptHere`).
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
  /** Whether the pane can fold to this bar, or is folded; `none` shows no chevron. */
  fold?: FoldState
  onFold?: (folded: boolean) => void
}

/** The chevron at the start of the bar that folds a pane with a vertical neighbour down to it. */
function FoldButton({ fold, onFold }: { fold: FoldState; onFold?: (folded: boolean) => void }): JSX.Element | null {
  if (fold === 'none') return null
  const folded = fold === 'folded'
  const label = folded ? 'Unfold this pane' : 'Fold this pane'
  return (
    <button
      type="button"
      className="icon-button quiet pane-collapse"
      data-testid="pane-collapse"
      aria-expanded={!folded}
      aria-label={folded ? 'Unfold this pane' : 'Fold this pane'}
      title={label}
      onClick={() => onFold?.(!folded)}
    >
      <ChevronIcon expanded={!folded} />
    </button>
  )
}

/** One column's strip of open sessions; it owns only the drag gestures and the right-click menu. */
export function SessionTabBar(
  {
    columnId, tabs, activeKey, onActivate, onClose, onSplitActive, onDropTab, transferFor, pinnedKeys,
    onTogglePin, onFork, onTabDropped, onDetach, layoutButton, viewToggle, fold = 'none', onFold,
  }: Props,
): JSX.Element {
  // dropAt is an index into the strip without the dragged tab (0 = first). Tracking the insertion
  // point, not the hovered tab, is what makes the ends reachable.
  const [dragKey, setDragKey] = useState<string | null>(null)
  const [dropAt, setDropAt] = useState<number | null>(null)
  const { place, requestPicker, startPaneMove, endPaneMove } = useLayoutActions()
  const { paneCount } = useLayoutState()

  const insertionFor = (e: { currentTarget: HTMLElement; clientX: number }, index: number): number =>
    insertionIndex(e, tabs, dragKey, index)
  const [menu, setMenu] = useState<{ key: string; x: number; y: number } | null>(null)

  const endDrag = (): void => { setDragKey(null); setDropAt(null) }
  // A tab dropped into another column or window leaves this strip before its dragend fires (the
  // event goes to an element no longer in the page), so the drag must end here explicitly.
  const draggedAway = dragKey !== null && !tabs.some((t) => t.key === dragKey)
  useEffect(() => { if (draggedAway) endDrag() }, [draggedAway])
  const { activeRef, registerButton, onTabListKeyDown } = useTabStripKeys(tabs, activeKey, onActivate, onClose)


  return (
    <div className="session-tab-bar" data-testid="session-tab-bar">
      <FoldButton fold={fold} onFold={onFold} />
      <div
        className="session-tab-strip"
        data-testid="session-tab-strip"
        role="tablist"
        aria-orientation="horizontal"
        onKeyDown={onTabListKeyDown}
        // The strip's empty space moves the whole pane. Tabs are draggable themselves, but their
        // dragstart bubbles here, hence the target checks.
        draggable={paneCount > 1}
        onDragStart={(e) => {
          if (e.target !== e.currentTarget) return
          e.dataTransfer.effectAllowed = 'move'
          e.dataTransfer.setData(PANE_MIME, columnId)
          startPaneMove(columnId)
        }}
        onDragEnd={(e) => { if (e.target === e.currentTarget) endPaneMove() }}
        // Empty space is a target too: a column with no tabs can take one, and past the end means "last".
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
