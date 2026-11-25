# Settings

A dialog with a section nav (`settings-nav-<section>`: `sessions`, `search`, `sidebar`, `themes`,
`terminal`, `pets`, `plugins`, `residents`, `slack`, `updates`, `general`, `privacy`, `accounts`,
`diagnostics`;
the ids are built at runtime, so grep finds `settings-nav-${id}`). Most sections save with
`settings-save`; themes (and their working-animation rows), pets, accounts, residents and Slack
apply at once (Slack's fields on Enter or blur). In a remote window, residents and Slack edit the
work machine's, themes and pets are this screen's, and a machine switch (`settings-machine-switch`)
says which.

## Sub-features

- Auto-import, in the Sessions section (`settings-nav-sessions`; `setting-auto-import-all`, `setting-auto-import-interval-enabled`,
  `setting-interval-preset-15`).
- Search (`setting-search-chat-content`, `search-index-status`, `search-rebuild`).
- Themes, pets, accounts, residents, Slack and Privacy have their own feature files; plugins, updates and
  diagnostics have none yet.
- General also holds remote access (`setting-remote-access`, `setting-remote-pairing`, see
  [remote.md](remote.md)), the claude path, the proofing language, the system title bar, chat mode
  (`setting-transcript-chat`, `setting-new-sessions-in-chat`) and XWayland on Linux.
- General's "Hide tool calls" (`setting-hide-tool-call-io`) saves to library state
  (`library-state.json`), never `settings.json`; in a remote window it edits the work machine's.
- Settings search (`settings-search`): matching settings listed under their section headings
  (`settings-results`, a count per section in `settings-nav-count-<section>`); Enter jumps to the
  first match's section and highlights it.

## How to get to it (user POV)

The app menu's Settings item (Cmd+, on macOS).

## Driving it with launchApiary

The menu cannot be clicked by Playwright; send what the menu sends:

```ts
await h.app.evaluate(({ BrowserWindow }) => {
  BrowserWindow.getAllWindows()[0].webContents.send('apiary:open-settings-dialog')
})
await expect(h.page.getByTestId('settings-dialog')).toBeVisible()
await h.page.getByTestId('settings-nav-search').click()
await h.page.getByTestId('setting-search-chat-content').uncheck()
await h.page.getByTestId('settings-save').click()
```

Proof: the behaviour the setting changes (search falls back to titles), and `settings.json` in
`app.getPath('userData')` holding the new value (`schemaVersion` 3). For "Hide tool calls", the
proof is `hideToolCallIo` in `library-state.json`.

## Gotchas

- A missing field over IPC means "unchanged" (CLAUDE.md hard rules), so check the file, not only
  the checkbox.
- `settings-cancel` closes without saving.
- `setting-interval-preset-15` renders only once `setting-auto-import-interval-enabled` is on.
