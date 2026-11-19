import type { ResidentPending } from '@shared/domain/residents'
import { errorMessage } from '@shared/errors'
import { log } from '../log/logger'

/** One resident's check: its last answer, when it last started, and whether another is owed. */
interface Entry {
  pending: ResidentPending | null
  at: number
  running: boolean
  again: boolean
}

/**
 * The kinds' `pending` checks (the MR desk's unpublished drafts), one at a time per resident. A
 * refresh asked for while one runs runs once more after it, so the last answer is never older than
 * the last change that asked.
 */
export class PendingChecks {
  /** Invalidated by `refresh`: each answer replaces the last; `forget` drops a resident that is gone. */
  private readonly entries = new Map<string, Entry>()

  constructor(private readonly deps: { now: () => number; onChange: () => void }) {}

  of(id: string): ResidentPending | null {
    return this.entries.get(id)?.pending ?? null
  }

  /** Whether `everyMinutes` have passed since the last check started (or none ever did). */
  due(id: string, everyMinutes: number): boolean {
    const entry = this.entries.get(id)
    return entry === undefined || (!entry.running && this.deps.now() - entry.at >= everyMinutes * 60_000)
  }

  refresh(id: string, check: () => Promise<ResidentPending | null>): void {
    const entry = this.entries.get(id) ?? { pending: null, at: 0, running: false, again: false }
    this.entries.set(id, entry)
    if (entry.running) { entry.again = true; return }
    entry.running = true
    entry.at = this.deps.now()
    check().then((pending) => {
      if (JSON.stringify(pending) !== JSON.stringify(entry.pending)) { entry.pending = pending; this.deps.onChange() }
    }, (e: unknown) => {
      // The last answer stays: a network blip must not hide drafts that are still there.
      log.warn('residents', 'pending check failed', { id, error: errorMessage(e).split('\n')[0] ?? '' })
    }).finally(() => {
      entry.running = false
      if (entry.again && this.entries.get(id) === entry) { entry.again = false; this.refresh(id, check) }
    })
  }

  forget(id: string): void {
    this.entries.delete(id)
  }
}
