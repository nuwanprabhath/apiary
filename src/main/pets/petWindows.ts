import { BrowserWindow, screen } from 'electron'
import type { PetPlacementDeps, PetWindow } from './petPlacement'

/** What `petWindowing` needs of `WindowManager`. */
interface Numbering {
  windowNumberFor: (webContentsId: number) => number | null
  isRemote: (webContentsId: number) => boolean
}

/** Every open, numbered window as `PetPlacement` sees it. Read fresh on each call: windows come and go. */
function petWindows(numbering: Numbering): () => PetWindow[] {
  return () => BrowserWindow.getAllWindows().flatMap((w) => {
    const number = w.isDestroyed() ? null : numbering.windowNumberFor(w.webContents.id)
    if (number === null) return []
    return [{
      number, webContentsId: w.webContents.id, remote: numbering.isRemote(w.webContents.id), visible: w.isVisible(),
      bounds: w.getBounds(), content: w.getContentBounds(), focus: () => { w.focus() },
    }]
  })
}

/**
 * The Electron side of `PetPlacement`: the open windows, which was focused last (`TabMover`'s
 * order, `pickWindowAt`'s stand-in for z-order) and the pointer. The cursor is main's own reading
 * at the drop, never the renderer's.
 */
export function petWindowing(
  numbering: Numbering, tabMover: { recentFirst: () => readonly number[] },
): Pick<PetPlacementDeps, 'windows' | 'focusOrder' | 'cursor'> {
  return { windows: petWindows(numbering), focusOrder: () => tabMover.recentFirst(), cursor: () => screen.getCursorScreenPoint() }
}
