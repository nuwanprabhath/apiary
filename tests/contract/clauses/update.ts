import { describe, expect, it } from 'vitest'
import type { Ctx } from '../support'
import { FEED_VERSION } from '../world'

export function defineUpdateClauses(ctx: Ctx): void {
  /** The phases the updater passed through, in the order every window heard them. */
  const phases = (): string[] => ctx.heard.payloads('updateChanged').map(([status]) => status.phase)

  describe('updates', () => {
    it('start with nothing found, an installer to run by hand, and no skipped version', async () => {
      const status = await ctx.api.updateStatus()
      expect(status).toMatchObject({
        phase: 'idle', availableVersion: null, skippedVersion: null, downloadedPath: null, install: null, openResult: null, error: null,
      })
      expect(status.capability.kind).toBe('assisted')
      expect(typeof status.currentVersion).toBe('string')
    })

    it('a check looks, then offers the newer version, and every window hears each step', async () => {
      const found = await ctx.api.updateCheck()
      expect(found).toMatchObject({ phase: 'available', availableVersion: FEED_VERSION, error: null })
      expect(typeof found.lastCheckedAt).toBe('number')
      expect(phases()).toEqual(['checking', 'available'])
      expect(await ctx.api.updateStatus()).toEqual(found)
    })

    it('skipping drops the offer and remembers the version; a check asked for by hand offers it again', async () => {
      await ctx.api.updateCheck()
      await ctx.api.updateSkip()
      expect(await ctx.api.updateStatus()).toMatchObject({ phase: 'idle', availableVersion: null, skippedVersion: FEED_VERSION })
      expect(await ctx.api.updateCheck()).toMatchObject({ phase: 'available', availableVersion: FEED_VERSION, skippedVersion: FEED_VERSION })
    })

    it('skipping with nothing on offer changes nothing and says nothing', async () => {
      await ctx.api.updateSkip()
      expect(await ctx.api.updateStatus()).toMatchObject({ phase: 'idle', skippedVersion: null })
      expect(ctx.heard.count('updateChanged')).toBe(0)
    })

    it('dismissing hides the notice but keeps the update on offer', async () => {
      await ctx.api.updateCheck()
      ctx.heard.reset()
      await ctx.api.updateDismiss()
      expect(await ctx.api.updateStatus()).toMatchObject({ phase: 'idle', availableVersion: FEED_VERSION, skippedVersion: null })
      expect(phases()).toEqual(['idle'])
      // Nothing to dismiss now.
      await ctx.api.updateDismiss()
      expect(ctx.heard.count('updateChanged')).toBe(1)
    })

    it('downloading saves the installer for the user to run, and tells them how', async () => {
      expect(await ctx.api.updateDownload()).toMatchObject({ phase: 'idle', downloadedPath: null })
      expect(ctx.heard.count('updateChanged')).toBe(0)

      await ctx.api.updateCheck()
      ctx.heard.reset()
      const done = await ctx.api.updateDownload()
      expect(done).toMatchObject({ phase: 'downloaded', availableVersion: FEED_VERSION, progressPercent: 100, openResult: { ok: 'opened' } })
      expect(typeof done.downloadedPath).toBe('string')
      expect(done.install?.action).toBe('open')
      expect(phases()[0]).toBe('downloading')
      expect(phases().at(-1)).toBe('downloaded')
      expect(await ctx.api.updateStatus()).toEqual(done)
    })

    it('opens the downloaded installer again on request, and says so when there is none; installing does nothing for an installer the user runs', async () => {
      expect(await ctx.api.updateOpenDownloaded()).toMatchObject({ ok: 'failed' })
      await ctx.api.updateCheck()
      await ctx.api.updateDownload()
      expect(await ctx.api.updateOpenDownloaded()).toEqual({ ok: 'opened' })
      await ctx.api.updateInstall()
      expect((await ctx.api.updateStatus()).phase).toBe('downloaded')
    })
  })
}
