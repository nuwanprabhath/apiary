import { asPtyId } from '@shared/domain/ids'
import { describe, it, expect, afterEach, vi } from 'vitest'
import { renderApp } from './renderApp'
import { mouse, openClaudeTerminal, until } from './helpers'
import { clipboardWriteText } from '../../src/renderer/features/terminal/terminalLinks'

const ESC = '\x1b'
const BEL = '\x07'
const URL_TEXT = 'https://claude.com/cai/oauth/authorize?code=true&state=abc'
const b64 = (text: string): string => btoa(String.fromCharCode(...new TextEncoder().encode(text)))

afterEach(() => { vi.restoreAllMocks() })

/** Where `text` is drawn in the terminal's rows. A row's text can be split over several spans,
 *  so the row's text nodes are joined and the range runs from the first character to the last. */
function textRect(text: string): DOMRect | null {
  const rows = document.querySelectorAll('[data-testid="terminal-session"] .xterm-rows > div')
  for (const row of rows) {
    const nodes: Text[] = []
    const walker = document.createTreeWalker(row, NodeFilter.SHOW_TEXT)
    for (let n = walker.nextNode(); n !== null; n = walker.nextNode()) nodes.push(n as Text)
    const at = nodes.map((n) => n.data).join('').replace(/\u00a0/g, ' ').indexOf(text) // xterm draws a space as U+00A0
    if (at === -1) continue
    const locate = (offset: number): [Text, number] => {
      let left = offset
      for (const n of nodes) {
        if (left <= n.data.length) return [n, left]
        left -= n.data.length
      }
      throw new Error('offset past the row')
    }
    const range = document.createRange()
    range.setStart(...locate(at))
    range.setEnd(...locate(at + text.length))
    return range.getBoundingClientRect()
  }
  return null
}

describe('a link or a copy a program makes in the terminal (Claude\'s sign-in URL)', () => {
  it('a click on an OSC 8 link opens that URL itself, so the window\'s guard can send it to the browser', async () => {
    // xterm's own handler opened a blank window and set its address afterwards; the navigation
    // guard refuses a blank window, so the click did nothing, in a remote window too.
    const opened: string[] = []
    vi.spyOn(window, 'open').mockImplementation((url?: string | URL) => { opened.push(String(url)); return null })
    const { fake } = await renderApp()
    const ptyId = await openClaudeTerminal(fake)
    fake.emit('ptyData', asPtyId(ptyId), `${ESC}]8;;${URL_TEXT}${BEL}Sign in here${ESC}]8;;${BEL}\r\n`)
    await until(() => textRect('Sign in here') !== null)
    const r = textRect('Sign in here')!
    await mouse.move(r.x + r.width / 2, r.y + r.height / 2, 3)
    // xterm finds the link under the pointer after the move, and shows it with a pointer cursor.
    await until(() => document.querySelector('[data-testid="terminal-session"] .xterm-cursor-pointer') !== null)
    await mouse.down()
    await mouse.up()
    await until(() => opened.length > 0)
    expect(opened).toEqual([URL_TEXT])
  })

  it('an OSC 52 write ("c to copy") puts the text on this machine\'s clipboard', async () => {
    const { fake } = await renderApp()
    const ptyId = await openClaudeTerminal(fake)
    fake.emit('ptyData', asPtyId(ptyId), `${ESC}]52;c;${b64(URL_TEXT)}${BEL}`)
    await until(() => fake.state.copied.length > 0)
    expect(fake.state.copied).toEqual([URL_TEXT])
  })

  it('reads an OSC 52 write, refuses a read and data that is not base64 text', () => {
    expect(clipboardWriteText(`c;${b64('héllo')}`)).toBe('héllo')
    expect(clipboardWriteText(`;${b64('x')}`)).toBe('x')
    expect(clipboardWriteText('c;?')).toBeNull()
    expect(clipboardWriteText('c;not base64!')).toBeNull()
    expect(clipboardWriteText(`c;${btoa('\xff\xfe')}`)).toBeNull()
    expect(clipboardWriteText('nosemicolon')).toBeNull()
  })
})
