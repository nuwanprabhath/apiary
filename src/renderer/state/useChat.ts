import { createContext, use, useEffect, useState } from 'react'
import type { ChatState } from '@shared/domain/chat'
import { asSessionId } from '@shared/domain/ids'

/**
 * Whether the transcript's message box drives the session as a chat (the `transcriptChat`
 * setting). A context rather than a prop: it is read two levels below the pane, and threading it
 * through `SessionColumn` would put a new prop on a memoised component for one boolean.
 */
export const ChatModeContext = createContext(false)

export function useChatMode(): boolean {
  return use(ChatModeContext)
}

/**
 * A session's chat-mode state, as main last reported it — null when it has never run as a chat.
 * Main pushes every change (`onChatChanged`, all windows), so a second window showing the same
 * session follows the same conversation.
 */
export function useChat(sessionId: string): ChatState | null {
  const [state, setState] = useState<ChatState | null>(null)
  useEffect(() => {
    let current = true
    setState(null)
    const unsubscribe = window.apiary.onChatChanged((next) => {
      // A chat `/clear` moved onto a new session is still this tab's chat until the tab follows it
      // there (useChatTakeover), so its updates keep arriving here in the meantime.
      if (next.sessionId === sessionId || next.previousSessionId === sessionId) setState(next)
    })
    void window.apiary.chatState(asSessionId(sessionId))
      .then((s) => { if (current && s !== null) setState((prev) => prev ?? s) })
      .catch(() => { /* no chat is the same as never having had one */ })
    return () => { current = false; unsubscribe() }
  }, [sessionId])
  return state
}
