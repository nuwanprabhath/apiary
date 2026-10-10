/**
 * Chat mode in the fake, modelled on main's `ChatService` and `ChatManager`: just enough for the
 * renderer to drive (what Claude says is a test's to play, with `fake.emit('chatChanged', …)`), but
 * with the parts that are main's own: a chat must be running to be driven, its state goes only to a
 * window that attached it, every window hears it start and end, and an ended chat is forgotten once
 * no window shows it. A message about a background task ends its turn with the task still running,
 * and the task reports back a second later, as `tests/fixtures/fake-claude-chat.mjs` does. Every
 * change of a chat's activity is announced as `activeTabsChanged`. The contract
 * (`tests/contract/clauses/chat.ts`) pins it.
 */
import type { ApiaryApi } from '@shared/api'
import { chatActivity, type ActivityStatus } from '@shared/activity'
import { emptyChatState, type ChatState } from '@shared/domain/chat'
import type { Env } from './state'

type ChatApi = Pick<ApiaryApi,
  | 'chatState' | 'chatStart' | 'chatSend' | 'chatSendNow' | 'chatInterrupt' | 'chatRespond' | 'chatSetPermissionMode' | 'chatSetModel'
  | 'chatSetEffort' | 'chatStop' | 'terminalBusy' | 'chatAttach' | 'chatDetach'>

/** How long the background task runs: as long as the fixture's `sleep 1`. */
const BACKGROUND_TASK_MS = 1000

export function chatApi(env: Env): ChatApi {
  const { state, emit } = env
  /** The last lifecycle announced per session (`status|previousSessionId`), so repeats are not. */
  const announced = new Map<string, string>()
  /** The last activity announced per session, so only a change is. */
  const activities = new Map<string, ActivityStatus>()
  let taskCount = 0
  const keysOf = (c: ChatState): string[] => (c.previousSessionId === null ? [c.sessionId] : [c.sessionId, c.previousSessionId])

  /** Drops every ended chat that no window shows any more. */
  const sweep = (): void => {
    for (const c of [...state.chats.values()]) {
      if (c.status !== 'exited' || keysOf(c).some((k) => state.chatAttached.has(k))) continue
      state.chats.delete(c.sessionId)
      announced.delete(c.sessionId)
      activities.delete(c.sessionId)
    }
  }
  /** Records a chat's new state and tells the renderer, as main does: the state to a window that
   *  attached the session (or the one `/clear` left), every window a lifecycle change, and every
   *  window an activity change. */
  const setChat = (next: ChatState): void => {
    state.chats.set(next.sessionId, next)
    if (keysOf(next).some((k) => state.chatAttached.has(k))) emit('chatChanged', next)
    const key = `${next.status === 'exited' ? 'exited' : 'running'}|${next.previousSessionId ?? ''}`
    if (announced.get(next.sessionId) !== key) {
      announced.set(next.sessionId, key)
      emit('chatLifecycle', { sessionId: next.sessionId, previousSessionId: next.previousSessionId, running: next.status !== 'exited' })
    }
    const activity = chatActivity(next)
    if (activities.get(next.sessionId) !== activity) {
      activities.set(next.sessionId, activity)
      emit('activeTabsChanged')
    }
    if (next.status === 'exited') sweep()
  }
  const running = (id: string): ChatState => {
    const c = state.chats.get(id)
    if (c === undefined || c.status === 'exited') throw new Error('This session is not running as a chat')
    return c
  }
  /** The turn a background-task message ends with: idle, the task still in flight, the task gone a
   *  moment later. */
  const endTurnWithBackgroundTask = (id: string): void => {
    taskCount += 1
    const taskId = `bash-${String(taskCount)}`
    const c = running(id)
    setChat({
      ...c, status: 'idle', turnStartedAt: null, queued: [],
      backgroundTasks: [...(c.backgroundTasks ?? []), { taskId, description: 'sleep 1; echo done' }],
    })
    setTimeout(() => {
      const now = state.chats.get(id)
      if (now === undefined || now.status === 'exited') return
      setChat({ ...now, backgroundTasks: (now.backgroundTasks ?? []).filter((t) => t.taskId !== taskId) })
    }, BACKGROUND_TASK_MS)
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
      if (text.includes('background')) endTurnWithBackgroundTask(id)
    },
    chatSendNow: async (id, queuedId) => {
      const c = running(id)
      if (!c.queued.some((q) => q.id === queuedId)) return
      setChat({ ...c, status: 'busy', error: null, turnStartedAt: c.turnStartedAt ?? Date.now() })
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
