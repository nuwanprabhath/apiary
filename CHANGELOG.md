# Changelog

All notable changes to Apiary are documented here. Format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versions follow
[Semantic Versioning](https://semver.org/).

## [1.19.0] - 2026-09-24

### Fixed

- **A session's tab now follows the session its terminal is really on.** Typing `/resume` in a new
  session, or `/clear` in any session, moves Claude to another session in place, and Apiary had been
  guessing which session a terminal belonged to. A new session in which you typed `/resume` stayed a
  `new:<uuid>` tab for good: its id shown in Active, pinning it did nothing, it never reached Recent,
  and Fork and Move into New Window were greyed out. Apiary now reads Claude's own record of which
  session each running terminal is on, so all of those work, and a forked or new session is picked
  up as soon as it has a transcript. Verified against real Claude sessions: a new session, `/clear`,
  `/resume` inside a new session, and a fork from the tab menu.
- **Sessions no longer silently stop saving when Apiary is started from inside Claude Code.**
  Launched from a shell Claude Code had opened (an `npm start` in a Claude terminal, or a VS Code
  window with the Claude extension), Apiary passed that session's markers on to every session it
  started, and Claude then saved no transcript for any of them.
- **Renaming a session in Claude now shows in Apiary,** and **renaming it in Apiary now reaches
  Claude**, so the VS Code extension and `/resume` show the same name. Apiary types `/rename` into
  the running session only when Claude is idle and nothing is typed in its input box; otherwise it
  waits, and gives up rather than interrupt. A session nobody has typed in yet is called "New
  session" rather than showing its raw id.
- **Links in a transcript open in your browser.** Clicking one used to turn the Apiary window into
  that web page, with no way back.
- **Merge-request status stays current, and Refresh re-checks it.** A row asked for its MR status
  once, when it appeared, so a merged `!1328` could say "opened" in Active all day. Rows now re-ask
  every couple of minutes, and Refresh discards what is cached. Open MRs are re-checked sooner than
  merged or closed ones.
- **The layout picker no longer vanishes on the way to it.** Moving from a row's layout button to
  its picker crossed the row's other buttons, and the picker closed unless you moved fast.
- **Recent's dismiss button** is now the same size as the row's other buttons and sits among them,
  instead of a larger button on top of the layout button.
- **Dragging a tab from a torn-off window back onto the main window moves it back.** It could be
  refused (a still-unresolved tab) or, on Linux, swallowed by the main window's tab strip.
- **Searching straight after launch finds sessions by what was said in them.** A search typed
  before the search index had caught up got an empty answer and kept it until the query changed;
  it is now asked again as soon as the index updates.
- **Exiting a session no longer closes its tab.** Its tab stays, with its transcript, and Active
  shows it as stopped — a state that could previously never be seen.

### Added

- **Torn-off windows keep the sidebar,** folded to its rail by default so the session still gets
  the room.
- **Collapse-all on group headers,** like the one on folder rows: every folder in the group folds,
  and the group stays open.
- **Edit a session's note from its Active row.**
- **More in the diagnostic log**: which session each terminal moved to, tabs following them,
  whether a rename reached Claude, merge-request lookups, and links opened or blocked.

## [1.18.2] - 2026-09-22

### Added

- **Pull the latest of a branch from a folder's hover card.** A down-arrow beside the branch
  name fast-forwards that worktree from its upstream and says how many commits arrived, or that
  it was already up to date. It only ever fast-forwards: if the branch has diverged, or an
  uncommitted change would be overwritten, git's refusal is shown and nothing is changed — so a
  click on a folder you are not looking at can never leave it mid-merge. Offered on folder cards
  only, since a session card's branch may be the one it was recorded on rather than today's.

### Fixed

- **Clicking a session no longer scrambles the conversation in its terminal.** A terminal
  attaching to a running session was caught up by replaying the session's raw output, which had
  been drawn at other widths by a program that places every word at an exact column; in a
  narrower pane, words landed in the wrong places and lines overwrote each other. It is now given
  a rendered snapshot of the screen instead, painted at the size it was drawn at before the pane
  resizes it. Measured on recorded Claude sessions: 156 garbled lines before, none after.
- **Updating a .deb installation on Linux downloads the .deb.** It downloaded the AppImage — not
  what was installed, and on Ubuntu 22.04 and later unable to start at all
  (`dlopen(): error loading libfuse.so.2`). The banner now offers `sudo apt install` on the
  downloaded package, verified on a stock Ubuntu 24.04. An installation still on 1.18.1 or
  earlier will fetch the AppImage one last time: install 1.18.2's `.deb` from the release page by
  hand to get past it.

## [1.18.1] - 2026-09-21

### Changed

- **Hover cards open beside the sidebar instead of over it.** Below the row, a card covered the
  next several sessions, so you could neither read them nor move onto the next one without first
  backing out. It now sits out past the sidebar's edge, top-aligned with its row, and the list
  underneath stays whole. (An older version placed it beside the row and was moved for covering
  neighbouring rows; the rule now checked is simply that the card covers no session at all.)
- **Reading down the list is quicker.** Once one card is showing, the next row's opens after a
  brief pause rather than the full hover delay, so running the pointer down the sidebar reads
  each session in turn instead of flickering blank between them.
- **Only one hover card or layout picker is ever open at a time.** Opening one closes any other,
  so cards cannot stack up whatever their timers do.

### Fixed

- **Scrolling the sidebar no longer leaves a trail of hover cards.** Rows sliding under a still
  pointer each opened a card, and none of them could close: the same event that would have
  dismissed one was being discarded as "the row moved, not the pointer" — which is exactly what a
  scroll looks like. Cards are now put away as soon as the list moves and come back once it
  settles, on the row the pointer actually ended up over.
- **The layout picker opens beside its button instead of below it.** Directly underneath, the
  pointer had to cross the next session rows to reach the menu, and each row it crossed armed its
  own hover card and stole the gesture before the menu could be clicked.
- **The layout picker can no longer be stranded in the corner of the window.** A hidden or
  detached button reports an all-zero rectangle, which the placement maths clamped to the top-left
  margin, and the popup then sat there ignoring clicks. A popup with no real anchor is no longer
  opened at all.
- **The Active section shows merge-request status,** matching the tree and Pinned. A session
  titled `!1261` read `(merged)` two sections down while Active showed the bare title — the
  section meant to be read at a glance was the one out of date.
- **Collapsing a folder that holds the open session is no longer undone.** With "Reveal the open
  session in the sidebar" on, revealing re-ran on every collapse change, so clicking the chevron
  could be reverted by the render it caused. Revealing now responds to the selection changing, as
  intended, rather than standing as a rule that keeps those folders open.

## [1.18.0] - 2026-09-19

### Added

- **Windows come back the way you left them.** Every window's size, position, panes and tabs are
  restored on relaunch, and a session that was actually running when you quit resumes running
  rather than reopening as a plain transcript.
- **Search stays responsive with thousands of sessions.** Typing is never blocked by filtering:
  the box shows what you typed immediately and a small spinner while the results catch up, rather
  than appearing to swallow keystrokes and then producing them all at once.
- **An Active section above Pinned** lists every session open across all your windows — including
  ones torn off into a window of their own — with a status dot for running, waiting on you, idle
  or stopped. Each state has its own animation as well as its own colour: a slow breath while
  Claude works, an insistent double pulse with a marked row when it is waiting on an answer, and
  stillness when nothing is happening. Hover the section header for a legend. Clicking a row
  brings its window forward and switches to its tab.
- **A Recent section below Pinned** lists sessions you've used in the last few hours, so the one
  you were just in doesn't get lost in a folder. The window is configurable in Settings, the
  section itself can be switched off, and any row in it can be dismissed on its own.
- **A GitLab MR reference in a title or note now shows its status.** `!1267` renders as
  `!1267 (merged)` (or open, or closed), resolved through the `glab` CLI you may already have
  authenticated for the MR button; without `glab` it degrades to plain text.
- **Drag a session onto another worktree to move it there,** with a confirmation before anything
  happens on disk.
- **The branch switcher checks out an exact match on Enter**, instead of requiring a click into
  the list first.
- **An "Open in VS Code" button** on a session's hover card, next to the path.
- **Every assisted update now offers a copyable install command** — the .deb and AppImage on
  Linux, the .dmg on macOS — so a stalled or declined auto-install still leaves you with something
  to run by hand.

### Fixed

- **The Ubuntu "Open installer" button did nothing.** It ran a fixed ten-second wait and reported
  success regardless of what happened, so a slower launch — or one that never started at all —
  looked identical to a working one. Downloaded AppImages were also missing their executable bit,
  which is why even a prompt launch of the installer silently failed. Both are fixed: the button
  now waits on the process actually starting and reports what really happened.
- **Typing in the search box could freeze the whole app for seconds.** The content search ran on
  the main process's thread, and a one- or two-character query made the index scan every word
  beginning with those letters — measured at 7.7 seconds for a single letter. Because keystrokes
  reach a window through that same thread, typing stopped dead and the characters all appeared at
  once when it finished. The search now runs on a thread of its own, so a slow one costs nothing
  but later results, and very short fragments no longer trigger the expensive scan.
- **A failed content search now says so** instead of quietly looking like a search that found
  nothing.
- **Search no longer lags as you type.** Filtering used to rebuild a pruned tree in the main
  process on every keystroke; it now runs in the window against a cached tree, and results are a
  flat list ranked by best match instead of a tree with branches pruned out of it.
- **Pasting into a terminal wrote the text twice**, and could leave a literal `^[[200~` sitting in
  the input. Reported on Ubuntu, where Chromium fires its own paste on Ctrl+Shift+V in addition to
  the one xterm already handles; paste now goes through xterm's own write path so it lands once,
  cleanly, on every platform.
- **Closing a window could crash the app**, from a closed-window handler that read the very
  `webContents` that had just gone away.
- **A session's hover card could be dismissed out from under you** when the sidebar reflowed
  underneath it — the Recent and Active sections changing the sidebar's height was enough to
  trigger it. The card now stays anchored to its row through a reflow.

## [1.17.0] - 2026-09-17

### Added

- **Layouts of up to four sessions in one window.** Rest the pointer on a session's split button
  in the sidebar, on the split button at the end of a tab strip, or on the small layout icon of a
  tab, and a picker shows eight layouts — single, two columns, two rows, three columns, a main
  pane with two beside it (either side), a top pane with two below, and a 2×2 grid. Click the spot
  you want the session in and it goes there; the other panes arrange themselves around it. The
  same picker is under **Arrange…** in the right-click menu of tabs and sidebar sessions.
- **A layout button** on the top-right pane changes the layout without moving anything.
- **Empty panes offer what to put in them** — your other open tabs first, then recent sessions,
  with a search — or can be closed.
- **Dividers between rows** as well as columns.

### Changed

- **Splitting stops at four panes.** A split with four panes already open opens the session as a
  tab in the next pane.
- **Closing a pane's last tab steps the layout down** — a grid becomes a main pane with two beside
  it, and so on — rather than leaving a gap.
- A plain click on a split button still opens the session to the side, as before.

## [1.16.0] - 2026-09-17

### Added

- **F2 renames a terminal.** Pressed in a bottom shell it opens the terminal list with that
  terminal's name ready to edit; pressed on the list it renames the terminal in front. The pencil
  button still works, and its tooltip now names the key.
- **Hovering a folder shows where it is.** A repository or worktree row raises the same card a
  session does, with the full path and a button to copy it. Session cards gained the same copy
  button beside their path.
- **Collapse all, per folder.** Hovering a folder that has worktrees beneath it shows a button
  that folds every one of them, leaving the folder itself open as a short list of its worktrees.
- **The sidebar can be hidden.** A button at the left of the search row folds it to a thin rail,
  whose button brings it back; View → Toggle Sidebar does the same (⌘B on macOS, Ctrl+Shift+B
  elsewhere — plain Ctrl+B is the shell's own key). Each window remembers its choice, and the
  search you typed is still there when the sidebar returns.

### Fixed

- **A running session moved to another window keeps running there.** Dragging a tab onto another
  window, or using Move into New Window, handed the other window only the session's id. A session
  started or forked in Apiary runs under a terminal id only the original window knew about, so the
  receiving window found nothing running and showed the session as stopped, while the process ran
  on with nothing showing it. A moved tab now carries its terminal, the view it was on and its
  bottom shells with it.

## [1.15.0] - 2026-09-16

### Added

- **A diagnostic log, off by default.** Settings has a Diagnostics section that switches on a
  local log, shows the folder it is in, opens it, and empties it. It exists because of a bug that
  could not be reproduced: "Open installer" failed on one machine with an Electron IPC message,
  every hypothesis about why was disproved in a container, and nothing in the app had recorded
  what it actually tried.

  - **Off means nothing is written** — no folder, no file. The section says what is recorded
    before you switch it on.
  - **Your conversations are never in it.** No prompts, no replies, no transcript text: not
    redacted, simply never passed to the logger. What is recorded is what Apiary did — terminals
    it started, git commands and how they ended, what the updater tried, which settings are on.
  - **Paths have your home directory replaced with `~`**, and anything shaped like an API key,
    a GitHub or GitLab token, a bearer header, a JWT or a `password=`/`token=` parameter is
    stripped before it is written. Every field is redacted on the way in, so no call site can
    forget to.
  - **Kept inside two limits you set** — how many days, and how much disk in total. Where they
    disagree the size limit wins, and the oldest files go first.

- **Every IPC handler failure is recorded**, with its channel and how long it ran. That is the
  instrumentation the "Open installer" bug needed and did not have: a channel name and a duration
  tell a handler that threw from one that never returned.

## [1.14.0] - 2026-09-16

### Added

- **A branch that another worktree already has is now an offer, not an error.** Checking one out
  used to fail with git's own sentence — "fatal: 'dev/1.0.12' is already used by worktree at
  '/…'" — leaving you to go and find that directory by hand. Apiary now says which worktree has it
  and offers the two things anyone wants at that moment: pull it there, or start a Claude session
  there. The worktree is found with `git worktree list --porcelain` rather than scraped out of the
  message, and the follow-up actions name the *branch*, never a path.

### Changed

- **The prompt trim is switched on, at one folder, for everybody.** It was already the default in
  1.13.2, and that default could never have reached anyone: the app rewrites the whole settings
  file every time its window is moved, so `terminalShortenPath: false` was already written down in
  every existing install, chosen by nobody. Settings files now carry a version and are migrated on
  read. A trim you switched on yourself, or a segment count you chose, is left exactly as it is.

### Fixed

- **"Open installer" no longer reports Electron's plumbing at you.** Pressing it could surface
  "Error invoking remote method 'apiary:update-open-downloaded': reply was never sent" — which
  says nothing about the installer sitting on your disk. The hand-off to the desktop is now
  bounded, so it always finishes one way or the other, and a failure says where the file is
  instead of quoting the IPC layer.

## [1.13.2] - 2026-09-15

### Changed

- **The README screenshot's live session no longer looks half-loaded.** The stand-in `claude` used
  to capture it printed a fixed block at whatever size the pty happened to start at, so its content
  stopped halfway down the pane with the input box floating in the dead space — while the
  transcript columns either side filled theirs. It now draws to the size of the pane and keeps its
  composer on the last row, the way a real session does, and redraws when the pane is resized.

## [1.13.1] - 2026-09-15

### Fixed

- **Dragging a tab onto another window did nothing.** The first version of the gesture assumed the
  window being dropped on would receive the drag — and it does not: an HTML5 drag started in one
  Electron window delivers no `dragenter`, `dragover` or `drop` to any other, so the receiving
  window never hears about the gesture at all. Where a tab went is now decided in the main process
  from where the pointer was released, measured against the windows' own bounds, and the receiving
  window is told to take it. Released over the window it came from, nothing happens; released over
  no window, it becomes a window of its own.

## [1.13.0] - 2026-09-15

### Added

- **Move a session into a window of its own.** Right-click a tab and choose *Move into New Window*,
  or drag it out of the window and drop it on the desktop. The window that opens has no sidebar —
  the conversation and its shell get the whole screen, which is the point of tearing it off.
- **Drag a session tab from one window to another.** Two Electron windows are two OS windows, and
  HTML5 drag data does not survive the crossing, so the tab being dragged is held in the main
  process for the length of the drag and the receiving strip asks for it. The tab leaves the window
  it came from: it is a move, not a copy. Opening the same session in two windows from the sidebar
  still opens it in both, deliberately.
- **Fork a session**, from the right-click menu on a tab or on a sidebar row. The fork starts as a
  copy of the conversation so far and opens *beside* the original, titled `fork: <original>`; the
  original is untouched.
- **A terminal that arrives late is caught up.** The main process now keeps a bounded buffer of
  each terminal's recent output and replays it to any view that attaches afterwards. Before this,
  a session opened in a second window — or a tab moved into one — got an empty terminal, and a
  program sitting at a prompt may never print again, so it stayed empty.
- **The prompt-shortening setting shows a worked example** of what it will do to a real worktree
  path, so the effect of "keep the last N folders" is something to look at rather than to reason
  about.

### Fixed

- **A merged merge request no longer disappears.** `glab mr list` returns only *open* merge
  requests unless told otherwise, so the moment one merged it vanished from the answer and the bar
  offered to create a second merge request for a branch that had already landed. Merge requests are
  now asked for in every state, and merged and closed ones get their own glyph and their own word
  in the tooltip.
- **"Open installer" did nothing on Ubuntu.** A stock 24.04 desktop registers no handler for a
  `.deb`, and `shell.openPath` on one reports success having done nothing — so the button was dead
  and its error fallback could never fire. A downloaded `.deb` is now revealed in the file manager,
  and the banner offers the `sudo apt install …` command that actually finishes the job.
- **The download banner no longer tells Linux users to drag Apiary into Applications.** What to do
  with a downloaded installer is decided where the platform is known, and travels to the banner as
  words.
- **The shortened prompt reaches the session's own terminal**, not only the shell tabs — the
  setting was wired into one and not the other, so it looked broken to anyone who tried it where
  they actually work.
- **A shell open in two windows is no longer killed by the second one.** Shell tab ids are minted
  per window and the first is always `1`, so a session shown in a second window asked for the very
  pty the first was using — and spawning over a live pty kills it. A build, a `tail -f` or an
  editor running there died silently. The second window now attaches to the running shell.
- **Forking from the "already running elsewhere" dialog attached the terminal to the wrong
  session.** `--fork-session` makes Claude write a *different* session, but Apiary keyed the
  terminal by the original's id: the original's transcript never moved, the fork turned up later as
  a row with no terminal behind it, and pressing Resume on it started a second process. Forking is
  now its own operation rather than a flag on resume.

### Changed

- **The prompt trim keeps one folder by default, not two.** Measured against bash: on
  `~/projects/thing.worktrees/pipeline-issues`, two folders keeps
  `thing.worktrees/pipeline-issues` — almost the whole path. The last component is the one that
  says which worktree you are in. (Existing installs keep whatever they have set.)
- **Whether a session has a terminal is now asked of the main process** rather than remembered per
  window, so a second window knows about a session the first one started.

## [1.12.1] - 2026-09-14

### Fixed

- **"Check now" appeared to do nothing.** On a build with no updater — running from source, or a
  platform without one — the press was swallowed in the main process, which pushes no status back,
  so nothing on screen changed. The button is now disabled there, with the reason beside it. Where
  a check *can* run, its answer is shown next to the button that asked for it: the banner the
  pushed status feeds is drawn behind the settings dialog's backdrop, so an answer that only ever
  appeared there was invisible to whoever pressed the button.
- **A secondary button next to a primary one looked shorter than it was.** Both measure the same
  26px; the outlined one was drawn *darker* than the panel behind it, so it read as a hole rather
  than as a block, and a hole beside a solid fill does not look like the same size. Buttons now
  sit a step lighter than their panel and fields a step darker — a button is on top of the page, a
  field is cut into it — which is the distinction the old single surface was missing.

## [1.12.0] - 2026-09-14

### Added

- **One design system for every control.** Height, padding, corner radius and focus ring are now
  tokens alongside the colours at the top of `styles.css`, and every button in the app resolves
  them through a single base rule (`.btn`, plus the container-scoped aliases the existing dialogs
  use). Theming was always the plan for the colours; this extends the same promise to shape and
  size, so "buttons are too tall" is one edit rather than a search through forty rules.
- **Refresh says what it found.** Pressing Refresh raises a notification — how many sessions the
  rescan added, or plainly that there were none. A rescan usually changes nothing visible, so the
  only feedback before this was a spinner stopping, which is indistinguishable from a button that
  does nothing.

### Changed

- **A new refresh icon**: two arrows chasing each other round a circle, the shape every browser's
  reload button uses. The old single arc with one arrowhead read as a circle with an arrow stuck
  in it.
- **Checkboxes are drawn by the app**, not by the platform. An unchecked native checkbox is a
  white box, which in a dark panel is the brightest thing on screen and reads as a text field;
  a checked one was drawn in the *OS* accent colour rather than Apiary's.

### Fixed

- **"Update settings" in the update banner opens the Updates section.** It opened Settings on
  Sessions, three clicks from anything the button names, which reads as the button being wired to
  the wrong thing.
- **Buttons that looked like they came from another application.** The update banner's buttons and
  Settings' "Check now" and "Rebuild index" carried no styling at all, so Chromium drew its native
  macOS control — white, and a different size from everything around it. Between the app's own
  button rules there were four different paddings, which is why a Cancel and a Save sitting side
  by side were visibly different heights.

## [1.11.1] - 2026-09-14

### Added

- **Plugins declare their own settings, and Settings draws them.** A plugin says what it takes — a
  text field, a checkbox, a number, each with a label and help — and the Plugins section renders it
  under that plugin, saving it namespaced by plugin id. A new plugin gets a working, consistent
  settings panel without the dialog knowing anything about it, and everything configurable about
  plugins stays in one findable place instead of spreading into sections named after individual
  integrations.
- **A target branch for new merge requests**, the first such setting. Left empty, GitLab picks the
  project's default branch as before; set to `dev/1.0.12`, the new-merge-request form opens with
  that as the target. The empty case leaves the parameter out of the URL entirely rather than
  sending a blank one, which GitLab would take as the answer.

### Fixed

- **The sidebar hover card and the session bar disagreed about the branch.** The card showed the
  branch recorded in the session's JSONL when it ran; the bar shows the branch the folder is on
  today. Both were true and both were labelled "Branch". The card now leads with the live branch —
  the same one the bar shows — and names the other "Ran on", only when they differ.
- **Changing a plugin setting no longer leaves its button briefly stale.** The cache was cleared on
  a settings change, so the bar had nothing to show until a fresh lookup landed, and in that gap a
  click still carried the URL computed under the old setting. Cached answers are now recomputed in
  place, and a lookup asked for while one is running joins it rather than being handed the stale
  answer it was trying to get past.

## [1.11.0] - 2026-09-14

### Added

- **A merge-request button on the session bar.** When the branch you are on has a GitLab merge
  request, the bar shows it by number (`!1255`) and clicking opens it in your browser. When it has
  none, the button offers to create one and opens GitLab's own new-merge-request form with the
  branch already chosen — the title, description and reviewers belong in GitLab, not in a button.
  Merge requests are looked up with `glab`, GitLab's own CLI, so **Apiary never holds a token of
  yours**: it uses the login `glab auth login` already made, including on self-hosted instances.
  Without `glab` the "create one" half still works, since that needs nothing but the git remote.
- **The bar takes plugins.** The merge-request button is the first thing on that bar Apiary itself
  has no business knowing about, and it will not be the last, so the bar now takes contributions
  instead of growing another hardcoded button. A plugin answers one question — given this folder
  and this branch, what would you put on the bar? — and describes a button rather than returning
  markup; what a click can do is a fixed list, checked in the main process. Plugins are listed and
  switched on and off in a new Plugins section in Settings.
- **A setting to shorten the path in terminal prompts.** A worktree path takes most of a narrow
  terminal's first line before anything is typed, and the part that identifies it is the end.
  Apiary can ask the shell to keep only the last few folders, using bash's own `PROMPT_DIRTRIM`, so
  the rest of your prompt — its colours, its git segment, its shape — is untouched. Applies to
  terminals opened from then on. zsh has no equivalent variable and is left alone, which the
  setting says.
- **A copy button beside the branch in the sidebar hover card.**

### Changed

- **The sidebar hover card appears below the row instead of beside it.** Beside meant it covered
  the sessions either side of the one being pointed at — exactly the rows being compared against
  it. It also stays up while the pointer moves onto it, so the copy button can actually be reached.

## [1.10.2] - 2026-09-12

### Fixed

- **A saved note was never indexed, and Rebuild index did not help.** A settings save whose
  payload did not carry a given field wrote `undefined` over that setting. `undefined` is falsy,
  so note search switched off inside the running process and took the note index with it — that
  being what switching it off is meant to do — and `JSON.stringify` then dropped the key on the
  way to disk, leaving `settings.json` still reading `true`. Nothing about the state was visible
  from the outside, which is why the checkbox looked right while nothing was indexed. A field the
  payload does not carry now means "leave it alone", never "off", and the two search settings
  ignore anything that is not a boolean.

### Note

- If your notes are not being found, restart Apiary once: it re-indexes every note it has at
  startup, and this release stops the state going wrong again.

## [1.10.1] - 2026-09-12

### Fixed

- **A row with a note showed two note icons while hovered** — the mark saying one exists, beside
  the button for editing it, as near-identical glyphs. The mark now steps aside on hover the way
  the timestamp already does; the button is drawn filled when there is a note, so nothing is lost.

## [1.10.0] - 2026-09-12

### Added

- **Notes on sessions.** Hovering a session in the sidebar reveals a note button; the note you
  write there — what you were chasing, the ticket, the merge request you had open — shows in the
  row's hover card, and a small glyph marks the sessions that have one so they can be picked out
  of the list at a glance.
- **Notes are searched from the search box.** A note saying `nightly pipeline failure, MR !1257`
  is found by `nightly`, by `!1257` and by `1257`, the same identifier-first tokenising the
  transcript search uses. A note becomes searchable the moment it is saved rather than at the next
  index pass.
- **Search settings has a switch for it.** Turning note search off empties the note index — an
  index of things the user asked not to be searched should not sit on disk — and leaves the notes
  themselves untouched and still shown on hover. Turning it back on repopulates from the notes,
  which is instant: notes are indexed separately from transcripts, so neither setting can make the
  other re-read a session file.

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
