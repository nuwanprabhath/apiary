# Changelog

All notable changes to Apiary are documented here. Format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versions follow
[Semantic Versioning](https://semver.org/).

## [1.9.1] - 2026-09-12

### Fixed

- **The empty panel beside the session came back after splitting and closing.** Dragging a divider
  gives the two columns weights that add up to two — 0.6 and 1.4, say — and closing one left the
  survivor growing by 0.6. Flex hands out only that fraction of the row when the growth factors add
  up to less than one, so the column took 60% of the width and the other 40% stayed empty
  background. The weights are now normalised to the number of columns on the way to the layout,
  which keeps the ratio you dragged and always fills the row.
- **A tab's close button could still be hidden.** Making it always painted was not enough: tabs
  kept their full width in a strip that scrolled with an invisible scrollbar, so once they outgrew
  the strip the last one was sliced through and its close button was past the edge. Tabs now shrink
  to share the strip, the active tab is scrolled into view when there are more than fit, and the
  strip has a hairline scrollbar so an overflow reads as scrollable rather than broken.
- **The session hover tooltip never really appeared.** It was a `title` attribute — correct
  content, and a test that passed on the strength of the attribute existing, while in use the OS
  tooltip took a second to show up in the system style. It is a proper hover card now: path,
  branch, last active and a note when the folder is gone, after a short delay, drawn beside the
  row and able to overhang the sidebar.

## [1.9.0] - 2026-09-12

### Added

- **Apiary updates itself.** It checks GitHub for a newer release on a schedule (every 6 hours by
  default), and offers what it finds in a strip above the workspace — never a dialog over what you
  are reading. *Check for Updates…* in the Apiary menu (Help on Linux) asks on demand and reports
  the answer either way. A new Updates section in Settings holds the schedule, an auto-download
  option, pre-release opt-in, the running version and when it last checked.
- **What the update button offers depends on what the build can actually do.** A Linux AppImage
  installs the update and restarts into it. An unsigned macOS build cannot — macOS will not let an
  app replace itself unless it is signed with a Developer ID certificate — so it downloads the
  .dmg, verifies it against the checksum in the release, and opens it for you to drag into
  Applications. The reason is on screen before you press anything, rather than after a download
  that could not have worked. Signing the app later turns macOS into a silent update with no code
  change.
- Skipping a version stops it being offered; the next release is offered as normal, and a check you
  ask for still answers honestly about the version you skipped.
- Releases now carry `latest-mac.yml` / `latest-linux.yml` and a macOS `.zip` beside the existing
  installers. These are what an installed copy reads to discover a new version.

### Changed

- **The pinned sessions and folder groups are shared by every window.** They describe how you have
  organised your sessions, not how one window is arranged, and a second window that opened with an
  empty sidebar was the same workspace with the shelves emptied. Pinning in one window now shows up
  in the other as it happens. Tabs, column widths and the selected session stay per-window.
- **A tab's close button is always visible**, rather than appearing on hover. On the tabs it was
  hidden, the right-click menu was the only way to close anything.

## [1.8.2] - 2026-09-11

### Added

- A tab can be dragged from one column into another, landing where it is dropped. Dragging a
  column's last tab away closes that column rather than leaving it empty.

### Fixed

- **Dragging a tab onto another column did nothing.** A tab strip only became a drop target for a
  drag that had begun inside itself, so a tab from a different column found nothing to land on and
  snapped back. Both strips now read the drag from its payload type, and the drop is one gesture
  whether the tab stays in its column or moves. (The earlier "drag to first position" fix was real,
  but it only ever applied within a single column — which was not the drag being attempted.)
- **A worktree could not be reordered inside a grouped repository.** The drop landed on the row and
  then bubbled to the enclosing group, whose handler wrote back the whole arrangement as it had
  been before the drop — undoing the reorder a moment after it happened. A drop on a row now stops
  there, and a group only accepts the top-level folders it can actually hold.
- **Clicking a terminal in the shell list and then pressing an arrow key drew a box around the row
  you had clicked.** Keyboard focus stayed on that row's button, so the first keypress brought out
  Chromium's own focus ring — around a row the selection had already moved off, and looking just
  like the rename field a row turns into. Focus now belongs to the list itself, with the selected
  row named through `aria-activedescendant`.

## [1.8.1] - 2026-09-11

### Added

- A `CLAUDE.md` for whoever works on this next: the native-module ABI trap and what its failures
  look like, the `ELECTRON_RUN_AS_NODE` error that looks nothing like its cause, why prompt delivery
  waits for the TUI, why the search tokeniser splits on punctuation, and the two bugs that were
  "fixed" from plausible explanations before anyone measured.
- Hovering a session in the sidebar shows where it ran, its branch, and when it was last active —
  everything the row itself has no width for.
- Terminals in the shell list reorder by dragging, like everything else in the app.
- A repository's worktrees reorder within their folder, not just the top-level folders.
- Groups reorder by dragging one heading onto another, as well as from the menu.

### Fixed

- **Dragging a tab to the first position did nothing.** Drops landed *on* a tab, so "before the
  first one" was a position no target corresponded to. Dropping now inserts before or after
  depending on which half of a tab you are over, which is what makes both ends reachable.
- **A folder could not be dropped into an empty group.** Only the heading accepted the drop, and an
  empty group is a heading plus a line of placeholder text — so the case that needs dragging most
  had the least to aim at. The whole group is the target now, and highlights as you drag over it.
- **The git menu opened at the opposite end of the pane from the button that opened it.** It was
  anchored to the whole toolbar, whose left edge is the far left of the pane, rather than to the
  "..." button. It is now clamped to stay on screen from either end.
- **Arrowing onto a terminal in the shell list looked like it had started renaming it** — the focus
  style was a full box outline, which is exactly what a row becomes when renamed. It is an accent
  bar down the leading edge now.
- The README screenshot's session pane no longer wraps mid-sentence or runs its rules past the
  edge of the column.

## [1.8.0] - 2026-09-11

### Added

- **Search inside conversations**, not just titles. Typing in the sidebar's search box now matches
  what was actually said in a session — a merge request like `!1257`, a ticket like `#2902`, a
  branch name, a phrase you half remember. Tokenisation is the whole trick: punctuation is split
  on rather than kept, so `!1257` and `1257` find the same session, and `2260-remove-prefill`
  matches whole *and* by any word in it. Keeping `-` as a word character would have made that one
  indivisible token that `prefill` could never find. The index lives in a database of its own —
  it is derived data, rebuildable from the JSONL at any time — and is kept up to date
  incrementally, skipping unchanged files without opening them, yielding to the event loop between
  files so it stays out of the way. Settings > Search turns it off, says how much is indexed, and
  can rebuild it.
- **Top-level groups in the sidebar**, so months of folders can be filed away instead of scrolled
  past. Right-click a folder for "New group from this folder…", then rename, reorder or delete the
  group from its own menu; drag other folders onto it to file them too. Deleting a group frees the
  folders under it rather than taking them with it. Modelled on the simple-worktrees VS Code
  extension, since that is the interaction people already know.
- **Drag to rearrange**: top-level folders, pinned sessions, and the session tabs in a column all
  reorder by dragging, and stay as you left them across restarts. A folder Apiary has not seen
  before sorts to the bottom rather than into the middle of an arrangement made on purpose.
- **Several windows.** File > New Window opens another workspace over the same sessions. They
  share one store and one set of terminals — the same session in two windows is one process, not
  two — but each window keeps its own tabs and columns, so a second window is not a copy of the
  first. Terminal output is delivered to every window rather than only the focused one, so a
  background window is never left frozen.
- **Copy and paste in the terminal.** Ctrl+C copies the selection when there is one and still
  interrupts when there is not — the single most important key in a terminal keeps working.
  Ctrl+Shift+C always copies, Ctrl+Shift+V (Cmd+V on macOS) pastes, and right-click gives
  Copy/Paste/Select all/Clear. This runs through xterm's own key hook, the only place a key can be
  swallowed before it reaches the process.
- **Right-click a tab** to pin that session to the sidebar, or close it.
- **Arrow keys move between shells** in the shell list, switching as they go.
- **The sidebar follows what you are looking at**: switching to a tab opens the folders above that
  session and scrolls to it, so you can see where in months of history it lives. Settings >
  Sidebar turns it off. It only ever scrolls when the session changes, so it cannot fight you
  while you are scrolling by hand.

### Changed

- Clicking a session that is already open focuses it where it is, instead of opening a second copy
  of the same conversation in the current column — which was indistinguishable from a split.
- The README screenshot now shows a live Claude Code session in one pane alongside transcripts in
  the others, rather than three transcripts. `npm run screenshot` resumes a session against a
  stand-in `claude` that prints a fixed, believable session, so the picture stays deterministic and
  needs no API key.
- The three separate right-click menus (tab strip, terminal, sidebar) are now one component.
- e2e launches strip `ELECTRON_RUN_AS_NODE`. Anything that runs Electron's binary as a plain Node
  interpreter sets it, and it is inherited by every launch afterwards — which made the whole suite
  fail with "Process failed to launch", an error that looks nothing like its cause.

## [1.7.2] - 2026-09-11

### Fixed

- **A message sent from the chat box could arrive unsent, needing a second Enter by hand** — with
  any images in it left as a raw path rather than picked up as attachments. Sending to a stopped
  session resumes it first, and the pty exists a good second before `claude` is listening; the
  message was written straight into that gap. What handles it there is not the program but the
  terminal's line discipline, which is still in canonical mode: it buffers the input by line and
  translates the carriage return that submits into a plain newline (ICRNL). The message then
  surfaced in the input box once Claude started, sitting there, its send having become a line
  break — and, never having been seen as a paste, with its image paths never recognised.

  Delivery now waits for the program to take the screen (which is also when it puts the terminal
  into raw mode) and for its output to settle, before writing anything. The return that submits
  likewise waits for the paste to be taken in rather than following a fixed delay — measured at
  ~20ms on an idle session but ~90ms on a busy one, so the previous fixed 50ms was a guess that
  happened to hold only when the session was idle.

  Covered by a test that runs a stand-in for a slow-starting full-screen program and asserts the
  prompt arrives whole and its return arrives as a return; verified separately against the real
  `claude`, where the old code fails this and the new code passes.

## [1.7.1] - 2026-09-10

### Added

- **Chat with Claude from the transcript.** A message box sits under the conversation, so replying
  no longer means switching to the raw terminal. It is not a second conversation: what you type is
  delivered into the very same `claude --resume` process the Session tab shows, as a bracketed
  paste followed by a return — so a multi-line message arrives whole instead of submitting at its
  first newline, and the session's own transcript stays the single record of what was said.
  Sending to a session that isn't running resumes it first.
- **Paste images into the chat box** — or drop them in. Each becomes a thumbnail you can click to
  see full size, and can be removed before sending. Images are written to Apiary's own data
  directory (never into your repository), and the message carries their paths, which is how Claude
  gets to read them.
- **Images render in the transcript too**, past and present: the reader used to discard image
  blocks entirely, so a conversation that included a screenshot showed a gap where it had been.
  Images sent from the chat box are shown back as pictures rather than as the bare path.
- A model picker beside the send button, which types Claude Code's own `/model` command into the
  session.
- **A real settings page.** Two panes — a section list and the section's contents — driven by one
  array, so a new group of settings is an entry in that array rather than another switch appended
  to a growing list. Sessions and General to start with.
- **Automatically import all sessions** (Settings > Sessions). Every discovered session is imported
  without being picked by hand: on startup, and on every rescan — which means the Refresh button
  and the file watcher both honour it, not just one of them. The import dialog says so rather than
  presenting an empty choice.
- **Check for new sessions periodically** (Settings > Sessions), with an interval you set. Apiary
  already notices session files as they change; this is for the rest — a session started in a
  terminal outside the app now appears on its own. Off by default, because each scan shells out to
  git once per project.
- The import dialog can be dragged wider from either edge, and remembers the width. Session titles
  and folder paths both run long, and a fixed-width dialog ellipsized exactly the part you opened
  it to read.
- Hovering a session in the import dialog shows its full title and when it was last active.
- A single checkbox selects every session listed. It follows the search box, so it can never
  quietly select rows you had filtered out of view.
- Escape closes the import dialog and the settings dialog, as it already did the branch picker.

### Changed

- **The e2e suite now runs off-screen by default**, so a run no longer takes the machine over for
  minutes at a time. The window is simply never shown; the renderer still lays out and responds
  exactly as before, because Playwright drives it through the debugging protocol either way.
  Background throttling is disabled for hidden windows, since a throttled window stops servicing
  the animation frames the terminal and transcript rely on. Set `APIARY_HEADED=1` to watch a run —
  worth doing when a failure is easier to see than to read. `npm run screenshot` always runs
  visible, since a picture of the app is its entire output.

### Fixed

- **Sending from the chat box needed Enter twice.** The trailing return that submits a message was
  written in the same tick as the bracketed paste it follows; Claude Code's own TUI would show the
  text land in its input box but not treat that immediate return as "submit", requiring a second,
  manual Enter to actually send. The return is now written on its own tick after a short beat, which
  gives the TUI time to finish processing the paste first. (Superseded by 1.7.2: this was a real
  ordering constraint but not the cause of the reported problem, and it did not fix it.)
- **A dialog opened from one column is no longer painted through by the next column** — the
  "transparent" merge-branch popup. `.modal-backdrop` carried no `z-index`, and a modal is
  rendered inside whichever column opened it, so the columns to its right (which contain
  positioned boxes of their own) painted straight over it.
- **No more empty column left stranded beside the real ones.** Closing a tab could empty a column
  without removing it, depending on which of several routes did the closing — the one behind a
  pending session's process exiting did not. Every column update now goes through one place that
  drops an emptied column unless it is the last one, so it cannot be forgotten again.
- A column can no longer be dragged, or squeezed, down to an unusable sliver.

## [1.5.0] - 2026-09-10

### Added

- A "..." menu on the shell pane's toolbar, grouping the git commands the way VS Code groups its
  own instead of spreading them across the toolbar as ever more icons: Pull, Push, Fetch, then a
  **Branch** submenu (Checkout to..., Create Branch..., **Merge Branch...**), then Copy Branch Name.
- **Merge a branch you pick** into the current one, from Branch → Merge Branch. It reuses the same
  searchable list of branches, remotes and tags the branch switcher already had. A conflicting
  merge reports git's own CONFLICT text and deliberately leaves the tree mid-merge — the shell
  directly below the toolbar is where you resolve it, and aborting would throw away the one state
  from which that is possible.
- A split button on the tab bar, so a session already open in a column can be split into a column
  of its own without going back to the sidebar to find its row.
- Draggable dividers between session columns. Widths are kept as proportions, so resizing the
  window redistributes the columns as you left them rather than leaving a fixed column with a gap
  beside it; a column cannot be dragged below a usable minimum.
- Scrollbars have arrow buttons at both ends again. Without them a list could only be dragged or
  paged, with no way to nudge it when the row you want is one line out of view.

### Fixed

- **The bottom of a terminal is no longer cut off** — the real cause this time, found by measuring
  rather than guessing. `.terminal-tab-view` was a plain block, so the terminal host's `flex: 1`
  was inert and its height fell back to `auto`, i.e. to xterm's own content. FitAddon measures that
  host to decide how many rows fit, which made the measurement self-referential: it reported the
  size the terminal already was instead of the size available to it, so the row count never came
  down and the excess was clipped. Measured before the fix: a 352px-tall terminal inside a 167px
  row, its last ~11 rows rendered below the bottom of the window, and no reaction at all when the
  pane was made smaller.
- A long branch name no longer wraps the shell toolbar over two or three lines in a narrow column,
  taking that height from the terminal underneath it. The toolbar is one row tall, always, and the
  branch label ellipsizes.
- The transcript catches up to the newest message when you switch back to it from the live session.
  It was already following along while hidden, but a hidden element cannot be scrolled — the
  deferred scroll was consumed and discarded there, so switching back landed you on the oldest
  message rather than on what the session had just said.
- A folder in the import dialog whose every session is already imported now shows as checked
  rather than unchecked, and a partly-selected folder shows the tri-state dash instead of claiming
  to be one or the other.
- Escape closes the branch switcher, from any of its steps.

## [1.4.0] - 2026-09-09

### Fixed

- The shell pane no longer overflows off the bottom of a short window. It used to be a rigid,
  fixed-height box (`flex: none`); on a window too short to fit it at its full requested height,
  the excess silently ran past the bottom edge and got clipped there — the last line or two of a
  terminal, or the tail of the open-terminals list. The pane now shrinks to fit, down to a floor
  that always keeps its own toolbar reachable.
- Switching to a session tab that has never had its own shell — while the shell pane is already
  open from a different tab in the same column — now spawns one automatically instead of leaving
  the pane rendering nothing. `shellOpen` lives at the column level, not per tab, so this used to
  require a Hide-shell/Show-shell round trip to notice the pane was actually open.
- The sidebar's Refresh button no longer visibly shrinks while it spins. It used to swap its whole
  "Refresh" label out for a bare spinner glyph, which changed the button's width; the label now
  stays put and only the icon inside it spins.

### Added

- A rename button next to the trash button on hover, for every terminal in a session's shell —
  with several terminals open there was previously no discoverable way to tell them apart or clean
  them up beyond double-clicking a label to rename it, or a hard-to-notice trash icon.
- A screenshot of the app in the README, above Features — three sessions open side by side, each
  with its own shell, alongside the sidebar's pinned and grouped sessions. Regenerate it with
  `npm run screenshot` (`scripts/screenshot.spec.ts`), whenever a change is significant enough
  that the README's picture should catch up.

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
