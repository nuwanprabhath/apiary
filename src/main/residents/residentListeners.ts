import { errorMessage } from '@shared/errors'
import { log } from '../log/logger'

/** A set of listeners; one that throws is logged and does not stop the others. */
export class Listeners<A extends unknown[]> {
  private readonly fns = new Set<(...args: A) => void>()

  /** Returns how to remove it. */
  add(fn: (...args: A) => void): () => void {
    this.fns.add(fn)
    return () => { this.fns.delete(fn) }
  }

  emit(...args: A): void {
    for (const fn of [...this.fns]) {
      try { fn(...args) } catch (e) { log.warn('residents', 'a listener threw', { error: errorMessage(e) }) }
    }
  }
}
