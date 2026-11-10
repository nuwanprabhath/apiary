/** The keys of a keydown, as far as telling a paste shortcut goes. */
export interface PasteKeyEvent {
  key: string
  ctrlKey: boolean
  metaKey: boolean
  shiftKey: boolean
  altKey: boolean
}

/**
 * Ctrl+V, Ctrl+Shift+V, Shift+Insert, and Cmd+V on a Mac (`mac`). The caller says which system it
 * is on, so this stays a pure helper.
 */
export function isPasteShortcut(e: PasteKeyEvent, mac: boolean): boolean {
  if (e.altKey) return false
  const key = e.key.toLowerCase()
  if (key === 'insert') return e.shiftKey && !e.ctrlKey && !e.metaKey
  if (key !== 'v') return false
  return mac ? e.metaKey && !e.ctrlKey : e.ctrlKey && !e.metaKey
}
