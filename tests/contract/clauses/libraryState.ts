import { describe, expect, it } from 'vitest'
import { libraryDefaults, type LibraryPatch } from '@shared/libraryState'
import type { Ctx } from '../support'

export function defineLibraryStateClauses(ctx: Ctx): void {
  describe('library state', () => {
    it('starts at the defaults, unseeded', async () => {
      expect(await ctx.api.libraryState()).toEqual({ state: libraryDefaults(), seeded: false })
    })

    it('a set changes what it names, keeps the rest, marks it seeded and tells every window', async () => {
      const answer = await ctx.api.setLibraryState({ groups: [{ id: 'g', name: 'Work' }], hideToolCallIo: true })
      const now = await ctx.api.libraryState()
      expect(answer).toEqual(now)
      expect(now).toEqual({ state: { ...libraryDefaults(), groups: [{ id: 'g', name: 'Work' }], hideToolCallIo: true }, seeded: true })
      await expect.poll(() => ctx.heard.payloads('libraryStateChanged').at(-1)?.[0]).toEqual(now)
    })

    it('a seed applies once; after that it is refused and nothing is broadcast', async () => {
      expect((await ctx.api.seedLibraryState({ pinned: ['first'] })).state.pinned).toEqual(['first'])
      await expect.poll(() => ctx.heard.count('libraryStateChanged')).toBe(1)
      expect((await ctx.api.seedLibraryState({ pinned: ['second'] })).state.pinned).toEqual(['first'])
      expect((await ctx.api.libraryState()).state.pinned).toEqual(['first'])
      expect(ctx.heard.count('libraryStateChanged')).toBe(1)
    })

    it('a patch with an unknown key or a wrong type is refused whole', async () => {
      await expect(ctx.api.setLibraryState({ pinned: ['a'], sidebarWidth: 1 } as unknown as LibraryPatch)).rejects.toThrow()
      await expect(ctx.api.setLibraryState({ hideToolCallIo: 'yes' } as unknown as LibraryPatch)).rejects.toThrow()
      expect(await ctx.api.libraryState()).toEqual({ state: libraryDefaults(), seeded: false })
    })
  })
}
