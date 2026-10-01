/**
 * One behavioural spec of `window.apiary` (`ApiaryApi`), run against two implementations (TEST-5):
 *
 * - `tests/component/contract.test.tsx` runs it against `fakeApiary.ts`, the in-memory stand-in
 *   every component test renders against;
 * - `tests/integration/contract.test.ts` runs it against the real preload and the real main-process
 *   handlers (real `AppService`, real git, temp directories), connected by an in-process loopback
 *   instead of Electron's IPC transport.
 *
 * The fake is only worth anything as a *checked* model of main: a component test passes against
 * whatever the fake does, so every clause here is a way the two can no longer quietly disagree.
 * Clauses assert ids, titles and counts only, never absolute paths, so the same spec holds for
 * both. When the fake and main disagree, decide which one is wrong and fix that one.
 *
 * Imports nothing from Node or the DOM: it runs under both Vitest configs.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { ApiaryApi } from '@shared/api'
import type { ProjectNode, SessionNode, TranscriptPage } from '@shared/types'
import { DEFAULT_SETTINGS_PAYLOAD } from '@shared/settingsDefaults'
import { TRANSCRIPT_PAGE_SIZE } from '@shared/types'
import { STANDARD_SESSIONS as STD } from '../fixtures/standard'
import { asSessionId, ptyIdOfSession } from '@shared/domain/ids'
import { newPendingPtyId } from '@shared/domain/ptyId'

export interface BridgeOptions {
  /** Whether the standard sessions start imported into the tree (default true). */
  imported?: boolean
  /** Adds one more session, in the "work-a" folder, with this many transcript messages. */
  longSessionMessages?: number
}

export interface Bridge {
  api: ApiaryApi
  /** Folder paths the implementation uses for the plain folders, for `moveSession`. */
  folders: { workA: string; workB: string }
  cleanup(): void | Promise<void>
}

export type MakeBridge = (options: BridgeOptions) => Promise<Bridge>

export const LONG_SESSION = { id: asSessionId('55555555-5555-5555-5555-555555555555'), title: 'Long paging session' } as const

/** What `bridgeContract` seeds both implementations with, for clarity at the call sites. */
export const STANDARD_TITLES = Object.values(STD).map((s) => s.title)

interface Flat { session: SessionNode; folder: ProjectNode }

function flatten(nodes: ProjectNode[]): Flat[] {
  return nodes.flatMap((folder) => [
    ...folder.sessions.map((session) => ({ session, folder })),
    ...flatten(folder.children),
  ])
}

const titles = (tree: ProjectNode[]): string[] => flatten(tree).map((f) => f.session.title).sort()
const sessionOf = (tree: ProjectNode[], id: string): Flat | undefined =>
  flatten(tree).find((f) => f.session.sessionId === id)

/** Counts the events the renderer cares about, through the bridge's own subscriptions. */
function watch(api: ApiaryApi): { treeChanged: () => number; mrInvalidated: () => number; stop: () => void } {
  let tree = 0
  let mr = 0
  const offs = [api.onTreeChanged(() => { tree += 1 }), api.onMrStatusesInvalidated(() => { mr += 1 })]
  return { treeChanged: () => tree, mrInvalidated: () => mr, stop: () => { for (const off of offs) off() } }
}

export function defineBridgeContract(name: string, makeBridge: MakeBridge): void {
  describe(`window.apiary contract: ${name}`, () => {
    let bridge: Bridge
    let api: ApiaryApi
    let events: ReturnType<typeof watch>

    const start = async (options: BridgeOptions = {}): Promise<void> => {
      bridge = await makeBridge(options)
      api = bridge.api
      events = watch(api)
    }
    beforeEach(async () => { await start() })
    afterEach(async () => { events.stop(); await bridge.cleanup() })

    describe('the session tree', () => {
      it('lists the four standard sessions, with the worktree session nested under its repository', async () => {
        const tree = await api.tree()
        expect(titles(tree)).toEqual([...STANDARD_TITLES].sort())
        const worktree = sessionOf(tree, STD.worktree.id)
        const repo = sessionOf(tree, STD.repoRoot.id)
        expect(worktree?.folder.isWorktree).toBe(true)
        expect(repo?.folder.children.map((c) => c.sessions.map((s) => s.sessionId)).flat()).toContain(STD.worktree.id)
        expect(sessionOf(tree, STD.csv.id)?.folder.isWorktree).toBe(false)
      })

      it('shows nothing until sessions are imported, and importing makes them appear', async () => {
        events.stop()
        await bridge.cleanup()
        await start({ imported: false })
        expect(await api.tree()).toEqual([])
        const before = await api.discovered()
        expect(before.map((d) => d.title).sort()).toEqual([...STANDARD_TITLES].sort())
        expect(before.every((d) => !d.imported)).toBe(true)

        await api.importSessions([STD.csv.id], [])
        expect((await api.discovered()).filter((d) => d.imported).map((d) => d.sessionId)).toEqual([STD.csv.id])
        expect(titles(await api.tree())).toEqual([STD.csv.title])
      })

      it('rename changes the title in the tree and tells every view the tree changed', async () => {
        await api.renameSession(STD.csv.id, 'Renamed session')
        expect(sessionOf(await api.tree(), STD.csv.id)?.session.title).toBe('Renamed session')
        expect(events.treeChanged()).toBe(1)
      })

      it('remove takes the session out of the tree but leaves it imported, so it is not offered again as new, and signals the change', async () => {
        await api.removeSession(STD.switcher.id)
        expect(titles(await api.tree())).not.toContain(STD.switcher.title)
        const discovered = await api.discovered()
        expect(discovered.find((d) => d.sessionId === STD.switcher.id)?.imported).toBe(true)
        expect(events.treeChanged()).toBe(1)
      })

      it('moving a session files it under the other folder and signals the change', async () => {
        await api.moveSession(STD.csv.id, bridge.folders.workB)
        const moved = sessionOf(await api.tree(), STD.csv.id)
        const sibling = sessionOf(await api.tree(), STD.switcher.id)
        expect(moved?.folder.path).toBe(sibling?.folder.path)
        expect(events.treeChanged()).toBeGreaterThan(0)
      })

      it('refresh tells views to re-check merge requests, and does not claim the tree changed', async () => {
        await api.refresh()
        expect(events.mrInvalidated()).toBe(1)
        expect(events.treeChanged()).toBe(0)
        expect(titles(await api.tree())).toEqual([...STANDARD_TITLES].sort())
      })
    })

    describe('session notes', () => {
      it('trims a note, shows it in the tree, and signals the change', async () => {
        await api.setSessionNote(STD.csv.id, '  remember the header row  ')
        expect(await api.sessionNote(STD.csv.id)).toBe('remember the header row')
        expect(sessionOf(await api.tree(), STD.csv.id)?.session.note).toBe('remember the header row')
        expect(events.treeChanged()).toBe(1)
      })

      it('a blank note clears it', async () => {
        await api.setSessionNote(STD.csv.id, 'something')
        await api.setSessionNote(STD.csv.id, '   ')
        expect(await api.sessionNote(STD.csv.id)).toBe('')
        expect(sessionOf(await api.tree(), STD.csv.id)?.session.note ?? null).toBeNull()
      })

      it('a session with no note answers an empty string', async () => {
        expect(await api.sessionNote(STD.switcher.id)).toBe('')
      })
    })

    describe('settings', () => {
      it('answers every field of the shared payload, at its default on a fresh profile', async () => {
        const settings = await api.settingsGet()
        for (const key of Object.keys(DEFAULT_SETTINGS_PAYLOAD) as (keyof typeof DEFAULT_SETTINGS_PAYLOAD)[]) {
          expect(settings, `settingsGet is missing ${key}`).toHaveProperty(key)
        }
        expect(settings.searchChatContent).toBe(DEFAULT_SETTINGS_PAYLOAD.searchChatContent)
        expect(settings.recentSectionEnabled).toBe(DEFAULT_SETTINGS_PAYLOAD.recentSectionEnabled)
      })

      it('a partial save changes what it names and keeps everything else', async () => {
        const before = await api.settingsGet()
        await api.settingsSet({ terminalShortenPath: !before.terminalShortenPath } as never)
        const after = await api.settingsGet()
        expect(after.terminalShortenPath).toBe(!before.terminalShortenPath)
        expect({ ...after, terminalShortenPath: before.terminalShortenPath }).toEqual(before)
      })

      it('a key sent as undefined leaves the stored value alone', async () => {
        await api.settingsSet({ searchSessionNotes: false } as never)
        await api.settingsSet({ searchSessionNotes: undefined } as never)
        expect((await api.settingsGet()).searchSessionNotes).toBe(false)
      })
    })

    describe('transcripts', () => {
      it('answers a short session in one page, in order, with nothing earlier', async () => {
        const page = await api.transcript(STD.csv.id)
        expect(page.earlierCursor).toBeNull()
        expect(page.messages[0].role).toBe('user')
        expect(JSON.stringify(page.messages[0].blocks)).toContain('the export is empty')
        expect(page.messages.at(-1)?.role).toBe('assistant')
      })

      it(`pages a long session ${String(TRANSCRIPT_PAGE_SIZE)} messages at a time, newest first, without overlap`, async () => {
        const total = TRANSCRIPT_PAGE_SIZE + 50
        events.stop()
        await bridge.cleanup()
        await start({ longSessionMessages: total })

        const first: TranscriptPage = await api.transcript(LONG_SESSION.id)
        expect(first.messages).toHaveLength(TRANSCRIPT_PAGE_SIZE)
        expect(first.earlierCursor).not.toBeNull()
        const second = await api.transcript(LONG_SESSION.id, first.earlierCursor ?? undefined)
        expect(second.messages).toHaveLength(50)
        expect(second.earlierCursor).toBeNull()

        const text = (p: TranscriptPage): string[] => p.messages.map((m) => JSON.stringify(m.blocks))
        const all = [...text(second), ...text(first)]
        expect(new Set(all).size).toBe(total)
        expect(all[0]).toContain('fix the export')
        expect(all.at(-1)).toContain('done')
      })
    })

    describe('git', () => {
      it('creating a branch checks it out, lists it, and signals the tree changed', async () => {
        await api.gitCreateBranch({ kind: 'session', id: STD.repoRoot.id }, 'feature/contract')
        const refs = await api.gitListRefs({ kind: 'session', id: STD.repoRoot.id })
        expect(refs.current).toBe('feature/contract')
        expect(refs.local.map((r) => r.name)).toContain('feature/contract')
        expect(events.treeChanged()).toBeGreaterThan(0)
      })
    })

    describe('plugins and the status bar', () => {
      it('lists plugins with an id and a name each, and a status bar as an array', async () => {
        const plugins = await api.pluginList()
        expect(Array.isArray(plugins)).toBe(true)
        expect(new Set(plugins.map((p) => p.id)).size).toBe(plugins.length)
        for (const p of plugins) { expect(typeof p.id).toBe('string'); expect(typeof p.name).toBe('string') }
        expect(Array.isArray(await api.statusBarItems())).toBe(true)
        expect(Array.isArray(await api.pluginBarItems({ kind: 'session', id: STD.repoRoot.id }))).toBe(true)
      })
    })

    describe('terminals', () => {
      it('a fresh profile has no running terminals', async () => {
        expect(await api.ptyRunning([ptyIdOfSession(STD.csv.id), newPendingPtyId(STD.csv.id)])).toEqual([])
        expect(await api.ptySessions()).toEqual({})
      })
    })
  })
}
