import { describe, expect, it } from 'vitest'
import { STANDARD_SESSIONS as STD } from '../../fixtures/standard'
import type { Ctx } from '../support'

/** One transparent pixel. */
const PIXEL = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=='

export function defineMiscClauses(ctx: Ctx): void {
  describe('pasted images', () => {
    it('saves an image and reads it back as a data address, and reads nothing from a place it did not save to', async () => {
      const saved = await ctx.api.saveImage(PIXEL, 'image/png')
      expect(saved).not.toBe('')
      expect(await ctx.api.readImage(saved)).toEqual({ dataUrl: `data:image/png;base64,${PIXEL}` })
      expect(await ctx.api.readImage('/etc/hosts')).toBeNull()
      const again = await ctx.api.saveImage(PIXEL, 'image/png')
      expect(again).not.toBe(saved)
    })

    it('refuses to save something that is not an image', async () => {
      await expect(ctx.api.saveImage(PIXEL, 'text/html')).rejects.toThrow()
    })
  })

  describe('the clipboard', () => {
    it('holds the text it is handed, one copy after another', async () => {
      await ctx.api.copyToClipboard('feature/contract')
      await ctx.api.copyToClipboard('')
      expect(ctx.bridge.copied()).toEqual(['feature/contract', ''])
      await expect(ctx.api.copyToClipboard(7 as never)).rejects.toThrow()
    })
  })

  describe('VS Code', () => {
    it('is not there on this machine, so it is not on offer and opening a folder in it is an error', async () => {
      expect(await ctx.api.vsCodeAvailable()).toBe(false)
      await expect(ctx.api.openInVsCode({ kind: 'session', id: STD.csv.id })).rejects.toThrow()
    })

    it('opens no mentioned file without it, and refuses a mention that is not text', async () => {
      await expect(ctx.api.openMentionedFile({ kind: 'session', id: STD.csv.id }, 'README.md')).rejects.toThrow()
      await expect(ctx.api.openMentionedFile({ kind: 'session', id: STD.csv.id }, 7 as never)).rejects.toThrow()
    })
  })

  describe('the diagnostic log', () => {
    it('says whether it is on and how much it holds, and clearing leaves it holding nothing', async () => {
      const status = await ctx.api.logStatus()
      expect(typeof status.enabled).toBe('boolean')
      expect(typeof status.dir).toBe('string')
      const cleared = await ctx.api.logClear()
      expect(cleared).toMatchObject({ enabled: status.enabled, files: 0, bytes: 0 })
    })

    it('reveals the folder it keeps, the one it reports, and takes a line from the renderer without complaint', async () => {
      expect(await ctx.api.logReveal()).toBe((await ctx.api.logStatus()).dir)
      ctx.api.logWrite('info', 'ipc', 'a line from the contract')
      ctx.api.logWrite('info', 'ipc', 'with fields', { count: 3 })
    })
  })

  describe('requests', () => {
    it('refuses a request whose arguments are not what the call takes', async () => {
      await expect(ctx.api.renameSession(STD.csv.id, 5 as never)).rejects.toThrow()
      await expect(ctx.api.setSessionNote(7 as never, 'note')).rejects.toThrow()
      await expect(ctx.api.settingsSet('everything' as never)).rejects.toThrow()
      await expect(ctx.api.importSessions('all' as never, [])).rejects.toThrow()
      await expect(ctx.api.transcript(STD.csv.id, 'first' as never)).rejects.toThrow()
      await expect(ctx.api.gitListRefs({ kind: 'folder' } as never)).rejects.toThrow()
    })
  })
}
