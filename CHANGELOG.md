# Changelog

All notable changes to Apiary are documented here. Format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versions follow
[Semantic Versioning](https://semver.org/).

## [1.3.0] - 2026-09-09

### Added

- Nothing fails silently any more. Every failure — a git push that was rejected,
  a shell that wouldn't spawn, a rejected promise nobody caught — appears as a
  notification in the bottom-right corner, with the message in plain words and
  the raw error (stack included) folded away behind a "Details" toggle and a Copy
  button. Errors stay until dismissed; confirmations and information time out on
  their own. One reusable channel, four kinds (error, warning, info, success), so
  anything added later has somewhere to speak from.
- A crash while rendering is caught and shown in place instead of leaving a blank
  window. Each session column has its own error boundary, so a session that fails
  to render fails inside its own pane and leaves the sidebar and the other columns
  working; a crash above that level still gets a readable pane with the stack and
  a Reload button, never an empty screen.
- Pin a session from its row to lift it into a Pinned section at the top of the
  sidebar — collapsible from a chevron, like a folder, and remembered across
  restarts. A pinned session moves rather than being copied, so the sidebar never
  lists the same session twice.
- The install prompt now lives in [docs/install-prompt.md](docs/install-prompt.md)
  as a file containing nothing else, so it can be copied with the file view's own
  copy button instead of by dragging across part of the README (which is 55 lines
  shorter for it).

### Changed

- A session row's age moves to the very end of the row and gives way to the row's
  buttons on hover, so the two take turns in the same strip instead of the buttons
  permanently reserving width from the title.
- A missing transcript file says so in a sentence — "This session's transcript
  file is no longer on disk: …", which is what happens when the worktree a session
  ran in is deleted — rather than rejecting with Electron's IPC wrapper around
  Node's `ENOENT: no such file or directory, stat '…'`. The transcript pane shows
  it in place, with a Try again button.
- `git pull`/`git push` from the toolbar now confirm that they worked. Both are
  silent on success at the git level, which read as the button having done nothing.
- Failures raised inside a session column go to the notification stack rather than
  a banner inside that column, which was invisible the moment you switched away.

## [1.2.0] - 2026-09-09

### Added

- Sessions open as tabs, and the sidebar's split button opens one in a column of
  its own beside the current one — as many columns as you like. Each column has
  its own tab strip, its own session and its own shell, so a split gives you a
  second set of terminals rather than a second view onto one set.
- The search box has a clear button, and import folders collapse from a chevron so
  ticking one folder no longer means scrolling past all of its sessions to reach
  the next.
- Every colour now resolves through a design token, and the terminal reads those
  same tokens at mount, so a future theme is one redefined block rather than an
  edit to every rule.

### Fixed

- Ubuntu 24.04: the `.deb` no longer aborts on launch with a chrome-sandbox error.
  electron-builder's stock postinst decides whether the SUID helper is needed by
  testing user namespaces as root at install time, where 24.04's AppArmor
  restriction doesn't apply — so it skipped the SUID bit the app then needed as an
  unprivileged user. Apiary now ships its own postinst that always sets it.
- macOS: the installed app's icon no longer sits on a grey plate. macOS 26 masks a
  packaged icon onto its own tile, which a transparent-cornered icon shows through;
  the macOS icon is now full-bleed. (Dev mode was always fine — it sets the Dock
  image directly and bypasses that treatment.)
- The transcript follows a running session live instead of freezing at whatever was
  on disk when it was opened, and opens at the newest message rather than the oldest.
- The shell pane is pinned to the bottom of the window; the editor area no longer
  scrolls the layout away when a terminal is open.
- The Hide/Show shell chevron rotates with the pane instead of always pointing down.
- "Show shell" no longer reopens onto a dead terminal after you have exited one —
  the exited terminal is dropped, so the next open starts a fresh shell.
- Switching to a terminal snaps it to the bottom, so a server that logged while you
  were elsewhere shows its latest output instead of a frozen mid-scroll view.
- Terminal scrollback survives switching session and hiding/reshowing the shell, not
  just switching between terminals.
- The branch label no longer goes stale after `git checkout` in the terminal below it.
- The "+" terminal button reveals the terminal list, so a new terminal is visibly a
  new terminal.
- The terminal rename field no longer draws Chromium's focus ring over its own border.

## [1.1.0] - 2026-09-05

### Added

- Git branch toolbar on the shell pane: shows the current branch (with
  ahead/behind counts), and buttons to pull, push, and copy the branch name.
- Branch switcher (VS Code-style quick-pick) opened from the branch button —
  search/filter local branches, remote branches, and tags; checkout a
  branch, create a new one (optionally from a picked base ref), or check
  out a ref detached.
- Multiple independent terminals per session: a "+" button opens another
  terminal alongside the session's default one, a side panel lists every
  open terminal for switching, and each can be renamed inline or closed.
- The shell pane's toggle button is now part of the same modular toolbar as
  the git and terminal controls, restyled to match.

### Fixed

- Switching away from a terminal tab and back no longer clears its
  scrollback — every open tab now stays mounted (just hidden) instead of
  being torn down when it's not the active one.

## [1.0.0] - 2026-09-05

Initial release.

### Added

- Sidebar listing every Claude Code session, grouped by the folder it started
  in, with git worktrees nested under their parent repository; fuzzy search
  narrows both sessions and folders as you type.
- File > Import Claude Sessions dialog — nothing appears until it's
  explicitly imported; ticking a folder also marks it for auto-import so
  later sessions there show up on their own.
- Transcript view rendering the full conversation as markdown, with tool
  calls/results collapsed into expandable blocks and subagent (sidechain)
  messages hidden by default.
- Resume any session in an embedded terminal running `claude --resume` in
  its recorded working directory, with conflict detection and an option to
  fork instead of a session that's already running elsewhere.
- Start a brand-new `claude` session directly from the sidebar via a "+" on
  any folder.
- Open a plain interactive shell alongside any session, in its own
  independent, resizable pane.
- Rename a session — including one just started but not yet resolved into a
  real session — with the custom title persisted and never overwritten by
  Claude's own later title generation.
- Remove a session from view without touching its transcript file on disk;
  it stays importable again at any time.
- Window bounds, sidebar width, collapsed folders, the selected session, and
  the shell pane's height all persist across restarts.
- App icon, and packaging for macOS (`.dmg`, arm64 and x64) and Linux
  (`.AppImage`, `.deb`).
