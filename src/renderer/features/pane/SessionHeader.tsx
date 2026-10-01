import type { PtyId } from '@shared/domain/ids'
import type { JSX } from 'react'
import type { SessionNode } from '@shared/types'
import type { OpenTab } from '../layout/columns'
import { EditableSessionTitle } from './EditableSessionTitle'
import { ResumeBar } from './ResumeBar'
import { useChat } from '../../state/useChat'
import type { PendingTabInfo } from './paneTypes'

/** The title (editable), folder path and — for a resolved session — the resume bar. */
export function SessionHeader({
  activePending, activeSession, activeView, hasTerminal, onRenamePending, onRenameSession, onSetView, onResume,
}: {
  activePending: PendingTabInfo | null
  activeSession: SessionNode | null
  activeView: OpenTab['view']
  /** Whether the session has a live claude pty behind it. */
  hasTerminal: boolean
  onRenamePending: (ptyId: PtyId, title: string) => void
  onRenameSession: (session: SessionNode, title: string) => void
  onSetView: (key: string, view: OpenTab['view']) => void
  onResume: (session: SessionNode) => void
}): JSX.Element {
  const chat = useChat(activeSession?.sessionId ?? '')
  return (
    <>
      <header className="session-header">
        <h1 data-testid="session-title" className="session-title-heading">
          {activePending !== null ? (
            <>
              New session &middot;{' '}
              <EditableSessionTitle
                key={activePending.ptyId}
                title={activePending.label}
                onRename={(title) => onRenamePending(activePending.ptyId, title)}
              />
            </>
          ) : activeSession !== null ? (
            <EditableSessionTitle
              key={activeSession.sessionId}
              title={activeSession.title}
              onRename={(title) => onRenameSession(activeSession, title)}
            />
          ) : null}
        </h1>
        <p className="session-cwd" data-testid="session-path">
          {activePending !== null ? activePending.cwd : activeSession?.cwd}
        </p>
      </header>

      {activePending === null && activeSession !== null && (
        <ResumeBar
          session={activeSession}
          view={activeView}
          hasTerminal={hasTerminal}
          onView={(v) => onSetView(activeSession.sessionId, v)}
          onResume={() => onResume(activeSession)}
          chatRunning={chat !== null && chat.status !== 'exited'}
        />
      )}
    </>
  )
}
