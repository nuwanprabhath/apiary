import type { ChatState } from '@shared/domain/chat'
import { asSessionId, UUID_RE, type AccountId, type SessionId } from '@shared/domain/ids'
import type { PtySessionInfo } from '@shared/domain/pty'
import { chooseAccount } from './accountSwitch'
import { peekChat, useChat } from './chatStore'
import { peekPtySessions, usePtySessions } from './ptySessionsStore'

/** Whether Claude is mid-reply in `sessionId`, as a chat turn or in a terminal's pty. */
export function busyOf(chat: ChatState | null, ptys: Record<string, PtySessionInfo>, sessionId: SessionId): boolean {
  return chat?.status === 'busy' || Object.values(ptys).some((p) => p.sessionId === sessionId && p.status === 'busy')
}

/** The session a tab's key names; null for a key that is not a session id (a new session has none yet). */
export function sessionOfTabKey(key: string): SessionId | null {
  return UUID_RE.test(key) ? asSessionId(key) : null
}

/** `busyOf` for now, outside a component. A session nobody has looked at yet reads as idle. */
function isSessionBusy(sessionId: SessionId): boolean {
  return busyOf(peekChat(sessionId), peekPtySessions(), sessionId)
}

/** `busyOf`, kept up to date. */
export function useSessionBusy(sessionId: SessionId): boolean {
  return busyOf(useChat(sessionId), usePtySessions(), sessionId)
}

/** The "pick an account" gesture of the `/` menu and the tab menu: switch, or ask when busy. */
export function pickAccount(sessionId: SessionId, accountId: AccountId): void {
  chooseAccount(sessionId, accountId, isSessionBusy(sessionId))
}
