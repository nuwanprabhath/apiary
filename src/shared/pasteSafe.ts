/**
 * Removes bracketed-paste markers (and any other ESC) from pasted text before it is wrapped in
 * `PASTE_START`/`PASTE_END` (main) or handed to `term.paste` (renderer).
 *
 * Bracketed paste only protects if the payload cannot contain the end marker (`ESC[201~`):
 * otherwise the bracket closes early and what follows runs as keystrokes (a bare `\r` submits, a
 * leading `!` enters bash mode). Every ESC is stripped, since other sequences act mid-paste too.
 */
const ESC = String.fromCharCode(0x1b)

export function stripPasteControls(text: string): string {
  return text.split(ESC).join('␛')
}
