# Working on Apiary

Apiary is an Electron desktop app for browsing, searching and resuming Claude Code sessions across
folders and git worktrees. This file is for whoever works on it next — the things that are not
obvious from the code, and the traps that have already cost someone an afternoon.

## The shape of it

- **`src/main/`** — the Electron main process. Owns the SQLite store, the PTYs, the filesystem
  watcher, git commands and the search index. Everything that touches the machine lives here.
- **`src/renderer/`** — React 18 UI. No Node access: it reaches the main process only through the
  typed bridge in `src/shared/api.ts`, implemented by `src/preload/index.ts`.
- **`src/shared/`** — types and IPC channel names, imported by both sides. A new IPC call means
  touching `shared/api.ts`, `preload/index.ts` and `main/ipc.ts` together.
- **`tests/unit`** and **`tests/integration`** run under Vitest in plain Node; **`tests/e2e`** drives
  the real built app with Playwright.

Two rules the codebase holds to, both learned the hard way:

- **The renderer never supplies a filesystem path.** Anything that reaches a shell or a spawn is
  resolved in the main process from an id it already trusts (`resolveShellCwd`, `buildResumeCommand`'s
  UUID check, `readImage`'s confinement to its own directory). Keep it that way.
- **Working directories come from the `cwd` field inside a session's JSONL**, never from the
  directory name under `~/.claude/projects`, which is a lossy encoding of the path.
- **Git's prose is not an interface.** Where a path has to come out of a git failure — the
  worktree holding a branch you tried to check out — it is looked up with
  `git worktree list --porcelain`, not parsed out of the English, quoted error message. That also
  keeps the rule above: the path the app then acts on is one the main process derived itself.

## The native-module ABI trap

`better-sqlite3` and `node-pty` are native modules, and Electron's Node ABI is not your system
Node's. The same `node_modules` cannot serve both, so each entry point rebuilds them first:

| Command | Rebuilds for | Runs |
| --- | --- | --- |
| `npm start` | Electron | the app |
| `npm test` | Node | Vitest |
| `npm run test:e2e` | Electron | Playwright against the built app |
| `npm run screenshot` | Electron | the README screenshot script |

**Whichever you ran last is the ABI the modules are left in.** Two consequences:

- Running `npx vitest run` or `npx playwright test` *directly* skips the rebuild, and you get a wall
  of failures that look like real bugs. `NODE_MODULE_VERSION` in the error is the tell.
- Never run `npm test` while a Playwright run is in flight (or vice versa) — the rebuild lands under
  the running suite and poisons it. This has produced "20 failing tests" that were nothing of the
  kind more than once.

## `ELECTRON_RUN_AS_NODE`

If Electron's binary has been run as a plain Node interpreter in your shell, this variable is set and
is inherited by everything started from it. Every Playwright launch then dies with
`Process failed to launch` and `electron does not provide an export named 'BrowserWindow'` — an error
that looks nothing like its cause. `tests/e2e/helpers.ts` strips it from the launch environment, so
this should stay fixed; if you see that error anywhere else, check the variable first.

## Terminals and PTYs

- Shells can be spawned with extra environment (`SpawnOptions.env`); `pty/promptPath.ts` uses it to
  set `PROMPT_DIRTRIM`, which is bash's own way to shorten `\w` — chosen over writing a `PS1`
  because overwriting a prompt someone configured themselves, from a checkbox, is not a trade
  anyone would take. zsh has no equivalent and is deliberately left alone.
- Sessions are resumed as `$SHELL -l -c 'exec claude --resume <uuid>'`. The login shell is what puts
  nvm/homebrew installs of `claude` on `PATH`.
- **Writing to a PTY is not the same as a program receiving it.** Until a full-screen program starts
  and puts the tty in raw mode, the line discipline is in canonical mode: it buffers by line and
  translates carriage return to newline. A prompt written into that window arrives mangled — this is
  exactly the bug behind "the message appears in Claude's input box but never sends". `sendPrompt`
  waits for the child to take the screen (`CSI ?1049h`) and for its output to settle before writing.
  If you touch prompt delivery, `tests/integration/appService.test.ts` has a stand-in slow-starting
  TUI that reproduces the failure.
- Multi-line prompts are delivered as a bracketed paste (`ESC[200~ … ESC[201~`), or the first newline
  submits a fragment.
- Key handling in the terminal goes through xterm's `attachCustomKeyEventHandler`. A DOM listener on
  the host element runs *after* xterm has already written to the PTY, so `preventDefault()` there
  cannot stop a key — which is how you end up copying a selection *and* sending SIGINT.

## Windows, and what belongs to which

Apiary is multi-window, and the division is worth stating because getting it wrong is silent:

- **A pty belongs to the main process, not to a window.** Two windows can show the same session,
  and both are attached to the one process. `PtyManager` keeps a bounded buffer of each pty's
  recent output (`replay()`) precisely so a view that attaches *late* — a second window, a tab
  moved into one — is not looking at an empty rectangle while a program sits at a prompt saying
  nothing.
- **Never spawn over an id that is already live.** `spawn()` kills whatever is under an id before
  taking it. Shell tab ids are minted per window and the first is always `1`, so a session opened
  in a second window asked for the very pty the first was using — and killed a build with it.
  `openShell` now attaches instead.
- **Whether a session has a terminal is a main-process question** (`ptyRunning`), not something a
  window can know by remembering what it started.
- **A detached window** — one tab, no sidebar — is an ordinary window with `?detach=<key>` in its
  URL. The key travels in the URL for the same reason the window number does: it decides the whole
  layout, and a window that asked over IPC would paint the sidebar first and rearrange itself
  after.
- **A drag does not cross a window boundary at all.** Not the data — the *events*. An HTML5 drag
  started in one `BrowserWindow` delivers no `dragenter`, `dragover` or `drop` to another, so the
  receiving window never hears about the gesture and has nothing to accept. The only part of a
  cross-window drag that reaches any of our code is `dragend` in the window it started in. So
  where a tab went is worked out from geometry: the release point in screen coordinates against
  the windows' bounds (`windowAtPoint.ts`), decided in the main process, which then *tells* the
  receiving window to take the tab. Anything built on the receiving window seeing the drop is
  built on something that does not happen — this shipped once and did nothing at all.

## Search

`src/main/search/` keeps an FTS5 index in a database of its own, because it is derived data that can
always be rebuilt from the JSONL. **Tokenisation is the whole design**: punctuation is split on
rather than kept, so `!1257` and `1257` find the same session, and `2260-remove-prefill` matches both
whole and by any word in it. Adding `-` or `!` to `tokenchars` would make each of those one
indivisible token and break every partial search anyone would type. User queries go through
`toMatchQuery`, which reduces them the same way — typed raw into `MATCH`, `!1257` is a syntax error,
not a search.

Notes live in a second FTS table in the same file, deliberately apart from the transcript chunks.
A note is written by hand and changes on its own schedule, while `chunks` is keyed to a
transcript's size and mtime — folding the two together would mean either re-reading a whole JSONL
to record a one-line note, or a freshness check that no longer describes what it covers. Keeping
them apart is also what lets the two settings be independent, and what makes a note searchable the
instant it is saved. The notes themselves belong to the *session store*: they are the one thing
here that cannot be rebuilt from `~/.claude/projects`.

Indexing is incremental (unchanged files are skipped by size and mtime without being opened) and
yields between files. It is deliberately *not* a worker thread: the renderer is already a separate
process, so indexing cannot freeze the UI, and yielding costs far less than a second bundled entry
point would.

## Conventions

- **Comments explain why, not what.** The density here is higher than most codebases on purpose —
  most comments record a decision, a measurement, or a bug that will otherwise be reintroduced. Match
  it. A comment that restates the line below it is noise; one that says why the obvious approach was
  wrong is the point.
- **`styles.css` uses CSS custom properties for colour *and* for shape.** No literal colours (the
  scrollbar arrow data-URI SVGs are the one documented exception), and no literal control heights,
  paddings, corner radii or focus rings either — they are tokens at the top of the file for the
  same reason: a theme is not only a palette.
- **Controls go through the control layer**, not through a rule of their own. Every button that
  looks like a button resolves one base rule; `.btn` is what new markup uses, with `.primary` and
  `.danger` for the filled variants and `.small` for a compact one. The app previously had six
  near-identical button rules with four different paddings between them, which is how a Cancel and
  a Save ended up side by side at different heights — and a button belonging to none of them fell
  through to Chromium's native macOS control, which is white and looks like another application's.
  Checkboxes are drawn by the app for that second reason: `accent-color` alone only colours the
  checked state, leaving the unchecked box white in a dark panel.
- **Tests are written as statements about behaviour**, not about implementation: read a few existing
  names before adding one.
- **A pure helper wanted on both sides of the bridge lives in `src/shared/`**, never in
  `src/main/`. `tsconfig.node.json` has no DOM lib, so a unit test that reaches into a renderer
  module drags it into that project; and the renderer has no Node. `shared/promptPath.ts` and
  `shared/forkLabel.ts` exist for that reason.
- TypeScript is strict; `npm run typecheck` covers both tsconfigs and both must pass.

## Session-bar plugins

`src/main/plugins/` lets things contribute a button to the bar under a session without the bar
knowing what they are. A plugin answers one question — given this folder and this branch, what
would you put on the bar? — and the answer is *data*: an icon chosen from a fixed set the renderer
knows how to draw, a label, and an action from a closed list (today, "open this URL"). No markup
crosses the boundary, so a plugin cannot put arbitrary content in the window, and the URL is
re-checked in the main process before `shell.openExternal` sees it.

Two things the registry guarantees, both learned from what the bar is for:

- **A plugin that throws contributes nothing and disturbs nothing else.** The bar carries git state
  that matters; an integration failing to reach its API must not take that with it.
- **A plugin is never on the render path.** The bar redraws on every git-status poll. Results are
  cached per folder+branch and refreshed in the background, with a stale answer served meanwhile,
  so a network call cannot decide how fast switching sessions feels.

**Plugins declare their settings too**, in the same declarative spirit: a plugin lists fields
(kind, key, label, help, default) and the Plugins section of Settings draws them, storing values
namespaced under `pluginSettings[pluginId]`. Nothing in the settings dialog knows what a field
means, so a new plugin needs no changes there — only a new *kind* of field does. Changing a value
recomputes what is cached in place rather than clearing it: clearing blanks the bar until the
lookup lands, and during that gap the window still holds the answer computed under the old setting,
which is a click on a button that does the thing you just changed.

The GitLab plugin shells out to **`glab`** rather than calling the API. Talking to the API means
holding a token, which means storing a credential, offering a field to paste it into, keeping it
out of settings backups, and explaining what scope it needs — all of which `glab` has already
solved, including for self-hosted instances. The consequence worth remembering: Apiary never sees a
GitLab credential, and the feature's setup instruction is `glab auth login`. The half that needs no
API (offering to create an MR) is built from the git remote alone, so it survives `glab` being
absent.

## Changing a default reaches nobody

`saveSettings` writes the **whole** settings object, and the app writes it whenever the first
window is moved or resized. So every `settings.json` in existence already pins every field to
whatever the default was on the day it was first written, and **changing `DEFAULT_SETTINGS` only
ever affects someone who has never run the app**. This was found the slow way: the prompt trim was
"defaulted on" in 1.13.2 and nothing changed for anyone.

Changing a default for existing users means a migration: bump `SETTINGS_VERSION`, extend
`migrateSettings`, and only touch values that are still exactly what the old default was — someone
who chose a value has said what they want. The migrated result is written back at startup, or it
would be re-applied on every launch and undo a later deliberate change.

## Settings arriving over IPC

`AppSettingsPayload` is typed, but it crosses a process boundary from a renderer that is not
guaranteed to be the same build as the main process — a dev reload, or an update that reloads the
window. A key the sender has never heard of is simply absent, so **treat a missing field as
"unchanged", never as `false`**: `ipc.ts`'s settings merge does this deliberately. Getting it wrong
once cost a whole afternoon, because the failure hides itself — the feature switched off in memory,
its index was wiped as a switch-off is meant to do, and `JSON.stringify` dropped the undefined key
so the file on disk still said the feature was on.

## The diagnostic log

`src/main/log/` writes a local log when the user switches it on in Settings → Diagnostics. It
exists because "Open installer" failed on a user's Ubuntu with an Electron IPC message, every
hypothesis was disproved in a container, and the app had recorded nothing about what it tried.

Four rules, and they are the feature rather than decoration:

- **Off is the default, and off means nothing** — no directory, no file, `log()` returns
  immediately. A diagnostic that writes by default records things nobody agreed to.
- **Conversation content is never passed to it.** Not redacted — never passed. No amount of
  scrubbing makes a transcript safe to hand to someone else, so prompts, replies and message text
  simply do not go in. Log *what the app did*, never *what the user said*.
- **Redaction happens inside the logger** (`shared/redact.ts`), not at call sites, so it cannot be
  forgotten: home directories become `~`, credential-shaped strings are stripped, long fields are
  truncated. Add a rule there and every existing call gets it.
- **It must never break the app.** Every entry point swallows its own errors. A full disk stops
  logging; it does not stop the thing being logged.

When adding a log line, ask what a stranger reading this file would need to tell two
explanations apart — that is the bar the "Open installer" bug set, and failed. The existing lines
are placed at exactly the points where earlier bugs were invisible: pty spawn/exit and the
attach-instead-of-spawn case, the prompt-trim environment, what the updater handed to the
desktop and what came back, which window a cross-window drop resolved to, and every IPC rejection.

## Measure before fixing

The bugs in this app that took longest were the ones where a plausible explanation was acted on
without checking. The terminal-cutoff bug was "fixed" twice before someone measured the actual
element heights and found a 352px terminal inside a 167px row. The "needs Enter twice" bug got a
delay-tuning fix that was irrelevant, because the real cause was a write landing a second before the
program existed — found only by tapping the PTY and looking at the bytes. "Notes are saved but never
indexed" was found by reading the user's actual `apiary.db` and `search.db` and running the app's own
sync against a copy of them, which showed the code worked and the *state* was wrong.

One trap while doing that: `sqlite3 -readonly` cannot open the `-shm` file, so it silently ignores
everything in the WAL and reports an out-of-date picture of the database. Copy the `.db` and `-wal`
together (never the `-shm`) and read the copy.

Both are cheap to do: a short script with `node-pty`, a `getBoundingClientRect` in the devtools
console, a `tail` of what the child actually received. Do that before changing code, and say what you
measured.

## Updating

`src/main/update/` checks GitHub Releases and offers what it finds. The shape of it is decided by
one fact, in `capability.ts`: **Squirrel.Mac will only replace a bundle whose signature satisfies
the running app's designated requirement, and Apiary is unsigned.** So an unsigned macOS build can
never install an update in place — it downloads the .dmg, verifies it, and opens it for the user.
Linux AppImage can install itself; a .deb cannot (it needs root). The capability is decided up
front rather than discovered at install time, because the alternative is failing *after* a
download.

The day a Developer ID certificate exists, `hasDeveloperIdSignature()` returns true, macOS becomes
`auto`, and nothing else has to change.

Two things are easy to break from outside the code:

- **The release must contain `latest-mac.yml` / `latest-linux.yml`.** They are what an installed
  app reads to discover a version; a release without them is invisible to every existing install.
  electron-builder generates them because `electron-builder.yml` declares a `publish` provider, and
  `.github/workflows/release.yml` uploads them alongside the installers.
- **The macOS `zip` target must stay.** `latest-mac.yml` names it, and Squirrel installs from it —
  a release with only a .dmg describes a file that is not there.

The service (`updateService.ts`) keeps every rule — when to check, what to offer, what a skip
means — behind an injected `UpdateBackend`, so `tests/integration/updateService.test.ts` can drive
the whole state machine with a stub and a fake clock. That matters more here than elsewhere: the
real path cannot be exercised without publishing a release, so whatever is not tested there is not
tested at all. `APIARY_FAKE_UPDATE` does the same job for the E2E suite.

## Releasing

`CHANGELOG.md` follows Keep a Changelog, and the version in `package.json` is bumped per release. A
`v*` tag push triggers `.github/workflows/release.yml`, which builds and attaches the macOS and Linux
artifacts **and the `latest-*.yml` update metadata** (see Updating above — without it the release is
invisible to installed copies). **Ask before pushing, tagging or releasing** — the maintainer tests
builds by hand first. Never add AI attribution to a commit message.
