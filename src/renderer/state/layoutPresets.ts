/**
 * The layout presets: each a fixed grid of zones `z1`…`z4` in fill order, so which pane is "number
 * three" is a table lookup (see layout.ts).
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

export function zoneCols(def: PresetDef, zone: number): number[] {
  const name = `z${String(zone + 1)}`
  return [...new Set(def.areas.flatMap((row) => row.split(/\s+/).flatMap((n, c) => (n === name ? [c] : []))))]
}

export function zoneRows(def: PresetDef, zone: number): number[] {
  const name = `z${String(zone + 1)}`
  return def.areas.flatMap((row, r) => (row.split(/\s+/).includes(name) ? [r] : []))
}
