import { createLocalStore } from './createLocalStore'

/** Something the app is doing for the person that takes a while: shown in the status bar. */
export interface Activity {
  id: number
  /** Names what is being done, so a command can tell it is already running (`pull:main`). */
  key: string
  state: 'running' | 'done' | 'failed'
  /** The line shown now: the running label, then the outcome. */
  message: string
  startedAt: number
  endedAt: number | null
  /** What the work rejected with, kept so a click on "failed" can show it again. */
  error?: unknown
}

export interface ActivitySpec<T> {
  /** Names the work for `useActivityRunning`; defaults to the running label. */
  key?: string
  running: string
  done: (result: T) => string
  failed: string
}

/** How long a finished activity stays in the status bar. */
const DONE_VISIBLE_MS = 4000
const FAILED_VISIBLE_MS = 10_000

const store = createLocalStore<readonly Activity[]>([])
let nextId = 1
/** The one timer that drops expired activities; set only while a finished one is waiting. */
let sweeper: number | null = null

const expiresAt = (a: Activity & { endedAt: number }): number =>
  a.endedAt + (a.state === 'done' ? DONE_VISIBLE_MS : FAILED_VISIBLE_MS)

function sweep(): void {
  sweeper = null
  const now = Date.now()
  store.set((all) => {
    const live = all.filter((a) => a.endedAt === null || now < expiresAt({ ...a, endedAt: a.endedAt }))
    return live.length === all.length ? all : live
  })
  const due = store.get().flatMap((a) => (a.endedAt === null ? [] : [expiresAt({ ...a, endedAt: a.endedAt })]))
  if (due.length > 0) sweeper = window.setTimeout(sweep, Math.max(0, Math.min(...due) - now) + 1)
}

function settleActivity(id: number, state: 'done' | 'failed', message: string, error?: unknown): void {
  store.set((all) => all.map((a) => (a.id === id ? { ...a, state, message, error, endedAt: Date.now() } : a)))
  if (sweeper !== null) window.clearTimeout(sweeper)
  sweep()
}

/**
 * Shows `work` in the status bar while it runs and its outcome after, and returns `work`
 * unchanged: a caller's own error handling stays what it was. To track a new kind of work, wrap its
 * promise: `trackActivity({ running: 'Doing X…', done: () => 'Did X', failed: 'X failed' }, p)`.
 */
export function trackActivity<T>(spec: ActivitySpec<T>, work: Promise<T>): Promise<T> {
  const id = nextId++
  store.set((all) => [
    ...all,
    { id, key: spec.key ?? spec.running, state: 'running', message: spec.running, startedAt: Date.now(), endedAt: null },
  ])
  work.then(
    (result) => { settleActivity(id, 'done', spec.done(result)) },
    (error: unknown) => { settleActivity(id, 'failed', spec.failed, error) },
  )
  return work
}

export const useActivities = (): readonly Activity[] => store.useStore()

/** Whether work under `key` is running now; false for a null key. */
export const useActivityRunning = (key: string | null): boolean =>
  store.useStore((all) => key !== null && all.some((a) => a.key === key && a.state === 'running'))

export const activitiesNow = (): readonly Activity[] => store.get()
