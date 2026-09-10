# Git menu, column resizing, and the real terminal-cutoff fix — progress tracker

Branch: `main` directly. Released as **1.5.0**. Items numbered as the user listed them.

## Status

| # | Item | State |
|---|------|-------|
| 13 | Escape closes the branch selection popup | **done** |
| 14a | Folder checkbox checks when every session in it is checked | **done** |
| 14b | Scrollbar up/down arrow buttons | **done** |
| 15 | Transcript in sync with the running session | **done** |
| 16 | Draggable divider between session columns | **done** |
| 17 | Bottom of the terminal still cut off | **done** — real cause found this time |
| 18 | "..." git menu, grouped, with Branch → Merge | **done** |
| 19 | Split icon on the tab bar | **done** |
| 20 | (empty — confirmed a typo, nothing to do) | n/a |

## Root causes

**#17, and why 1.4.0's fix wasn't enough.** 1.4.0 fixed a *real* overflow (a rigid `flex: none`
bottom pane running past a short window), but that was not this bug. Found by measuring instead of
reasoning: a diagnostic run printed a **352px-tall terminal host inside a 167px row**, its bottom
edge 185px below the window, and completely unmoved when the pane was shrunk to 120px.

The cause: `.terminal-tab-view` was a plain block, so `.terminal-host`'s `flex: 1` was inert and
its height fell back to `auto` — to xterm's own content. FitAddon measures that host to decide how
many rows fit, so the measurement was **self-referential**: it reported the size the terminal
already was rather than the space available to it. The proposed row count could therefore never
come down, and the excess was clipped by the pane. Making `.terminal-tab-view` a flex column gives
the host a definite height from the layout; after the fix the same probe reads 167-in-167, and
87-in-87 once the pane shrinks.

Secondary, same symptom: `.toolbar` could wrap. In a narrow column a long branch name wrapped its
label over three lines, and since the pane's height is fixed, every line the toolbar grew was a
line taken from the terminal below it — the usable height changing out from under the terminal as
a branch label loaded. The toolbar is now one row, always, with the label ellipsizing.

**#15.** The transcript was already mounted and merging in new messages while the live terminal was
in front — it was never out of date. What it could not do was *scroll*: `scrollTop` on a
`display: none` box is a no-op, so the layout effect ran, silently did nothing, and cleared the
"scroll to bottom" flag. Switching back therefore landed on the oldest message. The flag now
survives while hidden and is consumed by a visibility effect on the way back in.

**#14b.** Chromium hides scrollbar buttons by default and this stylesheet hid them explicitly.
Two things were needed: the buttons must be declared per end with an explicit size (a blanket
`display: none` base rule suppresses them no matter what a later, more specific rule says), and the
arrows must be background images — `-webkit-mask-image` renders nothing on these pseudo-elements
(verified: the buttons simply do not appear). Background images cannot read CSS custom properties,
so the four glyph colours are this stylesheet's one deliberate literal-colour exception, documented
where they sit. Verified functionally rather than by eye: clicking the gutter now steps 40px where
it used to jump a full page.

**#16.** Columns carry flex-grow *weights*, not pixel widths, so a window resize redistributes them
in the proportions the user dragged rather than leaving a fixed column with a gap beside it. A drag
only ever touches the pair either side of that divider, and preserves their combined weight.

**#18.** `GitMenu` is positioned `fixed`, not absolutely: it opens upward out of the shell pane,
which clips its own contents (that clipping is what keeps a terminal inside its box), so a menu
positioned within the pane would be cut off at the pane's top edge. Submenus open on click and on
hover but never *toggle* closed on click — hovering has already opened one by the time the click
lands, so toggling made it flicker out from under the pointer (caught by the new tests).

Merge conflicts deliberately leave the tree mid-merge rather than running `merge --abort`: the
shell directly below the toolbar is where the conflict gets resolved, and aborting would throw away
the one state from which that is possible. Decided with the user.

## Testing

Same environment caveat as every prior batch: `ELECTRON_RUN_AS_NODE=1` is exported here and breaks
every Electron launch. Run e2e as `env -u ELECTRON_RUN_AS_NODE npm run test:e2e`.

Final state: typecheck clean, `npm test` 150 passed, e2e 104 passed. `docs/screenshot.png`
regenerated (`npm run screenshot`) since the tab bar gained its split button.
