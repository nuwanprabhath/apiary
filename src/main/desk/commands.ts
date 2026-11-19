import { asSessionId } from '@shared/domain/ids'
import { ignoreErrors } from '@shared/ignoreErrors'
import { cardsWaiting } from './approvals'
import type { DeskParts, DeskPiece } from './deskPiece'

const STATUS = /^[/!]?status$/i
const TITLE_MAX = 80
const SESSION_STATUS_TEXT = { working: 'working', waiting: 'waiting for you', idle: 'idle', stopped: 'stopped', unknown: 'not watched' } as const

function howLong(ms: number): string {
  const minutes = Math.floor(ms / 60_000)
  if (minutes < 1) return 'under a minute'
  if (minutes < 60) return `${String(minutes)} min`
  return `${String(Math.floor(minutes / 60))} h ${String(minutes % 60)} min`
}

/** `status` in the channel lists what runs and waits; `stop` in a task's thread interrupts its sessions and residents. */
export const commands: DeskPiece = ({ bridge, driver, residents }: DeskParts) => {
  const status = async (thread: string): Promise<void> => {
    const lines: string[] = []
    const open = bridge.tasks.list().filter((t) => t.state === 'open' && t.thread !== thread)
    if (open.length === 0) lines.push('No open tasks.')
    for (const t of open) {
      lines.push(`• ${t.text.slice(0, TITLE_MAX)}`)
      for (const id of t.sessions) {
        const s = driver.stateOf(asSessionId(id))
        const since = s.since === null ? '' : `, ${howLong(Date.now() - s.since)}`
        lines.push(`    ${s.title}: ${SESSION_STATUS_TEXT[s.status]}${since}`)
      }
    }
    for (const r of residents.names()) lines.push(`${r.name}: ${r.state}`)
    lines.push(`${String(cardsWaiting(bridge))} waiting for you.`)
    try { await bridge.post(thread, lines.join('\n')) } finally { bridge.tasks.finish(thread) }
  }

  return bridge.handle(10, async (m) => {
    const text = m.text.trim()
    if (m.kind === 'task' && STATUS.test(text)) { await status(m.thread); return true }
    if (m.kind !== 'reply' || text.toLowerCase().replace(/[^a-z]/g, '') !== 'stop') return false
    const task = bridge.tasks.get(m.thread)
    if (task === null) return false
    for (const id of task.sessions) driver.interrupt(asSessionId(id))
    for (const id of task.residents) ignoreErrors(() => { residents.stop(id) }, 'a resident that is gone has nothing to stop')
    await bridge.post(m.thread, 'Stopped. The task stays open; reply here to carry on.')
    return true
  })
}
