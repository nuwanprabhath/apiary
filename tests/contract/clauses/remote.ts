import { describe, expect, it } from 'vitest'
import type { ReportedTab } from '@shared/domain/tabs'
import { STANDARD_SESSIONS as STD } from '../../fixtures/standard'
import { UNAVAILABLE_MESSAGE } from '../../../src/main/remote/scopes'
import type { Ctx } from '../support'

/**
 * What only a home window showing a work machine does (`integration/remoteContract.test.ts`):
 * the channels that window cannot use answer fixed values or refuse with one message, and the
 * work machine keeps no record of its tabs. Defined only when the run is a remote one.
 */
export function defineRemoteClauses(ctx: Ctx): void {
  describe('a window showing a work machine', () => {
    it('refuses picking a folder, naming that it is not available yet', async () => {
      await expect(ctx.api.newSessionInPickedFolder()).rejects.toThrow(UNAVAILABLE_MESSAGE)
    })

    it('opens VS Code at home over Remote-SSH on the path the work machine resolves', async () => {
      const code = ctx.bridge.remote?.homeVsCode
      if (code === undefined) throw new Error('a remote run has a home VS Code')
      // Loaded here: this file is also bundled for the browser run, which never reaches a remote clause.
      const { realpathSync, rmSync, writeFileSync } = await import('node:fs')
      const { join } = await import('node:path')
      const terminal = { kind: 'session', id: STD.csv.id } as const
      // No VS Code at home: refused, nothing launched.
      await expect(ctx.api.openInVsCode(terminal)).rejects.toThrow('VS Code was not found on this machine')
      expect(code.launched).toEqual([])

      code.setPath('/home/bin/code')
      const folder = realpathSync(ctx.bridge.folders.workA)
      await ctx.api.openInVsCode(terminal)
      expect(code.launched).toEqual([{ command: '/home/bin/code', args: ['--remote', 'ssh-remote+work-box', folder] }])

      const file = join(folder, 'bridged-notes.md')
      writeFileSync(file, 'x')
      try {
        await ctx.api.openMentionedFile(terminal, 'bridged-notes.md:7')
        expect(code.launched[1]).toEqual({ command: '/home/bin/code', args: ['--remote', 'ssh-remote+work-box', '--goto', `${file}:7`] })
        await expect(ctx.api.openMentionedFile(terminal, '../../etc/hosts')).rejects.toThrow()
        expect(code.launched).toHaveLength(2)
      } finally {
        rmSync(file, { force: true })
        code.setPath(null)
      }
    })

    it('reports its tabs without the work machine listing them: it has no window number there', async () => {
      const tab: ReportedTab = { key: STD.csv.id, view: 'transcript', ptyId: null, label: null }
      ctx.api.reportTabs([tab])
      expect(await ctx.api.activeTabs()).toEqual([])
    })
  })
}
