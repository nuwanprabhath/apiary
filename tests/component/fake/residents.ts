/**
 * Resident agents in the fake, modelled on `ResidentService` (src/main/residents): the configs are
 * the `residents` setting; an add appends a kind's defaults under a fresh id; only an enabled
 * resident takes a message, which is answered the way tests/fixtures/fake-claude-chat.mjs answers
 * ("You said: …"), streamed as updates of one message; every status change goes out as
 * `residentsChanged`. With no knowledge index (as main has until it is wired in) a send's instant
 * matches are `[]`. Permission requests and attention are arranged in `state` by a test: an answer
 * removes the request, `residentSeen` clears the attention, and a waiting request shows as
 * "Waiting for your OK" as in main. A quick-action command cannot run here, so its message is the
 * expanded argv. The contract (`tests/contract/clauses/residents.ts`) pins it.
 */
import type { ApiaryApi } from '@shared/api'
import { CYCLE_ACTION_ID, type ResidentMessage, type ResidentStatus, type SessionHit, WAITING_FOR_OK } from '@shared/domain/residents'
import { kindInfos, kindOf, newResident } from '../../../src/main/residents/kinds'
import { cycleStatus } from '../../../src/main/residents/cycle'
import { expandArgv } from '../../../src/main/residents/quickActions'
import { isOnDuty } from '@shared/residentSchedule'
import type { Env, FakeState } from './state'

type ResidentsApi = Pick<ApiaryApi,
  'residentsList' | 'residentsAdd' | 'residentHistory' | 'residentSend' | 'residentStop' | 'residentClear' | 'residentRedigest'
  | 'residentPermissionAnswer' | 'residentQuickAction' | 'residentSeen' | 'residentPickFolder' | 'residentKinds'>

/** Every configured resident's status, as main derives it. */
export function residentStatuses(state: FakeState): ResidentStatus[] {
  const now = new Date()
  return state.settings.residents.map((c) => {
    const kind = kindOf(c.kind)
    const onDuty = isOnDuty(c.schedule, now)
    const busy = state.residentBusy.has(c.id)
    const permissions = state.residentPermissions.get(c.id) ?? []
    const lastAsked = (state.residentHistory.get(c.id) ?? []).filter((m) => m.role === 'user' && m.action !== true).at(-1)?.text
    return {
      id: c.id, kind: c.kind, name: c.name, enabled: c.enabled,
      state: !c.enabled ? 'asleep' : busy ? 'working' : onDuty ? 'idle' : 'asleep',
      activity: c.enabled && busy ? state.residentActivity.get(c.id) ?? 'Writing' : null,
      onDuty, appearance: kind.appearance, digest: null,
      attention: permissions.length > 0 ? { count: permissions.length, summary: WAITING_FOR_OK } : state.residentAttention.get(c.id) ?? null,
      permissions,
      quickActions: kind.quickActions.map(({ id, label }) => ({ id, label })),
      setupNeeded: kind.setup(c),
      cycle: cycleStatus(kind, c, { nextCycleAt: state.residentNextCycle.get(c.id) ?? null, running: busy && lastAsked === kind.cycle?.prompt, now }),
    }
  })
}

let nextId = 0
const messageId = (prefix: string): string => `${prefix}-${String(Date.now())}-${String(++nextId)}`

export function residentsApi(env: Env): ResidentsApi {
  const { state, emit } = env
  const changed = (): void => { emit('residentsChanged', residentStatuses(state)) }
  const require = (id: string): ResidentMessage[] => {
    if (!state.settings.residents.some((c) => c.id === id)) throw new Error(`No resident ${id}`)
    return state.residentHistory.get(id) ?? []
  }
  const configOf = (id: string) => {
    require(id)
    const config = state.settings.residents.find((c) => c.id === id)
    if (config === undefined) throw new Error(`No resident ${id}`)
    return config
  }
  const push = (residentId: string, message: ResidentMessage): void => {
    const history = (state.residentHistory.get(residentId) ?? []).filter((m) => m.id !== message.id)
    state.residentHistory.set(residentId, [...history, message])
    emit('residentMessage', { residentId, message })
  }
  /** Runs `end` shortly, or when the test releases it while the resident is held. */
  const later = (id: string, end: () => void): void => {
    const held = state.residentHeld.get(id)
    if (held !== undefined) held.push(end)
    else setTimeout(end, 20)
  }
  /** Main's status while a turn or a command runs: working, saying `doing` until the turn says more. */
  const busy = (id: string, doing: string | null): void => {
    state.residentBusy.add(id)
    if (doing === null) state.residentActivity.delete(id)
    else state.residentActivity.set(id, doing)
    changed()
  }
  const idle = (id: string): void => {
    state.residentBusy.delete(id)
    state.residentActivity.delete(id)
    changed()
  }
  const send = async (id: string, text: string, doing: string | null = null): Promise<SessionHit[]> => {
    const config = configOf(id)
    if (!config.enabled) throw new Error(`${config.name} is not enabled`)
    if (text.trim() === '' || text.length > 8000) throw new Error('A message is 1 to 8000 characters')
    push(id, { id: messageId('u'), role: 'user', text, at: Date.now(), streaming: false })
    busy(id, doing)
    const answer = { id: messageId('a'), role: 'assistant' as const, at: Date.now() }
    later(id, () => {
      push(id, { ...answer, text: 'You said:', streaming: true })
      push(id, { ...answer, text: `You said: ${text}`, streaming: false })
      idle(id)
    })
    return []
  }
  return {
    residentsList: async () => residentStatuses(state),
    residentsAdd: async (kind) => {
      const config = newResident(kindOf(kind), new Set(state.settings.residents.map((c) => c.id)))
      state.settings = { ...state.settings, residents: [...state.settings.residents, config] }
      changed()
      return config
    },
    residentHistory: async (id) => require(id),
    residentSend: (id, text) => send(id, text),
    residentStop: async (id) => { require(id) },
    residentClear: async (id) => {
      require(id)
      state.residentHistory.set(id, [])
    },
    residentRedigest: async (id) => { require(id) },
    residentPermissionAnswer: async (id, requestId) => {
      require(id)
      const waiting = state.residentPermissions.get(id) ?? []
      if (!waiting.some((p) => p.requestId === requestId)) return
      state.residentPermissions.set(id, waiting.filter((p) => p.requestId !== requestId))
      changed()
    },
    residentQuickAction: async (id, actionId) => {
      const config = configOf(id)
      const kind = kindOf(config.kind)
      const action = kind.quickActions.find((a) => a.id === actionId)
      if (actionId === CYCLE_ACTION_ID && kind.cycle !== undefined) { await send(id, kind.cycle.prompt, kind.cycle.doing); return }
      if (action === undefined) throw new Error(`${config.name} has no action ${actionId}`)
      if (action.run.kind === 'prompt') { await send(id, action.run.text, action.doing); return }
      let text: string
      try {
        text = `$ ${expandArgv(action.run.argv, { options: config.options, bins: kind.bins }).join(' ')}`
      } catch (e) {
        text = `**${action.label}** failed: ${e instanceof Error ? e.message : String(e)}`
      }
      push(id, { id: messageId('u'), role: 'user', text: action.label, at: Date.now(), streaming: false, action: true })
      busy(id, action.doing)
      later(id, () => {
        idle(id)
        push(id, { id: messageId('a'), role: 'assistant', text, at: Date.now(), streaming: false })
      })
    },
    residentSeen: async (id) => {
      require(id)
      if (!state.residentAttention.delete(id)) return
      changed()
    },
    residentPickFolder: async (id, key) => {
      const config = configOf(id)
      if (!kindOf(config.kind).optionFields.some((f) => f.key === key && f.input === 'folder')) throw new Error(`${config.name} has no folder option ${key}`)
      const folder = state.residentFolder
      if (folder === null) return null
      const residents = state.settings.residents.map((c) => (c.id === id ? { ...c, options: { ...c.options, [key]: folder } } : c))
      state.settings = { ...state.settings, residents }
      return folder
    },
    residentKinds: async () => kindInfos(),
  }
}
