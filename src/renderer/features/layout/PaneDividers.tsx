import { type JSX, useEffect, useRef, useState } from 'react'
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
  const [dragging, setDragging] = useState<DividerDef | null>(null)
  const latest = useRef({ tracks, onChange })
  latest.current = { tracks, onChange }

  useEffect(() => {
    if (dragging === null) return
    const host = ref.current?.parentElement
    if (host === null || host === undefined) return
    const cursor = dragging.axis === 'col' ? 'resizing-col' : 'resizing-row'
    document.body.classList.add('resizing-active', cursor)
    const onMove = (e: MouseEvent): void => {
      const rect = host.getBoundingClientRect()
      const { tracks: now, onChange: emit } = latest.current
      if (dragging.axis === 'col') {
        const pointer = (e.clientX - rect.left) / rect.width
        emit({ ...now, cols: dragTracks(now.cols, dragging.index, pointer, MIN_PANE_WIDTH / rect.width) })
      } else {
        const pointer = (e.clientY - rect.top) / rect.height
        emit({ ...now, rows: dragTracks(now.rows, dragging.index, pointer, MIN_PANE_HEIGHT / rect.height) })
      }
    }
    const onUp = (): void => setDragging(null)
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
    return () => {
      document.body.classList.remove('resizing-active', cursor)
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
  }, [dragging])

  /**
   * The arrow-key alternative to dragging (UI-27): steps the boundary by `KEYBOARD_STEP_PX`,
   * converted to the same 0..1 fraction `dragTracks` already works in, and clamped by the same
   * minimum-pane-size floor a drag respects. Kept beside `onMove` above rather than sharing it
   * because a key event has no pointer position to convert — it moves the boundary by a step from
   * where it already is, not to an absolute point.
   */
  const onKeyDown = (d: DividerDef) => (e: React.KeyboardEvent): void => {
    const forward = d.axis === 'col' ? 'ArrowRight' : 'ArrowDown'
    const back = d.axis === 'col' ? 'ArrowLeft' : 'ArrowUp'
    if (e.key !== forward && e.key !== back) return
    e.preventDefault()
    const host = ref.current?.parentElement
    if (host === null || host === undefined) return
    const rect = host.getBoundingClientRect()
    const along = d.axis === 'col' ? tracks.cols : tracks.rows
    const size = d.axis === 'col' ? rect.width : rect.height
    const minFraction = (d.axis === 'col' ? MIN_PANE_WIDTH : MIN_PANE_HEIGHT) / size
    const current = boundaryAt(along, d.index)
    const delta = (e.key === forward ? 1 : -1) * (KEYBOARD_STEP_PX / size)
    const next = dragTracks(along, d.index, current + delta, minFraction)
    onChange(d.axis === 'col' ? { ...tracks, cols: next } : { ...tracks, rows: next })
  }

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
          <div
            key={`${d.axis}-${String(d.index)}`}
            className={d.axis === 'col' ? 'column-resizer' : 'row-resizer'}
            data-testid={d.axis === 'col' ? 'column-resizer' : 'row-resizer'}
            style={style}
            // UI-27: was `aria-hidden="true"` on the whole overlay, with no role, tabIndex or key
            // handling at all — a mouse-only resizer. `role="separator"` plus `aria-orientation`
            // and `aria-valuenow` is the pattern for a value a user can adjust that isn't a form
            // control; `tabIndex={0}` (not −1) is what actually lets Tab reach it, since nothing
            // else in the pane grid claims a stop there.
            role="separator"
            aria-orientation={d.axis === 'col' ? 'vertical' : 'horizontal'}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={Math.round(at * 100)}
            tabIndex={0}
            onMouseDown={(e) => { e.preventDefault(); setDragging(d) }}
            onKeyDown={onKeyDown(d)}
          />
        )
      })}
    </div>
  )
}
