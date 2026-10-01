import type { JSX } from 'react'
import type { SessionNode } from '@shared/types'

interface Props {
  session: SessionNode
  view: 'transcript' | 'terminal'
  hasTerminal: boolean
  onView: (view: 'transcript' | 'terminal') => void
  onResume: () => void
  /** The session is running as a chat: resuming moves it back to Claude Code's terminal. */
  chatRunning?: boolean
}

export function ResumeBar({ session, view, hasTerminal, onView, onResume, chatRunning = false }: Props): JSX.Element {
  return (
    <div className="resume-bar">
      <button
        className="btn" data-testid="view-transcript"
        data-active={view === 'transcript'}
        onClick={() => onView('transcript')}
      >
        Transcript
      </button>
      {hasTerminal && (
        <button
          className="btn" data-testid="view-terminal"
          data-active={view === 'terminal'}
          onClick={() => onView('terminal')}
        >
          <span className="live-dot" data-testid="session-live-dot" aria-label="running" />
          Session
        </button>
      )}
      <span className="spacer" />
      {!hasTerminal && (
        <button
          className="btn primary"
          data-testid="resume-button"
          data-cwd-exists={session.cwdExists}
          disabled={!session.cwdExists}
          title={!session.cwdExists
            ? 'This folder no longer exists'
            : chatRunning
              ? 'Stop the chat and carry on this conversation in Claude Code’s own terminal'
              : 'Resume in an embedded terminal'}
          onClick={onResume}
        >
          {chatRunning ? 'Continue in terminal' : 'Resume'}
        </button>
      )}
    </div>
  )
}
