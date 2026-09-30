/**
 * What Claude Code prints when Ctrl+Z suspends it (measured on 2.1.284):
 *
 *   Claude Code has been suspended. Run `fg` to bring Claude Code back.
 *   Note: ctrl + z now suspends Claude Code, ctrl + _ undoes input.
 *
 * It leaves the alternate screen to print this, so while it is suspended these are the last lines
 * on the terminal's normal screen, and the moment it is continued it repaints the alternate screen
 * over them. Matching only the bottom few non-blank lines is what makes an old occurrence further
 * up the scrollback not count.
 */
const SUSPENDED = /Claude Code has been suspended/
const TAIL_LINES = 4

/** Whether the screen's last lines say Claude Code is suspended and waiting to be continued. */
export function isClaudeSuspended(lines: readonly string[]): boolean {
  const tail: string[] = []
  for (let i = lines.length - 1; i >= 0 && tail.length < TAIL_LINES; i--) {
    if (lines[i].trim() !== '') tail.push(lines[i])
  }
  return tail.some((line) => SUSPENDED.test(line))
}

/** Ctrl+Z exactly: no Shift, Alt or Meta. Ctrl+Shift+Z is redo in editors and not a suspend. */
export function isSuspendChord(e: { key: string; ctrlKey: boolean; shiftKey: boolean; altKey: boolean; metaKey: boolean }): boolean {
  return e.ctrlKey && !e.shiftKey && !e.altKey && !e.metaKey && e.key.toLowerCase() === 'z'
}
