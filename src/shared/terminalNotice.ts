/**
 * A note Claude Code draws under its spinner and nowhere else: a built-in plugin flags something
 * the person should know ("✦ Heads up · …", "✦ You should know · …") with numbered answers
 * ("1: Learn more   2: Knew this already   0: Dismiss"). It is never written to the session's
 * file, so the chat view can only learn of it from the rendered screen.
 */
export interface TerminalNotice {
  /** "Heads up" or "You should know". */
  tag: string
  text: string
  /** The answers as the terminal offers them; each is answered there, by its key. */
  choices: Array<{ key: string; label: string }>
}

/** The bottom of what is drawn: the note sits just above the input box. Blank rows do not count, or
 *  a screen drawn from the top (a short session in a tall pane) has nothing but blanks there. */
const TAIL_LINES = 20
const HEAD = /^\s*\S?\s*(Heads up|You should know) · (.+)$/
const CHOICES_ROW = /^\s*\d: \S/
const CHOICE = /(\d): (.+?)(?=\s{2,}\d: |\s*$)/g

/** The note on `screen` (plain text lines), or null when none is showing. */
export function readTerminalNotice(screen: string): TerminalNotice | null {
  const lines = screen.split('\n').filter((l) => l.trim() !== '').slice(-TAIL_LINES)
  let head = -1
  lines.forEach((l, i) => { if (HEAD.test(l)) head = i })
  if (head === -1) return null
  const [, tag = '', first = ''] = HEAD.exec(lines[head] ?? '') ?? []
  const text = [first.trim()]
  const choices: TerminalNotice['choices'] = []
  for (const line of lines.slice(head + 1)) {
    if (CHOICES_ROW.test(line)) {
      for (const m of line.matchAll(CHOICE)) choices.push({ key: m[1] ?? '', label: (m[2] ?? '').trim() })
      break
    }
    // Its wrapped lines are indented under the text; anything else is the next part of the screen.
    if (!/^\s+\S/.test(line)) break
    text.push(line.trim())
  }
  return { tag, text: text.join(' '), choices }
}

/** Whether two reads show the same note, so an unchanged one is not a change. */
export function sameNotice(a: TerminalNotice | null | undefined, b: TerminalNotice | null | undefined): boolean {
  if (!a || !b) return !a === !b
  return a.tag === b.tag && a.text === b.text && a.choices.map((c) => c.key + c.label).join() === b.choices.map((c) => c.key + c.label).join()
}
