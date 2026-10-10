import { type WordRange, wordRangeAt } from './wordRange'

export interface WordAtCaret extends WordRange {
  /** Replaces the word where it is, and tells the field it changed. */
  replace: (replacement: string) => void
}

/** The word a collapsed caret is in or touches, in a form field or a contenteditable host. */
export function wordAtCaret(field: HTMLElement): WordAtCaret | null {
  if (field instanceof HTMLInputElement || field instanceof HTMLTextAreaElement) {
    const caret = field.selectionStart
    if (caret === null || caret !== field.selectionEnd) return null
    const found = wordRangeAt(field.value, caret)
    if (found === null) return null
    return {
      ...found,
      replace: (replacement) => {
        if (field.value.slice(found.start, found.end) !== found.word) return
        field.setRangeText(replacement, found.start, found.end, 'end')
        field.dispatchEvent(new Event('input', { bubbles: true }))
      },
    }
  }
  const selection = window.getSelection()
  const node = selection?.anchorNode ?? null
  if (selection === null || !selection.isCollapsed || !(node instanceof Text) || !field.contains(node)) return null
  const found = wordRangeAt(node.data, selection.anchorOffset)
  if (found === null) return null
  return {
    ...found,
    replace: (replacement) => {
      if (node.data.slice(found.start, found.end) !== found.word) return
      field.focus()
      node.replaceData(found.start, found.word.length, replacement)
      const caret = document.createRange()
      caret.setStart(node, found.start + replacement.length)
      caret.collapse(true)
      selection.removeAllRanges()
      selection.addRange(caret)
      field.dispatchEvent(new Event('input', { bubbles: true }))
    },
  }
}

/** The way back to where the user was: focus on the field and the selection as it was. */
export function snapshotCaret(field: HTMLElement | null): () => void {
  const selection = window.getSelection()
  const range = selection !== null && selection.rangeCount > 0 ? selection.getRangeAt(0).cloneRange() : null
  // A form field keeps its own selection; the document selection does not reach into it.
  const keepsOwnSelection = field instanceof HTMLInputElement || field instanceof HTMLTextAreaElement
  return () => {
    field?.focus()
    if (keepsOwnSelection || selection === null || range === null) return
    selection.removeAllRanges()
    selection.addRange(range)
  }
}
