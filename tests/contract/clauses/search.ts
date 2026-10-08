import { describe, expect, it } from 'vitest'
import { STANDARD_SESSIONS as STD } from '../../fixtures/standard'
import type { Ctx } from '../support'

export function defineSearchClauses(ctx: Ctx): void {
  describe('search', () => {
    it('finds a session by a word in its conversation once the index is built, and finds nothing for a word that is not there', async () => {
      await ctx.api.searchRebuild()
      // Only the first session's opening prompt says "empty".
      expect(await ctx.api.searchContent('empty')).toEqual([STD.csv.id])
      expect(await ctx.api.searchContent('zebra')).toEqual([])
    })

    it('matches the last word of a query as a prefix once it is three letters long, and every word must be there', async () => {
      await ctx.api.searchRebuild()
      expect(await ctx.api.searchContent('empt')).toEqual([STD.csv.id])
      expect(await ctx.api.searchContent('em')).toEqual([])
      expect(await ctx.api.searchContent('export is empty')).toEqual([STD.csv.id])
      expect(await ctx.api.searchContent('export zebra')).toEqual([])
    })

    it('finds a session by its note, and stops finding it when the note is cleared', async () => {
      await ctx.api.setSessionNote(STD.switcher.id, 'remember the zebra')
      expect(await ctx.api.searchContent('zebra')).toEqual([STD.switcher.id])
      await ctx.api.setSessionNote(STD.switcher.id, '')
      expect(await ctx.api.searchContent('zebra')).toEqual([])
    })

    it('searches only what the two switches allow: conversations, notes, both or neither', async () => {
      await ctx.api.searchRebuild()
      await ctx.api.setSessionNote(STD.switcher.id, 'remember the zebra')

      await ctx.api.settingsSet({ searchSessionNotes: false } as never)
      expect(await ctx.api.searchContent('zebra')).toEqual([])
      expect(await ctx.api.searchContent('empty')).toEqual([STD.csv.id])

      await ctx.api.settingsSet({ searchSessionNotes: true, searchChatContent: false } as never)
      expect(await ctx.api.searchContent('zebra')).toEqual([STD.switcher.id])
      expect(await ctx.api.searchContent('empty')).toEqual([])

      await ctx.api.settingsSet({ searchSessionNotes: false } as never)
      expect(await ctx.api.searchContent('zebra')).toEqual([])
    })

    it('counts the sessions and notes it has indexed, and counts none of what is switched off', async () => {
      await ctx.api.setSessionNote(STD.csv.id, 'a note')
      await ctx.api.searchRebuild()
      expect(await ctx.api.searchStatus()).toEqual({ indexed: 4, notes: 1 })

      await ctx.api.settingsSet({ searchChatContent: false } as never)
      expect(await ctx.api.searchStatus()).toEqual({ indexed: 0, notes: 1 })
      await ctx.api.settingsSet({ searchSessionNotes: false } as never)
      expect(await ctx.api.searchStatus()).toEqual({ indexed: 0, notes: 0 })
    })

    it('a session taken out of the tree is no longer indexed once the index is rebuilt', async () => {
      await ctx.api.removeSession(STD.switcher.id)
      await ctx.api.searchRebuild()
      expect((await ctx.api.searchStatus()).indexed).toBe(3)
    })
  })
}
