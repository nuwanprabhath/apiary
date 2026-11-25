# Panes, tabs and terminals

Opening a session puts it in a tab. Tabs move between pane layouts (halves, thirds and so on)
through a layout picker. A session gets a terminal (`terminal-session`, its `claude --resume`)
once it is resumed, and a shell (`terminal-shell`) on demand; main owns both, so they survive moves
between panes. The pane header is the title (editable: `session-title-edit`, `session-title-input`,
with the state of an MR it names): its tooltip (and `data-cwd` on `session-title`) holds the folder
path.

## Sub-features

- Tabs (`session-tab`) and the layout picker (`session-tab-layout` → `layout-picker` →
  `layout-zone-<preset>-<n>`, e.g. `layout-zone-halves-h-2`). `content` carries `data-preset`.
- The shell toggle (`shell-toggle`) and the shell itself (`terminal-shell`).
- The Chat | Terminal toggle in the tab bar (`view-toggle`): `view-transcript` always; the second
  segment is `resume-button` while the session has no terminal (it starts one; disabled with
  `data-cwd-exists="false"` when the folder is gone) and `view-terminal` with `session-live-dot`
  once it has one. Only one of the two is in the page at a time.
- Folding a stacked pane: `pane-collapse` at the start of its tab bar (`aria-expanded`); the folded
  column has `data-folded="true"`, with `data-pane-activity` on the `session-column` and `data-glow`
  on its `session-card` while a tab inside runs or waits (a pane collapsed sideways to a rail,
  `pane-rail`, gets them too). Only panes with a vertical neighbour have the fold control.
- Tabs share the strip: each stops at 200px and shrinks to six letters of title (ellipsized, the
  whole title in the label's `title`) before the strip scrolls. Then the arrows show
  (`session-tab-scroll-left` / `-right`, the strip's `data-more-left` / `data-more-right`), and with
  two or more tabs the all-tabs menu (`session-tab-list` → `tab-list-menu`, a `tab-list-filter`
  above eight tabs). A tab's right-click menu (`tab-menu`): Account, Fork, Reload, Move into New
  Window, Arrange…, Pin, Close; a middle click closes it.
- A working tab: `data-activity` on `session-tab`, and `data-glow="running|waiting"` (the travelling
  border glow, `[data-glow]` in `styles/05-ui.css`).
- The shell bar is the card's footer (`.shell-card` inside `session-card`); copy-branch
  (`toolbar-copy`) sits right after the branch name.
- With a chat busy, Terminal waits for it: `resume-handoff` under the title, with
  `resume-handoff-now` and `resume-handoff-cancel`.

## How to get to it (user POV)

Click a session in the sidebar; hover a tab's layout button to pick a pane.

## Driving it with launchApiary

```ts
await sidebarSession(h.page, 'Fix CSV export bug').click()
await h.page.getByTestId('shell-toggle').click()
await h.page.getByTestId('terminal-shell').click()
await h.page.keyboard.type('echo HELLO_$((6*7))\n')       // arithmetic, so the echo of the
await expect(h.page.getByTestId('terminal-shell')).toContainText('HELLO_42') // typed line can't match
```

The picker opens on hover (and on a click of `session-tab-layout`), which can miss while the layout
settles; retry it the way `openPickerOn` in `paneLayouts.spec.ts` does
(`expect(async () => { hover; visible }).toPass()`).

Proof: `content`'s `data-preset`, which pane holds which tab, and text still in the shell after a
move (the pty belongs to main, so output must survive a remount).

## Gotchas

- Each pane is a `session-column`; the shell panel's height is `bottom-resizer`. After a tab moves,
  `shell-toggle` may need clicking again to show its shell.

- Resume runs the stand-in `claude` (it switches to the alternate screen, then runs a login shell)
  unless `claudeBin` says otherwise.
- Extra sessions for a drive (`extraSessions`) each need their own `sessionId` and a `firstPrompt`,
  or the import shows none of them; `drives/features-1-89.verify.ts` opens three long-titled ones.
- Typing into a terminal needs a click on it first to focus xterm.
