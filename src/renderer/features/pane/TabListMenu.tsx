import { type DragEvent, type JSX, type KeyboardEvent, useEffect, useMemo, useRef, useState } from 'react'
import { ListIcon } from '../../ui/icons'
import { Popover } from '../../ui/Popover'
import { focusAskedFor } from '../../ui/focusUnlessTyping'
import { nextIndex } from '../../ui/useRovingList'
import { useEscape } from '../../ui/useEscape'
import { useOutsideDismiss } from '../../ui/useOutsideDismiss'
import type { SessionTabView } from './paneTypes'

/** More tabs than this and the menu gets a filter field. */
const FILTER_ABOVE = 8
/** A menu row's own drag payload: a row dropped on another pane's strip must do nothing. */
const ROW_MIME = 'application/x-apiary-tab-list-row'

interface Props {
  columnId: string
  tabs: SessionTabView[]
  activeKey: string | null
  onActivate: (key: string) => void
  /** The strip's reorder: `toIndex` is the tab's place in the list once it is lifted out. */
  onMove: (key: string, toIndex: number) => void
}

function StatusMark({ tab }: { tab: SessionTabView }): JSX.Element {
  if (tab.activity === 'running') return <span className="session-tab-ring" role="img" aria-label="running" />
  const status = tab.activity === 'waiting' ? 'waiting' : 'idle'
  return <span className="status-dot" data-status={status} role="img" aria-label={status === 'waiting' ? 'waiting for you' : 'idle'} />
}

/** Where the menu's rows would drop a tab dragged from `from` into gap `gap` (0..n), as `onMove` wants it. */
function landingIndex(from: number, gap: number): number {
  return gap > from ? gap - 1 : gap
}

/**
 * The "All tabs" button at the end of the strip and the menu it opens: every tab of this pane, to
 * jump to one or to reorder them. Reordering goes through the strip's own action (`onMove`).
 */
export function TabListButton(p: Props): JSX.Element | null {
  const [open, setOpen] = useState(false)
  const buttonRef = useRef<HTMLButtonElement>(null)
  if (p.tabs.length < 2) return null
  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        className="session-tab-scroll"
        data-testid="session-tab-list"
        aria-label="All tabs"
        aria-haspopup="dialog"
        aria-expanded={open}
        title="All tabs"
        onClick={() => setOpen((o) => !o)}
      >
        <ListIcon />
      </button>
      {open && (
        <TabListMenu {...p} anchor={buttonRef} onClose={(refocus) => {
          setOpen(false)
          if (refocus) buttonRef.current?.focus()
        }} />
      )}
    </>
  )
}

interface RowProps {
  tab: SessionTabView
  highlighted: boolean
  active: boolean
  dragging: boolean
  dropBefore: boolean
  dropAfter: boolean
  draggable: boolean
  onChoose: (key: string) => void
  onHighlight: (key: string) => void
  onDragStart: () => void
  onDragOver: (e: DragEvent<HTMLElement>) => void
  onDrop: (e: DragEvent<HTMLElement>) => void
  onDragEnd: () => void
}

function TabListRow(p: RowProps): JSX.Element {
  const { tab } = p
  return (
    <button
      type="button"
      tabIndex={-1}
      className="tab-list-row"
      data-testid="tab-list-row"
      data-highlighted={p.highlighted}
      data-dragging={p.dragging}
      data-drop-before={p.dropBefore}
      data-drop-after={p.dropAfter}
      aria-current={p.active ? 'true' : undefined}
      draggable={p.draggable}
      title={tab.label}
      onClick={() => p.onChoose(tab.key)}
      onMouseMove={() => p.onHighlight(tab.key)}
      onDragStart={(e) => {
        e.dataTransfer.effectAllowed = 'move'
        e.dataTransfer.setData(ROW_MIME, tab.key)
        p.onDragStart()
      }}
      onDragOver={p.onDragOver}
      onDrop={p.onDrop}
      onDragEnd={p.onDragEnd}
    >
      <span className="tab-list-mark"><StatusMark tab={tab} /></span>
      <span className="tab-list-title" data-testid="tab-list-title">{tab.label}</span>
      {tab.hint !== undefined && <span className="tab-list-hint">{tab.hint}</span>}
    </button>
  )
}

function TabListMenu(
  { columnId, tabs, activeKey, onActivate, onMove, anchor, onClose }:
  Props & { anchor: React.RefObject<HTMLButtonElement | null>; onClose: (refocus: boolean) => void },
): JSX.Element {
  const root = useRef<HTMLDivElement>(null)
  const [query, setQuery] = useState('')
  const [highlighted, setHighlighted] = useState<string | null>(activeKey)
  const [drag, setDrag] = useState<{ key: string; gap: number | null } | null>(null)
  const rect = anchor.current?.getBoundingClientRect()
  const filtering = query.trim() !== ''
  const showFilter = tabs.length > FILTER_ABOVE

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase()
    return q === '' ? tabs : tabs.filter((t) => t.label.toLowerCase().includes(q) || (t.hint ?? '').toLowerCase().includes(q))
  }, [tabs, query])
  const current = visible.some((t) => t.key === highlighted) ? highlighted : visible[0]?.key ?? null

  useEscape(() => { onClose(true) })
  useOutsideDismiss(() => { onClose(false) }, { inside: [root, anchor] })
  useEffect(() => {
    root.current?.querySelector('[data-highlighted="true"]')?.scrollIntoView({ block: 'nearest' })
  }, [current])

  const choose = (key: string): void => {
    onActivate(key)
    onClose(false)
    // The strip's own effect scrolls the tab into view; focus follows once it has rendered.
    requestAnimationFrame(() => { document.getElementById(`session-tab-${columnId}-${key}`)?.focus() })
  }

  const onKeyDown = (e: KeyboardEvent): void => {
    if (e.key === 'Enter' && current !== null) {
      e.preventDefault()
      choose(current)
      return
    }
    const at = visible.findIndex((t) => t.key === current)
    if (e.altKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
      e.preventDefault()
      const to = at + (e.key === 'ArrowUp' ? -1 : 1)
      if (!filtering && current !== null && to >= 0 && to < tabs.length) onMove(current, to)
      return
    }
    const target = nextIndex(e.key, at, visible.length, false)
    if (target === null) return
    e.preventDefault()
    setHighlighted(visible[target].key)
  }

  const gapFor = (e: DragEvent<HTMLElement>, index: number): number => {
    const r = e.currentTarget.getBoundingClientRect()
    return e.clientY > r.top + r.height / 2 ? index + 1 : index
  }
  const dropFrom = tabs.findIndex((t) => t.key === drag?.key)
  const gap = drag?.gap ?? null

  return (
    <Popover
      label="All tabs"
      testId="tab-list-menu"
      restoreFocus={false}
      ref={root}
      className="tab-list-menu"
      style={{ top: (rect?.bottom ?? 0) + 4, right: window.innerWidth - (rect?.right ?? 0) }}
      onKeyDown={onKeyDown}
      tabIndex={-1}
    >
      {showFilter && (
        <input
          ref={focusAskedFor}
          className="search tab-list-filter"
          data-testid="tab-list-filter"
          type="text"
          aria-label="Filter tabs"
          placeholder="Filter tabs"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      )}
      <div className="tab-list-rows" tabIndex={-1} ref={showFilter ? undefined : focusAskedFor}>
        {visible.length === 0 && <p className="tab-list-empty" data-testid="tab-list-empty">No tabs match</p>}
        {visible.map((tab, index) => (
          <TabListRow
            key={tab.key}
            tab={tab}
            highlighted={tab.key === current}
            active={tab.key === activeKey}
            dragging={drag?.key === tab.key}
            dropBefore={gap === index && dropFrom !== index && dropFrom !== index - 1}
            dropAfter={index === visible.length - 1 && gap === index + 1 && dropFrom !== index}
            draggable={!filtering}
            onChoose={choose}
            onHighlight={setHighlighted}
            onDragStart={() => setDrag({ key: tab.key, gap: null })}
            onDragOver={(e) => {
              if (drag === null || !e.dataTransfer.types.includes(ROW_MIME)) return
              e.preventDefault()
              e.dataTransfer.dropEffect = 'move'
              setDrag({ key: drag.key, gap: gapFor(e, index) })
            }}
            onDrop={(e) => {
              if (drag === null || !e.dataTransfer.types.includes(ROW_MIME)) return
              e.preventDefault()
              const to = landingIndex(dropFrom, gapFor(e, index))
              if (to !== dropFrom) onMove(drag.key, to)
              setHighlighted(drag.key)
              setDrag(null)
            }}
            onDragEnd={() => setDrag(null)}
          />
        ))}
      </div>
    </Popover>
  )
}
