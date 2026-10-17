import { createContext, use } from 'react'
import { applyChatPush } from '@shared/chatPush'
import type { ChatDecision, ChatEffort, ChatLifecycle, ChatModel, ChatPermissionMode, ChatPush, ChatState, TerminalBusy } from '@shared/domain/chat'
import { asSessionId, type SessionId } from '@shared/domain/ids'
import { createKeyedIpcStore } from './createIpcStore'
import { cancelPendingSwitch } from './accountSwitch'
import { surface } from './policy'
import { onRemoteReconnected } from './remote'

/** A context, not a prop: threading it through the memoised `SessionColumn` would add a prop for one boolean. */
export const ChatModeContext = createContext(false)

export function useChatMode(): boolean {
  return use(ChatModeContext)
}

/*
 * Every session's chat-mode state as main last reported it, null when it never ran as a chat.
 * A key's first reader attaches it (`chatAttach`) and its last detaches it, so main pushes
 * (`onChatChanged`, about 8 a second while streaming) wake only windows and readers of that session.
 *
 * A chat `/clear` moved onto a new session is still the old tab's chat until the tab follows it
 * there (`useChatTakeover`), so a state naming a `previousSessionId` belongs to both keys.
 */
/** Keys are plain strings; every one reaching `fetch` or `attach` came from `useChat`, which takes a `SessionId`. */
const sessionOfKey = (key: string): SessionId => asSessionId(key)

const chatStore = createKeyedIpcStore<ChatState | null>({
  scope: 'chat',
  initial: null,
  fetch: (sessionId) => (sessionId === '' ? Promise.resolve(null) : window.apiary.chatState(sessionOfKey(sessionId))),
  // A delta applies onto the snapshot it was computed from, else the keys are fetched again.
  subscribe: (push, invalidate) => window.apiary.onChatChanged((p: ChatPush) => {
    const keys = p.kind === 'full'
      ? [p.state.sessionId]
      : p.previousSessionId === null ? [p.sessionId] : [p.sessionId, p.previousSessionId]
    const next = applyChatPush(keys.map((k) => chatStore.getSnapshot(k)).find((s) => s !== null) ?? null, p)
    if (next === 'refetch') keys.forEach((k) => { invalidate(k) })
    else push(next)
  }),
  // Attached before the state is asked for: IPC from one renderer is ordered, so no update falls between.
  attach: (sessionId) => {
    if (sessionId === '') return () => {}
    const apiary = window.apiary
    apiary.chatAttach(sessionOfKey(sessionId))
    // A reconnected remote window re-reads every chat it shows: pushes were lost while away.
    const offReconnect = onRemoteReconnected(() => { chatStore.reload(sessionId) })
    return () => {
      offReconnect()
      apiary.chatDetach(sessionOfKey(sessionId))
    }
  },
  keysOf: (state) => (state === null ? [] : state.previousSessionId === null ? [state.sessionId] : [state.sessionId, state.previousSessionId]),
})

export function useChat(sessionId: SessionId | ''): ChatState | null {
  return chatStore.useStore(sessionId)
}

// -- Commands. The composer awaits `startChat`/`sendChat`; the controls beside it surface a failure and return nothing.

export interface ChatStartOptions { takeOver: boolean; model?: ChatModel; permissionMode?: ChatPermissionMode; effort?: ChatEffort }
export const startChat = (sessionId: SessionId, options: ChatStartOptions): Promise<ChatState> => window.apiary.chatStart(sessionId, options)
export function sendChat(sessionId: SessionId, text: string): Promise<void> {
  // A switch waiting for this reply to end is dropped.
  cancelPendingSwitch(sessionId)
  return window.apiary.chatSend(sessionId, text)
}

/** The chat state as last read, without subscribing: for a gesture, not for drawing. */
export function peekChat(sessionId: SessionId): ChatState | null {
  return chatStore.getSnapshot(sessionId)
}
export const terminalBusy = (sessionId: SessionId): Promise<TerminalBusy> => window.apiary.terminalBusy(sessionId)

export function interruptChat(sessionId: SessionId): void {
  surface(window.apiary.chatInterrupt(sessionId), 'Could not stop Claude')
}
export function sendChatNow(sessionId: SessionId, queuedId: string): void {
  surface(window.apiary.chatSendNow(sessionId, queuedId), 'Could not send that message now')
}
export function answerChatRequest(sessionId: SessionId, requestId: string, decision: ChatDecision): void {
  surface(window.apiary.chatRespond(sessionId, requestId, decision), 'Could not answer Claude')
}
export function setChatPermissionMode(sessionId: SessionId, mode: ChatPermissionMode): void {
  surface(window.apiary.chatSetPermissionMode(sessionId, mode), 'Could not change the permission mode')
}
export function setChatModel(sessionId: SessionId, model: ChatModel): void {
  surface(window.apiary.chatSetModel(sessionId, model), 'Could not switch model')
}
export function setChatEffort(sessionId: SessionId, effort: ChatEffort): void {
  surface(window.apiary.chatSetEffort(sessionId, effort), 'Could not change the effort')
}

/** Fires for every chat that starts, moves (`/clear`) or ends, shown here or not: a background tab must follow a chat that took its terminal over. */
export function onChatLifecycle(cb: (change: ChatLifecycle) => void): () => void {
  return window.apiary.onChatLifecycle(cb)
}
