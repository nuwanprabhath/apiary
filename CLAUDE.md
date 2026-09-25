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
  and both are attached to the one process. A view that attaches *late* — a second window, a tab
  switched back to, a tab moved between panes — is caught up from a **rendered snapshot**
  (`PtyManager.snapshot()`, built by `ScreenBuffers` with `@xterm/addon-serialize`), not from the
  raw byte history (`replay()`). The bytes were produced at whatever widths the session had over
  its life, by a program that places each word at an absolute column, so replayed into a narrower
  pane they scrambled the conversation. `TerminalView` paints the snapshot at the snapshot's own
  size, waits for xterm to *parse* it (`write()` is async, `resize()` is not), and only then fits
  and resizes the pty so the program repaints. Change that order and the scrambling returns —
  `tests/unit/screenSnapshot.test.ts` measures it against the recorded sessions.
- **Never spawn over an id that is already live.** `spawn()` kills whatever is under an id before
  taking it. Shell tab ids are minted per window and the first is always `1`, so a session opened
  in a second window asked for the very pty the first was using — and killed a build with it.
  `openShell` now attaches instead.
- **Whether a session has a terminal is a main-process question** (`ptyRunning`), not something a
  window can know by remembering what it started.
- **A detached window** — one tab, no sidebar — is an ordinary window with `?detach=<key>` in its
  URL. The key travels in the URL for the same reason the window number does: it decides the whole
  layout, and a window that asked over IPC would paint the sidebar first and rearrange itself
  after. The rest of the tab rides in `?transfer=` (see `TabTransfer`).
- **A tab moving between windows carries its processes, not just its key.** A session started or
  forked here runs under a `new:<uuid>` pty id that only the window which started it maps to the
  session id (`ptyOverrides`), and its shells hang off that id. Handed the bare key, the receiving
  window found nothing running and showed a live session as stopped. `TabTransfer` carries the pty
  id, the view and the shell tabs; `tab-adopt` and the detached window's URL both use it.
- **A drag does not cross a window boundary at all.** Not the data — the *events*. An HTML5 drag
  started in one `BrowserWindow` delivers no `dragenter`, `dragover` or `drop` to another, so the
  receiving window never hears about the gesture and has nothing to accept. The only part of a
  cross-window drag that reaches any of our code is `dragend` in the window it started in. So
  where a tab went is worked out from geometry: the release point in screen coordinates against
  the windows' bounds (`windowAtPoint.ts`), decided in the main process, which then *tells* the
  receiving window to take the tab. Anything built on the receiving window seeing the drop is
  built on something that does not happen — this shipped once and did nothing at all.

## Window and tab state across a relaunch

`src/main/sessionLayoutStore.ts` persists every window's panes and tabs to a JSON file (not
SQLite), debounced 500ms and keyed by window number. The renderer reports its own layout after a
500ms debounce of its own whenever it changes, and reports bounds on move/resize; the store
re-debounces on top of that to coalesce several windows' writes into one disk write. A record
carries a `hasLayout` flag alongside the bounds so a bounds-only stub (a window that only moved)
is never confused with a genuinely empty one — without it, a quit landing inside the renderer's
debounce window could wipe a live layout instead of just not having heard about it yet.

At launch, `src/main/index.ts` reads the stored record, recreates each window at its saved bounds,
and seeds its layout, tabs and shells from it. `src/main/sessionLayoutRestore.ts`'s
`pruneStaleLive` drops any `live` session id that no longer resolves — a deleted transcript, a
missing cwd — but keeps the tab itself so it shows closed rather than vanishing outright.
Resuming a session that was genuinely running at quit does not respawn it: `AppService.resume()`
checks `PtyManager.has()` first, the same guard `openShell()` already used, and attaches instead —
otherwise two windows racing to restore the same `live` session at once would each try to spawn
over the other's pty (`spawn()` kills whatever is already under an id).

## The tab registry and activity classification

`src/main/tabRegistry.ts`'s `TabRegistry` holds only what each window last reported about its own
open tabs (`report()` replaces a window's set wholesale; absence means closed) — no derived state,
so nothing here can go stale on its own. `list()` flattens the registry across every window for
the Active section, and `focusTab()` raises the owning window and selects the tab in it.

Activity status is computed fresh at render time, not cached in the registry.
`src/main/ipc.ts`'s `activeTabs` handler asks `PtyManager` for each tab's state as it answers, so
the dot always reflects the pty as it is right now rather than as it was when a tab last reported.

**`classifyActivity` reads a rendered screen, never the raw pty stream.** That distinction is the
whole subsystem, and it cost two shipped bugs to learn. Claude Code is a full-screen TUI: it
repaints in place, and it positions each word by jumping the cursor (`ESC[12G` between words)
rather than printing spaces. So `Do you want to proceed?` **never appears as those bytes in that
order anywhere in the stream** — a literal match against the stream cannot fire and never did — and
the stream's newlines are not screen lines, so "the last twelve lines" reached back across the
whole session. Every match the old classifier made came from a loose "line ending in a question
mark" fallback, which matched Claude's own prose and the echoed user prompt. The visible result was
an amber "asking you something" dot on a session sitting idle.

`src/main/pty/screen.ts` fixes it at the source: `ScreenBuffers` keeps a headless xterm per pty,
fed each chunk as it arrives, and `PtyManager.screen(id)` reads its grid as plain text. This is
also *cheaper* than what it replaced — the old code ran a global regex and a split over the whole
256KB replay buffer on every poll. Note `screen()` and `replay()` are different things on purpose:
`replay()` is the byte stream, for a view that wants to rebuild the picture in its own emulator;
`screen()` is that picture, for code that wants to read it.

`src/shared/activity.ts` then works on plain text, in this order: `stopped` if the pty is gone,
`waiting` at an unmistakable prompt (`Do you want to proceed?`, a confirm footer, a `❯ 1.` option
cursor), `running` if the spinner shows a live elapsed timer in parentheses (`(2s · thinking)` —
the finished form `✻ Cooked for 2s · done` has none), `running` if anything was printed in the last
two seconds (which is what covers a tab running something that is not Claude), `idle` otherwise.
Only the bottom fifteen non-blank lines are scanned, because that is where the furniture lives and
everything above it is conversation.

**Do not add a "looks like a question" heuristic back.** That was the bug, twice.

**The tests for this are recordings, not inventions.** `scripts/capture-activity-fixtures.mjs`
drives a real `claude --model haiku` through a pty and snapshots the raw buffer at named moments
into `tests/fixtures/activity/` (a `.txt` of bytes, and a `.json` carrying `sinceLastOutputMs` —
the other half of the classifier's input). `tests/unit/activityFixtures.test.ts` renders each one
and asserts its status. Run the capture deliberately, never in CI: it spends real tokens. Add a
scenario by recording it. Hand-written fixtures are what let this ship broken twice — the same
assumption wrote the fixture and the pattern, so they agreed with each other and with nothing else.

The dots are colour *and* motion: a slow breath for `running`, a double-knock pulse plus a marked
row for `waiting`, stillness for `idle` and `stopped`. `ActivityLegend.tsx`, on the Active header,
is the only place that vocabulary is explained — it draws real `.status-dot`s so the legend
animates exactly as the rows do.

## Which session a terminal is on

**Ask Claude, don't guess.** Claude Code keeps `<config>/sessions/<pid>.json` for every interactive
process — `sessionId`, `name`, `nameSource` (`user` or `derived`), `status` — and a session's pty
pid *is* Claude's pid (sessions run under `exec`). `ClaudeSessionTracker` polls those files for live
TUI ptys; `App.tsx` rekeys any tab whose pty is on another session the tree knows. Measured on real
Haiku sessions (Claude 2.1.281):

- the file exists from startup, but the session's **JSONL only appears on the first message** —
  so the tracker learns an id before the tree has it, and the rekey has to re-check on tree changes;
- `/clear` and `/resume` change `sessionId` **in place**, on the same process;
- `/rename` changes `name` and appends a `custom-title` record to the JSONL;
- `--fork-session` copies the parent's `custom-title`; `/fork` (2.1.281) starts a *separate*
  background session and leaves the process where it was;
- the file is removed when the process exits;
- a **fork nobody has typed in has no JSONL at all** (a `/rename` makes Claude write one), so
  until then the tab is pending: Active names it from the tab's reported `label`, and renaming it
  sends `/rename` through `renameTerminalInClaude(ptyId)` — the tab then resolves on its own.

Shell terminals are filed under the pty a tab runs under (`keyFor` = `ptyOverrides.get(key) ??
key`), not the tab key — a rekey must leave `shellTabs` alone. And shells do not survive a quit
while the layout still lists them: `SessionColumn` restarts a shown terminal whose pty is not
running, rather than attaching to nothing.

Before this, a new or forked tab was matched by waiting for an unseen JSONL in its folder. `/resume`
inside a new session switches to a session that already existed — the one case that match rules
out — and the tab stayed a `new:<uuid>` pty forever: unpinnable, missing from Recent, its pty id in
Active, Fork disabled.

**Inherited markers turn transcripts off.** An Apiary started from a shell Claude Code opened
inherits `CLAUDE_CODE_CHILD_SESSION` and friends, and a child `claude` that sees it writes no JSONL
and no session file. `pty/childEnv.ts` strips an explicit list; do not widen it to every
`CLAUDE_CODE_*` (that would drop real config like `CLAUDE_CODE_USE_BEDROCK`).

**Verify against a real session.** `tests/e2e/live/` drives a real `claude --model haiku` through
the built app (`APIARY_LIVE_CLAUDE=1 npm run test:e2e -- live/`; opt-in, spends tokens). The
stand-in spec (`sessionFollowing.spec.ts`) passed on the first version of this fix, whose session
already existed; the live spec failed it at once, because real Claude writes the JSONL later. When
driving the TUI: the trust prompt defaults to "No, exit" (Down, Enter), and a resumed or forked
screen repaints old "done" lines, so wait for a *new* one before typing again.

## Themes

A theme is **data, never code** (`src/shared/theme/`). `validateTheme` is the only way anything
becomes a `ThemeSpec` and is the feature's security boundary: it reads only allowlisted names as
own properties, accepts only numeric colour syntaxes and re-serialises them as `#rrggbbaa`, clamps
numbers, drops unknown fonts and effects, and then fixes readability (`ensureReadable`) and opacity
(`limitAlpha`: the transcript, terminal and their backgrounds stay solid). Everything that reads a
theme validates again: `ThemeStore` on load, the store on save, the generator on every reply.
Keep it that way.

- **Nothing a theme contains is parsed as CSS.** `applyTheme` sets allowlisted custom properties
  (`themeToCssVars`) and two font attributes whose stacks live in styles.css. No injected
  stylesheet, no HTML, no URL, no remote font. A new themable thing is a new token plus an
  allowlist entry in `spec.ts`.
- **Effects are Apiary's own draw functions** (`shared/theme/effects/`): pure functions of time,
  with an opacity cap each, tested in Node against a recording context. `ThemeEffects.tsx` only
  decides *when* to draw (30 fps cap, pause when hidden or backgrounded, a still frame under
  reduced motion or with Animated effects off).
- **Anything floating is solid** on solid themes: dialogs, menus, hover cards, toasts paint the
  panel colour over `--bg`, because a theme's translucent chrome let the transcript show through a
  dialog. On glass they are panes at ≥ 94% tint (`--bg-popover`) — no blur, see below.
- **Glass (`material: glass`)** lets `bg`, `bg-panel`, `bg-terminal` and controls go see-through
  (floors in `MIN_ALPHA.glass`). `ensureReadable` checks text against every colour that can show
  through (`backdrops`: the window, plus each background effect's colours — saturated as drawn —
  at its opacity cap): borderline colours are fitted first, then panes thickened (a surface only
  if its own colour contrasts with the text, otherwise the panel/page under it).
  **There is no `backdrop-filter` anywhere, on purpose.** What shows through a pane is only the
  window colour and the back effects canvas, so `ThemeEffects` draws that canvas blurred (at a
  fraction of the window's resolution, scaled up) and saturated. A live backdrop filter per pane —
  the first version, with an SVG lens — re-ran on every frame and hover and made the app lag by
  ~800 ms without GPU compositing. "Refraction" is now a lens-edge glow in `--glass-rim`. The
  pane is a `::before` on each card (and on `.sidebar-frame`, because `.sidebar` scrolls).
- **Theme performance is measured, not guessed**: `tests/e2e/bench/themePerf.spec.ts`
  (`APIARY_BENCH=1`, add `APIARY_BENCH_GPU=off` for software compositing) compares every built-in
  theme with the original look on hover, scroll, fold, divider drag and terminal typing — input to
  presented frame (Event Timing) and long frames, median of 3 runs. Run it after touching effects,
  glass or anything painted over the whole window. Without GPU compositing
  (`themeGpuCompositing()`, logged once as `theme gpu`) effects draw at 15 fps and 1×; during a
  divider drag they hold their frame. Moving effects to a worker was tried and measured slower
  in software compositing — the cost is compositing, not drawing.
- **Corners come from the theme**: `--radius-sm`/`--radius-row`/`--radius-lg` are calc()s of
  `--radius-panel` (4/5/10 px at the default 8), `--radius-control` is set by the theme. Never
  write a literal px radius above 3px in styles.css.
- **Liquid Glass is the first-run default** (`DEFAULT_THEME_ID`, only when themes.json does not
  exist). The E2E harness starts on the original look (`APIARY_DEFAULT_THEME=original` in
  `launchEnv`); `realDefaultTheme: true` gets the real default.
- The active theme reaches a window before its first paint through a synchronous preload read
  (`initialTheme`); components mounted later must ask `themeState()`, not trust that snapshot.
- **The generator** (`main/theme/themeGenerator.ts`) runs the user's `claude` as
  `-p --output-format json --tools "" --safe-mode --strict-mcp-config --no-session-persistence
  --json-schema …` in an empty temp dir, through the login shell with every argument as its own
  positional parameter (`exec "$0" "$@"`) — nothing typed is ever parsed by a shell.
  `--no-session-persistence` matters: without it every generation would appear in the sidebar.
  The schema is built from the spec allowlists (`shared/theme/prompt.ts`), so the two cannot
  drift; the reply still goes through `validateTheme` in main before the renderer sees it.
  Real generations take 45–55 s on Sonnet; `tests/e2e/live/themeGenerator.spec.ts` checks a real
  reply has nothing the validator must drop.
- **A preview belongs to one window and one screen**: the Themes section applies it locally and
  puts back the active theme when it unmounts. The effects layer follows what is *applied*
  (`useAppliedTheme`, fed by `applyTheme`'s event), not the saved choice, so previews show effects.
- **Ways back:** View → Reset Theme (native menu, Cmd/Ctrl+Alt+Shift+T), `--safe-theme` /
  `APIARY_SAFE_THEME=1`. Holding Shift at launch was specced and dropped: Electron's main process
  cannot see a modifier held before the first key event.

## The cwd override column, and why the scanner must leave it alone

The `session` table has a `cwd_override` column (`src/main/store/schema.ts`), set only by
`recordSessionMove()` when a session is dragged onto another worktree — it is how the session's
effective working directory changes without touching the JSONL, which still says where the
session actually started. `toSession()` reads it as `cwd_override ?? cwd`, so an override always
wins when present.

The scanner's `syncSessions()` upsert deliberately omits `cwd_override` (and `project_path`) from
both its column list and its `ON CONFLICT` clause — a rescan can update everything else about a
session but can never touch either column. This has to stay true: the JSONL's own recorded `cwd`
never changes, so if a rescan ever wrote that column again, the next filesystem scan after a move
would quietly revert it back to the original folder.

## Layouts

A window's panes are a `Layout` (`src/renderer/state/layout.ts`): one of eight presets and at
most four panes, each pane being a `Column` with its own tabs and terminals. It is a preset table
rather than a split tree on purpose — "zone three" and "what closing a pane turns into" are then
table lookups, and the picker shows exactly the shapes that can exist.

- **Every change goes through `tidyLayout`** (via `setLayout` in `App.tsx`). It closes a pane
  whose last tab went away and steps the layout down, keeps a pane that is *waiting* to be filled
  (`placeholder`), and never lets the pane count exceed the preset. Do not prune panes anywhere
  else.
- **Placing moves; splitting copies.** `placeInZone` moves a tab that is already open;
  `openBeside` (the split button's click) opens a second view, as splitting always has.
- **Nothing a layout change does closes a tab.** A smaller layout folds the extra panes' tabs into
  the last one.
- **Terminals do not care which pane they are in.** Shell ids are `shell:<session key>:<n>`, and
  the pty belongs to the main process, so moving a tab between panes remounts its views onto the
  same processes (the replay buffer fills them in).
- The pickers are fed through `LayoutContext`, so a sidebar row can place a session without the
  layout being threaded through every component between `App` and it.

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

**The content search runs in a worker thread** (`search/searchWorker.ts`, driven by
`searchClient.ts`). `better-sqlite3` is synchronous, so running an FTS query inline put it on the
same thread that routes window input — and a slow query therefore froze *typing in every window*,
not merely the results. That shipped: a one-character query measured 7.7 seconds on a real
library, and the keystrokes typed during it arrived afterwards in a single burst while the
renderer sat idle. It was diagnosed as a rendering problem twice before anyone measured the main
process. If the worker cannot start, the search falls back to running in-process and logs it —
`SearchClient.search` returns `null` rather than `[]`, because "the search never ran" and "nothing
matched" are opposite answers and conflating them shows an empty sidebar as if it were a result.

**A prefix term needs three characters** (`MIN_PREFIX_CHARS`). FTS5 walks every token in the index
beginning with a prefix, so the cost is inversely proportional to how much has been typed and the
first letter is the most expensive query the index can be asked. Below three characters the token
is searched exactly; titles, paths and branches are filtered in the renderer against a cached tree,
so a short query still narrows the sidebar instantly.

Indexing is incremental (unchanged files are skipped by size and mtime without being opened) and
yields between files. It is deliberately *not* a worker thread: the renderer is already a separate
process, so indexing cannot freeze the UI, and yielding costs far less than a second bundled entry
point would.

**Filtering by title, path or branch runs in the renderer, not main.** `useSessionTreeCache`
fetches the full, unfiltered tree once and refreshes it only on an explicit reload or the
watcher's change signal — never per keystroke. `src/shared/treeFilter.ts`'s `filterTreeLocal` then
matches locally against that cached tree on every (debounced) keystroke, folding in any ids that
matched by content. Results are ranked before they're capped, not the other way around — capping
first and ranking what was left over used to mean a great match could be dropped for a mediocre
one that happened to be scanned earlier. Only content and note search still cross the IPC boundary
(`searchContent`, into `AppService.searchSessions` and the FTS5 index above), because those need
to look inside files the renderer never holds a copy of.

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
Since then: every pty's move to another Claude session (`session-tracker`) and the renderer
rekeying a tab to follow it (`tabs`), whether an Apiary rename reached Claude and why not
(`rename`), each fresh merge-request lookup and what it replaced (`mr-status`), links opened in the
browser or blocked (`navigation`), and which inherited Claude markers a spawn stripped.

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

**On Linux the assisted download is the `.deb`, never the AppImage** (`pickInstaller`). Only a
.deb installation takes the assisted path — an AppImage run updates itself — and for a long time it
was handed the AppImage: a different packaging from the one it came from, which on Ubuntu 22.04+
does not even start without libfuse2. A release with no `.deb` is an error, not a fallback.

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
