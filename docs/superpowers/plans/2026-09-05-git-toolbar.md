# Git Toolbar Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the bottom pane's plain "Hide shell" text button with a proper, extensible toolbar that adds git branch controls: a branch button opening a VS Code-style branch switcher, separate pull/push buttons, and a copy-branch-name button.

**Architecture:** A new stateless `src/main/git/branchOps.ts` module (same `execFile`-based pattern as the existing `src/main/git/worktreeResolver.ts`) does all git work against a cwd. `AppService` gains thin wrapper methods that resolve a session/pty key to a cwd (via a new shared `resolveShellCwd` helper, replacing duplicated logic already in `openShell`/`openShellForPty`) and delegate to `branchOps.ts`. New IPC channels expose these to the renderer. A new `Toolbar` component renders an array of button descriptors instead of hardcoded JSX, and a `BranchSwitcher` modal (styled like `ImportDialog`'s search+list) handles checkout/create flows.

**Tech Stack:** Electron + React (existing app), `node:child_process.execFile` for git, Vitest for unit/integration tests, Playwright for e2e.

## Global Constraints

- Never trust a raw filesystem path from the renderer — every cwd is resolved server-side from a session id or pty id, exactly like `openShell`/`openShellForPty` already do.
- No background/periodic git fetches — ahead/behind counts are computed from already-known refs only, refreshed on toolbar mount, after checkout, and after pull/push.
- Git errors (merge conflict, no upstream, network failure, dirty tree) surface through the existing `error-banner`/`setError` pattern already used in `App.tsx` — no new dialog type for errors.
- Follow the codebase's existing test convention: unit/integration tests for git logic use **real git repos in a temp directory** (see `tests/unit/worktreeResolver.test.ts`), not a mocked `execFile`.
- `npm run typecheck` and the full test suite (`npm test`, then relevant e2e specs) must stay green after every task.

---

### Task 1: `branchOps.ts` — read-only git status and ref listing

**Files:**
- Create: `src/main/git/branchOps.ts`
- Modify: `src/shared/types.ts` (add `GitStatus`, `GitRefEntry`, `GitRefs`)
- Test: `tests/unit/branchOps.test.ts`

**Interfaces:**
- Produces (consumed by Task 2, Task 3):
  - `export interface GitStatus { branch: string | null; ahead: number; behind: number; hasUpstream: boolean }` (in `@shared/types`)
  - `export interface GitRefEntry { name: string; relativeDate: string; author: string; shortSha: string; subject: string }` (in `@shared/types`)
  - `export interface GitRefs { current: string | null; local: GitRefEntry[]; remote: GitRefEntry[]; tags: GitRefEntry[] }` (in `@shared/types`)
  - `export async function status(cwd: string): Promise<GitStatus>` (in `branchOps.ts`)
  - `export async function listRefs(cwd: string): Promise<GitRefs>` (in `branchOps.ts`)

- [ ] **Step 1: Add the shared types**

Add to `src/shared/types.ts` (near `ProjectInfo`):

```ts
export interface GitStatus {
  branch: string | null
  ahead: number
  behind: number
  hasUpstream: boolean
}

/** One row in the branch switcher's branch/remote/tag lists. */
export interface GitRefEntry {
  name: string
  relativeDate: string
  author: string
  shortSha: string
  subject: string
}

export interface GitRefs {
  current: string | null
  local: GitRefEntry[]
  remote: GitRefEntry[]
  tags: GitRefEntry[]
}
```

- [ ] **Step 2: Write the failing test**

Create `tests/unit/branchOps.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, realpathSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execFileSync } from 'node:child_process'
import { status, listRefs } from '../../src/main/git/branchOps'

let repo: string

const git = (cwd: string, ...args: string[]) =>
  execFileSync('git', args, { cwd, stdio: 'pipe' }).toString()

function commit(repoPath: string, file: string, message: string): void {
  writeFileSync(join(repoPath, file), message)
  git(repoPath, 'add', '.')
  git(repoPath, '-c', 'commit.gpgsign=false', 'commit', '-qm', message)
}

beforeEach(() => {
  repo = realpathSync(mkdtempSync(join(tmpdir(), 'apiary-branchops-')))
  git(repo, 'init', '-q', '-b', 'main')
  git(repo, 'config', 'user.email', 'test@example.com')
  git(repo, 'config', 'user.name', 'Test')
  commit(repo, 'README.md', 'init')
})
afterEach(() => { rmSync(repo, { recursive: true, force: true }) })

describe('status', () => {
  it('reports the current branch with no upstream', async () => {
    const s = await status(repo)
    expect(s.branch).toBe('main')
    expect(s.hasUpstream).toBe(false)
    expect(s.ahead).toBe(0)
    expect(s.behind).toBe(0)
  })

  it('reports ahead/behind against a real upstream', async () => {
    const remote = mkdtempSync(join(tmpdir(), 'apiary-branchops-remote-'))
    git(remote, 'init', '-q', '--bare')
    git(repo, 'remote', 'add', 'origin', remote)
    git(repo, 'push', '-q', '-u', 'origin', 'main')
    commit(repo, 'a.txt', 'local-only commit') // makes local 1 ahead
    const s = await status(repo)
    expect(s.hasUpstream).toBe(true)
    expect(s.ahead).toBe(1)
    expect(s.behind).toBe(0)
    rmSync(remote, { recursive: true, force: true })
  })

  it('reports null branch when detached', async () => {
    const sha = git(repo, 'rev-parse', 'HEAD').trim()
    git(repo, 'checkout', '-q', '--detach', sha)
    const s = await status(repo)
    expect(s.branch).toBeNull()
  })
})

describe('listRefs', () => {
  it('lists local branches, remote branches, and tags with metadata', async () => {
    git(repo, 'branch', 'feature/x')
    git(repo, 'tag', 'v1.0.0')
    const remote = mkdtempSync(join(tmpdir(), 'apiary-branchops-remote2-'))
    git(remote, 'init', '-q', '--bare')
    git(repo, 'remote', 'add', 'origin', remote)
    git(repo, 'push', '-q', 'origin', 'main')

    const refs = await listRefs(repo)
    expect(refs.current).toBe('main')
    expect(refs.local.map((r) => r.name)).toEqual(expect.arrayContaining(['main', 'feature/x']))
    expect(refs.remote.map((r) => r.name)).toEqual(expect.arrayContaining(['origin/main']))
    expect(refs.tags.map((r) => r.name)).toEqual(['v1.0.0'])
    const mainEntry = refs.local.find((r) => r.name === 'main')
    expect(mainEntry?.author).toBe('Test')
    expect(mainEntry?.subject).toBe('init')
    expect(mainEntry?.shortSha).toMatch(/^[0-9a-f]{4,}$/)
    rmSync(remote, { recursive: true, force: true })
  })
})
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `npm test -- branchOps`
Expected: FAIL — `Cannot find module '../../src/main/git/branchOps'`

- [ ] **Step 4: Implement `branchOps.ts`**

Create `src/main/git/branchOps.ts`:

```ts
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import type { GitStatus, GitRefEntry, GitRefs } from '@shared/types'

const run = promisify(execFile)

/** Runs git and throws with its real stderr text on failure — unlike worktreeResolver's own
 *  `git()` helper (which swallows failures to `null` for best-effort project detection), every
 *  caller here is a user-initiated action whose failure must reach the UI. */
async function git(cwd: string, args: string[]): Promise<string> {
  try {
    const { stdout } = await run('git', args, { cwd, timeout: 15000 })
    return stdout.trim()
  } catch (e) {
    const err = e as { stderr?: string; message: string }
    throw new Error((err.stderr ?? err.message).trim())
  }
}

/** Same as `git()`, but resolves to `null` on failure instead of throwing — for probes like
 *  "does an upstream exist" where a non-zero exit is an expected, meaningful outcome. */
async function tryGit(cwd: string, args: string[]): Promise<string | null> {
  try {
    return await git(cwd, args)
  } catch {
    return null
  }
}

export async function status(cwd: string): Promise<GitStatus> {
  const rawBranch = await tryGit(cwd, ['rev-parse', '--abbrev-ref', 'HEAD'])
  const branch = rawBranch === null || rawBranch === 'HEAD' ? null : rawBranch

  const upstream = await tryGit(cwd, ['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{u}'])
  if (upstream === null) return { branch, ahead: 0, behind: 0, hasUpstream: false }

  const counts = await git(cwd, ['rev-list', '--left-right', '--count', 'HEAD...@{u}'])
  const [ahead, behind] = counts.split(/\s+/).map(Number)
  return { branch, ahead, behind, hasUpstream: true }
}

const REF_FORMAT = '%(refname:short)%09%(committerdate:relative)%09%(authorname)%09%(objectname:short)%09%(subject)'

function parseRefs(raw: string): GitRefEntry[] {
  if (raw === '') return []
  return raw.split('\n').map((line) => {
    const [name, relativeDate, author, shortSha, subject] = line.split('\t')
    return { name, relativeDate, author, shortSha, subject }
  })
}

export async function listRefs(cwd: string): Promise<GitRefs> {
  const rawCurrent = await tryGit(cwd, ['rev-parse', '--abbrev-ref', 'HEAD'])
  const current = rawCurrent === null || rawCurrent === 'HEAD' ? null : rawCurrent

  const [localRaw, remoteRaw, tagRaw] = await Promise.all([
    git(cwd, ['for-each-ref', '--sort=-committerdate', `--format=${REF_FORMAT}`, 'refs/heads/']),
    git(cwd, ['for-each-ref', '--sort=-committerdate', `--format=${REF_FORMAT}`, 'refs/remotes/']),
    git(cwd, ['for-each-ref', '--sort=-committerdate', `--format=${REF_FORMAT}`, 'refs/tags/']),
  ])

  return {
    current,
    local: parseRefs(localRaw),
    // origin/HEAD is a symbolic ref to another remote branch, not a real branch to switch to.
    remote: parseRefs(remoteRaw).filter((r) => !r.name.endsWith('/HEAD')),
    tags: parseRefs(tagRaw),
  }
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `npm test -- branchOps`
Expected: PASS (3 + 1 tests)

- [ ] **Step 6: Typecheck and commit**

Run: `npm run typecheck`
Expected: no errors

```bash
git add src/shared/types.ts src/main/git/branchOps.ts tests/unit/branchOps.test.ts
git commit -m "feat: add read-only git status/listRefs to branchOps"
```

---

### Task 2: `branchOps.ts` — checkout, create-branch, pull, push

**Files:**
- Modify: `src/main/git/branchOps.ts`
- Test: `tests/unit/branchOps.test.ts`

**Interfaces:**
- Consumes: `git`/`tryGit` helpers from Task 1 (same file, not exported — used internally).
- Produces (consumed by Task 3):
  - `export async function checkoutBranch(cwd: string, name: string): Promise<void>`
  - `export async function checkoutRemote(cwd: string, remoteRef: string, localName: string): Promise<void>`
  - `export async function checkoutDetached(cwd: string, ref: string): Promise<void>`
  - `export async function createBranch(cwd: string, name: string, from?: string): Promise<void>`
  - `export async function pull(cwd: string): Promise<void>`
  - `export async function push(cwd: string): Promise<void>`

- [ ] **Step 1: Write the failing tests**

Append to `tests/unit/branchOps.test.ts` (add the import, then the new `describe` blocks):

```ts
import {
  status, listRefs, checkoutBranch, checkoutRemote, checkoutDetached, createBranch, pull, push,
} from '../../src/main/git/branchOps'
```

```ts
describe('checkoutBranch / createBranch', () => {
  it('checks out an existing local branch', async () => {
    git(repo, 'branch', 'feature/x')
    await checkoutBranch(repo, 'feature/x')
    expect((await status(repo)).branch).toBe('feature/x')
  })

  it('rejects an unknown branch with git\'s own error text', async () => {
    await expect(checkoutBranch(repo, 'nope')).rejects.toThrow(/nope/)
  })

  it('creates a new branch from HEAD', async () => {
    await createBranch(repo, 'feature/new')
    expect((await status(repo)).branch).toBe('feature/new')
  })

  it('creates a new branch from a given ref', async () => {
    git(repo, 'branch', 'base')
    commit(repo, 'b.txt', 'on main only')
    await createBranch(repo, 'from-base', 'base')
    expect((await status(repo)).branch).toBe('from-base')
    expect(git(repo, 'log', '--oneline').split('\n')).toHaveLength(1) // only the init commit
  })
})

describe('checkoutRemote / checkoutDetached', () => {
  it('creates a local tracking branch from a remote ref', async () => {
    const remote = mkdtempSync(join(tmpdir(), 'apiary-branchops-remote3-'))
    git(remote, 'init', '-q', '--bare')
    git(repo, 'remote', 'add', 'origin', remote)
    git(repo, 'push', '-q', 'origin', 'main')
    git(repo, 'checkout', '-q', '-b', 'throwaway')
    git(repo, 'fetch', '-q')

    await checkoutRemote(repo, 'origin/main', 'main-local')
    expect((await status(repo)).branch).toBe('main-local')
    expect((await status(repo)).hasUpstream).toBe(true)
    rmSync(remote, { recursive: true, force: true })
  })

  it('checks out a tag detached', async () => {
    git(repo, 'tag', 'v1.0.0')
    await checkoutDetached(repo, 'v1.0.0')
    expect((await status(repo)).branch).toBeNull()
  })
})

describe('pull / push', () => {
  it('pulls new commits from the upstream', async () => {
    const remote = mkdtempSync(join(tmpdir(), 'apiary-branchops-remote4-'))
    git(remote, 'init', '-q', '--bare')
    git(repo, 'remote', 'add', 'origin', remote)
    git(repo, 'push', '-q', '-u', 'origin', 'main')

    const clone = mkdtempSync(join(tmpdir(), 'apiary-branchops-clone-'))
    git(tmpdir(), 'clone', '-q', remote, clone)
    git(clone, 'config', 'user.email', 'test@example.com')
    git(clone, 'config', 'user.name', 'Test')
    commit(clone, 'from-clone.txt', 'pushed from clone')
    git(clone, 'push', '-q')

    await pull(repo)
    expect(git(repo, 'log', '--oneline')).toContain('pushed from clone')
    rmSync(remote, { recursive: true, force: true })
    rmSync(clone, { recursive: true, force: true })
  })

  it('pushes and auto-sets upstream when none exists yet', async () => {
    const remote = mkdtempSync(join(tmpdir(), 'apiary-branchops-remote5-'))
    git(remote, 'init', '-q', '--bare')
    git(repo, 'remote', 'add', 'origin', remote)

    await push(repo)
    expect((await status(repo)).hasUpstream).toBe(true)
    rmSync(remote, { recursive: true, force: true })
  })

  it('rejects push with git\'s own error text when there is no remote at all', async () => {
    await expect(push(repo)).rejects.toThrow(/does not appear to be a git repository|No configured push destination/i)
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test -- branchOps`
Expected: FAIL — the new exports don't exist yet.

- [ ] **Step 3: Implement the mutating operations**

Append to `src/main/git/branchOps.ts`:

```ts
/** Rejects a user-typed ref name that git could misinterpret as a flag (e.g. "-x"). Names that
 *  come back from `listRefs` are always safe (git produced them itself) — this guards only the
 *  free-typed "create new branch" name. */
function assertSafeRefName(name: string): void {
  if (name.trim() === '' || name.startsWith('-')) {
    throw new Error(`Invalid branch name: "${name}"`)
  }
}

export async function checkoutBranch(cwd: string, name: string): Promise<void> {
  await git(cwd, ['checkout', name])
}

export async function checkoutRemote(cwd: string, remoteRef: string, localName: string): Promise<void> {
  await git(cwd, ['checkout', '-b', localName, '--track', remoteRef])
}

export async function checkoutDetached(cwd: string, ref: string): Promise<void> {
  await git(cwd, ['checkout', '--detach', ref])
}

export async function createBranch(cwd: string, name: string, from?: string): Promise<void> {
  assertSafeRefName(name)
  await git(cwd, from ? ['checkout', '-b', name, from] : ['checkout', '-b', name])
}

export async function pull(cwd: string): Promise<void> {
  await git(cwd, ['pull'])
}

/** Plain `git push`; if the branch has no upstream yet, retries once as
 *  `git push -u origin HEAD` instead of requiring a separate "publish branch" step. */
export async function push(cwd: string): Promise<void> {
  try {
    await git(cwd, ['push'])
  } catch (e) {
    if (e instanceof Error && /has no upstream branch/i.test(e.message)) {
      await git(cwd, ['push', '-u', 'origin', 'HEAD'])
      return
    }
    throw e
  }
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test -- branchOps`
Expected: PASS (all tests in the file)

- [ ] **Step 5: Typecheck and commit**

Run: `npm run typecheck`

```bash
git add src/main/git/branchOps.ts tests/unit/branchOps.test.ts
git commit -m "feat: add checkout/create/pull/push to branchOps"
```

---

### Task 3: `AppService` wiring — cwd resolution refactor + git methods, IPC, preload

**Files:**
- Modify: `src/main/appService.ts:214-238` (refactor `openShell`/`openShellForPty`, add git methods)
- Modify: `src/shared/api.ts` (new channels + `ApiaryApi` methods)
- Modify: `src/main/ipc.ts` (wire the new channels)
- Modify: `src/preload/index.ts` (expose the new methods)
- Test: `tests/integration/appService.test.ts`

**Interfaces:**
- Consumes: `status`, `listRefs`, `checkoutBranch`, `checkoutRemote`, `checkoutDetached`,
  `createBranch`, `pull`, `push` from `src/main/git/branchOps.ts` (Tasks 1-2); `GitStatus`,
  `GitRefs` from `@shared/types`.
- Produces (consumed by Task 4, Task 5, Task 6):
  - `AppService.gitStatus(key: string, isPtyId: boolean): Promise<GitStatus>`
  - `AppService.gitListRefs(key: string, isPtyId: boolean): Promise<GitRefs>`
  - `AppService.gitCheckoutBranch(key: string, isPtyId: boolean, name: string): Promise<void>`
  - `AppService.gitCheckoutRemote(key: string, isPtyId: boolean, remoteRef: string, localName: string): Promise<void>`
  - `AppService.gitCheckoutDetached(key: string, isPtyId: boolean, ref: string): Promise<void>`
  - `AppService.gitCreateBranch(key: string, isPtyId: boolean, name: string, from?: string): Promise<void>`
  - `AppService.gitPull(key: string, isPtyId: boolean): Promise<void>`
  - `AppService.gitPush(key: string, isPtyId: boolean): Promise<void>`
  - `window.apiary.gitStatus/gitListRefs/gitCheckoutBranch/gitCheckoutRemote/gitCheckoutDetached/gitCreateBranch/gitPull/gitPush` — same signatures, renderer-side.
  - `window.apiary.copyToClipboard(text: string): Promise<void>` (main-process clipboard write —
    more reliable to test than `navigator.clipboard` inside a sandboxed renderer; added here since
    it shares this task's IPC-plumbing work).

- [ ] **Step 1: Write the failing integration tests**

Add to `tests/integration/appService.test.ts` (needs a new git-repo helper; add near the top,
after the existing `projects` helper):

```ts
import { execFileSync } from 'node:child_process'

function git(cwd: string, ...args: string[]): string {
  return execFileSync('git', args, { cwd, stdio: 'pipe' }).toString().trim()
}

function makeGitWorkdir(): string {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'apiary-work-git-')))
  git(dir, 'init', '-q', '-b', 'main')
  git(dir, 'config', 'user.email', 'test@example.com')
  git(dir, 'config', 'user.name', 'Test')
  writeFileSync(join(dir, 'README.md'), 'hi')
  git(dir, 'add', '.')
  git(dir, '-c', 'commit.gpgsign=false', 'commit', '-qm', 'init')
  return dir
}
```

(`writeFileSync` needs adding to the existing `node:fs` import at the top of the file.)

Then add a new `describe` block:

```ts
describe('git operations', () => {
  it('resolves a session id to its cwd for gitStatus, and rejects an unknown session', async () => {
    const gitDir = makeGitWorkdir()
    makeSession(projects(), '-gitw', {
      sessionId: '66666666-6666-6666-6666-666666666666', cwd: gitDir, title: 'Git session',
    })
    await service.refresh()
    await service.importSessions(['66666666-6666-6666-6666-666666666666'], [])

    const s = await service.gitStatus('66666666-6666-6666-6666-666666666666', false)
    expect(s.branch).toBe('main')

    await expect(service.gitStatus('does-not-exist', false)).rejects.toThrow(/unknown session/i)
    rmSync(gitDir, { recursive: true, force: true })
  })

  it('resolves a pty id to its cwd for gitStatus (the new-session path)', async () => {
    const gitDir = makeGitWorkdir()
    const info = await service.newSessionInFolder(gitDir)
    const s = await service.gitStatus(info.ptyId, true)
    expect(s.branch).toBe('main')
    rmSync(gitDir, { recursive: true, force: true })
  })

  it('creates and checks out a branch by session id', async () => {
    const gitDir = makeGitWorkdir()
    makeSession(projects(), '-gitw2', {
      sessionId: '77777777-7777-7777-7777-777777777777', cwd: gitDir, title: 'Git session 2',
    })
    await service.refresh()
    await service.importSessions(['77777777-7777-7777-7777-777777777777'], [])

    await service.gitCreateBranch('77777777-7777-7777-7777-777777777777', false, 'feature/y')
    const s = await service.gitStatus('77777777-7777-7777-7777-777777777777', false)
    expect(s.branch).toBe('feature/y')
    rmSync(gitDir, { recursive: true, force: true })
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test -- appService`
Expected: FAIL — `service.gitStatus is not a function`

- [ ] **Step 3: Refactor cwd resolution and add the AppService methods**

In `src/main/appService.ts`, add the import at the top:

```ts
import * as branchOps from './git/branchOps'
import type { GitStatus, GitRefs } from '@shared/types'
```

Replace the `openShell`/`openShellForPty` pair (`src/main/appService.ts:214-238`) with a shared
resolver plus both methods rewritten to use it:

```ts
  /**
   * Resolves a session id or (when `isPtyId`) a still-pending session's pty id to its real,
   * existing cwd — the one trust boundary every cwd-carrying IPC call (shells, and now git
   * operations) goes through, so the renderer never gets to hand in a raw filesystem path.
   */
  private resolveShellCwd(key: string, isPtyId: boolean): string {
    const cwd = isPtyId ? this.pty.getCwd(key) : this.requireSession(key).cwd
    if (!cwd) throw new Error(`Unknown session: ${key}`)
    if (!existsSync(cwd)) throw new Error(`The folder for this session no longer exists: ${cwd}`)
    return cwd
  }

  /** Spawns a plain interactive shell in the session's cwd, keyed `shell:<id>`. */
  async openShell(sessionId: string): Promise<void> {
    const cwd = this.resolveShellCwd(sessionId, false)
    this.pty.spawn({ id: `shell:${sessionId}`, cwd, command: 'exec "$SHELL" -l' })
  }

  /**
   * Spawns a plain interactive shell alongside a not-yet-resolved new session's pty, keyed
   * `shell:<ptyId>`. `ptyId` never carries the cwd itself across IPC — it is looked up from the
   * already-running pty `PtyManager` spawned it with, the same trust boundary `openShell` keeps
   * for a stored session's cwd (no raw filesystem path is ever accepted from the renderer).
   */
  async openShellForPty(ptyId: string): Promise<void> {
    const cwd = this.resolveShellCwd(ptyId, true)
    this.pty.spawn({ id: `shell:${ptyId}`, cwd, command: 'exec "$SHELL" -l' })
  }

  async gitStatus(key: string, isPtyId: boolean): Promise<GitStatus> {
    return branchOps.status(this.resolveShellCwd(key, isPtyId))
  }

  async gitListRefs(key: string, isPtyId: boolean): Promise<GitRefs> {
    return branchOps.listRefs(this.resolveShellCwd(key, isPtyId))
  }

  async gitCheckoutBranch(key: string, isPtyId: boolean, name: string): Promise<void> {
    await branchOps.checkoutBranch(this.resolveShellCwd(key, isPtyId), name)
  }

  async gitCheckoutRemote(key: string, isPtyId: boolean, remoteRef: string, localName: string): Promise<void> {
    await branchOps.checkoutRemote(this.resolveShellCwd(key, isPtyId), remoteRef, localName)
  }

  async gitCheckoutDetached(key: string, isPtyId: boolean, ref: string): Promise<void> {
    await branchOps.checkoutDetached(this.resolveShellCwd(key, isPtyId), ref)
  }

  async gitCreateBranch(key: string, isPtyId: boolean, name: string, from?: string): Promise<void> {
    await branchOps.createBranch(this.resolveShellCwd(key, isPtyId), name, from)
  }

  async gitPull(key: string, isPtyId: boolean): Promise<void> {
    await branchOps.pull(this.resolveShellCwd(key, isPtyId))
  }

  async gitPush(key: string, isPtyId: boolean): Promise<void> {
    await branchOps.push(this.resolveShellCwd(key, isPtyId))
  }
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test -- appService`
Expected: PASS

- [ ] **Step 5: Add the IPC channels and shared API types**

In `src/shared/api.ts`, add to `CHANNELS`:

```ts
  gitStatus: 'apiary:git-status',
  gitListRefs: 'apiary:git-list-refs',
  gitCheckoutBranch: 'apiary:git-checkout-branch',
  gitCheckoutRemote: 'apiary:git-checkout-remote',
  gitCheckoutDetached: 'apiary:git-checkout-detached',
  gitCreateBranch: 'apiary:git-create-branch',
  gitPull: 'apiary:git-pull',
  gitPush: 'apiary:git-push',
  copyToClipboard: 'apiary:copy-to-clipboard',
```

Add to `ApiaryApi` (import `GitStatus`, `GitRefs` at the top alongside the existing type import):

```ts
  gitStatus(key: string, isPtyId: boolean): Promise<GitStatus>
  gitListRefs(key: string, isPtyId: boolean): Promise<GitRefs>
  gitCheckoutBranch(key: string, isPtyId: boolean, name: string): Promise<void>
  gitCheckoutRemote(key: string, isPtyId: boolean, remoteRef: string, localName: string): Promise<void>
  gitCheckoutDetached(key: string, isPtyId: boolean, ref: string): Promise<void>
  gitCreateBranch(key: string, isPtyId: boolean, name: string, from?: string): Promise<void>
  gitPull(key: string, isPtyId: boolean): Promise<void>
  gitPush(key: string, isPtyId: boolean): Promise<void>
  copyToClipboard(text: string): Promise<void>
```

- [ ] **Step 6: Wire the channels in `ipc.ts` and `preload/index.ts`**

In `src/main/ipc.ts`, add near the other `ipcMain.handle` calls, and import `clipboard` from
`electron` at the top:

```ts
import { ipcMain, clipboard, type BrowserWindow } from 'electron'
```

```ts
  ipcMain.handle(CHANNELS.gitStatus, (_e, key: string, isPtyId: boolean) =>
    service.gitStatus(key, isPtyId),
  )
  ipcMain.handle(CHANNELS.gitListRefs, (_e, key: string, isPtyId: boolean) =>
    service.gitListRefs(key, isPtyId),
  )
  ipcMain.handle(CHANNELS.gitCheckoutBranch, async (_e, key: string, isPtyId: boolean, name: string) => {
    await service.gitCheckoutBranch(key, isPtyId, name)
    send(CHANNELS.treeChanged)
  })
  ipcMain.handle(
    CHANNELS.gitCheckoutRemote,
    async (_e, key: string, isPtyId: boolean, remoteRef: string, localName: string) => {
      await service.gitCheckoutRemote(key, isPtyId, remoteRef, localName)
      send(CHANNELS.treeChanged)
    },
  )
  ipcMain.handle(CHANNELS.gitCheckoutDetached, async (_e, key: string, isPtyId: boolean, ref: string) => {
    await service.gitCheckoutDetached(key, isPtyId, ref)
    send(CHANNELS.treeChanged)
  })
  ipcMain.handle(
    CHANNELS.gitCreateBranch,
    async (_e, key: string, isPtyId: boolean, name: string, from?: string) => {
      await service.gitCreateBranch(key, isPtyId, name, from)
      send(CHANNELS.treeChanged)
    },
  )
  ipcMain.handle(CHANNELS.gitPull, (_e, key: string, isPtyId: boolean) => service.gitPull(key, isPtyId))
  ipcMain.handle(CHANNELS.gitPush, (_e, key: string, isPtyId: boolean) => service.gitPush(key, isPtyId))
  ipcMain.handle(CHANNELS.copyToClipboard, (_e, text: string) => { clipboard.writeText(text) })
```

In `src/preload/index.ts`, add to the `api` object:

```ts
  gitStatus: (key, isPtyId) => ipcRenderer.invoke(CHANNELS.gitStatus, key, isPtyId),
  gitListRefs: (key, isPtyId) => ipcRenderer.invoke(CHANNELS.gitListRefs, key, isPtyId),
  gitCheckoutBranch: (key, isPtyId, name) =>
    ipcRenderer.invoke(CHANNELS.gitCheckoutBranch, key, isPtyId, name),
  gitCheckoutRemote: (key, isPtyId, remoteRef, localName) =>
    ipcRenderer.invoke(CHANNELS.gitCheckoutRemote, key, isPtyId, remoteRef, localName),
  gitCheckoutDetached: (key, isPtyId, ref) =>
    ipcRenderer.invoke(CHANNELS.gitCheckoutDetached, key, isPtyId, ref),
  gitCreateBranch: (key, isPtyId, name, from) =>
    ipcRenderer.invoke(CHANNELS.gitCreateBranch, key, isPtyId, name, from),
  gitPull: (key, isPtyId) => ipcRenderer.invoke(CHANNELS.gitPull, key, isPtyId),
  gitPush: (key, isPtyId) => ipcRenderer.invoke(CHANNELS.gitPush, key, isPtyId),
  copyToClipboard: (text) => ipcRenderer.invoke(CHANNELS.copyToClipboard, text),
```

- [ ] **Step 7: Typecheck and run the full unit/integration suite**

Run: `npm run typecheck`
Run: `npm test`
Expected: all green

- [ ] **Step 8: Commit**

```bash
git add src/main/appService.ts src/shared/api.ts src/main/ipc.ts src/preload/index.ts tests/integration/appService.test.ts
git commit -m "feat: wire git status/checkout/pull/push and clipboard copy through IPC"
```

---

### Task 4: `Toolbar` component + restyled bottom-pane header

**Files:**
- Create: `src/renderer/components/Toolbar.tsx`
- Create: `src/renderer/components/icons.tsx`
- Modify: `src/renderer/App.tsx:401-535` (bottom-pane header, `toggleShell`, new git-status state)
- Modify: `src/renderer/styles.css` (toolbar styles, replacing `.shell-toggle`'s old rule)
- Test: `tests/e2e/gitToolbar.spec.ts` (new)

**Interfaces:**
- Consumes: `window.apiary.gitStatus`, `.gitPull`, `.gitPush`, `.copyToClipboard` (Task 3).
- Produces (consumed by Task 6):
  - `export interface ToolbarButtonSpec { id: string; icon: ReactNode; label?: string; title: string; testId: string; onClick: () => void; active?: boolean; disabled?: boolean }`
  - `export function Toolbar({ left, right }: { left: ToolbarButtonSpec[]; right: ToolbarButtonSpec[] }): JSX.Element`
  - Icon components in `icons.tsx`: `BranchIcon`, `ArrowDownIcon`, `ArrowUpIcon`, `CopyIcon` (this
    task); `PlusIcon`, `ListIcon`, `TrashIcon`, `PencilIcon` (added later, in the multi-terminal
    plan — not needed here, but `icons.tsx` is the shared home for all of them).

- [ ] **Step 1: Create the icon set**

Create `src/renderer/components/icons.tsx` (small inline SVGs, same 16x16 viewBox and
`currentColor` stroke convention as the existing chevron in `ToolBlock.tsx`):

```tsx
interface IconProps { className?: string }

export function BranchIcon({ className }: IconProps): JSX.Element {
  return (
    <svg className={className} viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <circle cx="4" cy="3" r="1.5" stroke="currentColor" strokeWidth="1.2" />
      <circle cx="4" cy="13" r="1.5" stroke="currentColor" strokeWidth="1.2" />
      <circle cx="12" cy="6" r="1.5" stroke="currentColor" strokeWidth="1.2" />
      <path d="M4 4.5V11.5M4 8C6 8 7 7.5 8 6.5C9 5.5 10.5 5.2 12 5.5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
    </svg>
  )
}

export function ArrowDownIcon({ className }: IconProps): JSX.Element {
  return (
    <svg className={className} viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <path d="M8 2.5v9M4.5 8 8 11.5 11.5 8" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

export function ArrowUpIcon({ className }: IconProps): JSX.Element {
  return (
    <svg className={className} viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <path d="M8 13.5v-9M4.5 8 8 4.5 11.5 8" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

export function CopyIcon({ className }: IconProps): JSX.Element {
  return (
    <svg className={className} viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <rect x="5.5" y="5.5" width="7" height="8" rx="1" stroke="currentColor" strokeWidth="1.2" />
      <path d="M3.5 10.5v-7a1 1 0 0 1 1-1h7" stroke="currentColor" strokeWidth="1.2" />
    </svg>
  )
}
```

- [ ] **Step 2: Create the `Toolbar` component**

Create `src/renderer/components/Toolbar.tsx`:

```tsx
import type { ReactNode } from 'react'

export interface ToolbarButtonSpec {
  id: string
  icon: ReactNode
  /** Text after the icon — omitted for icon-only buttons (pull/push/copy/+/list-toggle). */
  label?: string
  title: string
  testId: string
  onClick: () => void
  active?: boolean
  disabled?: boolean
}

interface Props {
  left: ToolbarButtonSpec[]
  right: ToolbarButtonSpec[]
}

/**
 * Renders the bottom pane's header from an array of button descriptors instead of hardcoded
 * JSX per button, so a future button (the plan doc calls out a "+ new terminal" and a
 * "toggle terminal list" button coming next) is one more array entry, not new markup wired in
 * by hand at every call site.
 */
export function Toolbar({ left, right }: Props): JSX.Element {
  return (
    <div className="toolbar">
      <div className="toolbar-group">{left.map((b) => <ToolbarButton key={b.id} {...b} />)}</div>
      <div className="toolbar-group toolbar-group-right">
        {right.map((b) => <ToolbarButton key={b.id} {...b} />)}
      </div>
    </div>
  )
}

function ToolbarButton(spec: ToolbarButtonSpec): JSX.Element {
  return (
    <button
      className="toolbar-button"
      data-testid={spec.testId}
      data-active={spec.active ?? false}
      title={spec.title}
      aria-label={spec.title}
      disabled={spec.disabled}
      onClick={spec.onClick}
    >
      {spec.icon}
      {spec.label !== undefined && <span className="toolbar-button-label">{spec.label}</span>}
    </button>
  )
}
```

- [ ] **Step 3: Add toolbar CSS**

In `src/renderer/styles.css`, replace the existing `.shell-toggle` rule
(`src/renderer/styles.css:439`) with:

```css
.toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  background: var(--bg-panel);
  border-bottom: 1px solid var(--border);
  padding: 4px 6px;
  gap: 4px;
}
.toolbar-group { display: flex; align-items: center; gap: 4px; }
.toolbar-group-right { margin-left: auto; }

.toolbar-button {
  display: flex;
  align-items: center;
  gap: 4px;
  border: 1px solid transparent;
  background: transparent;
  color: var(--muted);
  border-radius: 6px;
  cursor: pointer;
  padding: 3px 6px;
  font: inherit;
}
.toolbar-button svg { width: 14px; height: 14px; flex: none; }
.toolbar-button:hover { background: var(--selected); color: var(--text); }
.toolbar-button:active { background: var(--border); }
.toolbar-button:disabled { cursor: default; opacity: 0.5; }
.toolbar-button[data-active="true"] { background: var(--selected); color: var(--text); border-color: var(--border); }
.toolbar-button .spinner { animation: spin 0.6s linear infinite; }
```

- [ ] **Step 4: Wire the toolbar into `App.tsx`**

In `src/renderer/App.tsx`, import the new pieces near the top:

```ts
import { Toolbar, type ToolbarButtonSpec } from './components/Toolbar'
import { BranchIcon, ArrowDownIcon, ArrowUpIcon, CopyIcon } from './components/icons'
import type { GitStatus } from '@shared/types'
```

Add state for git status and per-action busy flags, alongside the existing `shellOpen`/`shells`
state (near `src/renderer/App.tsx:95-96`):

```ts
  const [gitStatus, setGitStatus] = useState<GitStatus | null>(null)
  const [gitBusy, setGitBusy] = useState<'pull' | 'push' | null>(null)
```

Add a loader, called whenever `shellKey`/`shellKeyIsPtyId` changes and after any git action.
Place this effect right after the `shellKey`/`shellKeyIsPtyId` `const`s
(`src/renderer/App.tsx:385-399`):

```ts
  const loadGitStatus = useCallback(() => {
    if (shellKey === null) { setGitStatus(null); return }
    void window.apiary.gitStatus(shellKey, shellKeyIsPtyId).then(setGitStatus).catch(() => setGitStatus(null))
  }, [shellKey, shellKeyIsPtyId])

  useEffect(() => { loadGitStatus() }, [loadGitStatus])
```

Add pull/push handlers near `toggleShell` (`src/renderer/App.tsx:401-418`):

```ts
  const runGitAction = useCallback(async (kind: 'pull' | 'push') => {
    if (shellKey === null) return
    setGitBusy(kind)
    try {
      if (kind === 'pull') await window.apiary.gitPull(shellKey, shellKeyIsPtyId)
      else await window.apiary.gitPush(shellKey, shellKeyIsPtyId)
      setError(null)
      loadGitStatus()
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setGitBusy(null)
    }
  }, [shellKey, shellKeyIsPtyId, loadGitStatus])
```

Replace the bottom-pane header (`src/renderer/App.tsx:526-530`, the single
`<button className="shell-toggle" ...>` element) with a `Toolbar`:

```tsx
                <Toolbar
                  left={[
                    {
                      id: 'shell-toggle',
                      icon: <span aria-hidden="true">▾</span>,
                      label: shellOpen ? 'Hide shell' : 'Show shell',
                      title: shellOpen ? 'Hide shell' : 'Show shell',
                      testId: 'shell-toggle',
                      onClick: () => { void toggleShell() },
                    },
                    ...(gitStatus?.branch !== null && gitStatus !== null
                      ? ([
                          {
                            id: 'git-branch',
                            icon: <BranchIcon />,
                            label:
                              gitStatus.branch +
                              (gitStatus.hasUpstream && (gitStatus.behind > 0 || gitStatus.ahead > 0)
                                ? ` (${gitStatus.behind > 0 ? '↓' + String(gitStatus.behind) : ''}${gitStatus.ahead > 0 ? '↑' + String(gitStatus.ahead) : ''})`
                                : ''),
                            title: 'Switch or create branch',
                            testId: 'toolbar-branch-button',
                            onClick: () => setBranchSwitcherOpen(true),
                          },
                          {
                            id: 'git-pull',
                            icon: <ArrowDownIcon className={gitBusy === 'pull' ? 'spinner' : undefined} />,
                            title: 'Pull',
                            testId: 'toolbar-pull',
                            disabled: gitBusy !== null,
                            onClick: () => { void runGitAction('pull') },
                          },
                          {
                            id: 'git-push',
                            icon: <ArrowUpIcon className={gitBusy === 'push' ? 'spinner' : undefined} />,
                            title: 'Push',
                            testId: 'toolbar-push',
                            disabled: gitBusy !== null,
                            onClick: () => { void runGitAction('push') },
                          },
                          {
                            id: 'git-copy',
                            icon: <CopyIcon />,
                            title: 'Copy branch name',
                            testId: 'toolbar-copy',
                            onClick: () => {
                              if (gitStatus.branch !== null) void window.apiary.copyToClipboard(gitStatus.branch)
                            },
                          },
                        ] as ToolbarButtonSpec[])
                      : []),
                  ]}
                  right={[]}
                />
```

(`setBranchSwitcherOpen` and the modal itself are added in Task 5 — for this task, add a no-op
placeholder state so the file compiles: `const [branchSwitcherOpen, setBranchSwitcherOpen] = useState(false)`
declared next to `gitBusy` above; it is unused visually until Task 6 renders the modal, which is
fine — `eslint`/`tsc` don't flag an unused setter that's already called.)

- [ ] **Step 5: Write the e2e test**

Create `tests/e2e/gitToolbar.spec.ts`:

```ts
import { test, expect } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { launchApiary, importAll, type Harness } from './helpers'

let h: Harness
test.beforeEach(async () => {
  h = await launchApiary()
  await importAll(h.page)
  await h.page.getByTestId('sidebar-refresh').click()
  await h.page.getByText('Repo root session').click()
  await h.page.getByTestId('shell-toggle').click()
  await expect(h.page.getByTestId('terminal-shell')).toBeVisible()
})
test.afterEach(async () => { await h.close() })

test('shows the current branch and lets you copy it', async () => {
  await expect(h.page.getByTestId('toolbar-branch-button')).toContainText('main')
  await h.page.getByTestId('toolbar-copy').click()
  const clipboardText = await h.app.evaluate(({ clipboard }) => clipboard.readText())
  expect(clipboardText).toBe('main')
})

test('pull and push succeed against a real remote and refresh the branch button', async () => {
  const remote = h.repoRoot + '-remote.git'
  execFileSync('git', ['init', '-q', '--bare', remote])
  execFileSync('git', ['remote', 'add', 'origin', remote], { cwd: h.repoRoot })

  await h.page.getByTestId('toolbar-push').click()
  await expect(h.page.getByTestId('error-banner')).toHaveCount(0)

  await h.page.getByTestId('toolbar-pull').click()
  await expect(h.page.getByTestId('error-banner')).toHaveCount(0)
})
```

- [ ] **Step 6: Run the e2e test**

Run: `npm run test:e2e -- gitToolbar`
Expected: PASS

- [ ] **Step 7: Run the full test suite (unit/integration + relevant e2e) and typecheck**

Run: `npm run typecheck`
Run: `npm test`
Run: `npm run test:e2e -- gitToolbar terminal newSession`
Expected: all green — `terminal`/`newSession` re-run here since they exercise `shell-toggle`,
which this task restyled.

- [ ] **Step 8: Commit**

```bash
git add src/renderer/components/Toolbar.tsx src/renderer/components/icons.tsx src/renderer/App.tsx src/renderer/styles.css tests/e2e/gitToolbar.spec.ts
git commit -m "feat: replace the shell-toggle text button with a Toolbar (branch, pull, push, copy)"
```

---

### Task 5: `BranchSwitcher` — search, sections, and simple checkout

**Files:**
- Create: `src/renderer/components/BranchSwitcher.tsx`
- Modify: `src/renderer/App.tsx` (render the modal, wire `branchSwitcherOpen`)
- Modify: `src/renderer/styles.css` (branch-switcher list styles)
- Test: `tests/e2e/gitToolbar.spec.ts`

**Interfaces:**
- Consumes: `window.apiary.gitListRefs`, `.gitCheckoutBranch` (Task 3); `Toolbar`'s
  `branchSwitcherOpen`/`setBranchSwitcherOpen` state (Task 4).
- Produces (consumed by Task 6): `BranchSwitcher`'s own internal step state is extended in Task 6
  to add "create" / "create from" / "detached" flows — this task ships the base modal with
  search + sections + plain checkout only, already fully working and testable on its own.

- [ ] **Step 1: Create the base `BranchSwitcher`**

Create `src/renderer/components/BranchSwitcher.tsx`:

```tsx
import { useEffect, useMemo, useState } from 'react'
import type { GitRefEntry, GitRefs } from '@shared/types'

interface Props {
  shellKey: string
  isPtyId: boolean
  onClose: () => void
  onCheckedOut: () => void
  onError: (message: string) => void
}

function matches(entry: GitRefEntry, query: string): boolean {
  return query === '' || entry.name.toLowerCase().includes(query)
}

export function BranchSwitcher({ shellKey, isPtyId, onClose, onCheckedOut, onError }: Props): JSX.Element {
  const [refs, setRefs] = useState<GitRefs | null>(null)
  const [query, setQuery] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    void window.apiary.gitListRefs(shellKey, isPtyId).then(setRefs).catch((e: Error) => onError(e.message))
    // Runs once on open — intentionally not re-fetching on every keystroke of `query`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const q = query.trim().toLowerCase()
  const filtered = useMemo(() => {
    if (refs === null) return { local: [], remote: [], tags: [] }
    return {
      local: refs.local.filter((r) => matches(r, q)),
      remote: refs.remote.filter((r) => matches(r, q)),
      tags: refs.tags.filter((r) => matches(r, q)),
    }
  }, [refs, q])

  const checkout = async (name: string): Promise<void> => {
    setBusy(true)
    try {
      await window.apiary.gitCheckoutBranch(shellKey, isPtyId, name)
      onCheckedOut()
      onClose()
    } catch (e) {
      onError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div
        className="modal wide branch-switcher"
        data-testid="branch-switcher"
        role="dialog"
        aria-modal="true"
        onClick={(e) => e.stopPropagation()}
      >
        <input
          className="search"
          data-testid="branch-switcher-search"
          placeholder="Select a branch or tag to checkout"
          autoFocus
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />

        <ul className="branch-switcher-list">
          {refs === null && <li className="empty">Loading…</li>}

          {refs !== null && (
            <>
              <BranchSection title="branches" testId="branch-switcher-branch-row" rows={filtered.local} onPick={(r) => { void checkout(r.name) }} busy={busy} />
              <BranchSection title="remote branches" testId="branch-switcher-remote-row" rows={filtered.remote} onPick={(r) => { void checkout(r.name) }} busy={busy} />
              <BranchSection title="tags" testId="branch-switcher-tag-row" rows={filtered.tags} onPick={(r) => { void checkout(r.name) }} busy={busy} />
            </>
          )}
        </ul>
      </div>
    </div>
  )
}

function BranchSection(
  { title, testId, rows, onPick, busy }:
  { title: string; testId: string; rows: GitRefEntry[]; onPick: (r: GitRefEntry) => void; busy: boolean },
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

- [ ] **Step 2: Add branch-switcher CSS**

Append to `src/renderer/styles.css`:

```css
.branch-switcher-list { list-style: none; margin: 0; padding: 0; max-height: 50vh; overflow-y: auto; }
.branch-switcher-section-label { padding: 6px 4px 2px; font-size: 11px; text-transform: uppercase; color: var(--muted); }
.branch-switcher-row {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  width: 100%;
  border: 0;
  background: transparent;
  color: var(--text);
  text-align: left;
  padding: 6px 8px;
  border-radius: 6px;
  cursor: pointer;
  font: inherit;
}
.branch-switcher-row:hover { background: var(--selected); }
.branch-switcher-row-meta { color: var(--muted); font-size: 11px; }
```

- [ ] **Step 3: Wire the modal into `App.tsx`**

Near the other conditionally-rendered dialogs at the bottom of the JSX in `App.tsx` (after the
`{settingsOpen && <SettingsDialog .../>}` line), add:

```tsx
      {branchSwitcherOpen && shellKey !== null && (
        <BranchSwitcher
          shellKey={shellKey}
          isPtyId={shellKeyIsPtyId}
          onClose={() => setBranchSwitcherOpen(false)}
          onCheckedOut={loadGitStatus}
          onError={setError}
        />
      )}
```

and import it at the top: `import { BranchSwitcher } from './components/BranchSwitcher'`.

- [ ] **Step 4: Write the e2e test**

Append to `tests/e2e/gitToolbar.spec.ts`:

```ts
test('switches branch via the branch switcher', async () => {
  execFileSync('git', ['branch', 'feature/from-switcher'], { cwd: h.repoRoot })

  await h.page.getByTestId('toolbar-branch-button').click()
  await expect(h.page.getByTestId('branch-switcher')).toBeVisible()
  await h.page.getByTestId('branch-switcher-search').fill('feature')
  await h.page.getByTestId('branch-switcher-branch-row').filter({ hasText: 'feature/from-switcher' }).click()

  await expect(h.page.getByTestId('branch-switcher')).toHaveCount(0)
  await expect(h.page.getByTestId('toolbar-branch-button')).toContainText('feature/from-switcher')
})
```

- [ ] **Step 5: Run the e2e test**

Run: `npm run test:e2e -- gitToolbar`
Expected: PASS (all tests in the file)

- [ ] **Step 6: Typecheck, run the full suite, and commit**

Run: `npm run typecheck`
Run: `npm test`
Run: `npm run test:e2e -- gitToolbar`

```bash
git add src/renderer/components/BranchSwitcher.tsx src/renderer/App.tsx src/renderer/styles.css tests/e2e/gitToolbar.spec.ts
git commit -m "feat: add BranchSwitcher with search, sections, and checkout"
```

---

### Task 6: `BranchSwitcher` — create new branch, create from, checkout detached

**Files:**
- Modify: `src/renderer/components/BranchSwitcher.tsx`
- Test: `tests/e2e/gitToolbar.spec.ts`

**Interfaces:**
- Consumes: `window.apiary.gitCreateBranch`, `.gitCheckoutRemote`, `.gitCheckoutDetached` (Task 3).
- Produces: nothing new consumed elsewhere — this completes the BranchSwitcher's public surface
  described in the design spec.

- [ ] **Step 1: Add the three fixed actions and a name-input step**

Replace the body of `BranchSwitcher` in `src/renderer/components/BranchSwitcher.tsx` to add a
`step` state machine (`'list' | 'name' | 'pick-base'`) and the three action rows. Full replacement
of the component function:

```tsx
type Step =
  | { kind: 'list' }
  | { kind: 'name'; mode: 'create' | 'create-from'; from?: string }
  | { kind: 'pick-base' }

export function BranchSwitcher({ shellKey, isPtyId, onClose, onCheckedOut, onError }: Props): JSX.Element {
  const [refs, setRefs] = useState<GitRefs | null>(null)
  const [query, setQuery] = useState('')
  const [busy, setBusy] = useState(false)
  const [step, setStep] = useState<Step>({ kind: 'list' })
  const [nameDraft, setNameDraft] = useState('')

  useEffect(() => {
    void window.apiary.gitListRefs(shellKey, isPtyId).then(setRefs).catch((e: Error) => onError(e.message))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const q = query.trim().toLowerCase()
  const filtered = useMemo(() => {
    if (refs === null) return { local: [], remote: [], tags: [] }
    return {
      local: refs.local.filter((r) => matches(r, q)),
      remote: refs.remote.filter((r) => matches(r, q)),
      tags: refs.tags.filter((r) => matches(r, q)),
    }
  }, [refs, q])

  const checkout = async (name: string): Promise<void> => {
    setBusy(true)
    try {
      await window.apiary.gitCheckoutBranch(shellKey, isPtyId, name)
      onCheckedOut()
      onClose()
    } catch (e) {
      onError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const checkoutRemote = async (remoteRef: string): Promise<void> => {
    setBusy(true)
    try {
      const localName = remoteRef.slice(remoteRef.indexOf('/') + 1)
      await window.apiary.gitCheckoutRemote(shellKey, isPtyId, remoteRef, localName)
      onCheckedOut()
      onClose()
    } catch (e) {
      onError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const checkoutDetached = async (ref: string): Promise<void> => {
    setBusy(true)
    try {
      await window.apiary.gitCheckoutDetached(shellKey, isPtyId, ref)
      onCheckedOut()
      onClose()
    } catch (e) {
      onError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const createBranch = async (from?: string): Promise<void> => {
    const name = nameDraft.trim()
    if (name === '') return
    setBusy(true)
    try {
      await window.apiary.gitCreateBranch(shellKey, isPtyId, name, from)
      onCheckedOut()
      onClose()
    } catch (e) {
      onError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  if (step.kind === 'name') {
    return (
      <div className="modal-backdrop" onClick={onClose}>
        <div className="modal branch-switcher" data-testid="branch-switcher" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
          <input
            className="search"
            data-testid="branch-switcher-name-input"
            placeholder="Branch name"
            autoFocus
            value={nameDraft}
            onChange={(e) => setNameDraft(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') void createBranch(step.from) }}
          />
          <div className="modal-actions">
            <button data-testid="branch-switcher-cancel" onClick={() => setStep({ kind: 'list' })}>Back</button>
            <button className="primary" data-testid="branch-switcher-confirm" disabled={busy} onClick={() => { void createBranch(step.from) }}>
              Create branch
            </button>
          </div>
        </div>
      </div>
    )
  }

  const pickingBase = step.kind === 'pick-base'

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal wide branch-switcher" data-testid="branch-switcher" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
        <input
          className="search"
          data-testid="branch-switcher-search"
          placeholder={pickingBase ? 'Select a ref to branch from' : 'Select a branch or tag to checkout'}
          autoFocus
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />

        <ul className="branch-switcher-list">
          {!pickingBase && (
            <>
              <li>
                <button className="branch-switcher-action" data-testid="branch-switcher-create" onClick={() => { setNameDraft(''); setStep({ kind: 'name', mode: 'create' }) }}>
                  + Create new branch...
                </button>
              </li>
              <li>
                <button className="branch-switcher-action" data-testid="branch-switcher-create-from" onClick={() => setStep({ kind: 'pick-base' })}>
                  + Create new branch from...
                </button>
              </li>
              <li>
                <button className="branch-switcher-action" data-testid="branch-switcher-detached" onClick={() => setStep({ kind: 'pick-base' })}>
                  Checkout detached...
                </button>
              </li>
            </>
          )}

          {refs === null && <li className="empty">Loading…</li>}

          {refs !== null && (
            <>
              <BranchSection
                title="branches" testId="branch-switcher-branch-row" rows={filtered.local} busy={busy}
                onPick={(r) => {
                  if (pickingBase) { setNameDraft(''); setStep({ kind: 'name', mode: 'create-from', from: r.name }) }
                  else void checkout(r.name)
                }}
              />
              <BranchSection
                title="remote branches" testId="branch-switcher-remote-row" rows={filtered.remote} busy={busy}
                onPick={(r) => {
                  if (pickingBase) { setNameDraft(''); setStep({ kind: 'name', mode: 'create-from', from: r.name }) }
                  else void checkoutRemote(r.name)
                }}
              />
              <BranchSection
                title="tags" testId="branch-switcher-tag-row" rows={filtered.tags} busy={busy}
                onPick={(r) => {
                  if (pickingBase) { setNameDraft(''); setStep({ kind: 'name', mode: 'create-from', from: r.name }) }
                  else void checkoutDetached(r.name)
                }}
              />
            </>
          )}
        </ul>
      </div>
    </div>
  )
}
```

(`BranchSection` and `matches` stay as defined in Task 5, unchanged.)

Note: the "Checkout detached..." action reuses the same `pick-base` step as "Create new branch
from...", but a ref picked while `step.kind === 'detached-pick'` should call `checkoutDetached`
directly instead of opening the name step. Since the snippet above only distinguishes a single
`pick-base` step, correct this by giving detached its own step kind — update the `Step` type to:

```tsx
type Step =
  | { kind: 'list' }
  | { kind: 'name'; mode: 'create' | 'create-from'; from?: string }
  | { kind: 'pick-base' }
  | { kind: 'pick-detached' }
```

and change the "Checkout detached..." button's `onClick` to `() => setStep({ kind: 'pick-detached' })`,
`pickingBase` to also cover it (`const pickingBase = step.kind === 'pick-base' || step.kind === 'pick-detached'`),
and each section's `onPick` to branch three ways:

```tsx
                onPick={(r) => {
                  if (step.kind === 'pick-base') { setNameDraft(''); setStep({ kind: 'name', mode: 'create-from', from: r.name }) }
                  else if (step.kind === 'pick-detached') void checkoutDetached(r.name)
                  else void checkout(r.name) // (or checkoutRemote(r.name) in the remote section)
                }}
```

Apply this correction consistently across all three `BranchSection` usages before moving on.

- [ ] **Step 2: Add CSS for the action rows**

Append to `src/renderer/styles.css`:

```css
.branch-switcher-action {
  display: block;
  width: 100%;
  border: 0;
  background: transparent;
  color: var(--accent);
  text-align: left;
  padding: 6px 8px;
  border-radius: 6px;
  cursor: pointer;
  font: inherit;
  font-weight: 600;
}
.branch-switcher-action:hover { background: var(--selected); }
```

- [ ] **Step 3: Write the e2e tests**

Append to `tests/e2e/gitToolbar.spec.ts`:

```ts
test('creates a new branch from the branch switcher', async () => {
  await h.page.getByTestId('toolbar-branch-button').click()
  await h.page.getByTestId('branch-switcher-create').click()
  await h.page.getByTestId('branch-switcher-name-input').fill('feature/created-in-test')
  await h.page.getByTestId('branch-switcher-confirm').click()

  await expect(h.page.getByTestId('branch-switcher')).toHaveCount(0)
  await expect(h.page.getByTestId('toolbar-branch-button')).toContainText('feature/created-in-test')
})

test('creates a new branch from a picked base ref', async () => {
  execFileSync('git', ['branch', 'base-branch'], { cwd: h.repoRoot })

  await h.page.getByTestId('toolbar-branch-button').click()
  await h.page.getByTestId('branch-switcher-create-from').click()
  await h.page.getByTestId('branch-switcher-branch-row').filter({ hasText: 'base-branch' }).click()
  await h.page.getByTestId('branch-switcher-name-input').fill('feature/from-base')
  await h.page.getByTestId('branch-switcher-confirm').click()

  await expect(h.page.getByTestId('toolbar-branch-button')).toContainText('feature/from-base')
})

test('checks out a tag detached', async () => {
  execFileSync('git', ['tag', 'v9.9.9'], { cwd: h.repoRoot })

  await h.page.getByTestId('toolbar-branch-button').click()
  await h.page.getByTestId('branch-switcher-detached').click()
  await h.page.getByTestId('branch-switcher-tag-row').filter({ hasText: 'v9.9.9' }).click()

  await expect(h.page.getByTestId('branch-switcher')).toHaveCount(0)
  // Detached HEAD has no branch name — the branch button disappears rather than showing one.
  await expect(h.page.getByTestId('toolbar-branch-button')).toHaveCount(0)
})
```

- [ ] **Step 4: Run the e2e tests**

Run: `npm run test:e2e -- gitToolbar`
Expected: PASS (all tests in the file)

- [ ] **Step 5: Typecheck, run the full suite, and commit**

Run: `npm run typecheck`
Run: `npm test`
Run: `npm run test:e2e`
Expected: all green — the full e2e suite is run here since this is the last task of the plan.

```bash
git add src/renderer/components/BranchSwitcher.tsx src/renderer/styles.css tests/e2e/gitToolbar.spec.ts
git commit -m "feat: add create-branch, create-from-base, and checkout-detached to BranchSwitcher"
```
