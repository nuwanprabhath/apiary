# Apiary

Import, search and resume pre-existing Claude Code sessions across folders and git worktrees in your whole machine. Single place to manage them all. 

Apiary reads the session files Claude Code already writes to `~/.claude/projects`
(or `$CLAUDE_CONFIG_DIR`), groups them by the folder they started in, nests git
worktrees under their parent repository, and lets you read any conversation or
resume it in an embedded terminal in the correct working directory.

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
- **Resume in an embedded terminal** — reopens a session with `claude --resume`
  in its correct working directory, right inside the app; warns (with the option
  to fork instead) if that session is already running elsewhere.
- **Start brand-new sessions** — a "+" on any folder spawns a fresh `claude`
  session there directly from the sidebar, no separate terminal needed.
- **A plain shell alongside any session** — open an ordinary interactive shell in
  the same working directory as the session you're looking at, resizable and
  independent of the session's own terminal.
- **Rename sessions** — give a session a title of your own; it persists and
  survives Claude's own title-generation catching up later.
- **Remove sessions from view** — hide a session you don't need without ever
  touching the underlying transcript file on disk; it stays importable again
  later if you change your mind.
- **Everything remembered across restarts** — window size and position, sidebar
  width, which folders are collapsed, the selected session, and the shell pane's
  height all persist between launches.

## Install

There's no signed installer yet, so the reliable way to get Apiary onto a
machine is to hand the prompt below to an AI coding agent with shell access
(Claude Code, Cursor, etc.). It's written to be idempotent — running it again
later checks the installed version against the latest release and does
nothing if you're already up to date, or updates in place if you're not.

If a GitHub release exists for your platform it downloads the prebuilt
artifact; otherwise (or if none has been published yet) it builds from
source instead, which always works as long as the build requirements below
are met.

> Paste everything between the lines into your agent:
>
> ---
>
> Install or update the "Apiary" desktop app from
> https://github.com/nuwanprabhath/apiary for me. Follow these steps in
> order, and stop to tell me if any step fails:
>
> 1. Detect this machine's OS and CPU architecture (macOS arm64, macOS x64,
>    or Linux x64) — Apiary doesn't support anything else yet.
> 2. Find the currently installed version, if any:
>    - macOS: if `/Applications/Apiary.app` exists, read
>      `CFBundleShortVersionString` from its `Info.plist` (e.g.
>      `/usr/libexec/PlistBuddy -c "Print :CFBundleShortVersionString"
>      /Applications/Apiary.app/Contents/Info.plist`).
>    - Linux: run `apiary --version` if it's on `PATH`, or
>      `dpkg -s apiary 2>/dev/null | grep Version` if it was installed via
>      `.deb`.
>    - If none of those find anything, treat the installed version as "none".
> 3. Fetch `https://api.github.com/repos/nuwanprabhath/apiary/releases/latest`.
>    If that 404s (no release published yet), skip straight to the
>    build-from-source path in step 5 — there's nothing to compare against or
>    download.
> 4. If a release was found, compare its tag (strip a leading `v`) against
>    the installed version from step 2. If they already match, tell me
>    Apiary is already up to date and stop — don't reinstall or rebuild
>    anything.
> 5. Otherwise, install the new version, either by downloading a release or
>    by building from source:
>    - **Prebuilt artifact** (when step 3 found a release with an asset for
>      this OS/arch — a `.dmg` for macOS, `.deb` or `.AppImage` for Linux):
>      download it, then:
>      - macOS: mount it (`hdiutil attach the.dmg`), copy `Apiary.app` into
>        `/Applications` (replacing any existing copy), unmount the image,
>        then run `xattr -cr /Applications/Apiary.app` — the app isn't
>        code-signed or notarized yet, so without this Gatekeeper refuses to
>        open it at all.
>      - Linux `.deb`: `sudo apt install ./<file>.deb` (pulls in any missing
>        dependencies automatically).
>      - Linux `.AppImage`: `chmod +x` it and move it to
>        `~/Applications/Apiary.AppImage` (creating that folder if it
>        doesn't exist yet), replacing any existing copy.
>    - **Build from source** (used automatically when there's no release
>      yet, or if no asset matches this OS/arch): clone
>      `https://github.com/nuwanprabhath/apiary` into `~/src/apiary` (or, if
>      that folder already exists, `git -C ~/src/apiary pull` instead of
>      cloning again), run `npm install`, then run whichever packaging
>      script matches this OS/arch — `npm run dist:mac:arm64`,
>      `npm run dist:mac:x64`, or `npm run dist:linux` — and install the
>      artifact it produces under `release/` the same way as the prebuilt
>      path above.
> 6. Re-check the installed version and tell me what's installed now.
>
> This needs Node.js 22+ on my machine either way, and — only for the
> build-from-source path — Xcode Command Line Tools on macOS or
> `build-essential`/Python 3 on Linux. Apiary itself needs `claude` on
> `PATH` to actually resume sessions, but that isn't required just to
> install the app.
>
> ---

## Requirements

- Node 22 or newer
- `claude` on your `PATH`
- macOS or Ubuntu 24.04

## Development

    npm install
    npm start          # run the app
    npm test           # unit and integration tests
    npm run test:e2e   # Playwright tests against the built renderer
    npm run typecheck

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

## How it works

Sessions are discovered by scanning the Claude config directory. Metadata is read
with bounded head and tail reads rather than parsing whole files, because session
files reach tens of megabytes. Titles come from the `ai-title` entries Claude Code
writes. Working directories are always read from the `cwd` field inside the JSONL,
never derived from the directory name, which is a lossy encoding of the path.

Nothing appears in the sidebar until you import it through File, then Import Claude
Sessions. Ticking a folder also marks it for auto-import, so sessions you start
later in that folder show up on their own.
