const TEXT_INPUT_TYPES = new Set(['text', 'search', 'url', 'tel', 'email', 'password', 'number'])

/** Chromium spell-checks these; it does not check email, password or number. */
const SPELLCHECK_INPUT_TYPES = new Set(['text', 'search', 'url', 'tel'])

const FIELD_SELECTOR = 'textarea, input, [contenteditable]:not([contenteditable="false"])'

/**
 * The field a node sits in, when the user can type into it. Read-only and disabled fields are not
 * editable, and neither is anything in a terminal, which xterm types into itself.
 */
export function editableOf(node: EventTarget | null): HTMLElement | null {
  if (!(node instanceof Element)) return null
  const field = node.closest<HTMLElement>(FIELD_SELECTOR)
  if (field === null || field.closest('.xterm') !== null) return null
  if (field instanceof HTMLInputElement) {
    if (!TEXT_INPUT_TYPES.has(field.type) || field.readOnly || field.disabled) return null
  } else if (field instanceof HTMLTextAreaElement && (field.readOnly || field.disabled)) {
    return null
  }
  return field
}

export function isSpellcheckable(field: HTMLElement): boolean {
  if (field instanceof HTMLInputElement) return SPELLCHECK_INPUT_TYPES.has(field.type)
  return field instanceof HTMLTextAreaElement || field.isContentEditable
}
