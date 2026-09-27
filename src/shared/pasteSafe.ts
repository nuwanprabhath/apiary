/**
 * Removes bracketed-paste markers (and any other ESC) from pasted text before it is wrapped in
 * `PASTE_START`/`PASTE_END` (main) or handed to `term.paste` (renderer).
 *
 * Bracketed paste exists so that pasting cannot execute: a program that asks for it is told where
 * a paste starts and ends, and is meant to treat everything between as literal text rather than as
 * typed keystrokes. That only holds if the payload itself cannot contain the end marker
 * (`ESC[201~`) — otherwise a clipboard (or a transcript's text, copied by the user) that contains
 * one closes the bracket early, and whatever follows runs as keystrokes: a bare `\r` submits it, a
 * leading `!` puts Claude Code into bash mode. Stripping every ESC is broader than just the two
 * markers because bracketed paste is not the only escape sequence a terminal will act on mid-paste.
 */
const ESC = String.fromCharCode(0x1b)

export function stripPasteControls(text: string): string {
  return text.split(ESC).join('␛')
}
