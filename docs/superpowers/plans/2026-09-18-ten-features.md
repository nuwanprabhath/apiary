# Ten Features for 1.18.0 — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship ten independent improvements to Apiary — a working installer path on Ubuntu, session restore across restarts, GitLab MR status, Recent and Active sidebar sections, a search that keeps up with typing, moving a session between worktrees, an Enter shortcut in the branch switcher, an Open in VS Code button, and a terminal paste fix — as one release, 1.18.0.

**Architecture:** Each feature is one task with its own tests and its own commit, on the shared branch `feature/ten-features-1.18.0`. Pure logic (ranking, parsing, activity classification, layout records) lives in its own module with node-environment unit tests; Electron-dependent behaviour is covered by Playwright end-to-end tests. Main owns processes, the database and every external binary; the renderer owns presentation and per-window state.

**Tech Stack:** Electron 38, React 18, TypeScript (strict), electron-vite, better-sqlite3, xterm.js, node-pty, Vitest (node environment), Playwright.

## Global Constraints

- Branch: `feature/ten-features-1.18.0`. Do not push it.
- Version becomes `1.18.0` with its own changelog section. Never reuse a published version.
- Unit tests: `npm test`. End-to-end tests: `npm run test:e2e`. Never invoke `npx vitest` or `npx playwright` directly, and never run both suites at once — they rebuild native modules for different ABIs.
- Commit messages carry no AI attribution of any kind.
- Every colour, spacing, radius and duration is a CSS token defined in the stylesheet — never a literal inside a rule.
- A session's `cwd` is read from inside its JSONL transcript, never derived from the `~/.claude/projects/<encoded-path>` directory name.
- Nothing may add a synchronous main-process call on a path that runs per keystroke.
- External binaries (`glab`, `code`, installers) are spawned with an argument array, never through a shell, and every test fakes the spawn.
- A pty belongs to the main process; `ptyRunning` is the authority on whether a session is live.
- TypeScript is strict in both tsconfigs; `npm run typecheck` must pass before every commit.

---

---

### Task 1: Installer opens or reveals reliably, and every platform gets a copy-able command

**Files:**
- Modify: `src/main/update/capability.ts:64-88`
- Modify: `src/main/update/electronUpdaterBackend.ts:1-11,101-190`
- Modify: `src/main/update/updateService.ts:32-53,61-79,250-298`
- Modify: `src/renderer/components/UpdateBanner.tsx:112-132`
- Modify: `src/shared/api.ts:66-80,324-327`
- Modify: `src/preload/index.ts` (no signature change needed — `updateOpenDownloaded` already forwards the resolved value; only the return *type* changes via `shared/api.ts`)
- Modify: `src/main/ipc.ts:356`
- Create: `tests/unit/electronUpdaterBackend.test.ts`
- Modify: `tests/unit/installInstructions.test.ts`
- Modify: `tests/integration/updateService.test.ts`
- Modify: `tests/e2e/update.spec.ts`

**Interfaces:**
- Consumes: `installInstructions(input: CapabilityInput, path: string): InstallInstructions` (existing, `src/main/update/capability.ts`); `UpdateBackend.downloadInstaller(onProgress): Promise<string>` (existing); `shell.openPath`, `shell.showItemInFolder` from `electron`; `UpdateService.download()` / `UpdateService.openDownloaded()` (existing, `src/main/update/updateService.ts`).
- Produces:
  - `export type OpenInstallerResult = { ok: 'opened' } | { ok: 'revealed' } | { ok: 'failed'; reason: string }` (new, in `src/main/update/updateService.ts`)
  - `UpdateBackend.openInstaller(path: string, action: InstallInstructions['action']): Promise<OpenInstallerResult>` (changed return type, was `Promise<void>`)
  - `UpdateService.openDownloaded(): Promise<OpenInstallerResult>` (changed return type, was `Promise<void>`)
  - `UpdateStatus.openResult: OpenInstallerResult | null` (new field, `src/main/update/updateService.ts`)
  - `export const OPEN_TIMEOUT_MS = 10_000` (now exported from `src/main/update/electronUpdaterBackend.ts`, was private)
  - `installInstructions()` now returns a non-null `command` for a Linux AppImage and a macOS `.dmg` (was `null` for both)

- [ ] **Step 1: Write the failing unit tests for the command builder**

```ts
// tests/unit/installInstructions.test.ts — add inside the existing describe('installInstructions', ...) block,
// and change the mac test that currently asserts `command` is null.

it('gives an AppImage the command that makes it executable and runs it', () => {
  const { command, action } = installInstructions(linux, '/tmp/Apiary-1.13.0.AppImage')
  expect(command).toBe("chmod +x '/tmp/Apiary-1.13.0.AppImage' && '/tmp/Apiary-1.13.0.AppImage'")
  expect(action).toBe('open')
})

it('quotes an AppImage path with a space and one with an apostrophe', () => {
  expect(installInstructions(linux, '/home/a b/Apiary-1.13.0.AppImage').command)
    .toBe("chmod +x '/home/a b/Apiary-1.13.0.AppImage' && '/home/a b/Apiary-1.13.0.AppImage'")
  expect(installInstructions(linux, "/home/o'brien/Apiary-1.13.0.AppImage").command)
    .toBe("chmod +x '/home/o'\\''brien/Apiary-1.13.0.AppImage' && '/home/o'\\''brien/Apiary-1.13.0.AppImage'")
})

it('gives a mac .dmg a one-line command that mounts, copies and detaches it', () => {
  const { command, action } = installInstructions(mac, '/tmp/Apiary-1.13.0-arm64.dmg')
  expect(command).toContain('hdiutil attach')
  expect(command).toContain('/Applications')
  expect(command).toContain('hdiutil detach')
  expect(action).toBe('open')
})

it('quotes a .dmg path with a space and one with an apostrophe', () => {
  expect(installInstructions(mac, '/Users/a b/Apiary-1.13.0.dmg').command).toContain("'/Users/a b/Apiary-1.13.0.dmg'")
  expect(installInstructions(mac, "/Users/o'brien/Apiary-1.13.0.dmg").command)
    .toContain("'/Users/o'\\''brien/Apiary-1.13.0.dmg'")
})
```

Also change the existing test (it currently asserts `command` is null, which the design now contradicts):

```ts
// was: it('still tells a mac user to drag it into Applications, with no command to run', ...)
it('still tells a mac user to drag it into Applications, and gives the command that does it', () => {
  const { hint, command, action } = installInstructions(mac, '/tmp/Apiary-1.13.0-arm64.dmg')
  expect(hint).toContain('Applications')
  expect(command).not.toBeNull()
  expect(action).toBe('open')
})
```

- [ ] **Step 2: Run the test and watch it fail**
Run: `npm test -- installInstructions` — expected: `expect(received).toBe(expected)` failures on the two new AppImage assertions (`command` is currently `null` for anything but `.deb`), and the changed mac test fails because `command` is currently `null`.

- [ ] **Step 3: Add the AppImage and dmg commands to `installInstructions`**

```ts
// src/main/update/capability.ts — replace the body of installInstructions
export function installInstructions(input: CapabilityInput, path: string): InstallInstructions {
  if (input.platform === 'linux' && path.endsWith('.deb')) {
    return {
      hint: 'Installing a .deb needs root, so Apiary cannot do it for you. Run this to finish:',
      command: `sudo apt install ${shellQuote(path)}`,
      action: 'reveal',
    }
  }
  if (input.platform === 'linux') {
    // An AppImage downloaded over HTTP has no executable bit — nothing on a stock desktop can
    // run it by double-clicking, so the copy-able command is the one thing guaranteed to work
    // even where `openInstaller` cannot launch it either (see electronUpdaterBackend.ts).
    return {
      hint: 'Open it to finish updating. If nothing happens, run this to finish:',
      command: `chmod +x ${shellQuote(path)} && ${shellQuote(path)}`,
      action: 'open',
    }
  }
  if (input.platform === 'darwin') {
    return {
      hint: 'Open it and drag Apiary into Applications to finish updating.',
      // One line rather than three separate steps to copy: mount the image quietly, copy the
      // bundle over whatever is already installed, detach so the Finder window does not linger.
      command: `hdiutil attach ${shellQuote(path)} -nobrowse -quiet `
        + `&& cp -R /Volumes/Apiary/Apiary.app /Applications/ `
        + `&& hdiutil detach /Volumes/Apiary -quiet`,
      action: 'open',
    }
  }
  return { hint: 'Open it to finish updating.', command: null, action: 'open' }
}
```

- [ ] **Step 4: Run the test again and confirm it passes**
Run: `npm test -- installInstructions`

- [ ] **Step 5: Write the failing unit tests for `openInstaller`'s three outcomes and the chmod**

```ts
// tests/unit/electronUpdaterBackend.test.ts (new file)
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { PassThrough } from 'node:stream'
import { createHash } from 'node:crypto'
import { mkdtemp, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const openPath = vi.fn<[string], Promise<string>>()
const showItemInFolder = vi.fn<[string], void>()
const checkForUpdates = vi.fn()
const downloadUpdate = vi.fn()
const quitAndInstall = vi.fn()
const httpGet = vi.fn()

vi.mock('electron', () => ({
  app: { getPath: () => tmpdir() },
  shell: { openPath: (p: string) => openPath(p), showItemInFolder: (p: string) => showItemInFolder(p) },
}))
vi.mock('electron-updater', () => ({
  default: {
    autoUpdater: {
      get autoDownload() { return true }, set autoDownload(_v: boolean) {},
      set autoInstallOnAppQuit(_v: boolean) {},
      set logger(_v: unknown) {},
      set allowPrerelease(_v: boolean) {},
      checkForUpdates: (...args: unknown[]) => checkForUpdates(...args),
      downloadUpdate: (...args: unknown[]) => downloadUpdate(...args),
      quitAndInstall: (...args: unknown[]) => quitAndInstall(...args),
      on: () => {}, off: () => {},
    },
  },
}))
vi.mock('node:https', () => ({ get: (...args: unknown[]) => httpGet(...args) }))

// Imported after the mocks above so the module picks them up.
const { createUpdateBackend, OPEN_TIMEOUT_MS } = await import('../../src/main/update/electronUpdaterBackend')

/** A response `node:https`'s `get` would hand back: a readable stream plus HTTP's own fields. */
function fakeResponse(body: Buffer, statusCode = 200): PassThrough & { statusCode: number; headers: Record<string, string> } {
  const stream = Object.assign(new PassThrough(), { statusCode, headers: {} })
  process.nextTick(() => stream.end(body))
  return stream
}

describe('downloadInstaller', () => {
  let dir: string
  beforeEach(async () => { dir = await mkdtemp(join(tmpdir(), 'apiary-update-')) })
  afterEach(async () => { await rm(dir, { recursive: true, force: true }); vi.clearAllMocks() })

  it('makes a downloaded Linux installer executable once its checksum passes', async () => {
    const bytes = Buffer.from('fake appimage bytes')
    const sha512 = createHash('sha512').update(bytes).digest('base64')
    checkForUpdates.mockResolvedValue({
      updateInfo: {
        version: '1.18.0',
        releaseNotes: 'notes',
        files: [{ url: 'Apiary-1.18.0.AppImage', sha512, size: bytes.length }],
      },
    })
    httpGet.mockImplementation((_url: string, _opts: unknown, cb: (r: unknown) => void) => {
      cb(fakeResponse(bytes))
      return { on: () => {} }
    })

    const backend = createUpdateBackend({ repo: 'nuwan/apiary', platform: 'linux', arch: 'x64', downloadDir: dir })
    await backend.check({ allowPrerelease: false })
    const path = await backend.downloadInstaller(() => {})

    const mode = (await stat(path)).mode & 0o777
    expect(mode).toBe(0o755)
  })
})

describe('openInstaller', () => {
  afterEach(() => { vi.clearAllMocks() })

  it('reports "opened" when the OS launches it before the timeout', async () => {
    openPath.mockResolvedValue('')
    const backend = createUpdateBackend({ repo: 'nuwan/apiary', platform: 'darwin', arch: 'arm64' })
    const result = await backend.openInstaller('/tmp/Apiary-1.18.0.dmg', 'open')
    expect(result).toEqual({ ok: 'opened' })
    expect(showItemInFolder).not.toHaveBeenCalled()
  })

  it('reports "revealed", not success, when the OS never comes back before the timeout', async () => {
    vi.useFakeTimers()
    openPath.mockReturnValue(new Promise(() => {})) // never resolves — the bug this exists for.
    const backend = createUpdateBackend({ repo: 'nuwan/apiary', platform: 'linux', arch: 'x64' })
    const pending = backend.openInstaller('/home/nuwan/Downloads/apiary.deb', 'open')
    await vi.advanceTimersByTimeAsync(OPEN_TIMEOUT_MS)
    const result = await pending
    expect(result).toEqual({ ok: 'revealed' })
    expect(showItemInFolder).toHaveBeenCalledWith('/home/nuwan/Downloads/apiary.deb')
    vi.useRealTimers()
  })

  it('reveals rather than opens when the action is "reveal", and reports it', async () => {
    const backend = createUpdateBackend({ repo: 'nuwan/apiary', platform: 'linux', arch: 'x64' })
    const result = await backend.openInstaller('/home/nuwan/Downloads/apiary.deb', 'reveal')
    expect(result).toEqual({ ok: 'revealed' })
    expect(openPath).not.toHaveBeenCalled()
  })

  it('reports "failed" with a reason when even revealing it throws', async () => {
    showItemInFolder.mockImplementation(() => { throw new Error('no file manager registered') })
    const backend = createUpdateBackend({ repo: 'nuwan/apiary', platform: 'linux', arch: 'x64' })
    const result = await backend.openInstaller('/home/nuwan/Downloads/apiary.deb', 'reveal')
    expect(result).toEqual({ ok: 'failed', reason: 'no file manager registered' })
  })
})
```

- [ ] **Step 6: Run the test and watch it fail**
Run: `npm test -- electronUpdaterBackend` — expected failure: TypeScript/runtime error, since `openInstaller` still resolves `void` (so `toEqual({ ok: 'opened' })` fails against `undefined`), and `downloadInstaller` does not chmod (mode assertion fails with the file's default `0o644`-ish mode).

- [ ] **Step 7: Add the chmod and the discriminated result to the real backend**

```ts
// src/main/update/electronUpdaterBackend.ts — add the import
import { createWriteStream } from 'node:fs'
import { chmod, mkdir, rm, stat } from 'node:fs/promises'
// ...
import type { FeedResult, OpenInstallerResult, UpdateBackend } from './updateService'

// export the timeout so it can be driven from a test rather than duplicated as a magic number
export const OPEN_TIMEOUT_MS = 10_000
```

```ts
      // Nothing else should be able to produce a zero-length "verified" file, but the cost of
      // being sure is one stat.
      if ((await stat(target)).size === 0) throw new Error('The download was empty')

      // A downloaded file carries no executable bit. On Linux that is fatal for an AppImage —
      // nothing on the desktop can run it by double-clicking, and `openInstaller` below would
      // otherwise "succeed" at opening a file nothing can execute. Only after the checksum has
      // passed: a mismatched download must never be left runnable.
      if (opts.platform === 'linux') await chmod(target, 0o755)

      return target
    },

    async openInstaller(path: string, action: 'open' | 'reveal'): Promise<OpenInstallerResult> {
      const settle = <T>(promise: Promise<T>, fallback: T): Promise<T> => Promise.race([
        promise,
        new Promise<T>((resolve) => setTimeout(() => resolve(fallback), OPEN_TIMEOUT_MS)),
      ])

      const reveal = (): OpenInstallerResult => {
        try {
          shell.showItemInFolder(path)
          return { ok: 'revealed' }
        } catch (e) {
          const reason = e instanceof Error ? e.message : String(e)
          log.warn('update', 'could not reveal installer', { path, error: reason })
          return { ok: 'failed', reason }
        }
      }

      if (action === 'reveal') {
        log.info('update', 'revealing installer', { path, action })
        return reveal()
      }

      // Every branch below is logged, because this is the call that produced a bug nobody could
      // reproduce: what the desktop did with the file is the one fact that was missing.
      log.info('update', 'opening installer', { path, action })
      const started = Date.now()
      const TIMED_OUT = Symbol('timed out')
      const outcome = await settle<string | typeof TIMED_OUT>(shell.openPath(path), TIMED_OUT)
      const timedOut = outcome === TIMED_OUT
      const error = timedOut ? '' : outcome
      log.info('update', 'openPath returned', {
        ms: Date.now() - started, error: error === '' ? null : error, timedOut,
      })

      // A timeout means the opener is still running, which is not the same thing as it having
      // launched — the caller cannot tell the difference from here, so it is reported the same
      // way a deliberate `reveal` is: shown, not claimed to have opened.
      if (!timedOut && error === '') return { ok: 'opened' }
      if (!timedOut) log.warn('update', 'could not open installer, revealing instead', { path, error })
      return reveal()
    },
  }
}
```

- [ ] **Step 8: Run the test and confirm it passes**
Run: `npm test -- electronUpdaterBackend installInstructions`

- [ ] **Step 9: Propagate the new result type through the service, IPC and shared types**

```ts
// src/main/update/updateService.ts — add near the top, exported for electronUpdaterBackend.ts and the tests
export type OpenInstallerResult =
  | { ok: 'opened' }
  | { ok: 'revealed' }
  | { ok: 'failed'; reason: string }
```

```ts
// UpdateStatus — add a field so the renderer can react to what actually happened
export interface UpdateStatus {
  // ...unchanged fields...
  install: InstallInstructions | null
  /** What the last attempt to open/reveal the installer actually did. Null until one has run. */
  openResult: OpenInstallerResult | null
  error: string | null
  lastCheckedAt: number | null
  skippedVersion: string | null
}
```

```ts
// UpdateBackend — change the signature
  openInstaller(path: string, action: InstallInstructions['action']): Promise<OpenInstallerResult>
```

```ts
// constructor's initial status — add
      install: null,
      openResult: null,
      error: null,
```

```ts
// download() — capture and store the result instead of discarding it
      } else {
        const path = await this.opts.backend.downloadInstaller(onProgress)
        const install = installInstructions(this.opts.capabilityInput, path)
        this.patch({ phase: 'downloaded', progressPercent: 100, downloadedPath: path, install })
        const openResult = await this.opts.backend.openInstaller(path, install.action)
        this.patch({ openResult })
      }
```

```ts
  /** `assisted` only: opens (or reveals) the installer again, for anyone who closed it. */
  async openDownloaded(): Promise<OpenInstallerResult> {
    const path = this.status.downloadedPath
    if (path === null) return { ok: 'failed', reason: 'Nothing has been downloaded yet.' }
    const openResult = await this.opts.backend.openInstaller(path, this.status.install?.action ?? 'open')
    this.patch({ openResult })
    return openResult
  }
```

```ts
// src/main/ipc.ts:356 — forward the result instead of discarding it
  handle(CHANNELS.updateOpenDownloaded, async () =>
    (await updater?.openDownloaded()) ?? { ok: 'failed', reason: 'Running from source — there is no updater.' })
```

```ts
// src/shared/api.ts — extend the status payload and the bridge method's return type
export interface UpdateStatusPayload {
  // ...unchanged...
  install: { hint: string; command: string | null; action: 'open' | 'reveal' } | null
  openResult: { ok: 'opened' } | { ok: 'revealed' } | { ok: 'failed'; reason: string } | null
  error: string | null
  lastCheckedAt: number | null
  skippedVersion: string | null
}
// ...
  /** Opens an already-downloaded installer again (the assisted flow); reports what happened. */
  updateOpenDownloaded(): Promise<{ ok: 'opened' } | { ok: 'revealed' } | { ok: 'failed'; reason: string }>
```

`src/preload/index.ts` needs no change: `updateOpenDownloaded: () => ipcRenderer.invoke(CHANNELS.updateOpenDownloaded)` already forwards whatever the main process resolves with — only the declared type in `shared/api.ts` changes what TypeScript believes it returns.

- [ ] **Step 10: Update the integration test's stub backend and add a coverage test**

```ts
// tests/integration/updateService.test.ts — StubBackend
  openResult: OpenInstallerResult = { ok: 'opened' }

  async openInstaller(path: string, action: 'open' | 'reveal'): Promise<OpenInstallerResult> {
    this.opened.push(path)
    this.openActions.push(action)
    return this.openResult
  }
```
(add `import type { OpenInstallerResult } from '../../src/main/update/updateService'` to the top of the file)

```ts
// new test inside describe('a downloaded .deb, which nothing on the desktop can open', ...)
it('remembers what happened when the installer was handed over, so the banner can say so', async () => {
  const mac = harness(macUnsigned)
  mac.backend.openResult = { ok: 'revealed' }
  await mac.service.check({ manual: false })
  const status = await mac.service.download()
  expect(status.openResult).toEqual({ ok: 'revealed' })
})
```

- [ ] **Step 11: Run the integration test**
Run: `npm test -- updateService`

- [ ] **Step 12: Show what happened after "Open installer" in the banner**

```tsx
// src/renderer/components/UpdateBanner.tsx:112-132 — replace the onClick handler
        {phase === 'downloaded' && (
          <button
            className="btn primary"
            data-testid="update-open-downloaded"
            onClick={() => {
              void window.apiary.updateOpenDownloaded()
                .then((result) => {
                  if (result.ok === 'opened') return
                  if (result.ok === 'revealed') {
                    notify({
                      kind: 'info',
                      message: 'Showed the installer in your file manager — open it from there to finish.',
                    })
                    return
                  }
                  notify({
                    kind: 'error',
                    message: status.downloadedPath === null
                      ? 'Could not hand the installer to your desktop.'
                      : `Could not hand the installer to your desktop. It is at ${status.downloadedPath}`,
                  })
                })
                // Caught rather than left to the global unhandled-rejection net, which would put
                // Electron's own words in front of the user — "reply was never sent" — and say
                // nothing about the file that is sitting on their disk, ready to install.
                .catch(() => {
                  notify({
                    kind: 'error',
                    message: status.downloadedPath === null
                      ? 'Could not hand the installer to your desktop.'
                      : `Could not hand the installer to your desktop. It is at ${status.downloadedPath}`,
                  })
                })
            }}
          >
            {status.install?.action === 'reveal' ? 'Show in folder' : 'Open installer'}
          </button>
        )}
```

No new CSS is needed: the notification uses the existing `useNotifications` toast, already styled.

- [ ] **Step 13: Write the failing e2e assertions for the copy button on every assisted platform**

```ts
// tests/e2e/update.spec.ts — extend the existing assisted-mac test
test('an unsigned build offers to download, and says why it cannot install by itself', async () => {
  await launch({ fakeUpdate: '9.9.9', updateMode: 'assisted' })
  await checkNow()
  const banner = h.page.getByTestId('update-banner')

  await expect(banner.getByTestId('update-download')).toHaveText('Download')
  await expect(banner).toContainText('drag')

  await banner.getByTestId('update-download').click()
  await expect(banner).toContainText('has been downloaded')
  await expect(banner.getByTestId('update-open-downloaded')).toBeVisible()
  await expect(banner.getByTestId('update-install')).toHaveCount(0)
  // A mac .dmg is an assisted platform too — the copy button must not be a .deb-only affordance.
  await expect(banner.getByTestId('update-copy-command')).toBeVisible()
})
```

- [ ] **Step 14: Run the e2e test and watch it fail**
Run: `npm run test:e2e -- update.spec.ts` — expected failure: `update-copy-command` has count 0, because today `installInstructions` returns `command: null` for a mac `.dmg`.

- [ ] **Step 15: Run the e2e suite again and confirm it passes**
Run: `npm run test:e2e -- update.spec.ts`

- [ ] **Final step: Commit**
```bash
git add src/main/update/capability.ts src/main/update/electronUpdaterBackend.ts \
  src/main/update/updateService.ts src/main/ipc.ts src/shared/api.ts \
  src/renderer/components/UpdateBanner.tsx tests/unit/electronUpdaterBackend.test.ts \
  tests/unit/installInstructions.test.ts tests/integration/updateService.test.ts tests/e2e/update.spec.ts
git commit -m "fix(update): make the Ubuntu installer actually open, and give every platform a command"
```

---

---

### Task 2: Persist every window's bounds, panes and tabs

**How the renderer learns it is being restored:** decided in Task 3, but the wire format both
tasks share is fixed here. Every persisted field the renderer produces — `layout.preset` as a
plain `string` (not the renderer-only `PresetId` type) and tabs shaped exactly like `TabTransfer`
minus `ptyId` — lives in `src/shared/types.ts` so neither side reaches across the boundary
`shared/api.ts`'s own contract exists to prevent (see CLAUDE.md: "A new IPC call means touching
`shared/api.ts`, `preload/index.ts` and `main/ipc.ts` together").

**Files:**
- Create: `src/main/sessionLayoutStore.ts`
- Modify: `src/shared/types.ts:174-175` (append new interfaces after `isTabTransfer`)
- Modify: `src/shared/api.ts:109-170` (new channel), `:190-210` (new bridge method + payload type)
- Modify: `src/preload/index.ts:18-25` (new bridge method)
- Modify: `src/main/ipc.ts:19-29` (accept the store), `:95-100` (register handler)
- Modify: `src/main/index.ts:34-35` (module state), `:110-206` (`createWindow`: bounds capture for
  every window), `:304-390` (`app.whenReady`: construct the store), `:400-417` (`before-quit`:
  flush)
- Modify: `src/renderer/App.tsx:133-160` (windowState already in scope), `:200-210` (`shellTabs`/
  `activeTerminal` already in scope), add a new effect near the other `useEffect`s reporting to
  main (around line 803, beside the `ptyRunning` sync effect)
- Test: `tests/unit/sessionLayoutStore.test.ts`

**Interfaces:**
- Consumes: `WindowBounds` from `src/main/settings.ts:4-9`; `win.getNormalBounds()` (already used
  at `src/main/index.ts:183`); `Layout`/`Column`/`OpenTab` shapes from
  `src/renderer/state/layout.ts` and `columns.ts` (read-only, to build the persisted shape from
  live state — no import of those renderer files from `shared/` or `main/`); the existing
  `shellTabs: Map<string, TerminalTab[]>` and `activeTerminal: Map<string, string>` state in
  `App.tsx`.
- Produces (in `src/shared/types.ts`):
  ```ts
  export interface PersistedTab {
    key: string
    view: 'transcript' | 'terminal'
    shells: { id: string; name: string }[]
    activeShell: string | null
  }
  export interface PersistedPane {
    id: string
    tabs: PersistedTab[]
    activeTab: string | null
  }
  export interface PersistedLayout {
    /** A `PresetId` string from `renderer/state/layout.ts`, kept as `string` here so this
     *  dependency-free shared file never imports renderer state. Task 3 validates it against
     *  the known preset ids and falls back to 'single'. */
    preset: string
    panes: PersistedPane[]
  }
  export interface WindowLayoutReport {
    number: number
    layout: PersistedLayout
    live: string[]
  }
  ```
  In `src/main/sessionLayoutStore.ts`:
  ```ts
  export interface WindowLayoutRecord extends WindowLayoutReport {
    bounds: WindowBounds
  }
  export interface SessionLayoutFile { windows: WindowLayoutRecord[] }
  export function loadSessionLayout(file: string): SessionLayoutFile
  export function saveSessionLayoutNow(file: string, data: SessionLayoutFile): void
  export interface SessionLayoutStore {
    reportLayout(report: WindowLayoutReport): void
    reportBounds(windowNumber: number, bounds: WindowBounds): void
    removeWindow(windowNumber: number): void
    flush(): void
    snapshot(): SessionLayoutFile
  }
  export function createSessionLayoutStore(file: string, writeDelayMs?: number): SessionLayoutStore
  ```
  In `src/shared/api.ts`: `CHANNELS.reportLayout = 'apiary:report-layout'`, and
  `reportLayout(report: WindowLayoutReport): Promise<void>` on the bridge interface.

- [ ] **Step 1: Write the failing test**
```ts
// tests/unit/sessionLayoutStore.test.ts
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mkdtempSync, rmSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createSessionLayoutStore, loadSessionLayout } from '../../src/main/sessionLayoutStore'

let dir: string
const file = () => join(dir, 'session-layout.json')

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'apiary-layout-'))
  vi.useFakeTimers()
})
afterEach(() => {
  vi.useRealTimers()
  rmSync(dir, { recursive: true, force: true })
})

const bounds = { x: 10, y: 20, width: 1200, height: 800 }
const layout = { preset: 'halves-h', panes: [
  { id: 'col-1', tabs: [{ key: 'sess-1', view: 'terminal' as const, shells: [{ id: 'shell:sess-1:1', name: 'zsh' }], activeShell: 'shell:sess-1:1' }], activeTab: 'sess-1' },
] }

describe('SessionLayoutStore', () => {
  it('round-trips a window report through a debounced write', () => {
    const store = createSessionLayoutStore(file(), 500)
    store.reportBounds(1, bounds)
    store.reportLayout({ number: 1, layout, live: ['sess-1'] })
    // Nothing written yet — the 500ms debounce has not elapsed.
    expect(() => readFileSync(file(), 'utf8')).toThrow()
    vi.advanceTimersByTime(499)
    expect(() => readFileSync(file(), 'utf8')).toThrow()
    vi.advanceTimersByTime(1)
    const onDisk = loadSessionLayout(file())
    expect(onDisk.windows).toEqual([{ number: 1, bounds, layout, live: ['sess-1'] }])
  })

  it('coalesces rapid reports into a single write after the debounce settles', () => {
    const store = createSessionLayoutStore(file(), 500)
    store.reportLayout({ number: 1, layout, live: [] })
    vi.advanceTimersByTime(300)
    store.reportLayout({ number: 1, layout: { ...layout, preset: 'single' }, live: ['sess-2'] })
    vi.advanceTimersByTime(499)
    expect(() => readFileSync(file(), 'utf8')).toThrow()
    vi.advanceTimersByTime(1)
    expect(loadSessionLayout(file()).windows[0].live).toEqual(['sess-2'])
  })

  it('flush() writes immediately, for before-quit', () => {
    const store = createSessionLayoutStore(file(), 500)
    store.reportLayout({ number: 1, layout, live: ['sess-1'] })
    store.flush()
    expect(loadSessionLayout(file()).windows[0].number).toBe(1)
  })

  it('removeWindow drops a closed window from the next write', () => {
    const store = createSessionLayoutStore(file(), 500)
    store.reportLayout({ number: 1, layout, live: [] })
    store.reportLayout({ number: 2, layout, live: [] })
    store.removeWindow(1)
    store.flush()
    expect(loadSessionLayout(file()).windows.map((w) => w.number)).toEqual([2])
  })

  it('falls back to an empty file when the JSON on disk is corrupt', () => {
    writeFileSync(file(), '{not json')
    expect(loadSessionLayout(file())).toEqual({ windows: [] })
  })

  it('falls back to an empty file when the JSON is well-formed but the wrong shape', () => {
    writeFileSync(file(), JSON.stringify({ windows: 'nope' }))
    expect(loadSessionLayout(file())).toEqual({ windows: [] })
  })
})
```
- [ ] **Step 2: Run the test and watch it fail**
Run: `npm test -- sessionLayoutStore` (expected: `Cannot find module '../../src/main/sessionLayoutStore'`)
- [ ] **Step 3: Implement the store**
```ts
// src/main/sessionLayoutStore.ts
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import type { WindowBounds } from './settings'
import type { WindowLayoutReport } from '@shared/types'

export interface WindowLayoutRecord extends WindowLayoutReport {
  bounds: WindowBounds
}

export interface SessionLayoutFile { windows: WindowLayoutRecord[] }

function isWindowBounds(v: unknown): v is WindowBounds {
  if (typeof v !== 'object' || v === null) return false
  const b = v as Record<string, unknown>
  return typeof b.x === 'number' && typeof b.y === 'number'
    && typeof b.width === 'number' && typeof b.height === 'number'
}

function isRecord(v: unknown): v is WindowLayoutRecord {
  if (typeof v !== 'object' || v === null) return false
  const r = v as Record<string, unknown>
  return typeof r.number === 'number' && isWindowBounds(r.bounds)
    && typeof r.layout === 'object' && r.layout !== null
    && Array.isArray(r.live) && r.live.every((s) => typeof s === 'string')
}

/**
 * Reads the on-disk record, falling back to an empty file on anything unreadable or malformed.
 * The caller (main/index.ts) treats an empty file exactly like "no record for this window" and
 * opens a single default window — restore must never fail the whole launch over one bad record.
 */
export function loadSessionLayout(file: string): SessionLayoutFile {
  try {
    const raw: unknown = JSON.parse(readFileSync(file, 'utf8'))
    if (typeof raw !== 'object' || raw === null || !Array.isArray((raw as { windows?: unknown }).windows)) {
      return { windows: [] }
    }
    const windows = (raw as { windows: unknown[] }).windows.filter(isRecord)
    return { windows }
  } catch {
    return { windows: [] }
  }
}

export function saveSessionLayoutNow(file: string, data: SessionLayoutFile): void {
  try {
    mkdirSync(dirname(file), { recursive: true })
    writeFileSync(file, JSON.stringify(data, null, 2))
  } catch {
    // A read-only home directory should not crash the app — same bargain as settings.ts.
  }
}

export interface SessionLayoutStore {
  reportLayout(report: WindowLayoutReport): void
  reportBounds(windowNumber: number, bounds: WindowBounds): void
  removeWindow(windowNumber: number): void
  flush(): void
  snapshot(): SessionLayoutFile
}

const EMPTY_BOUNDS: WindowBounds = { x: 0, y: 0, width: 1400, height: 900 }

/**
 * In-memory record of every open window, written to disk debounced. Two independent debounces are
 * deliberately one: the renderer already waits ~500ms after its own last change before calling
 * `reportLayout`, so a further main-side delay only needs to coalesce a burst of *different*
 * windows reporting close together (e.g. all four resizing at relaunch) into one disk write.
 */
export function createSessionLayoutStore(file: string, writeDelayMs = 500): SessionLayoutStore {
  const windows = new Map<number, WindowLayoutRecord>(
    loadSessionLayout(file).windows.map((w) => [w.number, w]),
  )
  let timer: ReturnType<typeof setTimeout> | null = null

  const scheduleWrite = (): void => {
    if (timer !== null) clearTimeout(timer)
    timer = setTimeout(() => {
      timer = null
      saveSessionLayoutNow(file, { windows: [...windows.values()] })
    }, writeDelayMs)
  }

  return {
    reportLayout(report) {
      const existing = windows.get(report.number)
      windows.set(report.number, { ...report, bounds: existing?.bounds ?? EMPTY_BOUNDS })
      scheduleWrite()
    },
    reportBounds(windowNumber, bounds) {
      const existing = windows.get(windowNumber)
      if (existing === undefined) return
      windows.set(windowNumber, { ...existing, bounds })
      scheduleWrite()
    },
    removeWindow(windowNumber) {
      windows.delete(windowNumber)
      scheduleWrite()
    },
    flush() {
      if (timer !== null) { clearTimeout(timer); timer = null }
      saveSessionLayoutNow(file, { windows: [...windows.values()] })
    },
    snapshot() {
      return { windows: [...windows.values()] }
    },
  }
}
```
- [ ] **Step 4: Run the test and watch it pass**
Run: `npm test -- sessionLayoutStore`
- [ ] **Step 5: Add the shared types**
Append to `src/shared/types.ts` (after `isTabTransfer`, line 174):
```ts
/** One tab of a persisted window layout — same shape as `TabTransfer` minus `ptyId`, since a
 *  record written to disk and read back on the next launch has no live pty to point at. */
export interface PersistedTab {
  key: string
  view: 'transcript' | 'terminal'
  shells: { id: string; name: string }[]
  activeShell: string | null
}

export interface PersistedPane {
  id: string
  tabs: PersistedTab[]
  activeTab: string | null
}

/**
 * `preset` is kept as a plain string, not the renderer's `PresetId`: this file is imported by
 * both `main/` (no DOM lib) and the renderer, and `renderer/state/layout.ts` is renderer-only
 * state, not a shared pure helper — pulling it in here would drag renderer code into the main
 * tsconfig project the way `shared/promptPath.ts`'s own comment warns against.
 */
export interface PersistedLayout {
  preset: string
  panes: PersistedPane[]
}

/** What a window reports to main on every layout change; main adds `bounds` itself. */
export interface WindowLayoutReport {
  number: number
  layout: PersistedLayout
  live: string[]
}
```
- [ ] **Step 6: Wire the IPC channel**
In `src/shared/api.ts`, add to `CHANNELS` (near `sessionNote: 'apiary:session-note',` at line 169):
```ts
  reportLayout: 'apiary:report-layout',
```
Add `WindowLayoutReport` to the import list at the top of the file, and add to the bridge
interface (near `resume(sessionId: string): Promise<void>` at line 197):
```ts
  reportLayout(report: WindowLayoutReport): Promise<void>
```
In `src/preload/index.ts`, add beside `resume`:
```ts
  reportLayout: (report) => ipcRenderer.invoke(CHANNELS.reportLayout, report),
```
In `src/main/ipc.ts`, add a `sessionLayoutStore: SessionLayoutStore` parameter to `registerIpc`
(after `updater` at line 26) and register the handler beside `resume` (line 97):
```ts
  handle(CHANNELS.reportLayout, (_e, report: WindowLayoutReport) => {
    sessionLayoutStore.reportLayout(report)
  })
```
- [ ] **Step 7: Capture bounds for every window, not just the first**
In `src/main/index.ts`, replace the `isFirst && !detached` guard around `persistBounds` (lines
177-187) with an unconditional one that also updates the new store, and construct the store in
`app.whenReady()`:
```ts
// module state, near `let settingsFile = ''` (line 35)
let sessionLayoutStore: SessionLayoutStore | null = null
```
```ts
// inside createWindow(), replacing the `if (isFirst && !detached) { ... }` block
if (!detached) {
  const persistBounds = (): void => {
    const current = loadSettings(settingsFile)
    const normal = win.getNormalBounds()
    if (isFirst) saveSettings(settingsFile, { ...current, windowBounds: normal })
    sessionLayoutStore?.reportBounds(windowNumber, normal)
  }
  win.on('resized', persistBounds)
  win.on('moved', persistBounds)
}
win.on('closed', () => {
  sessionLayoutStore?.removeWindow(windowNumber)
  if (mainWindow === win) mainWindow = BrowserWindow.getAllWindows()[0] ?? null
})
```
(This replaces the existing bare `win.on('closed', ...)` a few lines above rather than adding a
second listener.) In `app.whenReady()`, construct the store right after `settingsFile` is set
(line 310):
```ts
const sessionLayoutFile = join(app.getPath('userData'), 'session-layout.json')
sessionLayoutStore = createSessionLayoutStore(sessionLayoutFile)
```
and pass it into `registerIpc(...)` at line 354-357.
- [ ] **Step 8: Flush on before-quit**
In the `before-quit` handler (`src/main/index.ts:401-417`), add before `app.quit()`:
```ts
sessionLayoutStore?.flush()
```
- [ ] **Step 9: Renderer reports layout, debounced 500ms**
In `src/renderer/App.tsx`, add near the other cross-cutting effects (beside the `ptyRunning` sync
effect around line 785):
```ts
/** This window's own number, the same key `uiState.ts`'s `stateKey()` reads from the URL. */
const windowNumber = useMemo(() => {
  try {
    return Number(new URLSearchParams(window.location.search).get('w') ?? '1') || 1
  } catch {
    return 1
  }
}, [])

/**
 * Reports this window's layout to main, debounced ~500ms so a drag or a burst of tab churn does
 * not spam the IPC channel and the disk write behind it. `detached` windows are excluded: a
 * torn-off single-tab window is not part of the restorable arrangement (see Task 3).
 */
useEffect(() => {
  if (detached !== null) return
  const timer = setTimeout(() => {
    const persistedLayout: PersistedLayout = {
      preset: layout.preset,
      panes: layout.panes.map((pane) => ({
        id: pane.id,
        activeTab: pane.activeKey,
        tabs: pane.tabs.map((tab) => {
          const shellKey = ptyOverrides.get(tab.key) ?? tab.key
          return {
            key: tab.key,
            view: tab.view,
            shells: shellTabs.get(shellKey) ?? [],
            activeShell: activeTerminal.get(shellKey) ?? null,
          }
        }),
      })),
    }
    const live = [...resumed].filter((id) => openKeys.has(id))
    void window.apiary.reportLayout({ number: windowNumber, layout: persistedLayout, live })
      .catch(() => { /* the next change tries again; nothing to show for a dropped report */ })
  }, 500)
  return () => { clearTimeout(timer) }
}, [layout, shellTabs, activeTerminal, ptyOverrides, resumed, openKeys, detached, windowNumber])
```
Add `PersistedLayout` to the `@shared/types` import at the top of `App.tsx`.
- [ ] **Final step: Commit**
```bash
git add src/main/sessionLayoutStore.ts src/main/index.ts src/main/ipc.ts src/shared/types.ts \
  src/shared/api.ts src/preload/index.ts src/renderer/App.tsx tests/unit/sessionLayoutStore.test.ts
git commit -m "feat: persist every window's bounds, panes and tabs for relaunch"
```

---

---

### Task 3: Rebuild windows, tabs and live sessions on launch

**How the renderer learns it is being restored:** a URL parameter, `?restore=<json>`, carrying
that window's own `WindowLayoutRecord` (minus `bounds`, which main already consumed to place the
window). This matches the two precedents already in this codebase for exactly this problem —
`?w=` (window number) and `?detach=`/`?transfer=` (the torn-off tab's `TabTransfer`, also shipped
as inline JSON) — both chosen, per `main/index.ts`'s own comment, because the renderer "needs it
before anything else... at first render, before an IPC round trip could answer, or the window
flashes the full layout before rearranging itself." A restored window has exactly that problem:
painting `initialLayout()` and then replacing it with the real one a tick later is the same
flash. An IPC call or a synchronous preload read were the alternatives; neither is used anywhere
else in this codebase for first-render layout decisions, and introducing a second mechanism
alongside `?detach=`/`?transfer=` for the same category of problem would be the inconsistency,
not the fix.

**Files:**
- Create: `src/main/sessionLayoutRestore.ts` (pure staleness-pruning + preset validation, kept out
  of `sessionLayoutStore.ts` because it needs to ask the session store whether a session still
  resolves — a main-process/AppService concern, not the store's)
- Modify: `src/main/index.ts:96-206` (`createWindow`/`NewWindowOptions`: accept a restore record),
  `:304-390` (`app.whenReady`: read the store and open recorded windows instead of one blank
  window)
- Modify: `src/renderer/state/uiState.ts:90-112` (add `restoredWindow()` beside `detachedTransfer`)
- Modify: `src/renderer/App.tsx:113-134` (`arrival`/`windowState` initial values: seed from the
  restore record), `:770-767` (`resumeSession`/live-session resumption on mount)
- Test: `tests/unit/sessionLayoutRestore.test.ts`
- Test: `tests/e2e/restoreWindows.spec.ts`

**Interfaces:**
- Consumes: `WindowLayoutRecord`, `SessionLayoutStore.snapshot()` and `loadSessionLayout()` from
  Task 2's `src/main/sessionLayoutStore.ts`; `boundsAreOnScreen` from
  `src/main/windowBounds.ts:31`; `AppService`'s `this.store.getSession(sessionId)` (via a new
  thin method, since `requireSession` throws instead of returning null — see Step 3); `PRESETS`/
  `PresetId` from `src/renderer/state/layout.ts:13-34`; `window.apiary.resume(sessionId)` (already
  exists, `src/main/appService.ts:530-548`); `detachedKey()`/`detachedTransfer()` pattern in
  `src/renderer/state/uiState.ts:90-112`.
- Produces: `pruneStaleLive(record: WindowLayoutRecord, isResumable: (sessionId: string) => boolean): WindowLayoutRecord`
  in `src/main/sessionLayoutRestore.ts`; `AppService.sessionIsResumable(sessionId: string): boolean`
  in `src/main/appService.ts`; `restoredWindow(): WindowLayoutRecord | null` in
  `src/renderer/state/uiState.ts` (reads `?restore=`, mirroring `detachedTransfer()`).

- [ ] **Step 1: Write the failing test — pure pruning logic**
```ts
// tests/unit/sessionLayoutRestore.test.ts
import { describe, it, expect } from 'vitest'
import { pruneStaleLive } from '../../src/main/sessionLayoutRestore'
import type { WindowLayoutRecord } from '../../src/main/sessionLayoutStore'

const bounds = { x: 0, y: 0, width: 1400, height: 900 }
const record: WindowLayoutRecord = {
  number: 1,
  bounds,
  layout: {
    preset: 'halves-h',
    panes: [
      {
        id: 'col-1',
        activeTab: 'sess-live',
        tabs: [
          { key: 'sess-live', view: 'terminal', shells: [], activeShell: null },
          { key: 'sess-gone', view: 'terminal', shells: [], activeShell: null },
        ],
      },
    ],
  },
  live: ['sess-live', 'sess-gone'],
}

describe('pruneStaleLive', () => {
  it('drops a live entry whose session no longer resolves, keeping the tab', () => {
    const pruned = pruneStaleLive(record, (id) => id === 'sess-live')
    expect(pruned.live).toEqual(['sess-live'])
    // The tab itself survives — it just won't be auto-resumed; the user can still open it.
    expect(pruned.layout.panes[0].tabs.map((t) => t.key)).toEqual(['sess-live', 'sess-gone'])
  })

  it('drops every live entry when none resolve, without throwing', () => {
    const pruned = pruneStaleLive(record, () => false)
    expect(pruned.live).toEqual([])
  })

  it('is a no-op when every live entry still resolves', () => {
    const pruned = pruneStaleLive(record, () => true)
    expect(pruned).toEqual(record)
  })
})
```
- [ ] **Step 2: Run the test and watch it fail**
Run: `npm test -- sessionLayoutRestore` (expected: `Cannot find module '../../src/main/sessionLayoutRestore'`)
- [ ] **Step 3: Implement pruning and the resumability check**
```ts
// src/main/sessionLayoutRestore.ts
import type { WindowLayoutRecord } from './sessionLayoutStore'

/**
 * Drops `live` entries whose session no longer resolves — its transcript was deleted, or its cwd
 * no longer exists (see `AppService.sessionIsResumable`). The *tab* stays either way: restore
 * never fails as a whole because one entry went stale, and a session with a missing pty is still
 * worth showing as a closed tab someone can look at or remove, rather than vanishing silently.
 */
export function pruneStaleLive(
  record: WindowLayoutRecord,
  isResumable: (sessionId: string) => boolean,
): WindowLayoutRecord {
  const live = record.live.filter(isResumable)
  return live.length === record.live.length ? record : { ...record, live }
}
```
Add to `src/main/appService.ts`, beside `requireSession` (line 787):
```ts
/**
 * Whether `sessionId` can still be resumed: it must resolve in the store, its transcript file
 * must still exist (it can be deleted by removing the worktree it lived in — see `resume()`
 * above), and its cwd must still exist. Unlike `requireSession`, this never throws — restore
 * calls it once per recorded live session and a stale one is meant to be dropped, not to abort
 * the whole launch.
 */
sessionIsResumable(sessionId: string): boolean {
  const session = this.store.getSession(sessionId)
  if (session === undefined || session === null) return false
  if (!existsSync(session.filePath)) return false
  return session.cwd !== null && existsSync(session.cwd)
}
```
- [ ] **Step 4: Run the test and watch it pass**
Run: `npm test -- sessionLayoutRestore`
- [ ] **Step 5: Main recreates each recorded window at its validated bounds**
In `src/main/index.ts`, extend `NewWindowOptions` (line 96) and `createWindow` (line 103):
```ts
export interface NewWindowOptions {
  detach?: TabTransfer
  at?: { x: number; y: number }
  /** A window being recreated from the previous run's SessionLayoutStore record. */
  restore?: WindowLayoutRecord
}
```
Inside `createWindow`, before the existing `saved`/`restored` bounds logic (line 110), branch on
`opts.restore`:
```ts
const restoreBounds = opts.restore !== undefined
  && boundsAreOnScreen(opts.restore.bounds, screen.getAllDisplays().map((d) => d.workArea))
  ? opts.restore.bounds
  : null
```
and use `restoreBounds ?? restored` wherever `restored` is read for `bounds` (lines 119-132) —
`restoreBounds` takes precedence over the single-window `windowBounds` fallback, since a restored
window's own recorded bounds are more specific than the app's last-known single position.
Extend the `query` object (line 192) so the renderer gets its record synchronously:
```ts
if (opts.restore !== undefined) {
  query.restore = JSON.stringify({ ...opts.restore, bounds: undefined })
}
```
(`bounds` is stripped because the renderer never needs it — it is a main/OS concept, consistent
with the renderer never handling window geometry anywhere else in this file.)
`windowsOpened` must also be advanced to match the *highest* recorded window number before restore
begins, so a freshly opened window after restore does not collide with a recorded number — add
right before the restore loop in `app.whenReady()`:
```ts
windowsOpened = Math.max(0, ...records.map((r) => r.number))
```
Note this makes `windowNumber` in `createWindow` diverge from `opts.restore.number` if windows
were opened out of order; to keep them in step, `createWindow` must use `opts.restore?.number ??
windowNumber` as the number placed in `query.w` and passed to `sessionLayoutStore`. Change line
104-105:
```ts
windowsOpened += 1
const windowNumber = opts.restore?.number ?? windowsOpened
```
- [ ] **Step 6: Restore replaces the single default window at launch**
In `app.whenReady()` (`src/main/index.ts:304-390`), replace the unconditional `createWindow()`
call (line 366) with:
```ts
const stored = loadSessionLayout(sessionLayoutFile)
const records = stored.windows
  .map((r) => pruneStaleLive(r, (id) => service!.sessionIsResumable(id)))
  .filter((r) => r.layout.panes.some((p) => p.tabs.length > 0))
if (records.length === 0) {
  createWindow()
} else {
  windowsOpened = Math.max(0, ...records.map((r) => r.number))
  for (const record of records) createWindow({ restore: record })
}
```
This is also where the spec's "and when a window record contains no tabs" skip lives: a record
whose every pane is empty is filtered out here rather than opened as a blank restored window.
Import `loadSessionLayout` and `pruneStaleLive` at the top of the file.
- [ ] **Step 7: Renderer reads `?restore=` and rebuilds its layout before first paint**
In `src/renderer/state/uiState.ts`, add beside `detachedTransfer()` (after line 112):
```ts
/**
 * The previous run's record for this window, or null for an ordinary launch. Read from the URL
 * for the same reason `detachedTransfer` is: the layout it decides is needed at first render, and
 * main has already validated and stripped `bounds` out of it before putting it here (see
 * `createWindow` in main/index.ts).
 */
export function restoredWindow(): WindowLayoutRecord | null {
  try {
    const raw = new URLSearchParams(window.location.search).get('restore')
    if (raw === null) return null
    const parsed: unknown = JSON.parse(raw)
    return isWindowLayoutRecord(parsed) ? parsed : null
  } catch {
    return null
  }
}
```
Add a matching `isWindowLayoutRecord` type guard (same style as `isTabTransfer` in
`shared/types.ts`) — placed in `shared/types.ts` beside `WindowLayoutReport` since both the guard
and the type it checks belong together, exported and imported here.
In `src/renderer/App.tsx`, replace the two single-purpose reads at the top of `App()` (lines
113-118) with a shared restore record and derive `arrival` and the initial `windowState` from it
when present:
```ts
const [restored] = useState<WindowLayoutRecord | null>(restoredWindow)
const [detached] = useState<string | null>(detachedKey)
const [arrival] = useState<TabTransfer | null>(detachedTransfer)
```
and change the `windowState` initializer (line 133-135):
```ts
const [windowState, setWindowState] = useState<{ layout: Layout; activeColumnId: string | null }>(
  () => {
    if (restored === null) return { layout: initialLayout(), activeColumnId: null }
    const panes = restored.layout.panes.map((pane) => ({
      id: pane.id,
      tabs: pane.tabs.map((t) => ({ key: t.key, view: t.view })),
      activeKey: pane.activeTab,
    }))
    const knownPreset = PRESETS.some((p) => p.id === restored.layout.preset)
    const preset = (knownPreset ? restored.layout.preset : 'single') as PresetId
    return { layout: { preset, panes }, activeColumnId: panes[0]?.id ?? null }
  },
)
```
Seed `shellTabs`/`activeTerminal` from every restored tab, not just `arrival`'s single tab — change
the initializers at lines 200-210 to fold in `restored`'s tabs the same way they already fold in
`arrival`:
```ts
const [shellTabs, setShellTabs] = useState<Map<string, TerminalTab[]>>(() => {
  const map = new Map<string, TerminalTab[]>()
  for (const pane of restored?.layout.panes ?? []) {
    for (const tab of pane.tabs) if (tab.shells.length > 0) map.set(tab.key, tab.shells)
  }
  if (arrival !== null && arrival.shells.length > 0) map.set(arrival.ptyId ?? arrival.key, arrival.shells)
  return map
})
const [activeTerminal, setActiveTerminal] = useState<Map<string, string>>(() => {
  const map = new Map<string, string>()
  for (const pane of restored?.layout.panes ?? []) {
    for (const tab of pane.tabs) if (tab.activeShell !== null) map.set(tab.key, tab.activeShell)
  }
  if (arrival?.activeShell != null) map.set(arrival.ptyId ?? arrival.key, arrival.activeShell)
  return map
})
```
- [ ] **Step 8: Resume every session that was live at quit**
Add an effect in `App.tsx`, near the other mount-time effects (beside `loadUiSettings`'s
`useEffect`, around line 219):
```ts
/**
 * Sessions recorded as live at quit are resumed the same way a manual "Resume" click is —
 * `window.apiary.resume` already spawns `claude --resume` and is what `resumeSession` (line 761)
 * calls. Restore is not a special code path for spawning; it is a special *reason* to call the
 * ordinary one, once, for each id the main process already pruned down to sessions that still
 * resolve (see `pruneStaleLive`/`sessionIsResumable`).
 */
useEffect(() => {
  if (restored === null) return
  for (const sessionId of restored.live) {
    void window.apiary.resume(sessionId)
      .then(() => setResumed((prev) => new Set([...prev, sessionId])))
      .catch(() => { /* main already dropped anything unresumable; a spawn failure here is the
                       * same as a failed manual resume and needs no extra handling */ })
  }
  // Runs once: `restored` never changes after mount, and re-running on a later render would
  // re-spawn over ptys the first pass already started.
  // eslint-disable-next-line react-hooks/exhaustive-deps
}, [])
```
- [ ] **Step 9: Skip restore entirely for a detached window**
Confirm (no code change needed beyond what Step 6 already does): `main/index.ts` never sets
`opts.restore` on a `createWindow({ detach: ... })` call — detached windows are only ever opened by
`onNewSessionInFolder`'s sibling code path (the drag/tear-off `openDetachedWindow` callback) and by
`registerIpc`, neither of which reads `sessionLayoutStore`. Add a one-line guard for defence in
depth at the top of the restore loop in Step 6:
```ts
for (const record of records) {
  createWindow({ restore: record }) // never combined with { detach } — see Step 9's comment
}
```
And in `App.tsx`, make `restored` and `detached` mutually exclusive at the read site (Step 7):
```ts
const [restored] = useState<WindowLayoutRecord | null>(() => (detachedKey() !== null ? null : restoredWindow()))
```
- [ ] **Step 10: Write the e2e test**
```ts
// tests/e2e/restoreWindows.spec.ts
import { test, expect } from '@playwright/test'
import { launchApiary, importAll, sidebarSession, relaunchApiary, type Harness } from './helpers'

let h: Harness
test.beforeEach(async () => {
  h = await launchApiary()
  await importAll(h.page)
  await h.page.getByTestId('sidebar-refresh').click()
})
test.afterEach(async () => { await h.close() })

test('a split with two tabs returns after relaunch, same preset and active tab', async () => {
  await sidebarSession(h.page, 'Fix CSV export bug').click()
  await h.page.getByTestId('session-tab').first().click({ button: 'right' })
  await h.page.getByTestId('tab-menu').getByText('Split Right').click()
  await sidebarSession(h.page, 'Add dark mode toggle').click()
  await expect(h.page.getByTestId('session-tab')).toHaveCount(2)

  await relaunchApiary(h)

  await expect(h.page.getByTestId('session-tab')).toHaveCount(2)
  await expect(h.page.getByTestId('session-title')).toHaveText('Add dark mode toggle')
  // Both panes present: the split survived, not just the tab list.
  await expect(h.page.getByTestId('pane')).toHaveCount(2)
})
```
- [ ] **Step 11: Run the e2e test**
Run: `npm run test:e2e -- restoreWindows`
- [ ] **Final step: Commit**
```bash
git add src/main/sessionLayoutRestore.ts src/main/index.ts src/main/appService.ts \
  src/renderer/state/uiState.ts src/renderer/App.tsx src/shared/types.ts \
  tests/unit/sessionLayoutRestore.test.ts tests/e2e/restoreWindows.spec.ts
git commit -m "feat: restore windows, tabs and live sessions on relaunch"
```

---

### Task 4: GitLab MR references show their status

**Files:**
- Create: `src/shared/mrRefs.ts`
- Create: `src/main/git/mrStatusCache.ts`
- Create: `src/renderer/components/mrRefText.tsx`
- Create: `tests/unit/mrRefs.test.ts`
- Create: `tests/unit/mrStatusCache.test.ts`
- Create: `tests/e2e/mrStatus.spec.ts`
- Create: `scripts/fixtures/fake-glab-api.sh`
- Modify: `src/main/plugins/gitlabMr.ts:150-165` (export `originUrl` instead of leaving it private, so the new cache reuses the one place that already resolves `origin` via `exec`)
- Modify: `src/main/appService.ts:29-56` (add `glabPath` is already there; add a `gitlabMrRefStatus(key, isPtyId, iids)` method near the other `resolveShellCwd`-based git methods, around line 606)
- Modify: `src/main/ipc.ts:217-222` (register `CHANNELS.gitlabMrRefStatus` beside `gitStatus`/`gitListRefs`)
- Modify: `src/shared/api.ts:109-176` (add the channel and the `gitlabMrRefStatus` method to `ApiaryApi`)
- Modify: `src/preload/index.ts` (bridge the new channel, same shape as `gitStatus`)
- Modify: `src/main/index.ts:337-338` (pass `APIARY_GLAB_PATH` through to the new cache the same way it already reaches `createGitLabMrPlugin`)
- Modify: `src/renderer/components/SessionRow.tsx:119` (wrap `session.title` in `<MrRefText>`)
- Modify: `src/renderer/components/HoverCard.tsx:108` (wrap the note in `<MrRefText>`)
- Modify: `src/renderer/styles.css` (add `--mr-opened`, `--mr-merged`, `--mr-closed`, `--mr-locked` tokens and a `.mr-ref` rule)
- Modify: `tests/e2e/helpers.ts` (add `glabApiPath`/`APIARY_GLAB_API_PATH`-style plumbing if the fixture needs a second binary — see Step 8)

**Interfaces:**
- Consumes: `parseGitLabRemote(remote: string): GitLabRemote | null` and `GitLabRemote { host, project, webUrl }` from `src/main/plugins/gitlabRemote.ts`; `resolveShellCwd(key: string, isPtyId: boolean): string` (private on `AppService`, called from the new method exactly as `gitStatus` does); the exported `originUrl(cwd: string, exec): Promise<string | null>` from `gitlabMr.ts`.
- Produces:
  - `parseMrRefs(text: string): { iid: number; index: number }[]` in `src/shared/mrRefs.ts`.
  - `export type MrState = 'opened' | 'merged' | 'closed' | 'locked'` in `src/main/git/mrStatusCache.ts`.
  - `resolveMrStatus(cwd: string, host: string, project: string, iid: number, options?: { glabPath?: string; exec?: (file: string, args: string[], cwd: string) => Promise<string>; now?: () => number; timeoutMs?: number }): Promise<MrState | null>`.
  - `resetMrStatusCache(): void` (test-only, clears the module-level cache/in-flight map/negative flag).
  - `AppService.gitlabMrRefStatus(key: string, isPtyId: boolean, iids: number[]): Promise<Record<number, MrState | null>>`.
  - `MrRefText({ text: string; statuses: Record<number, MrState | null> }): JSX.Element` in the renderer.

- [ ] **Step 1: Write the failing test for `parseMrRefs`**
```typescript
// tests/unit/mrRefs.test.ts
import { describe, it, expect } from 'vitest'
import { parseMrRefs } from '../../src/shared/mrRefs'

describe('parseMrRefs', () => {
  it('finds a bare reference', () => {
    expect(parseMrRefs('fixes !1267 today')).toEqual([{ iid: 1267, index: 6 }])
  })

  it('finds more than one', () => {
    expect(parseMrRefs('!12 and !345')).toEqual([
      { iid: 12, index: 0 },
      { iid: 345, index: 8 },
    ])
  })

  it('ignores a reference glued to a word', () => {
    expect(parseMrRefs('see foo!12 for context')).toEqual([])
  })

  it('ignores a reference followed by more word characters', () => {
    expect(parseMrRefs('build !12a failed')).toEqual([])
  })

  it('ignores one that falls inside a URL', () => {
    const text = 'https://gitlab.com/group/project/-/merge_requests/1267?x=!123'
    expect(parseMrRefs(text)).toEqual([])
  })

  it('still finds a real reference next to a URL', () => {
    const text = 'see https://gitlab.com/group/project !1267'
    expect(parseMrRefs(text)).toEqual([{ iid: 1267, index: 38 }])
  })

  it('returns nothing for text with no reference', () => {
    expect(parseMrRefs('just a normal title')).toEqual([])
  })
})
```
- [ ] **Step 2: Run the test and watch it fail**
Run: `npm test -- mrRefs` (fails with "Cannot find module '../../src/shared/mrRefs'")
- [ ] **Step 3: Implement `parseMrRefs`**
```typescript
// src/shared/mrRefs.ts
/**
 * A `!<digits>` reference found in a session's title or note, e.g. `!1267` in "fixes !1267".
 *
 * Deliberately blind to a URL's own path: a merge-request URL never contains `!<digits>`, so the
 * only real collision is a query string someone pasted (`?x=!123`), which is excluded by scanning
 * past every URL match before looking for references at all.
 */
export interface MrRef {
  iid: number
  /** Character offset of the `!` in `text`, for splitting the string around it when rendering. */
  index: number
}

const URL_PATTERN = /https?:\/\/\S+/g
const REF_PATTERN = /!(\d+)/g

function isWordChar(ch: string | undefined): boolean {
  return ch !== undefined && /\w/.test(ch)
}

/** Finds every `!<digits>` reference in `text`, skipping ones glued to a word and ones inside a URL. */
export function parseMrRefs(text: string): MrRef[] {
  const urlRanges: Array<[number, number]> = []
  for (const m of text.matchAll(URL_PATTERN)) {
    urlRanges.push([m.index, m.index + m[0].length])
  }
  const withinUrl = (i: number): boolean => urlRanges.some(([start, end]) => i >= start && i < end)

  const refs: MrRef[] = []
  for (const m of text.matchAll(REF_PATTERN)) {
    const index = m.index
    if (withinUrl(index)) continue
    if (isWordChar(text[index - 1])) continue
    if (isWordChar(text[index + m[0].length])) continue
    refs.push({ iid: Number(m[1]), index })
  }
  return refs
}
```
- [ ] **Step 4: Write the failing test for the status cache**
```typescript
// tests/unit/mrStatusCache.test.ts
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { resolveMrStatus, resetMrStatusCache } from '../../src/main/git/mrStatusCache'

beforeEach(() => { resetMrStatusCache() })

function fakeExec(response: () => Promise<string> | string) {
  const calls: Array<{ file: string; args: string[]; cwd: string }> = []
  const exec = async (file: string, args: string[], cwd: string): Promise<string> => {
    calls.push({ file, args, cwd })
    return response()
  }
  return { exec, calls }
}

describe('resolveMrStatus', () => {
  it('spawns glab api against the urlencoded project path and iid', async () => {
    const { exec, calls } = fakeExec(() => JSON.stringify({ state: 'merged' }))
    const state = await resolveMrStatus('/repo', 'https://gitlab.com', 'group/sub/project', 1267, { exec })
    expect(state).toBe('merged')
    expect(calls).toEqual([{
      file: 'glab',
      args: ['api', 'projects/group%2Fsub%2Fproject/merge_requests/1267'],
      cwd: '/repo',
    }])
  })

  it('caches per host+project+iid until the TTL expires', async () => {
    let now = 0
    const { exec, calls } = fakeExec(() => JSON.stringify({ state: 'opened' }))
    const options = { exec, now: () => now }
    await resolveMrStatus('/repo', 'https://gitlab.com', 'group/project', 1, options)
    await resolveMrStatus('/repo', 'https://gitlab.com', 'group/project', 1, options)
    expect(calls).toHaveLength(1)
    now = 10 * 60 * 1000 + 1
    await resolveMrStatus('/repo', 'https://gitlab.com', 'group/project', 1, options)
    expect(calls).toHaveLength(2)
  })

  it('shares one call across concurrent lookups for the same key', async () => {
    let resolveExec: (v: string) => void = () => {}
    const exec = async (): Promise<string> =>
      new Promise((resolve) => { resolveExec = resolve })
    let calls = 0
    const countingExec = async (file: string, args: string[], cwd: string): Promise<string> => {
      calls++
      return exec()
    }
    const a = resolveMrStatus('/repo', 'https://gitlab.com', 'group/project', 9, { exec: countingExec })
    const b = resolveMrStatus('/repo', 'https://gitlab.com', 'group/project', 9, { exec: countingExec })
    resolveExec(JSON.stringify({ state: 'closed' }))
    expect(await a).toBe('closed')
    expect(await b).toBe('closed')
    expect(calls).toBe(1)
  })

  it('degrades to null on a non-zero exit or malformed JSON', async () => {
    const exec = async (): Promise<string> => { throw new Error('HTTP 404') }
    expect(await resolveMrStatus('/repo', 'https://gitlab.com', 'group/project', 2, { exec })).toBeNull()
  })

  it('caches "glab missing" negatively so a missing binary is not probed again', async () => {
    let calls = 0
    const exec = async (): Promise<string> => {
      calls++
      const err = new Error('spawn glab ENOENT') as NodeJS.ErrnoException
      err.code = 'ENOENT'
      throw err
    }
    await resolveMrStatus('/repo', 'https://gitlab.com', 'group/project', 3, { exec })
    await resolveMrStatus('/repo', 'https://gitlab.com', 'group/other', 4, { exec })
    expect(calls).toBe(1)
  })
})
```
- [ ] **Step 5: Run the test and watch it fail**
Run: `npm test -- mrStatusCache` (fails with "Cannot find module '../../src/main/git/mrStatusCache'")
- [ ] **Step 6: Implement the cache**
```typescript
// src/main/git/mrStatusCache.ts
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

const run = promisify(execFile)

export type MrState = 'opened' | 'merged' | 'closed' | 'locked'

interface CacheEntry {
  at: number
  state: MrState | null
}

const TTL_MS = 10 * 60 * 1000
const DEFAULT_TIMEOUT_MS = 8000

const cache = new Map<string, CacheEntry>()
const inFlight = new Map<string, Promise<MrState | null>>()
/** Set once `glab` itself is missing, so a bad install is not re-probed on every reference. */
let glabMissing = false

/** Test-only: clears every module-level cache so specs do not leak into each other. */
export function resetMrStatusCache(): void {
  cache.clear()
  inFlight.clear()
  glabMissing = false
}

async function defaultExec(file: string, args: string[], cwd: string): Promise<string> {
  const { stdout } = await run(file, args, { cwd, timeout: DEFAULT_TIMEOUT_MS, maxBuffer: 1024 * 1024 })
  return stdout
}

export interface ResolveMrStatusOptions {
  glabPath?: string
  /** Injected in tests; returns stdout or throws the way execFile does. */
  exec?: (file: string, args: string[], cwd: string) => Promise<string>
  now?: () => number
}

const KNOWN_STATES: MrState[] = ['opened', 'merged', 'closed', 'locked']

function parseState(stdout: string): MrState | null {
  try {
    const payload = JSON.parse(stdout) as { state?: unknown }
    return typeof payload.state === 'string' && (KNOWN_STATES as string[]).includes(payload.state)
      ? (payload.state as MrState)
      : null
  } catch {
    return null
  }
}

/**
 * Looks up one merge request's state through `glab api`, the same "never hold a token" approach
 * as the session-bar plugin: Apiary asks `glab`, which already has the user's GitLab credentials,
 * and never sees one itself.
 *
 * Cached per host+project+iid for `TTL_MS`, with an in-flight map so a burst of references
 * resolving at once (a title and a note both naming `!1267`) makes one call, not two. Any failure
 * — no `glab`, not logged in, a 404, a timeout, malformed JSON — degrades to `null` silently; a
 * missing binary is additionally remembered so it is not re-tried for every other reference until
 * the process restarts.
 */
export async function resolveMrStatus(
  cwd: string,
  host: string,
  project: string,
  iid: number,
  options: ResolveMrStatusOptions = {},
): Promise<MrState | null> {
  if (glabMissing) return null

  const now = options.now ?? Date.now
  const key = `${host}|${project}|${iid}`

  const hit = cache.get(key)
  if (hit !== undefined && now() - hit.at < TTL_MS) return hit.state

  const running = inFlight.get(key)
  if (running !== undefined) return running

  const promise = lookup(cwd, host, project, iid, options)
  inFlight.set(key, promise)
  try {
    const state = await promise
    cache.set(key, { at: now(), state })
    return state
  } finally {
    inFlight.delete(key)
  }
}

async function lookup(
  cwd: string,
  host: string,
  project: string,
  iid: number,
  options: ResolveMrStatusOptions,
): Promise<MrState | null> {
  void host // part of the cache key, not of the command — the project path alone identifies it to glab
  const glab = options.glabPath ?? 'glab'
  const exec = options.exec ?? defaultExec
  try {
    const stdout = await exec(
      glab,
      ['api', `projects/${encodeURIComponent(project)}/merge_requests/${String(iid)}`],
      cwd,
    )
    return parseState(stdout)
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') glabMissing = true
    return null
  }
}
```
- [ ] **Step 7: Export the git-remote lookup the plugin already has, for the cache to reuse**
```typescript
// src/main/plugins/gitlabMr.ts — change the declaration at line ~150
export async function originUrl(
  cwd: string,
  exec: (file: string, args: string[], cwd: string) => Promise<string>,
): Promise<string | null> {
  try {
    const stdout = await exec('git', ['remote', 'get-url', 'origin'], cwd)
    const url = stdout.trim()
    return url === '' ? null : url
  } catch {
    return null
  }
}
```
- [ ] **Step 8: Wire the IPC round trip — shared channel, main handler, preload bridge**
```typescript
// src/shared/api.ts — add to CHANNELS
gitlabMrRefStatus: 'apiary:gitlab-mr-ref-status',
```
```typescript
// src/shared/api.ts — add to ApiaryApi
/** Resolves each of the given `!<iid>` references against the session's GitLab remote (if it
 *  has one); a ref with no answer yet — no remote, no glab, a lookup failure — maps to null. */
gitlabMrRefStatus(
  key: string, isPtyId: boolean, iids: number[],
): Promise<Record<number, 'opened' | 'merged' | 'closed' | 'locked' | null>>
```
```typescript
// src/main/appService.ts — new method near gitStatus() at line 606, reusing resolveShellCwd exactly
// as gitStatus/gitListRefs do, and originUrl/parseGitLabRemote exactly as the plugin does.
async gitlabMrRefStatus(
  key: string, isPtyId: boolean, iids: number[],
): Promise<Record<number, MrState | null>> {
  const cwd = this.resolveShellCwd(key, isPtyId)
  const out: Record<number, MrState | null> = {}
  const remoteUrl = await originUrl(cwd, defaultGitExec)
  const remote = remoteUrl === null ? null : parseGitLabRemote(remoteUrl)
  if (remote === null) {
    for (const iid of iids) out[iid] = null
    return out
  }
  await Promise.all(iids.map(async (iid) => {
    out[iid] = await resolveMrStatus(cwd, remote.host, remote.project, iid, { glabPath: this.glabPath })
  }))
  return out
}
```
(`defaultGitExec` is the same `execFile`-backed function `gitlabMr.ts` already builds as `defaultExec` for `git`/`glab` calls — export and reuse it rather than writing a third copy; `this.glabPath` is the option `AppServiceOptions` already carries for `createGitLabMrPlugin`.)
```typescript
// src/main/ipc.ts — beside gitListRefs at line ~220
handle(CHANNELS.gitlabMrRefStatus, (_e, key: string, isPtyId: boolean, iids: number[]) =>
  service.gitlabMrRefStatus(key, isPtyId, iids))
```
```typescript
// src/preload/index.ts — same shape as gitStatus's bridge entry
gitlabMrRefStatus: (key: string, isPtyId: boolean, iids: number[]) =>
  ipcRenderer.invoke(CHANNELS.gitlabMrRefStatus, key, isPtyId, iids),
```
- [ ] **Step 9: Add the colour tokens and the reference style**
```css
/* src/renderer/styles.css — beside --danger/--success/--warning/--info in :root */
--mr-opened: var(--info);
--mr-merged: #b385f5;
--mr-closed: var(--danger);
--mr-locked: var(--muted);
```
```css
.mr-ref { font-weight: 600; }
.mr-ref[data-state="opened"] { color: var(--mr-opened); }
.mr-ref[data-state="merged"] { color: var(--mr-merged); }
.mr-ref[data-state="closed"] { color: var(--mr-closed); }
.mr-ref[data-state="locked"] { color: var(--mr-locked); }
```
- [ ] **Step 10: Render the status inline**
```tsx
// src/renderer/components/mrRefText.tsx
import { Fragment } from 'react'
import { parseMrRefs } from '@shared/mrRefs'

export type MrState = 'opened' | 'merged' | 'closed' | 'locked'

/**
 * Renders `text` with every `!<iid>` reference it contains turned into `!1267 (merged)` in a
 * status colour, leaving text with no known status exactly as written — layout must not shift
 * just because a lookup has not landed yet.
 */
export function MrRefText(
  { text, statuses }: { text: string; statuses: Record<number, MrState | null> },
): JSX.Element {
  const refs = parseMrRefs(text)
  if (refs.length === 0) return <>{text}</>

  const parts: JSX.Element[] = []
  let cursor = 0
  refs.forEach((ref, i) => {
    parts.push(<Fragment key={`t${String(i)}`}>{text.slice(cursor, ref.index)}</Fragment>)
    const raw = `!${String(ref.iid)}`
    const state = statuses[ref.iid] ?? null
    parts.push(
      state === null
        ? <Fragment key={`r${String(i)}`}>{raw}</Fragment>
        : (
          <span key={`r${String(i)}`} className="mr-ref" data-state={state}>
            {raw} ({state})
          </span>
        ),
    )
    cursor = ref.index + raw.length
  })
  parts.push(<Fragment key="tail">{text.slice(cursor)}</Fragment>)
  return <>{parts}</>
}
```
- [ ] **Step 11: Wire it into the session row and hover card**
```tsx
// src/renderer/components/SessionRow.tsx — replace the plain title span at line 119
<span className="session-title">
  <MrRefText text={session.title} statuses={mrStatuses} />
</span>
```
Add, alongside `hasNote`:
```tsx
const refs = useMemo(() => parseMrRefs(session.title), [session.title])
const [mrStatuses, setMrStatuses] = useState<Record<number, MrState | null>>({})
useEffect(() => {
  if (refs.length === 0) { setMrStatuses({}); return }
  let cancelled = false
  void window.apiary.gitlabMrRefStatus(session.sessionId, false, refs.map((r) => r.iid))
    .then((result) => { if (!cancelled) setMrStatuses(result) })
    .catch(() => { /* an unresolved reference just stays plain text */ })
  return () => { cancelled = true }
}, [session.sessionId, refs])
```
```tsx
// src/renderer/components/HoverCard.tsx — replace the note div's children at line 108
<div className="hover-card-note" data-testid="hover-card-note">
  <MrRefText text={note} statuses={noteMrStatuses} />
</div>
```
(`noteMrStatuses` is passed down as a new `HoverCard` prop, computed in `SessionRow` the same way as `mrStatuses` but against `session.note ?? ''`, so the hover card itself stays a pure display component with no IPC calls of its own.)
- [ ] **Step 12: Run the unit suite**
Run: `npm test -- mrRefs mrStatusCache` (both files pass)
- [ ] **Step 13: Write the e2e fixture and spec**
```bash
# scripts/fixtures/fake-glab-api.sh
#!/bin/bash
# Stand-in for `glab api projects/<enc>/merge_requests/<iid>`, used only by the E2E suite.
if [[ "${APIARY_FAKE_GLAB_FAIL:-}" == "1" ]]; then
  echo "glab: not logged in" >&2
  exit 1
fi
echo '{"state":"merged"}'
```
```typescript
// tests/e2e/mrStatus.spec.ts
import { test, expect } from '@playwright/test'
import { join } from 'node:path'
import { launchApiary, importAll, sidebarSession, type Harness } from './helpers'

const FAKE_GLAB = join(process.cwd(), 'scripts/fixtures/fake-glab-api.sh')

let h: Harness
test.afterEach(async () => { await h.close() })

test('a session titled with an MR reference shows its resolved status', async () => {
  h = await launchApiary({ gitlabRemote: true, glabPath: FAKE_GLAB, sessionTitle: 'Ship !1267' })
  await importAll(h.page)
  const row = sidebarSession(h.page, 'Ship !1267')
  await expect(row).toContainText('!1267 (merged)')
})
```
(`sessionTitle` is a new `launchApiary` fixture option — plumb it the same way `gitlabRemote`/`glabPath` already reach `helpers.ts`, setting the fixture session's title before the app scans it.)
- [ ] **Step 14: Run the e2e spec**
Run: `npm run test:e2e -- mrStatus` (passes)
- [ ] **Final step: Commit**
```bash
git add src/shared/mrRefs.ts src/main/git/mrStatusCache.ts src/renderer/components/mrRefText.tsx \
  src/main/plugins/gitlabMr.ts src/main/appService.ts src/main/ipc.ts src/shared/api.ts \
  src/preload/index.ts src/main/index.ts src/renderer/components/SessionRow.tsx \
  src/renderer/components/HoverCard.tsx src/renderer/styles.css \
  tests/unit/mrRefs.test.ts tests/unit/mrStatusCache.test.ts tests/e2e/mrStatus.spec.ts \
  scripts/fixtures/fake-glab-api.sh tests/e2e/helpers.ts
git commit -m "feat: show GitLab MR status beside !<iid> references"
```

---

---

### Task 5: A Recent section below Pinned

**Files:**
- Create: `src/renderer/state/recentSessions.ts`
- Create: `tests/unit/recentSessions.test.ts`
- Modify: `src/renderer/state/uiState.ts:6-46` (add `dismissedRecent` to `UiState`, add it to `SHARED_FIELDS`, add default)
- Modify: `src/main/settings.ts:21-116` (add `recentSectionEnabled: boolean`, `recentSectionHours: number` to `AppSettings` and `DEFAULT_SETTINGS`)
- Modify: `src/shared/api.ts:20-54` (add the same two fields to `AppSettingsPayload`)
- Modify: `src/renderer/components/SettingsDialog.tsx` (new on/off + hours row, same shape as the existing `updateCheckIntervalHours` row at lines 497-532)
- Modify: `src/renderer/components/Sidebar.tsx:430-486` (render a "Recent" section between Pinned and the pending list, reusing `SessionRow`)
- Modify: `src/renderer/App.tsx` (wire `recentSectionEnabled`/`recentSectionHours` from settings into `Sidebar`, wire dismissal into shared ui state)
- Test: `tests/unit/recentSessions.test.ts`
- Test: `tests/e2e/sidebar.spec.ts` (extend with Recent-section cases)

**Interfaces:**
- Consumes: `SessionNode` (`src/shared/types.ts:48-65`, has `sessionId`, `lastActiveAtMs`), the existing `SharedUiState`/`loadUiState`/`saveUiState`/`subscribeSharedUiState` machinery in `src/renderer/state/uiState.ts`, `AppSettingsPayload` from `src/shared/api.ts`.
- Produces (in `src/renderer/state/recentSessions.ts`):
  - `export interface DismissedMap { [sessionId: string]: number }` — the shared `dismissedRecent` shape, sessionId → dismissedAtMs.
  - `export function selectRecent(sessions: SessionNode[], pinnedIds: Set<string>, activeIds: Set<string>, dismissed: DismissedMap, now: number, windowHours: number): SessionNode[]` — pure. Filters to `lastActiveAtMs !== null && now - lastActiveAtMs <= windowHours * 3600_000`, excludes ids in `pinnedIds` or `activeIds`, excludes a session where `dismissed[id] !== undefined && session.lastActiveAtMs! <= dismissed[id]`, sorts by `lastActiveAtMs` descending.
  - `export function pruneDismissed(dismissed: DismissedMap, now: number, windowHours: number): DismissedMap` — drops entries whose timestamp is older than `now - windowHours * 3600_000`, returns a new object (or the same reference when nothing changed, so callers can skip a write).
  - `export function dismissRecent(dismissed: DismissedMap, sessionId: string, at: number): DismissedMap` — returns `{ ...dismissed, [sessionId]: at }`.

**Ordering note.** `selectRecent` takes `activeIds` so Recent never repeats what the Active
section already shows, but Active arrives in Task 7. Until then, pass an empty `Set` at the
call site and leave the parameter in place — Task 7's step that introduces `useActiveTabs`
is where the real set gets passed. Do not drop the parameter and re-add it later.

Settings placement, stated once so it is not re-decided per file: the on/off switch and the 1–168 hour window are **main-process settings** (`src/main/settings.ts` → `AppSettings.recentSectionEnabled` / `recentSectionHours`, mirrored in `AppSettingsPayload`), exactly like `updateAutomaticChecks`/`updateCheckIntervalHours` — they are app-wide behaviour, not per-library arrangement, and they must survive the "changing a default reaches nobody" rule via `SETTINGS_VERSION`/`migrateSettings` if ever changed later. The dismissal map (`sessionId → dismissedAtMs`) is **renderer shared state** in `uiState.ts`'s `SharedUiState` (new field `dismissedRecent: DismissedMap`, added to `SHARED_FIELDS`), because it is library-shaped state like `pinned` — it belongs to the sessions themselves, not to one window, and must sync across windows via the existing `storage`-event channel.

- [ ] **Step 1: Write the failing test**
```ts
// tests/unit/recentSessions.test.ts
import { describe, it, expect } from 'vitest'
import { selectRecent, pruneDismissed, dismissRecent } from '../../src/renderer/state/recentSessions'
import type { SessionNode } from '../../src/shared/types'

const HOUR = 3600_000

function session(id: string, lastActiveAtMs: number | null): SessionNode {
  return {
    kind: 'session', sessionId: id, title: id, cwd: '/x', gitBranch: null,
    lastActiveAtMs, messageCount: 1, isLive: false, cwdExists: true, note: null,
  }
}

describe('selectRecent', () => {
  const now = 1_000_000 * HOUR

  it('keeps only sessions active within the window, newest first', () => {
    const sessions = [
      session('old', now - 30 * HOUR),
      session('newer', now - 2 * HOUR),
      session('newest', now - 1 * HOUR),
    ]
    const result = selectRecent(sessions, new Set(), new Set(), {}, now, 24)
    expect(result.map((s) => s.sessionId)).toEqual(['newest', 'newer'])
  })

  it('excludes pinned and active sessions even when they are within the window', () => {
    const sessions = [session('pinned-one', now - 1 * HOUR), session('active-one', now - 1 * HOUR), session('plain', now - 1 * HOUR)]
    const result = selectRecent(sessions, new Set(['pinned-one']), new Set(['active-one']), {}, now, 24)
    expect(result.map((s) => s.sessionId)).toEqual(['plain'])
  })

  it('hides a dismissed session, and brings it back once it is active again', () => {
    const dismissedAt = now - 5 * HOUR
    const sessions = [session('a', now - 3 * HOUR)]
    const dismissed = dismissRecent({}, 'a', dismissedAt)
    // Still active after the dismissal timestamp was set but before real re-use: lastActiveAtMs
    // predates the dismissal, so it stays hidden.
    expect(selectRecent(sessions, new Set(), new Set(), dismissed, now, 24)).toEqual([])

    const reused = [session('a', dismissedAt + 1)]
    expect(selectRecent(reused, new Set(), new Set(), dismissed, now, 24).map((s) => s.sessionId)).toEqual(['a'])
  })

  it('a session exactly at the window boundary is excluded, one millisecond inside it is kept', () => {
    const windowMs = 24 * HOUR
    const atBoundary = [session('edge', now - windowMs - 1)]
    const insideBoundary = [session('inside', now - windowMs)]
    expect(selectRecent(atBoundary, new Set(), new Set(), {}, now, 24)).toEqual([])
    expect(selectRecent(insideBoundary, new Set(), new Set(), {}, now, 24).map((s) => s.sessionId)).toEqual(['inside'])
  })
})

describe('pruneDismissed', () => {
  it('drops entries older than the window and keeps the rest', () => {
    const now = 1_000_000 * HOUR
    const dismissed = { keep: now - 1 * HOUR, drop: now - 200 * HOUR }
    expect(pruneDismissed(dismissed, now, 24)).toEqual({ keep: now - 1 * HOUR })
  })

  it('returns the same reference when nothing needed pruning', () => {
    const now = 1_000_000 * HOUR
    const dismissed = { keep: now - 1 * HOUR }
    expect(pruneDismissed(dismissed, now, 24)).toBe(dismissed)
  })
})
```
- [ ] **Step 2: Run the test and watch it fail**
Run: `npm test -- recentSessions` (fails with `Cannot find module '../../src/renderer/state/recentSessions'`)
- [ ] **Step 3: Implement the pure selector module**
```ts
// src/renderer/state/recentSessions.ts
import type { SessionNode } from '@shared/types'

/** Shared state: sessionId -> the timestamp it was dismissed from Recent at. */
export interface DismissedMap { [sessionId: string]: number }

/**
 * Sessions for the Recent section: active inside the window, not pinned, not already shown in
 * Active, not dismissed since their last activity — newest first.
 *
 * A session is hidden by dismissal only while it stays quiet: `lastActiveAtMs <= dismissed[id]`
 * is exactly "nothing has happened here since you dismissed it." Using the session again moves
 * `lastActiveAtMs` past the dismissal timestamp, which is what brings it back without any extra
 * bookkeeping to un-dismiss it.
 */
export function selectRecent(
  sessions: SessionNode[],
  pinnedIds: Set<string>,
  activeIds: Set<string>,
  dismissed: DismissedMap,
  now: number,
  windowHours: number,
): SessionNode[] {
  const windowMs = windowHours * 3600_000
  return sessions
    .filter((s) => s.lastActiveAtMs !== null && now - s.lastActiveAtMs <= windowMs)
    .filter((s) => !pinnedIds.has(s.sessionId) && !activeIds.has(s.sessionId))
    .filter((s) => {
      const at = dismissed[s.sessionId]
      return at === undefined || s.lastActiveAtMs! > at
    })
    .sort((a, b) => (b.lastActiveAtMs ?? 0) - (a.lastActiveAtMs ?? 0))
}

/** Drops dismissals old enough that they could never hide anything again, so the map cannot grow
 *  without bound across months of use. Returns the same reference when nothing changed, so a
 *  caller can skip writing shared state on every render. */
export function pruneDismissed(dismissed: DismissedMap, now: number, windowHours: number): DismissedMap {
  const windowMs = windowHours * 3600_000
  const stale = Object.entries(dismissed).filter(([, at]) => now - at > windowMs)
  if (stale.length === 0) return dismissed
  const next = { ...dismissed }
  for (const [id] of stale) delete next[id]
  return next
}

export function dismissRecent(dismissed: DismissedMap, sessionId: string, at: number): DismissedMap {
  return { ...dismissed, [sessionId]: at }
}
```
- [ ] **Step 4: Run the test again and confirm it passes**
Run: `npm test -- recentSessions`
- [ ] **Step 5: Add the shared-state field**
```ts
// src/renderer/state/uiState.ts — inside UiState, after `pinnedCollapsed: boolean`
  /** sessionId -> dismissedAtMs, for the Recent section. Shared like `pinned`: dismissing a
   *  session is an act on the library, not on one window. */
  dismissedRecent: Record<string, number>
  /** Whether the Recent section itself is collapsed. */
  recentCollapsed: boolean
```
Add `'dismissedRecent', 'recentCollapsed'` to `SHARED_FIELDS`, and `dismissedRecent: {}, recentCollapsed: false` to `DEFAULT_UI_STATE`.
- [ ] **Step 6: Add the main-process settings fields**
```ts
// src/main/settings.ts — inside AppSettings, after searchSessionNotes
  /** Whether the Recent section (sessions active in the last `recentSectionHours`) is shown. */
  recentSectionEnabled: boolean
  /** How far back "recent" looks. Clamped to 1..168 by the settings dialog, same as the update-check interval. */
  recentSectionHours: number
```
Add to `DEFAULT_SETTINGS`: `recentSectionEnabled: true, recentSectionHours: 24,`. Add the same two fields to `AppSettingsPayload` in `src/shared/api.ts:20-54`, with matching doc comments.
- [ ] **Step 7: Add the Settings dialog row**
```tsx
// src/renderer/components/SettingsDialog.tsx — new row, modelled on the update-interval row
<label className="settings-row">
  <input
    type="checkbox"
    data-testid="setting-recent-enabled"
    checked={draft.recentSectionEnabled}
    onChange={(e) => patch({ recentSectionEnabled: e.target.checked })}
  />
  <span>
    <strong>Show a Recent section</strong>
    <span className="settings-help">
      Lists sessions worked in recently, below Pinned, so a session you just left is one click
      away without hunting through the tree.
    </span>
  </span>
</label>

{draft.recentSectionEnabled && (
  <div className="settings-row settings-row-indent">
    <label className="settings-inline">
      <span>Within the last</span>
      <input
        className="search settings-number"
        type="number"
        min={1}
        max={168}
        data-testid="setting-recent-hours"
        value={draft.recentSectionHours}
        onChange={(e) => {
          const n = Number(e.target.value)
          patch({
            recentSectionHours: Number.isFinite(n) && n >= 1 ? Math.min(168, Math.round(n)) : 1,
          })
        }}
      />
      <span>hours</span>
    </label>
  </div>
)}
```
- [ ] **Step 8: Render the Recent section in the sidebar**
```tsx
// src/renderer/components/Sidebar.tsx — new props, and a section between Pinned and pending
// Props addition:
  recentSessions: SessionNode[]
  recentCollapsed: boolean
  onRecentCollapsedChange: (next: boolean) => void
  onDismissRecent: (session: SessionNode) => void

// JSX, placed immediately after the `pinnedSessions.length > 0` block:
{recentSessions.length > 0 && (
  <section className="recent-section" data-testid="recent-section">
    <button
      className="pinned-header"
      data-testid="recent-toggle"
      aria-expanded={!recentCollapsed}
      onClick={() => onRecentCollapsedChange(!recentCollapsed)}
    >
      <svg className="chevron" data-expanded={!recentCollapsed} viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
        <path d="M6 4l4 4-4 4" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
      <span className="pinned-label">Recent</span>
      <span className="pinned-count">{recentSessions.length}</span>
    </button>
    {!recentCollapsed && recentSessions.map((s) => (
      <div key={s.sessionId} className="recent-row-wrap">
        <SessionRow
          session={s}
          selected={s.sessionId === selectedId}
          onSelect={onSelect}
          onSplit={onSplitSession}
          onDelete={onDeleteSession}
          onTogglePin={onTogglePin}
          onEditNote={onEditNote}
          onMenu={(node, x, y) => setMenu({ kind: 'session', id: node.sessionId, x, y })}
          folderBranch={branchOfSession.get(s.sessionId) ?? null}
        />
        <button
          className="icon-button recent-dismiss"
          data-testid="recent-dismiss-button"
          title="Dismiss from Recent"
          aria-label="Dismiss from Recent"
          onClick={() => onDismissRecent(s)}
        >
          <CloseIcon />
        </button>
      </div>
    ))}
  </section>
)}
```
Add `.recent-section { border-bottom: 1px solid var(--border); padding-bottom: 4px; margin-bottom: 4px; }` and `.recent-row-wrap { position: relative; }` `.recent-dismiss { position: absolute; right: var(--control-gap); top: 50%; transform: translateY(-50%); }` to `styles.css`, next to `.pinned-section` — no new colour/radius/spacing literals, all existing tokens.
- [ ] **Step 9: Wire it in App.tsx**
```tsx
// src/renderer/App.tsx — near where `pinned` and `ui` state already flow into <Sidebar>
const now = Date.now()
const dismissedRecent = pruneDismissed(ui.dismissedRecent, now, settings.recentSectionHours)
if (dismissedRecent !== ui.dismissedRecent) updateSharedUi({ dismissedRecent })

const recentSessions = settings.recentSectionEnabled
  ? selectRecent(flattenSessions(tree), new Set(ui.pinned), activeSessionIds, dismissedRecent, now, settings.recentSectionHours)
  : []

// passed to <Sidebar ... recentSessions={recentSessions} recentCollapsed={ui.recentCollapsed}
//   onRecentCollapsedChange={(next) => updateUi({ recentCollapsed: next })}
//   onDismissRecent={(s) => updateSharedUi({ dismissedRecent: dismissRecent(dismissedRecent, s.sessionId, Date.now()) })} />
```
`activeSessionIds` is the set produced by Task 6/7's registry subscription (empty set until that lands, so Task 5 alone still compiles and works — Active exclusion just does nothing).
- [ ] **Step 10: Run the full unit suite**
Run: `npm test`
- [ ] **Step 11: Add the e2e cases**
```ts
// tests/e2e/sidebar.spec.ts — appended
test('a session worked in recently appears in Recent, and dismissing it hides it until reused', async () => {
  await h.page.getByTestId('sidebar-refresh').click()
  // Fixture data seeds lastActiveAtMs values; one session is within the last 24h and unpinned.
  const section = h.page.getByTestId('recent-section')
  await expect(section).toBeVisible()
  await expect(section.getByTestId('session-item')).toContainText('Worktree session')

  await section.locator('.recent-row-wrap').filter({ hasText: 'Worktree session' })
    .getByTestId('recent-dismiss-button').click()
  await expect(section.getByTestId('session-item')).not.toContainText('Worktree session')
})

test('the Recent window is a validated setting', async () => {
  await h.page.getByTestId('menu-settings').click()
  await h.page.getByTestId('setting-recent-hours').fill('9999')
  await h.page.getByTestId('setting-recent-hours').blur()
  await expect(h.page.getByTestId('setting-recent-hours')).toHaveValue('168')
})
```
- [ ] **Step 12: Run the e2e suite**
Run: `npm run test:e2e -- sidebar`
- [ ] **Final step: Commit**
```bash
git add src/renderer/state/recentSessions.ts src/renderer/state/uiState.ts src/main/settings.ts \
  src/shared/api.ts src/renderer/components/SettingsDialog.tsx src/renderer/components/Sidebar.tsx \
  src/renderer/App.tsx src/renderer/styles.css tests/unit/recentSessions.test.ts tests/e2e/sidebar.spec.ts
git commit -m "feat: add a Recent section below Pinned, with a settings window and dismissal"
```

---

---

### Task 6: A main-process registry of open tabs, with derived activity state

**Files:**
- Create: `src/shared/activity.ts`
- Create: `src/main/tabRegistry.ts`
- Create: `tests/unit/activity.test.ts`
- Create: `tests/unit/tabRegistry.test.ts`
- Modify: `src/shared/api.ts:1-178` (new channels, new `ApiaryApi` methods, new payload types)
- Modify: `src/preload/index.ts` (bridge the new channels)
- Modify: `src/main/ipc.ts:1-497` (construct and wire `TabRegistry`, register/unregister handlers, `focusTab` handler, broadcast changes)
- Modify: `src/main/index.ts` (report window-close to the registry; pass `windowNumber` through, since it already exists per window per the `?w=` query)
- Modify: `src/renderer/App.tsx` (report this window's open tabs to the registry on every tab/pty change)
- Test: `tests/unit/activity.test.ts`
- Test: `tests/unit/tabRegistry.test.ts`

**Interfaces:**
- Consumes: `PtyManager.replay(id): string`, `PtyManager.has(id): boolean`, `PtyManager.onData`/`onExit` (`src/main/pty/ptyManager.ts`), `BrowserWindow.getAllWindows()`/`win.webContents.send` patterns already used in `src/main/ipc.ts:65-75` (`send`) and `:395-460` (`windowUnder`, `announceClaimed`), the `w` query param convention that gives each window its `windowNumber` (`src/main/index.ts:105`, `src/renderer/state/uiState.ts:74-81`).
- Produces:
  - `src/shared/activity.ts`: `export type ActivityStatus = 'running' | 'waiting' | 'idle' | 'stopped'` and `export function classifyActivity(recentOutput: string, lastOutputAtMs: number, now: number, ptyAlive: boolean): ActivityStatus`. Pure, no Node/Electron imports — lives in `shared/` per CLAUDE.md's rule that a helper wanted on both sides belongs there, and importantly so it is trivially unit-testable and reusable if the renderer ever wants to preview status without an IPC round trip.
  - `src/main/tabRegistry.ts`: `export interface OpenTab { windowNumber: number; key: string; view: 'transcript' | 'terminal'; ptyId: string | null }` and `export class TabRegistry { report(windowNumber: number, tabs: OpenTab[]): void; unregisterWindow(windowNumber: number): void; list(): OpenTab[]; onChange(handler: () => void): void }`. `report` replaces the whole set of tabs for that window (so a closed tab in that window simply isn't in the next report — no separate remove call needed per tab). `focusTab(windows: BrowserWindow[], windowNumber: number, key: string): void` — a free function (not a method, since it needs `BrowserWindow`, which must stay out of anything unit-testable without Electron) that finds the window whose `?w=` equals `windowNumber` among `BrowserWindow.getAllWindows()`, calls `.focus()` (and `.restore()` if minimized), and sends a new IPC channel `apiary:select-tab` with `key` so that window's `App.tsx` switches to it.

**Coordination with Task 2 — read this before wiring the renderer side.** Task 2 already
adds an effect in `App.tsx` that reports this window's panes and tabs to the main process
on every change. Do not add a second, independently-triggered effect that walks the same
state: extend that one effect to send both payloads, so the layout record and the tab
registry can never disagree about what this window has open. If Task 2 has not landed yet,
write the registry report as its own effect but keep the tab-walking logic in one exported
helper that Task 2's effect can call.

- [ ] **Step 1: Write the failing test for classifyActivity**
```ts
// tests/unit/activity.test.ts
import { describe, it, expect } from 'vitest'
import { classifyActivity } from '../../src/shared/activity'

// A real permission-prompt tail, as Claude Code actually renders it.
const PERMISSION_PROMPT = [
  '╭─────────────────────────────────────────────────────────╮',
  '│ Bash command                                             │',
  '│                                                           │',
  '│   rm -rf build/                                          │',
  '│                                                           │',
  '│ Do you want to proceed?                                  │',
  '│ ❯ 1. Yes                                                 │',
  '│   2. Yes, and don\'t ask again for rm commands            │',
  '│   3. No, and tell Claude what to do differently          │',
  '╰─────────────────────────────────────────────────────────╯',
].join('\r\n')

// A real question-box tail, as Claude Code renders a free-text follow-up question.
const QUESTION_BOX = [
  '╭─────────────────────────────────────────────────────────╮',
  '│ > Which branch should this ship on?                     │',
  '╰─────────────────────────────────────────────────────────╯',
].join('\r\n')

describe('classifyActivity', () => {
  const now = 1_000_000

  it('is running when output arrived within the last ~2 seconds', () => {
    expect(classifyActivity('some output', now - 500, now, true)).toBe('running')
  })

  it('is waiting when the tail is a permission prompt, even if output is not fresh', () => {
    expect(classifyActivity(PERMISSION_PROMPT, now - 10_000, now, true)).toBe('waiting')
  })

  it('is waiting when the tail is a question box', () => {
    expect(classifyActivity(QUESTION_BOX, now - 10_000, now, true)).toBe('waiting')
  })

  it('is idle when alive, quiet, and not showing a prompt', () => {
    expect(classifyActivity('$ ', now - 10_000, now, true)).toBe('idle')
  })

  it('is stopped when the pty has exited, regardless of its last output', () => {
    expect(classifyActivity(PERMISSION_PROMPT, now - 500, now, false)).toBe('stopped')
  })
})
```
- [ ] **Step 2: Run the test and watch it fail**
Run: `npm test -- activity` (fails with `Cannot find module '../../src/shared/activity'`)
- [ ] **Step 3: Implement the pure classifier**
```ts
// src/shared/activity.ts
export type ActivityStatus = 'running' | 'waiting' | 'idle' | 'stopped'

/** Output within this long is still "in progress" rather than "gone quiet". */
const RUNNING_WINDOW_MS = 2000

/**
 * The last non-blank lines of output, which is what a prompt box actually looks like once a
 * program has drawn it — the box is the last thing on screen, everything above it is scrollback.
 * Kept small and cheap: this runs on every registry poll, across every open tab.
 */
function tail(recentOutput: string, lines = 12): string {
  return recentOutput.split(/\r\n|\n/).slice(-lines).join('\n')
}

/**
 * Claude's boxed prompts (a permission request, or a free-text follow-up question) are drawn with
 * box-drawing characters and a line ending in a question mark, or an explicit "Do you want to
 * proceed?" — both survive being reduced to their tail. This is intentionally loose: a false
 * "waiting" just means an amber dot where idle would have been slower to notice, which is a far
 * cheaper mistake than missing a prompt someone is actually stuck at.
 */
const PROMPT_PATTERN = /(Do you want to proceed\?|\?\s*$|❯\s*\d+\.)/m

export function classifyActivity(
  recentOutput: string,
  lastOutputAtMs: number,
  now: number,
  ptyAlive: boolean,
): ActivityStatus {
  if (!ptyAlive) return 'stopped'
  if (now - lastOutputAtMs <= RUNNING_WINDOW_MS) return 'running'
  if (PROMPT_PATTERN.test(tail(recentOutput))) return 'waiting'
  return 'idle'
}
```
- [ ] **Step 4: Run the test again and confirm it passes**
Run: `npm test -- activity`
- [ ] **Step 5: Write the failing test for TabRegistry**
```ts
// tests/unit/tabRegistry.test.ts
import { describe, it, expect, vi } from 'vitest'
import { TabRegistry } from '../../src/main/tabRegistry'

describe('TabRegistry', () => {
  it('lists tabs reported by a window', () => {
    const registry = new TabRegistry()
    registry.report(1, [{ windowNumber: 1, key: 'session-a', view: 'terminal', ptyId: 'pty-1' }])
    expect(registry.list()).toEqual([{ windowNumber: 1, key: 'session-a', view: 'terminal', ptyId: 'pty-1' }])
  })

  it('a later report from the same window replaces its earlier one entirely', () => {
    const registry = new TabRegistry()
    registry.report(1, [{ windowNumber: 1, key: 'a', view: 'terminal', ptyId: 'pty-a' }])
    registry.report(1, [{ windowNumber: 1, key: 'b', view: 'terminal', ptyId: 'pty-b' }])
    expect(registry.list()).toEqual([{ windowNumber: 1, key: 'b', view: 'terminal', ptyId: 'pty-b' }])
  })

  it('keeps other windows separate', () => {
    const registry = new TabRegistry()
    registry.report(1, [{ windowNumber: 1, key: 'a', view: 'terminal', ptyId: 'pty-a' }])
    registry.report(2, [{ windowNumber: 2, key: 'b', view: 'terminal', ptyId: 'pty-b' }])
    expect(registry.list().map((t) => t.key).sort()).toEqual(['a', 'b'])
  })

  it('clears a window entirely when it closes', () => {
    const registry = new TabRegistry()
    registry.report(1, [{ windowNumber: 1, key: 'a', view: 'terminal', ptyId: 'pty-a' }])
    registry.report(2, [{ windowNumber: 2, key: 'b', view: 'terminal', ptyId: 'pty-b' }])
    registry.unregisterWindow(1)
    expect(registry.list()).toEqual([{ windowNumber: 2, key: 'b', view: 'terminal', ptyId: 'pty-b' }])
  })

  it('notifies subscribers on report and on unregister', () => {
    const registry = new TabRegistry()
    const handler = vi.fn()
    registry.onChange(handler)
    registry.report(1, [{ windowNumber: 1, key: 'a', view: 'terminal', ptyId: 'pty-a' }])
    registry.unregisterWindow(1)
    expect(handler).toHaveBeenCalledTimes(2)
  })
})
```
- [ ] **Step 6: Run the test and watch it fail**
Run: `npm test -- tabRegistry` (fails with `Cannot find module '../../src/main/tabRegistry'`)
- [ ] **Step 7: Implement TabRegistry**
```ts
// src/main/tabRegistry.ts

/** A tab a window currently has open, as it reports itself — see App.tsx's report effect. */
export interface OpenTab {
  windowNumber: number
  key: string
  view: 'transcript' | 'terminal'
  /** The pty this tab's process runs under, when it has one (a fresh new-session pty before its
   *  real session id exists, or the session id itself once resolved). Null for a transcript-only
   *  tab that has never been run as a terminal. */
  ptyId: string | null
}

/**
 * What tabs are open, across every window, for the Active section.
 *
 * Deliberately dumb: it holds exactly what each window last reported and nothing derived from it
 * — status classification reads `PtyManager` fresh at render time in ipc.ts, because activity
 * changes constantly and this registry should not become a second place that state can go stale.
 */
export class TabRegistry {
  private byWindow = new Map<number, OpenTab[]>()
  private handlers: (() => void)[] = []

  onChange(handler: () => void): void { this.handlers.push(handler) }
  private notify(): void { for (const h of this.handlers) h() }

  /** Replaces everything window `windowNumber` has open. A tab that existed before and is absent
   *  from `tabs` is gone — closing a tab is reported by simply not including it next time, the
   *  same way a window's full set is reported rather than diffed. */
  report(windowNumber: number, tabs: OpenTab[]): void {
    this.byWindow.set(windowNumber, tabs)
    this.notify()
  }

  unregisterWindow(windowNumber: number): void {
    if (!this.byWindow.delete(windowNumber)) return
    this.notify()
  }

  list(): OpenTab[] {
    return [...this.byWindow.values()].flat()
  }
}
```
- [ ] **Step 8: Run the test again and confirm it passes**
Run: `npm test -- tabRegistry`
- [ ] **Step 9: Add shared channels and payload types**
```ts
// src/shared/api.ts — new payload type, near PluginBarItemPayload
export interface ActiveTabPayload {
  windowNumber: number
  key: string
  view: 'transcript' | 'terminal'
  status: import('./activity').ActivityStatus
}

// CHANNELS — new entries
  reportTabs: 'apiary:report-tabs',
  activeTabs: 'apiary:active-tabs',
  activeTabsChanged: 'apiary:active-tabs-changed',
  focusTab: 'apiary:focus-tab',
  selectTab: 'apiary:select-tab',

// ApiaryApi — new methods
  /** Tells main what this window currently has open, replacing its previous report. */
  reportTabs(tabs: { key: string; view: 'transcript' | 'terminal'; ptyId: string | null }[]): void
  /** Every open tab across every window, with its derived status, for the Active section. */
  activeTabs(): Promise<ActiveTabPayload[]>
  /** Fires whenever the registry or any tab's activity status changes. */
  onActiveTabsChanged(cb: () => void): () => void
  /** Raises the given window and selects that tab in it. */
  focusTab(windowNumber: number, key: string): Promise<void>
  /** Fired in the target window so it can switch to the tab `focusTab` asked for. */
  onSelectTab(cb: (key: string) => void): () => void
```
- [ ] **Step 10: Bridge the channels in preload**
```ts
// src/preload/index.ts — alongside the other contextBridge exposures
reportTabs: (tabs) => ipcRenderer.send(CHANNELS.reportTabs, tabs),
activeTabs: () => ipcRenderer.invoke(CHANNELS.activeTabs),
onActiveTabsChanged: (cb) => {
  const listener = (): void => cb()
  ipcRenderer.on(CHANNELS.activeTabsChanged, listener)
  return () => ipcRenderer.removeListener(CHANNELS.activeTabsChanged, listener)
},
focusTab: (windowNumber, key) => ipcRenderer.invoke(CHANNELS.focusTab, windowNumber, key),
onSelectTab: (cb) => {
  const listener = (_e: unknown, key: string): void => cb(key)
  ipcRenderer.on(CHANNELS.selectTab, listener)
  return () => ipcRenderer.removeListener(CHANNELS.selectTab, listener)
},
```
- [ ] **Step 11: Wire the registry into ipc.ts and index.ts**
```ts
// src/main/ipc.ts — inside registerIpc, alongside the existing `focusOrder`/`windowUnder` block
const registry = new TabRegistry()
registry.onChange(() => send(CHANNELS.activeTabsChanged))
// A pty's own data/exit also change status without a window re-reporting its tabs — e.g. a
// long-idle session finally exits. Re-broadcast on those too so the dot updates on its own.
service.ptyManager.onData(() => send(CHANNELS.activeTabsChanged))
service.ptyManager.onExit(() => send(CHANNELS.activeTabsChanged))

ipcMain.on(CHANNELS.reportTabs, (e, tabs: { key: string; view: 'transcript' | 'terminal'; ptyId: string | null }[]) => {
  const windowNumber = windowNumberFor(e.sender.id)
  if (windowNumber === null) return
  registry.report(windowNumber, tabs.map((t) => ({ ...t, windowNumber })))
})

handle(CHANNELS.activeTabs, () => registry.list().map((t) => ({
  windowNumber: t.windowNumber,
  key: t.key,
  view: t.view,
  status: classifyActivity(
    t.ptyId !== null ? service.ptyManager.replay(t.ptyId) : '',
    service.ptyManager.lastOutputAt(t.ptyId ?? ''),
    Date.now(),
    t.ptyId !== null && service.ptyManager.has(t.ptyId),
  ),
})))

handle(CHANNELS.focusTab, (_e, windowNumber: number, key: string) => {
  const target = BrowserWindow.getAllWindows().find((w) => !w.isDestroyed() && windowNumberFor(w.webContents.id) === windowNumber)
  if (target === undefined) return
  if (target.isMinimized()) target.restore()
  target.focus()
  target.webContents.send(CHANNELS.selectTab, key)
})
```
`windowNumberFor` reads the window's `?w=` query the same way `stateKey()` does in the renderer — implemented as a small helper in `index.ts` (each `BrowserWindow`'s number is already known at creation; keep a `Map<number, number>` from `webContents.id` to `windowNumber`, populated in `createWindow` right after `win` is built, and passed into `registerIpc` as a new `windowNumberFor: (webContentsId: number) => number | null` argument — this keeps `ipc.ts` free of `BrowserWindow` construction details it does not otherwise need).

`PtyManager` gains a small accessor used above: `lastOutputAt(id: string): number` returning `this.lastDataAt.get(id) ?? 0` (add next to the existing `outputCount` method in `src/main/pty/ptyManager.ts`, same section, same pattern — the field already exists, only the accessor is new).
- [ ] **Step 12: Report tabs from the renderer**
```tsx
// src/renderer/App.tsx — a new effect, alongside the existing per-tab/pty bookkeeping
useEffect(() => {
  const tabs = openTabs.map((t) => ({ key: t.key, view: t.view, ptyId: t.ptyId }))
  window.apiary.reportTabs(tabs)
}, [openTabs])
```
(`openTabs` is derived from the window's existing `Layout`/pane state the same way tab strips are already rendered — no new state shape, just a flatten of what `layout.ts` already tracks per pane.)
- [ ] **Step 13: Run the unit suite**
Run: `npm test`
- [ ] **Final step: Commit**
```bash
git add src/shared/activity.ts src/main/tabRegistry.ts src/shared/api.ts src/preload/index.ts \
  src/main/ipc.ts src/main/index.ts src/main/pty/ptyManager.ts src/renderer/App.tsx \
  tests/unit/activity.test.ts tests/unit/tabRegistry.test.ts
git commit -m "feat: track open tabs across windows and derive per-session activity status"
```

---

---

### Task 7: An Active section above Pinned, across all windows

**Files:**
- Create: `src/renderer/state/useActiveTabs.ts`
- Create: `tests/e2e/activeSection.spec.ts`
- Modify: `src/renderer/components/Sidebar.tsx:430-486` (new section rendered above Pinned)
- Modify: `src/renderer/styles.css` (status-dot tokens and keyframes, `prefers-reduced-motion` override)
- Modify: `src/renderer/App.tsx` (mount `useActiveTabs`, pass rows and `focusTab` handler into `Sidebar`)
- Test: `tests/e2e/activeSection.spec.ts`

**Interfaces:**
- Consumes (from Task 6, exact signatures): `window.apiary.activeTabs(): Promise<ActiveTabPayload[]>`, `window.apiary.onActiveTabsChanged(cb: () => void): () => void`, `window.apiary.focusTab(windowNumber: number, key: string): Promise<void>`, `ActiveTabPayload { windowNumber: number; key: string; view: 'transcript' | 'terminal'; status: ActivityStatus }`, `ActivityStatus = 'running' | 'waiting' | 'idle' | 'stopped'` (`src/shared/activity.ts`).
- Produces:
  - `src/renderer/state/useActiveTabs.ts`: `export function useActiveTabs(): ActiveTabPayload[]` — a hook that polls `activeTabs()` once on mount, subscribes via `onActiveTabsChanged`, and re-fetches on each notification; returns the current list, `[]` before the first resolve.
  - `Sidebar.tsx` new props: `activeTabs: ActiveTabPayload[]`, `onFocusTab: (windowNumber: number, key: string) => void`. New section `data-testid="active-section"`, rendered before the Pinned section, each row `data-testid="active-tab-row"` showing the tab's title/key, its window number, and a status dot `data-testid="active-status-dot" data-status={status}`.

- [ ] **Step 1: Write the failing e2e test**
```ts
// tests/e2e/activeSection.spec.ts
import { test, expect } from '@playwright/test'
import { launchApiary, importAll, type Harness } from './helpers'

let h: Harness
test.beforeEach(async () => {
  h = await launchApiary()
  await importAll(h.page)
})
test.afterEach(async () => { await h.close() })

test('Active lists open sessions from both windows and clicking a row focuses the right window', async () => {
  await h.page.getByTestId('session-item').first().click()

  const second = await h.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length)
  await h.page.keyboard.press(process.platform === 'darwin' ? 'Meta+N' : 'Control+N')
  await expect.poll(() => h.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length)).toBe(second + 1)

  const windows = h.app.windows()
  const secondPage = windows[windows.length - 1]
  await secondPage.getByTestId('sidebar-refresh').click()
  await secondPage.getByTestId('session-item').nth(1).click()

  const active = h.page.getByTestId('active-section')
  await expect(active).toBeVisible()
  await expect(active.getByTestId('active-tab-row')).toHaveCount(2)

  const otherRow = active.getByTestId('active-tab-row').filter({ hasText: await secondPage.getByTestId('session-item').nth(1).innerText() })
  await otherRow.click()
  await expect.poll(() => secondPage.evaluate(() => document.hasFocus())).toBe(true)
})

test('status dot reflects a stopped pty', async () => {
  await h.page.getByTestId('session-item').first().click()
  await h.page.getByTestId('terminal-view').waitFor()
  // Killing the shell from within it lets the pty exit on its own, the same signal `classifyActivity`
  // reads for 'stopped' — not a simulated status, the real exit path.
  await h.page.keyboard.type('exit\n')
  const dot = h.page.getByTestId('active-section').getByTestId('active-status-dot')
  await expect(dot).toHaveAttribute('data-status', 'stopped')
})
```
- [ ] **Step 2: Run the test and watch it fail**
Run: `npm run test:e2e -- activeSection` (fails: no `active-section` testid exists yet)
- [ ] **Step 3: Implement the polling hook**
```ts
// src/renderer/state/useActiveTabs.ts
import { useEffect, useState } from 'react'
import type { ActiveTabPayload } from '@shared/api'

/** Every open tab across every window, with its derived activity status, kept live. */
export function useActiveTabs(): ActiveTabPayload[] {
  const [tabs, setTabs] = useState<ActiveTabPayload[]>([])

  useEffect(() => {
    let cancelled = false
    const refresh = (): void => {
      void window.apiary.activeTabs().then((next) => { if (!cancelled) setTabs(next) })
    }
    refresh()
    const unsubscribe = window.apiary.onActiveTabsChanged(refresh)
    return () => { cancelled = true; unsubscribe() }
  }, [])

  return tabs
}
```
- [ ] **Step 4: Add the status-dot tokens and keyframes**
```css
/* src/renderer/styles.css — inside :root, alongside the other Status tokens */
--status-running: var(--info);
--status-waiting: var(--warning);
--status-idle: var(--muted);
--status-stopped: var(--border);
--status-dot-size: 8px;
--status-ring-width: 2px;
--status-pulse-duration-running: 1.2s;
--status-pulse-duration-waiting: 2.4s;

/* alongside @keyframes spin */
@keyframes status-pulse {
  0% { box-shadow: 0 0 0 0 var(--pulse-color); }
  100% { box-shadow: 0 0 0 6px transparent; }
}

.status-dot {
  width: var(--status-dot-size);
  height: var(--status-dot-size);
  border-radius: 50%;
  flex: none;
}
.status-dot[data-status="running"] {
  background: var(--status-running);
  --pulse-color: color-mix(in srgb, var(--status-running) 55%, transparent);
  animation: status-pulse var(--status-pulse-duration-running) ease-out infinite;
}
.status-dot[data-status="waiting"] {
  background: var(--status-waiting);
  --pulse-color: color-mix(in srgb, var(--status-waiting) 55%, transparent);
  animation: status-pulse var(--status-pulse-duration-waiting) ease-out infinite;
}
.status-dot[data-status="idle"] { background: var(--status-idle); }
.status-dot[data-status="stopped"] {
  background: transparent;
  border: var(--status-ring-width) solid var(--status-idle);
}

/* The colour alone still tells the four states apart, so turning motion off costs nothing —
 * this is the one rule in the file that reads a media feature, because it is the one place an
 * indefinite loop is added for a *state*, not a one-shot transition like the refresh spinner. */
@media (prefers-reduced-motion: reduce) {
  .status-dot[data-status="running"],
  .status-dot[data-status="waiting"] {
    animation: none;
  }
}
```
- [ ] **Step 5: Render the Active section in Sidebar.tsx**
```tsx
// src/renderer/components/Sidebar.tsx — new props on Props, and JSX above the Pinned section
  activeTabs: ActiveTabPayload[]
  onFocusTab: (windowNumber: number, key: string) => void

// JSX, immediately before `{pinnedSessions.length > 0 && (...)}`
{activeTabs.length > 0 && (
  <section className="active-section" data-testid="active-section">
    <div className="pinned-header" aria-hidden="true">
      <span className="pinned-label">Active</span>
      <span className="pinned-count">{activeTabs.length}</span>
    </div>
    {activeTabs.map((t) => (
      <button
        key={`${String(t.windowNumber)}:${t.key}`}
        className="session-row active-tab-row"
        data-testid="active-tab-row"
        onClick={() => onFocusTab(t.windowNumber, t.key)}
        title={`Window ${String(t.windowNumber)}`}
      >
        <span className="status-dot" data-testid="active-status-dot" data-status={t.status} />
        <span className="session-title">{t.key}</span>
        <span className="active-window-number">W{t.windowNumber}</span>
      </button>
    ))}
  </section>
)}
```
Add `.active-section { border-bottom: 1px solid var(--border); padding-bottom: 4px; margin-bottom: 4px; }` and `.active-window-number { color: var(--muted); font-size: 11px; margin-left: auto; }` to `styles.css`, next to `.pinned-section`.
- [ ] **Step 6: Wire it up in App.tsx**
```tsx
// src/renderer/App.tsx
const activeTabs = useActiveTabs()
// ... passed to <Sidebar ... activeTabs={activeTabs} onFocusTab={(w, key) => void window.apiary.focusTab(w, key)} />
```
- [ ] **Step 7: Handle the incoming select in the target window**
```tsx
// src/renderer/App.tsx — a new effect, alongside the other onXChanged subscriptions
useEffect(() => window.apiary.onSelectTab((key) => selectByKey(key)), [])
```
(`selectByKey` is the same lookup `tab-adopt` already uses to switch the active tab by key — reuse it rather than duplicating tab-selection logic.)
- [ ] **Step 8: Run the e2e test**
Run: `npm run test:e2e -- activeSection`
- [ ] **Step 9: Confirm titles never move between windows**
Add a third e2e assertion in `activeSection.spec.ts`: after clicking a row for the second window's tab, assert the first window's own tab list (`h.page.getByTestId('tab-strip')`, or the app's existing tab-strip testid) is unchanged — `focusTab` only focuses and selects, it never migrates the tab, unlike `tabDropped`.
- [ ] **Final step: Commit**
```bash
git add src/renderer/state/useActiveTabs.ts src/renderer/components/Sidebar.tsx \
  src/renderer/styles.css src/renderer/App.tsx tests/e2e/activeSection.spec.ts
git commit -m "feat: show an Active section listing open sessions across all windows"
```

---

### Task 8: Searching stops rebuilding the tree on every keystroke

**Files:**
- Create: `src/shared/fuzzy.ts`
- Create: `src/shared/treeFilter.ts`
- Create: `src/renderer/state/useDebouncedValue.ts`
- Create: `src/renderer/state/useSessionTreeCache.ts`
- Delete: `src/main/tree/fuzzy.ts` (moved to `src/shared/fuzzy.ts`)
- Modify: `src/main/tree/buildTree.ts:1-127` (drop `filterNode`/`projectMatches`/`filterTree`, keep only `buildTree`)
- Modify: `src/main/appService.ts:286-298` (`tree()` drops its query parameter)
- Modify: `src/shared/api.ts` (`tree()` signature; add `searchContent` channel)
- Modify: `src/preload/index.ts` (mirror the two API changes above)
- Modify: `src/main/ipc.ts:79-80` (`tree` handler; add `searchContent` handler)
- Modify: `src/renderer/state/useTree.ts:1-44` (full rewrite: debounce, cache, supersede, local filter, cap)
- Modify: `src/renderer/components/Sidebar.tsx:122-135,368-386` (drop the query hand-off to main; show the cap note)
- Modify: `src/renderer/App.tsx:222-230` (read `searchChatContent`/`searchSessionNotes`, pass to `Sidebar`)
- Test: `tests/unit/localFilter.test.ts` (new home for the old `fuzzy.test.ts` + `filterTree` tests, plus the cap)
- Test: `tests/unit/searchLoad.test.ts`
- Test: Modify `tests/unit/buildTree.test.ts:92-127` (drop the `filterTree` describe block)
- Delete: `tests/unit/fuzzy.test.ts` (superseded by `localFilter.test.ts`)
- Test: Modify `tests/integration/appService.test.ts:81-95` (`tree()` no longer takes a query — see below)

**Interfaces:**
- Consumes: `window.apiary.tree()` (existing channel, arity drops from `tree(query?)` to `tree()`); `AppService.searchSessions(query: string): string[]` (existing method, not previously reachable from the renderer — this task exposes it over IPC unchanged); `ProjectNode`/`SessionNode` from `@shared/types`.
- Produces: `fuzzyScore(query: string, target: string): number | null` (moved verbatim from `src/main/tree/fuzzy.ts`); `SEARCH_RESULT_CAP = 200`; `filterTreeLocal(tree: ProjectNode[], query: string, matchedByContent: Set<string>): { tree: ProjectNode[]; totalMatches: number }` in `src/shared/treeFilter.ts`; `useDebouncedValue<T>(value: T, delayMs: number): T`; `useSessionTreeCache(): { rawTree: ProjectNode[]; loading: boolean; reload: () => void; reloadNow: () => Promise<ProjectNode[]> }`; `useTree(query: string, options: { searchChatContent: boolean; searchSessionNotes: boolean }): { tree: ProjectNode[]; matchedByContent: Set<string>; totalMatches: number; capped: boolean; loading: boolean; reload: () => void; reloadNow: () => Promise<ProjectNode[]> }` — Task 9 consumes `tree` and `matchedByContent` from this return value directly.

**Which IPC calls stay, which go:**
- `apiary:tree` **stays**, but its signature changes from `tree(query?: string)` to `tree()` — it always returns the full, unfiltered tree now. Nothing else called `service.tree(query)` with a real query except the sidebar and the one integration test listed above, so this is the whole blast radius.
- `apiary:search-content` is **new** — it exposes `AppService.searchSessions`, which already existed privately for `tree()`'s own internal use and is now reachable directly.
- No channel is removed. `AppService.tree()`'s internal call to `filterTree`/`fuzzyScore` (main-process title/path/branch filtering) **goes away entirely** — that logic moves to the renderer, so `src/main/tree/buildTree.ts` and `src/main/tree/fuzzy.ts` lose it, and `appService.ts` drops the `filterTree` import.

- [ ] **Step 1: Write the failing load test**
```ts
// tests/unit/searchLoad.test.ts
import { describe, it, expect } from 'vitest'
import { filterTreeLocal } from '../../src/shared/treeFilter'
import type { ProjectNode, SessionNode } from '../../src/shared/types'

/**
 * 5,000 sessions across 200 synthetic projects — the shape the spec's load test asks for. Built
 * once per test so the fixture cost itself doesn't leak into the measured budget.
 */
function buildSyntheticTree(): ProjectNode[] {
  const projects: ProjectNode[] = []
  let remaining = 5000
  for (let p = 0; p < 200 && remaining > 0; p++) {
    const sessions: SessionNode[] = []
    const perProject = Math.ceil(5000 / 200)
    for (let s = 0; s < perProject && remaining > 0; s++, remaining--) {
      sessions.push({
        kind: 'session',
        sessionId: `p${p}-s${s}`,
        // Every 37th session mentions "csv" so a 3-character query has a small, known hit set.
        title: s % 37 === 0 ? `Fix CSV export bug ${p}-${s}` : `Session ${p}-${s} routine work`,
        cwd: `/synthetic/project-${p}`,
        gitBranch: 'main',
        lastActiveAtMs: Date.now() - s * 1000,
        messageCount: 10,
        isLive: false,
        cwdExists: true,
        note: null,
      })
    }
    projects.push({
      kind: 'project', path: `/synthetic/project-${p}`, label: `project-${p}`,
      branch: 'main', isWorktree: false, children: [], sessions,
    })
  }
  return projects
}

describe('local search performance', () => {
  it('filters 5,000 sessions across 200 projects within budget', () => {
    const tree = buildSyntheticTree()
    const started = performance.now()
    const { tree: filtered } = filterTreeLocal(tree, 'csv', new Set())
    const elapsedMs = performance.now() - started

    expect(filtered.length).toBeGreaterThan(0)
    // The budget the spec asks for: a 3-character query must stay well inside what anyone would
    // perceive as lag. This machine class measures single-digit milliseconds; 40ms leaves real
    // headroom while still catching an accidental O(n^2) walk introduced later.
    expect(elapsedMs).toBeLessThan(40)
  })

  it('keeps the keystroke-to-paint work under 50ms', () => {
    // There is no jsdom/React-testing-library in this repo's unit-test stack (vitest runs plain
    // Node — see vitest.config.ts's `environment: 'node'`), so an actual paint cannot be measured
    // here; what is measured instead is the exact synchronous call the debounced value in
    // `useTree` invokes on every settled keystroke, which is the only work standing between a
    // keypress and the render it schedules. An e2e budget on the real DOM belongs in Task 9's
    // `search.spec.ts`, not here.
    const tree = buildSyntheticTree()
    const started = performance.now()
    filterTreeLocal(tree, 'fix', new Set())
    const elapsedMs = performance.now() - started
    expect(elapsedMs).toBeLessThan(50)
  })
})
```
- [ ] **Step 2: Run the test and watch it fail**
Run: `npm test -- tests/unit/searchLoad.test.ts` (expected failure: `Cannot find module '../../src/shared/treeFilter'`)
- [ ] **Step 3: Move the fuzzy scorer into shared**
```ts
// src/shared/fuzzy.ts (moved verbatim from src/main/tree/fuzzy.ts)
const WORD_BOUNDARY = /[\s/\-_.]/

/**
 * Subsequence match with a bonus for contiguous runs and word-start hits.
 * Returns null when the query is not a subsequence of the target.
 */
export function fuzzyScore(query: string, target: string): number | null {
  if (query.length === 0) return 0
  const q = query.toLowerCase()
  const t = target.toLowerCase()

  let score = 0
  let qi = 0
  let previousIndex = -2

  for (let ti = 0; ti < t.length && qi < q.length; ti++) {
    if (t[ti] !== q[qi]) continue
    score += 1
    if (ti === previousIndex + 1) score += 4
    if (ti === 0 || WORD_BOUNDARY.test(t[ti - 1])) score += 3
    previousIndex = ti
    qi++
  }

  return qi === q.length ? score : null
}
```
Delete `src/main/tree/fuzzy.ts`. It moves rather than duplicates: this is a pure helper that used to live only in main and now is wanted only in the renderer, but its unit test lives in `tests/unit`, which is compiled under `tsconfig.node.json` (no DOM lib, and it does not include `src/renderer`) — so it has to live in `src/shared/` to be reachable from both the test and the renderer without dragging a renderer path into the node project, the exact trap `CLAUDE.md` calls out for `shared/promptPath.ts` and `shared/forkLabel.ts`.
- [ ] **Step 4: Move the filtering + cap into shared**
```ts
// src/shared/treeFilter.ts
import type { ProjectNode } from './types'
import { fuzzyScore } from './fuzzy'

/** Results shown before "showing first 200" replaces the rest. */
export const SEARCH_RESULT_CAP = 200

function projectMatches(node: ProjectNode, query: string): boolean {
  return (
    fuzzyScore(query, node.label) !== null ||
    fuzzyScore(query, node.path) !== null ||
    (node.branch !== null && fuzzyScore(query, node.branch) !== null)
  )
}

function filterNode(node: ProjectNode, query: string, alsoMatched: Set<string>): ProjectNode | null {
  if (projectMatches(node, query)) return node
  const sessions = node.sessions.filter(
    (s) => fuzzyScore(query, s.title) !== null || alsoMatched.has(s.sessionId),
  )
  const children = node.children
    .map((c) => filterNode(c, query, alsoMatched))
    .filter((c): c is ProjectNode => c !== null)
  if (sessions.length === 0 && children.length === 0) return null
  return { ...node, sessions, children }
}

function countSessions(nodes: ProjectNode[]): number {
  return nodes.reduce((n, node) => n + node.sessions.length + countSessions(node.children), 0)
}

/** Keeps only the first `limit` sessions, walking in the tree's existing order (most-recent-first
 *  within a project, per `buildTree`), dropping whatever folders that leaves empty. */
function capTree(nodes: ProjectNode[], limit: number): ProjectNode[] {
  let left = limit
  const walk = (list: ProjectNode[]): ProjectNode[] => list
    .map((node) => {
      const sessions = left > 0 ? node.sessions.slice(0, left) : []
      left -= sessions.length
      const children = walk(node.children)
      if (sessions.length === 0 && children.length === 0) return null
      return { ...node, sessions, children }
    })
    .filter((n): n is ProjectNode => n !== null)
  return walk(nodes)
}

/**
 * Title/path/branch filtering, run in the renderer against the cached, unfiltered tree —
 * `matchedByContent` folds in whatever the main process's FTS index additionally matched, exactly
 * as `AppService.tree()` used to before this moved. Capped at `SEARCH_RESULT_CAP`, because a typo
 * that matches thousands of rows must not cost thousands of rows of render work.
 */
export function filterTreeLocal(
  tree: ProjectNode[],
  query: string,
  matchedByContent: Set<string>,
): { tree: ProjectNode[]; totalMatches: number } {
  if (query.trim() === '') return { tree, totalMatches: countSessions(tree) }
  const filtered = tree.map((n) => filterNode(n, query, matchedByContent)).filter((n): n is ProjectNode => n !== null)
  const totalMatches = countSessions(filtered)
  return { tree: capTree(filtered, SEARCH_RESULT_CAP), totalMatches }
}
```
- [ ] **Step 5: Strip `buildTree.ts` down to `buildTree` only**
Remove `filterNode`, `projectMatches` and `filterTree` from `src/main/tree/buildTree.ts`, and its `import { fuzzyScore } from './fuzzy'`. `buildTree` itself (lines 39-86 today) is untouched — it never filtered anything.
- [ ] **Step 6: Update the failing tests' imports and drop what moved**
```ts
// tests/unit/localFilter.test.ts — replaces tests/unit/fuzzy.test.ts and the filterTree
// describe block that was in tests/unit/buildTree.test.ts
import { describe, it, expect } from 'vitest'
import { fuzzyScore } from '../../src/shared/fuzzy'
import { filterTreeLocal, SEARCH_RESULT_CAP } from '../../src/shared/treeFilter'
import type { ProjectNode } from '../../src/shared/types'

describe('fuzzyScore', () => {
  it('matches a subsequence regardless of case', () => {
    expect(fuzzyScore('CSV', 'fix csv bug')).not.toBeNull()
  })
  it('rejects a non-subsequence', () => {
    expect(fuzzyScore('xyz', 'Fix CSV export')).toBeNull()
  })
})

const proj = (path: string, sessions: ProjectNode['sessions'] = []): ProjectNode => ({
  kind: 'project', path, label: path.split('/').pop() ?? path, branch: null,
  isWorktree: false, children: [], sessions,
})

describe('filterTreeLocal', () => {
  it('keeps a project whose session title matches', () => {
    const tree = [proj('/p/app', [{
      kind: 'session', sessionId: 's1', title: 'Fix CSV export', cwd: '/p/app',
      gitBranch: null, lastActiveAtMs: 1, messageCount: null, isLive: false, cwdExists: true, note: null,
    }])]
    expect(filterTreeLocal(tree, 'csv', new Set()).tree[0].sessions).toHaveLength(1)
  })

  it('caps at 200 and reports the true match count', () => {
    const sessions = Array.from({ length: 250 }, (_, i) => ({
      kind: 'session' as const, sessionId: `s${i}`, title: `Fix CSV ${i}`, cwd: '/p/app',
      gitBranch: null, lastActiveAtMs: 250 - i, messageCount: null, isLive: false, cwdExists: true, note: null,
    }))
    const { tree, totalMatches } = filterTreeLocal([proj('/p/app', sessions)], 'csv', new Set())
    expect(totalMatches).toBe(250)
    expect(tree[0].sessions).toHaveLength(SEARCH_RESULT_CAP)
  })
})
```
Delete `tests/unit/fuzzy.test.ts`. In `tests/unit/buildTree.test.ts`, delete the `describe('filterTree', …)` block (lines 92-127) and its now-unused `filterTree` import, keeping the `buildTree` describe block as-is.
- [ ] **Step 7: Drop the query parameter from `AppService.tree()`**
```ts
// src/main/appService.ts — replaces the current tree()/searchSessions pairing
async tree(): Promise<ProjectNode[]> {
  return buildTree(
    this.store.visibleProjects(),
    this.store.visibleSessions(),
    new Set(this.live.keys()),
    (path) => existsSync(path),
  )
}

// searchSessions(query) is unchanged below this — it already exists and is now reachable
// directly over IPC instead of only from inside tree().
```
Remove the now-unused `import { buildTree, filterTree } from './tree/buildTree'` line's `filterTree` half.
- [ ] **Step 8: Wire the new IPC channel and adjust `tree`'s**
```ts
// src/shared/api.ts — inside CHANNELS
tree: 'apiary:tree',
searchContent: 'apiary:search-content',

// inside ApiaryApi
tree(): Promise<ProjectNode[]>
/** Session ids matched by conversation content or notes — only worth calling when either search
 *  setting is on; empty when both are off. */
searchContent(query: string): Promise<string[]>
```
```ts
// src/preload/index.ts
tree: () => ipcRenderer.invoke(CHANNELS.tree),
searchContent: (query: string) => ipcRenderer.invoke(CHANNELS.searchContent, query),
```
```ts
// src/main/ipc.ts
handle(CHANNELS.tree, () => service.tree())
handle(CHANNELS.searchContent, (_e, query: string) => service.searchSessions(query))
```
- [ ] **Step 9: Add the debounce hook**
```ts
// src/renderer/state/useDebouncedValue.ts
import { useEffect, useState } from 'react'

/** Settles on `value` only after it has stopped changing for `delayMs` — the search box's own
 *  state updates every keystroke; this is what decides when a query is worth acting on. */
export function useDebouncedValue<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState(value)
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delayMs)
    return () => clearTimeout(timer)
  }, [value, delayMs])
  return debounced
}
```
- [ ] **Step 10: Add the tree cache hook**
```ts
// src/renderer/state/useSessionTreeCache.ts
import { useCallback, useEffect, useRef, useState } from 'react'
import type { ProjectNode } from '@shared/types'

/** The unfiltered tree, fetched once and refreshed only on the watcher's `onTreeChanged` signal or
 *  an explicit reload — never on a keystroke. Filtering against it happens elsewhere. */
export function useSessionTreeCache(): {
  rawTree: ProjectNode[]
  loading: boolean
  reload: () => void
  reloadNow: () => Promise<ProjectNode[]>
} {
  const [rawTree, setRawTree] = useState<ProjectNode[]>([])
  const [loading, setLoading] = useState(true)
  const latest = useRef(0)

  const reloadNow = useCallback(async (): Promise<ProjectNode[]> => {
    const id = ++latest.current
    setLoading(true)
    const next = await window.apiary.tree()
    if (latest.current === id) { setRawTree(next); setLoading(false) }
    return next
  }, [])

  const reload = useCallback(() => { void reloadNow() }, [reloadNow])
  useEffect(() => { void reloadNow() }, [reloadNow])
  useEffect(() => window.apiary.onTreeChanged(reload), [reload])

  return { rawTree, loading, reload, reloadNow }
}
```
- [ ] **Step 11: Rewrite `useTree` to compose debounce, cache, superseded content search, and local filtering**
```ts
// src/renderer/state/useTree.ts
import { useEffect, useRef, useState } from 'react'
import type { ProjectNode } from '@shared/types'
import { filterTreeLocal, SEARCH_RESULT_CAP } from '@shared/treeFilter'
import { useDebouncedValue } from './useDebouncedValue'
import { useSessionTreeCache } from './useSessionTreeCache'

export function useTree(
  query: string,
  options: { searchChatContent: boolean; searchSessionNotes: boolean },
): {
  tree: ProjectNode[]
  /** Session ids matched by content or a note — Task 9's ranking needs to tell that tier apart
   *  from a title/path/branch match, which `filterTreeLocal` alone cannot. */
  matchedByContent: Set<string>
  totalMatches: number
  capped: boolean
  loading: boolean
  reload: () => void
  reloadNow: () => Promise<ProjectNode[]>
} {
  const { rawTree, loading, reload, reloadNow } = useSessionTreeCache()
  const debouncedQuery = useDebouncedValue(query, 150)
  const [matchedByContent, setMatchedByContent] = useState<Set<string>>(new Set())

  // Superseded rather than awaited: a slow content search for an old query must never land after
  // a fast one for a newer query and put stale ids on screen — the same shape of bug `useTree`'s
  // old `latest` ref existed to prevent for the whole tree.
  const requestId = useRef(0)
  useEffect(() => {
    const id = ++requestId.current
    const trimmed = debouncedQuery.trim()
    if (trimmed === '' || !(options.searchChatContent || options.searchSessionNotes)) {
      setMatchedByContent(new Set())
      return
    }
    void window.apiary.searchContent(trimmed).then((ids) => {
      if (requestId.current === id) setMatchedByContent(new Set(ids))
    })
  }, [debouncedQuery, options.searchChatContent, options.searchSessionNotes])

  const { tree, totalMatches } = filterTreeLocal(rawTree, debouncedQuery, matchedByContent)
  return {
    tree, matchedByContent, totalMatches, capped: totalMatches > SEARCH_RESULT_CAP,
    loading, reload, reloadNow,
  }
}
```
- [ ] **Step 12: Wire the input and the cap note into the sidebar**
In `src/renderer/components/Sidebar.tsx`, replace `const { tree, loading, reload, reloadNow } = useTree(query)` with:
```ts
const { tree, matchedByContent, capped, loading, reload, reloadNow } = useTree(query, {
  searchChatContent, searchSessionNotes,
})
```
adding `searchChatContent: boolean` and `searchSessionNotes: boolean` to `Props`. The `<input>`'s `onChange={(e) => setQuery(e.target.value)}` is unchanged — it already updates local state on every keystroke and was never what was slow. After the existing `{isEmpty && query.trim() !== '' && …}` block, add:
```tsx
{capped && (
  <p className="search-cap-note muted" data-testid="search-cap-note">
    Showing first {SEARCH_RESULT_CAP} results.
  </p>
)}
```
In `src/renderer/App.tsx`, alongside `revealActiveInSidebar`, add:
```ts
const [searchChatContent, setSearchChatContent] = useState(true)
const [searchSessionNotes, setSearchSessionNotes] = useState(true)
```
and inside `loadUiSettings`'s `.then((s) => { … })`, also set them from `s.searchChatContent` / `s.searchSessionNotes`; pass both down as `<Sidebar searchChatContent={searchChatContent} searchSessionNotes={searchSessionNotes} … />`.
- [ ] **Step 13: Fix the one existing test that called the old `tree(query)`**
```ts
// tests/integration/appService.test.ts — replaces the 'filters the tree by query' test
it('tree() returns everything unfiltered; title matching is now the renderer’s job', async () => {
  makeSession(projects(), '-w', {
    sessionId: '11111111-1111-1111-1111-111111111111', cwd: workdir, title: 'Fix CSV export',
  })
  makeSession(projects(), '-w', {
    sessionId: '22222222-2222-2222-2222-222222222222', cwd: workdir, title: 'Bump deps',
  })
  await service.refresh()
  await service.importSessions(
    ['11111111-1111-1111-1111-111111111111', '22222222-2222-2222-2222-222222222222'], [],
  )
  const tree = await service.tree()
  expect(tree[0].sessions.map((s) => s.title).sort()).toEqual(['Bump deps', 'Fix CSV export'])
})
```
- [ ] **Step 14: Run the full unit suite**
Run: `npm test` — confirms `searchLoad.test.ts` passes under budget, `localFilter.test.ts` covers the moved logic and the cap, `buildTree.test.ts` still passes with only `buildTree` left in it, and the updated `appService.test.ts` reflects the new `tree()` arity.
- [ ] **Final step: Commit**
```bash
git add src/shared/fuzzy.ts src/shared/treeFilter.ts src/renderer/state/useDebouncedValue.ts \
  src/renderer/state/useSessionTreeCache.ts src/renderer/state/useTree.ts \
  src/renderer/components/Sidebar.tsx src/renderer/App.tsx src/main/tree/buildTree.ts \
  src/main/appService.ts src/main/ipc.ts src/shared/api.ts src/preload/index.ts \
  tests/unit/localFilter.test.ts tests/unit/searchLoad.test.ts tests/unit/buildTree.test.ts \
  tests/integration/appService.test.ts
git rm src/main/tree/fuzzy.ts tests/unit/fuzzy.test.ts
git commit -m "search: filter locally against a cached tree instead of rebuilding it per keystroke"
```

---

---

### Task 9: Search results are a flat, ranked list

**Files:**
- Create: `src/shared/sessionRank.ts`
- Modify: `src/renderer/components/Sidebar.tsx` (render a flat list while `searching`, restore the tree on clear)
- Modify: `src/renderer/components/SessionRow.tsx` (an optional subtitle line)
- Modify: `src/renderer/styles.css` (subtitle rule, token-only)
- Test: `tests/unit/sessionRank.test.ts`
- Test: Modify `tests/e2e/search.spec.ts` (flat results while searching; tree restoration after clearing)

**Interfaces:**
- Consumes: `useTree`'s return value from Task 8 — specifically `tree: ProjectNode[]` (already filtered and capped at 200) and `matchedByContent: Set<string>`, both produced by that task's `src/renderer/state/useTree.ts`. Also `fuzzyScore` from `src/shared/fuzzy.ts` (Task 8).
- Produces: `rankSessions(tree: ProjectNode[], query: string, matchedByContent: Set<string>): RankedSession[]` and `export interface RankedSession { session: SessionNode; worktreeLabel: string; tier: 0 | 1 | 2 | 3 | 4 }` in `src/shared/sessionRank.ts` — `0` = exact title, `1` = title prefix, `2` = title subsequence, `3` = path/branch, `4` = content/note.

- [ ] **Step 1: Write the failing test for the ranking comparator**
```ts
// tests/unit/sessionRank.test.ts
import { describe, it, expect } from 'vitest'
import { rankSessions } from '../../src/shared/sessionRank'
import type { ProjectNode, SessionNode } from '../../src/shared/types'

const session = (over: Partial<SessionNode>): SessionNode => ({
  kind: 'session', sessionId: over.sessionId ?? 's', title: 'untitled', cwd: '/p',
  gitBranch: null, lastActiveAtMs: 0, messageCount: null, isLive: false, cwdExists: true,
  note: null, ...over,
})

const project = (sessions: SessionNode[], over: Partial<ProjectNode> = {}): ProjectNode => ({
  kind: 'project', path: '/p', label: 'repo', branch: 'main', isWorktree: false,
  children: [], sessions, ...over,
})

describe('rankSessions', () => {
  it('ranks an exact title match above a mere prefix, which ranks above a subsequence', () => {
    const tree = [project([
      session({ sessionId: 'sub', title: 'refactor csv export logic' }),
      session({ sessionId: 'prefix', title: 'csv something else' }),
      session({ sessionId: 'exact', title: 'csv' }),
    ])]
    const ranked = rankSessions(tree, 'csv', new Set())
    expect(ranked.map((r) => r.session.sessionId)).toEqual(['exact', 'prefix', 'sub'])
  })

  it('ranks a path/branch match below a title match but above a content-only match', () => {
    const tree = [project(
      [
        session({ sessionId: 'content-only', title: 'unrelated' }),
        session({ sessionId: 'by-path', title: 'also unrelated', cwd: '/p/csv-tool' }),
      ],
      { path: '/p/csv-tool' },
    )]
    const ranked = rankSessions(tree, 'csv', new Set(['content-only']))
    expect(ranked.map((r) => r.session.sessionId)).toEqual(['by-path', 'content-only'])
  })

  it('breaks ties within a tier by lastActiveAtMs descending', () => {
    const tree = [project([
      session({ sessionId: 'older', title: 'csv one', lastActiveAtMs: 1 }),
      session({ sessionId: 'newer', title: 'csv two', lastActiveAtMs: 2 }),
    ])]
    expect(rankSessions(tree, 'csv', new Set()).map((r) => r.session.sessionId))
      .toEqual(['newer', 'older'])
  })

  it('carries the session’s worktree label for the subtitle', () => {
    const tree = [project([session({ title: 'csv' })], { label: 'my-worktree' })]
    expect(rankSessions(tree, 'csv', new Set())[0].worktreeLabel).toBe('my-worktree')
  })
})
```
- [ ] **Step 2: Run the test and watch it fail**
Run: `npm test -- tests/unit/sessionRank.test.ts` (expected failure: `Cannot find module '../../src/shared/sessionRank'`)
- [ ] **Step 3: Implement the ranking comparator**
```ts
// src/shared/sessionRank.ts
import type { ProjectNode, SessionNode } from './types'
import { fuzzyScore } from './fuzzy'

export type MatchTier = 0 | 1 | 2 | 3 | 4

export interface RankedSession {
  session: SessionNode
  /** The folder the session's worktree/project node is labelled with — the row's subtitle. */
  worktreeLabel: string
  tier: MatchTier
}

function tierFor(
  query: string,
  session: SessionNode,
  folderLabel: string,
  folderPath: string,
  folderBranch: string | null,
  matchedByContent: Set<string>,
): MatchTier | null {
  const q = query.trim().toLowerCase()
  if (q === '') return null
  const title = session.title.toLowerCase()
  if (title === q) return 0
  if (title.startsWith(q)) return 1
  if (fuzzyScore(query, session.title) !== null) return 2
  if (
    fuzzyScore(query, session.cwd) !== null ||
    fuzzyScore(query, folderLabel) !== null ||
    fuzzyScore(query, folderPath) !== null ||
    (folderBranch !== null && fuzzyScore(query, folderBranch) !== null)
  ) return 3
  if (matchedByContent.has(session.sessionId)) return 4
  return null
}

/**
 * Flattens the (already filtered and capped, per Task 8's `filterTreeLocal`) tree into one ranked
 * list: exact title, then prefix, then subsequence, then path/branch, then content — ties broken
 * by recency. Every session here already matched *something*, so a `null` tier here would mean
 * `filterTreeLocal` and this function have disagreed about what matches, which is a bug in one of
 * them rather than something to filter out quietly.
 */
export function rankSessions(
  tree: ProjectNode[],
  query: string,
  matchedByContent: Set<string>,
): RankedSession[] {
  const out: RankedSession[] = []
  const walk = (nodes: ProjectNode[]): void => {
    for (const node of nodes) {
      for (const session of node.sessions) {
        const tier = tierFor(query, session, node.label, node.path, node.branch, matchedByContent)
        if (tier !== null) out.push({ session, worktreeLabel: node.label, tier })
      }
      walk(node.children)
    }
  }
  walk(tree)
  return out.sort((a, b) => (
    a.tier - b.tier || (b.session.lastActiveAtMs ?? 0) - (a.session.lastActiveAtMs ?? 0)
  ))
}
```
- [ ] **Step 4: Give `SessionRow` an optional subtitle**
```ts
// src/renderer/components/SessionRow.tsx — add to Props
/** Shown under the title instead of the row's usual folder-branch tooltip context — the flat
 *  search list's way of saying which worktree a result lives in, since there is no folder header
 *  above it to say so. */
subtitle?: string | null
```
Inside the `<button className="session-row" …>`, right after `<span className="session-title">{session.title}</span>`:
```tsx
{subtitle != null && <span className="session-subtitle" data-testid="session-subtitle">{subtitle}</span>}
```
and add `subtitle` to the destructured props list.
- [ ] **Step 5: Add the token-only subtitle rule**
```css
/* src/renderer/styles.css — beside .session-title */
.session-subtitle { color: var(--muted); }
```
- [ ] **Step 6: Render the flat list while searching, and restore the tree on clear**
In `src/renderer/components/Sidebar.tsx`, replace the line `{tree.length > 0 && searching && <SessionTree nodes={tree} {...treeProps} />}` with:
```tsx
{tree.length > 0 && searching && (
  <ul className="tree flat-results" data-testid="flat-results">
    {rankSessions(tree, query, matchedByContent).map(({ session, worktreeLabel }) => (
      <li key={session.sessionId}>
        <SessionRow
          session={session}
          selected={session.sessionId === selectedId}
          pinned={pinnedSet.has(session.sessionId)}
          onSelect={onSelect}
          onSplit={onSplitSession}
          onDelete={onDeleteSession}
          onTogglePin={onTogglePin}
          onEditNote={onEditNote}
          onMenu={(node, x, y) => setMenu({ kind: 'session', id: node.sessionId, x, y })}
          subtitle={worktreeLabel}
        />
      </li>
    ))}
  </ul>
)}
```
adding `import { rankSessions } from '@shared/sessionRank'` at the top. Nothing about `collapsed` changes here — `collapsed` is untouched state throughout a search, so when `searching` goes back to `false` (the box is cleared), the `!searching` branch below renders with whatever `collapsed` already held, which is exactly "restores the tree with its previous collapse state intact": collapse state was never consulted or mutated while flat results were on screen.
- [ ] **Step 7: Run the unit suite**
Run: `npm test -- tests/unit/sessionRank.test.ts` (now passing), then `npm test` for the whole suite.
- [ ] **Step 8: Extend the e2e coverage**
```ts
// tests/e2e/search.spec.ts — appended
test('search renders a flat list, and clearing it restores the tree with its collapse state', async () => {
  // A folder collapsed before searching must still be collapsed after — proof the tree was never
  // torn down and rebuilt underneath the search, only hidden behind the flat list.
  await h.page.locator('[data-testid="project-toggle"]').first().click()
  const wasCollapsed = await h.page.locator('[data-testid="project-toggle"]').first()
    .getAttribute('aria-expanded')
  expect(wasCollapsed).toBe('false')

  await search(h).fill('csv')
  await expect(h.page.getByTestId('flat-results')).toBeVisible()
  // No folder chrome at all while a flat list is on screen.
  await expect(h.page.getByTestId('project-toggle')).toHaveCount(0)
  await expect(h.page.getByTestId('session-subtitle').first()).toBeVisible()

  await h.page.getByTestId('search-clear').click()
  await expect(h.page.getByTestId('flat-results')).toHaveCount(0)
  await expect(h.page.locator('[data-testid="project-toggle"]').first())
    .toHaveAttribute('aria-expanded', 'false')
})
```
- [ ] **Final step: Commit**
```bash
git add src/shared/sessionRank.ts src/renderer/components/Sidebar.tsx \
  src/renderer/components/SessionRow.tsx src/renderer/styles.css \
  tests/unit/sessionRank.test.ts tests/e2e/search.spec.ts
git commit -m "search: show a flat ranked list of results instead of a pruned tree"
```

---

---

### Task 10: Drag a session onto another worktree to move it

**Verified encoding.** A real entry under `~/.claude/projects` confirms the rule: the session at
`/Users/nuwan/projects/paratoo-fdcp.worktrees/1.0.11` is stored under the directory
`-Users-nuwan-projects-paratoo-fdcp-worktrees-1-0-11` — every `/` **and every `.`** in the cwd
becomes `-`; nothing else changes (a literal `-` already in a path name is left alone, which is
exactly the lossy collision `CLAUDE.md` warns the encoding can produce). A second real example,
`/private/tmp/claude-501/-Users-nuwan-projects-pet-projects/…`, confirms it: the pre-existing
literal dashes inside that path are carried through unchanged, and only its own `/`/`.` characters
turn into new ones. So the encoding is `cwd.replace(/[/.]/g, '-')`.

**Files:**
- Create: `src/main/scanner/projectDirName.ts`
- Create: `src/renderer/components/MoveSessionDialog.tsx`
- Modify: `src/main/store/schema.ts:13-29` (add `cwd_override` column)
- Modify: `src/main/store/sessionStore.ts` (migration, `toSession`'s cwd merge, `recordSessionMove`)
- Modify: `src/main/appService.ts` (new `moveSession` method)
- Modify: `src/shared/api.ts` / `src/preload/index.ts` / `src/main/ipc.ts` (new `moveSession` channel)
- Modify: `src/renderer/components/SessionRow.tsx` (draggable)
- Modify: `src/renderer/components/SessionTree.tsx` (accept a session drop on a folder row; drop highlight)
- Modify: `src/renderer/components/Sidebar.tsx` (wire the drop to open the confirmation)
- Modify: `src/renderer/App.tsx` (own the dialog's open/confirm/cancel state, like `deleteTarget`)
- Modify: `src/renderer/styles.css` (drop-highlight rule, token-only)
- Test: `tests/unit/projectDirName.test.ts`
- Test: Modify `tests/integration/appService.test.ts` (append `moveSession` cases)
- Test: `tests/e2e/moveSession.spec.ts`

**Interfaces:**
- Consumes: `resolveProject(path: string): Promise<ProjectInfo>` (existing, `src/main/git/worktreeResolver.ts`); `SessionStore.getProject(path: string): StoredProject | null` (existing — the same renderer-path-is-untrusted-until-matched check `newSessionInProject` already uses); `SessionStore.syncProject(info: ProjectInfo): void` (existing); `AppService.requireSession(sessionId: string): StoredSession` (existing, private); `projectsDir(configRoot: string): string` (existing, `src/main/config.ts`).
- Produces: `encodeProjectDirName(cwd: string): string` in `src/main/scanner/projectDirName.ts`; `SessionStore.recordSessionMove(sessionId: string, projectPath: string, cwd: string, filePath: string): void`; `AppService.moveSession(sessionId: string, targetProjectPath: string): Promise<void>`; IPC channel `apiary:move-session` / `window.apiary.moveSession(sessionId: string, targetProjectPath: string): Promise<void>`.

- [ ] **Step 1: Write the failing encoding test**
```ts
// tests/unit/projectDirName.test.ts
import { describe, it, expect } from 'vitest'
import { encodeProjectDirName } from '../../src/main/scanner/projectDirName'

describe('encodeProjectDirName', () => {
  it('matches the real directory Claude Code created for this exact cwd', () => {
    // Verified against a live ~/.claude/projects entry: both '/' and '.' become '-'.
    expect(encodeProjectDirName('/Users/nuwan/projects/paratoo-fdcp.worktrees/1.0.11'))
      .toBe('-Users-nuwan-projects-paratoo-fdcp-worktrees-1-0-11')
  })

  it('leaves a literal dash in a path segment untouched', () => {
    expect(encodeProjectDirName('/Users/nuwan/projects/pet-projects/apiary'))
      .toBe('-Users-nuwan-projects-pet-projects-apiary')
  })
})
```
- [ ] **Step 2: Run the test and watch it fail**
Run: `npm test -- tests/unit/projectDirName.test.ts` (expected failure: `Cannot find module '../../src/main/scanner/projectDirName'`)
- [ ] **Step 3: Implement the encoding**
```ts
// src/main/scanner/projectDirName.ts

/**
 * The directory name Claude Code itself gives a cwd under ~/.claude/projects — every `/` and `.`
 * becomes `-`, verified against a live installation rather than assumed. It is lossy (a literal
 * `-` already in a path segment is indistinguishable from an encoded separator), which is exactly
 * why `CLAUDE.md` insists a session's cwd is read from inside its JSONL and never decoded back out
 * of this. This function only ever runs the encoding forwards, to find where Claude Code would
 * put a transcript for a cwd Apiary already resolved itself.
 */
export function encodeProjectDirName(cwd: string): string {
  return cwd.replace(/[/.]/g, '-')
}
```
- [ ] **Step 4: Add the `cwd_override` column**
```ts
// src/main/store/schema.ts — inside the session table, alongside custom_title and note
CREATE TABLE IF NOT EXISTS session (
  session_id       TEXT PRIMARY KEY,
  project_path     TEXT NOT NULL REFERENCES project(path),
  title            TEXT,
  custom_title     TEXT,
  note             TEXT,
  cwd_override     TEXT,
  first_prompt     TEXT,
  cwd              TEXT,
  ...
```
```ts
// src/main/store/sessionStore.ts — migrate()
if (!columns.some((c) => c.name === 'cwd_override')) {
  this.db.exec('ALTER TABLE session ADD COLUMN cwd_override TEXT')
}
```
(`schema.ts`'s `CREATE TABLE IF NOT EXISTS` only shapes a brand-new database, per the comment already on `migrate()` — an existing database needs this explicit `ALTER TABLE`, same as `custom_title` and `note` before it.)
- [ ] **Step 5: Merge the override into the effective cwd, and add the write path**
```ts
// src/main/store/sessionStore.ts — SessionRow gains cwd_override; toSession() becomes:
const toSession = (r: SessionRow): StoredSession => ({
  sessionId: r.session_id,
  projectPath: r.project_path,
  title: r.custom_title ?? r.title,
  firstPrompt: r.first_prompt,
  // A move's own record always wins over whatever the scanner most recently read out of the
  // transcript — the transcript's own recorded cwd never changes (the JSONL isn't rewritten), so
  // without this the very next rescan would put the session back where it started.
  cwd: r.cwd_override ?? r.cwd,
  gitBranch: r.git_branch,
  ...
})
```
```ts
// src/main/store/sessionStore.ts — new method, alongside setNote/setCustomTitle
/**
 * Records that a session's transcript now lives under a different project. `cwd_override` and
 * `project_path` are never written by `syncSessions` (see its column list), so a rescan — which
 * reads the *stale* cwd still recorded inside the moved JSONL — cannot undo this. `file_path` is
 * set here too, immediately, rather than waiting for the rescan the caller will also trigger, so
 * the session is resumable the instant this returns.
 */
recordSessionMove(sessionId: string, projectPath: string, cwd: string, filePath: string): void {
  this.db.prepare(
    'UPDATE session SET project_path = ?, cwd_override = ?, file_path = ? WHERE session_id = ?',
  ).run(projectPath, cwd, filePath, sessionId)
}
```
- [ ] **Step 6: Implement `AppService.moveSession`**
```ts
// src/main/appService.ts — new import: import { rename } from 'node:fs/promises' (mkdir already
// imported); import { encodeProjectDirName } from './scanner/projectDirName'
/**
 * Moves a session's transcript into another worktree's Claude projects directory and points the
 * store at it from then on. Refused outright while the session is live: a running pty cannot be
 * asked to change the directory a whole process tree is rooted in.
 */
async moveSession(sessionId: string, targetProjectPath: string): Promise<void> {
  const session = this.requireSession(sessionId)
  if (this.live.has(sessionId)) {
    throw new Error('This session is still running — stop it before moving it to another worktree.')
  }
  if (!existsSync(session.filePath)) {
    throw new Error(`This session's transcript file is no longer on disk: ${session.filePath}`)
  }
  // The renderer only ever hands back a path it was shown in the tree (a project row's own
  // path), but it is still checked against a row this store already holds before it is used to
  // touch the filesystem — the same rule newSessionInProject follows for the same reason.
  const known = this.store.getProject(targetProjectPath)
  if (!known) throw new Error(`Unknown project: ${targetProjectPath}`)
  const target = await resolveProject(known.path)

  const targetDir = join(projectsDir(this.options.configRoot), encodeProjectDirName(target.path))
  const targetFile = join(targetDir, `${sessionId}.jsonl`)
  if (existsSync(targetFile)) {
    throw new Error(`A session already exists there: ${targetFile}`)
  }

  await mkdir(targetDir, { recursive: true })
  await rename(session.filePath, targetFile)

  this.store.syncProject(target)
  this.store.recordSessionMove(sessionId, target.path, target.path, targetFile)
}
```
- [ ] **Step 7: Wire the IPC channel**
```ts
// src/shared/api.ts
moveSession: 'apiary:move-session',
// ApiaryApi:
/** Moves a session's transcript to another worktree. Rejects while it is live, if the target
 *  file already exists, or if `targetProjectPath` is not a project the store already knows. */
moveSession(sessionId: string, targetProjectPath: string): Promise<void>
```
```ts
// src/preload/index.ts
moveSession: (id, path) => ipcRenderer.invoke(CHANNELS.moveSession, id, path),
```
```ts
// src/main/ipc.ts — beside removeSession
handle(CHANNELS.moveSession, async (_e, id: string, targetPath: string) => {
  await service.moveSession(id, targetPath)
  // Same signal a rename or an archive sends: the sidebar re-reads the (unfiltered, cached)
  // tree, which now shows the session under its new project instead of the old one.
  await service.refresh()
  send(CHANNELS.treeChanged)
})
```
- [ ] **Step 8: Write the store/service tests**
```ts
// tests/integration/appService.test.ts — appended, using the harness already declared at the top
describe('moveSession', () => {
  it('moves the transcript file and the session follows it, surviving a rescan', async () => {
    const target = makeGitWorkdir()
    makeSession(projects(), '-w', {
      sessionId: '33333333-3333-3333-3333-333333333333', cwd: workdir, title: 'Move me',
    })
    await service.refresh()
    await service.importSessions(['33333333-3333-3333-3333-333333333333'], [])
    // The target has to already be a project the store knows about — discovered by scanning,
    // same as any other folder — before it can be a move's destination.
    await service.newSessionInFolder(target).catch(() => {}) // registers the project row
    await service.refresh()

    await service.moveSession('33333333-3333-3333-3333-333333333333', target)
    let tree = await service.tree()
    let moved = tree.flatMap((p) => p.sessions).find((s) => s.sessionId === '33333333-3333-3333-3333-333333333333')
    expect(moved?.cwd).toBe(target)

    // A rescan reads the *old* cwd back out of the (unmoved-in-content) JSONL — the override
    // is what stops that reverting the move.
    await service.refresh()
    tree = await service.tree()
    moved = tree.flatMap((p) => p.sessions).find((s) => s.sessionId === '33333333-3333-3333-3333-333333333333')
    expect(moved?.cwd).toBe(target)
  })

  it('refuses when a session of that id already exists at the target', async () => {
    const target = makeGitWorkdir()
    makeSession(projects(), '-w', {
      sessionId: '44444444-4444-4444-4444-444444444444', cwd: workdir, title: 'Original',
    })
    await service.refresh()
    await service.importSessions(['44444444-4444-4444-4444-444444444444'], [])
    await service.newSessionInFolder(target).catch(() => {})
    await service.refresh()
    // A file already sitting where the move would land.
    mkdirSync(join(projects(), encodeProjectDirNameForTest(target)), { recursive: true })
    writeFileSync(join(projects(), encodeProjectDirNameForTest(target), '44444444-4444-4444-4444-444444444444.jsonl'), '')

    await expect(service.moveSession('44444444-4444-4444-4444-444444444444', target))
      .rejects.toThrow('already exists')
  })

  it('refuses to move a live session', async () => {
    const target = makeGitWorkdir()
    const liveService = new AppService({
      configRoot: join(home, '.claude'), dbPath: join(home, 'apiary-live.db'),
      detectLive: async () => new Map([['55555555-5555-5555-5555-555555555555', 1234]]),
    })
    makeSession(projects(), '-w', {
      sessionId: '55555555-5555-5555-5555-555555555555', cwd: workdir, title: 'Live one',
    })
    await liveService.refresh()
    await liveService.importSessions(['55555555-5555-5555-5555-555555555555'], [])
    await liveService.newSessionInFolder(target).catch(() => {})
    await liveService.refresh()
    await expect(liveService.moveSession('55555555-5555-5555-5555-555555555555', target))
      .rejects.toThrow('still running')
    await liveService.dispose()
  })
})
```
(`encodeProjectDirNameForTest` is `import { encodeProjectDirName as encodeProjectDirNameForTest } from '../../src/main/scanner/projectDirName'` at the top of the file, so the collision test builds the exact path the implementation would.)
- [ ] **Step 9: Run the tests**
Run: `npm test -- tests/unit/projectDirName.test.ts tests/integration/appService.test.ts`
- [ ] **Step 10: Make a session row draggable**
```tsx
// src/renderer/components/SessionRow.tsx — on the outer <div className="session-row-wrap" …>
draggable
onDragStart={(e) => {
  e.dataTransfer.effectAllowed = 'move'
  e.dataTransfer.setData('application/x-apiary-session', session.sessionId)
}}
```
- [ ] **Step 11: Accept the drop on a folder row, with a highlight**
```tsx
// src/renderer/components/SessionTree.tsx — FolderHeader gains a prop and drop handling
onSessionDrop?: (sessionId: string, folderPath: string) => void
```
Add local state `const [sessionOver, setSessionOver] = useState(false)` inside `FolderHeader`, and extend the wrapping `<div className="project-row-wrap" … data-drop-target={sessionOver}>`'s existing `onDragOver`/`onDrop`/add `onDragLeave`:
```tsx
onDragOver={(e) => {
  if (rearrangeable && e.dataTransfer.types.includes('application/x-apiary-folder')) {
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
    return
  }
  if (onSessionDrop !== undefined && e.dataTransfer.types.includes('application/x-apiary-session')) {
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
    setSessionOver(true)
  }
}}
onDragLeave={() => setSessionOver(false)}
onDrop={(e) => {
  if (onSessionDrop !== undefined && e.dataTransfer.types.includes('application/x-apiary-session')) {
    setSessionOver(false)
    const sessionId = e.dataTransfer.getData('application/x-apiary-session')
    if (sessionId !== '') { e.preventDefault(); onSessionDrop(sessionId, node.path) }
    return
  }
  // ...existing folder-reorder onDrop body unchanged, reached only when the dragged type isn't a session
}}
```
Thread `onSessionDrop` through `SessionTree`'s `Props` and its recursive call, the same way `onReorderFolder` already is.
- [ ] **Step 12: Add the drop-highlight rule**
```css
/* src/renderer/styles.css — beside .folder-group[data-drop-into="true"] */
.project-row-wrap[data-drop-target="true"] { box-shadow: inset var(--focus-ring); }
```
- [ ] **Step 13: Add the confirmation dialog**
```tsx
// src/renderer/components/MoveSessionDialog.tsx
interface Props {
  sessionTitle: string
  fromPath: string
  toPath: string
  onCancel: () => void
  onConfirm: () => void
}

export function MoveSessionDialog({ sessionTitle, fromPath, toPath, onCancel, onConfirm }: Props): JSX.Element {
  return (
    <div className="modal-backdrop">
      <div className="modal" data-testid="move-session-dialog" role="dialog" aria-modal="true">
        <h2>Move this session?</h2>
        <p>
          <strong>{sessionTitle}</strong> will move from
          <br /><code>{fromPath}</code>
          <br />to
          <br /><code>{toPath}</code>
        </p>
        <div className="modal-actions">
          <button data-testid="move-session-cancel" onClick={onCancel}>Cancel</button>
          <button className="primary" data-testid="move-session-confirm" onClick={onConfirm}>Move</button>
        </div>
      </div>
    </div>
  )
}
```
- [ ] **Step 14: Wire the drop through to the dialog**
In `src/renderer/components/Sidebar.tsx`'s `treeProps`, add `onSessionDrop: (sessionId, folderPath) => onSessionDropped(sessionId, folderPath)`, taking a new `onSessionDropped: (sessionId: string, folderPath: string) => void` prop. In `src/renderer/App.tsx`, alongside `deleteTarget`:
```ts
const [moveTarget, setMoveTarget] = useState<{ session: SessionNode; toPath: string } | null>(null)
```
passed to `Sidebar` as `onSessionDropped={(sessionId, toPath) => {
  const session = flattenSessionsForMove.get(sessionId) // however App already resolves a session id to a SessionNode elsewhere (mirrors onSelect's lookup)
  if (session !== undefined) setMoveTarget({ session, toPath })
}}`, and rendered beside `{deleteTarget !== null && …}`:
```tsx
{moveTarget !== null && (
  <MoveSessionDialog
    sessionTitle={moveTarget.session.title}
    fromPath={moveTarget.session.cwd}
    toPath={moveTarget.toPath}
    onCancel={() => setMoveTarget(null)}
    onConfirm={() => {
      const { session, toPath } = moveTarget
      setMoveTarget(null)
      void window.apiary.moveSession(session.sessionId, toPath).catch((e: unknown) => notifyError(e, 'Could not move session'))
    }}
  />
)}
```
- [ ] **Step 15: Run typecheck and the unit/integration suites**
Run: `npm run typecheck && npm test`
- [ ] **Step 16: Add the e2e coverage**
```ts
// tests/e2e/moveSession.spec.ts
import { test, expect } from '@playwright/test'
import { launchApiary, importAll, type Harness } from './helpers'

let h: Harness
test.beforeEach(async () => {
  h = await launchApiary({ secondWorktree: true })
  await importAll(h.page)
  await h.page.getByTestId('sidebar-refresh').click()
})
test.afterEach(async () => { await h.close() })

test('dragging a session onto another worktree moves it there', async () => {
  const session = h.page.getByTestId('session-item').first()
  const title = await session.locator('.session-title').innerText()

  const targetFolder = h.page.locator(
    'div.project-row-wrap:has(> button[data-testid="project-toggle"] .project-label:text-is("repo-c-wt2"))',
  )
  await session.locator('..').dragTo(targetFolder)

  await expect(h.page.getByTestId('move-session-dialog')).toBeVisible()
  await expect(h.page.getByTestId('move-session-dialog')).toContainText(title)
  await h.page.getByTestId('move-session-confirm').click()

  await expect(h.page.getByTestId('move-session-dialog')).toHaveCount(0)
  await targetFolder.locator('..').getByTestId('project-toggle').click({ trial: true }).catch(() => {})
  await expect(targetFolder.locator('xpath=following-sibling::*[1]').getByText(title)).toBeVisible()

  // Still opens after the move.
  await h.page.getByText(title).first().click()
  await expect(h.page.getByTestId('terminal-view').or(h.page.getByTestId('transcript-view'))).toBeVisible()
})

test('a live session refuses to be dropped', async () => {
  const session = h.page.getByTestId('session-item').first()
  await session.click()
  await h.page.getByTestId('open-terminal-button').click().catch(() => {})
  // Whatever starts the pty for the currently selected session in this suite's existing
  // convention (see terminal.spec.ts) — the point under test is only that a live one refuses.
  const targetFolder = h.page.locator(
    'div.project-row-wrap:has(> button[data-testid="project-toggle"] .project-label:text-is("repo-c-wt2"))',
  )
  await session.locator('..').dragTo(targetFolder)
  await h.page.getByTestId('move-session-confirm').click()
  await expect(h.page.getByText(/still running/i)).toBeVisible()
})
```
- [ ] **Final step: Commit**
```bash
git add src/main/scanner/projectDirName.ts src/main/store/schema.ts src/main/store/sessionStore.ts \
  src/main/appService.ts src/main/ipc.ts src/shared/api.ts src/preload/index.ts \
  src/renderer/components/MoveSessionDialog.tsx src/renderer/components/SessionRow.tsx \
  src/renderer/components/SessionTree.tsx src/renderer/components/Sidebar.tsx \
  src/renderer/App.tsx src/renderer/styles.css \
  tests/unit/projectDirName.test.ts tests/integration/appService.test.ts tests/e2e/moveSession.spec.ts
git commit -m "sidebar: drag a session onto another worktree to move it there"
```

---

### Task 11: Branch switcher checks out an exact match on Enter

**Files:**
- Create: `src/renderer/state/branchSelection.ts`
- Create: `tests/unit/branchSelection.test.ts`
- Modify: `src/renderer/components/BranchSwitcher.tsx:1-2,82-90,219-233,279-304`
- Modify: `src/renderer/styles.css:1184` (add one rule beside `.branch-switcher-row:hover`)
- Modify: `tests/e2e/gitToolbar.spec.ts`

**Interfaces:**
- Consumes: `GitRefEntry`, `GitRefs` (existing, `src/shared/types.ts`); `BranchSwitcher`'s existing `pickRef(name: string, kind: 'local' | 'remote' | 'tag'): void` (existing, local to the component — the new wiring calls it directly rather than duplicating its dispatch).
- Produces: `export interface RefMatch { entry: GitRefEntry; kind: 'local' | 'remote' }` and `export function exactRefMatch(refs: Pick<GitRefs, 'local' | 'remote'>, query: string): RefMatch | null` (new, `src/renderer/state/branchSelection.ts`).

- [ ] **Step 1: Write the failing unit test for the selection rule**

```ts
// tests/unit/branchSelection.test.ts
import { describe, it, expect } from 'vitest'
import { exactRefMatch } from '../../src/renderer/state/branchSelection'
import type { GitRefEntry } from '@shared/types'

const ref = (name: string): GitRefEntry => ({ name, relativeDate: '2h ago', author: 'a', shortSha: 'abc123', subject: 's' })

describe('exactRefMatch', () => {
  it('is null for an empty query, and for a query that only narrows the list', () => {
    const refs = { local: [ref('feature/one')], remote: [] }
    expect(exactRefMatch(refs, '')).toBeNull()
    expect(exactRefMatch(refs, 'feature')).toBeNull()
  })

  it('matches a local branch exactly', () => {
    const refs = { local: [ref('main'), ref('feature/one')], remote: [] }
    expect(exactRefMatch(refs, 'feature/one')).toEqual({ entry: ref('feature/one'), kind: 'local' })
  })

  it('is case-sensitive, as git branch names are', () => {
    const refs = { local: [ref('Main')], remote: [] }
    expect(exactRefMatch(refs, 'main')).toBeNull()
  })

  it('prefers a local branch over a remote one of the same name', () => {
    const refs = { local: [ref('main')], remote: [ref('origin/main')] }
    // The remote entry's name already carries the "origin/" prefix, so this is really testing
    // that an exact match on "main" never falls through to a remote ref that merely contains it.
    expect(exactRefMatch(refs, 'main')).toEqual({ entry: ref('main'), kind: 'local' })
  })

  it('matches a remote branch exactly when there is no local one', () => {
    const refs = { local: [ref('main')], remote: [ref('origin/feature/two')] }
    expect(exactRefMatch(refs, 'origin/feature/two')).toEqual({ entry: ref('origin/feature/two'), kind: 'remote' })
  })

  it('a longer name that merely starts with the query is not a match', () => {
    const refs = { local: [ref('feature/one'), ref('feature/one-extended')], remote: [] }
    expect(exactRefMatch(refs, 'feature/one')?.entry.name).toBe('feature/one')
  })
})
```

- [ ] **Step 2: Run the test and watch it fail**
Run: `npm test -- branchSelection` — expected failure: `Cannot find module '../../src/renderer/state/branchSelection'`.

- [ ] **Step 3: Write the pure selection function**

```ts
// src/renderer/state/branchSelection.ts
import type { GitRefEntry, GitRefs } from '@shared/types'

/** What Enter would check out right now, if the switcher's search box holds a real answer. */
export interface RefMatch {
  entry: GitRefEntry
  kind: 'local' | 'remote'
}

/**
 * The ref an exact, case-sensitive match on the typed query names — or null.
 *
 * Only an exact match counts: a query that merely narrows the filtered list (a prefix or a
 * substring) is not a choice, so Enter must do nothing rather than guess which of several rows
 * was meant. Case-sensitive because git branch names are. Local wins over a remote branch of the
 * same name, since checking out a name that already exists locally must never quietly create a
 * tracking branch instead.
 */
export function exactRefMatch(refs: Pick<GitRefs, 'local' | 'remote'>, query: string): RefMatch | null {
  if (query === '') return null
  const local = refs.local.find((r) => r.name === query)
  if (local !== undefined) return { entry: local, kind: 'local' }
  const remote = refs.remote.find((r) => r.name === query)
  if (remote !== undefined) return { entry: remote, kind: 'remote' }
  return null
}
```

- [ ] **Step 4: Run the test and confirm it passes**
Run: `npm test -- branchSelection`

- [ ] **Step 5: Wire Enter to the exact match, and mark its row**

```tsx
// src/renderer/components/BranchSwitcher.tsx — add the import at the top
import { exactRefMatch } from '../state/branchSelection'
```

```tsx
// after `const filtered = useMemo(...)`, compute the active choice from the raw (case-sensitive)
// query rather than the lowercased one `filtered` uses for narrowing
  const trimmedQuery = query.trim()
  const activeMatch = mode === 'checkout' && !pickingBaseNow(step)
    ? exactRefMatch(refs ?? { local: [], remote: [] }, trimmedQuery)
    : null
```

Since `pickingBase`/`showActions` are computed further down in the current file (after the early `if (step.kind === 'name')` return), move that one small helper above the early return so both places can use it:

```tsx
// replace the existing single-use inline checks with a named helper, defined once near the top
// of the component body (after `const [errorMessage, ...] = useState(...)`)
  const pickingBaseNow = (s: Step): boolean => s.kind === 'pick-base' || s.kind === 'pick-detached'
```

```tsx
// the search <input> in the main list view gains onKeyDown
        <input
          className="search"
          data-testid="branch-switcher-search"
          placeholder={placeholder}
          autoFocus
          value={query}
          onChange={(e) => { setQuery(e.target.value); setErrorMessage(null) }}
          onKeyDown={(e) => {
            if (e.key !== 'Enter' || activeMatch === null) return
            pickRef(activeMatch.entry.name, activeMatch.kind)
          }}
        />
```

```tsx
// BranchSection gains an activeName prop so its row can carry data-active
function BranchSection(
  { title, testId, rows, onPick, busy, activeName }:
  {
    title: string; testId: string; rows: GitRefEntry[]; onPick: (r: GitRefEntry) => void
    busy: boolean; activeName: string | null
  },
): JSX.Element | null {
  if (rows.length === 0) return null
  return (
    <>
      <li className="branch-switcher-section-label">{title}</li>
      {rows.map((r) => (
        <li key={r.name}>
          <button
            className="branch-switcher-row"
            data-testid={testId}
            data-active={r.name === activeName}
            disabled={busy}
            onClick={() => onPick(r)}
          >
            <span className="branch-switcher-row-name">{r.name}</span>
            <span className="branch-switcher-row-meta">
              {r.relativeDate} &middot; {r.author} &middot; {r.shortSha} &middot; {r.subject}
            </span>
          </button>
        </li>
      ))}
    </>
  )
}
```

```tsx
// and the three call sites pass it through
              <BranchSection
                title="branches" testId="branch-switcher-branch-row" rows={filtered.local} busy={busy}
                activeName={activeMatch?.kind === 'local' ? activeMatch.entry.name : null}
                onPick={(r) => pickRef(r.name, 'local')}
              />
              <BranchSection
                title="remote branches" testId="branch-switcher-remote-row" rows={filtered.remote} busy={busy}
                activeName={activeMatch?.kind === 'remote' ? activeMatch.entry.name : null}
                onPick={(r) => pickRef(r.name, 'remote')}
              />
              <BranchSection
                title="tags" testId="branch-switcher-tag-row" rows={filtered.tags} busy={busy}
                activeName={null}
                onPick={(r) => pickRef(r.name, 'tag')}
              />
```

- [ ] **Step 6: Mark the active row with an existing token**

```css
/* src/renderer/styles.css — add directly after the existing rule at line 1184 */
.branch-switcher-row:hover { background: var(--selected); }
.branch-switcher-row[data-active="true"] { background: var(--selected); }
```

This reuses the `--selected` token already declared in the root token block (`src/renderer/styles.css:31`) — the same one `.session-tab[data-active="true"]` and `.toolbar-button[data-active="true"]` already use for "this is the one a keypress would act on." No new token is introduced.

- [ ] **Step 7: Write the failing e2e test**

```ts
// tests/e2e/gitToolbar.spec.ts — add after the existing 'switches branch via the branch switcher' test
test('Enter checks out an exact branch name; a partial one does nothing', async () => {
  execFileSync('git', ['branch', 'feature/exact-enter'], { cwd: h.repoRoot })

  await h.page.getByTestId('toolbar-branch-button').click()
  await h.page.getByTestId('branch-switcher-search').fill('feature/exact-enter')
  await h.page.getByTestId('branch-switcher-search').press('Enter')

  await expect(h.page.getByTestId('branch-switcher')).toHaveCount(0)
  await expect(h.page.getByTestId('toolbar-branch-button')).toContainText('feature/exact-enter')

  await h.page.getByTestId('toolbar-branch-button').click()
  await h.page.getByTestId('branch-switcher-search').fill('feature/exact')
  await h.page.getByTestId('branch-switcher-search').press('Enter')

  // Still open, and still on the branch it started on — a partial match is not a choice.
  await expect(h.page.getByTestId('branch-switcher')).toBeVisible()
})
```

- [ ] **Step 8: Run the e2e test and watch it fail**
Run: `npm run test:e2e -- gitToolbar.spec.ts` — expected failure: pressing Enter does nothing today (no `onKeyDown` on the search input), so `toolbar-branch-button` never updates and the first assertion times out.

- [ ] **Step 9: Run the e2e suite again and confirm it passes**
Run: `npm run test:e2e -- gitToolbar.spec.ts`

- [ ] **Final step: Commit**
```bash
git add src/renderer/state/branchSelection.ts src/renderer/components/BranchSwitcher.tsx \
  src/renderer/styles.css tests/unit/branchSelection.test.ts tests/e2e/gitToolbar.spec.ts
git commit -m "feat(branch-switcher): check out an exact ref match on Enter"
```

---

---

### Task 12: Open a session's folder in VS Code from the hover card

**Files:**
- Create: `src/main/vscode/detectVsCode.ts`
- Create: `tests/unit/detectVsCode.test.ts`
- Create: `tests/e2e/openInVsCode.spec.ts`
- Create: `scripts/fixtures/fake-code.sh`
- Modify: `src/main/appService.ts:29-56` (new `vsCodePath: string | null` field, populated once at construction via `detectVsCode`; new `openInVsCode(key: string, isPtyId: boolean)` method beside `resolveShellCwd`'s other users)
- Modify: `src/main/ipc.ts:217-222` (register `CHANNELS.vsCodeAvailable` and `CHANNELS.openInVsCode`)
- Modify: `src/shared/api.ts:109-176` (add both channels and the two `ApiaryApi` methods)
- Modify: `src/preload/index.ts` (bridge both)
- Modify: `src/renderer/components/HoverCard.tsx:29-45,148-153` (new `showVsCodeButton` prop and the button itself, after the "Last active" row)
- Modify: `src/renderer/components/SessionRow.tsx:85-110` (pass `showVsCodeButton`, read once via a small hook, and wire the click to `window.apiary.openInVsCode`)
- Modify: `src/renderer/state/notifications.tsx` or `App.tsx` (nothing new needed here — reuse the existing `useNotifications().notifyError`, called from `SessionRow`)
- Modify: `src/renderer/styles.css` (a `.hover-card-open-vscode` rule using existing control tokens — no new literals, since the button is a plain `.btn.small`)

**Interfaces:**
- Consumes: `resolveShellCwd(key: string, isPtyId: boolean): string` (unchanged, same as every other cwd-carrying call in `appService.ts`); `useNotifications(): { notify, notifyError }` from `src/renderer/state/notifications.tsx`.
- Produces:
  - `detectVsCode(options?: { platform?: NodeJS.Platform; exec?: (file: string, args: string[]) => Promise<string>; exists?: (path: string) => boolean }): Promise<string | null>` in `src/main/vscode/detectVsCode.ts` — resolves to the `code` command/path to spawn, or `null` if none was found.
  - `AppService.vsCodeAvailable(): boolean` (cached result of the one detection run at startup).
  - `AppService.openInVsCode(key: string, isPtyId: boolean): Promise<void>`.
  - `HoverCard`'s new prop: `onOpenInVsCode?: () => void` plus `canOpenInVsCode: boolean`.

- [ ] **Step 1: Write the failing test for detection**
```typescript
// tests/unit/detectVsCode.test.ts
import { describe, it, expect } from 'vitest'
import { detectVsCode } from '../../src/main/vscode/detectVsCode'

describe('detectVsCode', () => {
  it('uses `code` on PATH when it runs', async () => {
    const exec = async (file: string, args: string[]): Promise<string> => {
      expect(file).toBe('code')
      expect(args).toEqual(['--version'])
      return '1.90.0\nabc123\nx64'
    }
    expect(await detectVsCode({ exec })).toBe('code')
  })

  it('falls back to the macOS bundle path when `code` is not on PATH', async () => {
    const exec = async (): Promise<string> => { throw new Error('command not found') }
    const exists = (path: string): boolean =>
      path === '/Applications/Visual Studio Code.app/Contents/Resources/app/bin/code'
    expect(await detectVsCode({ platform: 'darwin', exec, exists })).toBe(
      '/Applications/Visual Studio Code.app/Contents/Resources/app/bin/code',
    )
  })

  it('falls back to a known Linux package path', async () => {
    const exec = async (): Promise<string> => { throw new Error('command not found') }
    const exists = (path: string): boolean => path === '/usr/share/code/bin/code'
    expect(await detectVsCode({ platform: 'linux', exec, exists })).toBe('/usr/share/code/bin/code')
  })

  it('resolves to null when nothing is found', async () => {
    const exec = async (): Promise<string> => { throw new Error('command not found') }
    const exists = (): boolean => false
    expect(await detectVsCode({ platform: 'darwin', exec, exists })).toBeNull()
  })

  it('runs the detection only once per call site — repeat calls with a spy exec see it twice, caching is the caller\'s job', async () => {
    let calls = 0
    const exec = async (): Promise<string> => { calls++; return '1.90.0' }
    await detectVsCode({ exec })
    await detectVsCode({ exec })
    expect(calls).toBe(2)
  })
})
```
- [ ] **Step 2: Run the test and watch it fail**
Run: `npm test -- detectVsCode` (fails with "Cannot find module '../../src/main/vscode/detectVsCode'")
- [ ] **Step 3: Implement detection**
```typescript
// src/main/vscode/detectVsCode.ts
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { existsSync } from 'node:fs'

const run = promisify(execFile)

/** Known install locations, checked in order, for platforms where `code` is not on PATH — the
 *  common case on macOS, where "Shell Command: Install 'code' command in PATH" is an opt-in menu
 *  item most people never run. */
const MAC_BUNDLE_PATH = '/Applications/Visual Studio Code.app/Contents/Resources/app/bin/code'
const LINUX_PACKAGE_PATHS = ['/usr/share/code/bin/code', '/usr/bin/code', '/snap/bin/code']

export interface DetectVsCodeOptions {
  platform?: NodeJS.Platform
  /** Injected in tests. Returns stdout, or throws the way execFile does when the binary is missing. */
  exec?: (file: string, args: string[]) => Promise<string>
  exists?: (path: string) => boolean
}

async function defaultExec(file: string, args: string[]): Promise<string> {
  const { stdout } = await run(file, args, { timeout: 5000 })
  return stdout
}

/**
 * Finds the VS Code CLI once: `code` on PATH first (works everywhere it is installed with the
 * shell command), then the platform's known bundle/package locations.
 *
 * Meant to be called once per launch and cached by the caller (`AppService` does), not on every
 * hover — a hover card must never wait on a spawn.
 */
export async function detectVsCode(options: DetectVsCodeOptions = {}): Promise<string | null> {
  const platform = options.platform ?? process.platform
  const exec = options.exec ?? defaultExec
  const exists = options.exists ?? existsSync

  try {
    await exec('code', ['--version'])
    return 'code'
  } catch {
    // Not on PATH — fall through to the known install locations.
  }

  const candidates = platform === 'darwin' ? [MAC_BUNDLE_PATH] : LINUX_PACKAGE_PATHS
  for (const path of candidates) {
    if (exists(path)) return path
  }
  return null
}
```
- [ ] **Step 4: Write the failing test for the spawn**
```typescript
// tests/unit/mrRefs.test.ts already covers shared parsing; this is a second describe block
// appended to tests/unit/detectVsCode.test.ts, since both cover the same feature's main-process half.
import { openInVsCode } from '../../src/main/vscode/detectVsCode'
// (see Step 6 — openInVsCode is added to the same file as detectVsCode)

describe('openInVsCode', () => {
  it('spawns the resolved binary with the folder as a plain argument, never through a shell', () => {
    const calls: Array<{ command: string; args: string[]; options: unknown }> = []
    const spawn = (command: string, args: string[], options: unknown) => {
      calls.push({ command, args, options })
      return { unref: () => {} }
    }
    openInVsCode('/Applications/Visual Studio Code.app/Contents/Resources/app/bin/code', '/repo/work', { spawn })
    expect(calls).toEqual([{
      command: '/Applications/Visual Studio Code.app/Contents/Resources/app/bin/code',
      args: ['/repo/work'],
      options: { detached: true, stdio: 'ignore', shell: false },
    }])
  })

  it('throws when spawning itself fails, so the caller can report it', () => {
    const spawn = () => { throw new Error('EACCES') }
    expect(() => openInVsCode('code', '/repo/work', { spawn })).toThrow('EACCES')
  })
})
```
- [ ] **Step 5: Run the test and watch it fail**
Run: `npm test -- detectVsCode` (fails: `openInVsCode` is not exported)
- [ ] **Step 6: Implement the spawn, appended to the same file**
```typescript
// src/main/vscode/detectVsCode.ts — add below detectVsCode
import { spawn as nodeSpawn, type ChildProcess } from 'node:child_process'

export interface OpenInVsCodeOptions {
  /** Injected in tests. Same signature as `child_process.spawn`. */
  spawn?: (command: string, args: string[], options: Record<string, unknown>) => ChildProcess
}

/**
 * Opens `folder` in VS Code, detached from Apiary's own process so quitting Apiary does not take
 * the editor window with it.
 *
 * `shell: false` and an argument array (never a template string) is the whole point: a folder path
 * is not sanitized against shell metacharacters anywhere upstream of this call, and it must not
 * need to be.
 */
export function openInVsCode(codePath: string, folder: string, options: OpenInVsCodeOptions = {}): void {
  const spawn = options.spawn ?? nodeSpawn
  const child = spawn(codePath, [folder], { detached: true, stdio: 'ignore', shell: false })
  child.unref?.()
}
```
- [ ] **Step 7: Run the unit suite**
Run: `npm test -- detectVsCode` (passes)
- [ ] **Step 8: Wire detection and the open call into `AppService`**
```typescript
// src/main/appService.ts — near the other options at line ~48
/** Path to the `code` CLI, resolved once at startup by `detectVsCode`. Null when none was found. */
vsCodePath?: string | null
```
```typescript
// AppService constructor / field — stored once, never re-probed per hover
private readonly vsCodePath: string | null

constructor(options: AppServiceOptions) {
  // ...existing assignments...
  this.vsCodePath = options.vsCodePath ?? null
}

vsCodeAvailable(): boolean {
  return this.vsCodePath !== null
}

async openInVsCode(key: string, isPtyId: boolean): Promise<void> {
  if (this.vsCodePath === null) throw new Error('VS Code was not found on this machine')
  const cwd = this.resolveShellCwd(key, isPtyId) // throws if the folder no longer exists
  openInVsCode(this.vsCodePath, cwd)
}
```
```typescript
// src/main/index.ts — beside where settings/plugins are assembled, before `new AppService(...)`
const vsCodePath = await detectVsCode()
service = new AppService({
  // ...existing fields...
  vsCodePath,
})
```
- [ ] **Step 9: Wire the IPC round trip**
```typescript
// src/shared/api.ts — CHANNELS
vsCodeAvailable: 'apiary:vscode-available',
openInVsCode: 'apiary:open-in-vscode',
```
```typescript
// src/shared/api.ts — ApiaryApi
/** Whether VS Code was found on this machine at launch. Checked once; does not change at runtime. */
vsCodeAvailable(): Promise<boolean>
/** Opens the session's folder in VS Code. Rejects if VS Code was not found or the folder is gone. */
openInVsCode(key: string, isPtyId: boolean): Promise<void>
```
```typescript
// src/main/ipc.ts — beside gitStatus at line ~217
handle(CHANNELS.vsCodeAvailable, () => service.vsCodeAvailable())
handle(CHANNELS.openInVsCode, (_e, key: string, isPtyId: boolean) => service.openInVsCode(key, isPtyId))
```
```typescript
// src/preload/index.ts
vsCodeAvailable: () => ipcRenderer.invoke(CHANNELS.vsCodeAvailable),
openInVsCode: (key: string, isPtyId: boolean) => ipcRenderer.invoke(CHANNELS.openInVsCode, key, isPtyId),
```
- [ ] **Step 10: Add the button's CSS using existing control tokens**
```css
/* src/renderer/styles.css — beside the other hover-card rows */
.hover-card-open-vscode {
  margin-top: var(--control-gap);
  align-self: flex-start;
}
```
(The button itself is `<button className="btn small hover-card-open-vscode">`, so it inherits every colour, height and radius from the existing `.btn`/`.small` rules — no new colour or size literal is introduced.)
- [ ] **Step 11: Show the button in the hover card**
```tsx
// src/renderer/components/HoverCard.tsx — add to Props at line ~29
/** Only true once main-process detection has found VS Code and the folder exists. */
canOpenInVsCode?: boolean
onOpenInVsCode?: () => void
```
```tsx
// src/renderer/components/HoverCard.tsx — after the "Last active" row, before the closing </div>, line ~153
{canOpenInVsCode === true && (
  <button
    className="btn small hover-card-open-vscode"
    data-testid="hover-card-open-vscode"
    onClick={onOpenInVsCode}
  >
    Open in VS Code
  </button>
)}
```
- [ ] **Step 12: Read availability once and wire the click in `SessionRow`**
```tsx
// src/renderer/components/SessionRow.tsx — module scope, read once and shared by every row
let vsCodeAvailable: boolean | null = null
let vsCodeAvailablePromise: Promise<boolean> | null = null
function loadVsCodeAvailable(): Promise<boolean> {
  vsCodeAvailablePromise ??= window.apiary.vsCodeAvailable().then((v) => { vsCodeAvailable = v; return v })
  return vsCodeAvailablePromise
}
```
```tsx
// inside SessionRow, alongside hasNote
const [canOpenInVsCode, setCanOpenInVsCode] = useState(vsCodeAvailable ?? false)
useEffect(() => {
  if (vsCodeAvailable !== null) { setCanOpenInVsCode(vsCodeAvailable && session.cwdExists); return }
  void loadVsCodeAvailable().then((v) => { setCanOpenInVsCode(v && session.cwdExists) })
}, [session.cwdExists])
```
```tsx
// passed into <HoverCard ...>
canOpenInVsCode={canOpenInVsCode}
onOpenInVsCode={() => {
  window.apiary.openInVsCode(session.sessionId, false).catch((e: Error) => {
    notifyError('Could not open VS Code', e.message)
  })
}}
```
(`notifyError` comes from `useNotifications()`, imported the same way `App.tsx` already does at line 105 — `const { notifyError } = useNotifications()` added to `SessionRow`'s body.)
- [ ] **Step 13: Write the e2e fixture and spec**
```bash
# scripts/fixtures/fake-code.sh
#!/bin/bash
# Stand-in for the `code` CLI, used only by the E2E suite. Records what it was called with so the
# test can assert the exact folder Apiary asked to open, then exits — real VS Code stays closed.
echo "$@" >> "${APIARY_FAKE_CODE_LOG:?APIARY_FAKE_CODE_LOG must be set}"
exit 0
```
```typescript
// tests/e2e/openInVsCode.spec.ts
import { test, expect } from '@playwright/test'
import { readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { launchApiary, importAll, sidebarSession, type Harness } from './helpers'

const FAKE_CODE = join(process.cwd(), 'scripts/fixtures/fake-code.sh')

let h: Harness
test.afterEach(async () => { await h.close() })

test('the button appears when VS Code is detected and opens the session folder', async () => {
  h = await launchApiary({ codePath: FAKE_CODE })
  await importAll(h.page)
  await sidebarSession(h.page, 'Work A session').hover()
  const button = h.page.getByTestId('hover-card-open-vscode')
  await expect(button).toBeVisible()
  await button.click()
  await expect.poll(() => existsSync(h.vsCodeLog) ? readFileSync(h.vsCodeLog, 'utf8') : '')
    .toContain(h.workdir)
})

test('the button is absent when VS Code was not found', async () => {
  h = await launchApiary({ codePath: '' })
  await importAll(h.page)
  await sidebarSession(h.page, 'Work A session').hover()
  await expect(h.page.getByTestId('hover-card-open-vscode')).toHaveCount(0)
})
```
(`codePath`/`vsCodeLog` are new `launchApiary` fixture options: `codePath` sets `APIARY_CODE_PATH`, read by `main/index.ts` in place of the real `detectVsCode()` lookup the same way `APIARY_GLAB_PATH` already substitutes for the real `glab`, and `APIARY_FAKE_CODE_LOG` points the fixture script at a temp file under `h.home` that the test reads back.)
- [ ] **Step 14: Run the e2e spec**
Run: `npm run test:e2e -- openInVsCode` (passes)
- [ ] **Final step: Commit**
```bash
git add src/main/vscode/detectVsCode.ts src/main/appService.ts src/main/ipc.ts src/main/index.ts \
  src/shared/api.ts src/preload/index.ts src/renderer/components/HoverCard.tsx \
  src/renderer/components/SessionRow.tsx src/renderer/styles.css \
  tests/unit/detectVsCode.test.ts tests/e2e/openInVsCode.spec.ts scripts/fixtures/fake-code.sh \
  tests/e2e/helpers.ts
git commit -m "feat: open a session's folder in VS Code from the hover card"
```

---

### Task 13: Terminal paste writes once, with no stray bracketed-paste markers

**Root cause, measured against the current code.** The spec's stated mechanism is close but not quite what the code does. `TerminalView`'s key handler (`src/renderer/components/TerminalView.tsx:160-167`) returns `false` from `attachCustomKeyEventHandler` for the paste chord — and per `@xterm/xterm/lib/xterm.js`'s `_keyDown`, returning `false` does stop xterm's own *keydown-driven* handling (its internal keypress-to-pty logic). But the handler never calls `e.preventDefault()`, and xterm registers its native browser `paste` listener (`handlePasteEvent`, wired in `_initGlobal`) directly on the hidden `textarea` *and* on `element`, completely independently of `attachCustomKeyEventHandler` — it isn't gated by the keydown handling at all. So when the OS paste shortcut (Cmd+V / Ctrl+V) fires, the browser still dispatches its native `paste` DOM event on the terminal's textarea (nothing prevented that), and xterm's own listener handles it — reading the clipboard itself, wrapping it in bracketed-paste markers via `bracketTextForPaste`, and writing it to the pty through the very same `term.onData` listener that already forwards typed input to `ptyWrite`. Meanwhile the custom handler's own `navigator.clipboard.readText().then(text => ptyWrite(ptyId, text))` already wrote the same text once, unbracketed. Both symptoms are real and both come from the same gap — a `keydown` handler that stops xterm's own *key* handling but does nothing to stop the independent native `paste` event xterm also listens for.

**Platform note — the user reports this on Ubuntu.** That fits the mechanism above and
sharpens the test. On Linux, Chromium dispatches a native `paste` event for **Ctrl+Shift+V**
as well as Ctrl+V, so the Linux chord hits both write paths; on macOS the app's chord is
Cmd+V. Do not assume a run on macOS reproduces it. The e2e test must therefore drive the
chord for the platform it is running on, and the unit test over `pasteText` is the guard
that holds on every platform. Before this task is considered finished, the fix is verified
once on Linux — a Docker Ubuntu 24.04 run of the e2e spec is acceptable evidence; a macOS-only
green run is not, and the report must say which was done.

**Files:**
- Modify: `src/renderer/components/TerminalView.tsx:120-170,248-258`
- Create: `src/renderer/state/terminalPaste.ts`
- Create: `tests/unit/terminalPaste.test.ts`
- Modify: `tests/e2e/terminal.spec.ts`

**Interfaces:**
- Consumes: `Terminal.paste(text: string): void` (existing, `@xterm/xterm`, already imported as `Terminal` in `TerminalView.tsx`); `window.apiary.ptyWrite(ptyId: string, data: string): void` (existing, unchanged — it is xterm's own `term.onData` listener that now carries every paste, not a new call site).
- Produces: `export interface PasteableTerminal { paste: (text: string) => void }` and `export function pasteText(term: PasteableTerminal, text: string): void` (new, `src/renderer/state/terminalPaste.ts`) — the one function every paste path (Ctrl+Shift+V / Cmd+V, and the context menu's "Paste") now calls instead of writing to the pty directly.

- [ ] **Step 1: Write the failing e2e test that reproduces both symptoms**

```ts
// tests/e2e/terminal.spec.ts — add
test('pasting writes the clipboard text once, with no bracketed-paste markers', async () => {
  await h.page.getByTestId('shell-toggle').click()
  await expect(h.page.getByTestId('terminal-shell')).toBeVisible()
  await h.page.getByTestId('terminal-shell').click()

  // Sets the real OS clipboard through Electron's own module, the way a person's copy would —
  // not `navigator.clipboard.writeText`, which a background page cannot always call without a
  // user gesture having happened first.
  const marker = 'APIARY_PASTE_MARKER'
  await h.app.evaluate(({ clipboard }, text) => clipboard.writeText(text), marker)

  // Ctrl+Shift+V is the terminal's own paste chord on every platform (see TerminalView.tsx) and,
  // unlike a bare Ctrl+V, is never a control character the shell would swallow — pressing it here
  // exercises both paths at once: the custom key handler's own clipboard read, and the browser's
  // independent native `paste` event that xterm listens for on the same keypress.
  await h.page.keyboard.press('Control+Shift+V')

  await expect(h.page.getByTestId('terminal-shell')).toContainText(marker, { timeout: 10000 })
  const text = await h.page.getByTestId('terminal-shell').innerText()
  const occurrences = text.split(marker).length - 1
  expect(occurrences).toBe(1)
  expect(text).not.toContain('[200~')
  expect(text).not.toContain('[201~')
})
```

- [ ] **Step 2: Run the test and watch it fail**
Run: `npm run test:e2e -- terminal.spec.ts` — expected failure: `expect(occurrences).toBe(1)` fails with `2` (the marker lands twice — once raw from the direct `ptyWrite`, once from xterm's own bracketed write), and/or the text contains the literal `[200~` from xterm's own paste before either copy is echoed by the shell.

- [ ] **Step 3: Write the unit test for the extracted paste function**

```ts
// tests/unit/terminalPaste.test.ts
import { describe, it, expect } from 'vitest'
import { pasteText, type PasteableTerminal } from '../../src/renderer/state/terminalPaste'

/** Stands in for xterm's own `Terminal.paste()`: the one real write path, bracketing the text
 *  exactly the way xterm does when the running program has enabled bracketed-paste mode. */
class FakeTerminal implements PasteableTerminal {
  written: string[] = []
  bracketedPasteMode = false
  paste(text: string): void {
    this.written.push(this.bracketedPasteMode ? `\x1b[200~${text}\x1b[201~` : text)
  }
}

describe('pasteText', () => {
  it('writes the pasted text exactly once', () => {
    const term = new FakeTerminal()
    pasteText(term, 'hello world')
    expect(term.written).toEqual(['hello world'])
  })

  it('adds no literal bracketed-paste markers when the running program has not enabled that mode', () => {
    const term = new FakeTerminal()
    pasteText(term, 'hello world')
    expect(term.written.join('')).not.toContain('[200~')
    expect(term.written.join('')).not.toContain('[201~')
  })

  it('does bracket the text when the mode is on — that is xterm´s own job, left alone', () => {
    const term = new FakeTerminal()
    term.bracketedPasteMode = true
    pasteText(term, 'hello world')
    expect(term.written).toEqual(['\x1b[200~hello world\x1b[201~'])
  })

  it('does nothing for an empty clipboard, rather than writing a no-op paste', () => {
    const term = new FakeTerminal()
    pasteText(term, '')
    expect(term.written).toEqual([])
  })
})
```

- [ ] **Step 4: Run the unit test and watch it fail**
Run: `npm test -- terminalPaste` — expected failure: `Cannot find module '../../src/renderer/state/terminalPaste'`.

- [ ] **Step 5: Write the single paste function**

```ts
// src/renderer/state/terminalPaste.ts
/**
 * The one write path every paste gesture goes through.
 *
 * xterm's own `Terminal.paste()` is the only thing that should ever put clipboard text on a pty:
 * it goes through the same `onData` listener as typed input, and it applies bracketed-paste
 * markers itself, only when the running program has asked for them. Calling `ptyWrite` directly
 * from a key handler used to run *alongside* that — xterm's own native `paste` DOM event fires
 * independently of any keydown handling — so the same text landed twice, once bracketed and once
 * not. Routing every path through this one function is what makes that impossible again.
 */
export interface PasteableTerminal {
  paste: (text: string) => void
}

export function pasteText(term: PasteableTerminal, text: string): void {
  if (text === '') return
  term.paste(text)
}
```

- [ ] **Step 6: Run the unit test and confirm it passes**
Run: `npm test -- terminalPaste`

- [ ] **Step 7: Route the key handler and the context menu through it**

```tsx
// src/renderer/components/TerminalView.tsx — add the import
import { pasteText } from '../state/terminalPaste'
```

```tsx
      if (key === 'v' && (e.shiftKey || (isMac && e.metaKey))) {
        // Read the clipboard ourselves only to hand the text to xterm's own `paste()` — not to
        // write it to the pty directly. `paste()` is the same call the browser's native paste
        // event already drives, so there is exactly one write path instead of two: this key
        // handler no longer races xterm's own paste listener, it feeds it.
        void navigator.clipboard.readText()
          .then((text) => { pasteText(term, text) })
          .catch(() => {
            // Clipboard read can be refused; better to do nothing than to interrupt the session.
          })
        return false
      }
```

```tsx
    {
      id: 'paste',
      label: 'Paste',
      run: () => {
        navigator.clipboard.readText().then((text) => {
          pasteText(termRef.current ?? term, text)
        }).catch((err) => {
          console.error('Failed to read clipboard:', err)
        })
      },
    },
```

`term` (the effect's local variable) is already in scope for the `attachCustomKeyEventHandler` callback; the context-menu item is defined later in the component body where only `termRef.current` is reachable, so it falls back to nothing if the terminal has already been disposed — matching how `contextMenuItems`' other entries (`copy`, `select-all`, `clear`) already guard on `termRef.current`.

Correcting that fallback (there is no bare `term` in scope at the context-menu's location — only inside the mount effect):

```tsx
    {
      id: 'paste',
      label: 'Paste',
      run: () => {
        const current = termRef.current
        if (current === null) return
        navigator.clipboard.readText().then((text) => {
          pasteText(current, text)
        }).catch((err) => {
          console.error('Failed to read clipboard:', err)
        })
      },
    },
```

- [ ] **Step 8: Run the unit tests once more**
Run: `npm test -- terminalPaste`

- [ ] **Step 9: Run the e2e test and confirm both symptoms are gone**
Run: `npm run test:e2e -- terminal.spec.ts`

- [ ] **Final step: Commit**
```bash
git add src/renderer/components/TerminalView.tsx src/renderer/state/terminalPaste.ts \
  tests/unit/terminalPaste.test.ts tests/e2e/terminal.spec.ts
git commit -m "fix(terminal): paste through xterm's own write path, so text lands once with no stray markers"
```

---

### Task 14: Release prep — version, changelog, docs, screenshot

This task runs last, after every other task is complete and reviewed. It ships no
behaviour; it makes the release describable.

**Files:**
- Modify: `package.json` (the `version` field)
- Modify: `CHANGELOG.md` (a new `## [1.18.0]` section at the top, under the intro)
- Modify: `README.md` (feature list, and the screenshot alt text if the screenshot changes)
- Modify: `CLAUDE.md` (notes for the subsystems this release adds)
- Modify: `scripts/screenshot.spec.ts` (only if the screenshot should show a new section)

**Interfaces:**
- Consumes: nothing. This task reads `git log --oneline main..HEAD` to write the changelog.
- Produces: nothing other tasks depend on.

- [ ] **Step 1: Bump the version**

```bash
cd /Users/nuwan/projects/pet-projects/apiary
node -e "const f='package.json',p=require('./'+f);p.version='1.18.0';require('fs').writeFileSync(f,JSON.stringify(p,null,2)+'\n')"
node -p "require('./package.json').version"
```

Expected output: `1.18.0`

- [ ] **Step 2: Write the changelog section**

Read the commits this branch added:

```bash
git log --oneline main..HEAD
```

Add a `## [1.18.0] - <today's date, YYYY-MM-DD>` section directly below the
intro paragraph in `CHANGELOG.md`, following the existing style exactly: an
`### Added` list, then `### Fixed` where relevant, each entry leading with a bold
phrase and written for a user, not a developer. Cover every one of the ten
features. Entries for the fixes must say what was wrong, not only what changed —
for example that the Ubuntu installer button reported success while nothing had
launched, and that pasting into a terminal wrote the text twice with stray
control characters.

- [ ] **Step 3: Update the README feature list**

Add or extend the bullets covering: sessions and windows coming back after a
restart, the Active and Recent sidebar sections, MR status beside a `!1234`
reference, moving a session to another worktree by dragging it, and Open in VS
Code. Keep the existing voice — each bullet a bold lead-in, then a sentence or
two of plain description.

- [ ] **Step 4: Update CLAUDE.md**

Add short sections describing, for whoever works here next: where window and tab
state is persisted and what restores it; the tab registry and how activity state
is classified; the cwd override column and why the scanner must not clobber it;
and that search filtering now runs in the renderer against a cached tree, with
only content and note search crossing to main.

- [ ] **Step 5: Regenerate the screenshot if the sidebar changed visibly**

Only if the Active or Recent sections change what the sidebar looks like:

```bash
npm run screenshot
```

Then check `docs/screenshot.png` looks right — the sidebar readable, no mouse
cursor artifact, panes not cramped — and update the README alt text to describe
what it now shows.

- [ ] **Step 6: Typecheck and run both suites, separately**

```bash
npm run typecheck
npm test
```

Then, only after the unit run has finished:

```bash
npm run test:e2e
```

Expected: typecheck clean, unit suite green, e2e green apart from the known
pre-existing relaunch flake in `tests/e2e/settings.spec.ts`. If any other test
fails, fix it before committing — a red suite is not a release.

- [ ] **Step 7: Commit**

```bash
git add package.json CHANGELOG.md README.md CLAUDE.md docs/screenshot.png scripts/screenshot.spec.ts
git commit -m "chore: 1.18.0"
```

- [ ] **Step 8: Stop and hand over**

Do not tag, push or release. Report to the user that the branch is ready for
manual testing, listing what to try by hand: the Ubuntu installer button, a
restart with several windows open, hovering a session whose title names an MR,
dragging a session to another worktree, and pasting into a terminal.
