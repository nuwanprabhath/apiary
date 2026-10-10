import { createContext, use } from 'react'
import type { ChatDecision, ChatEffort, ChatLifecycle, ChatModel, ChatPermissionMode, ChatState, TerminalBusy } from '@shared/domain/chat'
import { asSessionId, type SessionId } from '@shared/domain/ids'
import { createKeyedIpcStore } from './createIpcStore'
import { surface } from './policy'

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
 * Every session's chat-mode state, as main last reported it — null when it has never run as a chat.
 * Main pushes every change (`onChatChanged`) to the windows that show the session: a key's first
 * reader attaches it (`chatAttach`) and its last one detaches it, so a second window showing the
 * same session follows the same conversation and a window showing something else is not woken.
 *
 * Keyed by session: one push subscription for the window and one `chatState` read per session being
 * looked at, however many components read it (a pane's header and body both do), and a push for
 * session X wakes only X's readers — a streaming chat pushes ~25 times a second.
 *
 * A chat `/clear` moved onto a new session is still the old tab's chat until the tab follows it
 * there (`useChatTakeover`), so a state naming a `previousSessionId` belongs to both keys.
 */
/** The store's keys are plain strings (`createKeyedIpcStore`); every key that reaches `fetch` or
 *  `attach` here came from `useChat`, which only takes a `SessionId` (or '' for none, handled
 *  before this is called). */
const sessionOfKey = (key: string): SessionId => asSessionId(key)

const chatStore = createKeyedIpcStore<ChatState | null>({
  scope: 'chat',
  initial: null,
  // No session is not a session: nothing to ask main about.
  fetch: (sessionId) => (sessionId === '' ? Promise.resolve(null) : window.apiary.chatState(sessionOfKey(sessionId))),
  subscribe: (push) => window.apiary.onChatChanged(push),
  // Declared before the state is asked for: IPC from one renderer is ordered, so no update falls
  // between the two. A session with no id is not one to show.
  attach: (sessionId) => {
    if (sessionId === '') return () => {}
    const apiary = window.apiary
    apiary.chatAttach(sessionOfKey(sessionId))
    return () => { apiary.chatDetach(sessionOfKey(sessionId)) }
  },
  keysOf: (state) => (state === null ? [] : state.previousSessionId === null ? [state.sessionId] : [state.sessionId, state.previousSessionId]),
})

export function useChat(sessionId: SessionId | ''): ChatState | null {
  return chatStore.useStore(sessionId)
}

// -- Commands. The composer awaits `startChat`/`sendChat` (its box stays full and says "Could not
// -- send that message" on failure); the controls beside it are one gesture each, so a failure is
// -- shown and nothing is left to await.

export interface ChatStartOptions { takeOver: boolean; model?: ChatModel; permissionMode?: ChatPermissionMode; effort?: ChatEffort }
export const startChat = (sessionId: SessionId, options: ChatStartOptions): Promise<ChatState> => window.apiary.chatStart(sessionId, options)
export const sendChat = (sessionId: SessionId, text: string): Promise<void> => window.apiary.chatSend(sessionId, text)
/** Whether the session's terminal Claude is mid-turn or has background tasks. */
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

/**
 * Every chat that starts, moves onto a new session (`/clear`) or ends, whether or not this window
 * shows it (`chatLifecycle`): the chat's own state goes only to windows that attached it, but a tab
 * in a background pane still has to follow a chat that took its terminal over or moved.
 */
export function onChatLifecycle(cb: (change: ChatLifecycle) => void): () => void {
  return window.apiary.onChatLifecycle(cb)
}
