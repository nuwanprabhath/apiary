import { ErrorBoundary } from '../../ui/ErrorBoundary'
import { RemoteView } from './RemoteView'

/**
 * The feature's mount point. It wraps itself, so a crash inside shows in place and the window stays up.
 * `RemoteView` holds a bar and a dialog, each in its own boundary of the right shape; this one only
 * catches the view's own faults, and as a strip, because a crash pane would not fit the layout's flow.
 */
export function RemoteRoot(): React.JSX.Element {
  return (
    <ErrorBoundary label="Remote" compact>
      <RemoteView />
    </ErrorBoundary>
  )
}
