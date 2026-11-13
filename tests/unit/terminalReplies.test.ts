import { describe, it, expect } from 'vitest'
import { asksTerminal, isTerminalReply } from '../../src/main/pty/terminalReplies'

const ESC = '\u001b'

describe('terminal queries and replies on a pty', () => {
  it('sees a query in output: colour, device attributes, cursor and status reports, modes, sizes', () => {
    for (const q of [`${ESC}]11;?${ESC}\\`, `${ESC}]10;?\u0007`, `${ESC}[c`, `${ESC}[0c`, `${ESC}[>c`, `${ESC}[6n`, `${ESC}[5n`, `${ESC}[?2026$p`, `${ESC}[14t`]) {
      expect({ q, asks: asksTerminal(`before${q}after`) }).toEqual({ q, asks: true })
    }
    expect(asksTerminal('plain text, a colour (#0a0e1e), [c] and 6n')).toBe(false)
    expect(asksTerminal(`${ESC}[31mred${ESC}[0m${ESC}[2J`)).toBe(false)
  })

  it('takes only replies for replies: what cswap\'s late answers were, never typed keys or text', () => {
    // The two answers that showed at the prompt after `cswap --switch` in a remote window.
    expect(isTerminalReply(`${ESC}]11;rgb:0a0a/0e0e/1e1e${ESC}\\${ESC}[?1;2c`)).toBe(true)
    expect(isTerminalReply(`${ESC}[12;40R`)).toBe(true)
    expect(isTerminalReply(`${ESC}[0n`)).toBe(true)
    expect(isTerminalReply(`${ESC}[?2026;2$y`)).toBe(true)
    for (const typed of ['ls\r', `${ESC}[A`, `${ESC}[15~`, `${ESC}[200~pasted${ESC}[201~`, `${ESC}[?1;2cls`, 'x']) {
      expect({ typed, reply: isTerminalReply(typed) }).toEqual({ typed, reply: false })
    }
  })
})
