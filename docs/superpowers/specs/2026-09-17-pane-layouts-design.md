# Pane layouts — design

**Status:** approved in brainstorming, 2026-09-17
**Scope:** arrange up to four session panes in one window, chosen from a set of layout presets.

## Why

Today a window can only split into side-by-side columns, with no cap and no rows. Working on
several sessions at once — each with its terminal — wants the tiling people already know from
macOS ("Move & Resize", "Fill & Arrange") and Windows 11 Snap Layouts: hover a control, see the
layouts, click the zone you want. Drag-and-drop docking (VS Code's drop overlays) is deliberately
not the mechanism: cross-window drag in this app has already shown how fragile drag gestures are.

## Prior art it follows

- **Windows 11 Snap Layouts** — hover the maximise button, click a *zone* in a layout thumbnail;
  Snap Assist then offers other windows for the remaining zones. The model for placing a session.
- **macOS Sequoia tiling** — the same hover menu, and the preset set.
- **VS Code editor groups** — each pane is a group with its own tab strip; View → Editor Layout
  applies a preset without moving anything; closing a group reflows the grid.

## Decisions

| Question | Decision |
| --- | --- |
| What is a pane? | A group with its own tab strip, exactly as a column is today, and its own terminals following its front tab. |
| Which layouts? | All eight below. |
| After placing a session | Existing groups fill the other zones in order; zones still empty show an in-pane session picker. |
| More groups than zones | Extra groups' tabs join the last pane. Nothing closes. |
| Last tab in a pane closed | The pane goes; the layout steps down to a smaller preset. |
| Model | A preset plus an ordered list of at most four panes (not a general split tree). |

## Presets

Zones are numbered in fill order.

```
 single        halves-h       halves-v       thirds-h
 ┌─────┐       ┌──┬──┐        ┌─────┐        ┌─┬─┬─┐
 │  1  │       │1 │2 │        │  1  │        │1│2│3│
 │     │       │  │  │        ├─────┤        │ │ │ │
 └─────┘       └──┴──┘        │  2  │        └─┴─┴─┘
                              └─────┘
 main-right2   left2-main     top-bottom2    grid
 ┌──┬──┐       ┌──┬──┐        ┌─────┐        ┌──┬──┐
 │  │2 │       │1 │  │        │  1  │        │1 │2 │
 │1 ├──┤       ├──┤3 │        ├──┬──┤        ├──┼──┤
 │  │3 │       │2 │  │        │2 │3 │        │3 │4 │
 └──┴──┘       └──┴──┘        └──┴──┘        └──┴──┘
```

Capacity: `single` 1; `halves-h`, `halves-v` 2; `thirds-h`, `main-right2`, `left2-main`,
`top-bottom2` 3; `grid` 4.

## Model — `src/renderer/state/layout.ts`

```ts
type PresetId = 'single' | 'halves-h' | 'halves-v' | 'thirds-h'
  | 'main-right2' | 'left2-main' | 'top-bottom2' | 'grid'

interface Layout {
  preset: PresetId
  panes: Column[]          // today's Column, unchanged; length ≤ capacity(preset)
}
```

All pure functions, all unit-tested:

- **`applyPreset(layout, preset)`** — layout only, nothing moves. Panes keep their order into the
  new zones. With more panes than zones, the tabs of the surplus panes are appended to the last
  zone's pane (active tab of that pane unchanged). Zones beyond the pane count are empty.
- **`placeInZone(layout, preset, zone, key)`** — applies `preset`, then puts the tab `key` into
  `zone`. If `key` is already open in some pane it is *moved* (never duplicated); if it is not open
  it is opened there. The other panes fill the remaining zones in their existing order, skipping
  `zone`; a pane left with no tabs by the move is dropped before filling. Surplus merges as above.
  The placed tab becomes the active tab of its pane, and its pane becomes the active pane.
- **`closePane(layout, paneId)`** — removes the pane and steps the preset down:
  `grid → main-right2 → halves-h → single`;
  `thirds-h → halves-h`; `main-right2`, `left2-main → halves-h`;
  `top-bottom2 → halves-v`; `halves-h`, `halves-v → single`.
  The active pane takes zone 1 (the large zone where the new preset has one).
- **`openBeside(layout, activePaneId, key)`** — "Open to the side". Below capacity 4 it steps the
  preset *up* along the same ladders in reverse (`single → halves-h → main-right2 → grid`,
  keeping a row-first layout row-first: `halves-v → top-bottom2 → grid`) and puts `key` in the new
  zone. At four panes it opens `key` as a tab in the pane after the active one, wrapping.
- **Empty panes.** A pane may exist with no tabs only as a zone waiting to be filled (from
  `applyPreset`/`placeInZone`). The existing central tidy-up (`pruneColumns`) becomes
  `tidyLayout`: a pane that *becomes* empty because its last tab closed or moved away goes through
  `closePane`; a pane that was created empty for a zone is kept (flagged `placeholder: true` until
  it receives a tab). A window always has at least one pane.

Existing column operations (`openTab`, `closeTab`, `moveTabToColumn`, `adoptTab`, `rekeyTab`,
`setTabView`) keep working on individual panes unchanged.

## Sizes

Divider positions are fractions stored per preset (`Map<PresetId, number[]>`) for the window's
lifetime, so switching away and back restores them. Dragging a divider updates the grid's
`grid-template-columns`/`grid-template-rows`. Each pane keeps the existing minimum width, and
gains a minimum height (the toolbar plus a few terminal rows). Not persisted across restarts, as
columns are not today.

## Rendering

`.content` becomes a CSS grid; each preset is a `data-preset` rule defining
`grid-template-areas` (`z1`…`z4`) and its tracks. Dividers are absolutely positioned handles
derived from the preset's track boundaries (for `main-right2`: one vertical, one horizontal on the
right side only). Panes keep today's component (`SessionColumn`), keyed by pane id, so moving a
pane between zones re-lays it out without remounting its terminals.

## The picker — `src/renderer/components/LayoutPicker.tsx`

A popover of the eight thumbnails in a 4×2 grid. Two modes:

- **place** — for a session: each zone of each thumbnail is its own button; the zone under the
  pointer is highlighted; click calls `placeInZone`. Heading "Move here" (or "Open here" for a
  session not yet open).
- **layout** — for the window: a click anywhere on a thumbnail calls `applyPreset`. Heading
  "Layout".

The current preset is marked in both. Keyboard: arrows move between zones (place) or thumbnails
(layout), Enter chooses, Escape closes; focus returns to the opener. Positioned `fixed` and
portalled like the hover card; hover-opened pickers use the hover-card grace period so the pointer
can travel from the button to the popover.

### Where it opens

| Opener | Mode | Behaviour |
| --- | --- | --- |
| Sidebar row split button | place | Click: `openBeside`, as today. Hover ~300 ms: picker. |
| Tab strip split button | place (front tab) | Click: as today. Hover: picker. |
| Small layout icon on a hovered tab, left of × | place (that tab) | Hover or click: picker. |
| "Arrange…" in tab and session context menus | place | Opens at the pointer. |
| New layout button at the top right of the window | layout | Click: picker. |

Detached windows have all of the tab-side openers and the layout button.

## The empty pane — `src/renderer/components/PaneFiller.tsx`

Shown in a placeholder pane instead of the transcript:

- **Open tabs** in other panes — click moves that tab here (`moveTabToColumn`).
- **Recent sessions** (about eight, most recently active, not already open) — click opens here.
- A filter box narrowing both lists by title.
- **Close pane** — `closePane`.

## Behaviour kept

- A tab's running session and its shells are untouched by any move between panes: pty ids do not
  change, and panes are not remounted.
- A pane's terminals follow its front tab, as today.
- The cross-window transfer (`TabTransfer`) is unchanged; an adopted tab lands in the active pane.

## Testing

Unit (`tests/unit/layout.test.ts`): fill order for every preset; surplus merging loses no tab;
every step-down and step-up; `placeInZone` with the key open elsewhere, in the target zone
already, and not open at all; a pane emptied by a move is dropped before filling; `openBeside` at
four panes wraps; placeholder panes survive `tidyLayout`, emptied ones do not.

E2E (`tests/e2e/paneLayouts.spec.ts`): hovering the sidebar split button opens the picker and a
zone click places the session; clicking it still opens to the side; "Arrange…" from a tab's menu;
the layout-only button applies a grid without moving anything; the empty-pane filler moves an
open tab in and opens a recent session; closing a pane's last tab steps the layout down; dragging
a divider in `grid` resizes both neighbours; a pane's shell follows its front tab after a move; a
running session moved between panes keeps its terminal output (no respawn).

## Out of scope

Drag-and-drop docking; more than four panes; arbitrary nested splits; persisting the layout
across restarts; moving panes between windows as a whole.
