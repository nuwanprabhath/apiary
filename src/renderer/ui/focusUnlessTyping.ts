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
