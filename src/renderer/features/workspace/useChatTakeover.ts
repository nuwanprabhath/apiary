import { useEffect } from 'react'
import { useWorkspaceDispatch } from './WorkspaceProvider'
import { findSessionById } from './treeLookup'

/**
 * Keeps this window's tabs in step with chats, wherever they were started:
 *
 * - A session that starts as a chat has no terminal claude any more — main stopped it — so it is
 *   no longer resumed here: its dead terminal goes, and the Resume button comes back as the way to
 *   continue the same conversation in Claude Code's terminal.
 * - A chat Claude moved onto a new session (`/clear`) takes its tabs with it, once the new
 *   session is in the tree. That can be a while: claude writes the new session's file only with
 *   its first message, so this waits on the tree for as long as the window is open.
 */
export function useChatTakeover(): void {
  const dispatch = useWorkspaceDispatch()
  useEffect(() => {
    const following = new Map<string, () => void>()
    const follow = (from: string, to: string): void => {
      if (following.has(from)) return
      let stop = (): void => {}
      const attempt = (): void => {
        void window.apiary.tree().then((nodes) => {
          const node = findSessionById(nodes, to)
          if (node === null) return
          stop()
          dispatch({ type: 'chat/follow', from, to: node })
        }).catch(() => {})
      }
      const unsubscribe = window.apiary.onTreeChanged(attempt)
      stop = () => { unsubscribe(); following.delete(from) }
      following.set(from, stop)
      attempt()
    }
    const unsubscribe = window.apiary.onChatChanged((state) => {
      if (state.status !== 'exited') dispatch({ type: 'resumed/remove', key: state.sessionId })
      if (state.previousSessionId !== null) follow(state.previousSessionId, state.sessionId)
    })
    return () => {
      unsubscribe()
      for (const stop of [...following.values()]) stop()
    }
  }, [dispatch])
}
