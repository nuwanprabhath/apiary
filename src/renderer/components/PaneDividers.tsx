import { useEffect, useRef, useState } from 'react'
import {
  presetDef, dragTracks, boundaryAt, type PresetId, type Tracks, type DividerDef,
} from '../state/layout'

/** Below these a pane shows nothing usable: the toolbar and a few terminal rows, or a readable
 *  column. The same floor the column dividers had. */
const MIN_PANE_WIDTH = 220
const MIN_PANE_HEIGHT = 180

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
    if (host == null) return
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

  const pct = (n: number): string => `${String(n * 100)}%`
  return (
    <div ref={ref} className="pane-dividers" aria-hidden="true">
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
            onMouseDown={(e) => { e.preventDefault(); setDragging(d) }}
          />
        )
      })}
    </div>
  )
}
