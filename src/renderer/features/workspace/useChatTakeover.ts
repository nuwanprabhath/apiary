import { useEffect } from 'react'
import { onChatLifecycle } from '../../state/chatStore'
import { treeStore } from '../../state/treeStore'
import { useWorkspaceDispatch } from './workspaceContext'
import { findSessionById } from '@shared/treeWalk'
import { background } from '../../state/policy'

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
        background(treeStore.current().then((nodes) => {
          const node = findSessionById(nodes, to)
          if (node === null) return
          stop()
          dispatch({ type: 'chat/follow', from, to: node })
        }), 'chat')
      }
      const unsubscribe = treeStore.onChanged(attempt)
      stop = () => { unsubscribe(); following.delete(from) }
      following.set(from, stop)
      attempt()
    }
    // `chatLifecycle`, not the chat's own push: this window may have the session open in a
    // background tab, which shows no chat and so is attached to none, and these two facts are all
    // it needs.
    const unsubscribe = onChatLifecycle((change) => {
      if (change.running) dispatch({ type: 'resumed/remove', key: change.sessionId })
      if (change.previousSessionId !== null) follow(change.previousSessionId, change.sessionId)
    })
    return () => {
      unsubscribe()
      for (const stop of [...following.values()]) stop()
    }
  }, [dispatch])
}
