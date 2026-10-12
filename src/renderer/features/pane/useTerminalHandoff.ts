import { useEffect, useState } from 'react'
import type { SessionNode } from '@shared/types'
import { useChat } from '../../state/chatStore'

export interface Handoff { waitingFor: string; onSwitchNow: () => void; onCancel: () => void }

/**
 * What pressing "Terminal" does for a session that has no terminal yet. A chat that is busy (or
 * has background tasks) would lose work if it were stopped for the terminal's claude, so the move
 * waits until there is nothing to lose; `handoff` describes that wait for the header to show.
 */
export function useTerminalHandoff(
  session: SessionNode | null,
  onResume: (session: SessionNode) => void,
): { chatRunning: boolean; pending: boolean; handoff: Handoff | null; resume: () => void } {
  const chat = useChat(session?.sessionId ?? '')
  const chatRunning = chat !== null && chat.status !== 'exited'
  // What moving the chat to the terminal now would cut short: the turn in progress, or background
  // tasks it started — the chat's claude is stopped for the terminal's, and they die with it.
  const tasks = chat?.backgroundTasks?.length ?? 0
  const chatWorking = chatRunning && (chat.status === 'busy' || tasks > 0)
  // "Continue in terminal" pressed while it was: the switch waits until there is nothing to lose.
  const [waiting, setWaiting] = useState<string | null>(null)
  const sessionId = session?.sessionId ?? null
  useEffect(() => {
    if (waiting === null) return
    if (waiting !== sessionId || !chatRunning) { setWaiting(null); return }
    if (chatWorking || session === null) return
    setWaiting(null)
    onResume(session)
  }, [waiting, sessionId, chatRunning, chatWorking, session, onResume])

  const pending = session !== null && waiting === session.sessionId
  return {
    chatRunning,
    pending,
    handoff: pending
      ? {
          waitingFor: tasks > 0 && chat?.status !== 'busy'
            ? `${String(tasks)} background ${tasks === 1 ? 'task' : 'tasks'}`
            : 'Claude to finish',
          onSwitchNow: () => { setWaiting(null); onResume(session) },
          onCancel: () => { setWaiting(null) },
        }
      : null,
    resume: () => {
      if (session === null) return
      if (chatWorking) setWaiting(session.sessionId)
      else onResume(session)
    },
  }
}
