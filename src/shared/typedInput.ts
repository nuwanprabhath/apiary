/**
 * Reads what is typed, not yet sent, in Claude Code's input box from a rendered screen, so a tab
 * switching from the Terminal view to the Chat view can carry it into the composer.
 *
 * The box, as Claude Code draws it (recorded in `tests/fixtures/typed-input/`):
 *
 *     ─────────────────────── (a full-width rule)
 *     ❯ first line of the text
 *       a continuation line, indented two columns
 *     ─────────────────────── (the bottom rule)
 *
 * Plain text cannot tell the dim placeholder hint (`Try "…"`, shown while the box is empty) from
 * typed text, so a line is runs of text marked dim or not; any dim text in the box means the hint.
 *
 * Claude Code wraps the box itself, so the terminal's own wrap flag is never set and a soft wrap
 * and a typed newline both start a new indented line. They differ in where the line before ended:
 * a word-wrapped line stopped because the next word would not fit.
 */

/** A run of cells on one screen line, all dim or all not. */
export interface ScreenRun { text: string; dim: boolean }
export type ScreenLine = ScreenRun[]

const RULE = /^─{10,}/
const PROMPT = /^[❯>] ?/
/** The box's left padding on a continuation line. */
const INDENT = '  '
/** Columns the box loses to its prompt and padding before a word no longer fits. */
const BOX_MARGIN = 4
/** A box taller than this is not Claude's input box. */
const MAX_BOX_LINES = 30

const lineText = (line: ScreenLine): string => line.map((r) => r.text).join('')
const hasDim = (line: ScreenLine): boolean => line.some((r) => r.dim && r.text.trim() !== '')

function firstWordLength(text: string): number {
  return (/^\S*/.exec(text)?.[0] ?? '').length
}

/** The input box's lines: the prompt line through the line above the bottom rule, or null. */
function findBox(lines: ScreenLine[]): ScreenLine[] | null {
  for (let i = lines.length - 1; i >= 1; i -= 1) {
    const text = lineText(lines[i] ?? [])
    if (!PROMPT.test(text)) continue
    // Only the input box's prompt sits directly under a full-width rule.
    if (!RULE.test(lineText(lines[i - 1] ?? []).trim())) return null
    for (let end = i + 1; end < lines.length && end - i <= MAX_BOX_LINES; end += 1) {
      const t = lineText(lines[end] ?? [])
      if (RULE.test(t.trim())) return lines.slice(i, end)
      if (!t.startsWith(INDENT) && t.trim() !== '') return null
    }
    return null
  }
  return null
}

/** A composer draft with text carried from the terminal: the text alone into an empty draft, on a
 *  new line after a draft that does not already end with it. */
export function mergeCarriedInput(draft: string, typed: string): string {
  if (draft.trim() === '') return typed
  if (draft.trimEnd().endsWith(typed)) return draft
  return `${draft.trimEnd()}\n${typed}`
}

/**
 * The text typed in Claude Code's input box, or null when the screen shows no input box (a
 * permission prompt, a menu, a shell) or the box is empty. `cols` is the screen's width.
 */
export function readTypedInput(lines: ScreenLine[], cols: number): string | null {
  const box = findBox(lines)
  if (box === null || box.some(hasDim)) return null
  const [head, ...rest] = box.map(lineText)
  // An option cursor (`❯ 1. Yes`) is a selection list drawn in the same frame, not typed text.
  const first = (head ?? '').replace(PROMPT, '')
  if (/^\d+\.\s/.test(first)) return null
  let out = first.trimEnd()
  let prevLength = (head ?? '').trimEnd().length
  for (const raw of rest) {
    const line = raw.startsWith(INDENT) ? raw.slice(INDENT.length).trimEnd() : raw.trimEnd()
    const softWrap = prevLength + 1 + firstWordLength(line) > cols - BOX_MARGIN
    out += (softWrap ? ' ' : '\n') + line
    prevLength = raw.trimEnd().length
  }
  const text = out.trim()
  return text === '' ? null : text
}
