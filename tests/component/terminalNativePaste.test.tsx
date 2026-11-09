import { asPtyId } from '@shared/domain/ids'
import { describe, it, expect } from 'vitest'
import { page, userEvent } from 'vitest/browser'
import { renderApp } from './renderApp'
import { until } from './helpers'
import type { FakeApiary } from './fakeApiary'

/**
 * SEC-6: a paste that reaches xterm's hidden textarea as a native DOM `paste` event never goes
 * through our paste path. Edit > Paste (`role: 'editMenu'`), Shift+Insert and Linux middle-click all
 * arrive that way, and xterm's own handler brackets the text but keeps every ESC in it, so an
 * `ESC[201~` inside the clipboard ends the bracket early and what follows runs as keystrokes.
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

const writes = (fake: FakeApiary): string[] => fake.callsTo('ptyWrite').map((args) => args[1] as string)

/** What the OS does for Edit > Paste: a cancelable `paste` event on the focused textarea. */
function nativePaste(text: string): ClipboardEvent {
  const textarea = page.getByTestId('terminal-session').element().querySelector('textarea')
  if (textarea === null) throw new Error('the terminal has no textarea')
  const data = new DataTransfer()
  data.setData('text/plain', text)
  const event = new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true })
  textarea.dispatchEvent(event)
  return event
}

const ESC = '\x1b'
const PAYLOAD = `${ESC}[201~rm -rf /tmp/x`

describe('a native paste into a terminal (SEC-6)', () => {
  it('reaches the pty with every ESC stripped, once, and the native default is cancelled', async () => {
    const { fake } = await renderApp()
    await openClaudeTerminal(fake)

    const event = nativePaste(PAYLOAD)

    await until(() => writes(fake).length > 0)
    expect(writes(fake).join('')).toBe('␛[201~rm -rf /tmp/x')
    expect(event.defaultPrevented).toBe(true)
  })

  it('is bracketed exactly once when the program asked for bracketed paste', async () => {
    const { fake } = await renderApp()
    const ptyId = await openClaudeTerminal(fake)
    // xterm parses written data later, in order: its reply to the status query (`ESC[5n` → `ESC[0n`)
    // reaching the pty means the mode switch before it has been parsed.
    fake.emit('ptyData', asPtyId(ptyId), `${ESC}[?2004h${ESC}[5n`)
    await until(() => writes(fake).includes(`${ESC}[0n`))
    const before = writes(fake).length

    nativePaste(PAYLOAD)

    await until(() => writes(fake).length > before)
    const sent = writes(fake).slice(before).join('')
    expect(sent).toBe(`${ESC}[200~␛[201~rm -rf /tmp/x${ESC}[201~`)
    expect(sent.split(`${ESC}[201~`)).toHaveLength(2)
  })
})
