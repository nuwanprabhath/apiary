/**
 * The editor-group model behind the session tab bar and the split view.
 *
 * A **column** is one editor group, in the VS Code sense: it owns a strip of open session tabs,
 * knows which of them is active, and renders that session plus its own shell underneath. Splitting
 * appends another column beside the first, so several sessions can be worked on at once; there is
 * no cap on how many.
 *
 * A tab's `key` is the same identity the shell bookkeeping uses — a real session id, or a
 * still-pending new session's `new:<uuid>` pty id (see the `shellKey` comment in SessionColumn).
 * When a pending session finally resolves into a real one, `rekeyTab` swaps the key in place so
 * the tab keeps its position, its view mode, and its place in the active-tab pointer.
 */

export interface OpenTab {
  key: string
  /** Transcript or live terminal, remembered per tab so switching tabs restores what you were on. */
  view: 'transcript' | 'terminal'
}

export interface Column {
  id: string
  tabs: OpenTab[]
  /** Null only while the column is empty, which is possible for the last remaining column. */
  activeKey: string | null
}

let nextColumnId = 0
export function newColumn(tabs: OpenTab[] = []): Column {
  nextColumnId += 1
  return { id: `col-${String(nextColumnId)}`, tabs, activeKey: tabs[0]?.key ?? null }
}

export function findTab(column: Column, key: string): OpenTab | null {
  return column.tabs.find((t) => t.key === key) ?? null
}

/** Adds `key` to the column if it isn't already there, and makes it active either way. */
export function openTab(column: Column, key: string): Column {
  if (findTab(column, key) !== null) return { ...column, activeKey: key }
  return { ...column, tabs: [...column.tabs, { key, view: 'transcript' }], activeKey: key }
}

/**
 * Removes a tab. The next tab to activate is the one to the right, falling back to the one to the
 * left when the closed tab was last — the behaviour every tabbed editor has trained people to
 * expect. Returns a column with no tabs (rather than null) so the caller decides whether an empty
 * column is dropped or kept as the last one standing.
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

/** Swaps a pending tab's pty-id key for the real session id it resolved into. */
export function rekeyTab(column: Column, from: string, to: string): Column {
  if (findTab(column, from) === null) return column
  return {
    ...column,
    tabs: column.tabs.map((t) => (t.key === from ? { ...t, key: to } : t)),
    activeKey: column.activeKey === from ? to : column.activeKey,
  }
}
