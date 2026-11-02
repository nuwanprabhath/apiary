import type { Column } from './columns'
import { capacity, presetDef, zoneCols, zoneRows, type PresetId } from './layoutPresets'

/** The part of a `Layout` (layout.ts) a rail depends on; structural so this file needs nothing of layout.ts. */
interface Panes { preset: PresetId; panes: Column[] }

/**
 * Whether a pane can collapse sideways to a rail. `none`: it does not span every row or has no pane
 * beside it (a two-row stack folds vertically instead, `foldState`). `last`: it is the last open
 * pane of a row it is in, so collapsing it is refused.
 */
export type RailState = 'none' | 'open' | 'last' | 'rail'

function canRail(preset: PresetId, zone: number): boolean {
  const def = presetDef(preset)
  return zone < capacity(preset) && zoneRows(def, zone).length === def.rows && zoneCols(def, zone).length < def.cols
}

/** Each row's zones; a row with every zone railed would leave nothing to look at. */
function rowsOf(preset: PresetId): number[][] {
  const def = presetDef(preset)
  return Array.from({ length: def.rows }, (_, r) =>
    Array.from({ length: capacity(preset) }, (_z, z) => z).filter((z) => zoneRows(def, z).includes(r)))
}

const allRailed = (row: number[], railed: (z: number) => boolean): boolean => row.every(railed)

export function railState(layout: Panes, index: number): RailState {
  const pane = layout.panes[index] as Column | undefined
  if (pane === undefined || !canRail(layout.preset, index)) return 'none'
  if (pane.rail === true) return 'rail'
  const after = (z: number): boolean => z === index || layout.panes[z]?.rail === true
  return rowsOf(layout.preset).some((row) => allRailed(row, after)) ? 'last' : 'open'
}

/** Collapses a pane to a rail or expands it, where its `railState` allows; otherwise the layout unchanged. */
export function setRail<L extends Panes>(layout: L, paneId: string | null, rail: boolean): L {
  const index = layout.panes.findIndex((p) => p.id === paneId)
  if (index === -1 || railState(layout, index) !== (rail ? 'open' : 'rail')) return layout
  return { ...layout, panes: layout.panes.map((p, i) => (i === index ? { ...p, rail } : p)) }
}

/** Drops a rail the layout can no longer hold: a pane that cannot rail, or a row left with none open. */
export function validRails<L extends Panes>(layout: L): L {
  const keep = layout.panes.map((p, i) => p.rail === true && canRail(layout.preset, i))
  for (const row of rowsOf(layout.preset)) {
    if (row.length > 0 && allRailed(row, (z) => keep[z])) keep[Math.max(...row)] = false
  }
  if (layout.panes.every((p, i) => (p.rail === true) === keep[i])) return layout
  return { ...layout, panes: layout.panes.map((p, i) => (p.rail === true && !keep[i] ? { ...p, rail: false } : p)) }
}
