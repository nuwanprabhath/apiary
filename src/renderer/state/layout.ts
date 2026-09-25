import { newColumn, findTab, closeTab, type Column, type OpenTab } from './columns'

/**
 * How a window's panes are arranged.
 *
 * A fixed set of presets rather than a general split tree, on purpose: the eight shapes are what
 * the picker offers (macOS's "Move & Resize"/"Fill & Arrange" and VS Code's editor layouts), and
 * with only those shapes every rule — which pane is "number three", what closing one turns into —
 * is a table lookup rather than a tree operation. A pane is a `Column`, unchanged: its own tab
 * strip, its own active tab, and its own terminals for that tab.
 */

export type PresetId =
  | 'single' | 'halves-h' | 'halves-v' | 'thirds-h'
  | 'main-right2' | 'left2-main' | 'top-bottom2' | 'grid'

/** A draggable boundary: between track `index` and `index + 1` along `axis`, spanning the tracks
 *  `span[0]` (inclusive) to `span[1]` (exclusive) of the other axis. */
export interface DividerDef { axis: 'col' | 'row'; index: number; span: [number, number] }

export interface PresetDef {
  id: PresetId
  label: string
  cols: number
  rows: number
  /** `grid-template-areas` rows; zones are named `z1`…`z4` in fill order. */
  areas: string[]
  /** The zone at the window's top-right corner, which carries the window's layout button. */
  topRight: number
  dividers: DividerDef[]
}

export const PRESETS: PresetDef[] = [
  { id: 'single', label: 'Single', cols: 1, rows: 1, areas: ['z1'], topRight: 0, dividers: [] },
  {
    id: 'halves-h', label: 'Two columns', cols: 2, rows: 1, areas: ['z1 z2'], topRight: 1,
    dividers: [{ axis: 'col', index: 0, span: [0, 1] }],
  },
  {
    id: 'halves-v', label: 'Two rows', cols: 1, rows: 2, areas: ['z1', 'z2'], topRight: 0,
    dividers: [{ axis: 'row', index: 0, span: [0, 1] }],
  },
  {
    id: 'thirds-h', label: 'Three columns', cols: 3, rows: 1, areas: ['z1 z2 z3'], topRight: 2,
    dividers: [{ axis: 'col', index: 0, span: [0, 1] }, { axis: 'col', index: 1, span: [0, 1] }],
  },
  {
    id: 'main-right2', label: 'Main and two on the right', cols: 2, rows: 2, areas: ['z1 z2', 'z1 z3'], topRight: 1,
    dividers: [{ axis: 'col', index: 0, span: [0, 2] }, { axis: 'row', index: 0, span: [1, 2] }],
  },
  {
    id: 'left2-main', label: 'Two on the left and main', cols: 2, rows: 2, areas: ['z1 z3', 'z2 z3'], topRight: 2,
    dividers: [{ axis: 'col', index: 0, span: [0, 2] }, { axis: 'row', index: 0, span: [0, 1] }],
  },
  {
    id: 'top-bottom2', label: 'Top and two below', cols: 2, rows: 2, areas: ['z1 z1', 'z2 z3'], topRight: 0,
    dividers: [{ axis: 'row', index: 0, span: [0, 2] }, { axis: 'col', index: 0, span: [1, 2] }],
  },
  {
    id: 'grid', label: 'Grid', cols: 2, rows: 2, areas: ['z1 z2', 'z3 z4'], topRight: 1,
    dividers: [{ axis: 'col', index: 0, span: [0, 2] }, { axis: 'row', index: 0, span: [0, 2] }],
  },
]

export function presetDef(id: PresetId): PresetDef {
  const def = PRESETS.find((p) => p.id === id)
  if (def === undefined) throw new Error(`Unknown layout: ${id}`)
  return def
}

export function capacity(id: PresetId): number {
  return new Set(presetDef(id).areas.join(' ').split(/\s+/)).size
}

export interface Layout {
  preset: PresetId
  panes: Column[]
}

export function initialLayout(): Layout {
  return { preset: 'single', panes: [newColumn()] }
}

const waiting = (): Column => ({ ...newColumn(), placeholder: true })

/** `target` with `source`'s tabs appended after its own; what `target` shows is unchanged. */
function mergeInto(target: Column, source: Column): Column {
  const extra = source.tabs.filter((t) => findTab(target, t.key) === null)
  return {
    ...target,
    tabs: [...target.tabs, ...extra],
    activeKey: target.activeKey ?? extra[0]?.key ?? null,
    placeholder: false,
  }
}

/**
 * Lays `panes` into `slots` zones in order: the first ones one per zone, and the tabs of any that
 * do not fit folded into the last zone's pane — nothing is closed by choosing a smaller layout.
 * Zones left over wait to be filled — with `spare` placeholders, by order, before a fresh one is
 * minted for any that are still left. Reusing them is what keeps a focused, mid-search placeholder
 * pane (see PaneFiller) from remounting — and losing its search text and its active-pane status —
 * every time the layout reflows around it.
 */
function fill(slots: (Column | null)[], panes: Column[], spare: Column[] = []): Column[] {
  const out = [...slots]
  const queue = [...panes]
  for (let i = 0; i < out.length && queue.length > 0; i++) {
    if (out[i] === null) out[i] = queue.shift() ?? null
  }
  const last = out.length - 1
  for (const surplus of queue) {
    const into = out[last]
    out[last] = into === null ? surplus : mergeInto(into, surplus)
  }
  const spareQueue = [...spare]
  return out.map((p) => p ?? spareQueue.shift() ?? waiting())
}

export function applyPreset(layout: Layout, preset: PresetId): Layout {
  const occupied = layout.panes.filter((p) => p.tabs.length > 0)
  const spare = layout.panes.filter((p) => p.tabs.length === 0 && p.placeholder === true)
  if (occupied.length === 0 && preset === 'single') return { preset, panes: [newColumn()] }
  const slots: (Column | null)[] = Array.from({ length: capacity(preset) }, () => null)
  return { preset, panes: fill(slots, occupied, spare) }
}

/**
 * Puts the tab `key` into `zone` of `preset`, moving it if it is open anywhere in the window.
 *
 * A tab that was the only one in its pane takes that pane with it, so the pane (and the terminal
 * views inside it) is carried rather than rebuilt. Otherwise the tab is lifted out of its pane,
 * keeping its view, and the pane it leaves stays where the fill puts it. A pane the move leaves
 * empty is dropped before filling, so it cannot occupy a zone as a blank.
 *
 * `fromPaneId`, when given, picks which pane is the source. A key can be open in more than one
 * pane at once (split), and without it the first pane holding the key would always be treated as
 * the source regardless of which one the caller actually meant — moving the wrong pane, focusing
 * the wrong one, and leaving the other copy of the key behind unnoticed.
 */
export function placeInZone(
  layout: Layout,
  preset: PresetId,
  zone: number,
  key: string,
  fromPaneId?: string,
): { layout: Layout; paneId: string } {
  const cap = capacity(preset)
  const at = Math.max(0, Math.min(zone, cap - 1))
  const source = (fromPaneId !== undefined
    ? layout.panes.find((p) => p.id === fromPaneId && findTab(p, key) !== null)
    : layout.panes.find((p) => findTab(p, key) !== null)) ?? null

  let moved: Column
  let rest: Column[]
  if (source !== null && source.tabs.length === 1) {
    moved = { ...source, activeKey: key, placeholder: false }
    rest = layout.panes.filter((p) => p.id !== source.id)
  } else {
    const tab: OpenTab = (source === null ? null : findTab(source, key)) ?? { key, view: 'transcript' }
    moved = newColumn([tab])
    rest = layout.panes.map((p) => (p === source ? closeTab(p, key) : p))
  }
  const spare = rest.filter((p) => p.tabs.length === 0 && p.placeholder === true)
  rest = rest.filter((p) => p.tabs.length > 0)

  const slots: (Column | null)[] = Array.from({ length: cap }, (_, i) => (i === at ? moved : null))
  const panes = fill(slots, rest, spare)
  // `moved` occupies its own zone directly (fill only ever touches the null slots), so the pane it
  // ends up as — even folded into by a merge, which keeps the target's id — is found by identity,
  // not by searching for the key: a duplicate left in another pane must never be mistaken for it.
  const placed = panes.find((p) => p.id === moved.id)
  // The placed tab is what the user just chose, so it is in front even where the fill merged
  // other tabs into its pane.
  const final = panes.map((p) => (p === placed ? { ...p, activeKey: key } : p))
  return { layout: { preset, panes: final }, paneId: placed?.id ?? moved.id }
}

const DOWN: Record<PresetId, PresetId> = {
  grid: 'main-right2',
  'main-right2': 'halves-h',
  'left2-main': 'halves-h',
  'thirds-h': 'halves-h',
  'top-bottom2': 'halves-v',
  'halves-h': 'single',
  'halves-v': 'single',
  single: 'single',
}

// Row-first layouts grow as rows, so a window someone stacked top-to-bottom stays that way.
const UP: Record<PresetId, PresetId> = {
  single: 'halves-h',
  'halves-h': 'main-right2',
  'halves-v': 'top-bottom2',
  'main-right2': 'grid',
  'left2-main': 'grid',
  'thirds-h': 'grid',
  'top-bottom2': 'grid',
  grid: 'grid',
}

export function stepDown(id: PresetId): PresetId { return DOWN[id] }
export function stepUp(id: PresetId): PresetId { return UP[id] }

/**
 * Removes a pane and steps the layout down.
 *
 * The pane being worked in goes first, into zone 1 — the large zone, where the smaller layout has
 * one — because it is the one someone is looking at. Every other pane keeps its relative order.
 */
export function closePane(layout: Layout, paneId: string, activePaneId: string | null): Layout {
  const rest = layout.panes.filter((p) => p.id !== paneId)
  if (rest.length === 0) return { preset: 'single', panes: [newColumn()] }
  const active = rest.find((p) => p.id === activePaneId)
  const ordered = active === undefined ? rest : [active, ...rest.filter((p) => p !== active)]
  let preset = DOWN[layout.preset]
  while (capacity(preset) < ordered.length) preset = UP[preset]
  // A waiting zone is not a pane anyone needs kept in place, but its id is worth keeping if the
  // reflow still has a leftover zone for it — see `fill`.
  const occupied = ordered.filter((p) => p.tabs.length > 0)
  const spare = ordered.filter((p) => p.tabs.length === 0 && p.placeholder === true)
  const slots: (Column | null)[] = Array.from({ length: capacity(preset) }, () => null)
  const panes = fill(slots, occupied, spare)
  if (preset === 'single' && panes[0].tabs.length === 0) return { preset, panes: [{ ...panes[0], placeholder: false }] }
  return { preset, panes }
}

/**
 * Trades the places of two panes, for dragging one pane onto another.
 *
 * A swap rather than an insert: the zones of a preset are fixed, so moving one pane into another's
 * zone has to put that pane somewhere, and the only place that disturbs nothing else is the zone
 * just vacated. Both panes travel whole — tabs, active tab and terminals — and the layout and its
 * sizes stay as they were.
 */
export function swapPanes(layout: Layout, fromId: string, toId: string): Layout {
  const from = layout.panes.findIndex((p) => p.id === fromId)
  const to = layout.panes.findIndex((p) => p.id === toId)
  if (from === -1 || to === -1 || from === to) return layout
  const panes = [...layout.panes]
  ;[panes[from], panes[to]] = [panes[to], panes[from]]
  return { ...layout, panes }
}

/**
 * The one rule every change to a window's panes goes through, the way `pruneColumns` was before.
 *
 * A pane that has become empty is closed — unless it was made empty on purpose, as a zone waiting
 * to be filled. A waiting pane that has received a tab stops waiting. A layout holding more panes
 * than it has zones (something appended one) grows until it fits. A window always has a pane.
 * Returns the input unchanged when there was nothing to do, so React can skip the render.
 */
export function tidyLayout(layout: Layout, activePaneId: string | null): Layout {
  let next = layout
  const filled = next.panes.some((p) => p.placeholder === true && p.tabs.length > 0)
  if (filled) {
    next = { ...next, panes: next.panes.map((p) => (p.placeholder === true && p.tabs.length > 0 ? { ...p, placeholder: false } : p)) }
  }
  for (;;) {
    const emptied = next.panes.find((p) => p.tabs.length === 0 && p.placeholder !== true)
    if (emptied === undefined || next.panes.length === 1) break
    next = closePane(next, emptied.id, activePaneId)
  }
  if (next.preset === 'single' && next.panes.length === 1 && next.panes[0].placeholder === true) {
    next = { ...next, panes: [{ ...next.panes[0], placeholder: false }] }
  }
  if (next.panes.length > capacity(next.preset)) {
    let preset = next.preset
    while (capacity(preset) < next.panes.length && preset !== 'grid') preset = UP[preset]
    const slots: (Column | null)[] = Array.from({ length: capacity(preset) }, () => null)
    next = { preset, panes: fill(slots, next.panes) }
  }
  return next
}

/**
 * "Open to the side": a waiting zone if there is one, otherwise a new pane by growing the layout,
 * and once there are four, a tab in the pane after the active one — there is no fifth pane.
 *
 * Unlike `placeInZone` this does not move a tab that is already open; splitting a session to see
 * it twice is what the split button has always done.
 */
export function openBeside(
  layout: Layout,
  activePaneId: string | null,
  tab: OpenTab,
): { layout: Layout; paneId: string } {
  const waitingPane = layout.panes.find((p) => p.placeholder === true && p.tabs.length === 0)
  if (waitingPane !== undefined) {
    const panes = layout.panes.map((p) => (p === waitingPane
      ? { ...p, tabs: [tab], activeKey: tab.key, placeholder: false }
      : p))
    return { layout: { ...layout, panes }, paneId: waitingPane.id }
  }
  if (layout.panes.length >= 4) {
    const at = Math.max(0, layout.panes.findIndex((p) => p.id === activePaneId))
    const target = layout.panes[(at + 1) % layout.panes.length]
    const panes = layout.panes.map((p) => {
      if (p !== target) return p
      const tabs = findTab(p, tab.key) === null ? [...p.tabs, tab] : p.tabs
      return { ...p, tabs, activeKey: tab.key }
    })
    return { layout: { ...layout, panes }, paneId: target.id }
  }
  let preset = layout.preset
  while (capacity(preset) <= layout.panes.length) preset = UP[preset]
  const added = newColumn([tab])
  const slots: (Column | null)[] = Array.from({ length: capacity(preset) }, () => null)
  const panes = fill(slots, [...layout.panes, added])
  return { layout: { preset, panes }, paneId: added.id }
}

/** Relative sizes of a preset's columns and rows, as `fr` weights. */
export interface Tracks { cols: number[]; rows: number[] }

export function defaultTracks(id: PresetId): Tracks {
  const def = presetDef(id)
  return { cols: Array.from({ length: def.cols }, () => 1), rows: Array.from({ length: def.rows }, () => 1) }
}

export function trackTemplate(tracks: number[]): string {
  return tracks.map((t) => `${String(Number(t.toFixed(4)))}fr`).join(' ')
}

export function boundaryAt(tracks: number[], index: number): number {
  const total = tracks.reduce((a, b) => a + b, 0)
  return tracks.slice(0, index + 1).reduce((a, b) => a + b, 0) / total
}

/**
 * Moves the boundary between track `index` and the next to `pointer`, both as fractions of the
 * axis. Only that pair changes, and its combined weight is kept — the same arithmetic the column
 * dividers used, which is what keeps repeated drags stable. `minShare` is the floor for either
 * side, as a fraction of the whole axis.
 */
export function dragTracks(tracks: number[], index: number, pointer: number, minShare: number): number[] {
  if (index < 0 || index + 1 >= tracks.length) return tracks
  const total = tracks.reduce((a, b) => a + b, 0)
  const start = tracks.slice(0, index).reduce((a, b) => a + b, 0) / total
  const pairWeight = tracks[index] + tracks[index + 1]
  const pair = pairWeight / total
  const floor = Math.min(minShare, pair / 2)
  const at = Math.max(start + floor, Math.min(start + pair - floor, pointer))
  const leftShare = (at - start) / pair
  const next = [...tracks]
  next[index] = pairWeight * leftShare
  next[index + 1] = pairWeight * (1 - leftShare)
  return next
}
