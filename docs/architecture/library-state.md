# Library state: what a remote window mirrors

A remote window (remote access, 1.37: a home Apiary showing a work machine's windows over SSH) has
its renderer at home. Anything that renderer keeps in its own `localStorage`, or reads from home's
settings, is home's. Until 1.39 that included the sidebar's groups and pins and each chat's "Show
tool calls", so a remote window listed the work machine's sessions with none of the arrangement
made on the work machine.

## Viewer state and library state

- **Viewer state** belongs to the screen: column widths, which folders this window has open, the
  selected session, the sidebar folded to a rail. It stays per window in `localStorage`
  (`ViewerUiState`, `src/renderer/state/uiState.ts`), and a remote window keeps its own.
- **Library state** describes the sessions: pins, groups and which folders are in them, folder
  order, Recent dismissals and collapsed sections, "Show all worktrees", worktrees made in Apiary,
  each chat's settings and whether tool calls start hidden. It belongs to the machine whose sessions
  it describes.

Library state is declared once, in `LIBRARY_STATE` (`src/shared/libraryState.ts`): a guard and a
default per field. The type, the defaults, the IPC patch guard (`isLibraryPatch`, which refuses an
unknown key or a wrong type), the reading of the file and the component tests' fake derive from it.

## How it flows

- Main owns it: `LibraryStateService` (`src/main/library/libraryStateService.ts`), built in the
  container, persisted through a `JsonStore` in `library-state.json`.
- IPC: `libraryState` (read), `setLibraryState` (a validated partial patch), `seedLibraryState`
  (below), and the event `libraryStateChanged`, broadcast to every window after each change. All
  four are `remote` in `src/main/remote/scopes.ts`, so in a remote window they reach the work
  machine, and the work machine's `broadcast` delivers the event to its remote clients like any
  other `remote` event. The renderer has no special case for remote windows.
- Renderer: `libraryStateStore` (`createIpcStore`), read with `useLibraryState`, written with
  `updateLibraryState(state => patch)`. `useUiState` merges it with the viewer half, so the sidebar
  reads one `ui`; `chatSettingsStore` reads `chatSettings`; `transcriptView` and `CommandPalette`
  read `hideToolCallIo`. The Settings dialog's "Hide tool calls" edits library state, so in a remote
  window it edits the work machine's (the other settings stay home's).

## The move out of localStorage (1.39)

`library-state.json` starts with `seeded: false`. The first **local** window to read it while it is
unseeded sends what 1.38 left in its `localStorage` (`apiary.shared`, window 1's `apiary.ui`, and
`apiary.chatSettings`) through `seedLibraryState`; main applies a seed only while unseeded, and any
write marks it seeded. A remote window never seeds, so a home machine that connects before the work
machine has opened 1.39 locally cannot fill the work machine's library with home's. The old keys are
left in place. `hideToolCallIo` was a setting: settings version 2 drops it from `settings.json`, and
`SettingsService.movedToLibrary()` hands its value to the library state on that launch.

## Adding a mirrored preference

One entry in `LIBRARY_STATE` with its guard and default, then the control that reads
`useLibraryState()` and writes `updateLibraryState`. Nothing else: no IPC, no fake, no migration.
Never add it to `ViewerUiState`; `tests/unit/architecture/libraryStateHome.test.ts` fails when
`uiState.ts` names a library field. Ask whether it describes the sessions (library) or the screen
(viewer); a home preference about home's look (theme, pets) is neither, and stays a `local` setting.
