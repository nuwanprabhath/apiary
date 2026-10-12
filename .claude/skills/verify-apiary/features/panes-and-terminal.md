# Panes, tabs and terminals

Opening a session puts it in a tab. Tabs move between pane layouts (halves, thirds and so on)
through a layout picker. A session gets a terminal (`terminal-session`, its `claude --resume`)
once it is resumed, and a shell (`terminal-shell`) on demand; main owns both, so they survive moves
between panes. The pane header is the title alone: its tooltip (and `data-cwd` on `session-title`)
holds the folder path.

## Sub-features

- Tabs (`session-tab`) and the layout picker (`session-tab-layout` → `layout-picker` →
  `layout-zone-<preset>-<n>`, e.g. `layout-zone-halves-h-2`). `content` carries `data-preset`.
- The shell toggle (`shell-toggle`) and the shell itself (`terminal-shell`).
- The Chat | Terminal toggle in the tab bar (`view-toggle`): `view-transcript` always; the second
  segment is `resume-button` while the session has no terminal (it starts one; disabled with
  `data-cwd-exists="false"` when the folder is gone) and `view-terminal` with `session-live-dot`
  once it has one. Only one of the two is in the page at a time.
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

The picker opens on hover, which can miss while the layout settles; retry it the way
`openPickerOn` in `paneLayouts.spec.ts` does (`expect(async () => { hover; visible }).toPass()`).

Proof: `content`'s `data-preset`, which pane holds which tab, and text still in the shell after a
move (the pty belongs to main, so output must survive a remount).

## Gotchas

- Resume runs the stand-in `claude` (a login shell) unless `claudeBin` says otherwise.
- Typing into a terminal needs a click on it first to focus xterm.
