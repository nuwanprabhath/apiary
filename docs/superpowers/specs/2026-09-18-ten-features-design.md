# Ten features for 1.18.0 — design

One release, ten independent features. Each is its own task; they share a branch
and ship together as 1.18.0.

## Global constraints

- Version bumps to 1.18.0 with a new changelog section. Never reuse a published
  version.
- Two test suites, never at once: `npm test` (vitest, node ABI) and
  `npm run test:e2e` (playwright, electron ABI). Never run `npx vitest` or
  `npx playwright` directly.
- Every new colour, radius and spacing value is a token in the stylesheet, not a
  literal, per CLAUDE.md.
- A session's `cwd` is read from inside its JSONL transcript, never derived from
  the `~/.claude/projects/<encoded-path>` directory name.
- No feature may add a blocking synchronous call to the main process on a path
  that runs per keystroke.
- Every feature carries tests: unit tests for pure logic, e2e for user-visible
  behaviour.

---

## 1. Installer that works on Ubuntu, and a copyable command everywhere

**Problem.** On Ubuntu, "Open installer" does nothing. The diagnostic log shows
`openPath returned ms:10008 error:null` — `OPEN_TIMEOUT_MS` elapsed and the
race in `settle()` resolved with no error, so the code reported success while
nothing had launched. Two causes compound: a downloaded AppImage has no
executable bit, so no handler can run it; and the timeout path is
indistinguishable from success.

**Design.**

- `downloadInstaller()` sets mode `0o755` on the downloaded file on Linux, after
  the SHA-512 check passes.
- `openInstaller()` returns a discriminated result — `{ok: 'opened'}`,
  `{ok: 'revealed'}`, or `{ok: 'failed', reason}` — instead of resolving void.
  A timeout is no longer success: it reveals the file in the file manager and
  reports `revealed`, and the renderer tells the user which happened.
- `installInstructions()` gains a copyable command for every assisted platform:
  - `.deb` — `sudo apt install '<path>'` (unchanged)
  - AppImage — `chmod +x '<path>' && '<path>'`
  - macOS `.dmg` — mount, copy to /Applications, detach, as one line
- The "Copy install command" button in `UpdateBanner` therefore appears for every
  assisted update, not only `.deb`.

Paths are single-quoted with embedded single quotes escaped, because a path may
contain spaces.

**Tests.** Unit tests for the command builder per platform, including a path with
a space and a path with an apostrophe; unit tests for the three `openInstaller`
outcomes against a faked `shell`; an e2e asserting the button and its label in the
downloaded phase.

---

## 2. Restore windows and tabs on relaunch

**Problem.** Only `selectedSessionId` survives a restart. Every other window,
tab, pane and shell is lost — painful straight after an update, which is exactly
when the app restarts.

**Design.** A main-process `SessionLayoutStore` persists, per window:

```
{ windows: [ { number, bounds, layout: {preset, panes:[{id, tabs:[{key, view,
  shells:[{id,name}], activeShell}], activeTab}]}, live: [sessionId...] } ] }
```

- Each renderer reports its layout to main on change, debounced ~500ms, and main
  writes the file debounced again. Main also writes on `before-quit`.
- `bounds` is captured for every window, not just the first; restore validates
  each against the current displays with the existing `boundsAreOnScreen`.
- On launch, main recreates each recorded window with its bounds, and each
  renderer rebuilds its panes and tabs from the record.
- A session that was live at quit is resumed: the renderer spawns
  `claude --resume` for it, as the user chose. Shell tabs are recreated in the
  same cwd, empty — a shell's scrollback is not restored.
- A recorded session whose transcript or cwd no longer exists is dropped
  silently; restore never fails as a whole because one entry went stale.
- Restoring is skipped when the app is launched with `?detach=` (tab tear-off)
  and when a window record contains no tabs.

**Tests.** Unit tests for the store: round-trip, stale-entry pruning, off-screen
bounds, debounce. An e2e that opens two tabs in a split, relaunches, and asserts
the preset, both tabs and the active tab return.

---

## 3. GitLab MR status beside a reference

**Problem.** A session title or note often names an MR (`!1267`); checking whether
it merged means leaving the app.

**Design.**

- A pure `parseMrRefs(text)` finds `!<digits>` references, ignoring ones inside a
  word (`foo!12`) and inside a URL.
- Resolution runs in main: the session's project path gives a git remote; the
  remote gives host and project. `glab api projects/<enc>/merge_requests/<iid>`
  is spawned with a short timeout; the state (`opened`, `merged`, `closed`,
  `locked`) is cached per host+project+iid with a TTL (default 10 minutes) and an
  in-flight map so concurrent lookups share one call.
- Rendering: the reference becomes `!1267 (merged)` with a status colour, in the
  session row title and in the hover card's note. Text layout is unchanged when
  the status is unknown.
- Degrades silently: no `glab` on PATH, no GitLab remote, a non-zero exit, or a
  timeout all leave the plain `!1267`. A single "glab not found" state is cached
  so a missing binary is not probed repeatedly.
- No token is ever read or stored by Apiary; `glab`'s own credentials are used.

**Tests.** Unit tests for `parseMrRefs` (multiple refs, word boundaries, URLs),
for remote→project parsing (ssh and https forms), and for the cache (TTL expiry,
in-flight sharing, negative caching) against a faked spawn. An e2e with a stubbed
resolver asserting the rendered suffix.

---

## 4. Recent section

**Design.** A new collapsible section below Pinned listing sessions whose
`lastActiveAtMs` is within the window (default 24 hours), most recent first,
excluding pinned sessions and sessions already shown in Active. Two settings: an
on/off switch and a duration in hours (1–168, validated).

Dismissal: shared state maps `sessionId → dismissedAtMs`. A session is hidden
while `lastActiveAtMs <= dismissedAtMs`, so working in it again brings it back.
Dismissed entries older than the window are pruned so the map cannot grow without
bound.

**Tests.** Unit tests for the selector: window boundary, ordering, pinned
exclusion, dismissal and reappearance, pruning. An e2e for the section, its
dismiss button and the two settings.

---

## 5. Active section — sessions open across all windows

**Design.** Main gains a `TabRegistry`: each window reports the tabs it has open
(session key, view, ptyId) and unregisters on close; main is already the owner of
every pty, so it can attach status to each entry.

Status is derived from the pty stream by a pure `classifyActivity(recentOutput,
lastOutputAtMs, now)`:

- `running` — output within the last ~2s
- `waiting` — the tail matches a prompt for input (Claude's question box or a
  permission prompt)
- `idle` — alive, no output, no prompt
- `stopped` — the pty has exited

The renderer subscribes to registry changes and renders a section above Pinned:
one row per open session with the window number and a status dot — a pulsing blue
ring for `running`, a slower amber pulse for `waiting`, dim grey for `idle`, a
hollow ring for `stopped`. Motion respects `prefers-reduced-motion`, which drops
the animation and keeps the colour. This matches how other agent UIs (Conductor,
Cursor's agent list) show agent state: colour plus motion, no text.

Clicking a row focuses that window and selects that tab, via a main-process
`focusTab(windowNumber, key)`. Nothing moves between windows.

**Tests.** Unit tests for `classifyActivity` over recorded output samples
including a permission prompt and a question box; unit tests for the registry
(register, replace, unregister on window close). An e2e with two windows
asserting the section lists both and that clicking focuses the right window.

---

## 6. Search that keeps up, and flat ranked results

**Problem.** Each keystroke calls `tree(query)`, which rebuilds the entire tree
from SQLite, runs the FTS query, then filters — synchronously in main — and the
renderer re-renders the whole tree. Typing visibly lags.

**Design.**

- The input is uncontrolled by the query pipeline: keystrokes update the input
  state immediately and a debounced (150ms) value drives the search, with the
  in-flight request superseded rather than awaited.
- `tree()` splits: the unfiltered tree is fetched once and cached in the
  renderer, refreshed only on `onTreeChanged`. Filtering by title, path and
  branch runs in the renderer against that cache. Only content and note search
  (FTS) still calls main, and only when those settings are on.
- Results are capped (200) with a "showing first 200" note.
- While a query is active the sidebar renders a **flat ranked list**: no folders,
  no worktree nesting. Each row is the session title with its worktree as a
  subtitle, ordered by score. Clearing the box restores the tree with its previous
  collapse state intact.
- Ranking: exact title match, then title prefix, then title subsequence, then
  path/branch, then content — ties broken by `lastActiveAtMs` descending.

**Load test.** A test generates 5,000 synthetic sessions across 200 projects and
asserts that filtering a 3-character query stays under a fixed budget, and that
the renderer's keystroke-to-paint stays under 50ms. The budget is asserted, not
printed, so a regression fails the suite.

**Tests.** Unit tests for the ranking comparator and the cap; the load test
above; an e2e asserting flat results while searching and tree restoration after
clearing.

---

## 7. Move a session to another worktree

**Design.** Dragging a session row onto a folder or worktree row shows a drop
highlight; dropping opens a confirmation naming the session and both paths.

On confirm, main:

1. resolves the target to a canonical project (existing `resolveProject`),
2. moves the transcript JSONL into the target cwd's Claude projects directory
   (same encoding Claude Code uses), refusing if a file of that name is already
   there,
3. records a cwd override on the session row — a new column alongside
   `custom_title` and `note`, which the scanner must not clobber,
4. updates `cwd`/`project_path`, ensures the target `project` row exists, and
   signals a tree change.

The override is what makes the move stick: the transcript's own recorded cwd
stays stale, so without it the next scan would move the session back.

A session that is currently live cannot be moved — the drop is refused with an
explanation, because a running pty cannot change directory.

**Tests.** Unit tests for the store move (override survives a rescan, target
collision refused, missing file refused) and for the encoding of the target
directory. An e2e dragging a session onto another worktree, confirming, and
asserting it renders under the new worktree and still opens.

---

## 8. Branch switcher: Enter takes an exact match

**Design.** When the typed query equals a ref name exactly (case-sensitive, local
refs before remote), that row is marked as the active choice and Enter checks it
out. With no exact match, Enter does nothing, as today — a query that merely
narrows the list is not a choice. Arrow-key navigation of the list is explicitly
out of scope; clicking remains the way to pick a non-exact match.

**Tests.** Unit tests for the selection rule (exact wins over a longer substring
match; local before remote). E2e: type a full branch name, press Enter, assert
the checkout; type a partial name, press Enter, assert nothing happens.

---

## 9. Open in VS Code from the hover card

**Design.** Main detects VS Code once per launch: `code` on PATH, else the known
macOS bundle path, else the Linux package paths. The hover card shows an "Open in
VS Code" button only when detection succeeded and the session's folder exists.
Clicking spawns `code <cwd>` detached, and reports a failure as a notification.
The spawn passes the path as an argument array, never through a shell.

**Tests.** Unit tests for detection (found, not found, cached) and for the spawn
arguments. An e2e asserting the button appears with detection stubbed and is
absent without it.

---

## 10. Terminal paste: no markers, no duplicates

**Problem, with a root cause.** Two independent paste paths run for one
keystroke. `TerminalView`'s custom key handler reads the clipboard and writes
straight to the pty with `ptyWrite`; separately, xterm listens for the browser's
own `paste` event on its textarea, which Ctrl+Shift+V also fires, and pastes the
same text itself. `attachCustomKeyEventHandler` cannot suppress that second path —
it governs keydown handling, not the DOM paste event. One bug, two faces: the text
arrives twice, and xterm's copy carries bracketed-paste markers
(`^[[200~`/`^[[201~`) that the raw write does not, so the markers can land as
visible text.

**Design.** There must be exactly one write per paste. The Ctrl+Shift+V, Cmd+V
and context-menu paths all route through a single function that calls
`term.paste(text)` — xterm's own path, which emits bracketed-paste markers only
when the application has enabled that mode — and the key handler both stops the
keydown and prevents its default, so the browser's paste event cannot start a
second write. The raw `ptyWrite` of clipboard text is removed.

This is fixed under the debugging discipline: a failing test that reproduces the
duplicate and the markers comes first.

**Tests.** A unit test over a faked terminal asserting one write per paste and no
literal markers when bracketed mode is off; an e2e pasting into a shell and
asserting the line contains the text exactly once and no `[200~`.

---

## Delivery

One branch, one task per feature, each with its own tests and review. 1.18.0 is
tagged only after the user has tested the branch.
