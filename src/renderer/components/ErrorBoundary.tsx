import { Component, type ErrorInfo, type ReactNode } from 'react'
import { describeError } from '../errors'

interface Props {
  children: ReactNode
  /** Named in the fallback so the user can tell *what* failed, not just that something did. */
  label?: string
  /** Reported alongside the fallback, so the notification stack records it too. */
  onError?: (thrown: unknown, componentStack: string) => void
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
  state: State = { message: null, detail: null }

  static getDerivedStateFromError(thrown: unknown): State {
    const { message, detail } = describeError(thrown)
    return { message, detail }
  }

  componentDidCatch(thrown: unknown, info: ErrorInfo): void {
    this.props.onError?.(thrown, info.componentStack ?? '')
  }

  render(): ReactNode {
    const { message, detail } = this.state
    if (message === null) return this.props.children
    return (
      <div className="crash-pane" data-testid="crash-pane">
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
            className="primary"
            data-testid="crash-retry"
            onClick={() => this.setState({ message: null, detail: null })}
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
