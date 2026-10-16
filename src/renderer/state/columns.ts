/**
 * The editor-group model behind the session tab bar and the split view.
 *
 * A **column** is one editor group, in the VS Code sense: it owns a strip of open session tabs,
 * knows which of them is active, and renders that session plus its own shell underneath. How
 * columns are arranged in the window — and that there are at most four — is layout.ts's business.
 *
 * A tab's `key` is the same identity the shell bookkeeping uses — a real session id, or a
 * still-pending new session's `new:<uuid>` pty id (see the `shellKey` comment in SessionColumn).
 * When a pending session finally resolves into a real one, `rekeyTab` swaps the key in place so
 * the tab keeps its position, its view mode, and its place in the active-tab pointer.
 */
import type { TabView } from '@shared/domain/tabs'

export interface OpenTab {
  key: string
  /** Transcript or live terminal, remembered per tab so switching tabs restores what you were on. */
  view: TabView
}

export interface Column {
  id: string
  tabs: OpenTab[]
  /** Null only while the column is empty, which is possible for the last remaining column. */
  activeKey: string | null
  /**
   * A pane made empty on purpose, as a zone of a layout waiting to be filled — as opposed to one
   * left empty because its last tab went away, which is closed. See `tidyLayout` in layout.ts.
   */
  placeholder?: boolean
  /** Folded down to its tab bar, its stack neighbour taking the space (`setFolded` in layout.ts). */
  collapsed?: boolean
}

let nextColumnId = 0
/** `id` defaults from a module-global counter that nothing resets; a test wanting stable ids passes its own. */
export function newColumn(tabs: OpenTab[] = [], id: string = `col-${String(++nextColumnId)}`): Column {
  return { id, tabs, activeKey: tabs[0]?.key ?? null }
}

export function findTab(column: Column, key: string): OpenTab | null {
  return column.tabs.find((t) => t.key === key) ?? null
}

/** The column already showing `key`, if any. */
export function findColumnWithTab(columns: Column[], key: string): Column | null {
  return columns.find((c) => findTab(c, key) !== null) ?? null
}

/** `toIndex` is taken against the list *without* the dragged tab: dropping on index 2 lands at 2 from either side. */
export function moveTab(column: Column, key: string, toIndex: number): Column {
  const from = column.tabs.findIndex((t) => t.key === key)
  if (from === -1) return column
  const rest = column.tabs.filter((t) => t.key !== key)
  const clamped = Math.max(0, Math.min(toIndex, rest.length))
  const tab = column.tabs[from]
  return { ...column, tabs: [...rest.slice(0, clamped), tab, ...rest.slice(clamped)] }
}

/** The tab keeps its view and becomes the target's active tab. Emptied columns are left to `tidyLayout`. */
export function moveTabToColumn(
  columns: Column[],
  key: string,
  toColumnId: string,
  toIndex: number,
): Column[] {
  const tab = columns.flatMap((c) => c.tabs).find((t) => t.key === key)
  const target = columns.find((c) => c.id === toColumnId)
  if (tab === undefined || target === undefined) return columns
  if (findTab(target, key) !== null) {
    return columns.map((c) => (c.id === toColumnId ? moveTab(c, key, toIndex) : c))
  }

  const clamped = Math.max(0, Math.min(toIndex, target.tabs.length))
  return columns.map((c) => {
    if (c.id === toColumnId) {
      return {
        ...c,
        tabs: [...c.tabs.slice(0, clamped), tab, ...c.tabs.slice(clamped)],
        activeKey: key,
      }
    }
    return findTab(c, key) === null ? c : closeTab(c, key)
  })
}

export function openTab(column: Column, key: string): Column {
  if (findTab(column, key) !== null) return { ...column, activeKey: key }
  return { ...column, tabs: [...column.tabs, { key, view: 'transcript' }], activeKey: key }
}

/** Adds `key` right after `afterKey` (a fork sits beside its source); appends when `afterKey` is not in this column. */
export function openTabAfter(column: Column, key: string, afterKey: string): Column {
  if (findTab(column, key) !== null) return { ...column, activeKey: key }
  const at = column.tabs.findIndex((t) => t.key === afterKey)
  if (at === -1) return openTab(column, key)
  const tab: OpenTab = { key, view: 'transcript' }
  return {
    ...column,
    tabs: [...column.tabs.slice(0, at + 1), tab, ...column.tabs.slice(at + 1)],
    activeKey: key,
  }
}

/** Puts a tab arriving from another window at `toIndex` of `toColumnId`; unlike `moveTabToColumn` there is nothing to lift. */
export function adoptTab(
  columns: Column[],
  key: string,
  toColumnId: string,
  toIndex: number,
  /** What the tab was showing where it came from — a running session arrives on its terminal. */
  view: OpenTab['view'] = 'transcript',
): Column[] {
  if (findColumnWithTab(columns, key) !== null) return columns
  return columns.map((c) => {
    if (c.id !== toColumnId) return c
    const clamped = Math.max(0, Math.min(toIndex, c.tabs.length))
    const tabs = [...c.tabs]
    tabs.splice(clamped, 0, { key, view })
    return { ...c, tabs, activeKey: key }
  })
}

/**
 * Removes a tab; the one to the right activates, else the one to the left. May return a column
 * with no tabs: the caller decides whether it is dropped.
 */
export function closeTab(column: Column, key: string): Column {
  const index = column.tabs.findIndex((t) => t.key === key)
  if (index === -1) return column
  const tabs = column.tabs.filter((t) => t.key !== key)
  if (column.activeKey !== key) return { ...column, tabs }
  const next = tabs[index] ?? tabs[index - 1] ?? null
  return { ...column, tabs, activeKey: next?.key ?? null }
}

export function setTabView(column: Column, key: string, view: OpenTab['view']): Column {
  return { ...column, tabs: column.tabs.map((t) => (t.key === key ? { ...t, view } : t)) }
}

export function rekeyTab(column: Column, from: string, to: string): Column {
  if (findTab(column, from) === null) return column
  return {
    ...column,
    tabs: column.tabs.map((t) => (t.key === from ? { ...t, key: to } : t)),
    activeKey: column.activeKey === from ? to : column.activeKey,
  }
}
