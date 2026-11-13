import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { ESC } from '@shared/pasteSafe'

/**
 * Links a program asks to open (`$BROWSER <url>`: Claude Code's sign-in page) reach the window
 * showing its terminal, so a remote window opens them on the home machine.
 *
 * Every pty gets `BROWSER` = the helper script below and `APIARY_LINK_TOKEN`. The script writes the
 * link to its own terminal as `ESC ] 7701 ; <token> ; <url> BEL`; `PtyManager` takes every such
 * sequence out of the output, and hands on the links whose token is this run's. Text that only
 * prints the sequence (a `cat` of a file) has no token, so it opens nothing.
 */
export interface LinkHelper {
  /** The script `BROWSER` names. */
  browser: string
  /** This run's secret, in every pty's environment. */
  token: string
}

const OSC_START = `${ESC}]7701;`
const BEL = '\u0007'
/** An unfinished sequence longer than this is not a link: it is passed on rather than held. */
const MAX_HELD = 8192

const SCRIPT = `#!/bin/sh
# Apiary: opens a link in the window showing this terminal (a remote window: on your own machine).
[ -n "$1" ] && [ -n "$APIARY_LINK_TOKEN" ] || exit 1
printf '\\033]7701;%s;%s\\007' "$APIARY_LINK_TOKEN" "$1" > /dev/tty
`

/** Writes the helper script into `dir` with `write` (`writeExecutableText`; rewritten every launch) and returns its path. */
export function writeLinkHelper(dir: string, write: (file: string, text: string) => void): string {
  mkdirSync(dir, { recursive: true })
  const file = join(dir, 'apiary-browser')
  write(file, SCRIPT)
  return file
}

/** The environment a pty gets so `$BROWSER` reaches Apiary. */
export function linkHelperEnv(helper: LinkHelper): Record<string, string> {
  return { BROWSER: helper.browser, APIARY_LINK_TOKEN: helper.token }
}

export interface TakenLinks {
  /** The output with every link sequence taken out. */
  out: string
  /** The links that carried the token, in order. */
  links: string[]
  /** The start of a sequence the chunk ended in, held for the next chunk. */
  held: string
}

/** Takes the link sequences out of a chunk of pty output (`held` is what the last chunk left over). */
export function takeLinks(held: string, data: string, token: string): TakenLinks {
  let text = held + data
  if (!text.includes(OSC_START) && !OSC_START.startsWith(tailFrom(text))) return { out: text, links: [], held: '' }
  const links: string[] = []
  let out = ''
  for (;;) {
    const start = text.indexOf(OSC_START)
    if (start === -1) {
      const tail = tailFrom(text)
      const keep = tail !== '' && OSC_START.startsWith(tail) ? tail : ''
      return { out: out + text.slice(0, text.length - keep.length), links, held: keep }
    }
    const end = text.indexOf(BEL, start)
    if (end === -1) {
      const rest = text.slice(start)
      if (rest.length > MAX_HELD) return { out: out + text, links, held: '' }
      return { out: out + text.slice(0, start), links, held: rest }
    }
    const body = text.slice(start + OSC_START.length, end)
    const semi = body.indexOf(';')
    if (semi !== -1 && body.slice(0, semi) === token) links.push(body.slice(semi + 1))
    out += text.slice(0, start)
    text = text.slice(end + 1)
  }
}

/** The end of `text` from its last ESC, the most an unfinished sequence start can be. */
function tailFrom(text: string): string {
  const at = text.lastIndexOf(ESC)
  return at === -1 || text.length - at > OSC_START.length ? '' : text.slice(at)
}
