import type { PtyId } from '@shared/domain/ids'
import { type JSX, useEffect, useState } from 'react'
import type { SessionNode } from '@shared/types'
import type { OpenTab } from '../layout/columns'
import { EditableSessionTitle } from './EditableSessionTitle'
import { ResumeBar } from './ResumeBar'
import { useChat } from '../../state/chatStore'
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
  const chatRunning = chat !== null && chat.status !== 'exited'
  // What moving the chat to the terminal now would cut short: the turn in progress, or background
  // tasks it started — the chat's claude is stopped for the terminal's, and they die with it.
  const tasks = chat?.backgroundTasks?.length ?? 0
  const chatWorking = chatRunning && (chat.status === 'busy' || tasks > 0)
  // "Continue in terminal" pressed while it was: the switch waits until there is nothing to lose.
  const [handoff, setHandoff] = useState<string | null>(null)
  const sessionId = activeSession?.sessionId ?? null
  useEffect(() => {
    if (handoff === null) return
    if (handoff !== sessionId || !chatRunning) { setHandoff(null); return }
    if (chatWorking || activeSession === null) return
    setHandoff(null)
    onResume(activeSession)
  }, [handoff, sessionId, chatRunning, chatWorking, activeSession, onResume])
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
          onResume={() => {
            if (chatWorking) setHandoff(activeSession.sessionId)
            else onResume(activeSession)
          }}
          chatRunning={chatRunning}
          handoff={handoff === activeSession.sessionId
            ? {
                waitingFor: tasks > 0 && chat?.status !== 'busy'
                  ? `${String(tasks)} background ${tasks === 1 ? 'task' : 'tasks'}`
                  : 'Claude to finish',
                onSwitchNow: () => { setHandoff(null); onResume(activeSession) },
                onCancel: () => { setHandoff(null) },
              }
            : null}
        />
      )}
    </>
  )
}
