# Settings

A dialog with a section nav (`settings-nav-<section>`: `search`, `themes`, `pets`, and others).
Most sections save with `settings-save`; some (themes, pets) apply at once.

## Sub-features

- Auto-import (`setting-auto-import-all`, `setting-auto-import-interval-enabled`,
  `setting-interval-preset-15`).
- Search (`setting-search-chat-content`, `search-index-status`, `search-rebuild`).
- Sections for themes, pets, plugins, diagnostics: see their own feature files.

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
`app.getPath('userData')` holding the new value.

## Gotchas

- A missing field over IPC means "unchanged" (CLAUDE.md hard rules), so check the file, not only
  the checkbox.
- `settings-cancel` closes without saving.
