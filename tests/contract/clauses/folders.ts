import { describe, expect, it } from 'vitest'
import { isPendingPtyId } from '@shared/domain/ptyId'
import { BROWSE_HOME } from '../world'
import type { Ctx } from '../support'

const { nested } = BROWSE_HOME

/**
 * The in-app folder browser a remote window uses in place of the native picker. The renderer holds
 * an id and names, never a path (ADR-0001); every refusal leaves the browse where it was. Runs on
 * the fake, on the loopback's temp home, and so over the remote path too.
 */
export function defineFolderClauses(ctx: Ctx): void {
  describe('the folder browser', () => {
    it('opens at home listing folders only, sorted, without dot-folders, marking repositories', async () => {
      const view = await ctx.api.folderBrowseOpen()
      expect(view.crumbs).toEqual(['~'])
      expect(view.atRoot).toBe(true)
      expect(view.entries.map((e) => e.name)).toEqual([...BROWSE_HOME.folders])
      expect(view.entries.filter((e) => e.isRepo).map((e) => e.name)).toEqual([...BROWSE_HOME.repos])
      expect(view.id).not.toBe('')
    })

    it('enters a folder, goes up, and jumps back by crumb', async () => {
      const { id } = await ctx.api.folderBrowseOpen()
      const inside = await ctx.api.folderBrowseEnter(id, nested.parent)
      expect(inside.crumbs).toEqual(['~', nested.parent])
      expect(inside.atRoot).toBe(false)
      expect(inside.entries.map((e) => e.name)).toEqual([nested.child])
      const deeper = await ctx.api.folderBrowseEnter(id, nested.child)
      expect(deeper.crumbs).toEqual(['~', nested.parent, nested.child])
      expect((await ctx.api.folderBrowseUp(id)).crumbs).toEqual(['~', nested.parent])
      await ctx.api.folderBrowseEnter(id, nested.child)
      expect((await ctx.api.folderBrowseCrumb(id, 0)).atRoot).toBe(true)
      await expect(ctx.api.folderBrowseUp(id)).rejects.toThrow()
      await expect(ctx.api.folderBrowseCrumb(id, 3)).rejects.toThrow()
    })

    it('refuses a name that is not a folder listed here, and stays where it was', async () => {
      const { id } = await ctx.api.folderBrowseOpen()
      for (const name of ['..', '.', '', 'a/b', 'a\\b', `${nested.parent}/${nested.child}`, 'not-there', '.claude']) {
        await expect(ctx.api.folderBrowseEnter(id, name)).rejects.toThrow()
      }
      expect((await ctx.api.folderBrowseCrumb(id, 0)).crumbs).toEqual(['~'])
    })

    it('refuses a link that leads outside home', async () => {
      await ctx.bridge.outside.linkOutsideHome('escape')
      const { id } = await ctx.api.folderBrowseOpen()
      await expect(ctx.api.folderBrowseEnter(id, 'escape')).rejects.toThrow(/outside/)
      expect((await ctx.api.folderBrowseCrumb(id, 0)).crumbs).toEqual(['~'])
    })

    it('starts a session in the browsed folder, not a listed child, and refuses a closed browse', async () => {
      const { id } = await ctx.api.folderBrowseOpen()
      await ctx.api.folderBrowseEnter(id, nested.parent)
      await ctx.api.folderBrowseEnter(id, nested.child)
      const info = await ctx.api.newSessionInBrowsedFolder(id)
      expect(isPendingPtyId(info.ptyId)).toBe(true)
      expect(info.label).toBe(nested.child)
      ctx.api.folderBrowseClose(id)
      await expect(ctx.api.newSessionInBrowsedFolder(id)).rejects.toThrow()
      await expect(ctx.api.folderBrowseEnter(id, nested.parent)).rejects.toThrow()
    })
  })
}
