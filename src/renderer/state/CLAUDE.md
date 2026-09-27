# Renderer state: layouts, tree cache and local filtering

Read with root CLAUDE.md; this covers `layout.ts`, `useSessionTreeCache`/`useTree` and
`treeFilter.ts`. See also [`src/main/search/CLAUDE.md`](../../main/search/CLAUDE.md) for the FTS5
index this filtering never touches.

## Layouts

A window's panes are a `Layout` (`src/renderer/features/layout/layout.ts`): one of eight presets and
at most four panes, each pane being a `Column` with its own tabs and terminals. It is a preset table
rather than a split tree on purpose — "zone three" and "what closing a pane turns into" are then
table lookups, and the picker shows exactly the shapes that can exist.

- **Every change goes through `tidyLayout`** (via `setLayout` in `App.tsx`). It closes a pane
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
