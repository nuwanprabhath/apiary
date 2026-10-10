# Renderer state: IPC stores, layouts, tree cache and local filtering

Read with root CLAUDE.md; this covers `createIpcStore.ts` and the stores built on it, `layout.ts`,
`useSessionTreeCache`/`useTree` and `treeFilter.ts`. See also [`src/main/search/CLAUDE.md`](../../main/search/CLAUDE.md) for the FTS5
index this filtering never touches.

## Which store

| The state is… | Use | Example |
| --- | --- | --- |
| owned by main and pushed to the window | `createIpcStore` / `createKeyedIpcStore` | `petsStore`, `chatStore` |
| this window's only, in memory, outliving the component that set it | `createLocalStore` | `chatSettingsStore` counts changes so readers re-render |
| saved per viewer (sizes, collapsed sections) | `state/uiState.ts` | the sidebar width; per-chat settings (`CHAT_SETTINGS_KEY`, shared by every window, read through `chatSettingsStore`) |
| the workspace (tabs, panes, layout) | the workspace store (`features/workspace/`) | `useWorkspaceSelector` |
| one component's own, gone when it unmounts | `useState` | a draft, an open menu |

A hand-written listener set plus `useSyncExternalStore` is none of these: `stores-via-factory` keeps
`useSyncExternalStore` inside the factories. Both factories start over when a component test swaps
in a new `window.apiary`, so a store needs no test plumbing of its own.

## Reading data main pushes: `createIpcStore`

**One way to read it.** Anything main owns and pushes (pets, the update status, the status bar, a
chat, the tree, the active tabs, the pty→session map, the settings the renderer acts on) is read
through a store from `createIpcStore.ts`: `petsStore`, `updateStore`, `statusBarStore`,
`chatStore` (keyed by session), `settingsStore`, `activeTabsStore`, `ptySessionsStore` and
`treeStore`. A component never fetches and subscribes by itself; the `bridge-via-state` lint rule enforces it.

- A store has **one subscription and one in-flight fetch** however many components read it, wired
  when the first reader arrives and unwired when the last leaves. `useChat(sessionId)` in a pane's
  header and body is one `chatState` call and one `onChatChanged` listener, and a chat push wakes
  only that session's readers.
- **A push that lands while a fetch is in flight wins**; the older fetch is dropped. Overlapping
  fetches are latest-request-wins. This is the ordering `usePets` and `useUpdate` got wrong.
- A push carrying no payload ("the tree changed") is `invalidate()`, which re-fetches. Code that
  must react to it too uses `store.onInvalidate`/`treeStore.onChanged` rather than its own
  `window.apiary.on…` listener, so there is one IPC listener and a fixed order.
- `current()` joins a fetch started since the last signal and never reuses a finished one;
  `refresh()` always starts one. `getSnapshot` is pure: a store whose bridge is not the current
  `window.apiary` (a component test swapped it) answers `initial`, and starts over on the next
  subscribe, so tests do not share data.
- Lifetime: an unkeyed store keeps its last value for the window's life and re-reads when a reader
  arrives after none was left; a keyed store forgets a key when its last reader leaves.
- A store keyed by id (a chat per session) is `createKeyedIpcStore`. `keysOf(value)` says which keys
  a push belongs to (a chat moved by `/clear` belongs to both sessions). The `attach(key)` option
  tells main which key this window shows, called when a key gets its first reader and undone with
  its last; `chatStore` uses it so main sends a chat's updates only to windows that show it.
- A new store is `createIpcStore({ scope, initial, fetch, subscribe })` in its own `state/*Store.ts`
  with a hook next to it, plus a test of what is specific to it (the generic ordering is covered by
  `tests/unit/createIpcStore.test.ts`). `npm run new -- store <name> --fetch <call>` writes both.
- `ptyBus` and `mrStatusStore` are not on it: the first is a fan-out of an unbounded stream by id
  (no value to hold, nothing to fetch), the second is request-per-session-per-interval with a timer
  and coalescing of iids, not fetch-plus-push.

## Acting on main: commands and the error policy

Why stores and commands: [ADR-0013](../../../docs/adr/0013-renderer-data-layer-stores-and-commands.md).

**A component never touches `window.apiary`.** What it reads comes from a store above; what it
asks main to do is a *command*, a thin typed function in the module of its domain: the store
modules (`petsStore`, `chatStore`, `statusBarStore`, `settingsStore`, `updateStore`) hold their own
commands, and the domains without a store have a flat module each: `sessions`, `transcript`,
`git`, `terminals`, `tabs`, `windowChrome`, `theme`, `plugins`, `diagnostics`, `log`, `clipboard`.
Subscriptions to main's pushes (`onTabAdopt`, `onToggleSidebar`) live there too. A new command for an IPC call you are adding goes in the module of its domain, after `npm run new -- ipc <name>`. A command
composes where a component needs one operation (`spawnShell` picks the bridge call by terminal
kind, `clearLogs` hides the failure it already showed); it does not forward methods for their own sake.

Every command follows exactly one of three policies, named in `policy.ts`; a bare `.catch(() => {})`
or `void window.apiary.x()` is none of them (`no-silent-catch`, `no-void-bridge-call`):

1. **Background.** `background(promise, scope)` / `bestEffort(promise, scope)`: the failure goes to
   the diagnostic log and the user is not interrupted. For whatever the screen already shows the
   outcome of (an update button whose status is pushed), reads that just leave the last value (git
   status poll, plugin bar), and anything best-effort: if failing is harmless it is still logged.
2. **Surfaced.** `surface(promise, 'Could not …')` / `attempt(...)` (which says whether it worked):
   the user did it and would otherwise not know. A toast through the notification centre, once.
   `NotificationProvider` registers itself as the sink; with none mounted the failure is logged.
   `copyText` is this, so every copy button fails the same way.
3. **Returned.** The command returns its promise because the component awaits it for its own UI (a
   busy spinner, an inline error line in a dialog, a result it renders) and catches with
   `describeError`. These are plain exports with no wrapper.

Pick by asking what the user sees when it fails: nothing is wrong with the screen (1), the screen
looks as if nothing happened (2), a control is waiting on the answer (3). Hot paths
(`writePty`, `resizePty`) are one property read away from the bridge on purpose.

## Showing what is running: `activityStore`

The status bar's left side shows what the app is doing, and nothing there knows what it is. To
track a new activity, wrap its promise: `trackActivity({ running: 'Doing X…', done: (r) => 'Did X', failed: 'X failed' }, promise)`
(`state/activityStore.ts`; `state/gitActivity.ts` is the example). It returns the promise
unchanged, so the caller's error handling stays; give it a `key` to disable the control that
started it while it runs (`useActivityRunning`). Finished ones expire (4 s done, 10 s failed).

## Layouts

A window's panes are a `Layout` (`src/renderer/features/layout/layout.ts`): one of eight presets and
at most four panes, each pane being a `Column` with its own tabs and terminals. It is a preset table
rather than a split tree on purpose — "zone three" and "what closing a pane turns into" are then
table lookups, and the picker shows exactly the shapes that can exist.

- **Every change goes through `tidyLayout`** (every layout action in `features/workspace/workspaceReducer.ts`). It closes a pane
  whose last tab went away and steps the layout down, keeps a pane that is *waiting* to be filled
  (`placeholder`), and never lets the pane count exceed the preset. Do not prune panes anywhere
  else.
- **Placing moves; splitting copies.** `placeInZone` moves a tab that is already open;
  `openBeside` (the split button's click) opens a second view, as splitting always has.
- **Nothing a layout change does closes a tab.** A smaller layout folds the extra panes' tabs into
  the last one.
- **Terminals do not care which pane they are in.** Shell ids are `shell:<session key>:<n>`, and
  the pty belongs to the main process (see
  [`src/main/pty/CLAUDE.md`](../../main/pty/CLAUDE.md)), so moving a tab between panes remounts its
  views onto the same processes — the rendered snapshot fills them back in, not a raw replay.
- The pickers are fed through `LayoutContext`, so a sidebar row can place a session without the
  layout being threaded through every component between `App` and it.

## Filtering the tree locally

**Filtering by title, path or branch runs in the renderer, not main.** `useSessionTreeCache`
fetches the full, unfiltered tree once and refreshes it only on an explicit reload or the
watcher's change signal — never per keystroke. `src/shared/treeFilter.ts`'s `filterTreeLocal` then
matches locally against that cached tree on every (debounced) keystroke, folding in any ids that
matched by content. Results are ranked before they're capped, not the other way around — capping
first and ranking what was left over used to mean a great match could be dropped for a mediocre
one that happened to be scanned earlier. Only content and note search still cross the IPC boundary
(`searchContent`, into `AppService.searchSessions` and the FTS5 index — see
[`src/main/search/CLAUDE.md`](../../main/search/CLAUDE.md)), because those need to look inside
files the renderer never holds a copy of.
