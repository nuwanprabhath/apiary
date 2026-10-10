import { describe, expect, it, vi } from 'vitest'
import type { ContextMenuRequest } from '@shared/domain/contextMenu'
import { suggestionItems, textMenuItems } from '../../src/renderer/features/spelling/textMenu'

const ALL_EDITS = { canCut: true, canCopy: true, canPaste: true, canSelectAll: true }

function request(over: Partial<ContextMenuRequest> = {}): ContextMenuRequest {
  return {
    x: 0, y: 0, isEditable: false, selectionText: '', misspelledWord: '', dictionarySuggestions: [],
    editFlags: ALL_EDITS, ...over,
  }
}

const labels = (items: readonly { label: string }[]): string[] => items.map((item) => item.label)

describe('textMenuItems', () => {
  it('offers Cut, Copy, Paste and Select all in an editable field', () => {
    expect(labels(textMenuItems(request({ isEditable: true }), { edit: vi.fn() })))
      .toEqual(['Cut', 'Copy', 'Paste', 'Select all'])
  })

  it('leads with a Spelling submenu of the suggestions when the field has a misspelled word', () => {
    const [spelling, ...rest] = textMenuItems(
      request({ isEditable: true, misspelledWord: 'teh', dictionarySuggestions: ['the', 'ten'] }),
      { edit: vi.fn() },
    )
    expect(spelling.label).toBe('Spelling')
    expect(labels(spelling.submenu ?? [])).toEqual(['the', 'ten'])
    expect(labels(rest)).toEqual(['Cut', 'Copy', 'Paste', 'Select all'])
  })

  it('says there are no suggestions, disabled, for a misspelled word with none', () => {
    const [spelling] = textMenuItems(request({ isEditable: true, misspelledWord: 'xqzv' }), { edit: vi.fn() })
    expect(labels(spelling.submenu ?? [])).toEqual(['No suggestions'])
    expect(spelling.submenu?.[0].disabled).toBe(true)
  })

  it('disables each edit the field does not allow', () => {
    const items = textMenuItems(
      request({ isEditable: true, editFlags: { canCut: false, canCopy: true, canPaste: false, canSelectAll: true } }),
      { edit: vi.fn() },
    )
    expect(items.map((item) => [item.label, item.disabled ?? false])).toEqual([
      ['Cut', true], ['Copy', false], ['Paste', true], ['Select all', false],
    ])
  })

  it('offers only Copy for selected read-only text', () => {
    expect(labels(textMenuItems(request({ selectionText: 'some words' }), { edit: vi.fn() }))).toEqual(['Copy'])
  })

  it('offers nothing with no field and no selection, so no menu opens', () => {
    expect(textMenuItems(request(), { edit: vi.fn() })).toEqual([])
  })

  it('sends the matching edit when an item runs', () => {
    const edit = vi.fn()
    const items = textMenuItems(
      request({ isEditable: true, misspelledWord: 'teh', dictionarySuggestions: ['the'] }),
      { edit },
    )
    items.find((item) => item.label === 'Paste')?.run?.()
    items[0].submenu?.[0].run?.()
    expect(edit.mock.calls).toEqual([
      [{ action: 'paste' }],
      [{ action: 'replaceMisspelling', word: 'the' }],
    ])
  })
})

describe('suggestionItems', () => {
  it('makes one item per suggestion, and choosing it passes that word on', () => {
    const choose = vi.fn()
    const items = suggestionItems(['the', 'ten'], choose)
    expect(labels(items)).toEqual(['the', 'ten'])
    items[1].run?.()
    expect(choose).toHaveBeenCalledWith('ten')
  })
})
