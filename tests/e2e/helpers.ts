import { _electron as electron, type ElectronApplication, type Page } from '@playwright/test'
import { mkdtempSync, mkdirSync, rmSync, realpathSync, writeFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { makeSession, type FixtureOptions } from '../fixtures/makeSession'

export interface Harness {
  app: ElectronApplication
  page: Page
  /** Throwaway config/profile root for this run — needed to relaunch against the same profile. */
  home: string
  /** Root directory scanned for project folders — pass to `makeSession` to add fixture sessions after launch. */
  projectsRoot: string
  /** cwd of the fixture session in the first plain (non-git) project folder, "work-a". */
  workdir: string
  /** cwd of the fixture session in the second plain (non-git) project folder, "work-b". */
  workdirB: string
  /** Root of the fixture git repo, "repo-c" — has its own session plus a nested worktree. */
  repoRoot: string
  /** A `git worktree add` checkout of repoRoot, nested under it in the tree. */
  worktreeDir: string
  close(): Promise<void>
}

function git(cwd: string, ...args: string[]): void {
  execFileSync('git', args, { cwd, stdio: 'pipe' })
}

/** Builds a real git repo plus a real worktree of it, so the tree exercises actual nesting. */
function makeRepoWithWorktree(home: string): { repoRoot: string; worktreeDir: string } {
  const repoRoot = join(home, 'repo-c')
  mkdirSync(repoRoot)
  git(repoRoot, 'init', '-q', '-b', 'main')
  git(repoRoot, 'config', 'user.email', 'test@example.com')
  git(repoRoot, 'config', 'user.name', 'Test')
  writeFileSync(join(repoRoot, 'README.md'), 'hi')
  git(repoRoot, 'add', '.')
  git(repoRoot, '-c', 'commit.gpgsign=false', 'commit', '-qm', 'init')

  const worktreeDir = join(home, 'repo-c-wt')
  git(repoRoot, 'worktree', 'add', '-q', '-b', 'feature/wt', worktreeDir)

  return { repoRoot, worktreeDir }
}

/**
 * Launches Apiary against a throwaway config root seeded with four sessions spread across
 * three distinct project groups: two unrelated plain folders (work-a, work-b) and a git repo
 * (repo-c) with a real worktree (repo-c-wt) nested under it. This shape is what makes the
 * grouping and collapse specs able to tell "grouped correctly" apart from "flattened" or
 * "collapsed everything".
 *
 * `extraSessions`, when given, adds further fixture sessions *before* the app launches, so the
 * app's own startup scan picks them up the same way it picks up the standard four. A session
 * written to disk only after launch is picked up either by the filesystem watcher's debounced
 * rescan, or by clicking "Refresh" in the UI, which now triggers a real rescan of disk (not just
 * a re-fetch of whatever the store already holds). Each entry needs its own project `slug`; `cwd` is
 * derived from the slug and created automatically (the caller cannot know `home`, the throwaway
 * root this function creates, ahead of time), so `cwd` is omitted from `FixtureOptions` here.
 */
export async function launchApiary(
  opts: {
    extraSessions?: Array<Omit<FixtureOptions, 'cwd'> & { slug: string }>
    withMissingCwd?: boolean
    fakeLiveSessionId?: string
  } = {},
): Promise<Harness> {
  // realpath the root up front: on macOS os.tmpdir() is under /var, a symlink to /private/var,
  // while git resolves absolute paths (--show-toplevel, --git-common-dir) to the real path.
  // Canonicalizing here keeps our expectations and the app's own resolveProject() comparable
  // (see tests/unit/worktreeResolver.test.ts, which follows the same pattern).
  const home = realpathSync(mkdtempSync(join(tmpdir(), 'apiary-e2e-')))
  const projects = join(home, 'projects')
  mkdirSync(projects, { recursive: true })

  const workdir = join(home, 'work-a')
  mkdirSync(workdir)
  const workdirB = join(home, 'work-b')
  mkdirSync(workdirB)
  const { repoRoot, worktreeDir } = makeRepoWithWorktree(home)

  makeSession(projects, '-work-a', {
    sessionId: '11111111-1111-1111-1111-111111111111',
    cwd: workdir,
    title: 'Fix CSV export bug',
    firstPrompt: 'the export is empty',
    extraLines: [
      JSON.stringify({
        sessionId: '11111111-1111-1111-1111-111111111111',
        cwd: workdir,
        gitBranch: 'main',
        isSidechain: true,
        version: '2.1.246',
        type: 'assistant',
        uuid: 'side1',
        timestamp: '2026-09-01T10:00:30.000Z',
        message: { role: 'assistant', content: [{ type: 'text', text: 'subagent side note' }] },
      }),
    ],
  })
  makeSession(projects, '-work-b', {
    sessionId: '22222222-2222-2222-2222-222222222222',
    cwd: workdirB,
    title: 'Add worktree switcher',
  })
  makeSession(projects, '-repo-c', {
    sessionId: '33333333-3333-3333-3333-333333333333',
    cwd: repoRoot,
    gitBranch: 'main',
    title: 'Repo root session',
  })
  makeSession(projects, '-repo-c-wt', {
    sessionId: '44444444-4444-4444-4444-444444444444',
    cwd: worktreeDir,
    gitBranch: 'feature/wt',
    title: 'Worktree session',
  })

  for (const { slug, ...o } of opts.extraSessions ?? []) {
    const cwd = join(home, slug.replace(/^-+/, '') || slug)
    mkdirSync(cwd, { recursive: true })
    makeSession(projects, slug, { ...o, cwd })
  }

  if (opts.withMissingCwd === true) {
    // Uses a session id distinct from the four standard fixture sessions above (and thus from
    // '33333333-...', which belongs to the "-repo-c" session) — reusing an id here would collide
    // in the session store, since sessionId is the unique key across scan and import.
    makeSession(projects, '-gone', {
      sessionId: '55555555-5555-5555-5555-555555555555',
      cwd: '/definitely/not/here',
      title: 'Orphaned worktree session',
    })
  }

  const app = await electron.launch({
    // Every launch gets its own Chromium profile dir under the throwaway `home` this call
    // already created, instead of sharing Electron's OS-default userData directory (and thus
    // the developer's real Apiary profile) across every test run and relaunch.
    args: [`--user-data-dir=${join(home, 'userdata')}`, '.'],
    env: {
      ...process.env,
      APIARY_CONFIG_ROOT: home,
      APIARY_DB_PATH: join(home, 'apiary.db'),
      APIARY_FAKE_LIVE: opts.fakeLiveSessionId ?? '',
    },
  })
  const page = await app.firstWindow()
  await page.waitForLoadState('domcontentloaded')

  return {
    app,
    page,
    home,
    projectsRoot: projects,
    workdir,
    workdirB,
    repoRoot,
    worktreeDir,
    async close() {
      await app.close()
      rmSync(home, { recursive: true, force: true })
      rmSync(workdir, { recursive: true, force: true })
      rmSync(workdirB, { recursive: true, force: true })
    },
  }
}

/**
 * Closes the harness's current Electron app and relaunches a fresh one against the same
 * `--user-data-dir` profile (so `localStorage` survives) and the same `APIARY_CONFIG_ROOT`/
 * `APIARY_DB_PATH` (so the same sessions/projects are scanned again). Mutates `h.app`/`h.page`
 * in place; `h.close()` still works afterwards and cleans up the one shared `home` directory.
 */
export async function relaunchApiary(h: Harness): Promise<void> {
  await h.app.close()
  const app = await electron.launch({
    args: [`--user-data-dir=${join(h.home, 'userdata')}`, '.'],
    env: {
      ...process.env,
      APIARY_CONFIG_ROOT: h.home,
      APIARY_DB_PATH: join(h.home, 'apiary.db'),
      APIARY_FAKE_LIVE: '',
    },
  })
  const page = await app.firstWindow()
  await page.waitForLoadState('domcontentloaded')
  h.app = app
  h.page = page
}

/** Imports every discovered session, bypassing the dialog. */
export async function importAll(page: Page): Promise<void> {
  await page.evaluate(async () => {
    const all = await window.apiary.discovered()
    await window.apiary.importSessions(all.map((s) => s.sessionId), [])
  })
}

/**
 * How the intercepted `apiary:transcript` main-process IPC handler should treat a *paging*
 * call (one carrying a `beforeIndex`/cursor argument). The initial per-session load (no
 * `beforeIndex`) always passes straight through to the real handler regardless of behavior,
 * so switching sessions and the first render of any session are unaffected by the intercept.
 */
export type PagingBehavior =
  | { kind: 'passthrough' }
  | { kind: 'hold' }
  | { kind: 'reject'; message: string }

/**
 * Replaces the main-process `apiary:transcript` IPC handler with one whose behavior on paging
 * calls is controlled from the test, with zero changes to any production file. This is possible
 * only from the main process (not the sandboxed renderer, where `contextBridge` freezes
 * `window.apiary`): `electron.ElectronApplication#evaluate` runs inside the real Electron main
 * process, which has full Node/Electron access, including `ipcMain`.
 *
 * `ipcMain.handle` keeps registered handlers on the (undocumented, but stable across Electron's
 * JS-side ipcMain implementation) `ipcMain._invokeHandlers` Map, keyed by channel — that map is
 * how the *true* production handler is captured (once, on the first call) so every later call
 * to this function re-wraps that same original rather than re-wrapping a previous wrapper.
 *
 * A held paging call is released with `releaseHeldTranscriptPaging`; calling this again with a
 * different `behavior` (e.g. `{ kind: 'passthrough' }`) restores normal behavior for further
 * paging calls without needing to relaunch the app.
 */
export async function interceptTranscriptPaging(
  app: ElectronApplication,
  behavior: PagingBehavior,
): Promise<void> {
  await app.evaluate(({ ipcMain }, behavior) => {
    type Handler = (event: unknown, ...args: unknown[]) => unknown
    const g = globalThis as Record<string, unknown>
    const anyIpc = ipcMain as unknown as { _invokeHandlers: Map<string, Handler> }

    if (g.__apiaryOriginalTranscriptHandler === undefined) {
      const current = anyIpc._invokeHandlers.get('apiary:transcript')
      if (!current) throw new Error('apiary:transcript handler is not registered')
      g.__apiaryOriginalTranscriptHandler = current
    }
    const original = g.__apiaryOriginalTranscriptHandler as Handler

    ipcMain.removeHandler('apiary:transcript')
    const pending = ((g.__apiaryPendingPagingReleases as Array<() => void> | undefined) ?? [])
    g.__apiaryPendingPagingReleases = pending
    g.__apiaryReleaseNextPaging = () => {
      const next = pending.shift()
      if (next) next()
    }

    ipcMain.handle('apiary:transcript', async (event: unknown, id: string, beforeIndex?: number) => {
      if (beforeIndex === undefined || behavior.kind === 'passthrough') {
        return original(event, id, beforeIndex)
      }
      if (behavior.kind === 'reject') {
        throw new Error(behavior.message)
      }
      // behavior.kind === 'hold': block until the test releases this specific call.
      await new Promise<void>((resolve) => { pending.push(resolve) })
      return original(event, id, beforeIndex)
    })
  }, behavior)
}

/** Resolves the oldest still-held paging call installed by `interceptTranscriptPaging({ kind: 'hold' })`. */
export async function releaseHeldTranscriptPaging(app: ElectronApplication): Promise<void> {
  await app.evaluate(() => {
    const fn = (globalThis as Record<string, unknown>).__apiaryReleaseNextPaging as
      | (() => void)
      | undefined
    if (fn) fn()
  })
}

/**
 * Installs a counter on the `apiary:pty-kill` IPC channel, in addition to (not instead of) the
 * app's own handler, so this is the true signal for "was the PTY actually asked to die" —
 * unlike terminal *content*, which the resumed process can repaint identically after a remount
 * (an interactive CLI often redraws its whole screen on the resize a fresh mount triggers),
 * making content comparisons blind to a tab switch that silently tore the pty down and rebuilt
 * it. `ipcMain.on` supports multiple listeners on one channel, so this does not disturb the
 * production handler registered in `registerIpc`.
 */
export async function countPtyKillCalls(app: ElectronApplication): Promise<void> {
  await app.evaluate(({ ipcMain }) => {
    const g = globalThis as Record<string, unknown>
    g.__apiaryPtyKillCalls = 0
    ipcMain.on('apiary:pty-kill', () => {
      g.__apiaryPtyKillCalls = ((g.__apiaryPtyKillCalls as number | undefined) ?? 0) + 1
    })
  })
}

/** Reads the count installed by `countPtyKillCalls`. */
export async function ptyKillCallCount(app: ElectronApplication): Promise<number> {
  return app.evaluate(() => (globalThis as Record<string, unknown>).__apiaryPtyKillCalls as number ?? 0)
}

/**
 * Installs a counter on the `apiary:pty-resize` IPC channel, the same way `countPtyKillCalls`
 * does for `apiary:pty-kill`. `TerminalView`'s `ResizeObserver` calls this on every callback it
 * receives (via `window.apiary.ptyResize`), so a layout that oscillates between two sizes — the
 * `fit()`/`ResizeObserver` feedback loop this counter exists to catch — shows up as the count
 * climbing without bound instead of settling once the terminal's box stops changing.
 */
export async function countPtyResizeCalls(app: ElectronApplication): Promise<void> {
  await app.evaluate(({ ipcMain }) => {
    const g = globalThis as Record<string, unknown>
    g.__apiaryPtyResizeCalls = 0
    ipcMain.on('apiary:pty-resize', () => {
      g.__apiaryPtyResizeCalls = ((g.__apiaryPtyResizeCalls as number | undefined) ?? 0) + 1
    })
  })
}

/** Reads the count installed by `countPtyResizeCalls`. */
export async function ptyResizeCallCount(app: ElectronApplication): Promise<number> {
  return app.evaluate(() => (globalThis as Record<string, unknown>).__apiaryPtyResizeCalls as number ?? 0)
}
