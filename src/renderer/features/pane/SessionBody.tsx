import type { PtyId } from '@shared/domain/ids'
import { type JSX, useCallback } from 'react'
import type { ChatDecision } from '@shared/domain/chat'
import { useChat, useChatMode } from '../../state/chatStore'
import type { SessionNode } from '@shared/types'
import type { Column, OpenTab } from '../layout/columns'
import { Transcript } from '../transcript/Transcript'
import { Composer } from '../transcript/Composer'
import { TerminalView } from '../terminal/TerminalView'
import { answerChatRequest } from '../../state/chatStore'

/** The session's centre pane: its transcript with the composer, and every tab's claude terminal. */
export function SessionBody({
  column, activeKey, activeSession, isPending, activeView, viewOf, showTerminalFor, keyFor, running,
  onResumeAsync, onSetView, onOpenImage,
}: {
  column: Column
  activeKey: string
  activeSession: SessionNode | null
  /** Whether the active tab is a pending session — it has no transcript to show. */
  isPending: boolean
  activeView: OpenTab['view']
  viewOf: (tab: OpenTab) => OpenTab['view']
  showTerminalFor: (tab: OpenTab) => boolean
  keyFor: (tabKey: string) => PtyId
  /** Whether the active session has a live claude pty behind it. */
  running: boolean
  onResumeAsync: (session: SessionNode) => Promise<void>
  onSetView: (key: string, view: OpenTab['view']) => void
  onOpenImage: (src: string) => void
}): JSX.Element {
  const chatMode = useChatMode()
  const chat = useChat(activeSession?.sessionId ?? '')
  // Answers go to the chat's own session, which `/clear` may have moved on from the tab's.
  const sessionId = chat?.sessionId ?? activeSession?.sessionId ?? null
  const onDecide = useCallback((requestId: string, decision: ChatDecision) => {
    if (sessionId === null) return
    answerChatRequest(sessionId, requestId, decision)
  }, [sessionId])
  return (
    <div
      className="centre-pane"
      role="tabpanel"
      id={`session-tabpanel-${column.id}`}
      aria-labelledby={`session-tab-${column.id}-${activeKey}`}
    >
      {/* Only the active tab's transcript is mounted: it refetches and jumps to the newest
       *  message on mount anyway, so keeping the others alive would buy nothing and would
       *  multiply the live-update refetches by the number of open tabs. */}
      {!isPending && activeSession !== null && (
        <div hidden={activeView !== 'transcript'} className="pane-fill">
          <Transcript
            session={activeSession}
            visible={activeView === 'transcript'}
            onOpenImage={onOpenImage}
            chatMode={chatMode}
            chat={chat}
            onDecide={onDecide}
            terminalRunning={running}
          />
          {/* The chat box belongs to the transcript rather than the terminal: this is the
            * reading view, and being able to reply without switching to the raw terminal is
            * the whole point. What it types still goes to that terminal. */}
          <Composer
            key={activeSession.sessionId}
            session={activeSession}
            ptyId={keyFor(activeSession.sessionId)}
            running={running}
            onResume={() => onResumeAsync(activeSession)}
            onShowSession={() => onSetView(activeSession.sessionId, 'terminal')}
            onOpenImage={onOpenImage}
            chatMode={chatMode}
            chat={chat}
          />
        </div>
      )}
      {/* Every tab's claude terminal stays mounted, hidden, so switching tabs (or columns)
       *  never discards its scrollback — a fresh xterm starts empty and nothing replays a
       *  running pty's earlier output into it. */}
      {column.tabs.filter(showTerminalFor).map((tab) => {
        const visible = tab.key === activeKey && viewOf(tab) === 'terminal'
        return (
          // Keyed by the pty id, not the tab key: when a pending session resolves, its tab
          // is rekeyed from the pty id to the real session id, and keying off that would
          // make React tear this subtree down and build a new one — remounting xterm and
          // discarding everything printed during the pending phase. The pty id doesn't move.
          <div key={keyFor(tab.key)} hidden={!visible} className="pane-fill">
            <TerminalView
              ptyId={keyFor(tab.key)}
              testId={visible ? 'terminal-session' : `terminal-session-${tab.key}`}
              visible={visible}
              claude
            />
          </div>
        )
      })}
    </div>
  )
}
