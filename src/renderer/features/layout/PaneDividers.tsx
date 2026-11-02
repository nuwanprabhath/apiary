import { type JSX, type RefObject, useRef } from 'react'
import { useResizeDrag } from '../../ui/useResizeDrag'
import {
  presetDef, dragTracks, boundaryAt, type PresetId, type Tracks, type DividerDef,
} from '../../state/layout'

/** A pane's floor (`.session-column`'s min-width): no divider drag goes below it, and the window
 *  is widened rather than run a pane off its edge (`useWindowFitsPanes`). */
export const MIN_PANE_WIDTH = 280
const MIN_PANE_HEIGHT = 180

/** How far an arrow key moves a divider. */
const KEYBOARD_STEP_PX = 16

interface Props {
  preset: PresetId
  tracks: Tracks
  onChange: (next: Tracks) => void
  /** Grid columns whose row divider is hidden because a pane in them is folded. */
  hiddenCols: Set<number>
  /** Grid columns that are a rail's width (`railColumns`): no divider beside them drags. */
  railCols: Set<number>
}

/** `d` without the columns in `hidden` (a row divider), or null when none are left. */
function visiblePart(d: DividerDef, hidden: Set<number>): DividerDef | null {
  if (d.axis === 'col') return d
  const cols = Array.from({ length: d.span[1] - d.span[0] }, (_, i) => d.span[0] + i).filter((c) => !hidden.has(c))
  return cols.length === 0 ? null : { ...d, span: [cols[0], cols[cols.length - 1] + 1] }
}

/**
 * Where the columns sit when some are rails: the rails are a fixed width and the open columns share
 * the rest by weight. Dividers are placed and dragged in the open columns' own frame.
 */
interface ColFrame {
  open: number[]
  railsBefore: (c: number) => number
  rails: number
  /** The left edge of grid column `c` (`c` = the column count is the right edge), as a CSS length. */
  edge: (c: number) => string
}

function colFrame(cols: number[], rails: Set<number>): ColFrame {
  const open = cols.map((_, c) => c).filter((c) => !rails.has(c))
  const total = open.reduce((a, c) => a + cols[c], 0)
  const railsBefore = (c: number): number => [...rails].filter((r) => r < c).length
  const edge = (c: number): string => {
    const f = open.filter((o) => o < c).reduce((a, o) => a + cols[o], 0) / total
    const k = railsBefore(c) - f * rails.size
    return `calc(${String(f * 100)}% + ${String(k)} * var(--pane-rail-width))`
  }
  return { open, railsBefore, rails: rails.size, edge }
}

/**
 * The draggable boundaries of the current layout, laid over the grid.
 *
 * Overlaid, not grid tracks: a track would need every preset's template to interleave them, and
 * `main-right2`'s horizontal divider exists on one side only.
 */
export function PaneDividers({ preset, tracks, onChange, hiddenCols, railCols }: Props): JSX.Element {
  const ref = useRef<HTMLDivElement | null>(null)
  const pct = (n: number): string => `${String(n * 100)}%`
  const frame = colFrame(tracks.cols, railCols)
  const besideRail = (d: DividerDef): boolean => d.axis === 'col' && (railCols.has(d.index) || railCols.has(d.index + 1))
  return (
    <div ref={ref} className="pane-dividers">
      {presetDef(preset).dividers.flatMap((full) => visiblePart(full, hiddenCols) ?? []).filter((d) => !besideRail(d)).map((d) => {
        const style = d.axis === 'col'
          ? {
            left: frame.edge(d.index + 1),
            top: d.span[0] === 0 ? '0%' : pct(boundaryAt(tracks.rows, d.span[0] - 1)),
            height: pct(boundaryAt(tracks.rows, d.span[1] - 1) - (d.span[0] === 0 ? 0 : boundaryAt(tracks.rows, d.span[0] - 1))),
          }
          : {
            top: pct(boundaryAt(tracks.rows, d.index)),
            left: frame.edge(d.span[0]),
            width: `calc(${frame.edge(d.span[1])} - ${frame.edge(d.span[0])})`,
          }
        return (
          <Divider
            key={`${d.axis}-${String(d.index)}`}
            def={d}
            tracks={tracks}
            frame={frame}
            onChange={onChange}
            hostRef={ref}
            style={style}
          />
        )
      })}
    </div>
  )
}

/** The px width of one rail, read from the token the grid template uses. */
function railPx(host: HTMLElement | null): number {
  if (host === null) return 0
  return parseFloat(getComputedStyle(host).getPropertyValue('--pane-rail-width')) || 0
}

/**
 * One boundary: a separator you drag or step with the arrow keys. Both go through
 * `useResizeDrag`, in percent of the open area so `aria-valuenow` reads 0–100; `dragTracks` clamps to
 * the minimum pane size whichever way the value arrives, so Home/End land on the nearest pane
 * minimum rather than off the grid. A column divider works on the open columns only.
 */
function Divider({ def: d, tracks, frame, onChange, hostRef, style }: {
  def: DividerDef
  tracks: Tracks
  frame: ColFrame
  onChange: (next: Tracks) => void
  hostRef: RefObject<HTMLDivElement | null>
  style: React.CSSProperties
}): JSX.Element {
  const latest = useRef({ tracks, onChange, frame })
  latest.current = { tracks, onChange, frame }
  const col = d.axis === 'col'
  const index = col ? frame.open.indexOf(d.index) : d.index
  const alongOf = (t: Tracks, f: ColFrame): number[] => (col ? f.open.map((c) => t.cols[c]) : t.rows)
  /** The open area along the axis: its start and size in client px. */
  const area = (): { start: number; size: number } => {
    const rect = hostRef.current?.parentElement?.getBoundingClientRect()
    if (rect === undefined) return { start: 0, size: 1 }
    if (!col) return { start: rect.top, size: rect.height }
    const rail = railPx(hostRef.current)
    const f = latest.current.frame
    return { start: rect.left + f.railsBefore(d.index) * rail, size: Math.max(1, rect.width - f.rails * rail) }
  }
  const apply = (percent: number): void => {
    const { tracks: now, onChange: emit, frame: f } = latest.current
    const along = alongOf(now, f)
    const next = dragTracks(along, index, percent / 100, (col ? MIN_PANE_WIDTH : MIN_PANE_HEIGHT) / area().size)
    if (next.length === along.length && next.every((n, i) => n === along[i])) return
    if (!col) { emit({ ...now, rows: next }); return }
    const cols = [...now.cols]
    f.open.forEach((c, i) => { cols[c] = next[i] })
    emit({ ...now, cols })
  }
  const { separatorProps } = useResizeDrag({
    axis: d.axis,
    value: Math.round(boundaryAt(alongOf(tracks, frame), index) * 100),
    min: 0,
    max: 100,
    initial: () => boundaryAt(alongOf(latest.current.tracks, latest.current.frame), index) * 100,
    measure: (e) => {
      const { start, size } = area()
      return (((col ? e.clientX : e.clientY) - start) / size) * 100
    },
    step: () => (KEYBOARD_STEP_PX / area().size) * 100,
    onLive: apply,
    onEnd: apply,
  })
  return (
    <div
      className={col ? 'column-resizer' : 'row-resizer'}
      data-testid={col ? 'column-resizer' : 'row-resizer'}
      style={style}
      {...separatorProps}
    />
  )
}
