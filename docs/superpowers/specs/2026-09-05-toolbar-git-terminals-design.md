# Toolbar: Git Branch Controls + Multi-Terminal Panel

Branch: `feat/toolbar-git-terminals`

## Motivation

The bottom pane currently has a single "Hide shell"/"Show shell" text button and exactly one
shell pty per session. This adds VS Code-style git branch controls (switch/create branch, pull,
push, copy branch name) and turns the single shell into a list of independently running
terminals (add, switch, rename, delete), all exposed through a proper, extensible toolbar instead
of one bare button.

## 1. Toolbar

A new `Toolbar` component renders the bottom-pane header as a row built from an array of button
descriptors (`{ id, icon, title, onClick, active?, disabled? }`) rather than hardcoded JSX per
button — adding a future toolbar button means appending one entry, not editing markup in multiple
places. Two groups: left-aligned (shell toggle, branch, pull, push, copy) and right-aligned (new
terminal, toggle terminal list).

- **Hide/Show shell** — same behavior and `shell-toggle` testid as today, restyled to match the
  new icon-button look (border, hover, active — consistent with the sidebar refresh button fixed
  earlier) instead of looking like plain text.
- **Branch button** — label is the current branch name, from a new `gitStatus(cwd)` IPC call;
  also shows ahead/behind counts (e.g. `↓2↑1`) next to the name. Click opens the BranchSwitcher
  (see §2).
- **Pull (⬇) / Push (⬆)** — two separate buttons (replacing a single VS Code-style sync icon).
  Pull runs `git pull`. Push runs `git push`, and if there's no upstream yet, retries as
  `git push -u origin <branch>` (detected from the specific "no upstream branch" stderr, not by
  pre-checking) so a first push doesn't need a separate "publish" step. Both show a brief spinning
  state (same visual language as the sidebar refresh spinner) and re-fetch branch/ahead-behind
  counts on completion.
- **Copy** — copies the current branch name via `navigator.clipboard.writeText`.
- All git operations run against the **current session/pending terminal's cwd** (the same cwd
  the shell already uses) — not necessarily the repo root; git resolves the repo from a
  subdirectory on its own.
- **No background polling/fetching.** Ahead/behind counts are computed from already-fetched refs
  only (`git rev-list --left-right --count HEAD...@{u}`) and refreshed on toolbar mount, after a
  checkout, and after pull/push — never a silent network fetch on a timer.
- Errors (merge conflict, no upstream + push failure for a real reason, network failure, dirty
  tree blocking checkout, etc.) surface through the **existing error banner** (`error-banner`),
  using git's stderr text as the message — no new dialog type.

## 2. BranchSwitcher (branch quick-pick)

A modal opened by the branch button, matching VS Code's branch quick-pick:

- Search input at top, filtering everything below by substring (case-insensitive) as you type.
- Three fixed actions above the list, always visible: **Create new branch...**, **Create new
  branch from...**, **Checkout detached...**.
- Below that, three sections: **Branches** (local), **Remote branches**, **Tags** — each row shows
  the ref name plus a second, muted line with relative commit time, short sha, and truncated
  commit subject (two-line rows, as in the reference screenshot).
- Clicking a **local branch** row checks it out (`git checkout <name>`).
- Clicking a **remote branch** row creates+checks out a local tracking branch
  (`git checkout --track <remote>/<name>`, local name = the part after the last `/`).
- Clicking a **tag** row checks out detached (`git checkout --detach <tag>`).
- **Create new branch...** swaps the quick-pick body for a single text input; Enter creates
  (`git checkout -b <name>`) from current HEAD.
- **Create new branch from...** first reuses the same filtered branches/tags/remote list to pick
  a base ref, then shows the same name-input step, creating from that ref instead of HEAD.
- **Checkout detached...** reuses the same ref list; selecting one does a detached checkout.
- On any successful checkout/create, broadcast the existing `apiary:tree-changed` IPC event (the
  same one `renameSession`/`removeSession` already use) so the sidebar's branch label refreshes
  without a restart.

### Backend: `src/main/git/branchOps.ts`

New module, same `execFile`-based pattern as the existing `src/main/git/worktreeResolver.ts`
(a private `git(cwd, args)` helper that rejects with the real stderr on failure — no swallowing
errors into `null` the way `worktreeResolver`'s own helper does, since these calls must surface
real failures to the UI):

- `status(cwd): Promise<{ branch: string | null; ahead: number; behind: number; hasUpstream: boolean }>`
- `listRefs(cwd): Promise<{ current: string | null; local: RefEntry[]; remote: RefEntry[]; tags: RefEntry[] }>`
  where `RefEntry = { name: string; relativeDate: string; author: string; shortSha: string; subject: string }`,
  built from one `git for-each-ref` call per ref-type with a `--format` string, sorted by
  `-committerdate`.
- `checkoutBranch(cwd, name): Promise<void>`
- `checkoutRemote(cwd, remoteRef, localName): Promise<void>`
- `checkoutDetached(cwd, ref): Promise<void>`
- `createBranch(cwd, name, from?: string): Promise<void>`
- `pull(cwd): Promise<void>`
- `push(cwd): Promise<void>` (handles the missing-upstream retry described above)

### IPC

New channels in `src/shared/api.ts` (`CHANNELS` + `ApiaryApi`): `gitStatus`, `gitListRefs`,
`gitCheckoutBranch`, `gitCheckoutRemote`, `gitCheckoutDetached`, `gitCreateBranch`, `gitPull`,
`gitPush`. Wired directly to `branchOps.ts` in `ipc.ts` (stateless, cwd-scoped — no `AppService`
involvement needed), each followed by `send(CHANNELS.treeChanged)` on the ones that change branch
state (checkout/create/pull, not push/status).

## 3. Multi-terminal side panel

- **+** button spawns a new, independently-running shell pty alongside any existing ones for the
  current session (all keep running in the background, VS Code-style) — keyed
  `shell:<shellKey>:<n>` where `n` increments per shellKey.
- A **toggle-list** button opens a narrow side panel listing every open terminal for the current
  session as rows (icon + name).
- Clicking a row switches which terminal is shown. Hovering a row reveals a **trash icon** that
  kills that pty (`ptyKill`, already exposed — no new backend needed for delete) and removes the
  row. Renaming is inline (reusing the same affordance as `EditableSessionTitle`'s pencil-button
  pattern) — label only, kept in renderer state, not persisted to disk; same lifetime as the rest
  of the app's shell bookkeeping today (lost on restart, exactly like the existing single shell
  already is).
- Deleting the **last** remaining terminal for a session collapses the pane back to "Show shell",
  same as today when nothing is open.
- Backend change: `openShell(sessionId, tabId = '1')` and `openShellForPty(ptyId, tabId = '1')`
  gain an optional tab-id parameter, appended to the spawned pty id
  (`shell:${sessionId}:${tabId}`). Defaulting to `'1'` keeps the existing single-shell behavior,
  its pty id shape, and its e2e tests (`shell-toggle`, `terminal-shell` testids) unchanged for the
  first/default terminal.
- Renderer-side: `App.tsx`'s `shells: Set<string>` becomes a `Map<string, TerminalTab[]>` keyed by
  `shellKey`, where `TerminalTab = { id: string; name: string }`; `shellOpen`/active-tab tracking
  extends the same way `visiblePendingId` already tracks "which of several things is currently
  shown".

## Error handling

Every new IPC call can reject (git failures, a pty that already exited, etc.); all such rejections
are caught at the call site and routed into the existing `setError`/`error-banner` state, the same
pattern `onResume`/`confirmDelete` already use in `App.tsx`.

## Testing

- Unit tests for `branchOps.ts` with a mocked `execFile` (success and failure paths, missing
  upstream retry logic for `push`).
- E2e coverage (extending the existing Playwright suite, using a scratch git repo fixture the same
  way current fixtures use scratch session directories):
  - Opening the branch switcher, filtering, and checking out an existing local branch.
  - Creating a new branch via **Create new branch...**.
  - Pull and push against a local scratch remote.
  - Opening a second terminal via **+**, switching between tabs, renaming one, deleting one (and
    confirming the remaining one is still usable).
  - Deleting the last terminal collapses the pane to "Show shell".

## Out of scope (YAGNI)

- Background/periodic fetch of remote refs (no silent network calls).
- Split-terminal / terminal grouping (not requested).
- Merge-conflict resolution UI beyond surfacing git's own error text.
- Persisting terminal tabs/renames across an app restart.
