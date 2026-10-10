import { describe, it, expect } from 'vitest'
import type { Ctx } from '../support'

const EDIT_FLAGS = { canCut: true, canCopy: true, canPaste: true, canSelectAll: true }

export function defineSpellingClauses(ctx: Ctx): void {
  describe('Spelling', () => {
    it('spellingGetLanguages returns an array of language codes', async () => {
      const languages = await ctx.api.spellingGetLanguages()
      expect(languages.length).toBeGreaterThan(0)
      for (const lang of languages) expect(lang).toMatch(/^[a-z]{2}(-[A-Z]{2})?$/)
    })

    it('spellingSetLanguage takes a listed language or "system", and refuses one with no dictionary', async () => {
      const [first] = await ctx.api.spellingGetLanguages()
      await expect(ctx.api.spellingSetLanguage(first)).resolves.toBeUndefined()
      await expect(ctx.api.spellingSetLanguage('system')).resolves.toBeUndefined()
      await expect(ctx.api.spellingSetLanguage('xx-XX')).rejects.toThrow()
    })

    it('editCommand makes the edit in the window that sent it, in order', async () => {
      ctx.api.editCommand({ action: 'selectAll' })
      ctx.api.editCommand({ action: 'replaceMisspelling', word: 'the' })
      await expect.poll(() => ctx.bridge.editing()).toEqual([
        { action: 'selectAll' },
        { action: 'replaceMisspelling', word: 'the' },
      ])
    })

    it('a right-click the page does not answer reaches the renderer as the request main built', async () => {
      ctx.bridge.rightClick({
        x: 12, y: 34, isEditable: true, selectionText: '', misspelledWord: 'teh', dictionarySuggestions: ['the', 'ten'], editFlags: EDIT_FLAGS,
      })
      await expect.poll(() => ctx.heard.count('contextMenuRequested')).toBe(1)
      expect(ctx.heard.payloads('contextMenuRequested')).toEqual([[{
        x: 12, y: 34, isEditable: true, selectionText: '', misspelledWord: 'teh', dictionarySuggestions: ['the', 'ten'], editFlags: EDIT_FLAGS,
      }]])
    })
  })
}
