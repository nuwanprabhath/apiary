import { afterEach, beforeEach, vi } from 'vitest'
import { EventEmitter } from 'node:events'
import { PassThrough } from 'node:stream'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { DigestLookback, ResidentConfig, ResidentStatus } from '@shared/domain/residents'
import { ResidentService, type ResidentSettings, type RunCommand } from '../../../src/main/residents/residentService'
import type { DigestJob, SessionKnowledge } from '../../../src/main/knowledge/types'
import { kindOf, type ResidentKind } from '../../../src/main/residents/kinds'

// Friday 2026-10-30, local time.
export const FRIDAY = (hh: number, mm = 0): Date => new Date(2026, 9, 30, hh, mm)

export const regent = (over: Partial<ResidentConfig> = {}): ResidentConfig => ({
  id: 'regent', kind: 'regent', name: 'Regent', enabled: true, model: 'sonnet', digestModel: 'haiku',
  schedule: { days: [1, 2, 3, 4, 5], start: '09:00', end: '18:00' }, pauseAboveUsagePercent: 70,
  permissionMode: 'auto', digestLookback: null, options: {}, cycleEveryMinutes: null, ...over,
})

function memorySettings(initial: ResidentConfig[]): ResidentSettings & { list: ResidentConfig[]; change: (l: ResidentConfig[]) => void } {
  const listeners = new Set<() => void>()
  const s = {
    list: initial,
    get: () => s.list,
    set: (l: ResidentConfig[]) => { s.change(l) },
    onChange: (fn: () => void) => { listeners.add(fn); return () => { listeners.delete(fn) } },
    change: (l: ResidentConfig[]) => { s.list = l; for (const fn of listeners) fn() },
  }
  return s
}

function fakeDigest(): DigestJob & { calls: string[]; emit: (a: string | null) => void; shouldPause: (() => boolean) | null } {
  const listeners = new Set<(a: string | null) => void>()
  const d = {
    calls: [] as string[],
    shouldPause: null as (() => boolean) | null,
    resume: (o: { model: string; lookback: DigestLookback | null; shouldPause: () => boolean }) => {
      d.calls.push(`resume:${o.model}${o.lookback === null ? '' : `:${String(o.lookback.amount)}${o.lookback.unit}`}`)
      d.shouldPause = o.shouldPause
    },
    pause: () => { d.calls.push('pause') },
    reset: async () => { d.calls.push('reset') },
    progress: () => ({ done: 1, total: 3 }),
    indexSize: () => ({ sessions: 40, topics: 160 }),
    onActivity: (fn: (a: string | null) => void) => { listeners.add(fn); return () => { listeners.delete(fn) } },
    emit: (a: string | null) => { for (const fn of listeners) fn(a) },
  }
  return d
}

/** A claude that starts and says nothing unless a test writes its stdout; a kill ends it as SIGTERM would. */
export const spawned: string[][] = []
export const children: { stdin: PassThrough; stdout: PassThrough; written: string[] }[] = []
function quietChild(_file: string, args: string[]): never {
  spawned.push(args)
  const events = new EventEmitter()
  const stdin = new PassThrough()
  const stdout = new PassThrough()
  const written: string[] = []
  stdin.setEncoding('utf8')
  stdin.on('data', (chunk: string) => { written.push(...chunk.split('\n').filter((l) => l !== '')) })
  children.push({ stdin, stdout, written })
  const child = Object.assign(events, {
    stdin, stdout, stderr: new PassThrough(), pid: 4242,
    kill: () => { setTimeout(() => events.emit('exit', 143, null), 0); return true },
  })
  return child as never
}

export let dir: string
let services: ResidentService[] = []
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'apiary-residents-'))
  spawned.length = 0
  children.length = 0
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'] })
})
afterEach(async () => {
  // Real timers first: stopping a process waits on its grace timer.
  vi.useRealTimers()
  for (const s of services) await s.dispose()
  services = []
  rmSync(dir, { recursive: true, force: true })
})

export function build(configs: ResidentConfig[], opts: { usage?: number | null; kinds?: Partial<ResidentKind>; run?: RunCommand; knowledge?: SessionKnowledge } = {}) {
  const settings = memorySettings(configs)
  const digest = fakeDigest()
  const changes: ResidentStatus[][] = []
  const service = new ResidentService({
    settings, root: dir, knowledge: opts.knowledge ?? null, digest,
    usagePercent: () => opts.usage ?? null,
    claudeBin: () => 'claude',
    launchEnv: () => ({}),
    tools: { session: () => null, openSession: () => {}, openTabs: () => [], focusedWindow: () => null },
    onChanged: (s) => { changes.push(s) },
    onMessage: () => {},
    version: '0.0.0',
    spawn: quietChild,
    kindOf: (id) => ({ ...kindOf(id), ...opts.kinds }),
    ...(opts.run !== undefined ? { run: opts.run } : {}),
  })
  services.push(service)
  return { service, settings, digest, changes }
}
