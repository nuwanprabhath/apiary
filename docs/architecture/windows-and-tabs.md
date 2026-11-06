# Windows, tabs and relaunch persistence

Read with root CLAUDE.md; this covers the multi-window architecture in full.
[`src/main/CLAUDE.md`](../../src/main/CLAUDE.md) has the short version and points here.

## Windows, and what belongs to which

Apiary is multi-window, and the division is worth stating because getting it wrong is silent:

- **A pty belongs to the main process, not to a window.** Two windows can show the same session,
  and both are attached to the one process. A view that attaches *late* — a second window, a tab
  switched back to, a tab moved between panes — is caught up from a **rendered snapshot**
  (`PtyManager.snapshot()`, built by `ScreenBuffers` with `@xterm/addon-serialize`), never from the
  raw byte history. A prior version kept a 256KB-per-pty raw replay buffer for this (`replay()`),
  but a byte stream is not safe to catch a view up with: it was produced at whatever widths the
  session had over its life, by a program that places each word at an absolute column, so replayed
  into a narrower pane it scrambled the conversation. `replay()` had no production caller by the
  time this was noticed (MAIN-5) and was removed — `snapshot()` was already the only catch-up path
  in use. `TerminalView` paints the snapshot at the snapshot's own size, waits for xterm to *parse*
  it (`write()` is async, `resize()` is not), and only then fits and resizes the pty so the program
  repaints. Change that order and the scrambling returns — `tests/unit/screenSnapshot.test.ts`
  measures it against the recorded sessions.
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
- **A window's attachments follow the page it shows, not every navigation it starts.**
  `windowLifetimeWatcher` (`src/main/windows/windowAttachments.ts`) detaches a window when it is
  destroyed or its main frame commits a new page (`did-navigate`). It does not listen to
  `did-start-navigation`: a link clicked in a reply starts a navigation that
  `src/main/windows/navigationGuard.ts` cancels and hands to the browser, and the page stays put.
  Detaching on the start dropped the window's chat, so its working line vanished
  (`tests/e2e/transcriptChat.spec.ts`, "a link clicked in a reply opens in the browser").

## Persistence: window and tab state across a relaunch

`src/main/windows/sessionLayoutStore.ts` persists every window's panes and tabs to a JSON file (not
SQLite), debounced 500ms and keyed by window number. The renderer reports its own layout after a
500ms debounce of its own whenever it changes, and reports bounds on move/resize; the store
re-debounces on top of that to coalesce several windows' writes into one disk write. A record
carries a `hasLayout` flag alongside the bounds so a bounds-only stub (a window that only moved)
is never confused with a genuinely empty one — without it, a quit landing inside the renderer's
debounce window could wipe a live layout instead of just not having heard about it yet.

At launch, `src/main/index.ts` reads the stored record, recreates each window at its saved bounds,
and seeds its layout, tabs and shells from it. `src/main/windows/sessionLayoutRestore.ts`'s
`pruneStaleLive` drops any `live` session id that no longer resolves — a deleted transcript, a
missing cwd — but keeps the tab itself so it shows closed rather than vanishing outright.

A window comes back on its monitor, at its size, maximised or full screen if it was:

- **What is kept.** The record keeps the window's normal (unmaximised) bounds, which also say which
  display it was on, and its `shape` (`maximized`, `fullScreen`). Both are saved on every move,
  resize, maximise and full-screen change (`onShapeChange` in `windowManager.ts`).
- **How it comes back.** The window is created at those bounds, then maximised there as it first
  shows (`showAs`). `maximize()` maximises on the display the window is on.
- **A gone display.** Bounds no display overlaps (`boundsAreOnScreen`) fall back to a default position.
- **Linux on a Wayland desktop.** A Wayland app cannot place its own windows, so GNOME put every one
  where it liked. There Apiary runs itself again as an X11 client through XWayland, before anything
  starts (`needsXWayland` in `app/launchMode.ts`), unless Settings → General turns it off
  (`linuxXWayland`).
- **The test.** `npm run test:windows` (`tests/windows/`) checks all this on an Ubuntu 26.04 X11
  desktop with two monitors.

Resuming a session that was genuinely running at quit does not respawn it: `AppService.resume()`
checks `PtyManager.has()` first, the same guard `openShell()` already used, and attaches instead —
otherwise two windows racing to restore the same `live` session at once would each try to spawn
over the other's pty (`spawn()` kills whatever is already under an id).

## Window buttons in the status bar

With more than one window open, the left end of every window's status bar has a button per window,
as a taskbar has (`features/statusBar/WindowButtons.tsx`).

- **Names.** Each page names its window after its active tab (`useWindowTitle`), and main reads
  the names back with the windows' focus and minimised state (`main/windows/appWindows.ts`, the
  `appWindows` channel, `appWindowsChanged` on any change). The OS's own window list shows the same
  names.
- **Clicking a button.** It raises that window (`appWindowRaise`). A window that was never shown, as
  in a headless run, stays hidden.
- **Glow.** A button glows as a tab does (`data-glow`), from the activity of that window's tabs
  (`useWindowActivity`): waiting for you first, then working.
- **Preview.** Hovering takes a picture of the window (`appWindowPreview`, `capturePage`) every
  1.5 s while the preview is open (`watchAppWindowPreview`).
- **Remote windows.** The channels are `local`: a remote window lists this machine's windows, which
  it is one of. Its tabs' activity is the work machine's, so it draws no glow.

## The tab registry

`src/main/windows/tabRegistry.ts`'s `TabRegistry` holds only what each window last reported about
its own open tabs (`report()` replaces a window's set wholesale; absence means closed) — no derived
state, so nothing here can go stale on its own. `list()` flattens the registry across every window
for the Active section, and `focusTab()` raises the owning window and selects the tab in it.

Activity status is computed fresh at render time, not cached in the registry.
`src/main/ipc/handlers/tabs.ts`'s `activeTabs` handler asks `PtyManager` for each tab's state as it
answers, so the dot always reflects the pty as it is right now rather than as it was when a tab
last reported. See [activity.md](activity.md) for how that status is classified.

See also [session-following.md](session-following.md) for which Claude session a terminal is on
after a rename, fork or resume.
