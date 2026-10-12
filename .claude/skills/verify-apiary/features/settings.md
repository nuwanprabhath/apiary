# Settings

A dialog with a section nav (`settings-nav-<section>`: `search`, `themes`, `pets`, and others).
Most sections save with `settings-save`; some (themes, pets) apply at once.

## Sub-features

- Auto-import, in the Sessions section (`settings-nav-sessions`; `setting-auto-import-all`, `setting-auto-import-interval-enabled`,
  `setting-interval-preset-15`).
- Search (`setting-search-chat-content`, `search-index-status`, `search-rebuild`).
- Themes and pets have their own feature files; plugins, updates and diagnostics have none yet.
- General's "Hide tool calls" (`setting-hide-tool-call-io`) saves to library state
  (`library-state.json`), never `settings.json`; in a remote window it edits the work machine's.

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
`app.getPath('userData')` holding the new value (`schemaVersion` 2). For "Hide tool calls", the
proof is `hideToolCallIo` in `library-state.json`.

## Gotchas

- A missing field over IPC means "unchanged" (CLAUDE.md hard rules), so check the file, not only
  the checkbox.
- `settings-cancel` closes without saving.
