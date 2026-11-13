import { describe, it, expect } from 'vitest'
import { takeLinks } from '../../src/main/pty/linkHelper'

const ESC = '\u001b'
const URL_TEXT = 'https://claude.com/cai/oauth/authorize?redirect_uri=http%3A%2F%2Flocalhost%3A42987%2Fcallback'
const seq = (token: string, url: string): string => `${ESC}]7701;${token};${url}\u0007`

describe('links a program asks to open, in its terminal output', () => {
  it('takes a link with this run\'s token out of the output and hands it on', () => {
    expect(takeLinks('', `before${seq('tok', URL_TEXT)}after`, 'tok')).toEqual({ out: 'beforeafter', links: [URL_TEXT], held: '' })
  })

  it('takes out a sequence with another token, and opens nothing for it (a cat of a file)', () => {
    expect(takeLinks('', `a${seq('forged', 'https://evil.example')}b`, 'tok')).toEqual({ out: 'ab', links: [], held: '' })
  })

  it('holds a sequence split across chunks until it ends, at any split point', () => {
    const whole = `x${seq('tok', URL_TEXT)}y`
    for (let cut = 1; cut < whole.length; cut += 1) {
      const first = takeLinks('', whole.slice(0, cut), 'tok')
      const second = takeLinks(first.held, whole.slice(cut), 'tok')
      expect({ cut, out: first.out + second.out, links: [...first.links, ...second.links], held: second.held })
        .toEqual({ cut, out: 'xy', links: [URL_TEXT], held: '' })
    }
  })

  it('leaves other escape sequences and plain output exactly as they were', () => {
    const text = `${ESC}]8;;https://x${ESC}\\link${ESC}]8;;${ESC}\\${ESC}[31mred${ESC}`
    const first = takeLinks('', text, 'tok')
    expect(first.out + takeLinks(first.held, 'm', 'tok').out).toBe(`${text}m`)
  })

  it('passes on an unfinished sequence that runs too long to be a link', () => {
    const long = `${ESC}]7701;tok;${'a'.repeat(9000)}`
    expect(takeLinks('', long, 'tok')).toEqual({ out: long, links: [], held: '' })
  })
})
