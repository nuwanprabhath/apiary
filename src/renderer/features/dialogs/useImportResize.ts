import { type DragStart, useResizeDrag } from '../../ui/useResizeDrag'

const MIN_DIALOG_WIDTH = 420
const MAX_DIALOG_WIDTH = 1500

/**
 * Dragging either edge widens the dialog. The dialog is centred, so a drag has to move the width
 * by twice the pointer's travel for the edge under the cursor to actually keep up with it —
 * otherwise the edge slides away at half speed and the drag feels broken.
 *
 * The live width goes onto the document as a CSS custom property the dialog's own `width` reads,
 * and the persisted `ui` setting hears about it once, on release — not once per mouse move.
 */
export function useImportResize(width: number, onWidthChange: (next: number) => void) {
  const edgeDrag = (side: 1 | -1) => ({
    axis: 'col' as const,
    value: width,
    min: MIN_DIALOG_WIDTH,
    max: MAX_DIALOG_WIDTH,
    measure: (e: { clientX: number }, start: DragStart) =>
      Math.round(Math.max(MIN_DIALOG_WIDTH, Math.min(MAX_DIALOG_WIDTH, start.value + (e.clientX - start.x) * 2 * side))),
    onLive: (w: number) => { document.documentElement.style.setProperty('--drag-import-width', `${String(w)}px`) },
    onEnd: (w: number) => {
      document.documentElement.style.removeProperty('--drag-import-width')
      onWidthChange(w)
    },
  })
  return { leftEdge: useResizeDrag(edgeDrag(-1)), rightEdge: useResizeDrag(edgeDrag(1)) }
}
