# src/renderer/features/folderBrowser

Read with root CLAUDE.md and `docs/proposals/2026-10-10-remote-access.md`. In a remote window the
native folder picker would open on the work machine's screen, so "New session in a folder…" opens this
browser instead (`App` calls `useFolderBrowserRequest().request()` when `remoteHost()` is not null).

- The work machine holds the position (`src/main/folders/folderBrowser.ts`); the renderer has an
  opaque browse id and sends a child's NAME, a crumb index or "up", never a path (ADR-0001). The
  commands are in `state/folderBrowser.ts`.
- `FolderBrowserDialog` opens a browse on mount and sends `folderBrowseClose` on unmount. A refusal or
  failure shows inline above the buttons. "Start session in X" starts in the folder being shown (X),
  not the selected row: the button names it for that reason.
- Keys, on the list: Up/Down select, Enter enters the selection, Backspace goes up, Escape closes
  (`Modal`). A double click enters.
- `crumbs.ts` folds the middle of a deep path into one "…" (title: the whole path) so it never clips.
- Tests: `tests/component/folderBrowser.test.tsx`, scenarios in `tests/component/ui/folderBrowser.ui.test.tsx`.
