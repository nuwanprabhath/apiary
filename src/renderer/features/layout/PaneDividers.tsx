import { type JSX, type RefObject, useRef } from 'react'
import { useResizeDrag } from '../../ui/useResizeDrag'
import {
  presetDef, dragTracks, boundaryAt, type PresetId, type Tracks, type DividerDef,
} from './layout'

/** Below these a pane shows nothing usable: the toolbar and a few terminal rows, or a readable
 *  column. The same floor the column dividers had. */
const MIN_PANE_WIDTH = 220
const MIN_PANE_HEIGHT = 180

/** How far an arrow key moves a divider (UI-27): pointer-only before this, with no keyboard
 *  alternative at all. */
const KEYBOARD_STEP_PX = 16

interface Props {
  preset: PresetId
  tracks: Tracks
  onChange: (next: Tracks) => void
}

/**
 * The draggable boundaries of the current layout, laid over the grid.
 *
 * Overlaid rather than taking a grid track of their own: a divider that is a track would need
 * every preset's template to interleave them, and `main-right2`'s horizontal divider exists on
 * one side only — as an overlay it is simply a shorter handle.
 */
export function PaneDividers({ preset, tracks, onChange }: Props): JSX.Element {
  const ref = useRef<HTMLDivElement | null>(null)
  const pct = (n: number): string => `${String(n * 100)}%`
  return (
    <div ref={ref} className="pane-dividers">
      {presetDef(preset).dividers.map((d) => {
        const along = d.axis === 'col' ? tracks.cols : tracks.rows
        const across = d.axis === 'col' ? tracks.rows : tracks.cols
        const at = boundaryAt(along, d.index)
        const from = d.span[0] === 0 ? 0 : boundaryAt(across, d.span[0] - 1)
        const to = boundaryAt(across, d.span[1] - 1)
        const style = d.axis === 'col'
          ? { left: pct(at), top: pct(from), height: pct(to - from) }
          : { top: pct(at), left: pct(from), width: pct(to - from) }
        return (
          <Divider
            key={`${d.axis}-${String(d.index)}`}
            def={d}
            tracks={tracks}
            onChange={onChange}
            hostRef={ref}
            style={style}
          />
        )
      })}
    </div>
  )
}

/**
 * One boundary: a separator you drag or step with the arrow keys (UI-27). Both go through
 * `useResizeDrag`, in percent of the grid so `aria-valuenow` reads 0–100; `dragTracks` clamps to
 * the minimum pane size whichever way the value arrives, so Home/End land on the nearest pane
 * minimum rather than off the grid.
 */
function Divider({ def: d, tracks, onChange, hostRef, style }: {
  def: DividerDef
  tracks: Tracks
  onChange: (next: Tracks) => void
  hostRef: RefObject<HTMLDivElement | null>
  style: React.CSSProperties
}): JSX.Element {
  const latest = useRef({ tracks, onChange })
  latest.current = { tracks, onChange }
  const col = d.axis === 'col'
  const size = (): number => {
    const rect = hostRef.current?.parentElement?.getBoundingClientRect()
    return (col ? rect?.width : rect?.height) ?? 1
  }
  /** Moves this boundary to `percent` of the grid, as far as the minimum pane size allows. */
  const apply = (percent: number): void => {
    const { tracks: now, onChange: emit } = latest.current
    const along = col ? now.cols : now.rows
    const next = dragTracks(along, d.index, percent / 100, (col ? MIN_PANE_WIDTH : MIN_PANE_HEIGHT) / size())
    if (next.length === along.length && next.every((n, i) => n === along[i])) return
    emit(col ? { ...now, cols: next } : { ...now, rows: next })
  }
  const along = col ? tracks.cols : tracks.rows
  const { separatorProps } = useResizeDrag({
    axis: d.axis,
    value: Math.round(boundaryAt(along, d.index) * 100),
    min: 0,
    max: 100,
    initial: () => boundaryAt(col ? latest.current.tracks.cols : latest.current.tracks.rows, d.index) * 100,
    measure: (e) => {
      const rect = hostRef.current?.parentElement?.getBoundingClientRect()
      if (rect === undefined) return 0
      return col ? ((e.clientX - rect.left) / rect.width) * 100 : ((e.clientY - rect.top) / rect.height) * 100
    },
    step: () => (KEYBOARD_STEP_PX / size()) * 100,
    // The panes follow the pointer as it moves, as they always have; the release only settles it.
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
