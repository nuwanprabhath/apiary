import { ErrorBoundary } from '../../ui/ErrorBoundary'
import { ResidentPopupHost } from './ResidentPopup'
import { useResidentShortcuts } from './useResidentShortcuts'

/**
 * The window's resident chat popup and its ⌘⇧Space shortcut. It wraps itself, so a crash inside
 * shows in place and the window stays up.
 */
export function ResidentsRoot({ onOpenSettings }: { onOpenSettings: (section: string) => void }): React.JSX.Element {
  return (
    <ErrorBoundary label="The resident chat" compact>
      <ResidentShortcuts onOpenSettings={onOpenSettings} />
      <ResidentPopupHost onOpenSettings={onOpenSettings} />
    </ErrorBoundary>
  )
}

/**
 * Its own component so that the statuses it reads (pushed on every change of activity) re-render
 * only this, never the window around it.
 */
function ResidentShortcuts({ onOpenSettings }: { onOpenSettings: (section: string) => void }): null {
  useResidentShortcuts(onOpenSettings)
  return null
}
