import { type JSX, useState } from 'react'
import { PANE_MIME } from './SessionTabBar'

interface Props {
  /** This pane's own id, so it can tell "something is being dragged" apart from "I am the thing
   *  being dragged" — a pane is never its own drop target. */
  columnId: string
  /** The pane currently being dragged by its tab bar, or null when nothing is (see `swapPanes`). */
  movingPane: string | null
  onDrop: (columnId: string) => void
}

/**
 * While another pane is dragged by its tab bar, this pane is where it can land — a layer over
 * everything rather than handlers on the column itself, so a terminal or a text box underneath
 * cannot take the drop for itself. Pulled out of SessionColumn.tsx (UI-21): its own drag-over
 * state is unrelated to anything else in that file.
 */
export function PaneDropOverlay({ columnId, movingPane, onDrop }: Props): JSX.Element | null {
  const [over, setOver] = useState(false)
  if (movingPane === null || movingPane === columnId) return null
  return (
    <div
      className="pane-drop"
      data-testid="pane-drop"
      data-over={over}
      onDragOver={(e) => {
        if (!e.dataTransfer.types.includes(PANE_MIME)) return
        e.preventDefault()
        e.dataTransfer.dropEffect = 'move'
        setOver(true)
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        if (!e.dataTransfer.types.includes(PANE_MIME)) return
        e.preventDefault()
        onDrop(columnId)
      }}
    >
      <span className="pane-drop-label">Swap here</span>
    </div>
  )
}
