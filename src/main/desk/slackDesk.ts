import { REGENT_KIND } from '@shared/domain/residents'
import { asSessionId } from '@shared/domain/ids'
import { errorMessage } from '@shared/errors'
import type { SessionEvent } from '../driving/sessionDriver'
import { log } from '../log/logger'
import { createDeskControls } from './deskControls'
import type { DeskParts } from './deskParts'

/** Where the desk's handler sits: after commands (10) and approvals (20). */
const HANDLER_ORDER = 100
const TITLE_SHOWN = 80
const ANSWER_SHOWN = 6000

/** A session's or resident's words, fenced so Regent reads them as data. `>>>` inside cannot close the fence early. */
const fenced = (text: string): string => `<<<UNTRUSTED\n${text.slice(0, ANSWER_SHOWN).replaceAll('>>>', '> > >')}\n>>>`

/**
 * Regent's side of the desk: what the owner writes in Slack goes to Regent as a Slack task, the
 * sessions Regent drives and the residents it asks report back to it as notes, and a Slack turn
 * that ended without a post has its final text posted.
 */
export function slackDesk(parts: DeskParts): () => void {
  const { bridge, driver, residents } = parts
  const tasks = bridge.tasks
  const regentId = (): string | null => residents.names().find((n) => n.kindId === REGENT_KIND)?.id ?? null

  /** The thread of the newest message forwarded to Regent, and the threads Regent posted to since. */
  let lastThread: string | null = null
  const posted = new Set<string>()
  let starting = 0
  let buffered: SessionEvent[] = []
  let release: (() => void) | null = null

  const note = (label: string, text: string): void => {
    const id = regentId()
    if (id === null) return
    try {
      residents.note(id, { label: label.slice(0, 120), text })
    } catch (e) {
      log.warn('slack', 'a note to Regent was refused', { reason: errorMessage(e).slice(0, 100) })
    }
  }

  const handler = async (m: { thread: string; text: string; kind: 'task' | 'reply' }): Promise<boolean> => {
    const id = regentId()
    if (id === null) return false
    tasks.addResident(m.thread, id)
    lastThread = m.thread
    posted.delete(m.thread)
    const text = m.kind === 'task' ? `[Slack task ${m.thread}] ${m.text}` : `[Slack task ${m.thread}, reply] ${m.text}`
    try {
      residents.sendFrom(id, { text, shown: m.text, via: 'slack' })
    } catch (e) {
      await bridge.post(m.thread, errorMessage(e))
    }
    return true
  }

  const heading = (thread: string, e: { sessionId: string; title: string }): string =>
    `[Session event, task ${thread}, session ${e.sessionId} "${e.title.slice(0, TITLE_SHOWN)}"]`

  const dispatch = (e: SessionEvent): void => {
    if (e.kind === 'moved') {
      const task = tasks.taskOfSession(e.from)
      if (task === null) return
      tasks.removeSession(task.thread, e.from)
      tasks.addSession(task.thread, e.sessionId)
      return
    }
    if (e.kind === 'permission' || e.kind === 'permission-gone') return
    const task = tasks.taskOfSession(e.sessionId)
    if (task === null) return
    const head = heading(task.thread, e)
    const quoted = `"${e.title.slice(0, TITLE_SHOWN)}"`
    if (e.kind === 'turn-ended') {
      const extra = `${e.interrupted ? ', interrupted' : ''}${e.backgroundTasks > 0 ? `, ${String(e.backgroundTasks)} background tasks still running` : ''}`
      note(`${quoted} finished a turn`, `${head} Its turn ended${extra}. Its final answer:\n${fenced(e.text)}`)
    } else if (e.kind === 'stopped') {
      note(`${quoted} stopped`, `${head} Its chat stopped${e.reason === null ? '' : `: ${e.reason.slice(0, 300)}`}.`)
    } else {
      note(`${quoted} got your message`, `${head} Your message reached it after its terminal's turn ended.`)
    }
  }

  /** A session started for a task may speak before its id is on the task; its events wait for `startEnded`. */
  const onSessionEvent = (e: SessionEvent): void => {
    if (starting > 0 && e.kind !== 'moved' && tasks.taskOfSession(e.sessionId) === null) { buffered.push(e); return }
    dispatch(e)
  }

  const syncAwake = (): void => {
    const open = tasks.list().some((t) => t.state === 'open')
    const id = regentId()
    if (open && release === null && id !== null) release = residents.keepAwake(id, 'Slack tasks')
    if (!open && release !== null) { release(); release = null }
  }

  const onTurn = (e: { residentId: string; text: string; origin: string }): void => {
    const text = e.text.trim()
    if (e.residentId === regentId()) {
      const thread = lastThread
      const wasPosted = thread !== null && posted.has(thread)
      posted.clear()
      if (e.origin === 'slack' && text !== '' && thread !== null && !wasPosted) {
        bridge.post(thread, e.text).catch((err: unknown) => { log.warn('slack', 'the auto-reply failed', { reason: errorMessage(err).slice(0, 100) }) })
      }
      return
    }
    const task = tasks.taskOfResident(e.residentId)
    if (task === null || text === '') return
    const name = residents.names().find((n) => n.id === e.residentId)?.name ?? 'A resident'
    note(`${name} answered`, `[Resident event, task ${task.thread}] ${name} answered:\n${fenced(e.text)}`)
  }

  const controls = createDeskControls(parts, {
    posted: (task) => { posted.add(task) },
    startBegan: () => { starting += 1 },
    startEnded: () => {
      starting -= 1
      const waiting = buffered
      buffered = []
      for (const e of waiting) onSessionEvent(e)
    },
  })

  for (const task of tasks.list().filter((t) => t.state === 'open')) {
    for (const id of task.sessions) {
      try {
        driver.watch(asSessionId(id))
      } catch {
        tasks.removeSession(task.thread, id)
      }
    }
  }

  const offs = [
    bridge.handle(HANDLER_ORDER, handler),
    driver.onEvent(onSessionEvent),
    residents.onTurnEnded(onTurn),
    tasks.onChanged(syncAwake),
  ]
  residents.setDesk(controls)
  syncAwake()

  return () => {
    residents.setDesk(null)
    for (const off of offs) off()
    release?.()
    release = null
  }
}
