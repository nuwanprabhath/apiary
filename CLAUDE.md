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

## Search

`src/main/search/` keeps an FTS5 index in a database of its own, because it is derived data that can
always be rebuilt from the JSONL. **Tokenisation is the whole design**: punctuation is split on
rather than kept, so `!1257` and `1257` find the same session, and `2260-remove-prefill` matches both
whole and by any word in it. Adding `-` or `!` to `tokenchars` would make each of those one
indivisible token and break every partial search anyone would type. User queries go through
`toMatchQuery`, which reduces them the same way — typed raw into `MATCH`, `!1257` is a syntax error,
not a search.

Indexing is incremental (unchanged files are skipped by size and mtime without being opened) and
yields between files. It is deliberately *not* a worker thread: the renderer is already a separate
process, so indexing cannot freeze the UI, and yielding costs far less than a second bundled entry
point would.

## Conventions

- **Comments explain why, not what.** The density here is higher than most codebases on purpose —
  most comments record a decision, a measurement, or a bug that will otherwise be reintroduced. Match
  it. A comment that restates the line below it is noise; one that says why the obvious approach was
  wrong is the point.
- **`styles.css` uses CSS custom properties for colour.** No literal colours (the scrollbar arrow
  data-URI SVGs are the one documented exception).
- **Tests are written as statements about behaviour**, not about implementation: read a few existing
  names before adding one.
- TypeScript is strict; `npm run typecheck` covers both tsconfigs and both must pass.

## Measure before fixing

The bugs in this app that took longest were the ones where a plausible explanation was acted on
without checking. The terminal-cutoff bug was "fixed" twice before someone measured the actual
element heights and found a 352px terminal inside a 167px row. The "needs Enter twice" bug got a
delay-tuning fix that was irrelevant, because the real cause was a write landing a second before the
program existed — found only by tapping the PTY and looking at the bytes.

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
