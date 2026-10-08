import { describe, expect, it } from 'vitest'
import type { TranscriptPage } from '@shared/types'
import { TRANSCRIPT_PAGE_SIZE } from '@shared/types'
import { asSessionId } from '@shared/domain/ids'
import { isPendingPtyId } from '@shared/domain/ptyId'
import { forkLabel } from '@shared/forkLabel'
import { STANDARD_SESSIONS as STD } from '../../fixtures/standard'
import { LONG_SESSION, sessionOf, STANDARD_TITLES, titles, type Ctx } from '../support'

/** A session id no implementation has heard of. */
const UNKNOWN_SESSION = asSessionId('99999999-9999-9999-9999-999999999999')

export function defineSessionClauses(ctx: Ctx): void {
  describe('the session tree', () => {
    it('lists the four standard sessions, with the worktree session nested under its repository', async () => {
      const tree = await ctx.api.tree()
      expect(titles(tree)).toEqual([...STANDARD_TITLES].sort())
      const worktree = sessionOf(tree, STD.worktree.id)
      const repo = sessionOf(tree, STD.repoRoot.id)
      expect(worktree?.folder.isWorktree).toBe(true)
      expect(repo?.folder.children.map((c) => c.sessions.map((s) => s.sessionId)).flat()).toContain(STD.worktree.id)
      expect(sessionOf(tree, STD.csv.id)?.folder.isWorktree).toBe(false)
    })

    it('shows nothing until sessions are imported, and importing makes them appear', async () => {
      await ctx.restart({ imported: false })
      expect(await ctx.api.tree()).toEqual([])
      const before = await ctx.api.discovered()
      expect(before.map((d) => d.title).sort()).toEqual([...STANDARD_TITLES].sort())
      expect(before.every((d) => !d.imported)).toBe(true)

      await ctx.api.importSessions([STD.csv.id], [])
      expect((await ctx.api.discovered()).filter((d) => d.imported).map((d) => d.sessionId)).toEqual([STD.csv.id])
      expect(titles(await ctx.api.tree())).toEqual([STD.csv.title])
    })

    it('rename changes the title in the tree and tells every view the tree changed', async () => {
      await ctx.api.renameSession(STD.csv.id, 'Renamed session')
      expect(sessionOf(await ctx.api.tree(), STD.csv.id)?.session.title).toBe('Renamed session')
      expect(ctx.heard.count('treeChanged')).toBe(1)
    })

    it('remove takes the session out of the tree but leaves it imported, so it is not offered again as new, and signals the change', async () => {
      await ctx.api.removeSession(STD.switcher.id)
      expect(titles(await ctx.api.tree())).not.toContain(STD.switcher.title)
      const discovered = await ctx.api.discovered()
      expect(discovered.find((d) => d.sessionId === STD.switcher.id)?.imported).toBe(true)
      expect(ctx.heard.count('treeChanged')).toBe(1)
    })

    it('moving a session files it under the other folder and signals the change', async () => {
      await ctx.api.moveSession(STD.csv.id, ctx.bridge.folders.workB)
      const moved = sessionOf(await ctx.api.tree(), STD.csv.id)
      const sibling = sessionOf(await ctx.api.tree(), STD.switcher.id)
      expect(moved?.folder.path).toBe(sibling?.folder.path)
      expect(ctx.heard.count('treeChanged')).toBeGreaterThan(0)
    })

    it('refresh tells views to re-check merge requests, and does not claim the tree changed', async () => {
      await ctx.api.refresh()
      expect(ctx.heard.count('mrStatusesInvalidated')).toBe(1)
      expect(ctx.heard.count('treeChanged')).toBe(0)
      expect(titles(await ctx.api.tree())).toEqual([...STANDARD_TITLES].sort())
    })

    it('a session some other process is running is live in the tree and has a conflict naming it; one nobody runs has none', async () => {
      expect(sessionOf(await ctx.api.tree(), STD.csv.id)?.session.isLive).toBe(false)
      expect(await ctx.api.checkConflict(STD.csv.id)).toBeNull()

      await ctx.restart({ liveSession: STD.csv.id })
      expect(sessionOf(await ctx.api.tree(), STD.csv.id)?.session.isLive).toBe(true)
      expect(sessionOf(await ctx.api.tree(), STD.switcher.id)?.session.isLive).toBe(false)
      const conflict = await ctx.api.checkConflict(STD.csv.id)
      expect(conflict?.sessionId).toBe(STD.csv.id)
      expect(typeof conflict?.pid).toBe('number')
      expect(await ctx.api.checkConflict(STD.switcher.id)).toBeNull()
    })
  })

  describe('session notes', () => {
    it('trims a note, shows it in the tree, and signals the change', async () => {
      await ctx.api.setSessionNote(STD.csv.id, '  remember the header row  ')
      expect(await ctx.api.sessionNote(STD.csv.id)).toBe('remember the header row')
      expect(sessionOf(await ctx.api.tree(), STD.csv.id)?.session.note).toBe('remember the header row')
      expect(ctx.heard.count('treeChanged')).toBe(1)
    })

    it('a blank note clears it', async () => {
      await ctx.api.setSessionNote(STD.csv.id, 'something')
      await ctx.api.setSessionNote(STD.csv.id, '   ')
      expect(await ctx.api.sessionNote(STD.csv.id)).toBe('')
      expect(sessionOf(await ctx.api.tree(), STD.csv.id)?.session.note ?? null).toBeNull()
    })

    it('a session with no note answers an empty string', async () => {
      expect(await ctx.api.sessionNote(STD.switcher.id)).toBe('')
    })
  })

  describe('transcripts', () => {
    it('answers a short session in one page, in order, with nothing earlier', async () => {
      const page = await ctx.api.transcript(STD.csv.id)
      expect(page.earlierCursor).toBeNull()
      expect(page.messages[0].role).toBe('user')
      expect(JSON.stringify(page.messages[0].blocks)).toContain('the export is empty')
      expect(page.messages.at(-1)?.role).toBe('assistant')
    })

    it(`pages a long session ${String(TRANSCRIPT_PAGE_SIZE)} messages at a time, newest first, without overlap`, async () => {
      const total = TRANSCRIPT_PAGE_SIZE + 50
      await ctx.restart({ longSessionMessages: total })

      const first: TranscriptPage = await ctx.api.transcript(LONG_SESSION.id)
      expect(first.messages).toHaveLength(TRANSCRIPT_PAGE_SIZE)
      expect(first.earlierCursor).not.toBeNull()
      const second = await ctx.api.transcript(LONG_SESSION.id, first.earlierCursor ?? undefined)
      expect(second.messages).toHaveLength(50)
      expect(second.earlierCursor).toBeNull()

      const text = (p: TranscriptPage): string[] => p.messages.map((m) => JSON.stringify(m.blocks))
      const all = [...text(second), ...text(first)]
      expect(new Set(all).size).toBe(total)
      expect(all[0]).toContain('fix the export')
      expect(all.at(-1)).toContain('done')
    })
  })

  describe('starting sessions', () => {
    it('a new session in a known folder is a pending terminal labelled by the folder, and an unknown folder is refused', async () => {
      const info = await ctx.api.newSessionInProject(ctx.bridge.folders.workA)
      expect(isPendingPtyId(info.ptyId)).toBe(true)
      expect(info.label).toBe('work-a')
      // The renderer names a folder; main only starts a session in one it knows (CLAUDE.md, "Never").
      await expect(ctx.api.newSessionInProject('/no/such/folder')).rejects.toThrow()
    })

    it('a fork is a pending terminal labelled as a fork of the session, which stays as it was; a session the app does not know cannot be forked', async () => {
      const before = titles(await ctx.api.tree())
      const info = await ctx.api.forkSession(STD.csv.id)
      expect(isPendingPtyId(info.ptyId)).toBe(true)
      expect(info.label).toBe(forkLabel(STD.csv.title))
      expect(titles(await ctx.api.tree())).toEqual(before)
      await expect(ctx.api.forkSession(UNKNOWN_SESSION)).rejects.toThrow()
    })

    it('the folder picker starts a session in the folder it answers with, or in none when dismissed', async () => {
      const info = await ctx.api.newSessionInPickedFolder()
      expect(info).not.toBeNull()
      expect(info !== null && isPendingPtyId(info.ptyId)).toBe(true)
      expect(info?.label).toBe('picked')

      await ctx.restart({ cancelPicker: true })
      expect(await ctx.api.newSessionInPickedFolder()).toBeNull()
    })
  })
}
