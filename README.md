# Apiary

Import, search and resume pre-existing Claude Code sessions across folders and git worktrees in your whole machine. Single place to manage them all.

Apiary reads the session files Claude Code already writes to `~/.claude/projects`
(or `$CLAUDE_CONFIG_DIR`), groups them by the folder they started in, nests git
worktrees under their parent repository, and lets you read any conversation or
resume it in an embedded terminal in the correct working directory.

![Apiary in its default Liquid Glass theme: a searchable sidebar with an Active section listing open sessions, Pinned and grouped sessions below it, and three sessions arranged in a layout on the right — a live Claude Code session in the large pane, two transcripts stacked beside it, and a shell with a minimal `$` prompt running under the live one](docs/screenshot.png)

## Features

- **Grouped, searchable sidebar** — every session grouped by the folder it started
  in, with git worktrees nested under their parent repository. Fuzzy-search by
  title narrows both sessions and folders as you type.
- **Import, on your terms** — nothing shows up until you import it via File >
  Import Claude Sessions; ticking a folder also marks it for auto-import, so
  sessions you start there later appear on their own without repeating the step.
- **Read any transcript** — full conversation history, rendered as markdown
  (headings, code blocks, lists), with tool calls/results collapsed into
  expandable blocks and subagent (sidechain) messages hidden by default.
- **Work on several sessions at once** — sessions open as tabs, and a window arranges up
  to four of them in a layout: columns, rows, a main pane with two beside it, or a 2×2 grid.
  Rest the pointer on a session's split button or a tab's layout icon (or choose *Arrange…*
  from its right-click menu), click the spot you want it in, and the rest arrange around it.
  Empty panes offer your open tabs and recent sessions, and the dividers drag in both
  directions.
- **Tidy terminals and a tidy sidebar** — F2 renames the terminal you're in; hovering a folder
  shows its full path with a copy button, and collapses every worktree under it in one click;
  the whole sidebar folds away to a thin rail (⌘B / Ctrl+Shift+B) when you want the width.
- **A session in a window of its own** — drag a tab out of the window, or right-click it and
  choose *Move into New Window*, and the conversation and its shell get a window with no sidebar
  in the way. Tabs can be dragged between open windows too.
- **Branches held by another worktree** — checking one out is refused by git, so Apiary says which
  worktree has it and offers to pull it there or start a session there, instead of printing the
  error and leaving you to find the folder.
- **Fork a session** — right-click a tab or a sidebar row to start a new conversation from where
  this one has got to. The fork opens beside the original, named after it; the original is left
  exactly as it was.
- **Chat from the transcript** — a message box under the conversation, so you can reply without
  switching to the raw terminal. Paste or drop images straight into it: each one gets a thumbnail
  you can click to see full size, and images already in a session's history render the same way.
  It isn't a second conversation — what you type is delivered into the very same `claude --resume`
  process, so the session's own transcript stays the single record.
- **Resume in an embedded terminal** — reopens a session with `claude --resume`
  in its correct working directory, right inside the app; warns (with the option
  to fork instead) if that session is already running elsewhere.
- **Start brand-new sessions** — a "+" on any folder spawns a fresh `claude`
  session there directly from the sidebar, no separate terminal needed.
- **A git toolbar per session** — current branch with ahead/behind counts, a VS
  Code-style branch switcher, pull, push, and copy-branch-name, all scoped to that
  session's own working directory.
- **A plain shell alongside any session** — open an ordinary interactive shell in
  the same working directory as the session you're looking at, resizable and
  independent of the session's own terminal.
- **Pin the sessions you live in** — a pin button on any session row lifts it into
  a Pinned section at the top of the sidebar (collapsible, like a folder), so the
  two or three you actually work in aren't buried among months of history. A row's
  age gives way to its buttons on hover, so nothing has to compete for width.
- **A diagnostic log, when you want one** — off by default and silent until you switch it on in
  Settings. It records what Apiary did, never what you said to Claude: no prompts, no replies, no
  transcript text, home directories replaced with `~` and anything token-shaped stripped. Kept
  inside a retention and size limit you set, and the folder is one click away to send on.
- **Failures say what happened** — anything that goes wrong, from a missing
  transcript file to a failed push, appears as a notification with the message in
  plain words and the raw error behind a "Details" toggle. A crash in one session's
  pane is caught and shown in place rather than blanking the window.
- **Rename sessions** — give a session a title of your own; it persists and
  survives Claude's own title-generation catching up later.
- **Remove sessions from view** — hide a session you don't need without ever
  touching the underlying transcript file on disk; it stays importable again
  later if you change your mind.
- **Merge-request button** — the session bar shows the GitLab MR for the branch you are on by
  number, and opens it in a click, saying whether it is open, merged or closed; with no MR yet it
  opens GitLab's new-MR form with the branch filled in. Uses `glab`, so Apiary never stores a token. Part of a small plugin system, so the
  bar can grow other integrations the same way.
- **Shorter terminal prompts** — optionally trim the working directory in the prompt of shells
  Apiary starts, so a deep worktree path stops eating the first line.
- **Notes on sessions** — jot down what you were doing (the ticket, the merge request, what you
  had ruled out) from the session's row. Notes show when you hover it, and are searched from the
  search box, so a session is findable months later by the MR number you remember. Can be switched
  off in Search settings.
- **Keeps itself up to date** — checks GitHub for new releases on a schedule and offers them in
  a strip above the workspace, with *Check for Updates…* in the menu for asking on demand. On
  Linux (AppImage) it installs the update and restarts into it; on macOS, where an unsigned app
  is not allowed to replace itself, it downloads and verifies the .dmg and opens it for you.
  Settings has the schedule, auto-download and pre-release options.
- **Everything remembered across restarts** — window size and position, sidebar
  width, which folders are collapsed, the selected session, and the shell pane's
  height all persist between launches. Every window's panes and tabs come back too, and a
  session that was actually running when you quit resumes running rather than reopening as a
  plain transcript.
- **Active and Recent, above and below Pinned** — Active lists every session open across all your
  windows, with a status dot for running, waiting on you, idle or stopped; clicking one brings its
  window forward and switches to its tab. Recent lists sessions you've used in the last few hours,
  with a configurable window, an on/off switch in Settings, and per-row dismissal.
- **MR status beside the reference** — a `!1234` in a session's title or note shows its state
  inline, `!1234 (merged)`, resolved through `glab`; it degrades to plain text if `glab` isn't
  available.
- **Move a session to another worktree by dragging it there** — drop a sidebar row onto a
  different worktree and, after a confirmation, Apiary moves it there.
- **Open in VS Code** — a button on a session's hover card opens its folder directly in VS Code.

## Install

There's no signed installer yet, so the reliable way to get Apiary onto a
machine is to hand an AI coding agent with shell access (Claude Code, Cursor,
etc.) the install prompt:

**[docs/install-prompt.md](docs/install-prompt.md)** — open it and use the
file view's own copy button, then paste the whole thing into your agent.

It's kept as a file of its own, containing nothing but the prompt, precisely so
that copying it is one button rather than a careful drag across part of a page.

The prompt is written to be idempotent — running it again later checks the
installed version against the latest release and does nothing if you're
already up to date, or updates in place if you're not. If a GitHub release
exists for your platform it downloads the prebuilt artifact; otherwise (or if
none has been published yet) it builds from source instead, which always works
as long as the build requirements below are met.

## Requirements

- Node 22 or newer
- `claude` on your `PATH`
- macOS or Ubuntu 24.04

## Development

    npm install
    npm start          # run the app
    npm test           # unit and integration tests
    npm run test:e2e   # Playwright tests against the built renderer (off-screen; APIARY_HEADED=1 to watch)
    npm run screenshot # regenerate docs/screenshot.png (the README image above)
    npm run typecheck

`npm run screenshot` launches the real app against a representative fixture (three
project folders, a git worktree, a few sessions with human-sounding titles), opens
three of them in a layout (placing one in the large pane through the layout picker) with
a shell running under it, and resumes that one so the
picture shows a live session rather than only transcripts, before overwriting
`docs/screenshot.png` — see `scripts/screenshot.spec.ts`. The resumed session runs
`scripts/fixtures/fake-claude.sh`, a stand-in that prints a fixed, believable Claude
Code session: the real CLI needs an API key and a network and would render something
different every run, neither of which belongs in a committed image. It's a Playwright
script, not a test (it asserts nothing, and lives outside `tests/e2e` so
`npm run test:e2e` never runs it); run it by hand whenever a change is significant
enough that the README's picture of the app should catch up.

`better-sqlite3` and `node-pty` are native modules, and Electron's Node ABI is
not the same as your system Node's, so the same `node_modules` can't serve
both without being rebuilt. `npm start` rebuilds them for Electron's ABI
(`rebuild:electron`) before launching the app; `npm test` rebuilds them for
Node's ABI (`rebuild:node`) before running Vitest, since tests run under
plain Node, not Electron. `npm run test:e2e` also rebuilds for Electron first,
because it drives the actual Electron build (`npm run build` output in `out/`)
with Playwright. Whichever you run last is the ABI the modules are left in —
running `npm test` right before `npm start` is harmless, since `start`
rebuilds again first, but running `npm test` right before packaging (`npm run
dist`) would leave the wrong ABI unless `dist` rebuilds too, which it does.

`postinstall` runs `scripts/fix-node-pty-permissions.mjs` automatically after
`npm install`. node-pty ships a small native helper binary, `spawn-helper`,
that it execs before exec'ing your shell; npm's tarball extraction doesn't
reliably preserve its executable bit, and without it every terminal spawn
fails with `posix_spawnp failed`. The script restores the bit, unconditionally
and harmlessly, every time dependencies are installed.

## Packaging

Prebuilt artifacts for macOS (arm64) and Linux (x64) are attached to each
[GitHub release](https://github.com/nuwanprabhath/apiary/releases), built by
`.github/workflows/release.yml` on a `v*` tag push — see that file's own
comments for why it builds each OS/arch natively on its own runner rather
than cross-compiling, and why there's no automated x64 macOS build (GitHub's
Intel Mac runner capacity has become unreliable enough that it isn't worth
carrying). To build locally instead:

    npm run dist

On macOS this produces a `.dmg` for **your machine's own architecture only**
(arm64 on Apple Silicon, x64 on Intel), under `release/`. On Linux it
produces an `.AppImage` plus `.deb` (x64). The script rebuilds the native
modules for Electron's ABI and runs `electron-vite build` before invoking
`electron-builder`.

`electron-builder.yml` itself declares both `arm64` and `x64` as mac dmg
targets, but `npm run dist` deliberately scopes the actual build to the host
arch (via `scripts/dist.mjs`) rather than building both by default. Building
the *other* mac arch means `@electron/rebuild`/`electron-builder` cross-compile
`better-sqlite3`'s native binding for that arch, which goes through
node-gyp's Python toolchain — and on a modern Python (3.12+, which removed
`distutils`) without `setuptools` installed, that cross-arch compile fails
with `ModuleNotFoundError: No module named 'distutils'`. Rather than have
`npm run dist` fail on a fresh machine for an arch nobody asked for, the
default is host-arch-only, which works with no extra setup. `dist:mac:arm64`
and `dist:mac:x64` go through the same `scripts/dist.mjs` dispatcher as
`dist` (passing the requested arch as an argument), so they get the same
single-arch `--config` narrowing rather than relying on electron-builder's
own `--arm64`/`--x64` flags, which do **not** scope the build on their own —
see the implementation note in `scripts/dist.mjs` for why. `dist:mac:all`
and `dist:linux` invoke `electron-builder` directly against
`electron-builder.yml`, since neither passes an arch flag that needs
narrowing (`--arm64 --x64` matches the file's own `arch: [arm64, x64]`
already; `--linux` doesn't touch `mac` at all).

    npm run dist:mac:arm64   # arm64 only — verified, both locally and via CI, see below
    npm run dist:mac:x64     # x64 only — requires setuptools/distutils on an arm64 host, see below
    npm run dist:mac:all     # both, in one electron-builder invocation — not run on this machine (would hit the same x64 gap)
    npm run dist:linux       # AppImage + deb (must run on Linux) — verified via CI, see below

**`dist:mac:arm64` — verified.** Ran on this machine (Apple Silicon) after
clearing `release/`; produced `release/Apiary-1.0.0-arm64.dmg` and
`release/mac-arm64/Apiary.app`, with `release/builder-debug.yml` showing only
an `arm64:` key (no `x64:`) — confirming the arch narrowing works the same
way `dist` itself does. Also the artifact the release workflow's macOS leg
produces and attaches to each GitHub release.

**`dist:mac:x64` — fails on an arm64 dev machine**, for the same `distutils`
reason as plain `dist`'s x64 leg (see above): `@electron/rebuild`
cross-compiling `better-sqlite3` for x64 hits `node-gyp failed to rebuild ...
ModuleNotFoundError: No module named 'distutils'` before electron-builder
ever reaches the packaging step, and no x64 artifact is produced. This is a
cross-compile toolchain gap, not a scripting bug — running this same script
natively on an actual x64 Mac never hits it at all (nothing to cross-compile
for), which is exactly why the release workflow originally built this leg on
a native x64 GitHub runner rather than cross-compiling from the arm64 one —
see that workflow's comments for why it's no longer in CI. Not fixed here:
this machine's Python is managed by Homebrew (PEP 668), and installing
`setuptools` system-wide requires overriding that guard, which is a
machine-level choice left to whoever runs this, not something to do silently
as part of this fix.

Packaging has the same `spawn-helper` executable-bit problem as install does,
but `postinstall` doesn't run during packaging and electron-builder's
`asarUnpack` copy step (native modules can't load from inside an asar, so
`better-sqlite3` and `node-pty` are unpacked) is itself a known way to drop
the bit. `electron-builder.yml` wires an `afterPack` hook
(`build/afterPack.cjs`) that reuses the same fix, applied to node-pty as it
sits inside the packaged app's `app.asar.unpacked` directory, so packaged
installs don't regress a bug already fixed for local installs.

**Linux artifacts are verified.** `dist:linux` runs successfully on the
release workflow's `ubuntu-24.04` runner and produces both a real
`.AppImage` and `.deb`, attached to each GitHub release — the `linux:`
section of `electron-builder.yml` has actually been exercised on Linux, not
just configured. Installing and launching the result on a real Linux
desktop (as opposed to just the CI runner successfully packaging it) has
not been separately confirmed.

**AppImage sandboxing on Ubuntu 24.04+.** The `.deb` ships a custom
`afterInstall` script (`build/linux-after-install.sh`) that always sets the
SUID bit on `chrome-sandbox`, so it works out of the box even where
unprivileged user namespaces are restricted (Ubuntu 24.04's
`kernel.apparmor_restrict_unprivileged_userns=1`). The AppImage can't use
that fix — AppImages are mounted `nosuid`, so a SUID sandbox helper never
works there regardless of permissions. On an affected system the AppImage
will abort on launch with a `SUID sandbox helper binary ... not configured
correctly` error; run it with `--no-sandbox`, or install the `.deb` instead.

## How it works

Sessions are discovered by scanning the Claude config directory. Metadata is read
with bounded head and tail reads rather than parsing whole files, because session
files reach tens of megabytes. Titles come from the `ai-title` entries Claude Code
writes. Working directories are always read from the `cwd` field inside the JSONL,
never derived from the directory name, which is a lossy encoding of the path.

Nothing appears in the sidebar until you import it through File, then Import Claude
Sessions. Ticking a folder also marks it for auto-import, so sessions you start
later in that folder show up on their own.
