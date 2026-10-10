import type { ContextMenuRequest, EditCommand } from '@shared/domain/contextMenu'
import type { ContextMenuItem } from '../../ui/contextMenuItem'

export interface TextMenuActions {
  edit: (command: EditCommand) => void
}

type SimpleEdit = Exclude<EditCommand['action'], 'replaceMisspelling'>

export function suggestionItems(suggestions: readonly string[], choose: (word: string) => void): ContextMenuItem[] {
  return suggestions.map((word, i) => ({ id: `spell-${i}`, label: word, run: () => { choose(word) } }))
}

export function textMenuItems(request: ContextMenuRequest, act: TextMenuActions): ContextMenuItem[] {
  if (request.isEditable) return editableItems(request, act)
  if (request.selectionText === '') return []
  return [{ id: 'copy', label: 'Copy', disabled: !request.editFlags.canCopy, run: () => { act.edit({ action: 'copy' }) } }]
}

function editableItems(request: ContextMenuRequest, act: TextMenuActions): ContextMenuItem[] {
  const { editFlags } = request
  const edit = (id: string, label: string, action: SimpleEdit, allowed: boolean): ContextMenuItem => ({
    id, label, disabled: !allowed, run: () => { act.edit({ action }) },
  })
  const cut = edit('cut', 'Cut', 'cut', editFlags.canCut)
  const rest = [
    edit('copy', 'Copy', 'copy', editFlags.canCopy),
    edit('paste', 'Paste', 'paste', editFlags.canPaste),
    edit('select-all', 'Select all', 'selectAll', editFlags.canSelectAll),
  ]
  if (request.misspelledWord === '') return [cut, ...rest]
  return [spellingItem(request, act), { ...cut, separator: true }, ...rest]
}

function spellingItem(request: ContextMenuRequest, act: TextMenuActions): ContextMenuItem {
  const choices = suggestionItems(request.dictionarySuggestions, (word) => { act.edit({ action: 'replaceMisspelling', word }) })
  return {
    id: 'spelling',
    label: 'Spelling',
    submenu: choices.length > 0 ? choices : [{ id: 'no-suggestions', label: 'No suggestions', disabled: true }],
  }
}
