import type { JSX } from 'react'
import { DialogBoundary } from '../dialogs'
import { FolderBrowserDialog } from './FolderBrowserDialog'

/**
 * The folder browser for choosing a folder on the work machine (a resident's clone) rather than
 * starting a session there: "Use ‹folder›" hands the browse's id to `choose`, which stores the
 * folder on the work machine. A fault shows `DialogBoundary`'s closable dialog.
 */
export function ChooseFolderDialog(
  { host, choose, onClose }: { host: string; choose: (browseId: string) => Promise<void>; onClose: () => void },
): JSX.Element {
  return (
    <DialogBoundary onClose={onClose}>
      <FolderBrowserDialog host={host} verb="Use" choose={choose} onClose={onClose} />
    </DialogBoundary>
  )
}
