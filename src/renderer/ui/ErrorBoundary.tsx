import { Component, type CSSProperties, type ErrorInfo, type ReactNode } from 'react'
import { describeError } from './errors'

interface Props {
  children: ReactNode
  /** Named in the fallback so the user can tell *what* failed, not just that something did. */
  label?: string
  /** Reported alongside the fallback, so the notification stack records it too. */
  onError?: (thrown: unknown, componentStack: string) => void
  /** Passed to the crash fallback, so it still lands in its pane's grid zone when its child throws
   *  before ever rendering the element that would otherwise carry that style. */
  style?: CSSProperties
  /** When this changes while the fallback is showing, the boundary tries its children again — so a
   *  pane that crashed on one session recovers on its own when the pane is pointed at another,
   *  without the user pressing "Try again". Unchanged while the children are fine. */
  resetKey?: unknown
  /** What to show instead of the crash pane. `null` shows nothing, for a purely decorative layer
   *  (the effects canvas, the pets) whose absence is no loss worth a pane; a function is handed the
   *  message and a retry, for a region that needs its own shape (a dialog must still be closable). */
  fallback?: ReactNode | ((fault: { message: string; retry: () => void }) => ReactNode)
  /** One line with a retry instead of the full pane, for a region that is a bar (title bar, update
   *  banner, status bar) and would be pushed out of shape by a pane. */
  compact?: boolean
}

interface State {
  message: string | null
  detail: string | null
}

/**
 * Stops a render-time exception from taking the window with it.
 *
 * React unmounts the whole tree when a render throws and nothing catches it — which is exactly
 * the blank window this exists to prevent. Anything thrown below here is caught, described, and
 * shown in place, with the stack behind a disclosure and a button to try again; the rest of the
 * app (the sidebar, the other columns) keeps working.
 *
 * Note what this does *not* cover, by React's design: event handlers, timers, and rejected
 * promises never pass through a boundary. Those are the notification provider's window-level
 * listeners' job — the two together are what make "no failure disappears silently" true.
 */
export class ErrorBoundary extends Component<Props, State> {
  override state: State = { message: null, detail: null }

  static getDerivedStateFromError(thrown: unknown): State {
    const { message, detail } = describeError(thrown)
    return { message, detail }
  }

  override componentDidUpdate(prev: Props): void {
    if (this.state.message !== null && !Object.is(prev.resetKey, this.props.resetKey)) {
      this.setState({ message: null, detail: null })
    }
  }

  override componentDidCatch(thrown: unknown, info: ErrorInfo): void {
    this.props.onError?.(thrown, info.componentStack ?? '')
  }

  private readonly retry = (): void => { this.setState({ message: null, detail: null }) }

  override render(): ReactNode {
    const { message, detail } = this.state
    if (message === null) return this.props.children
    const { fallback, compact, label } = this.props
    if (fallback !== undefined) return typeof fallback === 'function' ? fallback({ message, retry: this.retry }) : fallback
    if (compact === true) {
      return (
        <div className="crash-strip" data-testid="crash-strip" role="alert" style={this.props.style}>
          <span className="crash-strip-text">
            {label === undefined ? 'Something went wrong' : `${label} could not be displayed`}: {message}
          </span>
          <button className="btn small" data-testid="crash-retry" onClick={this.retry}>Try again</button>
        </div>
      )
    }
    return (
      <div className="crash-pane" data-testid="crash-pane" style={this.props.style}>
        <h2 className="crash-title">
          {this.props.label === undefined ? 'Something went wrong' : `${this.props.label} could not be displayed`}
        </h2>
        <p className="crash-message" data-testid="crash-message">{message}</p>
        {detail !== null && (
          <details className="crash-detail">
            <summary>Technical details</summary>
            <pre data-testid="crash-detail">{detail}</pre>
          </details>
        )}
        <div className="crash-actions">
          <button
            className="btn primary"
            data-testid="crash-retry"
            onClick={this.retry}
          >
            Try again
          </button>
          <button className="btn" data-testid="crash-reload" onClick={() => { window.location.reload() }}>
            Reload Apiary
          </button>
        </div>
      </div>
    )
  }
}
