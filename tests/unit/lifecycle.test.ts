import { describe, it, expect, vi, beforeEach } from 'vitest'

const handlers = new Map<string, (event: { preventDefault: () => void }) => void>()
const quit = vi.fn<() => void>()
vi.mock('electron', () => ({
  app: {
    on: (event: string, handler: (e: { preventDefault: () => void }) => void) => { handlers.set(event, handler) },
    quit: () => quit(),
  },
}))

const { installQuitDeferral } = await import('../../src/main/app/lifecycle')

function fireBeforeQuit(): { preventDefault: ReturnType<typeof vi.fn> } {
  const event = { preventDefault: vi.fn() }
  handlers.get('before-quit')?.(event)
  return event
}

/** Lets any pending microtasks (the deferred quit's async IIFE) run before assertions. */
async function flush(): Promise<void> {
  await Promise.resolve()
  await Promise.resolve()
  await Promise.resolve()
}

describe('installQuitDeferral (MAIN-15 step 4)', () => {
  beforeEach(() => {
    handlers.clear()
    quit.mockClear()
  })

  it('always prevents the default quit, deferring to its own app.quit() once shutdown finishes', async () => {
    let resolveShutdown: () => void = () => {}
    const shutdown = vi.fn(() => new Promise<void>((resolve) => { resolveShutdown = resolve }))
    installQuitDeferral(shutdown)

    const event = fireBeforeQuit()
    expect(event.preventDefault).toHaveBeenCalled()
    expect(shutdown).toHaveBeenCalledTimes(1)
    expect(quit).not.toHaveBeenCalled()

    resolveShutdown()
    await flush()
    expect(quit).toHaveBeenCalledTimes(1)
  })

  it('a second before-quit while shutdown is still in flight is a no-op (not a second shutdown)', async () => {
    let resolveShutdown: () => void = () => {}
    const shutdown = vi.fn(() => new Promise<void>((resolve) => { resolveShutdown = resolve }))
    installQuitDeferral(shutdown)

    fireBeforeQuit()
    fireBeforeQuit() // e.g. a Cmd+Q on top of a window-close quit already in flight
    expect(shutdown).toHaveBeenCalledTimes(1)

    resolveShutdown()
    await flush()
    expect(quit).toHaveBeenCalledTimes(1)
  })

  it('the real quit this handler issues itself is let through, not deferred again', async () => {
    const shutdown = vi.fn(async () => {})
    installQuitDeferral(shutdown)

    fireBeforeQuit()
    await flush()
    expect(quit).toHaveBeenCalledTimes(1)

    // The real app.quit() call above would fire before-quit again for real; this simulates that.
    const secondEvent = fireBeforeQuit()
    expect(secondEvent.preventDefault).not.toHaveBeenCalled()
    expect(shutdown).toHaveBeenCalledTimes(1)
  })

  it('isQuitting() reflects whether shutdown has started', async () => {
    let resolveShutdown: () => void = () => {}
    const shutdown = vi.fn(() => new Promise<void>((resolve) => { resolveShutdown = resolve }))
    const { isQuitting } = installQuitDeferral(shutdown)

    expect(isQuitting()).toBe(false)
    fireBeforeQuit()
    expect(isQuitting()).toBe(true)
    resolveShutdown()
    await flush()
  })
})
