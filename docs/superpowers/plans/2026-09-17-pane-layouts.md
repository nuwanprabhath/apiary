# Pane Layouts Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Arrange up to four session panes in one Apiary window from eight layout presets, chosen through a hover picker on tabs, sidebar rows, context menus and a window layout button.

**Architecture:** A window's columns become a `Layout` — a preset id plus an ordered list of at most four panes, each pane being today's `Column`. All rules (placing, filling, merging, shrinking, growing, divider maths) are pure functions in `src/renderer/state/layout.ts`. `.content` becomes a CSS grid driven by the preset; pickers are presentational components fed through a React context from `App`.

**Tech Stack:** Electron 38, React 18, TypeScript (strict), Vitest (node env), Playwright e2e.

**Spec:** `docs/superpowers/specs/2026-09-17-pane-layouts-design.md`

## Global Constraints

- Read `CLAUDE.md` first. Both tsconfigs must pass: `npm run typecheck`.
- Unit tests: `npm test` (rebuilds native modules for Node). E2E: `npm run test:e2e` (rebuilds for Electron). **Never run `npx vitest` or `npx playwright test` directly**, and never run the two suites at the same time.
- A single e2e spec: `npm run test:e2e -- tests/e2e/<file>.spec.ts` (optionally `-g "<title>"`).
- `tests/e2e/settings.spec.ts:83` ("the session settings survive a relaunch") is a known pre-existing flake; ignore it.
- `styles.css`: no literal colours; control heights/paddings/radii come from tokens at the top of the file.
- Comments explain *why*, at the density of the surrounding code. Test names are statements about behaviour.
- The main process does not change. No new IPC.
- Commit messages: **no AI attribution of any kind** (no `Co-Authored-By`, no "Generated with").
- Do not push, tag or release.
- Maximum four panes. Preset ids exactly: `single`, `halves-h`, `halves-v`, `thirds-h`, `main-right2`, `left2-main`, `top-bottom2`, `grid`.
- Release version for this feature: **1.17.0**.

## File Structure

| File | Responsibility |
| --- | --- |
| `src/renderer/state/layout.ts` (new) | Preset table, `Layout` type, every layout rule, divider maths. Pure. |
| `src/renderer/state/columns.ts` (modify) | `Column` gains `placeholder?: boolean`; `layoutWeights` removed. |
| `src/renderer/state/layoutContext.ts` (new) | React context: current preset + place/apply/requestPicker actions. |
| `src/renderer/components/LayoutPicker.tsx` (new) | The popover of eight thumbnails; place and layout modes. |
| `src/renderer/components/LayoutMenuButton.tsx` (new) | A button that clicks through and opens the picker on hover. |
| `src/renderer/components/PaneDividers.tsx` (new) | Draggable dividers overlaid on the grid. |
| `src/renderer/components/PaneFiller.tsx` (new) | The picker shown inside an empty placeholder pane. |
| `src/renderer/App.tsx` (modify) | `columns` → `layout`; grid render; context provider; "Arrange…" picker. |
| `src/renderer/components/SessionColumn.tsx` (modify) | `weight` → `gridArea`; placeholder content; layout button slot. |
| `src/renderer/components/SessionTabBar.tsx` (modify) | Tab layout icon, split button as `LayoutMenuButton`, "Arrange…", layout button. |
| `src/renderer/components/SessionRow.tsx` (modify) | Split button as `LayoutMenuButton`. |
| `src/renderer/components/Sidebar.tsx` (modify) | "Arrange…" in the session menu. |
| `src/renderer/components/icons.tsx` (modify) | `LayoutIcon`. |
| `src/renderer/styles.css` (modify) | Grid presets, dividers, picker, filler, tab icon. |
| `tests/unit/layout.test.ts` (new) | Every rule in `layout.ts`. |
| `tests/e2e/paneLayouts.spec.ts` (new) | The feature end to end. |
| `tests/e2e/sessionTabs.spec.ts` (modify) | "no cap" test becomes "capped at four". |
| `tests/unit/columns.test.ts` (modify) | Drop `layoutWeights` tests. |
| `CHANGELOG.md`, `CLAUDE.md`, `package.json` | Release notes, a Layouts section, 1.17.0. |

---

### Task 1: Presets, `applyPreset` and `placeInZone`

**Files:**
- Create: `src/renderer/state/layout.ts`
- Modify: `src/renderer/state/columns.ts` (the `Column` interface)
- Test: `tests/unit/layout.test.ts`

**Interfaces:**
- Consumes: `Column`, `OpenTab`, `newColumn`, `findTab`, `closeTab` from `src/renderer/state/columns.ts`.
- Produces:
  - `type PresetId = 'single' | 'halves-h' | 'halves-v' | 'thirds-h' | 'main-right2' | 'left2-main' | 'top-bottom2' | 'grid'`
  - `interface PresetDef { id: PresetId; label: string; cols: number; rows: number; areas: string[]; topRight: number; dividers: DividerDef[] }`
  - `interface DividerDef { axis: 'col' | 'row'; index: number; span: [number, number] }`
  - `const PRESETS: PresetDef[]` (in picker order) and `presetDef(id: PresetId): PresetDef`
  - `capacity(id: PresetId): number`
  - `interface Layout { preset: PresetId; panes: Column[] }`
  - `initialLayout(): Layout`
  - `applyPreset(layout: Layout, preset: PresetId): Layout`
  - `placeInZone(layout: Layout, preset: PresetId, zone: number, key: string): { layout: Layout; paneId: string }`
  - `Column.placeholder?: boolean`

- [ ] **Step 1: Add the placeholder flag to `Column`**

In `src/renderer/state/columns.ts`, change the interface to:

```ts
export interface Column {
  id: string
  tabs: OpenTab[]
  /** Null only while the column is empty, which is possible for the last remaining column. */
  activeKey: string | null
  /**
   * A pane made empty on purpose, as a zone of a layout waiting to be filled — as opposed to one
   * left empty because its last tab went away, which is closed. See `tidyLayout` in layout.ts.
   */
  placeholder?: boolean
}
```

- [ ] **Step 2: Write the failing tests**

Create `tests/unit/layout.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { newColumn, type Column } from '../../src/renderer/state/columns'
import {
  PRESETS, capacity, applyPreset, placeInZone, initialLayout, type Layout, type PresetId,
} from '../../src/renderer/state/layout'

const pane = (...keys: string[]): Column =>
  newColumn(keys.map((key) => ({ key, view: 'transcript' as const })))
const keysOf = (layout: Layout): string[][] => layout.panes.map((p) => p.tabs.map((t) => t.key))
const allKeys = (layout: Layout): string[] => layout.panes.flatMap((p) => p.tabs.map((t) => t.key)).sort()

describe('presets', () => {
  it('offers the eight layouts, each holding between one and four panes', () => {
    expect(PRESETS.map((p) => p.id)).toEqual([
      'single', 'halves-h', 'halves-v', 'thirds-h', 'main-right2', 'left2-main', 'top-bottom2', 'grid',
    ])
    const caps = Object.fromEntries(PRESETS.map((p) => [p.id, capacity(p.id)]))
    expect(caps).toEqual({
      single: 1, 'halves-h': 2, 'halves-v': 2, 'thirds-h': 3,
      'main-right2': 3, 'left2-main': 3, 'top-bottom2': 3, grid: 4,
    })
  })

  it('names every zone of a preset exactly once in its grid areas', () => {
    for (const p of PRESETS) {
      const names = new Set(p.areas.join(' ').split(/\s+/))
      expect([...names].sort()).toEqual(
        Array.from({ length: capacity(p.id) }, (_, i) => `z${String(i + 1)}`),
      )
      expect(p.areas).toHaveLength(p.rows)
      for (const row of p.areas) expect(row.split(/\s+/)).toHaveLength(p.cols)
    }
  })

  it('starts a window as one pane', () => {
    const layout = initialLayout()
    expect(layout.preset).toBe('single')
    expect(layout.panes).toHaveLength(1)
    expect(layout.panes[0].placeholder).not.toBe(true)
  })
})

describe('applying a layout without moving anything', () => {
  it('keeps the panes in order and leaves the extra zones waiting to be filled', () => {
    const layout: Layout = { preset: 'halves-h', panes: [pane('a'), pane('b')] }
    const next = applyPreset(layout, 'grid')
    expect(next.preset).toBe('grid')
    expect(keysOf(next)).toEqual([['a'], ['b'], [], []])
    expect(next.panes.slice(2).every((p) => p.placeholder === true)).toBe(true)
    // The panes that were there are the same panes, so their terminals are not remounted.
    expect(next.panes[0].id).toBe(layout.panes[0].id)
  })

  it('folds the tabs of panes that no longer fit into the last one, closing nothing', () => {
    const layout: Layout = { preset: 'thirds-h', panes: [pane('a'), pane('b', 'c'), pane('d')] }
    const next = applyPreset(layout, 'halves-h')
    expect(keysOf(next)).toEqual([['a'], ['b', 'c', 'd']])
    // The pane taking them in keeps showing what it was showing.
    expect(next.panes[1].activeKey).toBe('b')
  })

  it('drops waiting zones before counting what fits', () => {
    const layout: Layout = { preset: 'grid', panes: [pane('a'), { ...newColumn(), placeholder: true }, pane('b'), { ...newColumn(), placeholder: true }] }
    expect(keysOf(applyPreset(layout, 'halves-v'))).toEqual([['a'], ['b']])
  })

  it('an empty window stays one ordinary empty pane when set to single', () => {
    const next = applyPreset(initialLayout(), 'single')
    expect(next.panes).toHaveLength(1)
    expect(next.panes[0].placeholder).not.toBe(true)
  })
})

describe('placing a session in a zone', () => {
  it('opens a session that is not open yet in the chosen zone, and the others fill around it', () => {
    const layout: Layout = { preset: 'halves-h', panes: [pane('a'), pane('b')] }
    const { layout: next, paneId } = placeInZone(layout, 'main-right2', 0, 'new')
    expect(keysOf(next)).toEqual([['new'], ['a'], ['b']])
    expect(next.panes[0].id).toBe(paneId)
    expect(next.panes[0].activeKey).toBe('new')
  })

  it('moves a session that is already open rather than opening it twice', () => {
    const layout: Layout = { preset: 'halves-h', panes: [pane('a', 'b'), pane('c')] }
    const { layout: next } = placeInZone(layout, 'halves-h', 1, 'b')
    // b is out of the first pane and in zone 2; c had no zone left, so it joined the last pane,
    // behind b — nothing closed, and b is still the one in front.
    expect(keysOf(next)).toEqual([['a'], ['b', 'c']])
    expect(next.panes[1].activeKey).toBe('b')
  })

  it('keeps the pane itself when the session was the only tab in it', () => {
    const layout: Layout = { preset: 'halves-h', panes: [pane('a'), pane('b')] }
    const { layout: next, paneId } = placeInZone(layout, 'halves-h', 0, 'b')
    expect(paneId).toBe(layout.panes[1].id)
    expect(keysOf(next)).toEqual([['b'], ['a']])
  })

  it('drops a pane the move emptied before filling, so it does not take a zone', () => {
    const layout: Layout = { preset: 'thirds-h', panes: [pane('a'), pane('b'), pane('c')] }
    const { layout: next } = placeInZone(layout, 'grid', 3, 'b')
    expect(keysOf(next)).toEqual([['a'], ['c'], [], ['b']])
    expect(next.panes[2].placeholder).toBe(true)
  })

  it('placing a session where it already is changes only the layout', () => {
    const layout: Layout = { preset: 'halves-h', panes: [pane('a'), pane('b')] }
    const { layout: next } = placeInZone(layout, 'halves-v', 1, 'b')
    expect(next.preset).toBe('halves-v')
    expect(keysOf(next)).toEqual([['a'], ['b']])
  })

  it('keeps the view a moved tab was on', () => {
    const running = newColumn([{ key: 'r', view: 'terminal' }, { key: 'x', view: 'transcript' }])
    const { layout: next } = placeInZone({ preset: 'single', panes: [running] }, 'halves-h', 1, 'r')
    expect(next.panes[1].tabs[0]).toEqual({ key: 'r', view: 'terminal' })
  })

  it('in a single pane, everything else joins the placed session rather than closing', () => {
    const layout: Layout = { preset: 'halves-h', panes: [pane('a'), pane('b')] }
    const { layout: next } = placeInZone(layout, 'single', 0, 'b')
    expect(keysOf(next)).toEqual([['b', 'a']])
    expect(next.panes[0].activeKey).toBe('b')
  })

  it('clamps a zone past the end of the preset', () => {
    const { layout: next } = placeInZone({ preset: 'single', panes: [pane('a')] }, 'halves-v', 9, 'n')
    expect(keysOf(next)).toEqual([['a'], ['n']])
  })

  it('never loses a tab, whatever is placed where', () => {
    const presets: PresetId[] = PRESETS.map((p) => p.id)
    const base: Layout = { preset: 'grid', panes: [pane('a', 'b'), pane('c'), pane('d'), pane('e', 'f')] }
    for (const preset of presets) {
      for (let zone = 0; zone < capacity(preset); zone++) {
        for (const key of ['a', 'c', 'f', 'z']) {
          const { layout: next } = placeInZone(base, preset, zone, key)
          const expected = [...new Set(['a', 'b', 'c', 'd', 'e', 'f', key])].sort()
          expect(allKeys(next)).toEqual(expected)
          expect(next.panes.length).toBeLessThanOrEqual(capacity(preset))
        }
      }
    }
  })
})
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `npm test -- tests/unit/layout.test.ts`
Expected: FAIL — cannot resolve `../../src/renderer/state/layout`.

- [ ] **Step 4: Write the implementation**

Create `src/renderer/state/layout.ts`:

```ts
import { newColumn, findTab, closeTab, type Column, type OpenTab } from './columns'

/**
 * How a window's panes are arranged.
 *
 * A fixed set of presets rather than a general split tree, on purpose: the eight shapes are what
 * the picker offers (macOS's "Move & Resize"/"Fill & Arrange" and VS Code's editor layouts), and
 * with only those shapes every rule — which pane is "number three", what closing one turns into —
 * is a table lookup rather than a tree operation. A pane is a `Column`, unchanged: its own tab
 * strip, its own active tab, and its own terminals for that tab.
 */

export type PresetId =
  | 'single' | 'halves-h' | 'halves-v' | 'thirds-h'
  | 'main-right2' | 'left2-main' | 'top-bottom2' | 'grid'

/** A draggable boundary: between track `index` and `index + 1` along `axis`, spanning the tracks
 *  `span[0]` (inclusive) to `span[1]` (exclusive) of the other axis. */
export interface DividerDef { axis: 'col' | 'row'; index: number; span: [number, number] }

export interface PresetDef {
  id: PresetId
  label: string
  cols: number
  rows: number
  /** `grid-template-areas` rows; zones are named `z1`…`z4` in fill order. */
  areas: string[]
  /** The zone at the window's top-right corner, which carries the window's layout button. */
  topRight: number
  dividers: DividerDef[]
}

export const PRESETS: PresetDef[] = [
  { id: 'single', label: 'Single', cols: 1, rows: 1, areas: ['z1'], topRight: 0, dividers: [] },
  {
    id: 'halves-h', label: 'Two columns', cols: 2, rows: 1, areas: ['z1 z2'], topRight: 1,
    dividers: [{ axis: 'col', index: 0, span: [0, 1] }],
  },
  {
    id: 'halves-v', label: 'Two rows', cols: 1, rows: 2, areas: ['z1', 'z2'], topRight: 0,
    dividers: [{ axis: 'row', index: 0, span: [0, 1] }],
  },
  {
    id: 'thirds-h', label: 'Three columns', cols: 3, rows: 1, areas: ['z1 z2 z3'], topRight: 2,
    dividers: [{ axis: 'col', index: 0, span: [0, 1] }, { axis: 'col', index: 1, span: [0, 1] }],
  },
  {
    id: 'main-right2', label: 'Main and two on the right', cols: 2, rows: 2, areas: ['z1 z2', 'z1 z3'], topRight: 1,
    dividers: [{ axis: 'col', index: 0, span: [0, 2] }, { axis: 'row', index: 0, span: [1, 2] }],
  },
  {
    id: 'left2-main', label: 'Two on the left and main', cols: 2, rows: 2, areas: ['z1 z3', 'z2 z3'], topRight: 2,
    dividers: [{ axis: 'col', index: 0, span: [0, 2] }, { axis: 'row', index: 0, span: [0, 1] }],
  },
  {
    id: 'top-bottom2', label: 'Top and two below', cols: 2, rows: 2, areas: ['z1 z1', 'z2 z3'], topRight: 0,
    dividers: [{ axis: 'row', index: 0, span: [0, 2] }, { axis: 'col', index: 0, span: [1, 2] }],
  },
  {
    id: 'grid', label: 'Grid', cols: 2, rows: 2, areas: ['z1 z2', 'z3 z4'], topRight: 1,
    dividers: [{ axis: 'col', index: 0, span: [0, 2] }, { axis: 'row', index: 0, span: [0, 2] }],
  },
]

export function presetDef(id: PresetId): PresetDef {
  const def = PRESETS.find((p) => p.id === id)
  if (def === undefined) throw new Error(`Unknown layout: ${id}`)
  return def
}

export function capacity(id: PresetId): number {
  return new Set(presetDef(id).areas.join(' ').split(/\s+/)).size
}

export interface Layout {
  preset: PresetId
  panes: Column[]
}

export function initialLayout(): Layout {
  return { preset: 'single', panes: [newColumn()] }
}

const waiting = (): Column => ({ ...newColumn(), placeholder: true })

/** `target` with `source`'s tabs appended after its own; what `target` shows is unchanged. */
function mergeInto(target: Column, source: Column): Column {
  const extra = source.tabs.filter((t) => findTab(target, t.key) === null)
  return {
    ...target,
    tabs: [...target.tabs, ...extra],
    activeKey: target.activeKey ?? extra[0]?.key ?? null,
    placeholder: false,
  }
}

/**
 * Lays `panes` into `slots` zones in order: the first ones one per zone, and the tabs of any that
 * do not fit folded into the last zone's pane — nothing is closed by choosing a smaller layout.
 * Zones left over wait to be filled.
 */
function fill(slots: (Column | null)[], panes: Column[]): Column[] {
  const out = [...slots]
  const queue = [...panes]
  for (let i = 0; i < out.length && queue.length > 0; i++) {
    if (out[i] === null) out[i] = queue.shift() ?? null
  }
  const last = out.length - 1
  for (const surplus of queue) {
    const into = out[last]
    out[last] = into === null ? surplus : mergeInto(into, surplus)
  }
  return out.map((p) => p ?? waiting())
}

export function applyPreset(layout: Layout, preset: PresetId): Layout {
  const occupied = layout.panes.filter((p) => p.tabs.length > 0)
  if (occupied.length === 0 && preset === 'single') return { preset, panes: [newColumn()] }
  const slots: (Column | null)[] = Array.from({ length: capacity(preset) }, () => null)
  return { preset, panes: fill(slots, occupied) }
}

/**
 * Puts the tab `key` into `zone` of `preset`, moving it if it is open anywhere in the window.
 *
 * A tab that was the only one in its pane takes that pane with it, so the pane (and the terminal
 * views inside it) is carried rather than rebuilt. Otherwise the tab is lifted out of its pane,
 * keeping its view, and the pane it leaves stays where the fill puts it. A pane the move leaves
 * empty is dropped before filling, so it cannot occupy a zone as a blank.
 */
export function placeInZone(
  layout: Layout,
  preset: PresetId,
  zone: number,
  key: string,
): { layout: Layout; paneId: string } {
  const cap = capacity(preset)
  const at = Math.max(0, Math.min(zone, cap - 1))
  const source = layout.panes.find((p) => findTab(p, key) !== null) ?? null

  let moved: Column
  let rest: Column[]
  if (source !== null && source.tabs.length === 1) {
    moved = { ...source, activeKey: key, placeholder: false }
    rest = layout.panes.filter((p) => p.id !== source.id)
  } else {
    const tab: OpenTab = (source === null ? null : findTab(source, key)) ?? { key, view: 'transcript' }
    moved = newColumn([tab])
    rest = layout.panes.map((p) => (p === source ? closeTab(p, key) : p))
  }
  rest = rest.filter((p) => p.tabs.length > 0)

  const slots: (Column | null)[] = Array.from({ length: cap }, (_, i) => (i === at ? moved : null))
  const panes = fill(slots, rest)
  const placed = panes.find((p) => findTab(p, key) !== null)
  // The placed tab is what the user just chose, so it is in front even where the fill merged
  // other tabs into its pane.
  const final = panes.map((p) => (p === placed ? { ...p, activeKey: key } : p))
  return { layout: { preset, panes: final }, paneId: placed?.id ?? moved.id }
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npm test -- tests/unit/layout.test.ts`
Expected: PASS (all tests in this file).

- [ ] **Step 6: Typecheck and commit**

```bash
npm run typecheck
git add src/renderer/state/layout.ts src/renderer/state/columns.ts tests/unit/layout.test.ts
git commit -m "feat(layout): presets, applying one, and placing a session in a zone"
```

---

### Task 2: Closing, tidying and growing — `closePane`, `tidyLayout`, `openBeside`

**Files:**
- Modify: `src/renderer/state/layout.ts`
- Test: `tests/unit/layout.test.ts`

**Interfaces:**
- Consumes: everything from Task 1.
- Produces:
  - `stepDown(id: PresetId): PresetId`, `stepUp(id: PresetId): PresetId`
  - `closePane(layout: Layout, paneId: string, activePaneId: string | null): Layout`
  - `tidyLayout(layout: Layout, activePaneId: string | null): Layout`
  - `openBeside(layout: Layout, activePaneId: string | null, tab: OpenTab): { layout: Layout; paneId: string }`

- [ ] **Step 1: Write the failing tests**

Append to `tests/unit/layout.test.ts` (add `closePane, tidyLayout, openBeside, stepDown, stepUp` to the import from `layout`):

```ts
describe('closing a pane', () => {
  it('steps each layout down to the next smaller one', () => {
    expect(stepDown('grid')).toBe('main-right2')
    expect(stepDown('main-right2')).toBe('halves-h')
    expect(stepDown('left2-main')).toBe('halves-h')
    expect(stepDown('thirds-h')).toBe('halves-h')
    expect(stepDown('top-bottom2')).toBe('halves-v')
    expect(stepDown('halves-h')).toBe('single')
    expect(stepDown('halves-v')).toBe('single')
    expect(stepDown('single')).toBe('single')
  })

  it('reflows the rest, with the pane being worked in taking the large zone', () => {
    const layout: Layout = { preset: 'grid', panes: [pane('a'), pane('b'), pane('c'), pane('d')] }
    const next = closePane(layout, layout.panes[0].id, layout.panes[2].id)
    expect(next.preset).toBe('main-right2')
    expect(keysOf(next)).toEqual([['c'], ['b'], ['d']])
  })

  it('keeps the existing order when the pane being worked in is the one closed', () => {
    const layout: Layout = { preset: 'thirds-h', panes: [pane('a'), pane('b'), pane('c')] }
    const next = closePane(layout, layout.panes[1].id, layout.panes[1].id)
    expect(next.preset).toBe('halves-h')
    expect(keysOf(next)).toEqual([['a'], ['c']])
  })

  it('never closes the last pane', () => {
    const layout: Layout = { preset: 'single', panes: [pane('a')] }
    const next = closePane(layout, layout.panes[0].id, null)
    expect(next.panes).toHaveLength(1)
  })

  it('keeps the ids of the panes that stay, so their terminals are not remounted', () => {
    const layout: Layout = { preset: 'halves-h', panes: [pane('a'), pane('b')] }
    const next = closePane(layout, layout.panes[0].id, null)
    expect(next.panes[0].id).toBe(layout.panes[1].id)
  })
})

describe('tidying after any change', () => {
  it('closes a pane whose last tab went away', () => {
    const layout: Layout = { preset: 'halves-h', panes: [pane('a'), newColumn()] }
    const next = tidyLayout(layout, null)
    expect(next.preset).toBe('single')
    expect(keysOf(next)).toEqual([['a']])
  })

  it('keeps a pane that is waiting to be filled', () => {
    const layout: Layout = { preset: 'halves-h', panes: [pane('a'), { ...newColumn(), placeholder: true }] }
    expect(tidyLayout(layout, null)).toEqual(layout)
  })

  it('stops calling a pane waiting once something is opened in it', () => {
    const filled = { ...pane('x'), placeholder: true }
    const next = tidyLayout({ preset: 'halves-h', panes: [pane('a'), filled] }, null)
    expect(next.panes[1].placeholder).toBe(false)
  })

  it('keeps one empty ordinary pane when everything is closed', () => {
    const layout: Layout = { preset: 'halves-h', panes: [newColumn(), newColumn()] }
    const next = tidyLayout(layout, null)
    expect(next.preset).toBe('single')
    expect(next.panes).toHaveLength(1)
    expect(next.panes[0].placeholder).not.toBe(true)
  })

  it('a lone waiting pane in single becomes an ordinary empty one', () => {
    const next = tidyLayout({ preset: 'single', panes: [{ ...newColumn(), placeholder: true }] }, null)
    expect(next.panes[0].placeholder).not.toBe(true)
  })

  it('grows the layout if something added more panes than it holds', () => {
    const layout: Layout = { preset: 'halves-h', panes: [pane('a'), pane('b'), pane('c')] }
    const next = tidyLayout(layout, null)
    expect(next.panes.length).toBeLessThanOrEqual(capacity(next.preset))
    expect(allKeys(next)).toEqual(['a', 'b', 'c'])
  })

  it('returns the same object when nothing needs tidying', () => {
    const layout: Layout = { preset: 'halves-h', panes: [pane('a'), pane('b')] }
    expect(tidyLayout(layout, null)).toBe(layout)
  })
})

describe('opening a session to the side', () => {
  it('steps each layout up, keeping rows as rows', () => {
    expect(stepUp('single')).toBe('halves-h')
    expect(stepUp('halves-h')).toBe('main-right2')
    expect(stepUp('halves-v')).toBe('top-bottom2')
    expect(stepUp('main-right2')).toBe('grid')
    expect(stepUp('left2-main')).toBe('grid')
    expect(stepUp('thirds-h')).toBe('grid')
    expect(stepUp('top-bottom2')).toBe('grid')
    expect(stepUp('grid')).toBe('grid')
  })

  it('adds a pane by growing the layout', () => {
    const layout: Layout = { preset: 'single', panes: [pane('a')] }
    const { layout: next, paneId } = openBeside(layout, layout.panes[0].id, { key: 'b', view: 'transcript' })
    expect(next.preset).toBe('halves-h')
    expect(keysOf(next)).toEqual([['a'], ['b']])
    expect(next.panes[1].id).toBe(paneId)
  })

  it('fills a waiting zone before growing', () => {
    const layout: Layout = { preset: 'grid', panes: [pane('a'), pane('b'), { ...newColumn(), placeholder: true }, pane('c')] }
    const { layout: next } = openBeside(layout, layout.panes[0].id, { key: 'n', view: 'transcript' })
    expect(next.preset).toBe('grid')
    expect(keysOf(next)).toEqual([['a'], ['b'], ['n'], ['c']])
    expect(next.panes[2].placeholder).toBe(false)
  })

  it('with four panes, opens as a tab in the pane after the active one, wrapping round', () => {
    const layout: Layout = { preset: 'grid', panes: [pane('a'), pane('b'), pane('c'), pane('d')] }
    const { layout: next, paneId } = openBeside(layout, layout.panes[3].id, { key: 'n', view: 'transcript' })
    expect(next.preset).toBe('grid')
    expect(keysOf(next)[0]).toEqual(['a', 'n'])
    expect(next.panes[0].activeKey).toBe('n')
    expect(paneId).toBe(layout.panes[0].id)
  })

  it('never makes a fifth pane', () => {
    let layout: Layout = initialLayout()
    for (const key of ['a', 'b', 'c', 'd', 'e', 'f']) {
      layout = openBeside(layout, layout.panes[0].id, { key, view: 'transcript' }).layout
    }
    expect(layout.panes.length).toBeLessThanOrEqual(4)
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test -- tests/unit/layout.test.ts`
Expected: FAIL — `closePane`/`tidyLayout`/`openBeside`/`stepDown`/`stepUp` are not exported.

- [ ] **Step 3: Write the implementation**

Append to `src/renderer/state/layout.ts`:

```ts
const DOWN: Record<PresetId, PresetId> = {
  grid: 'main-right2',
  'main-right2': 'halves-h',
  'left2-main': 'halves-h',
  'thirds-h': 'halves-h',
  'top-bottom2': 'halves-v',
  'halves-h': 'single',
  'halves-v': 'single',
  single: 'single',
}

// Row-first layouts grow as rows, so a window someone stacked top-to-bottom stays that way.
const UP: Record<PresetId, PresetId> = {
  single: 'halves-h',
  'halves-h': 'main-right2',
  'halves-v': 'top-bottom2',
  'main-right2': 'grid',
  'left2-main': 'grid',
  'thirds-h': 'grid',
  'top-bottom2': 'grid',
  grid: 'grid',
}

export function stepDown(id: PresetId): PresetId { return DOWN[id] }
export function stepUp(id: PresetId): PresetId { return UP[id] }

/**
 * Removes a pane and steps the layout down.
 *
 * The pane being worked in goes first, into zone 1 — the large zone, where the smaller layout has
 * one — because it is the one someone is looking at. Every other pane keeps its relative order.
 */
export function closePane(layout: Layout, paneId: string, activePaneId: string | null): Layout {
  const rest = layout.panes.filter((p) => p.id !== paneId)
  if (rest.length === 0) return { preset: 'single', panes: [newColumn()] }
  const active = rest.find((p) => p.id === activePaneId)
  const ordered = active === undefined ? rest : [active, ...rest.filter((p) => p !== active)]
  let preset = DOWN[layout.preset]
  while (capacity(preset) < ordered.length) preset = UP[preset]
  // Waiting zones are not panes anyone needs to keep; the fill makes as many as the layout wants.
  const occupied = ordered.filter((p) => p.tabs.length > 0 || p.placeholder !== true)
  const slots: (Column | null)[] = Array.from({ length: capacity(preset) }, () => null)
  const panes = fill(slots, occupied)
  if (preset === 'single' && panes[0].tabs.length === 0) return { preset, panes: [{ ...panes[0], placeholder: false }] }
  return { preset, panes }
}

/**
 * The one rule every change to a window's panes goes through, the way `pruneColumns` was before.
 *
 * A pane that has become empty is closed — unless it was made empty on purpose, as a zone waiting
 * to be filled. A waiting pane that has received a tab stops waiting. A layout holding more panes
 * than it has zones (something appended one) grows until it fits. A window always has a pane.
 * Returns the input unchanged when there was nothing to do, so React can skip the render.
 */
export function tidyLayout(layout: Layout, activePaneId: string | null): Layout {
  let next = layout
  const filled = next.panes.some((p) => p.placeholder === true && p.tabs.length > 0)
  if (filled) {
    next = { ...next, panes: next.panes.map((p) => (p.placeholder === true && p.tabs.length > 0 ? { ...p, placeholder: false } : p)) }
  }
  for (;;) {
    const emptied = next.panes.find((p) => p.tabs.length === 0 && p.placeholder !== true)
    if (emptied === undefined || next.panes.length === 1) break
    next = closePane(next, emptied.id, activePaneId)
  }
  if (next.preset === 'single' && next.panes.length === 1 && next.panes[0].placeholder === true) {
    next = { ...next, panes: [{ ...next.panes[0], placeholder: false }] }
  }
  if (next.panes.length > capacity(next.preset)) {
    let preset = next.preset
    while (capacity(preset) < next.panes.length && preset !== 'grid') preset = UP[preset]
    const slots: (Column | null)[] = Array.from({ length: capacity(preset) }, () => null)
    next = { preset, panes: fill(slots, next.panes) }
  }
  return next
}

/**
 * "Open to the side": a waiting zone if there is one, otherwise a new pane by growing the layout,
 * and once there are four, a tab in the pane after the active one — there is no fifth pane.
 *
 * Unlike `placeInZone` this does not move a tab that is already open; splitting a session to see
 * it twice is what the split button has always done.
 */
export function openBeside(
  layout: Layout,
  activePaneId: string | null,
  tab: OpenTab,
): { layout: Layout; paneId: string } {
  const waitingPane = layout.panes.find((p) => p.placeholder === true && p.tabs.length === 0)
  if (waitingPane !== undefined) {
    const panes = layout.panes.map((p) => (p === waitingPane
      ? { ...p, tabs: [tab], activeKey: tab.key, placeholder: false }
      : p))
    return { layout: { ...layout, panes }, paneId: waitingPane.id }
  }
  if (layout.panes.length >= 4) {
    const at = Math.max(0, layout.panes.findIndex((p) => p.id === activePaneId))
    const target = layout.panes[(at + 1) % layout.panes.length]
    const panes = layout.panes.map((p) => {
      if (p !== target) return p
      const tabs = findTab(p, tab.key) === null ? [...p.tabs, tab] : p.tabs
      return { ...p, tabs, activeKey: tab.key }
    })
    return { layout: { ...layout, panes }, paneId: target.id }
  }
  let preset = layout.preset
  while (capacity(preset) <= layout.panes.length) preset = UP[preset]
  const added = newColumn([tab])
  const slots: (Column | null)[] = Array.from({ length: capacity(preset) }, () => null)
  const panes = fill(slots, [...layout.panes, added])
  return { layout: { preset, panes }, paneId: added.id }
}
```

`closePane` steps down once with `DOWN`, and back up with `UP` only if the result could not hold the panes that remain.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test -- tests/unit/layout.test.ts`
Expected: PASS.

If "keeps one empty ordinary pane when everything is closed" fails, trace it through `tidyLayout`: the loop closes panes one at a time until one remains, and `closePane` returns `single` with a non-placeholder pane when nothing has tabs.

- [ ] **Step 5: Typecheck and commit**

```bash
npm run typecheck
git add src/renderer/state/layout.ts tests/unit/layout.test.ts
git commit -m "feat(layout): closing, tidying and growing a layout"
```

---

### Task 3: Divider maths — `dragTracks` and `trackTemplate`

**Files:**
- Modify: `src/renderer/state/layout.ts`
- Test: `tests/unit/layout.test.ts`

**Interfaces:**
- Produces:
  - `interface Tracks { cols: number[]; rows: number[] }`
  - `defaultTracks(id: PresetId): Tracks` — all ones.
  - `dragTracks(tracks: number[], index: number, pointer: number, minShare: number): number[]` — `pointer` and `minShare` are fractions of the whole axis (0–1).
  - `trackTemplate(tracks: number[]): string` — e.g. `"1.2fr 0.8fr"`.
  - `boundaryAt(tracks: number[], index: number): number` — fraction (0–1) where the boundary after `index` sits.

- [ ] **Step 1: Write the failing tests**

Append to `tests/unit/layout.test.ts` (add `dragTracks, trackTemplate, boundaryAt, defaultTracks` to the import):

```ts
describe('dragging a divider', () => {
  it('moves only the boundary dragged, keeping the pair\'s combined size', () => {
    const next = dragTracks([1, 1, 1], 0, 0.5, 0)
    expect(next[2]).toBe(1)
    expect(next[0] + next[1]).toBeCloseTo(2)
    expect(boundaryAt(next, 0)).toBeCloseTo(0.5)
  })

  it('does not let either side go below its floor', () => {
    const next = dragTracks([1, 1], 0, 0.01, 0.2)
    expect(boundaryAt(next, 0)).toBeCloseTo(0.2)
    const other = dragTracks([1, 1], 0, 0.99, 0.2)
    expect(boundaryAt(other, 0)).toBeCloseTo(0.8)
  })

  it('works on a boundary that is not the first', () => {
    const next = dragTracks([1, 1, 1], 1, 0.9, 0.1)
    expect(next[0]).toBe(1)
    expect(boundaryAt(next, 1)).toBeCloseTo(0.9)
  })

  it('ignores a boundary that does not exist', () => {
    expect(dragTracks([1, 1], 3, 0.5, 0)).toEqual([1, 1])
  })

  it('writes tracks as fractions of the space', () => {
    expect(trackTemplate([1.5, 0.5])).toBe('1.5fr 0.5fr')
  })

  it('starts every preset with equal tracks', () => {
    expect(defaultTracks('grid')).toEqual({ cols: [1, 1], rows: [1, 1] })
    expect(defaultTracks('thirds-h')).toEqual({ cols: [1, 1, 1], rows: [1] })
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test -- tests/unit/layout.test.ts`
Expected: FAIL — the four functions are not exported.

- [ ] **Step 3: Write the implementation**

Append to `src/renderer/state/layout.ts`:

```ts
/** Relative sizes of a preset's columns and rows, as `fr` weights. */
export interface Tracks { cols: number[]; rows: number[] }

export function defaultTracks(id: PresetId): Tracks {
  const def = presetDef(id)
  return { cols: Array.from({ length: def.cols }, () => 1), rows: Array.from({ length: def.rows }, () => 1) }
}

export function trackTemplate(tracks: number[]): string {
  return tracks.map((t) => `${String(Number(t.toFixed(4)))}fr`).join(' ')
}

export function boundaryAt(tracks: number[], index: number): number {
  const total = tracks.reduce((a, b) => a + b, 0)
  return tracks.slice(0, index + 1).reduce((a, b) => a + b, 0) / total
}

/**
 * Moves the boundary between track `index` and the next to `pointer`, both as fractions of the
 * axis. Only that pair changes, and its combined weight is kept — the same arithmetic the column
 * dividers used, which is what keeps repeated drags stable. `minShare` is the floor for either
 * side, as a fraction of the whole axis.
 */
export function dragTracks(tracks: number[], index: number, pointer: number, minShare: number): number[] {
  if (index < 0 || index + 1 >= tracks.length) return tracks
  const total = tracks.reduce((a, b) => a + b, 0)
  const start = tracks.slice(0, index).reduce((a, b) => a + b, 0) / total
  const pairWeight = tracks[index] + tracks[index + 1]
  const pair = pairWeight / total
  const floor = Math.min(minShare, pair / 2)
  const at = Math.max(start + floor, Math.min(start + pair - floor, pointer))
  const leftShare = (at - start) / pair
  const next = [...tracks]
  next[index] = pairWeight * leftShare
  next[index + 1] = pairWeight * (1 - leftShare)
  return next
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test -- tests/unit/layout.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
npm run typecheck
git add src/renderer/state/layout.ts tests/unit/layout.test.ts
git commit -m "feat(layout): divider maths for grid tracks"
```

---

### Task 4: The window runs on a `Layout` — grid rendering and dividers

This task changes no visible behaviour except that splitting now stops at four panes and panes are laid out by the preset. The existing e2e suite is the safety net.

**Files:**
- Create: `src/renderer/components/PaneDividers.tsx`
- Modify: `src/renderer/App.tsx`, `src/renderer/components/SessionColumn.tsx`, `src/renderer/components/SessionTabBar.tsx`, `src/renderer/components/ErrorBoundary.tsx`, `src/renderer/state/columns.ts`, `src/renderer/styles.css`
- Modify tests: `tests/unit/columns.test.ts`, `tests/e2e/sessionTabs.spec.ts`

**Interfaces:**
- Consumes: `Layout`, `initialLayout`, `tidyLayout`, `openBeside`, `presetDef`, `defaultTracks`, `dragTracks`, `trackTemplate`, `boundaryAt`, `Tracks`, `PresetId` (Tasks 1–3).
- Produces (inside `App.tsx`, used by Tasks 6–7):
  - `layout: Layout` state and `setLayout(update: (prev: Layout) => Layout): void` (always tidied)
  - `setColumns(update: (prev: Column[]) => Column[]): void` — kept as a wrapper over `setLayout` so the ~50 existing call sites do not change
  - `tracks: Map<PresetId, Tracks>` state
- `SessionColumn` props: `weight: number` is **removed**; `gridArea: string` is added; `emptyContent?: React.ReactNode` is added; `layoutButton?: React.ReactNode` is added (rendered by `SessionTabBar`, Task 7).
- `PaneDividers` props: `{ preset: PresetId; tracks: Tracks; onChange: (next: Tracks) => void }`.

- [ ] **Step 1: Update the "no cap" e2e test to say what is now true**

In `tests/e2e/sessionTabs.spec.ts`, replace the test `'splitting again keeps adding columns — there is no cap'` with:

```ts
test('splitting keeps adding panes up to four, then opens in an existing one', async () => {
  await sidebarSession(h.page, 'Fix CSV export bug').click()
  for (const title of ['Add worktree switcher', 'Repo root session', 'Worktree session']) {
    const target = h.page.locator('.session-row-wrap').filter({ hasText: title })
    await clickRowAction(target, 'split-session-button')
  }
  await expect(h.page.getByTestId('session-column')).toHaveCount(4)
  await expect(h.page.getByTestId('content')).toHaveAttribute('data-preset', 'grid')

  // A fifth has nowhere of its own to go.
  await h.page.getByTestId('session-tab-split').first().click()
  await expect(h.page.getByTestId('session-column')).toHaveCount(4)
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm run test:e2e -- tests/e2e/sessionTabs.spec.ts -g "up to four"`
Expected: FAIL — `data-preset` is absent (and a fifth column appears).

- [ ] **Step 3: Remove `layoutWeights`**

In `src/renderer/state/columns.ts` delete the `layoutWeights` function and its doc comment. Update the file's top comment sentence "Splitting appends another column beside the first, so several sessions can be worked on at once; there is no cap on how many." to "How columns are arranged in the window — and that there are at most four — is `layout.ts`'s business."

In `tests/unit/columns.test.ts` remove `layoutWeights` from the import and delete its `describe('layoutWeights', …)` block.

- [ ] **Step 4: Create `PaneDividers`**

Create `src/renderer/components/PaneDividers.tsx`:

```tsx
import { useEffect, useRef, useState } from 'react'
import {
  presetDef, dragTracks, boundaryAt, type PresetId, type Tracks, type DividerDef,
} from '../state/layout'

/** Below these a pane shows nothing usable: the toolbar and a few terminal rows, or a readable
 *  column. The same floor the column dividers had. */
const MIN_PANE_WIDTH = 220
const MIN_PANE_HEIGHT = 180

interface Props {
  preset: PresetId
  tracks: Tracks
  onChange: (next: Tracks) => void
}

/**
 * The draggable boundaries of the current layout, laid over the grid.
 *
 * Overlaid rather than taking a grid track of their own: a divider that is a track would need
 * every preset's template to interleave them, and `main-right2`'s horizontal divider exists on
 * one side only — as an overlay it is simply a shorter handle.
 */
export function PaneDividers({ preset, tracks, onChange }: Props): JSX.Element {
  const ref = useRef<HTMLDivElement | null>(null)
  const [dragging, setDragging] = useState<DividerDef | null>(null)
  const latest = useRef({ tracks, onChange })
  latest.current = { tracks, onChange }

  useEffect(() => {
    if (dragging === null) return
    const host = ref.current?.parentElement
    if (host == null) return
    document.body.classList.add('resizing-active')
    const onMove = (e: MouseEvent): void => {
      const rect = host.getBoundingClientRect()
      const { tracks: now, onChange: emit } = latest.current
      if (dragging.axis === 'col') {
        const pointer = (e.clientX - rect.left) / rect.width
        emit({ ...now, cols: dragTracks(now.cols, dragging.index, pointer, MIN_PANE_WIDTH / rect.width) })
      } else {
        const pointer = (e.clientY - rect.top) / rect.height
        emit({ ...now, rows: dragTracks(now.rows, dragging.index, pointer, MIN_PANE_HEIGHT / rect.height) })
      }
    }
    const onUp = (): void => setDragging(null)
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
    return () => {
      document.body.classList.remove('resizing-active')
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
  }, [dragging])

  const pct = (n: number): string => `${String(n * 100)}%`
  return (
    <div ref={ref} className="pane-dividers" aria-hidden="true">
      {presetDef(preset).dividers.map((d) => {
        const along = d.axis === 'col' ? tracks.cols : tracks.rows
        const across = d.axis === 'col' ? tracks.rows : tracks.cols
        const at = boundaryAt(along, d.index)
        const from = d.span[0] === 0 ? 0 : boundaryAt(across, d.span[0] - 1)
        const to = boundaryAt(across, d.span[1] - 1)
        const style = d.axis === 'col'
          ? { left: pct(at), top: pct(from), height: pct(to - from) }
          : { top: pct(at), left: pct(from), width: pct(to - from) }
        return (
          <div
            key={`${d.axis}-${String(d.index)}`}
            className={d.axis === 'col' ? 'column-resizer' : 'row-resizer'}
            data-testid={d.axis === 'col' ? 'column-resizer' : 'row-resizer'}
            style={style}
            onMouseDown={(e) => { e.preventDefault(); setDragging(d) }}
          />
        )
      })}
    </div>
  )
}
```

- [ ] **Step 5: Replace the flex layout with the grid in CSS**

In `src/renderer/styles.css`:

Replace `.content { overflow: hidden; min-height: 0; display: flex; flex-direction: row; }` with:

```css
/* The window's panes, laid out by the layout preset (layout.ts). Each preset names its zones z1–z4
 * in fill order; the tracks come from the style attribute, which the dividers drag. */
.content {
  overflow: hidden;
  min-height: 0;
  display: grid;
  position: relative;
}
.content[data-preset="single"] { grid-template-areas: "z1"; }
.content[data-preset="halves-h"] { grid-template-areas: "z1 z2"; }
.content[data-preset="halves-v"] { grid-template-areas: "z1" "z2"; }
.content[data-preset="thirds-h"] { grid-template-areas: "z1 z2 z3"; }
.content[data-preset="main-right2"] { grid-template-areas: "z1 z2" "z1 z3"; }
.content[data-preset="left2-main"] { grid-template-areas: "z1 z3" "z2 z3"; }
.content[data-preset="top-bottom2"] { grid-template-areas: "z1 z1" "z2 z3"; }
.content[data-preset="grid"] { grid-template-areas: "z1 z2" "z3 z4"; }
```

In the `.session-column` rule, remove `flex: 1;`, change `min-width: 180px;` to `min-width: 0;` (the divider floor now enforces width), and add below the rule:

```css
/* Panes are separated by the dividers laid over them, plus this hairline for panes whose
 * boundary has no divider of its own to draw it (a waiting zone beside a filled one). */
.session-column { box-shadow: inset 1px 0 0 var(--border), inset 0 1px 0 var(--border); }
```

Replace the whole `.column-resizer` rule block (both rules) with:

```css
/* Divider handles, laid over the grid by PaneDividers. Centered on the boundary; wider on hover
 * the way the sidebar's resizer is. */
.pane-dividers { position: absolute; inset: 0; pointer-events: none; z-index: 5; }
.column-resizer, .row-resizer {
  position: absolute;
  pointer-events: auto;
  background: var(--border);
  transition: background-color 0.1s;
}
.column-resizer { width: 5px; transform: translateX(-50%); cursor: col-resize; }
.row-resizer { height: 5px; transform: translateY(-50%); cursor: row-resize; }
.column-resizer:hover, .column-resizer:active,
.row-resizer:hover, .row-resizer:active { background: var(--accent); }
```

- [ ] **Step 6: Switch `SessionColumn` to a grid area**

In `src/renderer/components/SessionColumn.tsx`:

Replace the `weight` prop in `Props`:

```ts
  /** The grid zone this pane sits in (`z1`…`z4`), from the layout preset. */
  gridArea: string
  /** Shown in place of the "Select a session" message when this pane is waiting to be filled. */
  emptyContent?: ReactNode
  /** The window's layout button, when this pane is the one at the top-right corner. */
  layoutButton?: ReactNode
```

In the destructured props, replace `weight,` with `gridArea, emptyContent, layoutButton,`.

Replace `style={{ flexGrow: weight }}` with `style={{ gridArea }}` and add `data-placeholder={column.placeholder === true}` beside `data-active`.

Replace the empty-state branch:

```tsx
      {activeKey === null ? (
        emptyContent ?? (
          <p className="empty" data-testid="content-empty">
            Select a session to view its transcript.
          </p>
        )
      ) : (
```

`SessionColumn.tsx` does not import `React` as a namespace, so type these props as `ReactNode` and add `type ReactNode` to its existing `react` import: `import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'`.

Pass `layoutButton` straight through to `SessionTabBar` as a new prop `layoutButton={layoutButton}` — Task 7 renders it; for now add to `SessionTabBar`'s `Props`:

```ts
  /** The window's layout button, shown beside the split button on the top-right pane only. */
  layoutButton?: ReactNode
```

and render `{layoutButton}` immediately before the `session-tab-split` button (import `type ReactNode` from `react` there).

- [ ] **Step 7: Move `App` onto `Layout`**

In `src/renderer/App.tsx`:

1. Imports: remove `layoutWeights` from the `./state/columns` import. Add:

```ts
import {
  initialLayout, tidyLayout, openBeside, presetDef, defaultTracks, trackTemplate,
  type Layout, type PresetId, type Tracks,
} from './state/layout'
import { PaneDividers } from './components/PaneDividers'
```

2. Delete `pruneColumns` and its comment, `MIN_COLUMN_WIDTH`, the `columnWeights` state, the `columnDrag` state, the column-drag `useEffect`, `startColumnDrag`, and `const layout = layoutWeights(...)` with its comment.

3. Replace the `columnsRaw`/`columns`/`setColumns` block with:

```tsx
  const [activeColumnId, setActiveColumnId] = useState<string | null>(null)
  // Read by the tidy step, which runs inside state updaters where the current value of another
  // piece of state is not otherwise available.
  const activeColumnRef = useRef<string | null>(null)
  activeColumnRef.current = activeColumnId
  /**
   * The window's panes and how they are arranged (layout.ts). Every change goes through
   * `tidyLayout` — the one place that closes an emptied pane and keeps the layout's shape — so no
   * call site can forget to, which is how empty columns used to get stranded beside full ones.
   */
  const [layout, setLayoutRaw] = useState<Layout>(initialLayout)
  const setLayout = useCallback((update: (prev: Layout) => Layout) => {
    setLayoutRaw((prev) => tidyLayout(update(prev), activeColumnRef.current))
  }, [])
  const columns = layout.panes
  /** The column-shaped view the existing tab operations were written against. */
  const setColumns = useCallback(
    (update: (prev: Column[]) => Column[]) => {
      setLayout((prev) => {
        const panes = update(prev.panes)
        return panes === prev.panes ? prev : { ...prev, panes }
      })
    },
    [setLayout],
  )
  /** Divider positions per preset, for as long as the window is open. */
  const [tracks, setTracks] = useState<Map<PresetId, Tracks>>(new Map())
  const currentTracks = tracks.get(layout.preset) ?? defaultTracks(layout.preset)
```

Delete the old `const [activeColumnId, setActiveColumnId] = useState<string | null>(null)` line further down (it now lives in the block above).

4. Replace `splitActiveTab` with:

```tsx
  /**
   * The tab bar's split button: the active session opened again beside the current pane, keeping
   * the view it was on. It stays open where it was too, matching VS Code's split and the sidebar's
   * own split button. With four panes it opens in the next pane instead (see `openBeside`).
   */
  const splitActiveTab = useCallback((key: string) => {
    const tab = layout.panes.flatMap((c) => c.tabs).find((t) => t.key === key)
    if (tab === undefined) return
    const result = openBeside(layout, activeColumnId, { ...tab })
    setLayout(() => result.layout)
    setActiveColumnId(result.paneId)
  }, [layout, activeColumnId, setLayout])
```

The result is computed outside the state updater, from the rendered `layout`, because the pane id
it returns is needed for `setActiveColumnId` in the same handler.

5. In `openSessionTab`, replace the `if (split) { … }` block with:

```tsx
    if (split) {
      const result = openBeside(layout, activeColumnId, { key: session.sessionId, view: 'transcript' })
      setLayout(() => result.layout)
      setActiveColumnId(result.paneId)
      return
    }
```

and add `layout` and `setLayout` to its dependency list (`[activeColumnId, layout, setColumns, setLayout]`).

6. Replace the `<main className="content" …>` element and its children with:

```tsx
      <main
        className="content"
        data-testid="content"
        data-preset={layout.preset}
        style={{
          gridTemplateColumns: trackTemplate(currentTracks.cols),
          gridTemplateRows: trackTemplate(currentTracks.rows),
        }}
      >
        {columns.map((column, index) => (
          <ErrorBoundary
            key={column.id}
            label="This session"
            onError={(thrown, componentStack) => {
              const { message, detail } = describeError(thrown)
              notify({
                kind: 'error',
                message: `This session could not be displayed: ${message}`,
                detail: [detail, componentStack].filter((t) => t !== null && t !== '').join('\n'),
              })
            }}
          >
          <SessionColumn
            gridArea={`z${String(index + 1)}`}
            column={column}
            sessions={openSessions}
            /* The remaining props — pending, resumed, ptyOverrides, shellTabs … onDetach — are
               copied unchanged from the existing element. Only `weight` is dropped. */
          />
          </ErrorBoundary>
        ))}
        <PaneDividers
          preset={layout.preset}
          tracks={currentTracks}
          onChange={(next) => { setTracks((prev) => new Map(prev).set(layout.preset, next)) }}
        />
      </main>
```

Keep every existing `SessionColumn` prop and handler as it was; only remove `weight={…}` and the `Fragment`/`column-resizer` wrapper. Remove `Fragment` from the React import if nothing else uses it.

`ErrorBoundary` renders its children directly, so `SessionColumn`'s `<section>` is the grid item. Its crash fallback is a `<div className="crash-pane">`, which would land in no zone. In `src/renderer/components/ErrorBoundary.tsx`, add an optional prop `style?: CSSProperties` (import `type CSSProperties` from `react`) and put `style={this.props.style}` on that `crash-pane` div. In `App.tsx`, pass `style={{ gridArea: \`z${String(index + 1)}\` }}` to the `ErrorBoundary`.

- [ ] **Step 8: Typecheck**

Run: `npm run typecheck`
Expected: clean. Fix any remaining reference to `weight`, `columnWeights`, `startColumnDrag` or `layoutWeights`.

- [ ] **Step 9: Run the tab and terminal e2e specs**

Run: `npm run test:e2e -- tests/e2e/sessionTabs.spec.ts tests/e2e/multiTerminal.spec.ts tests/e2e/pinning.spec.ts tests/e2e/newSession.spec.ts tests/e2e/detachTab.spec.ts`
Expected: PASS, including "splitting keeps adding panes up to four", "dragging the divider between two columns changes their widths", "a column cannot be dragged narrower than its floor", and "closing a column after dragging the divider leaves no empty strip beside the survivor".

If "a column cannot be dragged narrower than its floor" fails, read its assertion: it measures the left column after dragging far left; the floor is now `MIN_PANE_WIDTH` (220px) from `PaneDividers`, same as the old `MIN_COLUMN_WIDTH`.

If "the terminal never renders taller than the space it has" (multiTerminal) fails, add `min-height: 0` to `.session-column` if you removed it — grid items default to `min-height: auto`.

- [ ] **Step 10: Commit**

```bash
git add -A src/renderer tests/unit/columns.test.ts tests/e2e/sessionTabs.spec.ts
git commit -m "refactor: a window's columns become a layout of up to four panes"
```

---

### Task 5: The picker — `LayoutPicker`, `LayoutMenuButton`, the layout context

**Files:**
- Create: `src/renderer/components/LayoutPicker.tsx`, `src/renderer/components/LayoutMenuButton.tsx`, `src/renderer/state/layoutContext.ts`
- Modify: `src/renderer/components/icons.tsx`, `src/renderer/components/useHoverCard.ts`, `src/renderer/styles.css`

**Interfaces:**
- Consumes: `PRESETS`, `capacity`, `PresetId` (Task 1); `useHoverCard` (`src/renderer/components/useHoverCard.ts`, existing: returns `{ anchor, ref, arm, keepOpen, scheduleClose, hideNow }`; this task adds `openNow`).
- Produces:
  - `LayoutPicker` props: `{ anchor: DOMRect; mode: 'place' | 'layout'; heading: string; current: PresetId; onPick: (preset: PresetId, zone: number) => void; onClose: () => void; onPointerEnter?: () => void; onPointerLeave?: () => void }`. In `layout` mode `onPick` is called with `zone = 0`.
  - `LayoutMenuButton` props: `{ className: string; testId: string; title: string; ariaLabel: string; onClick: () => void; heading: string; onPick: (preset: PresetId, zone: number) => void; children: ReactNode }` — reads the current preset from context.
  - `type PlaceTarget = { kind: 'tab'; key: string } | { kind: 'session'; session: SessionNode }`
  - `interface LayoutActions { preset: PresetId; place: (target: PlaceTarget, preset: PresetId, zone: number) => void; apply: (preset: PresetId) => void; requestPicker: (target: PlaceTarget, at: { x: number; y: number }) => void }`
  - `LayoutContext` (React context, default no-op actions with `preset: 'single'`) and `useLayoutActions(): LayoutActions`
  - `LayoutIcon` in `icons.tsx`

E2E coverage for this component comes in Task 7, through its openers.

- [ ] **Step 1: Add the icon**

In `src/renderer/components/icons.tsx`, before `export function PlusIcon(`:

```tsx
/** Four panes — the layout picker's button. */
export function LayoutIcon({ className }: IconProps): JSX.Element {
  return (
    <svg className={className} viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <rect x="2" y="2.5" width="12" height="11" rx="1.5" stroke="currentColor" strokeWidth="1.2" />
      <path d="M8 2.5v11M2 8h12" stroke="currentColor" strokeWidth="1.2" />
    </svg>
  )
}
```

- [ ] **Step 2: Create the context**

Create `src/renderer/state/layoutContext.ts`:

```ts
import { createContext, useContext } from 'react'
import type { SessionNode } from '@shared/types'
import type { PresetId } from './layout'

/** What a picker is placing: a tab already in the window, or a session from the sidebar. */
export type PlaceTarget = { kind: 'tab'; key: string } | { kind: 'session'; session: SessionNode }

export interface LayoutActions {
  preset: PresetId
  place: (target: PlaceTarget, preset: PresetId, zone: number) => void
  apply: (preset: PresetId) => void
  /** Opens the picker at a point — for "Arrange…" in a context menu, which has no button to hover. */
  requestPicker: (target: PlaceTarget, at: { x: number; y: number }) => void
}

/**
 * The window's layout, offered to the tab strips and the sidebar rows without threading it
 * through every component in between.
 */
export const LayoutContext = createContext<LayoutActions>({
  preset: 'single',
  place: () => {},
  apply: () => {},
  requestPicker: () => {},
})

export function useLayoutActions(): LayoutActions {
  return useContext(LayoutContext)
}
```

- [ ] **Step 3: Create the picker**

Create `src/renderer/components/LayoutPicker.tsx`:

```tsx
import { useLayoutEffect, useRef, useState, type KeyboardEvent } from 'react'
import { createPortal } from 'react-dom'
import { PRESETS, capacity, type PresetId } from '../state/layout'

const GAP = 6
const MARGIN = 8
const PER_ROW = 4

interface Props {
  anchor: DOMRect
  /** `place`: each zone is a target. `layout`: each thumbnail is one. */
  mode: 'place' | 'layout'
  heading: string
  current: PresetId
  onPick: (preset: PresetId, zone: number) => void
  onClose: () => void
  onPointerEnter?: () => void
  onPointerLeave?: () => void
}

/**
 * The layout picker: the eight presets as thumbnails, in the style of the macOS window-tiling menu
 * and Windows' Snap Layouts.
 *
 * In place mode every zone of every thumbnail is its own button, so "put this session *there*" is
 * one click on the exact spot. Portalled and fixed like the hover card, for the same reason: it is
 * opened from inside scrolling containers that would clip it.
 */
export function LayoutPicker({
  anchor, mode, heading, current, onPick, onClose, onPointerEnter, onPointerLeave,
}: Props): JSX.Element {
  const ref = useRef<HTMLDivElement | null>(null)
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null)

  useLayoutEffect(() => {
    const el = ref.current
    if (el === null) return
    const box = el.getBoundingClientRect()
    const below = anchor.bottom + GAP
    const top = below + box.height + MARGIN <= window.innerHeight
      ? below
      : Math.max(MARGIN, anchor.top - GAP - box.height)
    const left = Math.max(MARGIN, Math.min(anchor.left, window.innerWidth - box.width - MARGIN))
    setPos({ left, top })
    // Focus the first target, so the keyboard works the moment the picker is up.
    el.querySelector<HTMLButtonElement>('button')?.focus({ preventScroll: true })
  }, [anchor])

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>): void => {
    if (e.key === 'Escape') { e.preventDefault(); onClose(); return }
    const buttons = [...(ref.current?.querySelectorAll<HTMLButtonElement>('button[data-preset]') ?? [])]
    const at = buttons.indexOf(document.activeElement as HTMLButtonElement)
    if (at === -1) return
    const focus = (i: number): void => { buttons[Math.max(0, Math.min(buttons.length - 1, i))]?.focus() }
    if (e.key === 'ArrowRight') { e.preventDefault(); focus(at + 1) }
    if (e.key === 'ArrowLeft') { e.preventDefault(); focus(at - 1) }
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault()
      const here = buttons[at]
      const presetIndex = PRESETS.findIndex((p) => p.id === here.dataset.preset)
      const targetIndex = presetIndex + (e.key === 'ArrowDown' ? PER_ROW : -PER_ROW)
      const target = PRESETS[targetIndex]
      if (target === undefined) return
      const zone = Math.min(Number(here.dataset.zone ?? 0), capacity(target.id) - 1)
      const next = buttons.findIndex((b) => b.dataset.preset === target.id && Number(b.dataset.zone ?? 0) === zone)
      if (next !== -1) focus(next)
    }
  }

  return createPortal(
    <div
      ref={ref}
      className="layout-picker"
      data-testid="layout-picker"
      data-mode={mode}
      role="dialog"
      aria-label={heading}
      style={pos === null ? { visibility: 'hidden', left: 0, top: 0 } : pos}
      onMouseEnter={onPointerEnter}
      onMouseLeave={onPointerLeave}
      // As with the hover card: a portal still bubbles React events to whatever rendered it, and a
      // row that hides things on mousedown would unmount this before the click landed.
      onMouseDown={(e) => { e.stopPropagation() }}
      onKeyDown={onKeyDown}
    >
      <div className="layout-picker-heading">{heading}</div>
      <div className="layout-picker-grid">
        {PRESETS.map((p) => {
          const zones = Array.from({ length: capacity(p.id) }, (_, i) => i)
          const style = {
            gridTemplateColumns: `repeat(${String(p.cols)}, 1fr)`,
            gridTemplateRows: `repeat(${String(p.rows)}, 1fr)`,
            gridTemplateAreas: p.areas.map((row) => `"${row}"`).join(' '),
          }
          if (mode === 'layout') {
            return (
              <button
                key={p.id}
                className="layout-thumb"
                data-testid={`layout-option-${p.id}`}
                data-preset={p.id}
                data-current={p.id === current}
                title={p.label}
                aria-label={p.label}
                style={style}
                onClick={() => { onPick(p.id, 0) }}
              >
                {zones.map((z) => <span key={z} className="layout-zone" style={{ gridArea: `z${String(z + 1)}` }} />)}
              </button>
            )
          }
          return (
            <div
              key={p.id}
              className="layout-thumb"
              data-testid={`layout-option-${p.id}`}
              data-current={p.id === current}
              style={style}
            >
              {zones.map((z) => (
                <button
                  key={z}
                  className="layout-zone"
                  data-testid={`layout-zone-${p.id}-${String(z + 1)}`}
                  data-preset={p.id}
                  data-zone={z}
                  title={`${p.label} — position ${String(z + 1)}`}
                  aria-label={`${p.label}, position ${String(z + 1)}`}
                  style={{ gridArea: `z${String(z + 1)}` }}
                  onClick={() => { onPick(p.id, z) }}
                />
              ))}
            </div>
          )
        })}
      </div>
    </div>,
    document.body,
  )
}
```

- [ ] **Step 4: Let the hover hook open at once**

In `src/renderer/components/useHoverCard.ts`, add to the return type:

```ts
  /** Shows the card at once, without the hover delay — for a click on something whose only job is to open it. */
  openNow: () => void
```

add the implementation beside `hideNow`:

```ts
  const openNow = (): void => {
    clearTimers()
    const rect = ref.current?.getBoundingClientRect()
    if (rect !== undefined) setAnchor(rect)
  }
```

and return `{ anchor, ref, arm, keepOpen, scheduleClose, hideNow, openNow }`.

- [ ] **Step 5: Create the hover button**

Create `src/renderer/components/LayoutMenuButton.tsx`:

```tsx
import type { ReactNode } from 'react'
import { LayoutPicker } from './LayoutPicker'
import { useHoverCard } from './useHoverCard'
import { useLayoutActions } from '../state/layoutContext'
import type { PresetId } from '../state/layout'

interface Props {
  className: string
  testId: string
  title: string
  ariaLabel: string
  /** What a plain click does — the button's job before the picker existed. */
  onClick?: () => void
  heading: string
  mode?: 'place' | 'layout'
  onPick: (preset: PresetId, zone: number) => void
  children: ReactNode
}

/**
 * A button that still does its own job on click, and offers the layout picker when the pointer
 * rests on it — the green-button gesture from macOS. Without an `onClick`, a click opens the
 * picker straight away.
 */
export function LayoutMenuButton({
  className, testId, title, ariaLabel, onClick, heading, mode = 'place', onPick, children,
}: Props): JSX.Element {
  const { preset } = useLayoutActions()
  const hover = useHoverCard<HTMLButtonElement>()
  return (
    <>
      <button
        ref={hover.ref}
        className={className}
        data-testid={testId}
        title={title}
        aria-label={ariaLabel}
        aria-haspopup="dialog"
        onMouseEnter={hover.arm}
        onMouseLeave={hover.scheduleClose}
        onClick={(e) => {
          e.stopPropagation()
          if (onClick === undefined) { hover.openNow(); return }
          hover.hideNow()
          onClick()
        }}
      >
        {children}
      </button>
      {hover.anchor !== null && (
        <LayoutPicker
          anchor={hover.anchor}
          mode={mode}
          heading={heading}
          current={preset}
          onPick={(p, z) => { hover.hideNow(); onPick(p, z) }}
          onClose={() => { hover.hideNow(); hover.ref.current?.focus() }}
          onPointerEnter={hover.keepOpen}
          onPointerLeave={hover.scheduleClose}
        />
      )}
    </>
  )
}
```

- [ ] **Step 6: Style it**

Append to `src/renderer/styles.css`:

```css
/* The layout picker (LayoutPicker.tsx): eight thumbnails, each drawn as its own tiny grid. */
.layout-picker {
  position: fixed;
  z-index: 60;
  padding: 10px;
  background: var(--bg-panel);
  border: 1px solid var(--border);
  border-radius: var(--radius-lg);
  box-shadow: 0 8px 24px var(--bg-overlay);
}
.layout-picker-heading { color: var(--muted); font-size: 11px; margin: 0 2px 8px; }
.layout-picker-grid { display: grid; grid-template-columns: repeat(4, 44px); gap: 10px; }
.layout-thumb {
  display: grid;
  gap: 2px;
  width: 44px;
  height: 32px;
  padding: 2px;
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  background: none;
}
.layout-thumb[data-current="true"] { border-color: var(--accent); }
.layout-zone {
  display: block;
  min-width: 0;
  min-height: 0;
  padding: 0;
  border: 0;
  border-radius: 2px;
  background: var(--hover);
  cursor: pointer;
}
.layout-zone:hover, .layout-zone:focus-visible,
button.layout-thumb:hover .layout-zone, button.layout-thumb:focus-visible .layout-zone {
  background: var(--accent);
  outline: none;
}
```

- [ ] **Step 7: Typecheck and commit**

```bash
npm run typecheck
git add src/renderer/components/LayoutPicker.tsx src/renderer/components/LayoutMenuButton.tsx src/renderer/components/useHoverCard.ts src/renderer/state/layoutContext.ts src/renderer/components/icons.tsx src/renderer/styles.css
git commit -m "feat(layout): the layout picker and its hover button"
```

---

### Task 6: `App` provides the layout actions and the "Arrange…" picker

**Files:**
- Modify: `src/renderer/App.tsx`

**Interfaces:**
- Consumes: `LayoutContext`, `PlaceTarget` (Task 5); `placeInZone`, `applyPreset` (Task 1); `LayoutPicker` (Task 5); `setLayout`, `layout`, `openSessions`/`setOpenSessions`, `setActiveColumnId` (existing/Task 4).
- Produces: the context value every opener in Task 7 uses. `place` on a `session` target records the node in `openSessions` first so the tab has a title.

- [ ] **Step 1: Add the actions and the requested-picker state**

In `App.tsx`, import:

```ts
import { placeInZone, applyPreset } from './state/layout'   // merge into the existing layout import
import { LayoutContext, type LayoutActions, type PlaceTarget } from './state/layoutContext'
import { LayoutPicker } from './components/LayoutPicker'
```

Below `splitActiveTab`, add:

```tsx
  const placeTarget = useCallback((target: PlaceTarget, preset: PresetId, zone: number) => {
    const key = target.kind === 'tab' ? target.key : target.session.sessionId
    if (target.kind === 'session') {
      const node = target.session
      setOpenSessions((prev) => new Map(prev).set(node.sessionId, node))
    }
    const result = placeInZone(layout, preset, zone, key)
    setLayout(() => result.layout)
    setActiveColumnId(result.paneId)
  }, [layout, setLayout])

  const applyLayout = useCallback((preset: PresetId) => {
    setLayout((prev) => applyPreset(prev, preset))
  }, [setLayout])

  /** A picker opened from a context menu's "Arrange…", which has no button to hang it from. */
  const [requestedPicker, setRequestedPicker] = useState<{ target: PlaceTarget; at: DOMRect } | null>(null)

  const layoutActions: LayoutActions = {
    preset: layout.preset,
    place: placeTarget,
    apply: applyLayout,
    requestPicker: (target, at) => { setRequestedPicker({ target, at: new DOMRect(at.x, at.y, 0, 0) }) },
  }
```

- [ ] **Step 2: Provide it and render the requested picker**

Wrap the returned tree: change `return (\n    <div className="app-shell">` to `return (\n    <LayoutContext.Provider value={layoutActions}>\n    <div className="app-shell">`, and the closing `</div>\n  )` at the end of the component to `</div>\n    </LayoutContext.Provider>\n  )`.

Just before the `{conflict !== null && …}` block, add:

```tsx
      {requestedPicker !== null && (
        <LayoutPicker
          anchor={requestedPicker.at}
          mode="place"
          heading="Arrange"
          current={layout.preset}
          onPick={(preset, zone) => {
            const target = requestedPicker.target
            setRequestedPicker(null)
            placeTarget(target, preset, zone)
          }}
          onClose={() => { setRequestedPicker(null) }}
        />
      )}
```

A requested picker also has to close on an outside click. Add, next to it:

```tsx
  useEffect(() => {
    if (requestedPicker === null) return
    const close = (e: MouseEvent): void => {
      if ((e.target as Element | null)?.closest('[data-testid="layout-picker"]') == null) setRequestedPicker(null)
    }
    window.addEventListener('mousedown', close)
    return () => { window.removeEventListener('mousedown', close) }
  }, [requestedPicker])
```

(Place this `useEffect` with the other hooks, above the `return`.)

- [ ] **Step 3: Typecheck and commit**

```bash
npm run typecheck
git add src/renderer/App.tsx
git commit -m "feat(layout): the window offers its layout to the openers"
```

---

### Task 7: The openers — sidebar split, tab strip split, tab icon, "Arrange…", window layout button

**Files:**
- Modify: `src/renderer/components/SessionRow.tsx`, `src/renderer/components/SessionTabBar.tsx`, `src/renderer/components/Sidebar.tsx`, `src/renderer/App.tsx`, `src/renderer/styles.css`
- Test: `tests/e2e/paneLayouts.spec.ts` (create)

**Interfaces:**
- Consumes: `LayoutMenuButton`, `useLayoutActions`, `LayoutIcon`, `presetDef` (Tasks 1, 5, 6).
- Produces test ids used by Task 8 and the e2e spec:
  - `split-session-button` (sidebar row; hover opens picker), `session-tab-split` (strip; hover opens picker), `session-tab-layout` (per tab), `window-layout-button`, `layout-picker`, `layout-zone-<preset>-<n>`, `layout-option-<preset>`, context menu items with id `arrange` and label `Arrange…`.

- [ ] **Step 1: Write the failing e2e tests**

Create `tests/e2e/paneLayouts.spec.ts`:

```ts
import { test, expect, type Locator } from '@playwright/test'
import { launchApiary, importAll, sidebarSession, type Harness } from './helpers'

/**
 * Arranging sessions into a layout of up to four panes, from a hover picker — the macOS
 * window-tiling gesture, applied to panes inside one window.
 */

let h: Harness
test.beforeEach(async () => {
  h = await launchApiary({ secondWorktree: true })
  await importAll(h.page)
  await h.page.getByTestId('sidebar-refresh').click()
})
test.afterEach(async () => { await h.close() })

const content = (): Locator => h.page.getByTestId('content')
const panes = (): Locator => h.page.getByTestId('session-column')
const row = (title: string): Locator => h.page.locator('.session-row-wrap').filter({ hasText: title })

async function openPickerOn(button: Locator, hoverFirst?: Locator): Promise<Locator> {
  await expect(async () => {
    if (hoverFirst !== undefined) await hoverFirst.hover({ timeout: 2000 })
    await button.hover({ timeout: 2000 })
    await expect(h.page.getByTestId('layout-picker')).toBeVisible({ timeout: 2000 })
  }).toPass({ timeout: 20000 })
  return h.page.getByTestId('layout-picker')
}

test('resting on a sidebar row\'s split button offers the layouts, and a zone places the session there', async () => {
  await sidebarSession(h.page, 'Fix CSV export bug').click()
  const target = row('Add worktree switcher')
  const picker = await openPickerOn(target.getByTestId('split-session-button'), target)

  await picker.getByTestId('layout-zone-halves-h-1').click()

  await expect(content()).toHaveAttribute('data-preset', 'halves-h')
  await expect(panes()).toHaveCount(2)
  await expect(panes().first()).toContainText('Add worktree switcher')
  await expect(panes().last()).toContainText('Fix CSV export bug')
  await expect(h.page.getByTestId('layout-picker')).toHaveCount(0)
})

test('a plain click on the split button still opens to the side', async () => {
  await sidebarSession(h.page, 'Fix CSV export bug').click()
  const target = row('Add worktree switcher')
  await target.hover()
  await target.getByTestId('split-session-button').click()
  await expect(panes()).toHaveCount(2)
  await expect(h.page.getByTestId('layout-picker')).toHaveCount(0)
})

test('a tab moved to another zone is moved, not copied', async () => {
  await sidebarSession(h.page, 'Fix CSV export bug').click()
  await sidebarSession(h.page, 'Add worktree switcher').click()
  await expect(h.page.getByTestId('session-tab')).toHaveCount(2)

  const tab = h.page.getByTestId('session-tab').filter({ hasText: 'Add worktree switcher' })
  const picker = await openPickerOn(tab.getByTestId('session-tab-layout'), tab)
  await picker.getByTestId('layout-zone-halves-v-2').click()

  await expect(content()).toHaveAttribute('data-preset', 'halves-v')
  await expect(panes().first().getByTestId('session-tab')).toHaveCount(1)
  await expect(panes().first()).toContainText('Fix CSV export bug')
  await expect(panes().last().getByTestId('session-tab')).toHaveText(['Add worktree switcher'])
})

test('Arrange… from a tab\'s menu opens the picker where the menu was', async () => {
  await sidebarSession(h.page, 'Fix CSV export bug').click()
  await h.page.getByTestId('session-tab').first().click({ button: 'right' })
  await h.page.getByTestId('tab-menu').getByText('Arrange…').click()
  const picker = h.page.getByTestId('layout-picker')
  await expect(picker).toBeVisible()
  await picker.getByTestId('layout-zone-grid-4').click()
  await expect(content()).toHaveAttribute('data-preset', 'grid')
  await expect(panes()).toHaveCount(4)
  await expect(panes().nth(3)).toContainText('Fix CSV export bug')
})

test('Arrange… from a sidebar session\'s menu opens that session in the chosen zone', async () => {
  await sidebarSession(h.page, 'Fix CSV export bug').click()
  await row('Repo root session').click({ button: 'right' })
  await h.page.getByText('Arrange…').click()
  await h.page.getByTestId('layout-zone-main-right2-1').click()
  await expect(content()).toHaveAttribute('data-preset', 'main-right2')
  await expect(panes().first()).toContainText('Repo root session')
})

test('the window layout button changes the layout without moving any session', async () => {
  await sidebarSession(h.page, 'Fix CSV export bug').click()
  await h.page.getByTestId('window-layout-button').click()
  await h.page.getByTestId('layout-picker').getByTestId('layout-option-halves-v').click()
  await expect(content()).toHaveAttribute('data-preset', 'halves-v')
  await expect(panes().first()).toContainText('Fix CSV export bug')
  await expect(panes().last()).toHaveAttribute('data-placeholder', 'true')
})

test('there is one window layout button, on the pane at the top-right corner', async () => {
  await sidebarSession(h.page, 'Fix CSV export bug').click()
  await h.page.getByTestId('window-layout-button').click()
  await h.page.getByTestId('layout-option-grid').click()
  await expect(h.page.getByTestId('window-layout-button')).toHaveCount(1)
  await expect(panes().nth(1).getByTestId('window-layout-button')).toHaveCount(1)
})

test('the picker marks the current layout and closes on Escape', async () => {
  await sidebarSession(h.page, 'Fix CSV export bug').click()
  await h.page.getByTestId('window-layout-button').click()
  const picker = h.page.getByTestId('layout-picker')
  await expect(picker.getByTestId('layout-option-single')).toHaveAttribute('data-current', 'true')
  await h.page.keyboard.press('Escape')
  await expect(picker).toHaveCount(0)
})

test('a divider in the grid resizes the panes either side of it', async () => {
  await sidebarSession(h.page, 'Fix CSV export bug').click()
  await h.page.getByTestId('window-layout-button').click()
  await h.page.getByTestId('layout-option-grid').click()
  const handle = (await h.page.getByTestId('row-resizer').boundingBox())!
  const before = (await panes().first().boundingBox())!
  await h.page.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2)
  await h.page.mouse.down()
  await h.page.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2 + 80, { steps: 5 })
  await h.page.mouse.up()
  const after = (await panes().first().boundingBox())!
  expect(after.height).toBeGreaterThan(before.height + 40)
})

test('closing the last tab in a pane steps the layout down', async () => {
  await sidebarSession(h.page, 'Fix CSV export bug').click()
  const target = row('Add worktree switcher')
  const picker = await openPickerOn(target.getByTestId('split-session-button'), target)
  await picker.getByTestId('layout-zone-halves-h-2').click()
  await expect(content()).toHaveAttribute('data-preset', 'halves-h')

  await panes().last().getByTestId('session-tab-close').click()
  await expect(content()).toHaveAttribute('data-preset', 'single')
  await expect(panes()).toHaveCount(1)
})
```

- [ ] **Step 2: Run them to verify they fail**

Run: `npm run test:e2e -- tests/e2e/paneLayouts.spec.ts`
Expected: FAIL — no `layout-picker`, no `session-tab-layout`, no `window-layout-button`, no "Arrange…".

- [ ] **Step 3: Sidebar row split button**

In `src/renderer/components/SessionRow.tsx`, import:

```ts
import { LayoutMenuButton } from './LayoutMenuButton'
import { useLayoutActions } from '../state/layoutContext'
```

Inside the component body add `const { place } = useLayoutActions()`, and replace the `split-session-button` `<button>` element with:

```tsx
      <LayoutMenuButton
        className="row-action split-session-button"
        testId="split-session-button"
        title="Open to the side — rest here for layouts"
        ariaLabel={`Open session ${session.title} to the side`}
        heading={`Open “${session.title}” here`}
        onClick={() => { onSplit(session) }}
        onPick={(preset, zone) => { hideNow(); place({ kind: 'session', session }, preset, zone) }}
      >
        <SplitIcon />
      </LayoutMenuButton>
```

- [ ] **Step 4: Tab strip — per-tab icon, split button, "Arrange…", window button**

In `src/renderer/components/SessionTabBar.tsx`, import:

```ts
import { CloseIcon, SplitIcon, LayoutIcon } from './icons'   // replaces the existing icons import
import { LayoutMenuButton } from './LayoutMenuButton'
import { useLayoutActions } from '../state/layoutContext'
```

In the component body add `const { place, requestPicker } = useLayoutActions()`.

Inside each tab, directly before the `session-tab-close` button:

```tsx
          <LayoutMenuButton
            className="session-tab-layout"
            testId="session-tab-layout"
            title="Arrange"
            ariaLabel={`Arrange ${tab.label}`}
            heading={`Move “${tab.label}” here`}
            onPick={(preset, zone) => { place({ kind: 'tab', key: tab.key }, preset, zone) }}
          >
            <LayoutIcon />
          </LayoutMenuButton>
```

Replace the `session-tab-split` `<button>` with (keeping it after `{layoutButton}`):

```tsx
        <LayoutMenuButton
          className="session-tab-split"
          testId="session-tab-split"
          title="Split this session into a new pane — rest here for layouts"
          ariaLabel="Split this session into a new pane"
          heading="Move the session in front here"
          onClick={onSplitActive}
          onPick={(preset, zone) => {
            if (activeKey !== null) place({ kind: 'tab', key: activeKey }, preset, zone)
          }}
        >
          <SplitIcon />
        </LayoutMenuButton>
```

If the existing split button is rendered only when `activeKey !== null` (check the surrounding JSX), keep that condition.

In the context menu `items`, add after the "Move into New Window" item:

```ts
          {
            id: 'arrange',
            label: 'Arrange…',
            run: () => { requestPicker({ kind: 'tab', key: menu.key }, { x: menu.x, y: menu.y }) },
          },
```

- [ ] **Step 5: Sidebar session menu**

In `src/renderer/components/Sidebar.tsx`, import `useLayoutActions` from `'../state/layoutContext'`, add `const { requestPicker } = useLayoutActions()` in the component body, and change the session menu to:

```ts
    if (menu.kind === 'session') {
      const session = flattenSessions(tree).get(menu.id)
      return [
        {
          id: 'fork-session',
          label: 'Fork session',
          run: () => onForkSession(menu.id),
        },
        {
          id: 'arrange',
          label: 'Arrange…',
          disabled: session === undefined,
          run: () => { if (session !== undefined) requestPicker({ kind: 'session', session }, { x: menu.x, y: menu.y }) },
        },
      ]
    }
```

- [ ] **Step 6: The window layout button on the top-right pane**

In `App.tsx`, import `LayoutMenuButton` and `LayoutIcon`. In the `columns.map` render, pass to `SessionColumn`:

```tsx
            layoutButton={index === presetDef(layout.preset).topRight ? (
              <LayoutMenuButton
                className="session-tab-split window-layout-button"
                testId="window-layout-button"
                title="Layout"
                ariaLabel="Change layout"
                heading="Layout"
                mode="layout"
                onPick={(preset) => { applyLayout(preset) }}
              >
                <LayoutIcon />
              </LayoutMenuButton>
            ) : undefined}
```

Because `LayoutMenuButton` has no `onClick` here, a click opens the picker at once.

- [ ] **Step 7: Style the tab icon**

In `src/renderer/styles.css`, directly after the `.session-tab-close svg` rule:

```css
/* The per-tab layout button: present on the tab under the pointer and on the active tab only, so
 * a strip of many tabs does not become a strip of many icons. Same box as the close button. */
.session-tab-layout {
  flex: none;
  display: none;
  align-items: center;
  justify-content: center;
  width: 18px;
  height: 18px;
  margin-right: 2px;
  padding: 0;
  border: 0;
  border-radius: 4px;
  background: none;
  color: var(--muted);
}
.session-tab:hover .session-tab-layout,
.session-tab-layout:focus-visible { display: flex; }
.session-tab-layout:hover { background: var(--hover); color: var(--text); }
.session-tab-layout svg { width: 12px; height: 12px; display: block; }
```

- [ ] **Step 8: Run the e2e tests to verify they pass**

Run: `npm run test:e2e -- tests/e2e/paneLayouts.spec.ts tests/e2e/sessionTabs.spec.ts tests/e2e/pinning.spec.ts`
Expected: PASS.

If "a plain click on the split button still opens to the side" shows the picker too: the click must call `hover.hideNow()` before `onClick` (already in `LayoutMenuButton`) — check the hover delay did not already fire (it is 350ms; Playwright's hover-then-click is faster).

If `pinning.spec.ts` fails on `split-session-button` visibility: the `LayoutMenuButton` renders the same `className`, so the existing `.row-action` hover rules still apply; check the class string is exactly `row-action split-session-button`.

- [ ] **Step 9: Commit**

```bash
npm run typecheck
git add src/renderer tests/e2e/paneLayouts.spec.ts
git commit -m "feat(layout): arrange sessions from tabs, sidebar rows, menus and the window button"
```

---

### Task 8: The empty pane — `PaneFiller`

**Files:**
- Create: `src/renderer/components/PaneFiller.tsx`
- Modify: `src/renderer/App.tsx`, `src/renderer/styles.css`
- Test: `tests/e2e/paneLayouts.spec.ts`

**Interfaces:**
- Consumes: `closePane` (Task 2); `moveTabToColumn`, `openTab` (columns.ts); `setLayout`, `setColumns`, `setOpenSessions`, `setActiveColumnId`, `activeColumnId`, `openSessions`, `pendingTabInfo` (App).
- Produces: `PaneFiller` props `{ openTabs: { key: string; label: string }[]; exclude: Set<string>; onMoveHere: (key: string) => void; onOpenHere: (session: SessionNode) => void; onClosePane: () => void }`. Test ids: `pane-filler`, `pane-filler-tab`, `pane-filler-session`, `pane-filler-search`, `pane-filler-close`.

- [ ] **Step 1: Write the failing e2e tests**

Append to `tests/e2e/paneLayouts.spec.ts`:

```ts
test('a pane waiting to be filled offers the open tabs and recent sessions', async () => {
  await sidebarSession(h.page, 'Fix CSV export bug').click()
  await sidebarSession(h.page, 'Add worktree switcher').click()
  await h.page.getByTestId('window-layout-button').click()
  await h.page.getByTestId('layout-option-halves-h').click()

  const filler = panes().last().getByTestId('pane-filler')
  await expect(filler).toBeVisible()
  // The tab in front of the other pane is offered to move over.
  await filler.getByTestId('pane-filler-tab').filter({ hasText: 'Add worktree switcher' }).click()
  await expect(panes().last()).toContainText('Add worktree switcher')
  await expect(panes().first().getByTestId('session-tab')).toHaveCount(1)
})

test('a waiting pane opens a recent session, and its search narrows the list', async () => {
  await sidebarSession(h.page, 'Fix CSV export bug').click()
  await h.page.getByTestId('window-layout-button').click()
  await h.page.getByTestId('layout-option-halves-h').click()

  const filler = panes().last().getByTestId('pane-filler')
  // Already open, so not offered as a session to open.
  await expect(filler.getByTestId('pane-filler-session').filter({ hasText: 'Fix CSV export bug' })).toHaveCount(0)
  await filler.getByTestId('pane-filler-search').fill('repo root')
  await expect(filler.getByTestId('pane-filler-session')).toHaveCount(1)
  await filler.getByTestId('pane-filler-session').click()
  await expect(panes().last()).toContainText('Repo root session')
  await expect(panes().last()).toHaveAttribute('data-placeholder', 'false')
})

test('a waiting pane can be closed, stepping the layout down', async () => {
  await sidebarSession(h.page, 'Fix CSV export bug').click()
  await h.page.getByTestId('window-layout-button').click()
  await h.page.getByTestId('layout-option-grid').click()
  await panes().nth(3).getByTestId('pane-filler-close').click()
  await expect(content()).toHaveAttribute('data-preset', 'main-right2')
  await expect(panes()).toHaveCount(3)
})
```

- [ ] **Step 2: Run them to verify they fail**

Run: `npm run test:e2e -- tests/e2e/paneLayouts.spec.ts -g "waiting"`
Expected: FAIL — no `pane-filler`.

- [ ] **Step 3: Create the component**

Create `src/renderer/components/PaneFiller.tsx`:

```tsx
import { useEffect, useMemo, useState } from 'react'
import type { ProjectNode, SessionNode } from '@shared/types'
import { relativeTime } from './SessionRow'

const RECENT = 8

function flatten(nodes: ProjectNode[], into: SessionNode[] = []): SessionNode[] {
  for (const node of nodes) {
    into.push(...node.sessions)
    flatten(node.children, into)
  }
  return into
}

interface Props {
  /** Tabs open in the window's other panes. */
  openTabs: { key: string; label: string }[]
  /** Session ids already open anywhere in the window — not offered as sessions to open. */
  exclude: Set<string>
  onMoveHere: (key: string) => void
  onOpenHere: (session: SessionNode) => void
  onClosePane: () => void
}

/**
 * What a pane shows while it is a zone waiting to be filled — Windows' Snap Assist, inside the
 * pane: what is already open elsewhere first, since moving is the common case, then recent
 * sessions. Ignoring it is fine; closing it steps the layout down.
 */
export function PaneFiller({ openTabs, exclude, onMoveHere, onOpenHere, onClosePane }: Props): JSX.Element {
  const [sessions, setSessions] = useState<SessionNode[]>([])
  const [query, setQuery] = useState('')

  useEffect(() => {
    let cancelled = false
    void window.apiary.tree('')
      .then((nodes) => { if (!cancelled) setSessions(flatten(nodes)) })
      .catch(() => { /* the open tabs are still offered; recent sessions are a convenience */ })
    return () => { cancelled = true }
  }, [])

  const needle = query.trim().toLowerCase()
  const matches = (title: string): boolean => needle === '' || title.toLowerCase().includes(needle)
  const tabs = openTabs.filter((t) => matches(t.label))
  const sorted = useMemo(() => sessions
    .filter((s) => !exclude.has(s.sessionId))
    .sort((a, b) => (b.lastActiveAtMs ?? 0) - (a.lastActiveAtMs ?? 0)), [sessions, exclude])
  const recent = sorted.filter((s) => matches(s.title)).slice(0, RECENT)

  return (
    <div className="pane-filler" data-testid="pane-filler">
      <input
        className="search"
        data-testid="pane-filler-search"
        placeholder="Find a session for this pane"
        value={query}
        onChange={(e) => { setQuery(e.target.value) }}
      />
      {tabs.length > 0 && (
        <section>
          <h2 className="pane-filler-heading">Open in this window</h2>
          {tabs.map((t) => (
            <button key={t.key} className="session-row" data-testid="pane-filler-tab" onClick={() => { onMoveHere(t.key) }}>
              <span className="session-title">{t.label}</span>
            </button>
          ))}
        </section>
      )}
      {recent.length > 0 && (
        <section>
          <h2 className="pane-filler-heading">Recent sessions</h2>
          {recent.map((s) => (
            <button key={s.sessionId} className="session-row" data-testid="pane-filler-session" onClick={() => { onOpenHere(s) }}>
              <span className="session-title">{s.title}</span>
              <span className="session-time">{relativeTime(s.lastActiveAtMs)}</span>
            </button>
          ))}
        </section>
      )}
      {tabs.length === 0 && recent.length === 0 && <p className="empty">Nothing matches.</p>}
      <button className="btn small pane-filler-close" data-testid="pane-filler-close" onClick={onClosePane}>
        Close pane
      </button>
    </div>
  )
}
```

`exclude` is rebuilt on every render of `App`, so pass it from a `useMemo` keyed on the open keys' signature (Step 4) or the memo above never hits.

- [ ] **Step 4: Render it from `App`**

In `App.tsx`, import `PaneFiller` and `closePane` (merge into the layout import), and `moveTabToColumn` is already imported. In the `columns.map` render, pass to `SessionColumn`:

```tsx
            emptyContent={column.placeholder === true ? (
              <PaneFiller
                openTabs={columns
                  .filter((c) => c.id !== column.id)
                  .flatMap((c) => c.tabs)
                  .map((t) => ({
                    key: t.key,
                    label: openSessions.get(t.key)?.title ?? pendingTabInfo.get(t.key)?.label ?? t.key,
                  }))}
                exclude={openKeySet}
                onMoveHere={(key) => {
                  setColumns((prev) => moveTabToColumn(prev, key, column.id, 0))
                  setActiveColumnId(column.id)
                }}
                onOpenHere={(session) => {
                  setOpenSessions((prev) => new Map(prev).set(session.sessionId, session))
                  setColumns((prev) => prev.map((c) => (c.id === column.id ? openTab(c, session.sessionId) : c)))
                  setActiveColumnId(column.id)
                }}
                onClosePane={() => { setLayout((prev) => closePane(prev, column.id, activeColumnId)) }}
              />
            ) : undefined}
```

Above the `return` in `App`, next to `openKeysSignature`, add a memoised set for the filler:

```tsx
  const openKeySet = useMemo(
    () => new Set(openKeysSignature === '' ? [] : openKeysSignature.split(' ')),
    [openKeysSignature],
  )
```

(add `useMemo` to `App.tsx`'s `react` import). `pendingTabInfo` is a plain `const` in the component body and is in scope in the JSX.

- [ ] **Step 5: Style it**

Append to `src/renderer/styles.css`:

```css
/* A pane waiting to be filled (PaneFiller.tsx): a short list, not a full sidebar. */
.pane-filler {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 16px;
  overflow-y: auto;
  min-height: 0;
  max-width: 420px;
}
.pane-filler section { display: flex; flex-direction: column; }
.pane-filler-heading { color: var(--muted); font-size: 11px; font-weight: 600; margin: 0 0 4px; text-transform: uppercase; }
.pane-filler .session-row { width: 100%; }
.pane-filler-close { align-self: flex-start; }
```

- [ ] **Step 6: Run the e2e tests to verify they pass**

Run: `npm run test:e2e -- tests/e2e/paneLayouts.spec.ts`
Expected: PASS (all tests in the file).

- [ ] **Step 7: Commit**

```bash
npm run typecheck
git add src/renderer tests/e2e/paneLayouts.spec.ts
git commit -m "feat(layout): an empty pane offers sessions to fill it"
```

---

### Task 9: Running sessions survive moves; docs; release notes; full verification

**Files:**
- Test: `tests/e2e/paneLayouts.spec.ts`
- Modify: `CLAUDE.md`, `CHANGELOG.md`, `package.json` / `package-lock.json`

- [ ] **Step 1: Write the behaviour-kept tests**

Append to `tests/e2e/paneLayouts.spec.ts`:

```ts
test('a pane\'s shell follows the session in front of it after a move', async () => {
  await sidebarSession(h.page, 'Fix CSV export bug').click()
  await h.page.getByTestId('shell-toggle').click()
  await h.page.getByTestId('terminal-shell').click()
  await h.page.keyboard.type('echo SHELL_FOLLOWS_$((3*3))\n')
  await expect(h.page.getByTestId('terminal-shell')).toContainText('SHELL_FOLLOWS_9', { timeout: 20000 })

  const tab = h.page.getByTestId('session-tab').first()
  const picker = await openPickerOn(tab.getByTestId('session-tab-layout'), tab)
  await picker.getByTestId('layout-zone-halves-h-2').click()

  const moved = panes().last()
  await expect(moved).toContainText('Fix CSV export bug')
  await moved.getByTestId('shell-toggle').click()
  // The same shell, not a new one: what it printed is still there.
  await expect(moved.getByTestId('terminal-shell')).toContainText('SHELL_FOLLOWS_9', { timeout: 15000 })
})
```

- [ ] **Step 2: Run it**

Run: `npm run test:e2e -- tests/e2e/paneLayouts.spec.ts -g "shell follows"`
Expected: PASS. If it fails because the shell pane is open in the moved pane already (so `shell-toggle` hides it), assert with `toBeVisible` first and only click the toggle when `terminal-shell` is absent. If it fails because the terminal is blank, that is a real defect: the shell id is `shell:<key>:<n>` and does not depend on the pane, so check `shellTabs` still has the session's entry after the move (it is keyed by session, not pane) and that `openShell` attaches rather than respawning (`AppService.openShell`).

- [ ] **Step 3: Document it in `CLAUDE.md`**

Add this section after "## Windows, and what belongs to which":

```markdown
## Layouts

A window's panes are a `Layout` (`src/renderer/state/layout.ts`): one of eight presets and at
most four panes, each pane being a `Column` with its own tabs and terminals. It is a preset table
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
  the pty belongs to the main process, so moving a tab between panes remounts its views onto the
  same processes (the replay buffer fills them in).
- The pickers are fed through `LayoutContext`, so a sidebar row can place a session without the
  layout being threaded through every component between `App` and it.
```

- [ ] **Step 4: Release notes and version**

Add at the top of `CHANGELOG.md`'s entries (above `## [1.16.0]`):

```markdown
## [1.17.0] - 2026-09-17

### Added

- **Layouts of up to four sessions in one window.** Rest the pointer on a session's split button
  in the sidebar, on the split button at the end of a tab strip, or on the small layout icon of a
  tab, and a picker shows eight layouts — single, two columns, two rows, three columns, a main
  pane with two beside it (either side), a top pane with two below, and a 2×2 grid. Click the spot
  you want the session in and it goes there; the other panes arrange themselves around it. The
  same picker is under **Arrange…** in the right-click menu of tabs and sidebar sessions.
- **A layout button** on the top-right pane changes the layout without moving anything.
- **Empty panes offer what to put in them** — your other open tabs first, then recent sessions,
  with a search — or can be closed.
- **Dividers between rows** as well as columns.

### Changed

- **Splitting stops at four panes.** A split with four panes already open opens the session as a
  tab in the next pane.
- **Closing a pane's last tab steps the layout down** — a grid becomes a main pane with two beside
  it, and so on — rather than leaving a gap.
- A plain click on a split button still opens the session to the side, as before.

```

Then:

```bash
npm version 1.17.0 --no-git-tag-version
```

- [ ] **Step 5: Full verification**

Run, one after the other (never together):

```bash
npm run typecheck
npm test
npm run test:e2e
```

Expected: typecheck clean; all unit tests pass; all e2e tests pass except possibly the known flake `settings.spec.ts:83`. Report the exact counts. If anything else fails, fix it before committing — do not mark it as a flake without re-running it in isolation and on `git stash`ed code.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat: layouts of up to four sessions in one window (1.17.0)"
```

Do not push or tag.
