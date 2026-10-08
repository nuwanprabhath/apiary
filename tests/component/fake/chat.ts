/**
 * Chat mode in the fake, modelled on main's `ChatService` and `ChatManager`: just enough for the
 * renderer to drive (what Claude says is a test's to play, with `fake.emit('chatChanged', …)`), but
 * with the parts that are main's own: a chat must be running to be driven, its state goes only to a
 * window that attached it, every window hears it start and end, and an ended chat is forgotten once
 * no window shows it. The contract (`tests/contract/clauses/chat.ts`) pins it.
 */
import type { ApiaryApi } from '@shared/api'
import { emptyChatState, type ChatState } from '@shared/domain/chat'
import type { Env } from './state'

type ChatApi = Pick<ApiaryApi,
  | 'chatState' | 'chatStart' | 'chatSend' | 'chatInterrupt' | 'chatRespond' | 'chatSetPermissionMode' | 'chatSetModel'
  | 'chatSetEffort' | 'chatStop' | 'terminalBusy' | 'chatAttach' | 'chatDetach'>

export function chatApi(env: Env): ChatApi {
  const { state, emit } = env
  /** The last lifecycle announced per session (`status|previousSessionId`), so repeats are not. */
  const announced = new Map<string, string>()
  const keysOf = (c: ChatState): string[] => (c.previousSessionId === null ? [c.sessionId] : [c.sessionId, c.previousSessionId])

  /** Drops every ended chat that no window shows any more. */
  const sweep = (): void => {
    for (const c of [...state.chats.values()]) {
      if (c.status !== 'exited' || keysOf(c).some((k) => state.chatAttached.has(k))) continue
      state.chats.delete(c.sessionId)
      announced.delete(c.sessionId)
    }
  }
  /** Records a chat's new state and tells the renderer, as main does: the state to a window that
   *  attached the session (or the one `/clear` left), and every window a lifecycle change. */
  const setChat = (next: ChatState): void => {
    state.chats.set(next.sessionId, next)
    if (keysOf(next).some((k) => state.chatAttached.has(k))) emit('chatChanged', next)
    const key = `${next.status === 'exited' ? 'exited' : 'running'}|${next.previousSessionId ?? ''}`
    if (announced.get(next.sessionId) !== key) {
      announced.set(next.sessionId, key)
      emit('chatLifecycle', { sessionId: next.sessionId, previousSessionId: next.previousSessionId, running: next.status !== 'exited' })
    }
    if (next.status === 'exited') sweep()
  }
  const running = (id: string): ChatState => {
    const c = state.chats.get(id)
    if (c === undefined || c.status === 'exited') throw new Error('This session is not running as a chat')
    return c
  }

  return {
    chatState: async (id) => state.chats.get(id) ?? null,
    chatStart: async (id) => {
      const existing = state.chats.get(id)
      if (existing !== undefined && existing.status !== 'exited') return existing
      const session = env.find(id)
      if (session === undefined) throw new Error('Unknown session.')
      if (session.cwdExists === false) throw new Error(`The folder for this session no longer exists: ${session.projectPath}`)
      const started: ChatState = { ...emptyChatState(id), status: 'idle' }
      setChat(started)
      return started
    },
    chatSend: async (id, text) => {
      const c = running(id)
      setChat({
        ...c, status: 'busy', error: null, turnStartedAt: c.turnStartedAt ?? Date.now(),
        queued: [...c.queued, { id: `queued-${String(c.queued.length + 1)}`, text, sentAt: Date.now() }],
      })
    },
    chatInterrupt: async (id) => { running(id) },
    chatRespond: async (id, requestId) => {
      const c = running(id)
      if (c.permissions.some((p) => p.requestId === requestId)) setChat({ ...c, permissions: c.permissions.filter((p) => p.requestId !== requestId) })
    },
    chatSetPermissionMode: async (id, permissionMode) => { setChat({ ...running(id), permissionMode }) },
    chatSetModel: async (id, model) => { setChat({ ...running(id), model }) },
    chatSetEffort: async (id, effort) => { setChat({ ...running(id), effort }) },
    chatStop: async (id) => {
      const c = state.chats.get(id)
      if (c === undefined || c.status === 'exited') return
      setChat({ ...c, status: 'exited', streaming: null, turnStartedAt: null, permissions: [], error: null })
    },
    terminalBusy: async (id) => state.terminalBusy.get(id) ?? { busy: false, backgroundTasks: 0 },
    chatAttach: (id) => { state.chatAttached.add(id) },
    chatDetach: (id) => { state.chatAttached.delete(id); sweep() },
  }
}
