import { type JSX, type ReactNode, useCallback, useRef, useState } from 'react'
import { defaultTracks, trackTemplate, type PresetId, type Tracks } from '../../state/layout'
import { PaneDividers } from './PaneDividers'
import { foldedCols, foldedTemplate } from './foldedGrid'
import { useWindowFitsPanes } from './useWindowFitsPanes'

/**
 * The `<main>` the panes sit in, and the divider positions that shape it. Those positions live
 * here, per preset and for as long as the window is open, rather than in App: dragging a divider
 * re-renders this grid and its dividers and nothing above it. `folded` is, per zone, whether its
 * pane is folded to its tab bar (`foldedTemplate`).
 */
export function PaneGrid({ preset, folded, children }: {
  preset: PresetId
  folded: boolean[]
  children: ReactNode
}): JSX.Element {
  const [tracks, setTracks] = useState<Map<PresetId, Tracks>>(() => new Map())
  const current = tracks.get(preset) ?? defaultTracks(preset)
  const onChange = useCallback((next: Tracks) => {
    setTracks((prev) => new Map(prev).set(preset, next))
  }, [preset])
  const fold = foldedTemplate(preset, folded, current.rows)
  const content = useRef<HTMLElement | null>(null)
  useWindowFitsPanes(content, current.cols.length)
  return (
    <main
      ref={content}
      className="content"
      data-testid="content"
      data-preset={preset}
      style={{
        gridTemplateColumns: trackTemplate(current.cols),
        gridTemplateRows: fold?.rows ?? trackTemplate(current.rows),
        gridTemplateAreas: fold?.areas,
      }}
    >
      {children}
      <PaneDividers preset={preset} tracks={current} onChange={onChange} hiddenCols={foldedCols(preset, folded)} />
    </main>
  )
}
