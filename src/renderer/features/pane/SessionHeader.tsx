import type { PtyId } from '@shared/domain/ids'
import type { JSX } from 'react'
import type { SessionNode } from '@shared/types'
import { EditableSessionTitle } from './EditableSessionTitle'
import type { Handoff } from './useTerminalHandoff'
import type { PendingTabInfo } from './paneTypes'

/** The title (editable), with the folder in its tooltip, and the wait-for-Claude line while a handoff is pending. */
export function SessionHeader({
  activePending, activeSession, handoff, onRenamePending, onRenameSession,
}: {
  activePending: PendingTabInfo | null
  activeSession: SessionNode | null
  handoff: Handoff | null
  onRenamePending: (ptyId: PtyId, title: string) => void
  onRenameSession: (session: SessionNode, title: string) => void
}): JSX.Element {
  const cwd = activePending !== null ? activePending.cwd : activeSession?.cwd
  const title = activePending !== null ? activePending.label : activeSession?.title
  return (
    <header className="session-header">
      <h1
        data-testid="session-title" className="session-title-heading" data-cwd={cwd}
        title={title === undefined ? undefined : `${title}\n${cwd ?? ''}`}
      >
        {activePending !== null ? (
          <>
            New session &middot;{' '}
            <EditableSessionTitle
              key={activePending.ptyId}
              title={activePending.label}
              onRename={(t) => onRenamePending(activePending.ptyId, t)}
            />
          </>
        ) : activeSession !== null ? (
          <EditableSessionTitle
            key={activeSession.sessionId}
            title={activeSession.title}
            onRename={(t) => onRenameSession(activeSession, t)}
          />
        ) : null}
      </h1>
      {handoff !== null && (
        <p className="resume-handoff" data-testid="resume-handoff" role="status">
          <span className="muted">Moving to the terminal after {handoff.waitingFor}…</span>
          <button
            className="btn"
            data-testid="resume-handoff-now"
            title="Stop the chat now — whatever it is doing, and its background tasks stop with it"
            onClick={handoff.onSwitchNow}
          >
            Switch now
          </button>
          <button className="btn" data-testid="resume-handoff-cancel" onClick={handoff.onCancel}>Cancel</button>
        </p>
      )}
    </header>
  )
}
