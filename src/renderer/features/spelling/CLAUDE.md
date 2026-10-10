# src/renderer/features/spelling: text menus and spelling suggestions

Read with [`src/renderer/CLAUDE.md`](../../CLAUDE.md). `TextMenuHost` is mounted once, in
`app/App.tsx`, inside its own `ErrorBoundary`. It owns the right-click text menu and the left-click
spelling menu for every editable field (textarea, input, contenteditable). The app's other menus
mark their element with `data-own-context-menu`, which keeps `TextMenuHost` off that element.

## Where things are

- `TextMenuHost.tsx`: records the `contextmenu` target in the capture phase. On
  `onContextMenuRequested` it builds the menu with `textMenuItems`. A left-click (`mouseup`, button 0)
  on a misspelled word opens the spelling menu at the pointer. A pending edit runs after the menu has
  given focus back to the field.
- `textMenu.ts`: the menu model (`textMenuItems`, `suggestionItems`). Pure; `tests/unit/textMenu.test.ts`.
- `wordRange.ts`: `wordRangeAt`, the word around the caret. Letters and apostrophes only. Pure;
  `tests/unit/wordRange.test.ts`.
- `textTarget.ts`: `snapshotCaret` and `wordAtCaret`. An input or textarea gets `setRangeText`; a
  contenteditable gets a text-node edit. Both dispatch an `input` event.
- `src/renderer/state/spelling.ts`: the renderer's calls (`spellingLanguages`, `setSpellingLanguage`,
  `checkSpelling`, `sendEditCommand`) and `onContextMenuRequested`.
- `src/main/spelling/`: `SpellingService` (the language list and the one session-wide language) and
  `resolveProofingLanguage`. `src/main/windows/contextMenu.ts` runs the edit commands
  (`runEditCommand`); `src/main/ipc/handlers/contextMenu.ts` is its handler.
- `src/preload/local.ts`: `localApis.spellingCheck`, which asks `webFrame` synchronously.
- `src/shared/domain/contextMenu.ts`: `ContextMenuRequest`, `contextMenuRequestFrom`, `EditCommand`.

## Rules and limits

- Edits go through the field, so React and the undo stack see them. Cut, Copy, Paste and Select all
  are run by main (`editCommand`); the renderer never reads or writes the clipboard. Undo does not
  survive a word replacement in a contenteditable.
- The proofing language is applied on Save, in `features/settings/SettingsDialog.tsx`, and only when
  it changed. It is one session-wide setting, so every window gets it.
- On macOS, `session.setSpellCheckerLanguages` had no observable effect on Electron 44 here: the
  languages reported back stayed `en-AU` after each set. The setting stays visible with a note in
  `features/settings/sections/GeneralSection.tsx`.
- Electron's `misspelledWord` on a right-click never arrived in the e2e runs, in the composer or the
  sidebar search field. The Spelling submenu is therefore covered only by
  `tests/component/spellingMenus.test.tsx`. The left-click path is proven in `tests/e2e/spelling.spec.ts`.
- The left-click menu opens at the pointer, not at the caret, and has no keyboard path.
