import { isOneOf, isRecord } from '../guards'

interface EditFlags {
  canCut: boolean
  canCopy: boolean
  canPaste: boolean
  canSelectAll: boolean
}

export interface ContextMenuRequest {
  x: number
  y: number
  isEditable: boolean
  selectionText: string
  misspelledWord: string
  dictionarySuggestions: string[]
  editFlags: EditFlags
  /** What is under the pointer; 'image' over an `<img>`, so the menu can offer to copy it. */
  mediaType: MediaType
}

export type MediaType = 'image' | 'none' | 'other'

/** The fields of Electron's `context-menu` params that a request is built from. */
export interface ContextMenuParamsLike extends Omit<ContextMenuRequest, 'dictionarySuggestions' | 'mediaType'> {
  dictionarySuggestions: readonly string[]
  /** Electron's own value: 'image', 'video', 'audio', 'canvas', 'file', 'plugin' or 'none'. */
  mediaType: string
}

export function contextMenuRequestFrom(params: ContextMenuParamsLike): ContextMenuRequest {
  const { canCut, canCopy, canPaste, canSelectAll } = params.editFlags
  return {
    x: params.x,
    y: params.y,
    isEditable: params.isEditable,
    selectionText: params.selectionText,
    misspelledWord: params.misspelledWord,
    dictionarySuggestions: [...params.dictionarySuggestions],
    editFlags: { canCut, canCopy, canPaste, canSelectAll },
    mediaType: params.mediaType === 'image' || params.mediaType === 'none' ? params.mediaType : 'other',
  }
}

export type EditCommand =
  | { action: 'cut' | 'copy' | 'paste' | 'selectAll' }
  | { action: 'replaceMisspelling'; word: string }
  | { action: 'copyImageAt'; x: number; y: number }

const SIMPLE_EDITS = ['cut', 'copy', 'paste', 'selectAll'] as const

export function isEditCommand(v: unknown): v is EditCommand {
  if (!isRecord(v)) return false
  if (v.action === 'replaceMisspelling') return typeof v.word === 'string'
  if (v.action === 'copyImageAt') return Number.isFinite(v.x) && Number.isFinite(v.y)
  return isOneOf(SIMPLE_EDITS, v.action)
}
