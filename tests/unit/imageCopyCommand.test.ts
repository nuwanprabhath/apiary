import { describe, expect, it, vi } from 'vitest'
import { contextMenuRequestFrom, isEditCommand, type ContextMenuParamsLike } from '@shared/domain/contextMenu'
import { runEditCommand } from '../../src/main/windows/contextMenu'

const params = (mediaType: string): ContextMenuParamsLike => ({
  x: 3, y: 4, isEditable: false, selectionText: '', misspelledWord: '', dictionarySuggestions: [],
  editFlags: { canCut: false, canCopy: false, canPaste: false, canSelectAll: false }, mediaType,
})

describe('copying an image from the context menu', () => {
  it('a request keeps an image media type and narrows the others', () => {
    expect(contextMenuRequestFrom(params('image')).mediaType).toBe('image')
    expect(contextMenuRequestFrom(params('none')).mediaType).toBe('none')
    expect(contextMenuRequestFrom(params('video')).mediaType).toBe('other')
  })

  it('copyImageAt is an edit command only with finite numbers', () => {
    expect(isEditCommand({ action: 'copyImageAt', x: 1, y: 2 })).toBe(true)
    expect(isEditCommand({ action: 'copyImageAt', x: Number.NaN, y: 2 })).toBe(false)
    expect(isEditCommand({ action: 'copyImageAt', x: '1', y: 2 })).toBe(false)
    expect(isEditCommand({ action: 'copyImageAt', x: 1 })).toBe(false)
  })

  it('runEditCommand copies the image at the point', () => {
    const copyImageAt = vi.fn()
    const target = { cut: vi.fn(), copy: vi.fn(), paste: vi.fn(), selectAll: vi.fn(), replaceMisspelling: vi.fn(), copyImageAt }
    runEditCommand(target, { action: 'copyImageAt', x: 7, y: 9 })
    expect(copyImageAt).toHaveBeenCalledWith(7, 9)
    expect(target.copy).not.toHaveBeenCalled()
  })
})
