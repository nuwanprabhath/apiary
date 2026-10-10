import type { JSX } from 'react'
import type { TabView } from '@shared/domain/tabs'
import type { SessionNode } from '@shared/types'

interface Props {
  session: SessionNode
  view: TabView
  hasTerminal: boolean
  onView: (view: TabView) => void
  onResume: () => void
  /** The session is running as a chat: resuming moves it back to Claude Code's terminal. */
  chatRunning?: boolean
  /** "Continue in terminal" is waiting for the chat to finish what it is doing. */
  handoff?: { waitingFor: string; onSwitchNow: () => void; onCancel: () => void } | null
}

export function ResumeBar({
  session, view, hasTerminal, onView, onResume, chatRunning = false, handoff = null,
}: Props): JSX.Element {
  return (
    <div className="resume-bar">
      <button
        className="btn" data-testid="view-transcript"
        data-active={view === 'transcript'}
        onClick={() => onView('transcript')}
      >
        Chat
      </button>
      {hasTerminal && (
        <button
          className="btn" data-testid="view-terminal"
          data-active={view === 'terminal'}
          onClick={() => onView('terminal')}
        >
          <span className="live-dot" data-testid="session-live-dot" aria-label="running" />
          Terminal
        </button>
      )}
      <span className="spacer" />
      {!hasTerminal && handoff !== null && (
        <span className="resume-handoff" data-testid="resume-handoff" role="status">
          <span className="muted">Moving to the terminal after {handoff.waitingFor}…</span>
          <button
            className="btn"
            data-testid="resume-handoff-now"
            title="Stop the chat now — whatever it is doing, and its background tasks, stop with it"
            onClick={handoff.onSwitchNow}
          >
            Switch now
          </button>
          <button className="btn" data-testid="resume-handoff-cancel" onClick={handoff.onCancel}>Cancel</button>
        </span>
      )}
      {!hasTerminal && handoff === null && (
        <button
          className="btn primary"
          data-testid="resume-button"
          data-cwd-exists={session.cwdExists}
          disabled={!session.cwdExists}
          aria-label={chatRunning ? 'Continue in terminal' : 'Resume in terminal'}
          title={!session.cwdExists
            ? 'This folder no longer exists'
            : chatRunning
              ? 'Carry on this conversation in Claude Code’s own terminal — once Claude is done with what it is doing'
              : 'Resume in an embedded terminal'}
          onClick={onResume}
        >
          {/* Both labels render; the bar's container query shows the short one when narrow. */}
          <span className="resume-long">{chatRunning ? 'Continue in terminal' : 'Resume in terminal'}</span>
          <span className="resume-short" aria-hidden="true">{chatRunning ? 'Continue' : 'Resume'}</span>
        </button>
      )}
    </div>
  )
}
