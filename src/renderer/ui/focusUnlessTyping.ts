/** A text field has focus: keys pressed now are meant for it. */
function isTyping(el: Element | null): boolean {
  return el instanceof HTMLElement && (el.isContentEditable || el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement)
}

/**
 * Move focus to `el` unless the user is typing in a text field. For something that appears without
 * being asked for (a permission prompt arriving mid-sentence): taking focus from the Composer
 * turned the Enter meant to send a message into approving a tool. Whatever skips the focus must
 * announce itself another way (`role="alert"`) and stay reachable with Tab.
 */
export function focusUnlessTyping(el: HTMLElement | null): void {
  if (el !== null && !isTyping(document.activeElement)) el.focus({ preventScroll: true })
}

/**
 * A `ref` for a field the person just asked for (Rename, "No…", a wizard step, the pet chat): it
 * takes focus as it mounts, even from another text field, because typing into it is the next thing
 * they will do. A one-line field opens with its text selected, so typing replaces the name being
 * changed or the suggestion offered; a text area keeps its caret, as a draft there is not replaced
 * by one key. The one way to do that: `autoFocus` is refused by `apiary/focus-unless-typing`, so
 * a prompt that appears on its own cannot borrow it.
 */
export function focusAskedFor(el: HTMLElement | null): void {
  el?.focus({ preventScroll: true })
  if (el instanceof HTMLInputElement) el.select()
}
