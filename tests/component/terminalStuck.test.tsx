import { describe, it, expect, vi, afterEach } from 'vitest'
import { page, userEvent } from 'vitest/browser'
import { Terminal } from '@xterm/xterm'
import { renderApp } from './renderApp'
import { until } from './helpers'
import type { FakeApiary } from './fakeApiary'

/**
 * A terminal that takes what you type but never draws again — reported from Ubuntu: keystrokes
 * reached Claude (they were there after closing and reopening the tab), the screen never moved,
 * and the view was stuck at an old, wider size. TerminalView now gives up on a catch-up that never
 * finishes, and rebuilds a view whose xterm stops parsing or drawing.
 */

async function openClaudeTerminal(fake: FakeApiary): Promise<string> {
  const toggle = [...document.querySelectorAll<HTMLElement>('[data-testid="project-toggle"]')]
    .find((t) => t.querySelector('.project-label')?.textContent === 'work-a')
  const button = toggle?.closest('[data-testid="project-group"]')
    ?.querySelector<HTMLElement>('[data-testid="new-session-button"]')
  if (button === null || button === undefined) throw new Error('no new-session-button on work-a')
  await userEvent.click(button)
  await expect.element(page.getByTestId('terminal-session')).toBeVisible()
  await until(() => fake.callsTo('ptySnapshot').length > 0)
  const ptyId = fake.callsTo('ptySnapshot')[0][0] as string
  await userEvent.click(page.getByTestId('terminal-session'))
  return ptyId
}

/** What the terminal has drawn: its rows, not the element's whole text (xterm puts a style block in there). */
const screen = (): string => page.getByTestId('terminal-session').element().querySelector('.xterm-rows')?.textContent ?? ''

const logged = (fake: FakeApiary): string[] => fake.callsTo('logWrite').map((args) => args[2] as string)

describe('a terminal that stops drawing', () => {
  afterEach(() => { vi.restoreAllMocks() })

  it('shows live output and fits the pane even if catching up never finishes', async () => {
    const { fake } = await renderApp()
    // The round trip that never comes back: before, the view queued all output behind it forever.
    fake.override('ptySnapshot', () => new Promise<never>(() => {}))
    const ptyId = await openClaudeTerminal(fake)
    const resizesBefore = fake.callsTo('ptyResize').length

    fake.emit('ptyData', ptyId, 'LIVE_AFTER_A_STALLED_CATCH_UP\r\n')
    await until(() => screen().includes('LIVE_AFTER_A_STALLED_CATCH_UP'), 8000)
    expect(fake.callsTo('ptyResize').length).toBeGreaterThan(resizesBefore)
    expect(logged(fake)).toContain('terminal catch-up stalled; showing live output')
  })

  it('rebuilds a view whose xterm stopped parsing, and the rebuilt one draws', async () => {
    const { fake } = await renderApp()
    const ptyId = await openClaudeTerminal(fake)
    fake.emit('ptyData', ptyId, 'BEFORE\r\n')
    await until(() => screen().includes('BEFORE'))

    // Wedge this view's xterm the way an exception inside its parse loop does: from here on,
    // writes are taken and never parsed, and their callbacks never run.
    // eslint-disable-next-line @typescript-eslint/unbound-method -- captured to call with the real `this`
    const realWrite = Terminal.prototype.write
    let wedged: Terminal | null = null
    vi.spyOn(Terminal.prototype, 'write').mockImplementation(function (this: Terminal, data, callback) {
      // The first xterm to write after this point is the one on screen; it is the one wedged.
      // eslint-disable-next-line @typescript-eslint/no-this-alias -- remembering which instance, not calling through it
      wedged ??= this
      if (this === wedged) return
      realWrite.call(this, data, callback)
    })
    fake.emit('ptyData', ptyId, 'NEVER_DRAWN\r\n')

    await until(() => logged(fake).includes('terminal stopped drawing; rebuilt it'), 10000)
    // The rebuilt view is a fresh xterm on the same pty, and it draws.
    fake.emit('ptyData', ptyId, 'AFTER_REBUILD\r\n')
    await until(() => screen().includes('AFTER_REBUILD'), 8000)
    expect(screen()).not.toContain('NEVER_DRAWN')
  })
})
