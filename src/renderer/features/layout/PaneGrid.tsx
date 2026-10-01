import { type JSX, type ReactNode, useCallback, useState } from 'react'
import { defaultTracks, trackTemplate, type PresetId, type Tracks } from './layout'
import { PaneDividers } from './PaneDividers'

/**
 * The `<main>` the panes sit in, and the divider positions that shape it. Those positions live
 * here, per preset and for as long as the window is open, rather than in App: dragging a divider
 * re-renders this grid and its dividers and nothing above it.
 */
export function PaneGrid({ preset, children }: { preset: PresetId; children: ReactNode }): JSX.Element {
  const [tracks, setTracks] = useState<Map<PresetId, Tracks>>(() => new Map())
  const current = tracks.get(preset) ?? defaultTracks(preset)
  const onChange = useCallback((next: Tracks) => {
    setTracks((prev) => new Map(prev).set(preset, next))
  }, [preset])
  return (
    <main
      className="content"
      data-testid="content"
      data-preset={preset}
      style={{
        gridTemplateColumns: trackTemplate(current.cols),
        gridTemplateRows: trackTemplate(current.rows),
      }}
    >
      {children}
      <PaneDividers preset={preset} tracks={current} onChange={onChange} />
    </main>
  )
}
