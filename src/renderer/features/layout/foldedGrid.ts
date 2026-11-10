import { boundaryAt, presetDef, trackTemplate, zoneCols, type PresetId } from '../../state/layout'

/** The folded-bar row: a pane's tab bar plus the half-gap it pads itself by on each side
 *  (`--pane-folded-height`, 30-panes.css). */
const BAR = 'var(--pane-folded-height)'

/**
 * The grid template while any pane is folded, or null when none is.
 *
 * A shared row track cannot shrink one column's pane without shrinking the pane across from it, so
 * a two-row preset is laid out on four rows instead: a folded-bar row at each edge and the two
 * shares between them, as percentages of the grid, so an open pane's edge lands exactly where the
 * row tracks put it before the fold. A folded pane spans only its edge row; its neighbour takes the
 * rest of the column. The row tracks themselves are untouched, so unfolding restores the sizes.
 */
export function foldedTemplate(
  preset: PresetId, folded: boolean[], rows: number[],
): { areas: string; rows: string } | null {
  const def = presetDef(preset)
  if (def.rows !== 2 || !folded.some(Boolean)) return null
  const [top, bottom] = def.areas.map((r) => r.split(/\s+/))
  if (top === undefined || bottom === undefined) return null
  const isFolded =(name: string): boolean => folded[Number(name.slice(1)) - 1] === true
  const line = (pick: (t: string, b: string) => string): string => `"${top.map((t, c) => pick(t, bottom[c] ?? '')).join(' ')}"`
  const areas = [
    line((t) => t),
    line((t, b) => (isFolded(t) ? b : t)),
    line((t, b) => (isFolded(b) ? t : b)),
    line((_t, b) => b),
  ].join(' ')
  const share = boundaryAt(rows, 0) * 100
  const pct = (n: number): string => `calc(${String(Number(n.toFixed(4)))}% - ${BAR})`
  return { areas, rows: `${BAR} ${pct(share)} ${pct(100 - share)} ${BAR}` }
}

/** A railed pane's width (`--pane-rail-width`, 34-pane-fold.css). */
const PANE_RAIL = 'var(--pane-rail-width)'

/** The grid columns holding a pane collapsed to a rail (`setRail`); a railed pane spans one column. */
export function railedCols(preset: PresetId, rails: boolean[]): Set<number> {
  const def = presetDef(preset)
  return new Set(rails.flatMap((r, z) => (r ? zoneCols(def, z) : [])))
}

/**
 * The column template while any pane is a rail, or null when none is: a railed column is the rail's
 * width and the others keep their `fr` weights, so they share the freed width in proportion. The
 * stored weights are not touched, so expanding restores the sizes exactly.
 */
export function railColumns(preset: PresetId, rails: boolean[], cols: number[]): string | null {
  const railed = railedCols(preset, rails)
  if (railed.size === 0) return null
  return cols.map((w, c) => (railed.has(c) ? PANE_RAIL : trackTemplate([w]))).join(' ')
}

/** The grid columns holding a folded pane: their row divider is hidden, as there is nothing to
 *  drag between a folded bar and its neighbour. */
export function foldedCols(preset: PresetId, folded: boolean[]): Set<number> {
  const def = presetDef(preset)
  return new Set(folded.flatMap((f, z) => (f ? zoneCols(def, z) : [])))
}
