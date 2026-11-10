import { describe, it, expect } from 'vitest'
import { renderApp } from './renderApp'
import { asLinux } from './platform'
import { createTerminalKeyHandler } from '../../src/renderer/features/terminal/terminalKeys'
import type { Terminal } from '@xterm/xterm'

/** A key held down on Linux through XWayland can repeat when the release is late. */

function keydown(init: KeyboardEventInit): KeyboardEvent {
  return new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init })
}

describe('a held paste shortcut', () => {
  it('is cancelled in a text field, the first press is not', async () => {
    asLinux()
    await renderApp()
    const area = document.createElement('textarea')
    document.body.append(area)
    const first = keydown({ key: 'v', ctrlKey: true })
    const held = keydown({ key: 'v', ctrlKey: true, repeat: true })
    const shiftInsert = keydown({ key: 'Insert', shiftKey: true, repeat: true })
    const letter = keydown({ key: 'v', repeat: true })
    for (const e of [first, held, shiftInsert, letter]) area.dispatchEvent(e)
    expect([first.defaultPrevented, held.defaultPrevented, shiftInsert.defaultPrevented, letter.defaultPrevented])
      .toEqual([false, true, true, false])
    area.remove()
  })

  it('returns false from the terminal key handler and does not paste', () => {
    asLinux()
    const handler = createTerminalKeyHandler({ hasSelection: () => false } as unknown as Terminal, {
      renameKey: () => undefined, claude: () => false, suspended: () => false, askSuspend: () => undefined,
    })
    const held = keydown({ key: 'V', ctrlKey: true, shiftKey: true, repeat: true })
    expect(handler(held)).toBe(false)
    expect(held.defaultPrevented).toBe(true)
  })
})
