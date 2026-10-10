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
}

/** The fields of Electron's `context-menu` params that a request is built from. */
export interface ContextMenuParamsLike extends Omit<ContextMenuRequest, 'dictionarySuggestions'> {
  dictionarySuggestions: readonly string[]
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
  }
}

export type EditCommand =
  | { action: 'cut' | 'copy' | 'paste' | 'selectAll' }
  | { action: 'replaceMisspelling'; word: string }

const SIMPLE_EDITS = ['cut', 'copy', 'paste', 'selectAll'] as const

export function isEditCommand(v: unknown): v is EditCommand {
  if (!isRecord(v)) return false
  if (v.action === 'replaceMisspelling') return typeof v.word === 'string'
  return isOneOf(SIMPLE_EDITS, v.action)
}
