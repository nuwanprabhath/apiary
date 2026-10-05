# Sessions sidebar and search

The left sidebar lists Claude Code sessions grouped by project folder, with git worktrees nested
under their repo. The search box filters by title and, through the FTS5 index, by what was said.

## Sub-features

- Project groups, collapse (`project-toggle`), nested worktrees.
- Refresh (`sidebar-refresh`) rescans disk.
- Search by title or conversation content (`search-input`); no results shows `sidebar-no-matches`.
- Hide and show the sidebar (`sidebar-hide`, `sidebar-show`); hidden leaves a rail (`sidebar-rail`).

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

Proof: the `session-item` count and text, and a screenshot of the sidebar.

## Gotchas

- The fixture's four titles: "Fix CSV export bug", "Add worktree switcher", "Repo root session"
  and "Worktree session" (`tests/fixtures/standard.ts`).
- A session written to disk after launch needs Refresh; a new worktree needs a relaunch (the
  startup scan resolves git topology).
