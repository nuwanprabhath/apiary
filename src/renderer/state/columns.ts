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

/**
 * The column already showing `key`, if any.
 *
 * Clicking a session in the sidebar should go to where it already is rather than opening a second
 * copy of it: the same conversation in two columns is never what was meant, and the duplicate
 * shares the one underlying session, so it looks like a split that cannot be told apart.
 */
export function findColumnWithTab(columns: Column[], key: string): Column | null {
  return columns.find((c) => findTab(c, key) !== null) ?? null
}

/**
 * Moves a tab to `toIndex` within its column, for drag-to-reorder.
 *
 * The index is taken against the list *without* the dragged tab in it, which is what a drop
 * position means: dropping on the tab currently at index 2 should land at index 2 whichever side
 * the tab came from, rather than one place off when dragging rightwards.
 */
export function moveTab(column: Column, key: string, toIndex: number): Column {
  const from = column.tabs.findIndex((t) => t.key === key)
  if (from === -1) return column
  const rest = column.tabs.filter((t) => t.key !== key)
  const clamped = Math.max(0, Math.min(toIndex, rest.length))
  const tab = column.tabs[from]
  return { ...column, tabs: [...rest.slice(0, clamped), tab, ...rest.slice(clamped)] }
}

/**
 * Moves a tab into another column, at `toIndex` within that column's strip.
 *
 * Dragging a tab onto a *different* column's strip is the same gesture as reordering within one,
 * and every tabbed editor treats it as one: a tab bar that accepted a drop only from its own
 * column looked broken rather than restrained, because nothing about the drag says which strip the
 * tab started in. The tab keeps its view (transcript or terminal) so it arrives showing what it
 * was showing, and becomes the target column's active tab — it is what was just dropped there.
 *
 * Emptied columns are not pruned here: that is `pruneColumns`' single responsibility, applied to
 * every column update centrally.
 */
export function moveTabToColumn(
  columns: Column[],
  key: string,
  toColumnId: string,
  toIndex: number,
): Column[] {
  const tab = columns.flatMap((c) => c.tabs).find((t) => t.key === key)
  const target = columns.find((c) => c.id === toColumnId)
  if (tab === undefined || target === undefined) return columns
  // Already there: this is an ordinary reorder within the one column.
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

/**
 * The flex-grow values to lay the columns out with, from the weights the dividers have been
 * dragged to.
 *
 * Normalised so they always sum to the number of columns, which is what stops a stranded empty
 * strip appearing beside the last column. Weights are stored per column and a drag makes them
 * share a fixed total: drag the divider left and the pair might become 0.6 and 1.4. Close the
 * 1.4 one and the survivor is left growing by 0.6 — and since flex distributes only that
 * *fraction* of the free space when the growth factors add up to less than one, the column takes
 * 60% of the row and the remaining 40% stays empty background. That is the "empty side panel"
 * that comes back after splitting and closing.
 *
 * Normalising keeps the ratios the user dragged while guaranteeing the row is always filled.
 * Weights for columns that no longer exist are ignored rather than counted.
 */
export function layoutWeights(columns: Column[], weights: Map<string, number>): Map<string, number> {
  const present = columns.map((c) => ({ id: c.id, weight: Math.max(weights.get(c.id) ?? 1, 0.01) }))
  const total = present.reduce((sum, c) => sum + c.weight, 0)
  const out = new Map<string, number>()
  if (total <= 0) {
    for (const c of present) out.set(c.id, 1)
    return out
  }
  for (const c of present) out.set(c.id, (c.weight * present.length) / total)
  return out
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
