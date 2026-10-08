import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { SessionWatcher, type WatchFn } from '../../src/main/sessions/sessionWatcher'

/** A minimal fake chokidar watcher: records the listeners it was given and lets a test fire them
 *  directly, with no real filesystem or timers of its own. */
function fakeWatch(): { watchFn: WatchFn; emit: (event: string, path: string) => void; closed: boolean; opts: unknown } {
  const listeners = new Map<string, (path: string) => void>()
  const state = { closed: false, opts: undefined as unknown }
  const watchFn: WatchFn = (_dir, opts) => {
    state.opts = opts
    const fakeWatcher = {
      on: (event: string, fn: (path: string) => void) => {
        listeners.set(event, fn)
        return fakeWatcher
      },
      close: async () => { state.closed = true },
    }
    return fakeWatcher as never
  }
  return {
    watchFn,
    emit: (event, path) => listeners.get(event)?.(path),
    get closed() { return state.closed },
    get opts() { return state.opts },
  }
}

/** A started watcher: construction alone opens nothing. */
function started(options: ConstructorParameters<typeof SessionWatcher>[0]): SessionWatcher {
  const watcher = new SessionWatcher(options)
  watcher.start()
  return watcher
}

beforeEach(() => { vi.useFakeTimers() })
afterEach(() => { vi.useRealTimers() })

describe('SessionWatcher', () => {
  it('coalesces several changes within the debounce window into one call', () => {
    const fake = fakeWatch()
    const onChange = vi.fn()
    const watcher = started({ dir: '/fake', onChange, watch: fake.watchFn, debounceMs: 1000 })

    fake.emit('add', '/fake/a/1.jsonl')
    vi.advanceTimersByTime(500)
    fake.emit('change', '/fake/b/2.jsonl')
    vi.advanceTimersByTime(999)
    expect(onChange).not.toHaveBeenCalled()
    vi.advanceTimersByTime(1)
    expect(onChange).toHaveBeenCalledTimes(1)
    expect(onChange).toHaveBeenCalledWith(['/fake/a/1.jsonl', '/fake/b/2.jsonl'])

    watcher.dispose()
  })

  it('starts a fresh batch after a call has fired', () => {
    const fake = fakeWatch()
    const onChange = vi.fn()
    started({ dir: '/fake', onChange, watch: fake.watchFn, debounceMs: 1000 })

    fake.emit('unlink', '/fake/a/1.jsonl')
    vi.advanceTimersByTime(1000)
    fake.emit('add', '/fake/a/2.jsonl')
    vi.advanceTimersByTime(1000)

    expect(onChange).toHaveBeenNthCalledWith(1, ['/fake/a/1.jsonl'])
    expect(onChange).toHaveBeenNthCalledWith(2, ['/fake/a/2.jsonl'])
  })

  it('dispose clears a pending timer and closes the underlying watcher', () => {
    const fake = fakeWatch()
    const onChange = vi.fn()
    const watcher = started({ dir: '/fake', onChange, watch: fake.watchFn, debounceMs: 1000 })

    fake.emit('add', '/fake/a/1.jsonl')
    watcher.dispose()
    vi.advanceTimersByTime(2000)

    expect(onChange).not.toHaveBeenCalled()
    expect(fake.closed).toBe(true)
  })

  it('only ever watches depth 1 and filters non-jsonl files (MAIN-25)', () => {
    const fake = fakeWatch()
    started({ dir: '/fake', onChange: vi.fn(), watch: fake.watchFn })
    const opts = fake.opts as { depth: number; ignored: (p: string, s?: { isFile(): boolean }) => boolean }
    expect(opts.depth).toBe(1)
    expect(opts.ignored('/fake/a/notes.txt', { isFile: () => true })).toBe(true)
    expect(opts.ignored('/fake/a/session.jsonl', { isFile: () => true })).toBe(false)
    expect(opts.ignored('/fake/a', { isFile: () => false })).toBe(false)
  })

  it('opens nothing until started, and a second start does not watch twice', () => {
    let opened = 0
    const fake = fakeWatch()
    const watchFn: WatchFn = (dir, opts) => { opened++; return fake.watchFn(dir, opts) }
    const watcher = new SessionWatcher({ dir: '/fake', onChange: vi.fn(), watch: watchFn })
    expect(opened).toBe(0)
    watcher.start()
    watcher.start()
    expect(opened).toBe(1)
    watcher.dispose()
    expect(fake.closed).toBe(true)
  })
})
