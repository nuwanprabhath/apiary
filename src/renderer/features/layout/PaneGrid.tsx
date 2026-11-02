import { type JSX, type ReactNode, useCallback, useRef, useState } from 'react'
import { defaultTracks, trackTemplate, type PresetId, type Tracks } from '../../state/layout'
import { PaneDividers } from './PaneDividers'
import { foldedCols, foldedTemplate, railColumns, railedCols } from './foldedGrid'
import { useWindowFitsPanes } from './useWindowFitsPanes'

/**
 * The `<main>` the panes sit in, and the divider positions that shape it. Those positions live
 * here, per preset and for as long as the window is open, rather than in App: dragging a divider
 * re-renders this grid and its dividers and nothing above it. `folded` is, per zone, whether its
 * pane is folded to its tab bar (`foldedTemplate`); `rails`, whether it is collapsed sideways to a
 * rail (`railColumns`).
 */
export function PaneGrid({ preset, folded, rails, children }: {
  preset: PresetId
  folded: boolean[]
  rails: boolean[]
  children: ReactNode
}): JSX.Element {
  const [tracks, setTracks] = useState<Map<PresetId, Tracks>>(() => new Map())
  const current = tracks.get(preset) ?? defaultTracks(preset)
  const onChange = useCallback((next: Tracks) => {
    setTracks((prev) => new Map(prev).set(preset, next))
  }, [preset])
  const fold = foldedTemplate(preset, folded, current.rows)
  const railCols = railedCols(preset, rails)
  const content = useRef<HTMLElement | null>(null)
  useWindowFitsPanes(content, current.cols.length - railCols.size, railCols.size)
  return (
    <main
      ref={content}
      className="content"
      data-testid="content"
      data-preset={preset}
      style={{
        gridTemplateColumns: railColumns(preset, rails, current.cols) ?? trackTemplate(current.cols),
        gridTemplateRows: fold?.rows ?? trackTemplate(current.rows),
        gridTemplateAreas: fold?.areas,
      }}
    >
      {children}
      <PaneDividers preset={preset} tracks={current} onChange={onChange} hiddenCols={foldedCols(preset, folded)} railCols={railCols} />
    </main>
  )
}
