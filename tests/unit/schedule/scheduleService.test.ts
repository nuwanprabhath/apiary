import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { asSessionId, type SessionId } from '@shared/domain/ids'
import type { SchedulesState } from '@shared/domain/schedule'
import { MAX_TIMER_MS, MISSED_AFTER_MS, ScheduleService, type ScheduleServiceDeps } from '../../../src/main/schedule/scheduleService'
import type { OsScheduler } from '../../../src/main/schedule/osScheduler'
import type { JobLaunch, JobResult } from '../../../src/main/schedule/scheduledJobs'
import type { ScheduleFile } from '../../../src/main/schedule/scheduleStore'

const MINUTE = 60_000
const START = Date.parse('2026-11-16T10:00:00Z')
const SESSION = asSessionId('11111111-1111-1111-1111-111111111111')

function world(o: { file?: ScheduleFile; osJobs?: boolean; deliver?: (id: SessionId, text: string) => Promise<void>; reset?: ReturnType<ScheduleServiceDeps['limitResetsAt']> } = {}) {
  let saved: ScheduleFile = o.file ?? { messages: [], notices: [] }
  const os = { registered: new Map<string, number>(), removed: [] as string[] }
  const files = { written: new Map<string, JobLaunch>(), results: new Map<string, JobResult>(), running: new Map<string, number>(), removed: [] as string[] }
  const sent: Array<[string, string]> = []
  const events: SchedulesState[] = []
  const scheduler: OsScheduler = {
    kind: 'launchd',
    available: async () => o.osJobs ?? true,
    register: async (id, at) => { os.registered.set(id, at) },
    remove: async (id) => { os.removed.push(id); os.registered.delete(id) },
  }
  const service = new ScheduleService({
    store: { load: () => saved, save: (f) => { saved = structuredClone(f) } },
    os: scheduler,
    jobs: {
      write: (id, launch) => { files.written.set(id, launch) },
      remove: (id) => { files.removed.push(id); files.written.delete(id) },
      result: (id) => files.results.get(id) ?? null,
      runningSince: (id) => files.running.get(id) ?? null,
      logTail: () => '',
    },
    session: (id) => {
      if (id !== SESSION) throw new Error(`Unknown session: ${id}`)
      return { cwd: '/work/a', account: 'main' }
    },
    launch: () => ({ claudeBin: 'claude', shell: '/bin/zsh', env: {} }),
    deliver: o.deliver ?? (async (id, text) => { sent.push([id, text]) }),
    limitResetsAt: () => o.reset ?? null,
    onChanged: (state) => { events.push(state) },
  })
  return { service, os, files, sent, events, saved: () => saved }
}

beforeEach(() => { vi.useFakeTimers({ now: START }) })
afterEach(() => { vi.useRealTimers() })

describe('ScheduleService', () => {
  it('saves a schedule, writes its job file, registers its OS job and tells the windows', async () => {
    const w = world()
    await w.service.start()
    const message = await w.service.set({ id: null, sessionId: SESSION, text: ' continue ', at: START + 30 * MINUTE })
    expect(message.text).toBe('continue')
    expect(w.saved().messages).toEqual([message])
    expect(w.os.registered.get(message.id)).toBe(START + 30 * MINUTE)
    expect(w.files.written.get(message.id)).toMatchObject({ sessionId: SESSION, cwd: '/work/a', text: 'continue', jobKind: 'launchd' })
    expect(w.events.at(-1)?.messages.map((m) => m.id)).toEqual([message.id])
  })

  it('refuses blank or long text, a past or far time, an unknown session and a schedule that is gone', async () => {
    const w = world()
    await w.service.start()
    const soon = START + MINUTE
    await expect(w.service.set({ id: null, sessionId: SESSION, text: '  ', at: soon })).rejects.toThrow('Type the message')
    await expect(w.service.set({ id: null, sessionId: SESSION, text: 'x'.repeat(10_001), at: soon })).rejects.toThrow('at most')
    await expect(w.service.set({ id: null, sessionId: SESSION, text: 'go', at: START })).rejects.toThrow('future')
    await expect(w.service.set({ id: null, sessionId: SESSION, text: 'go', at: START + 31 * 24 * 60 * MINUTE })).rejects.toThrow('30 days')
    await expect(w.service.set({ id: null, sessionId: asSessionId('nope'), text: 'go', at: soon })).rejects.toThrow('Unknown session')
    await expect(w.service.set({ id: '00000000-0000-4000-8000-000000000000', sessionId: SESSION, text: 'go', at: soon })).rejects.toThrow('gone')
    expect(w.saved().messages).toEqual([])
  })

  it('fires when due: removes the OS job first, then delivers, then forgets the record', async () => {
    const order: string[] = []
    const w = world({ deliver: async (_id, text) => { order.push(`deliver ${text}`) } })
    await w.service.start()
    const message = await w.service.set({ id: null, sessionId: SESSION, text: 'continue', at: START + 2 * MINUTE })
    const removeBefore = w.os.removed.length
    await vi.advanceTimersByTimeAsync(2 * MINUTE - 1000)
    expect(order).toEqual([])
    await vi.advanceTimersByTimeAsync(1000)
    expect(order).toEqual(['deliver continue'])
    expect(w.os.removed.slice(removeBefore)).toEqual([message.id])
    expect(w.saved().messages).toEqual([])
    expect(w.events.at(-1)?.messages).toEqual([])
  })

  it('never waits on one timer longer than its cap, so a schedule days away is re-armed on the way', async () => {
    const w = world()
    await w.service.start()
    await w.service.set({ id: null, sessionId: SESSION, text: 'later', at: START + 3 * 24 * 60 * MINUTE })
    expect(vi.getTimerCount()).toBe(1)
    await vi.advanceTimersByTimeAsync(MAX_TIMER_MS)
    expect(vi.getTimerCount()).toBe(1)
    expect(w.sent).toEqual([])
    await vi.advanceTimersByTimeAsync(3 * 24 * 60 * MINUTE)
    expect(w.sent).toEqual([[SESSION, 'later']])
  })

  it('an edit re-arms: the old time passes quietly and the new one fires', async () => {
    const w = world()
    await w.service.start()
    const first = await w.service.set({ id: null, sessionId: SESSION, text: 'one', at: START + 2 * MINUTE })
    await w.service.set({ id: first.id, sessionId: SESSION, text: 'two', at: START + 4 * MINUTE })
    await vi.advanceTimersByTimeAsync(3 * MINUTE)
    expect(w.sent).toEqual([])
    await vi.advanceTimersByTimeAsync(MINUTE)
    expect(w.sent).toEqual([[SESSION, 'two']])
  })

  it('a cancel removes the OS job and the files, and nothing is sent', async () => {
    const w = world()
    await w.service.start()
    const message = await w.service.set({ id: null, sessionId: SESSION, text: 'continue', at: START + 2 * MINUTE })
    await w.service.cancel(message.id)
    expect(w.os.registered.has(message.id)).toBe(false)
    expect(w.files.removed).toContain(message.id)
    await vi.advanceTimersByTimeAsync(5 * MINUTE)
    expect(w.sent).toEqual([])
  })

  it('a failed delivery becomes a notice in that chat', async () => {
    const w = world({ deliver: async () => { throw new Error('This session is not running.') } })
    await w.service.start()
    const message = await w.service.set({ id: null, sessionId: SESSION, text: 'continue', at: START + MINUTE })
    await vi.advanceTimersByTimeAsync(MINUTE)
    expect(w.saved().notices).toEqual([expect.objectContaining({ id: message.id, ok: false, whileClosed: false, detail: 'This session is not running.' })])
  })

  it('on start: overdue by under 12 hours fires at once; older is marked missed, shown and never sent', async () => {
    const recent = { id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', sessionId: SESSION, text: 'recent', at: START - 60 * MINUTE, createdAt: START - 120 * MINUTE }
    const old = { id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', sessionId: SESSION, text: 'old', at: START - MISSED_AFTER_MS - MINUTE, createdAt: START - MISSED_AFTER_MS - 120 * MINUTE }
    const w = world({ file: { messages: [recent, old], notices: [] } })
    await w.service.start()
    await vi.advanceTimersByTimeAsync(0)
    expect(w.sent).toEqual([[SESSION, 'recent']])
    expect(w.saved().messages).toEqual([{ ...old, missed: true }])
    expect(w.os.removed).toContain(old.id)
    await vi.advanceTimersByTimeAsync(24 * 60 * MINUTE)
    expect(w.sent).toEqual([[SESSION, 'recent']])
    await w.service.sendNow(old.id)
    expect(w.sent).toEqual([[SESSION, 'recent'], [SESSION, 'old']])
  })

  it('on start, what the OS job sent while Apiary was closed becomes a notice, and is not sent again', async () => {
    const message = { id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', sessionId: SESSION, text: 'continue', at: START - 10 * MINUTE, createdAt: START - 60 * MINUTE }
    const w = world({ file: { messages: [message], notices: [] } })
    w.files.results.set(message.id, { code: 0, at: START - 9 * MINUTE, logTail: 'done' })
    await w.service.start()
    await vi.advanceTimersByTimeAsync(MINUTE)
    expect(w.sent).toEqual([])
    expect(w.saved().messages).toEqual([])
    expect(w.saved().notices).toEqual([{ id: message.id, sessionId: SESSION, text: 'continue', at: START - 9 * MINUTE, ok: true, whileClosed: true, detail: null }])
    expect(w.files.removed).toContain(message.id)
  })

  it('a failed OS-job send keeps the end of its log as the notice detail', async () => {
    const message = { id: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd', sessionId: SESSION, text: 'continue', at: START - 10 * MINUTE, createdAt: START - 60 * MINUTE }
    const w = world({ file: { messages: [message], notices: [] } })
    w.files.results.set(message.id, { code: 1, at: START - 9 * MINUTE, logTail: 'Error: rate limited' })
    await w.service.start()
    expect(w.saved().notices[0]).toMatchObject({ ok: false, detail: 'Error: rate limited' })
  })

  it('while the OS job is sending one, Apiary does not send it too', async () => {
    const message = { id: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee', sessionId: SESSION, text: 'continue', at: START - MINUTE, createdAt: START - 60 * MINUTE }
    const w = world({ file: { messages: [message], notices: [] } })
    w.files.running.set(message.id, START - 30_000)
    await w.service.start()
    await vi.advanceTimersByTimeAsync(MINUTE)
    expect(w.sent).toEqual([])
    w.files.running.delete(message.id)
    w.files.results.set(message.id, { code: 0, at: START + 50_000, logTail: '' })
    await vi.advanceTimersByTimeAsync(MINUTE)
    expect(w.sent).toEqual([])
    expect(w.saved().notices.map((n) => n.id)).toEqual([message.id])
  })

  it('while the OS job is sending a due one, Apiary looks again every 30 seconds, not in a loop', async () => {
    const message = { id: 'abababab-abab-4bab-8bab-abababababab', sessionId: SESSION, text: 'continue', at: START - MINUTE, createdAt: START - 60 * MINUTE }
    const w = world({ file: { messages: [message], notices: [] } })
    w.files.running.set(message.id, START - 30_000)
    let looks = 0
    const runningSince = w.files.running.get.bind(w.files.running)
    w.files.running.get = (id) => { looks += 1; return runningSince(id) }
    await w.service.start()
    looks = 0
    await vi.advanceTimersByTimeAsync(MINUTE)
    expect(looks).toBeLessThanOrEqual(6)
    expect(w.sent).toEqual([])
  })

  it('a cancel dismisses a notice', async () => {
    const notice = { id: 'ffffffff-ffff-4fff-8fff-ffffffffffff', sessionId: SESSION, text: 'continue', at: START, ok: true, whileClosed: true, detail: null }
    const w = world({ file: { messages: [], notices: [notice] } })
    await w.service.start()
    await w.service.cancel(notice.id)
    expect(w.saved().notices).toEqual([])
  })

  it('with no OS scheduler it registers nothing and says so', async () => {
    const w = world({ osJobs: false })
    await w.service.start()
    await w.service.set({ id: null, sessionId: SESSION, text: 'continue', at: START + MINUTE })
    expect(w.os.registered.size).toBe(0)
    expect(w.files.written.size).toBe(0)
    expect(w.service.state().osJobs).toBe(false)
  })

  it('resume after sleep fires what came due meanwhile', async () => {
    const w = world()
    await w.service.start()
    await w.service.set({ id: null, sessionId: SESSION, text: 'continue', at: START + MINUTE })
    vi.setSystemTime(START + 10 * MINUTE)
    w.service.resume()
    await vi.advanceTimersByTimeAsync(0)
    expect(w.sent).toEqual([[SESSION, 'continue']])
  })

  describe('the suggested time', () => {
    it('is five minutes after a known reset', async () => {
      const w = world({ reset: { at: START + 90 * MINUTE, source: 'usage' } })
      expect(w.service.defaultFor(SESSION)).toEqual({ at: START + 95 * MINUTE, source: 'usage', resetsAt: START + 90 * MINUTE })
    })

    it('is an hour from now, rounded up to five minutes, with no reset or a long-past one', async () => {
      vi.setSystemTime(START + 2 * MINUTE)
      expect(world().service.defaultFor(SESSION)).toEqual({ at: START + 65 * MINUTE, source: 'hour', resetsAt: null })
      expect(world({ reset: { at: START - 60 * MINUTE, source: 'transcript' } }).service.defaultFor(SESSION).source).toBe('hour')
    })
  })
})
