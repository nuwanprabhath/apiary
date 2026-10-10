---
name: ui-review
description: The UI quality gate for Apiary — designing a UI change before it is built, the UI scenarios and audit that every renderer change passes, and the screenshot review that decides whether it is good enough to ship. Use when building, delegating or reviewing anything a person sees (a menu, a toolbar, a bar, a dialog, a layout change), and before saying a UI change is done.
---

# UI review

Functional tests prove a feature works; they never noticed that it looked broken. In 1.35.0, agents
shipped the following with every test green, and the maintainer found each by hand:

- a toolbar "…" menu drawn as a bulleted list inside the toolbar;
- labels cut to "H..";
- a find bar with grey browser-default buttons;
- a command menu the transcript showed through.

This skill is the gate that catches them before the maintainer does. It has three layers, cheapest
first.

## 1. Machine checks (every run, no judgment)

- **The UI audit** (`tests/component/ui/audit.ts`) runs on every UI scenario at each theme and
  width. Each rule is a yes/no "is this broken?":
  - `clipped-text`: a label cut by its box, unless its full text is in a tooltip and at least 5em
    still shows;
  - `cut-off`: part of a control hidden by its container or the window;
  - `overlap`: two controls or two texts drawn over each other;
  - `see-through-popup`: a menu, listbox, dialog or tooltip the page shows through;
  - `native-control`: a button or field with the browser's default look;
  - `list-marker`: bullets in app chrome;
  - `misaligned-row`: a `role="toolbar"` child off the row's line;
  - `low-contrast`: text under 3:1 against its background;
  - `unnamed-control`: an icon-only control with no name.
- **`classesDefined`** (architecture test): every class a component uses exists in a stylesheet.
- **The Stop hook:**
  - a branch that changes `src/renderer/**/*.{tsx,css}` must add or change a UI scenario;
  - every scenario must pass the audit;
  - the baselines (`knownDefects.allow.json`, `classesDefined.allow.json`) must not grow;
  - a new `data-ui-allow` exception needs a `UI-Allow-Reason:` trailer.

An element that legitimately breaks a rule carries `data-ui-allow="<rule>: <reason>"`, for example a
session title that truncates with its full text in a tooltip. That is rare, and the lead reviews
each one.

## 2. UI scenarios and screenshots (every UI change)

- A scenario is a component test in `tests/component/ui/<feature>.ui.test.tsx` that opens a state
  and calls `reviewUi(name, { open, close, widths, themes })` (`tests/component/ui/review.ts`).
- `reviewUi` runs at a narrow and a wide window (900 and 1400 by default) in the default, Paper
  (light) and Glass themes. For each it:
  - runs `open`;
  - audits;
  - saves `ui-review/shots/<name>--<theme>-<width>.png`.
- **Cover the states a person reaches, not just the resting one.** Every state of the feature needs
  a scenario:
  - each menu open;
  - a narrow pane (split the pane, or use a window of about 620 px);
  - long text (a long branch name, a long command description);
  - empty, busy and error states;
  - hover only where it changes layout.
- `npm run ui:review` runs every scenario and writes `ui-review/index.html`: every screenshot on one
  page, stamped with the commit. Pass a scenario file to run only that one.

## 3. The lead's review (judgment, on the screenshots)

Never accept a UI change from its report or its tests. Open `ui-review/index.html`, or read the
PNGs, and go through this list for every state:

1. **Nothing is broken.** No text cut mid-word, no half-drawn control, no overlap, no bullets, no
   default grey control, no popup the page shows through, no control floating away from its row.
2. **It belongs to this app.**
   - It uses the existing pieces: `.btn`, `.icon-button`, `.context-menu` surface, `Menu`,
     `Popover`, the tokens in `styles/00-tokens.css`.
   - Its corner radius, padding, font size and colours match its neighbours.
   - Nothing is new where an existing pattern fits.
3. **It survives narrow and light.** At 620–900 px and in Paper it still reads well. Something
   degrades on purpose (moves to a menu, wraps, hides a hint), never by being cut.
4. **The hierarchy is clear.** The primary action is obvious, secondary text is muted, and related
   things are grouped and aligned on a common edge.
5. **States are designed.** Empty, busy, error and a long value each look intended.
6. **It matches the design spec** the lead wrote (below), or the deviation is better and explained.

Write each finding as the state, the screenshot, what is wrong and what it should be. Send the
findings back to the agent; on the second failed round, fix it yourself or narrow the brief.

## Designing before delegating

Agents (Sonnet, Haiku) build UI well from a precise spec and poorly from "make it good". For any UI
work, the lead writes the spec into the brief:

- **Where it lives and what it reuses.** The component, the existing primitive or class to build
  on, and the tokens.
- **A mockup per state.** ASCII is fine:

  ```text
  ┌ Find ──────────────────────┐ 3 of 12  ↑  ↓  ✕
  ```

  Include the sizes that matter (height = `--control-height-sm`, gap = `--control-gap`).
- **Behaviour at narrow widths.** What moves, wraps or hides, in priority order.
- **Each theme's concern.** Glass needs an opaque or blurred surface; Paper needs contrast.
- **The UI scenarios to write,** by name and state. These are the acceptance criteria, together
  with the functional tests.
