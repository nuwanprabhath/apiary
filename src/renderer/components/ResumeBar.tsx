import type { SessionNode } from '@shared/types'

interface Props {
  session: SessionNode
  view: 'transcript' | 'terminal'
  hasTerminal: boolean
  onView: (view: 'transcript' | 'terminal') => void
  onResume: () => void
}

export function ResumeBar({ session, view, hasTerminal, onView, onResume }: Props): JSX.Element {
  return (
    <div className="resume-bar">
      <button
        data-testid="view-transcript"
        data-active={view === 'transcript'}
        onClick={() => onView('transcript')}
      >
        Transcript
      </button>
      {hasTerminal && (
        <button
          data-testid="view-terminal"
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
          className="primary"
          data-testid="resume-button"
          data-cwd-exists={session.cwdExists}
          disabled={!session.cwdExists}
          title={session.cwdExists ? 'Resume in an embedded terminal' : 'This folder no longer exists'}
          onClick={onResume}
        >
          Resume
        </button>
      )}
    </div>
  )
}
