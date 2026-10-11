import { ErrorBoundary } from '../../ui/ErrorBoundary'
import { RemoteView } from './RemoteView'

/** The feature's mount point. It wraps itself, so a crash inside shows in place and the window stays up. */
export function RemoteRoot(): React.JSX.Element {
  return (
    <ErrorBoundary label="Remote">
      <RemoteView />
    </ErrorBoundary>
  )
}
