# Sessions sidebar and search

The left sidebar lists Claude Code sessions grouped by project folder, with git worktrees nested
under their repo. The search box filters by title and, through the FTS5 index, by what was said.

## Sub-features

- Project groups, collapse (`project-toggle`), nested worktrees.
- Refresh (`sidebar-refresh`) rescans disk.
- Search by title or conversation content (`search-input`); no results shows `sidebar-no-matches`.
- Hide and show the sidebar (`sidebar-hide`, `sidebar-show`); hidden leaves a rail (`sidebar-rail`).
- Pinned (`pinned-section`), Recent, Active, folder groups and drag-to-reorder.
- A row's right-click menu (`sidebar-menu`): Fork, Arrange…, Pin or Unpin (`context-menu-pin` /
  `context-menu-unpin`), and Move up/down in Pinned for a pinned row.
- Where it is kept: pins, groups, folder order, the Pinned/Recent/group collapse and Recent
  dismissals are main's library state, `library-state.json` in userData (a remote window shows the
  work machine's). Folder collapse (`project-toggle`) and the sidebar width are this window's own.

## How to get to it (user POV)

It is the left column on launch. A new profile shows sessions only after they are imported.

## Driving it with launchApiary

```ts
const h = await launchApiary()
await importAll(h.page)                       // the import dialog, bypassed
await h.page.getByTestId('sidebar-refresh').click()
await expect(h.page.getByTestId('session-item')).toHaveCount(4)
await h.page.getByTestId('search-input').fill('empty')   // only in a first message, no title
await expect(h.page.getByTestId('session-item')).toHaveCount(1)
await sidebarSession(h.page, 'Fix CSV export bug').click() // opens it in a tab
```

Pin from the menu: `sidebarSession(h.page, 'Add worktree switcher').click({ button: 'right' })`, then
`getByTestId('context-menu-pin')`. `drives/release-1-39.verify.ts` does it and reads the file.

Proof: the `session-item` count and text, a screenshot of the sidebar, and for an arrangement
change the field in `library-state.json` (`pinned` is newest first).

## Gotchas

- The fixture's four titles: "Fix CSV export bug", "Add worktree switcher", "Repo root session"
  and "Worktree session" (`tests/fixtures/standard.ts`).
- The first launch of 1.39 moves an older install's localStorage arrangement into main once
  (`seeded`); a remote window never seeds.
- A session written to disk after launch needs Refresh; a new worktree needs a relaunch (the
  startup scan resolves git topology).
