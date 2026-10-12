import type { JSX } from 'react'
import type { TabView } from '@shared/domain/tabs'
import type { SessionNode } from '@shared/types'

interface Props {
  session: SessionNode
  view: TabView
  hasTerminal: boolean
  onView: (key: string, view: TabView) => void
  /** From `useTerminalHandoff`: starting the terminal, which may wait for a busy chat. */
  handoff: { resume: () => void; chatRunning: boolean; pending: boolean }
}

/**
 * Chat | Terminal, in the tab bar. With a terminal running both segments switch the view; with
 * none, the Terminal segment starts one (resume), so the one control covers what "Resume in
 * terminal" used to. The outlined segment is the view in front.
 */
export function ViewToggle({ session, view, hasTerminal, onView: setView, handoff }: Props): JSX.Element {
  const { resume: onResume, chatRunning, pending } = handoff
  const onView = (v: TabView): void => { setView(session.sessionId, v) }
  const resumeLabel = chatRunning ? 'Continue in terminal' : 'Resume in terminal'
  return (
    <div className="view-toggle" data-testid="view-toggle">
      <button
        type="button" className="view-toggle-segment" data-testid="view-transcript"
        data-active={view === 'transcript'} aria-pressed={view === 'transcript'}
        onClick={() => onView('transcript')}
      >
        Chat
      </button>
      {hasTerminal ? (
        <button
          type="button" className="view-toggle-segment" data-testid="view-terminal"
          data-active={view === 'terminal'} aria-pressed={view === 'terminal'}
          onClick={() => onView('terminal')}
        >
          <span className="live-dot" data-testid="session-live-dot" aria-label="running" />
          Terminal
        </button>
      ) : (
        <button
          type="button" className="view-toggle-segment" data-testid="resume-button"
          data-active="false" aria-pressed="false"
          data-cwd-exists={session.cwdExists}
          disabled={!session.cwdExists || pending}
          aria-label={resumeLabel}
          title={!session.cwdExists
            ? 'This folder no longer exists'
            : chatRunning
              ? 'Carry on this conversation in Claude Code’s own terminal — once Claude is done with what it is doing'
              : 'Resume in an embedded terminal'}
          onClick={onResume}
        >
          Terminal{pending ? '…' : ''}
        </button>
      )}
    </div>
  )
}
