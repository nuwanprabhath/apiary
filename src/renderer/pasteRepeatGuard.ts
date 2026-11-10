import { isPasteShortcut } from '@shared/pasteShortcut'
import { isMac } from './ui/platform'

/**
 * A paste shortcut that is held (`repeat`) never pastes again. On Linux through XWayland a key
 * release can arrive late and the key repeats on its own, so one Ctrl+V pasted four times.
 * Cancelling the keydown stops Chromium firing a `paste` event. Capture phase on `window`, so it
 * covers every field; the terminal's own key handler does the same for xterm.
 *
 * A module of its own, imported for its side effect, so the component tests' harness installs the
 * same behaviour main.tsx does.
 */
window.addEventListener('keydown', (e) => {
  if (e.repeat && isPasteShortcut(e, isMac())) e.preventDefault()
}, { capture: true })
